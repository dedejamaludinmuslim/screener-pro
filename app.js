/* =========================================================
   Swing Signals — CSV → Supabase (NO LOGIN, NO WATCHLIST)
   - Upload CSV ringkasan harian (format IDX)
   - Simpan histori ke Supabase (prices_daily + symbols)
   - Analisis swing rule-based (signals_daily)
========================================================= */

/* =========================
   CONFIG (KEYS EMBEDDED)
========================= */
const SUPABASE_URL = "https://pbhfwdbgoejduzjvezrk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiaGZ3ZGJnb2VqZHV6anZlenJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1NjMxNzEsImV4cCI6MjA4MjEzOTE3MX0.JUoaKbT29HMZUhGjUbT4yj9MF0sn4gjzUOs9mKLM-nw";

if (!window.supabase) {
  throw new Error("Supabase library belum ter-load. Cek script CDN supabase-js di index.html.");
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* =========================
   UI Helpers
========================= */
const $ = (id) => document.getElementById(id);

const elFileInput = $("fileInput");
const elBtnUpload = $("btnUpload");
const elBtnAnalyze = $("btnAnalyze");

const elPillStatus = $("pillStatus");
const elPillDate = $("pillDate");
const elPillRows = $("pillRows");

const elSignals = $("signalsTable");

const elSearch = $("search");
const elMode = $("mode");
const elFilterSignal = $("filterSignal");

let lastParsed = { tradeDateISO: null, rows: [] };
let cachedSignals = [];
let cachedSignalsDate = null;
    cachedSignalsStrategy = null;
let cachedSignalsStrategy = null;

// sorting
let sortKey = "score";
let sortDir = -1; // -1 desc, 1 asc, 0 none

const COLS = [
  { key: "symbol", label: "Symbol", type: "text" },
  { key: "signal", label: "Signal", type: "text" },
  { key: "score", label: "Score", type: "num" },
  { key: "close", label: "Close", type: "num" },
  { key: "rsi14", label: "RSI14", type: "num" },
  { key: "ma20", label: "MA20", type: "num" },
  { key: "ma50", label: "MA50", type: "num" },
  { key: "vol_ratio", label: "VolR", type: "num" },
  { key: "foreign_net", label: "FNet", type: "num" },
  { key: "reasons", label: "Reasons", type: "text" },
];

/* =========================
   Utilities
========================= */
function toast(msg, bad=false){
  elPillStatus.textContent = `Status: ${msg}`;
  elPillStatus.style.borderColor = bad ? "rgba(255,120,80,.45)" : "rgba(255,255,255,.10)";
}

function fmt(x){
  if (x === null || x === undefined) return "-";
  if (typeof x === "number") return Number.isFinite(x) ? x.toLocaleString("id-ID") : "-";
  return String(x);
}
function fmt2(x){
  if (x === null || x === undefined) return "-";
  const n = Number(x);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(2);
}
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function num(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(String(x).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function int(x) {
  const n = num(x);
  return n === null ? null : Math.trunc(n);
}

/* =========================
   Date parse (e.g. "08 Des 2025")
========================= */
const MONTH_ID = {
  jan: "01", januari: "01",
  feb: "02", februari: "02",
  mar: "03", maret: "03",
  apr: "04", april: "04",
  mei: "05",
  jun: "06", juni: "06",
  jul: "07", juli: "07",
  agu: "08", agustus: "08",
  sep: "09", september: "09",
  okt: "10", oktober: "10",
  nov: "11", november: "11",
  des: "12", desember: "12",
};

function parseIDXDateToISO(s) {
  if (!s) return null;
  const raw = String(s).trim().replace(/\s+/g, " ");
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parts = raw.split(" ");
  if (parts.length < 3) return null;

  const d = String(parts[0]).padStart(2, "0");
  const monKey = parts[1].toLowerCase();
  const y = parts[2];

  const m = MONTH_ID[monKey] || MONTH_ID[monKey.slice(0,3)];
  if (!m) return null;

  return `${y}-${m}-${d}`;
}

/* =========================
   Robust CSV Parser (no external libs)
   - Supports quoted fields, commas, CRLF/LF
========================= */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // escaped quote?
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = "";
    } else if (c === '\n') {
      row.push(field);
      field = "";
      // drop trailing \r from last field if any
      if (row.length && typeof row[row.length - 1] === "string") {
        row[row.length - 1] = row[row.length - 1].replace(/\r$/, "");
      }
      // skip empty lines
      if (row.some(v => v !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }

  // flush last field
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    if (row.some(v => v !== "")) rows.push(row);
  }
  return rows;
}

async function readCsv(file) {
  const text = await file.text();
  const grid = parseCSV(text);
  if (!grid.length) throw new Error("CSV kosong atau format tidak terbaca.");

  const header = grid[0].map(h => String(h || "").trim());
  const dataRows = grid.slice(1);

  // build objects
  const rawRows = dataRows.map(cols => {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = cols[i] ?? "";
    return obj;
  });

  const cleaned = rawRows
    .filter(r => r["Kode Saham"])
    .map(r => {
      const tradeDateISO = parseIDXDateToISO(r["Tanggal Perdagangan Terakhir"]);
      return {
        trade_date: tradeDateISO,
        symbol: String(r["Kode Saham"]).trim(),
        name: r["Nama Perusahaan"] ? String(r["Nama Perusahaan"]).trim() : null,

        prev: num(r["Sebelumnya"]),
        open: num(r["Open Price"]),
        high: num(r["Tertinggi"]),
        low: num(r["Terendah"]),
        close: num(r["Penutupan"]),
        chg: num(r["Selisih"]),

        volume: int(r["Volume"]),
        value: num(r["Nilai"]),
        freq: int(r["Frekuensi"]),

        foreign_buy: int(r["Foreign Buy"]),
        foreign_sell: int(r["Foreign Sell"]),
      };
    })
    .filter(r => r.trade_date);

  const tradeDateISO = cleaned[0]?.trade_date || null;
  return { tradeDateISO, rows: cleaned };
}

/* =========================
   Supabase ops
========================= */
async function upsertSymbols(rows) {
  const payload = rows.map(r => ({ symbol: r.symbol, name: r.name }));
  const { error } = await sb.from("symbols").upsert(payload, { onConflict: "symbol" });
  if (error) throw error;
}

async function upsertPrices(rows) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const { error } = await sb.from("prices_daily").upsert(part, { onConflict: "trade_date,symbol" });
    if (error) throw error;
  }
}

async function fetchHistoryForSymbols(symbols, endDateISO, lookbackDays = 160) {
  const unique = Array.from(new Set(symbols));
  const SYM_CHUNK = 120;

  const start = new Date(endDateISO);
  start.setDate(start.getDate() - lookbackDays);
  const startISO = start.toISOString().slice(0, 10);

  let all = [];
  for (let i = 0; i < unique.length; i += SYM_CHUNK) {
    const slice = unique.slice(i, i + SYM_CHUNK);
    const { data, error } = await sb
      .from("prices_daily")
      .select("trade_date,symbol,open,high,low,close,volume,foreign_net")
      .in("symbol", slice)
      .gte("trade_date", startISO)
      .lte("trade_date", endDateISO)
      .order("trade_date", { ascending: true });

    if (error) throw error;
    all = all.concat(data || []);
  }
  return all;
}

async function upsertSignals(signalRows) {
  const CHUNK = 500;
  for (let i = 0; i < signalRows.length; i += CHUNK) {
    const part = signalRows.slice(i, i + CHUNK);
    const { error } = await sb.from("signals_daily").upsert(part, { onConflict: "trade_date,symbol,strategy" });
    if (error) throw error;
  }
}

async function fetchSignalsLatest(tradeDateISO, strategy) {
  const { data, error } = await sb
    .from("signals_daily")
    .select("trade_date,symbol,signal,score,reasons,close,rsi14,ma20,ma50,atr14,vol_ratio,foreign_net,strategy")
    .eq("trade_date", tradeDateISO)
    .eq("strategy", strategy)
    .order("score", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return data || [];
}

async function fetchLatestTradeDate() {
  const { data, error } = await sb
    .from("prices_daily")
    .select("trade_date")
    .order("trade_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.trade_date || null;
}

/* =========================
   Indicators
========================= */
function SMA(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  let q = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    q.push(v);
    sum += v;
    if (q.length > period) sum -= q.shift();
    if (q.length === period) out[i] = sum / period;
  }
  return out;
}

function RSI(values, period = 14) {
  const out = new Array(values.length).fill(null);
  let gain = 0, loss = 0;

  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (!Number.isFinite(ch)) continue;
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - (100 / (1 + gain / loss));

  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - (100 / (1 + gain / loss));
  }
  return out;
}

function ATR(high, low, close, period = 14) {
  const tr = new Array(close.length).fill(null);
  for (let i = 0; i < close.length; i++) {
    if (i === 0) tr[i] = high[i] - low[i];
    else {
      const a = high[i] - low[i];
      const b = Math.abs(high[i] - close[i - 1]);
      const c = Math.abs(low[i] - close[i - 1]);
      tr[i] = Math.max(a, b, c);
    }
  }
  const atr = new Array(close.length).fill(null);
  let first = 0;
  for (let i = 0; i < period; i++) first += tr[i] ?? 0;
  atr[period - 1] = first / period;
  for (let i = period; i < close.length; i++) {
    atr[i] = ((atr[i - 1] * (period - 1)) + tr[i]) / period;
  }
  return atr;
}

function rollingMax(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (i + 1 < period) continue;
    let m = -Infinity;
    for (let j = i - period + 1; j <= i; j++) m = Math.max(m, values[j]);
    out[i] = m;
  }
  return out;
}

/* =========================
   Swing scoring rules (2 mode)
   - SWING_V1_CONS: lebih ketat
   - SWING_V1_AGGR: lebih longgar
========================= */
const MODE_PARAMS = {
  SWING_V1_CONS: { buyScore: 75, sellScore: 25, breakoutTol: 1.00, volStrong: 1.6, volWeak: 0.85, rsiMin: 50, rsiMax: 68 },
  SWING_V1_AGGR: { buyScore: 65, sellScore: 30, breakoutTol: 0.995, volStrong: 1.3, volWeak: 0.80, rsiMin: 45, rsiMax: 70 },
};

function scoreSwing(series, params) {
  const closes = series.map(x => x.close ?? 0);
  const highs = series.map(x => x.high ?? 0);
  const lows  = series.map(x => x.low ?? 0);
  const vols  = series.map(x => x.volume ?? 0);

  const ma20 = SMA(closes, 20);
  const ma50 = SMA(closes, 50);
  const rsi14 = RSI(closes, 14);
  const atr14 = ATR(highs, lows, closes, 14);
  const volMA20 = SMA(vols, 20);
  const hh20 = rollingMax(highs, 20);

  const i = series.length - 1;
  const last = series[i];
  const prev = series[i - 1];

  const reasons = [];
  let score = 0;

  const C = last.close, O = last.open;
  const MA20 = ma20[i], MA50 = ma50[i];
  const RSI14 = rsi14[i];
  const ATR14 = atr14[i];
  const V = last.volume ?? 0;
  const VMA20 = volMA20[i] ?? null;
  const VOLR = (VMA20 && VMA20 > 0) ? (V / VMA20) : null;
  const FNET = last.foreign_net ?? 0;
  const HH20 = hh20[i];

  if (!MA50 || !RSI14 || !ATR14 || !HH20 || !VOLR) {
    return {
      signal: "WAIT",
      score: 0,
      reasons: ["Data belum cukup (butuh histori ≥ 50 hari)."],
      metrics: { close: C, rsi14: RSI14, ma20: MA20, ma50: MA50, atr14: ATR14, vol_ratio: VOLR, foreign_net: FNET }
    };
  }

  if (C > MA50) { score += 15; reasons.push("Close > MA50 (uptrend)."); }
  if (MA20 > MA50) { score += 10; reasons.push("MA20 > MA50 (trend menguat)."); }

  if (RSI14 >= params.rsiMin && RSI14 <= params.rsiMax) { score += 15; reasons.push(`RSI ${params.rsiMin}–${params.rsiMax} (momentum sehat).`); }
  if (RSI14 > 70) { score -= 8; reasons.push("RSI > 70 (jenuh beli)."); }
  if (RSI14 < 40) { score -= 10; reasons.push("RSI < 40 (lemah)."); }

  if (C >= HH20 * params.breakoutTol) { score += 20; reasons.push("Dekat/tembus high 20 hari (breakout)."); }

  if (VOLR >= params.volStrong) { score += 15; reasons.push(`Volume kuat (${VOLR.toFixed(2)}x MA20).`); }
  else if (VOLR < params.volWeak) { score -= 6; reasons.push(`Volume lemah (${VOLR.toFixed(2)}x MA20).`); }

  if (FNET > 0) { score += 10; reasons.push("Foreign net buy (+)."); }
  if (FNET < 0) { score -= 6; reasons.push("Foreign net sell (-)."); }

  if (C > O) { score += 3; reasons.push("Candle hijau (close > open)."); }
  if (prev && prev.close && C > prev.close) { score += 2; reasons.push("Close naik vs kemarin."); }

  let signal = "WAIT";
  if (score >= params.buyScore) signal = "BUY";
  else if (score <= params.sellScore) signal = "SELL";

  if (C < MA20 && RSI14 < 45) {
    signal = "SELL";
    reasons.unshift("Close < MA20 + RSI < 45 (breakdown).");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    signal,
    score,
    reasons,
    metrics: { close: C, rsi14: RSI14, ma20: MA20, ma50: MA50, atr14: ATR14, vol_ratio: VOLR, foreign_net: FNET }
  };
}

/* =========================
   Render
========================= */
function sortBadgeFor(key){
  if (sortKey !== key) return "";
  if (sortDir === 1) return "▲";
  if (sortDir === -1) return "▼";
  return "";
}
function setSort(key){
  if (sortKey !== key){ sortKey = key; sortDir = -1; return; }
  if (sortDir === -1) sortDir = 1;
  else if (sortDir === 1) sortDir = 0;
  else sortDir = -1;
}
function comparator(a, b, col){
  const av = a[col.key];
  const bv = b[col.key];
  if (col.key === "reasons"){
    const as = Array.isArray(av) ? av.join(" | ") : (av ?? "");
    const bs = Array.isArray(bv) ? bv.join(" | ") : (bv ?? "");
    return as.localeCompare(bs);
  }
  if (col.type === "num"){
    const an = (av === null || av === undefined) ? null : Number(av);
    const bn = (bv === null || bv === undefined) ? null : Number(bv);
    if (an === null && bn === null) return 0;
    if (an === null) return 1;
    if (bn === null) return -1;
    return an - bn;
  }
  return String(av ?? "").localeCompare(String(bv ?? ""));
}

function renderSignals(rows) {
  const thead = elSignals.querySelector("thead");
  const tbody = elSignals.querySelector("tbody");

  thead.innerHTML =
    "<tr>" + COLS.map(c => `<th data-key="${c.key}">${c.label}<span class="sort">${sortBadgeFor(c.key)}</span></th>`).join("") + "</tr>";

  for (const th of thead.querySelectorAll("th")) {
    th.onclick = () => { setSort(th.dataset.key); renderSignals(cachedSignals); };
  }

  const q = (elSearch.value || "").trim().toLowerCase();
  const f = elFilterSignal.value;

  let filtered = rows.filter(r => {
    if (f !== "ALL" && r.signal !== f) return false;
    if (q && !String(r.symbol).toLowerCase().includes(q)) return false;
    return true;
  });

  const col = COLS.find(c => c.key === sortKey) || COLS[2];
  if (sortDir !== 0) filtered = filtered.slice().sort((a,b) => comparator(a,b,col) * sortDir);
  else filtered = filtered.slice().sort((a,b) => (Number(b.score||0) - Number(a.score||0)));

  const body = filtered.map(r => {
    const badgeClass = r.signal === "BUY" ? "buy" : r.signal === "SELL" ? "sell" : "wait";
    const reasons = Array.isArray(r.reasons) ? r.reasons.slice(0,3).join(" • ") : "";
    return `
      <tr>
        <td class="mono">${escapeHtml(r.symbol)}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(r.signal)}</span></td>
        <td class="mono">${fmt(r.score)}</td>
        <td class="mono">${fmt(r.close)}</td>
        <td class="mono">${fmt2(r.rsi14)}</td>
        <td class="mono">${fmt2(r.ma20)}</td>
        <td class="mono">${fmt2(r.ma50)}</td>
        <td class="mono">${fmt2(r.vol_ratio)}</td>
        <td class="mono">${fmt(r.foreign_net)}</td>
        <td title="${escapeHtml(Array.isArray(r.reasons)?r.reasons.join(" | "):"")}">${escapeHtml(reasons)}</td>
      </tr>
    `;
  }).join("");

  tbody.innerHTML = body || "<tr><td colspan='10' class='dim'>Belum ada sinyal. Klik Analisis.</td></tr>";
}

/* =========================
   Refresh signals
========================= */
async function loadSignalsForDate(dateISO, strategy){
  if(!dateISO) return [];
  if(cachedSignalsDate===dateISO && cachedSignalsStrategy===strategy && cachedSignals.length) return cachedSignals;
  const signals = await fetchSignalsLatest(dateISO, strategy);
  cachedSignals = signals;
  cachedSignalsDate = dateISO;
  cachedSignalsStrategy = strategy;
  return signals;
}

async function refreshSignals(){
  try{
    let dateISO = lastParsed.tradeDateISO || await fetchLatestTradeDate();
    if(!dateISO){ toast("belum ada data di Supabase."); return; }
    elPillDate.textContent = `Trade date: ${dateISO}`;
    const strategy = (elMode?.value || "SWING_V1_CONS");
    const signals = await loadSignalsForDate(dateISO, strategy);
    renderSignals(signals);
  }catch(err){
    console.error(err);
    toast(`refresh gagal: ${err.message || err}`, true);
  }
}

/* =========================
   UI events
========================= */
elFileInput.onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try{
    toast("membaca csv…");
    const parsed = await readCsv(file);
    lastParsed = parsed;

    elPillDate.textContent = `Trade date: ${parsed.tradeDateISO || "-"}`;
    elPillRows.textContent = `Rows: ${parsed.rows.length.toLocaleString("id-ID")}`;    elBtnUpload.disabled = parsed.rows.length === 0;
    elBtnAnalyze.disabled = parsed.rows.length === 0;

    toast("file siap di-upload.");
  }catch(err){
    console.error(err);
    toast(`gagal baca csv: ${err.message || err}`, true);
  }
};

elBtnUpload.onclick = async () => {
  try{
    const { tradeDateISO, rows } = lastParsed;
    if (!tradeDateISO || !rows.length) return;

    toast("upsert symbols…");
    await upsertSymbols(rows);

    toast("upload prices_daily…");
    await upsertPrices(rows);

    cachedSignals = [];
    cachedSignalsDate = null;
    cachedSignalsStrategy = null;
    toast(`upload sukses (${rows.length} baris) • ${tradeDateISO}`);
    await refreshSignals();
  }catch(err){
    console.error(err);
    toast(`upload gagal: ${err.message || err}`, true);
  }
};

elBtnAnalyze.onclick = async () => {
  try{
    const { tradeDateISO, rows } = lastParsed;
    if (!tradeDateISO || !rows.length) return;

    toast("ambil histori (lookback 160 hari)…");
    const history = await fetchHistoryForSymbols(rows.map(r => r.symbol), tradeDateISO, 160);

    toast("hitung sinyal swing…");
    const bySym = new Map();
    for (const r of history) {
      if (!bySym.has(r.symbol)) bySym.set(r.symbol, []);
      bySym.get(r.symbol).push({
        trade_date: r.trade_date,
        symbol: r.symbol,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        foreign_net: r.foreign_net,
      });
    }

    const out = [];
    for (const [sym, series] of bySym.entries()) {
      series.sort((a,b) => a.trade_date.localeCompare(b.trade_date));
      if (series[series.length - 1]?.trade_date !== tradeDateISO) continue;

      for (const strategy of ["SWING_V1_CONS","SWING_V1_AGGR"]) {
      const res = scoreSwing(series, MODE_PARAMS[strategy]);
      out.push({
        trade_date: tradeDateISO,
        symbol: sym,
        strategy,
        signal: res.signal,
        score: res.score,
        reasons: res.reasons,

        close: res.metrics.close ?? null,
        rsi14: res.metrics.rsi14 ?? null,
        ma20: res.metrics.ma20 ?? null,
        ma50: res.metrics.ma50 ?? null,
        atr14: res.metrics.atr14 ?? null,
        vol_ratio: res.metrics.vol_ratio ?? null,
        foreign_net: res.metrics.foreign_net ?? null,
      });
    }
    }

    toast("simpan signals_daily…");
    await upsertSignals(out);

    cachedSignals = [];
    cachedSignalsDate = null;
    cachedSignalsStrategy = null;
    toast(`analisis selesai: ${out.length} simbol`);
    await refreshSignals();
  }catch(err){
    console.error(err);
    toast(`analisis gagal: ${err.message || err}`, true);
  }
};elSearch.oninput = () => renderSignals(cachedSignals);
elFilterSignal.onchange = () => renderSignals(cachedSignals);
if (elMode) elMode.onchange = () => { cachedSignals = []; cachedSignalsDate = null; cachedSignalsStrategy = null; refreshSignals(); };

/* =========================
   Init
========================= */
toast("siap. pilih file .csv untuk mulai.");
refreshSignals();

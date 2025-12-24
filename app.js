/* =========================================================
   Swing Signals — CSV → Supabase
   - Batch Upload Support (CSV/XLSX)
   - Auto Zip Download for converted XLSX
   - FIX: API LIMIT HANDLING (Fetch history in small chunks)
   - FIX: ADAPTIVE SCORING (Calculate partial score if data missing)
========================================================= */

/* =========================
   CONFIG
========================= */
const SUPABASE_URL = "https://pbhfwdbgoejduzjvezrk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiaGZ3ZGJnb2VqZHV6anZlenJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1NjMxNzEsImV4cCI6MjA4MjEzOTE3MX0.JUoaKbT29HMZUhGjUbT4yj9MF0sn4gjzUOs9mKLM-nw";

if (!window.supabase) throw new Error("Supabase library not found.");
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* =========================
   UI Helpers
========================= */
const $ = (id) => document.getElementById(id);
const elFileInput = $("fileInput");
const elBtnConvert = $("btnConvert");
const elBtnUpload = $("btnUpload");
const elBtnAnalyze = $("btnAnalyze");
const elPillStatus = $("pillStatus");
const elPillDate = $("pillDate");
const elPillRows = $("pillRows");
const elSignals = $("signalsTable");
const elSearch = $("search");
const elFilterSignal = $("filterSignal");

let lastParsed = { tradeDateISO: null, rows: [] };
let cachedSignals = [];
let cachedSignalsDate = null;
let tempXlsxFiles = []; 
let latestDbDate = null; 

/* =========================
   Sorting & Utils
========================= */
let sortKey = "score";
let sortDir = -1;

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

function sortBadgeFor(key){
  if (sortKey !== key) return "";
  return sortDir === 1 ? "▲" : "▼";
}
function setSort(key){
  if (sortKey !== key){ sortKey = key; sortDir = -1; return; }
  sortDir = sortDir === -1 ? 1 : (sortDir === 1 ? 0 : -1);
}
function cmp(a, b, col){
  const av = a[col.key], bv = b[col.key];
  if (col.key === "reasons") return String(av).localeCompare(String(bv));
  if (col.type === "num"){
    const an = Number(av || 0), bn = Number(bv || 0);
    return an - bn;
  }
  return String(av ?? "").localeCompare(String(bv ?? ""));
}

function toast(msg, bad=false){
  elPillStatus.textContent = `Status: ${msg}`;
  elPillStatus.style.borderColor = bad ? "rgba(255,120,80,.45)" : "rgba(255,255,255,.10)";
}
function fmt(x){ return (typeof x === "number" && Number.isFinite(x)) ? x.toLocaleString("id-ID") : "-"; }
function fmt2(x){ const n = Number(x); return Number.isFinite(n) ? n.toFixed(2) : "-"; }
function escapeHtml(str){ return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function num(x) { const n = Number(String(x || "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
function int(x) { return Math.trunc(num(x) || 0); }

/* =========================
   Date Parsing
========================= */
const MONTH_ID = {
  jan: "01", januari: "01", feb: "02", februari: "02", mar: "03", maret: "03",
  apr: "04", april: "04", mei: "05", jun: "06", juni: "06", jul: "07", juli: "07",
  agu: "08", agustus: "08", agt: "08", sep: "09", september: "09", okt: "10", oktober: "10",
  nov: "11", november: "11", des: "12", desember: "12",
};
function parseIDXDateToISO(s) {
  if (!s) return null;
  const raw = String(s).trim().replace(/\s+/g, " ");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = raw.split(" ");
  if (parts.length < 3) return null;
  const d = parts[0].padStart(2, "0");
  const m = MONTH_ID[parts[1].toLowerCase()] || MONTH_ID[parts[1].slice(0,3).toLowerCase()];
  if (!m) return null;
  return `${parts[2]}-${m}-${d}`;
}

/* =========================
   CSV Parser & Logic
========================= */
function parseCSV(text) {
  const rows = [], len = text.length;
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < len; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n') {
        row.push(field.replace(/\r$/, "")); field = "";
        if (row.some(v => v !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); if (row.some(v => v !== "")) rows.push(row); }
  return rows;
}

async function processBatchCsvFiles(files) {
  let allRows = [];
  let foundDates = new Set();
  
  for (const file of files) {
    const text = await file.text();
    const grid = parseCSV(text);
    if (grid.length < 2) continue;

    const header = grid[0].map(h => String(h || "").trim());
    const rawRows = grid.slice(1).map(cols => {
      const obj = {};
      header.forEach((h, i) => obj[h] = cols[i] ?? "");
      return obj;
    });

    const cleaned = rawRows
      .filter(r => r["Kode Saham"])
      .map(r => {
        const tradeDateISO = parseIDXDateToISO(r["Tanggal Perdagangan Terakhir"]);
        if (tradeDateISO) foundDates.add(tradeDateISO);
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
    
    allRows = allRows.concat(cleaned);
  }

  const sortedDates = Array.from(foundDates).sort();
  const latestDate = sortedDates[sortedDates.length - 1] || null;

  lastParsed = { tradeDateISO: latestDate, rows: allRows };

  const dateLabel = sortedDates.length > 1 ? `${sortedDates.length} Dates (Latest: ${latestDate})` : (latestDate || "-");
  elPillDate.textContent = `Date: ${dateLabel}`;
  elPillRows.textContent = `Total Rows: ${allRows.length.toLocaleString("id-ID")}`;
  
  elBtnUpload.disabled = allRows.length === 0;
  if(tempXlsxFiles.length === 0) elBtnConvert.disabled = true;

  return allRows.length;
}

/* =========================
   Event Handlers
========================= */
elFileInput.onchange = async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  tempXlsxFiles = files.filter(f => f.name.toLowerCase().endsWith(".xlsx"));
  const csvFiles = files.filter(f => f.name.toLowerCase().endsWith(".csv"));

  elBtnConvert.disabled = tempXlsxFiles.length === 0;
  elBtnUpload.disabled = true;
  elBtnAnalyze.disabled = true; 
  elPillStatus.textContent = "Status: Memeriksa file...";

  if (tempXlsxFiles.length > 0) {
    toast(`Terdeteksi: ${tempXlsxFiles.length} XLSX, ${csvFiles.length} CSV. Klik 'Convert' untuk memproses.`);
  } else {
    try {
      toast(`Membaca ${csvFiles.length} file CSV...`);
      const count = await processBatchCsvFiles(csvFiles);
      toast(`Siap upload (${count} baris data).`);
      if (count > 0) elBtnAnalyze.disabled = false;
    } catch(err) {
      console.error(err);
      toast("Gagal baca CSV: " + err.message, true);
    }
  }
};

elBtnConvert.onclick = async () => {
  if (!tempXlsxFiles.length) return;
  try {
    toast(`Sedang konversi ${tempXlsxFiles.length} file XLSX...`);
    const zip = new JSZip();
    const convertedCsvBlobs = [];
    for (const file of tempXlsxFiles) {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const csvOutput = XLSX.utils.sheet_to_csv(firstSheet);
      const csvName = file.name.replace(/\.xlsx$/i, ".csv");
      zip.file(csvName, csvOutput);
      convertedCsvBlobs.push(new File([csvOutput], csvName, { type: "text/csv" }));
    }
    const zipContent = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipContent);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Converted_Stocks_${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    toast("Memuat data hasil konversi...");
    const count = await processBatchCsvFiles(convertedCsvBlobs);
    toast("Konversi selesai & Data siap upload!");
    if(count > 0) elBtnAnalyze.disabled = false;
    
    tempXlsxFiles = []; 
    elBtnConvert.disabled = true;
  } catch (err) {
    console.error(err);
    toast("Gagal konversi batch: " + err.message, true);
  }
};

elBtnUpload.onclick = async () => {
  try {
    const { rows } = lastParsed;
    if (!rows.length) return;

    toast("Mengirim data ke Supabase...");
    await upsertSymbols(rows);
    await upsertPrices(rows);

    cachedSignals = []; 
    toast(`Upload sukses (${rows.length} baris).`);
    await refreshSignals();
  } catch(err) {
    console.error(err);
    toast("Upload gagal: " + err.message, true);
  }
};

elBtnAnalyze.onclick = async () => {
  try {
    let targetDate = lastParsed.tradeDateISO;
    if (!targetDate) targetDate = latestDbDate;
    
    if (!targetDate) {
      toast("Tidak ada tanggal untuk dianalisis.", true);
      return;
    }
    
    let symbols = [];
    if (lastParsed.rows.length > 0 && lastParsed.tradeDateISO === targetDate) {
       symbols = [...new Set(lastParsed.rows.map(r => r.symbol))];
    } else {
       toast(`Mengambil daftar simbol untuk ${targetDate}...`);
       const { data: symData, error } = await sb.from("prices_daily")
         .select("symbol")
         .eq("trade_date", targetDate);
       if(error) throw error;
       symbols = symData.map(s => s.symbol);
    }
    
    if (symbols.length === 0) {
      toast("Tidak ada simbol ditemukan.", true);
      return;
    }

    // FIX: Batch processing in UI to calculate percentage
    toast(`Analisis ${symbols.length} saham (Lookback 160 hari). Mohon tunggu...`);
    
    // Fetch History & Score in larger batches to save memory but fetch from DB in small chunks
    // To keep it simple: Fetch ALL history first (with small DB chunks), then process.
    
    const history = await fetchHistoryForSymbols(symbols, targetDate, 160);

    toast("Menghitung skor swing...");
    
    const bySym = new Map();
    history.forEach(r => {
      if (!bySym.has(r.symbol)) bySym.set(r.symbol, []);
      const fNet = (Number(r.foreign_buy) || 0) - (Number(r.foreign_sell) || 0);
      bySym.get(r.symbol).push({ ...r, foreign_net: fNet });
    });

    const out = [];
    for (const [sym, series] of bySym.entries()) {
      series.sort((a,b) => a.trade_date.localeCompare(b.trade_date));
      if (series[series.length - 1]?.trade_date !== targetDate) continue;

      const res = scoreSwing(series);
      const safe = (val) => (val === null || val === undefined || !Number.isFinite(val)) ? null : val;

      out.push({
        trade_date: targetDate,
        symbol: sym,
        strategy: "SWING_V1",
        signal: res.signal,
        score: res.score,
        reasons: res.reasons,
        close: safe(res.metrics.close), 
        rsi14: safe(res.metrics.rsi14), 
        ma20: safe(res.metrics.ma20), 
        ma50: safe(res.metrics.ma50),
        atr14: safe(res.metrics.atr14), 
        vol_ratio: safe(res.metrics.vol_ratio),
        foreign_net: safe(res.metrics.foreign_net)
      });
    }

    toast(`Menyimpan ${out.length} sinyal...`);
    await upsertSignals(out);
    
    cachedSignals = [];
    toast("Analisis selesai.");
    await refreshSignals();
  } catch(err) {
    console.error(err);
    toast("Analisis gagal: " + err.message, true);
  }
};

/* =========================
   Supabase Ops
========================= */
async function upsertSymbols(rows) {
  const unique = new Map();
  rows.forEach(r => unique.set(r.symbol, { symbol: r.symbol, name: r.name }));
  const { error } = await sb.from("symbols").upsert([...unique.values()], { onConflict: "symbol" });
  if (error) throw error;
}

async function upsertPrices(rows) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK).map(r => ({
      trade_date: r.trade_date, 
      symbol: r.symbol,
      name: r.name,          
      prev: r.prev,          
      open: r.open, 
      high: r.high, 
      low: r.low, 
      close: r.close,
      chg: r.chg,            
      volume: r.volume,
      value: r.value,        
      freq: r.freq,          
      foreign_buy: r.foreign_buy || 0,
      foreign_sell: r.foreign_sell || 0
    }));
    const { error } = await sb.from("prices_daily").upsert(part, { onConflict: "trade_date,symbol" });
    if (error) throw error;
  }
}

async function upsertSignals(signalRows) {
  const CHUNK = 500;
  for (let i = 0; i < signalRows.length; i += CHUNK) {
    const { error } = await sb.from("signals_daily").upsert(signalRows.slice(i, i + CHUNK), { onConflict: "trade_date,symbol,strategy" });
    if (error) throw error;
  }
}

// CRITICAL FIX: Fetch in small chunks to avoid API row limits
async function fetchHistoryForSymbols(symbols, endDateISO, lookbackDays) {
  const start = new Date(endDateISO);
  start.setDate(start.getDate() - lookbackDays);
  const startISO = start.toISOString().slice(0, 10);
  
  let all = [];
  // Reduce chunk size to 5 symbols. 
  // 5 symbols * 160 days = 800 rows. Safe below 1000 limit.
  const CHUNK = 5; 
  
  for(let i=0; i<symbols.length; i+=CHUNK){
    // Update progress UI
    if (i % 50 === 0) {
      const pct = Math.round((i / symbols.length) * 100);
      toast(`Mengambil data histori: ${pct}%...`);
    }

    const { data, error } = await sb.from("prices_daily")
      .select("trade_date,symbol,open,high,low,close,volume,foreign_buy,foreign_sell")
      .in("symbol", symbols.slice(i, i+CHUNK))
      .gte("trade_date", startISO).lte("trade_date", endDateISO)
      .order("trade_date", {ascending: true});
      
    if(error) throw error;
    if(data) all = all.concat(data);
  }
  return all;
}

async function fetchLatestTradeDate() {
  const { data: pData } = await sb.from("prices_daily").select("trade_date").order("trade_date", {ascending:false}).limit(1);
  return pData?.[0]?.trade_date;
}

async function fetchSignalsLatest(dateISO) {
  const { data, error } = await sb.from("signals_daily")
    .select("symbol,signal,score,reasons,close,rsi14,ma20,ma50,vol_ratio,foreign_net")
    .eq("trade_date", dateISO).eq("strategy", "SWING_V1")
    .order("score", { ascending: false }).limit(2000);
  if (error) throw error;
  return data || [];
}

/* =========================
   Indicators & Scoring
========================= */
function SMA(v, p) {
  const out = new Array(v.length).fill(null);
  let sum=0;
  for(let i=0;i<v.length;i++){
    sum+=v[i];
    if(i>=p) sum-=v[i-p];
    if(i>=p-1) out[i]=sum/p;
  }
  return out;
}
function rollingMax(v, p) {
  const out = new Array(v.length).fill(null);
  for(let i=0;i<v.length;i++){
    if(i<p-1) continue;
    let m=-Infinity;
    for(let j=i-p+1;j<=i;j++) m=Math.max(m, v[j]);
    out[i]=m;
  }
  return out;
}
function RSI(vals, p=14){
  const out=new Array(vals.length).fill(null);
  let g=0, l=0;
  for(let i=1;i<=p;i++){ const d=vals[i]-vals[i-1]; if(d>0)g+=d; else l-=d; }
  g/=p; l/=p; out[p] = l===0?100:100-(100/(1+g/l));
  for(let i=p+1;i<vals.length;i++){
    const d=vals[i]-vals[i-1];
    g=(g*(p-1)+(d>0?d:0))/p; l=(l*(p-1)+(d<0?-d:0))/p;
    out[i]=l===0?100:100-(100/(1+g/l));
  }
  return out;
}
function ATR(h,l,c,p=14){
  const tr=h.map((val,i)=>i===0?val-l[i]:Math.max(val-l[i], Math.abs(val-c[i-1]), Math.abs(l[i]-c[i-1])));
  const out=new Array(c.length).fill(null);
  let s=0; for(let i=0;i<p;i++)s+=tr[i]; out[p-1]=s/p;
  for(let i=p;i<c.length;i++) out[i]=(out[i-1]*(p-1)+tr[i])/p;
  return out;
}

function scoreSwing(series) {
  const i = series.length - 1;
  const last = series[i], prev = series[i-1];
  const C = last.close, V = last.volume || 0, FNET = last.foreign_net || 0;
  
  const ma20 = SMA(series.map(x=>x.close), 20);
  const ma50 = SMA(series.map(x=>x.close), 50);
  const rsi = RSI(series.map(x=>x.close), 14);
  const atr = ATR(series.map(x=>x.high), series.map(x=>x.low), series.map(x=>x.close), 14);
  const vma = SMA(series.map(x=>x.volume||0), 20);
  const hh20 = rollingMax(series.map(x=>x.high), 20);

  const M20=ma20[i], M50=ma50[i], R=rsi[i], A=atr[i], VM=vma[i], H20=hh20[i];
  const VR = (VM && VM>0) ? V/VM : 0;
  
  if(!R || !A) {
    return { 
      signal: "WAIT", 
      score: 0, 
      reasons: [`Data terlalu sedikit (${series.length} hari). Butuh min 14 hari.`], 
      metrics: { close:C, rsi14:R, ma20:M20, ma50:M50, atr14:A, vol_ratio:VR, foreign_net:FNET } 
    };
  }

  let sc = 0, rs = [];
  // Adaptive: Calculate score even if MA50 is missing
  if (M50) {
    if(C>M50) { sc+=15; rs.push("Uptrend (>MA50)"); }
    if(M20 && M20>M50) { sc+=10; rs.push("MA20>MA50"); }
  }
  
  if(R>=45 && R<=70) { sc+=15; rs.push("RSI Sehat"); }
  else if(R>70) { sc-=8; rs.push("RSI Overbought"); }
  else if(R<40) { sc-=10; rs.push("RSI Weak"); }

  if(H20 && C >= H20*0.995) { sc+=20; rs.push("Near Breakout"); }

  if(VR >= 1.3) { sc+=15; rs.push(`Vol Kuat (${VR.toFixed(1)}x)`); }
  else if(VR < 0.8) { sc-=6; }

  if(FNET > 0) { sc+=10; rs.push("Net Buy Asing"); }
  else if(FNET < 0) { sc-=5; }

  if (prev && C > prev.close) { sc+=3; }

  let sig = "WAIT";
  if(sc>=65) sig="BUY"; else if(sc<=30) sig="SELL";
  if(M20 && C<M20 && R<45) { sig="SELL"; rs.unshift("Breakdown MA20"); }

  return { signal: sig, score: Math.max(0, Math.min(100, Math.round(sc))), reasons: rs, metrics: { close:C, rsi14:R, ma20:M20, ma50:M50, atr14:A, vol_ratio:VR, foreign_net:FNET } };
}

/* =========================
   Render & Init
========================= */
function parseReasons(r) {
  if (Array.isArray(r)) return r;
  if (typeof r === 'string') {
    try { return JSON.parse(r); } catch { return [r]; }
  }
  return [];
}

function renderSignals(rows) {
  const thead = elSignals.querySelector("thead");
  thead.innerHTML = "<tr>" + COLS.map(c => `<th class="sortable" onclick="setSort('${c.key}');renderSignals(cachedSignals)">${c.label} ${sortBadgeFor(c.key)}</th>`).join("") + "</tr>";
  
  let d = rows.filter(r => (elFilterSignal.value==="ALL" || r.signal===elFilterSignal.value) && (!elSearch.value || r.symbol.toLowerCase().includes(elSearch.value.toLowerCase())));
  const col = COLS.find(c=>c.key===sortKey) || COLS[2];
  if(sortDir!==0) d.sort((a,b)=>cmp(a,b,col)*sortDir);

  elSignals.querySelector("tbody").innerHTML = d.map(r => {
    const reasonsList = parseReasons(r.reasons);
    const reasonsStr = reasonsList.join(", ");
    return `
    <tr>
      <td class="mono">${escapeHtml(r.symbol)}</td>
      <td><span class="badge ${r.signal.toLowerCase()}">${r.signal}</span></td>
      <td class="mono">${fmt(r.score)}</td>
      <td class="mono">${fmt(r.close)}</td>
      <td class="mono">${fmt2(r.rsi14)}</td>
      <td class="mono">${fmt2(r.ma20)}</td>
      <td class="mono">${fmt2(r.ma50)}</td>
      <td class="mono">${fmt2(r.vol_ratio)}</td>
      <td class="mono">${fmt(r.foreign_net)}</td>
      <td title="${escapeHtml(reasonsStr)}">${escapeHtml(reasonsStr.slice(0, 50))}${reasonsStr.length>50?'...':''}</td>
    </tr>`;
  }).join("") || "<tr><td colspan='10' class='dim'>No data found for this date.</td></tr>";
}

async function refreshSignals(){
  try {
    let d = lastParsed.tradeDateISO; 
    if (!d) {
      latestDbDate = await fetchLatestTradeDate();
      d = latestDbDate;
    }
    
    if (d) {
       elBtnAnalyze.disabled = false;
       latestDbDate = d;
    }

    if(!d){ toast("Belum ada data."); return; }
    
    elPillDate.textContent = `Date: ${d}`;
    toast(`Memuat sinyal tanggal: ${d}...`);
    
    cachedSignals = await fetchSignalsLatest(d);
    
    if (cachedSignals.length > 0) {
      toast(`Berhasil memuat ${cachedSignals.length} baris.`);
    } else {
      toast(`Data ada (${d}), tapi belum dianalisis. Klik 'Analisis Swing'.`, true);
    }
    
    renderSignals(cachedSignals);
  } catch(e) { 
    console.error(e); 
    toast("Error: " + e.message, true);
  }
}

elSearch.oninput = () => renderSignals(cachedSignals);
elFilterSignal.onchange = () => renderSignals(cachedSignals);

toast("Siap. Klik 'Analisis Swing' untuk hitung ulang data DB.");
refreshSignals();
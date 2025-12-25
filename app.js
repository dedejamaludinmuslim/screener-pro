/* =========================================================
   Swing Signals Pro - Logic Core
========================================================= */

const SUPABASE_URL = "https://pbhfwdbgoejduzjvezrk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiaGZ3ZGJnb2VqZHV6anZlenJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1NjMxNzEsImV4cCI6MjA4MjEzOTE3MX0.JUoaKbT29HMZUhGjUbT4yj9MF0sn4gjzUOs9mKLM-nw";

if (!window.supabase) throw new Error("Supabase library not found.");
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* UI Helpers */
const $ = (id) => document.getElementById(id);

// --- MOBILE MENU LOGIC ---
const elSidebar = $("sidebar");
const btnMobileMenu = $("btnMobileMenu");
const btnCloseMenu = $("btnCloseMenu");

if(btnMobileMenu) {
  btnMobileMenu.onclick = () => elSidebar.classList.add("active");
}
if(btnCloseMenu) {
  btnCloseMenu.onclick = () => elSidebar.classList.remove("active");
}
// Close sidebar when clicking outside on mobile (optional UX improvement)
document.addEventListener('click', (e) => {
  if (window.innerWidth <= 768 && elSidebar.classList.contains('active') && 
      !elSidebar.contains(e.target) && !btnMobileMenu.contains(e.target)) {
    elSidebar.classList.remove('active');
  }
});
// -------------------------

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
const elFilterCategory = $("filterCategory");
const elScoreSlider = $("scoreSlider");
const elScoreVal = $("scoreVal");

// Login UI Elements
const elBtnLogin = $("btnLogin");
const elBtnLogout = $("btnLogout");
const elModal = $("loginModal");
const elAdminControls = $("adminControls");

let lastParsed = { tradeDateISO: null, rows: [], type: 'price' };
let cachedSignals = [];
let symbolMeta = {}; 
let tempXlsxFiles = []; 
let latestDbDate = null; 

// AUTH STATE
let isLoggedIn = false;

/* --- AUTH LOGIC --- */
function checkAuth() {
  const sess = localStorage.getItem("swing_auth");
  isLoggedIn = sess === "true";
  updateUIState();
}

function updateUIState() {
  if (isLoggedIn) {
    // --- ADMIN MODE ---
    elAdminControls.style.display = "block"; // Changed from flex to block for new css
    elBtnLogin.style.display = "none";
    elBtnLogout.style.display = "flex";
    elScoreSlider.max = "95"; 
    elFilterSignal.disabled = false;
  } else {
    // --- PUBLIC MODE ---
    elAdminControls.style.display = "none";
    elBtnLogin.style.display = "flex";
    elBtnLogout.style.display = "none";
    
    elScoreSlider.max = "30"; 
    if (parseInt(elScoreSlider.value) > 30) {
      elScoreSlider.value = 0;
      elScoreVal.textContent = "0";
    }
    elFilterSignal.value = "ALL";
    // Keep filter enabled for UX, just limit results if needed, but per request disabled:
    // elFilterSignal.disabled = true; 
  }
  renderSignals(cachedSignals);
}

elBtnLogin.onclick = () => elModal.style.display = "flex";
$("btnCloseLogin").onclick = () => elModal.style.display = "none";
elBtnLogout.onclick = () => {
  localStorage.removeItem("swing_auth");
  isLoggedIn = false;
  toast("Berhasil Logout.");
  updateUIState();
};

$("btnSubmitLogin").onclick = async () => {
  const u = $("username").value;
  const p = $("password").value;
  toast("Verifying...");
  const { data } = await sb.from("users").select("*").eq("username", u).eq("password", p).single();
  if (data) {
    localStorage.setItem("swing_auth", "true");
    isLoggedIn = true;
    elModal.style.display = "none";
    $("username").value = ""; $("password").value = "";
    toast("Welcome Admin!");
    updateUIState();
  } else {
    toast("Access Denied", true);
  }
};

/* WATCHLIST */
function getWatchlist() { try { return JSON.parse(localStorage.getItem("swing_watchlist")) || {}; } catch { return {}; } }
function toggleWatchlist(symbol) {
  const wl = getWatchlist();
  const today = new Date().toISOString().slice(0,10);
  if (wl[symbol]) delete wl[symbol]; else wl[symbol] = today;
  localStorage.setItem("swing_watchlist", JSON.stringify(wl));
  renderSignals(cachedSignals);
}

/* Sorting & Columns */
let sortKey = "score";
let sortDir = -1;

const COLS = [
  { key: "wl", label: "", type: "text", className: "col-star" }, // Removed Label for cleaner UI
  { key: "symbol", label: "Symbol", type: "text", className: "col-symbol text-left" },
  { key: "close", label: "Price", type: "num" },
  { key: "rsi14", label: "RSI", type: "num" },
  { key: "ma20", label: "MA20", type: "num" },
  { key: "ma50", label: "MA50", type: "num" },
  { key: "vol_ratio", label: "Vol Ratio", type: "num" },
  { key: "foreign_net", label: "N. Foreign", type: "num" },
  // LOCKED COLUMNS
  { key: "sector", label: "Sector", type: "text" },
  { key: "score", label: "Score", type: "num", locked: true },
  { key: "signal", label: "Action", type: "text", locked: true },
  { key: "reasons", label: "Analysis", type: "text", locked: true, className: "col-reasons" },
];

function sortBadgeFor(key){ if (sortKey !== key) return ""; return sortDir === 1 ? "▲" : "▼"; }

function setSort(key){ 
  const colDef = COLS.find(c => c.key === key);
  if (!isLoggedIn && colDef && colDef.locked) { toast("Admin Access Required", true); return; }
  if (sortKey !== key){ sortKey = key; sortDir = -1; return; } 
  sortDir = sortDir === -1 ? 1 : (sortDir === 1 ? 0 : -1); 
}

function cmp(a, b, col){
  if (col.key === "wl") { const wl = getWatchlist(); return (wl[a.symbol]?1:0) - (wl[b.symbol]?1:0); }
  if (col.key === "sector") { const sa = symbolMeta[a.symbol]?.sector || "ZZ"; const sb = symbolMeta[b.symbol]?.sector || "ZZ"; return sa.localeCompare(sb); }
  const av = a[col.key], bv = b[col.key];
  if (col.key === "reasons") return String(av).localeCompare(String(bv));
  if (col.type === "num"){ return Number(av || 0) - Number(bv || 0); }
  return String(av ?? "").localeCompare(String(bv ?? ""));
}

function toast(msg, bad=false){ 
  elPillStatus.textContent = msg; 
  elPillStatus.style.color = bad ? "#ef4444" : "#00b4a7"; // Updated colors
}
function fmt(x){ return (typeof x === "number" && Number.isFinite(x)) ? x.toLocaleString("id-ID") : "-"; }
function fmt2(x){ const n = Number(x); return Number.isFinite(n) ? n.toFixed(2) : "-"; }
function escapeHtml(str){ return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function num(x) { const n = Number(String(x || "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
function int(x) { return Math.trunc(num(x) || 0); }

/* --- CSV & PARSING --- */
const MONTH_ID = { jan: "01", januari: "01", feb: "02", februari: "02", mar: "03", maret: "03", apr: "04", april: "04", mei: "05", jun: "06", juni: "06", jul: "07", juli: "07", agu: "08", agustus: "08", agt: "08", sep: "09", september: "09", okt: "10", oktober: "10", nov: "11", november: "11", des: "12", desember: "12" };
function parseIDXDateToISO(s) { if (!s) return null; const raw = String(s).trim().replace(/\s+/g, " "); if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw; const parts = raw.split(" "); if (parts.length < 3) return null; const d = parts[0].padStart(2, "0"); const m = MONTH_ID[parts[1].toLowerCase()] || MONTH_ID[parts[1].slice(0,3).toLowerCase()]; if (!m) return null; return `${parts[2]}-${m}-${d}`; }
function parseCSV(text) { const rows = [], len = text.length; let row = [], field = "", inQuotes = false; for (let i = 0; i < len; i++) { const c = text[i]; if (inQuotes) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; } else field += c; } else { if (c === '"') inQuotes = true; else if (c === ',') { row.push(field); field = ""; } else if (c === '\n') { row.push(field.replace(/\r$/, "")); field = ""; if (row.some(v => v !== "")) rows.push(row); row = []; } else field += c; } } if (field || row.length) { row.push(field.replace(/\r$/, "")); if (row.some(v => v !== "")) rows.push(row); } return rows; }

async function processBatchFiles(files) {
  let allRows = [], foundDates = new Set();
  let detectedType = null;
  for (const file of files) {
    const text = await file.text(); const grid = parseCSV(text); if (grid.length < 2) continue;
    const header = grid[0].map(h => String(h || "").trim().toLowerCase());
    if (header.includes("sektor") || header.includes("index")) {
      detectedType = 'meta';
      const rawRows = grid.slice(1).map(cols => { const obj = {}; grid[0].forEach((h, i) => obj[String(h).trim()] = cols[i] ?? ""); return obj; });
      const metaRows = rawRows.filter(r => r["Kode Saham"]).map(r => {
        const idxStr = (r["Index"] || "").toUpperCase();
        return { symbol: String(r["Kode Saham"]).trim(), name: r["Nama Perusahaan"] || null, sector: r["Sektor"] || "Lainnya", is_sharia: idxStr.includes("ISSI") || idxStr.includes("JII") || idxStr.includes("DES") };
      });
      allRows = allRows.concat(metaRows);
    } else if (header.includes("close") || header.includes("penutupan")) {
      detectedType = 'price';
      const rawRows = grid.slice(1).map(cols => { const obj = {}; grid[0].forEach((h, i) => obj[String(h).trim()] = cols[i] ?? ""); return obj; });
      const priceRows = rawRows.filter(r => r["Kode Saham"]).map(r => {
        const tradeDateISO = parseIDXDateToISO(r["Tanggal Perdagangan Terakhir"]); if (tradeDateISO) foundDates.add(tradeDateISO);
        return { trade_date: tradeDateISO, symbol: String(r["Kode Saham"]).trim(), name: r["Nama Perusahaan"] ? String(r["Nama Perusahaan"]).trim() : null, prev: num(r["Sebelumnya"]), open: num(r["Open Price"]), high: num(r["Tertinggi"]), low: num(r["Terendah"]), close: num(r["Penutupan"]), chg: num(r["Selisih"]), volume: int(r["Volume"]), value: num(r["Nilai"]), freq: int(r["Frekuensi"]), foreign_buy: int(r["Foreign Buy"]), foreign_sell: int(r["Foreign Sell"]) };
      }).filter(r => r.trade_date);
      allRows = allRows.concat(priceRows);
    }
  }
  lastParsed = { rows: allRows, type: detectedType };
  if (detectedType === 'price') {
    const sortedDates = Array.from(foundDates).sort(); const latestDate = sortedDates[sortedDates.length - 1] || null; lastParsed.tradeDateISO = latestDate; elPillDate.textContent = latestDate || "-"; elPillRows.textContent = allRows.length.toLocaleString(); toast(`Loaded Prices (${allRows.length})`);
  } else if (detectedType === 'meta') {
    elPillDate.textContent = "METADATA"; elPillRows.textContent = allRows.length.toLocaleString(); toast(`Loaded Sectors (${allRows.length})`);
  } else toast("Format Unknown", true);
  elBtnUpload.disabled = allRows.length === 0; if(tempXlsxFiles.length === 0) elBtnConvert.disabled = true;
  return allRows.length;
}

elFileInput.onchange = async (e) => {
  const files = Array.from(e.target.files || []); if (!files.length) return;
  tempXlsxFiles = files.filter(f => f.name.toLowerCase().endsWith(".xlsx")); const csvFiles = files.filter(f => f.name.toLowerCase().endsWith(".csv"));
  elBtnConvert.disabled = tempXlsxFiles.length === 0; elBtnUpload.disabled = true; elBtnAnalyze.disabled = true; toast("Reading...");
  if (tempXlsxFiles.length > 0) toast(`${tempXlsxFiles.length} XLSX found. Click Convert.`); else { try { await processBatchFiles(csvFiles); } catch(err) { console.error(err); toast("CSV Error", true); } }
};
elBtnConvert.onclick = async () => { if (!tempXlsxFiles.length) return; try { toast(`Converting...`); const zip = new JSZip(); const convertedCsvBlobs = []; for (const file of tempXlsxFiles) { const data = await file.arrayBuffer(); const workbook = XLSX.read(data); const firstSheet = workbook.Sheets[workbook.SheetNames[0]]; const csvOutput = XLSX.utils.sheet_to_csv(firstSheet); const csvName = file.name.replace(/\.xlsx$/i, ".csv"); zip.file(csvName, csvOutput); convertedCsvBlobs.push(new File([csvOutput], csvName, { type: "text/csv" })); } const zipContent = await zip.generateAsync({ type: "blob" }); const url = URL.createObjectURL(zipContent); const a = document.createElement("a"); a.href = url; a.download = `Converted_${new Date().toISOString().slice(0,10)}.zip`; document.body.appendChild(a); a.click(); document.body.removeChild(a); await processBatchFiles(convertedCsvBlobs); tempXlsxFiles = []; elBtnConvert.disabled = true; } catch (err) { console.error(err); toast("Convert Failed", true); } };
elBtnUpload.onclick = async () => { try { const { rows, type } = lastParsed; if (!rows.length) return; if (type === 'meta') { toast("Updating Sectors..."); await sb.from("symbols").upsert(rows, { onConflict: "symbol" }); toast("Sectors Updated!"); await loadMetadata(); } else { toast("Uploading Prices..."); await upsertSymbols(rows); await upsertPrices(rows); toast("Prices Updated."); } elBtnUpload.disabled = true; if (type === 'price') await refreshSignals(); } catch(err) { console.error(err); toast("Upload Failed", true); } };
elBtnAnalyze.onclick = async () => { try { let targetDate = lastParsed.tradeDateISO; if (!targetDate) targetDate = latestDbDate; if (!targetDate) { toast("No Date", true); return; } let symbols = []; const { data } = await sb.from("prices_daily").select("symbol").eq("trade_date", targetDate); symbols = data.map(s => s.symbol); if (symbols.length === 0) { toast("No symbols", true); return; } toast(`Analyzing ${symbols.length}...`); const history = await fetchHistoryForSymbols(symbols, targetDate, 160); toast("Scoring..."); const bySym = new Map(); history.forEach(r => { if (!bySym.has(r.symbol)) bySym.set(r.symbol, []); const fNet = (Number(r.foreign_buy) || 0) - (Number(r.foreign_sell) || 0); bySym.get(r.symbol).push({ ...r, foreign_net: fNet }); }); const out = []; for (const [sym, series] of bySym.entries()) { series.sort((a,b) => a.trade_date.localeCompare(b.trade_date)); if (series[series.length - 1]?.trade_date !== targetDate) continue; const res = scoreSwing(series); const safe = (val) => (val === null || val === undefined || !Number.isFinite(val)) ? null : val; out.push({ trade_date: targetDate, symbol: sym, strategy: "SWING_V1", signal: res.signal, score: res.score, reasons: res.reasons, close: safe(res.metrics.close), rsi14: safe(res.metrics.rsi14), ma20: safe(res.metrics.ma20), ma50: safe(res.metrics.ma50), atr14: safe(res.metrics.atr14), vol_ratio: safe(res.metrics.vol_ratio), foreign_net: safe(res.metrics.foreign_net) }); } toast(`Saving...`); await upsertSignals(out); cachedSignals = []; toast("Done."); await refreshSignals(); } catch(err) { console.error(err); toast("Analysis Error", true); } };
async function loadMetadata() { const { data } = await sb.from("symbols").select("symbol, sector, is_sharia"); if (data) { symbolMeta = {}; data.forEach(d => { symbolMeta[d.symbol] = d; }); } }

function renderSignals(rows) {
  const thead = elSignals.querySelector("thead");
  thead.innerHTML = "<tr>" + COLS.map(c => {
    const disabledClass = (!isLoggedIn && c.locked) ? "sort-disabled" : "";
    const onClick = (!isLoggedIn && c.locked) ? "" : `setSort('${c.key}');renderSignals(cachedSignals)`;
    const classes = [disabledClass, c.className || ""].join(" ");
    const label = c.key === 'wl' ? '<i data-lucide="star" size="14"></i>' : c.label;
    return `<th class="${classes}" onclick="${onClick}">${label} ${sortBadgeFor(c.key)}</th>`;
  }).join("") + "</tr>";
  
  const minScore = parseInt(elScoreSlider.value);
  const filterSig = elFilterSignal.value;
  const filterCat = elFilterCategory.value;
  const searchTerm = elSearch.value.toLowerCase();
  const watchlist = getWatchlist();
  const todayISO = new Date().toISOString().slice(0,10);

  let d = rows.filter(r => {
    if (searchTerm && !r.symbol.toLowerCase().includes(searchTerm)) return false;
    if (filterSig === "WATCHLIST") { if (!watchlist[r.symbol]) return false; } 
    else if (filterSig !== "ALL" && r.signal !== filterSig) return false;
    const meta = symbolMeta[r.symbol] || { is_sharia: false };
    if (filterCat === "SHARIA" && !meta.is_sharia) return false;
    if (filterCat === "NON" && meta.is_sharia) return false;
    if (r.score < minScore) return false;
    return true;
  });

  const col = COLS.find(c=>c.key===sortKey) || COLS[9]; 
  if(sortDir!==0) d.sort((a,b)=>cmp(a,b,col)*sortDir);

  elSignals.querySelector("tbody").innerHTML = d.map(r => {
    const reasonsList = parseReasons(r.reasons);
    const reasonsStr = reasonsList.join(", ");
    const isWl = !!watchlist[r.symbol];
    const isNew = isWl && (watchlist[r.symbol] === todayISO || watchlist[r.symbol] === latestDbDate);
    const meta = symbolMeta[r.symbol] || { sector: "-", is_sharia: false };
    const shariaBadge = meta.is_sharia ? '<span title="Sharia" style="cursor:help;">🕌</span>' : '';

    const lockIcon = `<i data-lucide="lock" class="locked-icon"></i>`;
    
    // Display Logic
    const scoreClass = r.score >= 80 ? "score-high" : "";
    const displayScore = isLoggedIn ? `<span class="${scoreClass}">${fmt(r.score)}</span>` : lockIcon;
    const displaySignal = isLoggedIn ? `<span class="badge ${r.signal.toLowerCase()}">${r.signal}</span>` : lockIcon;
    
    let displayReasons, reasonsClass;
    if (isLoggedIn) {
        displayReasons = `<span>${escapeHtml(reasonsStr)}</span>`;
        reasonsClass = "col-reasons text-left"; 
    } else {
        displayReasons = lockIcon;
        reasonsClass = "col-reasons text-center"; 
    }

    return `
    <tr>
      <td class="col-star">
        <button class="star-btn ${isWl?'active':''}" onclick="toggleWatchlist('${r.symbol}')">★</button>
        ${isNew ? '<span class="new-tag">NEW</span>' : ''}
      </td>
      <td class="col-symbol mono">${escapeHtml(r.symbol)} ${shariaBadge}</td>
      
      <td class="mono">${fmt(r.close)}</td>
      <td class="mono">${fmt2(r.rsi14)}</td>
      <td class="mono">${fmt2(r.ma20)}</td>
      <td class="mono">${fmt2(r.ma50)}</td>
      <td class="mono">${fmt2(r.vol_ratio)}</td>
      <td class="mono">${fmt(r.foreign_net)}</td>

      <td style="font-size:11px; color:var(--text-muted)">${escapeHtml(meta.sector)}</td>
      
      <td class="mono text-center">${displayScore}</td>
      <td class="text-center">${displaySignal}</td>
      <td class="${reasonsClass}">${displayReasons}</td>
    </tr>`;
  }).join("") || "<tr><td colspan='12' style='text-align:center; padding:30px; color:var(--text-muted)'>No Data Found</td></tr>";

  // Re-initialize icons
  if(window.lucide) window.lucide.createIcons();
}

/* Shared */
elScoreSlider.oninput = (e) => { if (!isLoggedIn && e.target.value > 30) e.target.value = 30; elScoreVal.textContent = e.target.value; renderSignals(cachedSignals); };
elSearch.oninput = () => renderSignals(cachedSignals);
elFilterSignal.onchange = () => renderSignals(cachedSignals);
elFilterCategory.onchange = () => renderSignals(cachedSignals);
async function upsertSymbols(rows) { const unique = new Map(); rows.forEach(r => unique.set(r.symbol, { symbol: r.symbol, name: r.name })); await sb.from("symbols").upsert([...unique.values()], { onConflict: "symbol" }); }
async function upsertPrices(rows) { const CHUNK = 500; for (let i = 0; i < rows.length; i += CHUNK) { const part = rows.slice(i, i + CHUNK).map(r => ({ trade_date: r.trade_date, symbol: r.symbol, name: r.name, prev: r.prev, open: r.open, high: r.high, low: r.low, close: r.close, chg: r.chg, volume: r.volume, value: r.value, freq: r.freq, foreign_buy: r.foreign_buy || 0, foreign_sell: r.foreign_sell || 0 })); await sb.from("prices_daily").upsert(part, { onConflict: "trade_date,symbol" }); } }
async function upsertSignals(signalRows) { const CHUNK = 500; for (let i = 0; i < signalRows.length; i += CHUNK) { await sb.from("signals_daily").upsert(signalRows.slice(i, i + CHUNK), { onConflict: "trade_date,symbol,strategy" }); } }
async function fetchHistoryForSymbols(symbols, endDateISO, lookbackDays) { const start = new Date(endDateISO); start.setDate(start.getDate() - lookbackDays); const startISO = start.toISOString().slice(0, 10); let all = []; const CHUNK = 5; for(let i=0; i<symbols.length; i+=CHUNK){ if (i % 50 === 0) toast(`Fetch: ${Math.round((i / symbols.length) * 100)}%`); const { data } = await sb.from("prices_daily").select("trade_date,symbol,open,high,low,close,volume,foreign_buy,foreign_sell").in("symbol", symbols.slice(i, i+CHUNK)).gte("trade_date", startISO).lte("trade_date", endDateISO).order("trade_date", {ascending: true}); if(data) all = all.concat(data); } return all; }
async function fetchLatestTradeDate() { const { data } = await sb.from("prices_daily").select("trade_date").order("trade_date", {ascending:false}).limit(1); return data?.[0]?.trade_date; }
async function fetchSignalsLatest(dateISO) { const { data } = await sb.from("signals_daily").select("symbol,signal,score,reasons,close,rsi14,ma20,ma50,vol_ratio,foreign_net").eq("trade_date", dateISO).eq("strategy", "SWING_V1").order("score", { ascending: false }).limit(2000); return data || []; }
function parseReasons(r) { if (Array.isArray(r)) return r; if (typeof r === 'string') { try { return JSON.parse(r); } catch { return [r]; } } return []; }
function SMA(v, p) { const out = new Array(v.length).fill(null); let sum=0; for(let i=0;i<v.length;i++){ sum+=v[i]; if(i>=p) sum-=v[i-p]; if(i>=p-1) out[i]=sum/p; } return out; }
function rollingMax(v, p) { const out = new Array(v.length).fill(null); for(let i=0;i<v.length;i++){ if(i<p-1) continue; let m=-Infinity; for(let j=i-p+1;j<=i;j++) m=Math.max(m, v[j]); out[i]=m; } return out; }
function RSI(vals, p=14){ const out=new Array(vals.length).fill(null); let g=0, l=0; for(let i=1;i<=p;i++){ const d=vals[i]-vals[i-1]; if(d>0)g+=d; else l-=d; } g/=p; l/=p; out[p] = l===0?100:100-(100/(1+g/l)); for(let i=p+1;i<vals.length;i++){ const d=vals[i]-vals[i-1]; g=(g*(p-1)+(d>0?d:0))/p; l=(l*(p-1)+(d<0?-d:0))/p; out[i]=l===0?100:100-(100/(1+g/l)); } return out; }
function ATR(h,l,c,p=14){ const tr=h.map((val,i)=>i===0?val-l[i]:Math.max(val-l[i], Math.abs(val-c[i-1]), Math.abs(l[i]-c[i-1]))); const out=new Array(c.length).fill(null); let s=0; for(let i=0;i<p;i++)s+=tr[i]; out[p-1]=s/p; for(let i=p;i<c.length;i++) out[i]=(out[i-1]*(p-1)+tr[i])/p; return out; }
function scoreSwing(series) { const i=series.length-1, last=series[i], prev=series[i-1], C=last.close, V=last.volume||0, FNET=last.foreign_net||0; const ma20=SMA(series.map(x=>x.close),20), ma50=SMA(series.map(x=>x.close),50), rsi=RSI(series.map(x=>x.close),14), atr=ATR(series.map(x=>x.high),series.map(x=>x.low),series.map(x=>x.close),14), vma=SMA(series.map(x=>x.volume||0),20), hh20=rollingMax(series.map(x=>x.high),20); const M20=ma20[i], M50=ma50[i], R=rsi[i], A=atr[i], VM=vma[i], H20=hh20[i], VR=(VM&&VM>0)?V/VM:0; if(!R||!A) return { signal:"WAIT", score:0, reasons:["Need Data"], metrics:{close:C,rsi14:R,ma20:M20,ma50:M50,atr14:A,vol_ratio:VR,foreign_net:FNET} }; let sc=0, rs=[]; if(M50){ if(C>M50){sc+=15;rs.push("Uptrend");} if(M20&&M20>M50){sc+=10;rs.push("MA20>MA50");} } if(R>=45&&R<=70){sc+=15;rs.push("Good RSI");} else if(R>70)sc-=8; else if(R<40)sc-=10; if(H20&&C>=H20*0.995){sc+=20;rs.push("Breakout");} if(VR>=1.3){sc+=15;rs.push(`Vol ${VR.toFixed(1)}x`);} else if(VR<0.8)sc-=6; if(FNET>0){sc+=10;rs.push("Net Buy");} else if(FNET<0)sc-=5; if(prev&&C>prev.close)sc+=3; let sig="WAIT"; if(sc>=65)sig="BUY"; else if(sc<=30)sig="SELL"; if(M20&&C<M20&&R<45){sig="SELL";rs.unshift("CutLoss");} return { signal:sig, score:Math.max(0,Math.min(100,Math.round(sc))), reasons:rs, metrics:{close:C,rsi14:R,ma20:M20,ma50:M50,atr14:A,vol_ratio:VR,foreign_net:FNET} }; }
async function refreshSignals(){ try { checkAuth(); await loadMetadata(); let d = lastParsed.tradeDateISO; if (!d) { latestDbDate = await fetchLatestTradeDate(); d = latestDbDate; } if (d) { elBtnAnalyze.disabled = false; latestDbDate = d; } if(!d){ toast("Empty Data"); return; } elPillDate.textContent = d; toast(`Loading ${d}...`); cachedSignals = await fetchSignalsLatest(d); if (cachedSignals.length > 0) { toast(`Ready`); elPillRows.textContent = cachedSignals.length.toLocaleString(); } else { toast(`Ready to analyze`, true); elPillRows.textContent = "0"; } renderSignals(cachedSignals); } catch(e) { console.error(e); toast("Load Error", true); } }

toast("Init...");
refreshSignals();

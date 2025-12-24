/* ============================
   CONFIG
============================ */
const SUPABASE_URL = "https://ixrdpqxrudboxyjbkwwj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4cmRwcXhydWRib3h5amJrd3dqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1NjIwNjAsImV4cCI6MjA4MjEzODA2MH0.k-qcU0-gPDnvFfFsclT8hIul_HdboDwLaZJ86aIWS5c";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ============================
   DOM
============================ */
const loginPanel = document.getElementById("loginPanel");
const mainPanel  = document.getElementById("mainPanel");

const btnLogin  = document.getElementById("btnLogin");
const btnSignup = document.getElementById("btnSignup");
const btnLogout = document.getElementById("btnLogout");

const btnUpload  = document.getElementById("btnUpload");
const btnRefresh = document.getElementById("btnRefresh");
const fileInput  = document.getElementById("fileInput");

const styleSelect = document.getElementById("styleSelect");
const dateSelect  = document.getElementById("dateSelect");
const searchBox   = document.getElementById("searchBox");
const cardsEl     = document.getElementById("cards");
const footerNote  = document.getElementById("footerNote");

const tabs = Array.from(document.querySelectorAll(".tab"));

const modal = document.getElementById("modal");
const mSymbol = document.getElementById("mSymbol");
const mName = document.getElementById("mName");
const mWatchlist = document.getElementById("mWatchlist");
const mOwned = document.getElementById("mOwned");
const mBuyPrice = document.getElementById("mBuyPrice");
const mShares = document.getElementById("mShares");
const mNote = document.getElementById("mNote");
const btnSaveAsset = document.getElementById("btnSaveAsset");
const btnRemoveAsset = document.getElementById("btnRemoveAsset");

/* ============================
   STATE
============================ */
let state = {
  user: null,
  activeTab: "ALL",           // ALL | WATCHLIST | PORTFOLIO
  tradingStyle: "MODERAT",    // AGRESIF | MODERAT | KONSERVATIF
  selectedDate: null,
  search: "",

  signals: [],                // from v_signals
  assetsBySymbol: new Map(),  // from user_assets
  modalSymbol: null
};

/* ============================
   UTIL
============================ */
function fmtNum(x) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "-";
  const n = Number(x);
  if (!Number.isFinite(n)) return "-";
  // shorten big numbers
  if (Math.abs(n) >= 1e12) return (n/1e12).toFixed(2) + "T";
  if (Math.abs(n) >= 1e9)  return (n/1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6)  return (n/1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3)  return (n/1e3).toFixed(2) + "K";
  return n.toLocaleString("id-ID");
}

function fmtPct(x) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "-";
  const n = Number(x);
  const s = (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
  return s;
}

function badgeClass(label) {
  const u = String(label || "").toUpperCase();
  if (u.includes("STRONG") || u.includes("SAFE") || u === "BUY") return "good";
  if (u.includes("QUALIFIED") || u === "HOLD" || u === "NEUTRAL") return "warn";
  if (u.includes("AVOID") || u.includes("CUT")) return "bad";
  return "info";
}

function debounce(fn, ms=250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function parseIndoDate(s) {
  // contoh CSV: "19 Des 2025"
  if (!s) return null;
  const txt = String(s).trim();
  const parts = txt.split(/\s+/);
  if (parts.length < 3) return null;
  const dd = String(parts[0]).padStart(2, "0");
  const mon = parts[1].toLowerCase();
  const yyyy = parts[2];

  const map = {
    jan:"01", januari:"01",
    feb:"02", februari:"02",
    mar:"03", maret:"03",
    apr:"04", april:"04",
    mei:"05",
    jun:"06", juni:"06",
    jul:"07", juli:"07",
    agu:"08", agustus:"08",
    sep:"09", sept:"09", september:"09",
    okt:"10", oktober:"10",
    nov:"11", november:"11",
    des:"12", desember:"12"
  };

  const mm = map[mon] || map[mon.slice(0,3)];
  if (!mm) return null;
  return `${yyyy}-${mm}-${dd}`; // ISO date
}

function safeNum(x) {
  if (x === null || x === undefined) return null;
  const n = Number(String(x).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : null;
}

/* ============================
   AUTH FLOW
============================ */
async function refreshSession() {
  const { data } = await sb.auth.getSession();
  state.user = data?.session?.user || null;

  if (state.user) {
    loginPanel.classList.add("hidden");
    mainPanel.classList.remove("hidden");
    await ensureUserSettings();
    await loadDates();
    await loadAssets();
    await loadSignals();
    render();
  } else {
    loginPanel.classList.remove("hidden");
    mainPanel.classList.add("hidden");
  }
}

async function ensureUserSettings() {
  // create default row if missing
  const uid = state.user.id;
  const { data, error } = await sb
    .from("user_settings")
    .select("*")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) {
    console.error(error);
    return;
  }

  if (!data) {
    await sb.from("user_settings").insert({ user_id: uid, trading_style: "MODERAT" });
    styleSelect.value = "MODERAT";
    state.tradingStyle = "MODERAT";
  } else {
    styleSelect.value = data.trading_style || "MODERAT";
    state.tradingStyle = styleSelect.value;
  }
}

btnLogin.addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    btnLogin.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await refreshSession();
  } catch (e) {
    Swal.fire("Login gagal", e.message || String(e), "error");
  } finally {
    btnLogin.disabled = false;
  }
});

btnSignup.addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    btnSignup.disabled = true;
    const { error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    Swal.fire("Berhasil daftar", "Silakan login dengan akun tadi.", "success");
  } catch (e) {
    Swal.fire("Daftar gagal", e.message || String(e), "error");
  } finally {
    btnSignup.disabled = false;
  }
});

btnLogout.addEventListener("click", async () => {
  await sb.auth.signOut();
  state = { ...state, user: null, signals: [], assetsBySymbol: new Map() };
  await refreshSession();
});

/* ============================
   LOADERS
============================ */
async function loadDates() {
  const { data, error } = await sb
    .from("eod_raw")
    .select("trade_date")
    .order("trade_date", { ascending: false })
    .limit(60);

  if (error) {
    console.error(error);
    dateSelect.innerHTML = "";
    state.selectedDate = null;
    return;
  }

  const uniq = Array.from(new Set((data || []).map(x => x.trade_date))).filter(Boolean);
  dateSelect.innerHTML = uniq.map(d => `<option value="${d}">${d}</option>`).join("");

  state.selectedDate = uniq[0] || null;
  if (state.selectedDate) dateSelect.value = state.selectedDate;
}

async function loadSignals() {
  if (!state.selectedDate) return;

  const { data, error } = await sb
    .from("v_signals")
    .select("*")
    .eq("trade_date", state.selectedDate)
    .order("symbol", { ascending: true });

  if (error) {
    console.error(error);
    Swal.fire("Gagal load sinyal", error.message, "error");
    return;
  }
  state.signals = data || [];
}

async function loadAssets() {
  const { data, error } = await sb
    .from("user_assets")
    .select("*")
    .order("symbol", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const mp = new Map();
  (data || []).forEach(row => mp.set(row.symbol, row));
  state.assetsBySymbol = mp;
}

/* ============================
   CSV UPLOAD
============================ */
btnUpload.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    btnUpload.disabled = true;
    const rows = await parseCsvFile(file);
    if (!rows.length) {
      Swal.fire("CSV kosong", "Tidak ada baris data.", "warning");
      return;
    }

    const tradeDate = rows[0].trade_date;
    const confirm = await Swal.fire({
      title: "Upload EOD",
      text: `Terdeteksi trade_date: ${tradeDate}. Upsert ke database?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Ya, upload",
      cancelButtonText: "Batal"
    });

    if (!confirm.isConfirmed) return;

    await upsertEod(rows);
    await loadDates();
    await loadAssets();
    await loadSignals();
    render();

    Swal.fire("Sukses", `Upload ${rows.length} baris selesai.`, "success");
  } catch (err) {
    console.error(err);
    Swal.fire("Upload gagal", err.message || String(err), "error");
  } finally {
    btnUpload.disabled = false;
    fileInput.value = "";
  }
});

function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        try {
          const data = res.data || [];
          const mapped = data.map(mapCsvRow).filter(Boolean);

          // guard: pastikan semua tanggal sama (file ringkasan harian)
          const dates = new Set(mapped.map(x => x.trade_date));
          if (dates.size > 1) {
            console.warn("Multi trade_date detected:", Array.from(dates));
          }
          resolve(mapped);
        } catch (e) {
          reject(e);
        }
      },
      error: reject
    });
  });
}

function mapCsvRow(r) {
  // sesuai kolom dari CSV kamu
  const trade_date = parseIndoDate(r["Tanggal Perdagangan Terakhir"]);
  const symbol = String(r["Kode Saham"] || "").trim();
  if (!trade_date || !symbol) return null;

  return {
    trade_date,
    symbol,
    name: r["Nama Perusahaan"] || null,
    remarks: r["Remarks"] || null,

    prev_close: safeNum(r["Sebelumnya"]),
    open_price: safeNum(r["Open Price"]),
    first_trade: safeNum(r["First Trade"]),
    high_price: safeNum(r["Tertinggi"]),
    low_price: safeNum(r["Terendah"]),
    close_price: safeNum(r["Penutupan"]),
    change_abs: safeNum(r["Selisih"]),

    volume: safeNum(r["Volume"]),
    value_traded: safeNum(r["Nilai"]),
    frequency: safeNum(r["Frekuensi"]),

    offer: safeNum(r["Offer"]),
    offer_volume: safeNum(r["Offer Volume"]),
    bid: safeNum(r["Bid"]),
    bid_volume: safeNum(r["Bid Volume"]),

    listed_shares: safeNum(r["Listed Shares"]),
    tradable_shares: safeNum(r["Tradeble Shares"]),
    weight_for_index: safeNum(r["Weight For Index"]),

    foreign_sell: safeNum(r["Foreign Sell"]),
    foreign_buy: safeNum(r["Foreign Buy"]),

    non_regular_volume: safeNum(r["Non Regular Volume"]),
    non_regular_value: safeNum(r["Non Regular Value"]),
    non_regular_frequency: safeNum(r["Non Regular Frequency"]),
  };
}

async function upsertEod(rows) {
  // chunk biar aman
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb
      .from("eod_raw")
      .upsert(chunk, { onConflict: "trade_date,symbol" });

    if (error) throw error;
  }
}

/* ============================
   UI EVENTS (stabil: single listener, no double binding)
============================ */
btnRefresh.addEventListener("click", async () => {
  btnRefresh.disabled = true;
  try {
    await loadDates();
    await loadAssets();
    await loadSignals();
    render();
  } finally {
    btnRefresh.disabled = false;
  }
});

tabs.forEach(t => {
  t.addEventListener("click", async () => {
    tabs.forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    state.activeTab = t.dataset.tab;
    render();
  });
});

styleSelect.addEventListener("change", async () => {
  state.tradingStyle = styleSelect.value;
  // simpan ke settings
  const { error } = await sb
    .from("user_settings")
    .upsert({ user_id: state.user.id, trading_style: state.tradingStyle });

  if (error) console.error(error);
  render();
});

dateSelect.addEventListener("change", async () => {
  state.selectedDate = dateSelect.value;
  await loadSignals();
  render();
});

searchBox.addEventListener("input", debounce(() => {
  state.search = searchBox.value.trim().toLowerCase();
  render();
}, 180));

document.addEventListener("click", (e) => {
  const close = e.target?.dataset?.close;
  if (close) hideModal();
});

/* ============================
   MODAL ASSET CRUD
============================ */
function showModal(symbol) {
  state.modalSymbol = symbol;
  const s = state.signals.find(x => x.symbol === symbol);
  const a = state.assetsBySymbol.get(symbol);

  mSymbol.textContent = symbol;
  mName.textContent = s?.name || "-";

  mWatchlist.checked = a ? !!a.is_watchlist : true;
  mOwned.checked = a ? !!a.is_owned : false;

  mBuyPrice.value = a?.buy_price ?? "";
  mShares.value = a?.shares ?? "";
  mNote.value = a?.note ?? "";

  modal.classList.remove("hidden");
}

function hideModal() {
  modal.classList.add("hidden");
  state.modalSymbol = null;
}

btnSaveAsset.addEventListener("click", async () => {
  const symbol = state.modalSymbol;
  if (!symbol) return;

  const payload = {
    user_id: state.user.id,
    symbol,
    is_watchlist: mWatchlist.checked,
    is_owned: mOwned.checked,
    buy_price: mBuyPrice.value ? Number(mBuyPrice.value) : null,
    shares: mShares.value ? Number(mShares.value) : null,
    note: mNote.value?.trim() || null
  };

  // jika owned tapi highest_since_buy kosong, set = close hari ini (kalau ada)
  const s = state.signals.find(x => x.symbol === symbol);
  const close = s?.close_price ?? null;

  const existing = state.assetsBySymbol.get(symbol);
  if (!existing && close !== null) {
    payload.highest_since_buy = close;
  }

  const { error } = await sb.from("user_assets").upsert(payload, { onConflict: "user_id,symbol" });
  if (error) {
    Swal.fire("Gagal simpan", error.message, "error");
    return;
  }

  await loadAssets();
  hideModal();
  render();
  Swal.fire("OK", "Data aset tersimpan.", "success");
});

btnRemoveAsset.addEventListener("click", async () => {
  const symbol = state.modalSymbol;
  if (!symbol) return;

  const confirm = await Swal.fire({
    title: "Hapus?",
    text: `Hapus ${symbol} dari watchlist/portofolio?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Hapus",
    cancelButtonText: "Batal"
  });
  if (!confirm.isConfirmed) return;

  const { error } = await sb
    .from("user_assets")
    .delete()
    .eq("user_id", state.user.id)
    .eq("symbol", symbol);

  if (error) {
    Swal.fire("Gagal hapus", error.message, "error");
    return;
  }

  await loadAssets();
  hideModal();
  render();
});

/* ============================
   PORTFOLIO SIGNALS (owned)
============================ */
function portfolioAction(signalRow, assetRow) {
  if (!assetRow?.is_owned) return null;

  const close = Number(signalRow?.close_price);
  const buy = Number(assetRow?.buy_price);
  if (!Number.isFinite(close) || !Number.isFinite(buy) || buy <= 0) {
    return { label: "OWNED (set Buy Price)", cls: "info" };
  }

  // update trailing/highest suggestion (frontend suggestion only)
  const highest = Math.max(Number(assetRow.highest_since_buy || 0), close);
  const pnlPct = ((close - buy) / buy) * 100;

  // parameter trailing by style
  const style = state.tradingStyle;
  const trail = style === "AGRESIF" ? 7 : style === "MODERAT" ? 5 : 3; // %
  const stopFromHigh = highest * (1 - trail/100);

  // rules: cut loss, scaling out, trailing profit, add-on, re-entry
  if (pnlPct <= (style === "AGRESIF" ? -5 : style === "MODERAT" ? -4 : -3)) {
    return { label: `CUT LOSS (${pnlPct.toFixed(2)}%)`, cls: "bad" };
  }

  if (close < stopFromHigh && pnlPct > 0) {
    return { label: `TRAILING PROFIT (trail ${trail}%)`, cls: "warn" };
  }

  if (pnlPct >= (style === "AGRESIF" ? 10 : style === "MODERAT" ? 7 : 5)) {
    return { label: `SCALING OUT (${pnlPct.toFixed(2)}%)`, cls: "good" };
  }

  // add-on heuristic: price above SMA20 and net foreign positive and small profit
  if (pnlPct >= 1 && pnlPct <= 6 && (signalRow.close_price > (signalRow.sma20 || signalRow.close_price)) && (signalRow.net_foreign || 0) > 0) {
    return { label: "ADD-ON (trend ok)", cls: "info" };
  }

  return { label: `HOLD (${pnlPct.toFixed(2)}%)`, cls: "warn" };
}

/* ============================
   RENDER
============================ */
function render() {
  const style = state.tradingStyle;
  const q = state.search;

  // filter base list by tab
  let rows = [...state.signals];

  if (state.activeTab === "WATCHLIST") {
    rows = rows.filter(r => {
      const a = state.assetsBySymbol.get(r.symbol);
      return a && a.is_watchlist && !a.is_owned;
    });
  } else if (state.activeTab === "PORTFOLIO") {
    rows = rows.filter(r => {
      const a = state.assetsBySymbol.get(r.symbol);
      return a && a.is_owned;
    });
  }

  // search filter
  if (q) {
    rows = rows.filter(r =>
      String(r.symbol || "").toLowerCase().includes(q) ||
      String(r.name || "").toLowerCase().includes(q)
    );
  }

  // sort by style signal strength (rough)
  const rank = (label) => {
    const u = String(label || "").toUpperCase();
    if (u.includes("STRONG")) return 4;
    if (u.includes("SAFE")) return 4;
    if (u === "BUY" || u.includes("QUALIFIED")) return 3;
    if (u === "HOLD" || u === "NEUTRAL") return 2;
    if (u.includes("AVOID")) return 1;
    return 0;
  };

  const pickLabel = (r) => {
    if (style === "AGRESIF") return r.signal_agresif;
    if (style === "KONSERVATIF") return r.signal_konservatif;
    return r.signal_moderat;
  };

  rows.sort((a,b) => rank(pickLabel(b)) - rank(pickLabel(a)));

  cardsEl.innerHTML = rows.map(r => {
    const label = pickLabel(r);
    const cls = badgeClass(label);

    const a = state.assetsBySymbol.get(r.symbol);
    const tagOwned = a?.is_owned ? `<span class="badge info">OWNED</span>` : "";
    const tagWatch = (!a?.is_owned && a?.is_watchlist) ? `<span class="badge info">WATCH</span>` : "";

    const act = portfolioAction(r, a);
    const portBadge = act ? `<span class="badge ${act.cls}">${act.label}</span>` : "";

    return `
      <article class="stock" data-symbol="${r.symbol}">
        <div class="stock-top">
          <div>
            <div class="sym">${r.symbol}</div>
            <div class="name">${r.name || "-"}</div>
          </div>
          <div class="badges">
            ${tagOwned}
            ${tagWatch}
            <span class="badge ${cls}">${label}</span>
            ${portBadge}
          </div>
        </div>

        <div class="kpis">
          <div class="kpi">
            <div class="k">Close</div>
            <div class="v">${fmtNum(r.close_price)}</div>
          </div>
          <div class="kpi">
            <div class="k">Change</div>
            <div class="v">${fmtPct(r.change_pct)}</div>
          </div>
          <div class="kpi">
            <div class="k">Volume</div>
            <div class="v">${fmtNum(r.volume)}</div>
          </div>
          <div class="kpi">
            <div class="k">Net Foreign</div>
            <div class="v">${fmtNum(r.net_foreign)}</div>
          </div>
        </div>
      </article>
    `;
  }).join("");

  // single stable event delegation for card click
  cardsEl.querySelectorAll(".stock").forEach(el => {
    el.addEventListener("click", () => showModal(el.dataset.symbol), { once: true });
  });

  footerNote.textContent =
    `Tanggal: ${state.selectedDate || "-"} • Tab: ${state.activeTab} • Data: ${rows.length} saham • Style: ${state.tradingStyle}`;
}

/* ============================
   INIT
============================ */
sb.auth.onAuthStateChange(async () => {
  await refreshSession();
});

refreshSession();

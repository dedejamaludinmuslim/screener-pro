/* --- UPDATE BAGIAN renderSignals DI app.js --- */

function renderSignals(rows) {
  const thead = elSignals.querySelector("thead");
  
  // REVISI: DISABLE SORT (Hapus onClick & SortBadge)
  thead.innerHTML = "<tr>" + COLS.map(c => {
    // Kita tetap simpan class 'col-locked' atau 'col-reasons' untuk styling warna/layout
    // TAPI kita hapus 'sortable' dan hapus event click.
    const classes = [c.className || "", (!isLoggedIn && c.locked) ? "col-locked" : ""].join(" ");
    
    // Hapus onClick="${onClick}" dan ${sortBadgeFor(c.key)}
    return `<th class="${classes}">${c.label}</th>`;
  }).join("") + "</tr>";
  
  const minScore = parseInt(elScoreSlider.value);
  // ... (Sisa kode ke bawah tetap sama)
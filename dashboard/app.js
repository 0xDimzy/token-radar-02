// Token Radar dashboard: renders window.RADAR (written by main.ts as
// ../data.js, beside this page). No network: every number on the page
// comes from the snapshot payload.
//
// Structure of this file:
//   1. Snapshot guard
//   2. DOM and text helpers
//   3. Valuation model (mirrors main.ts, so the detail view can
//      recompute a row and check it against the board)
//   4. UI state and the shareable URL
//   5. Filter controls and the header stats
//   6. Filtering and sorting
//   7. Row builders (one function per table row shape)
//   8. View renderers
//   9. Tabs and navigation
//  10. Event wiring
//  11. Startup
(function () {
  "use strict";

  // ---------------------------------------------------------------
  // 1. Snapshot guard
  // ---------------------------------------------------------------
  var snapshot = window.RADAR;
  if (!snapshot) {
    document.body.innerHTML = "<p style='padding:30px'>Dashboard data (data.js) did not load.</p>";
    return;
  }

  // ---------------------------------------------------------------
  // 2. DOM and text helpers
  // ---------------------------------------------------------------
  function byId(id) { return document.getElementById(id); }

  function fmtUsd(n) { return "$" + Math.round(n).toLocaleString("en-US"); }

  function fmtTvl(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "b";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "m";
    return "$" + Math.round(n / 1e3) + "k";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  function watchBadge() { return "<span class='badge'>WATCHLIST</span>"; }

  function mutedSlug(slug) {
    return "<span style='color:var(--mut);font-size:12px'>" + esc(slug) + "</span>";
  }

  // ---------------------------------------------------------------
  // 3. Valuation model — the same implied-value formula main.ts uses,
  //    broken into its named factors so the detail view can show the
  //    same arithmetic the board was ranked on.
  // ---------------------------------------------------------------
  function growthFactor(row) {
    // 7-day TVL change, clamped to -50%..+100%, weighted at 0.6.
    var growth = row.change_7d === null ? 0 : clamp(row.change_7d, -50, 100);
    return 1 + (growth / 100) * 0.6;
  }

  function ageFactor(row) {
    // Age in days, capped at 3 years, blended 0.70 + 0.30 * share.
    var age = Math.min(row.age_days, 1095);
    return 0.7 + 0.3 * (age / 1095);
  }

  function chainFactor(row) {
    // +4% per extra chain beyond the first, capped at 5 extra chains.
    var extra = Math.min(Math.max(row.chains.length - 1, 0), 5);
    return 1 + 0.04 * extra;
  }

  function recompute(row) {
    return Math.max(1, Math.round(
      row.tvl_usd * row.multiple *
      growthFactor(row) * ageFactor(row) * chainFactor(row)
    ));
  }

  // ---------------------------------------------------------------
  // 4. UI state and the shareable URL
  // ---------------------------------------------------------------
  var ui = {
    q: "", cat: "", chain: "", watch: false,
    tab: "pre", sort: "rank", dir: 1, slug: null
  };

  function readParams() {
    var params = new URLSearchParams(location.search);
    if (params.get("q")) ui.q = params.get("q");
    if (params.get("category")) ui.cat = params.get("category");
    if (params.get("chain")) ui.chain = params.get("chain");
    if (params.get("watchlist") === "1") ui.watch = true;
    if (params.get("tab") === "live") ui.tab = "live";
    if (params.get("tab") === "method") ui.tab = "method";
    if (params.get("slug")) ui.slug = params.get("slug");
  }

  function buildQuery() {
    var p = new URLSearchParams();
    if (ui.q) p.set("q", ui.q);
    if (ui.cat) p.set("category", ui.cat);
    if (ui.chain) p.set("chain", ui.chain);
    if (ui.watch) p.set("watchlist", "1");
    if (ui.tab === "live") p.set("tab", "live");
    if (ui.tab === "method") p.set("tab", "method");
    if (ui.slug) p.set("slug", ui.slug);
    return p.toString();
  }

  function syncUrl() {
    var qs = buildQuery();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  // ---------------------------------------------------------------
  // 5. Filter controls and the header stats
  // ---------------------------------------------------------------
  function distinctCategories() {
    var seen = {};
    snapshot.rows.forEach(function (r) { seen[r.category || "Uncategorised"] = true; });
    return Object.keys(seen).sort();
  }

  function distinctChains() {
    var seen = {};
    snapshot.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    snapshot.live.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function fillSelect(el, values) {
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v; o.textContent = v; el.appendChild(o);
    });
  }

  function populateFilters() {
    fillSelect(byId("cat"), distinctCategories());
    fillSelect(byId("chain"), distinctChains());
  }

  function applyControlValues() {
    byId("q").value = ui.q;
    byId("cat").value = ui.cat;
    byId("chain").value = ui.chain;
    byId("watchonly").checked = ui.watch;
  }

  function renderStats() {
    var top = snapshot.rows[0];
    byId("stats").innerHTML =
      "<div><b>" + snapshot.rows.length + "</b><span>pre-token ranked</span></div>" +
      "<div><b>" + snapshot.watchlist_count + "</b><span>watchlist covered</span></div>" +
      "<div><b>" + fmtTvl(top.implied_value_usd) + "</b><span>top implied value</span></div>" +
      "<div><b>" + snapshot.live.length + "</b><span>live-token comparables</span></div>";
    byId("asof").textContent = snapshot.as_of;
    byId("footcount").textContent = snapshot.rows.length + " ranked, " + snapshot.watchlist_count + " of them on the watchlist";
  }

  // ---------------------------------------------------------------
  // 6. Filtering and sorting
  // ---------------------------------------------------------------
  function matchesSearch(row, q) {
    if (!q) return true;
    var needle = q.trim().toLowerCase();
    return row.name.toLowerCase().indexOf(needle) !== -1 ||
      row.slug.toLowerCase().indexOf(needle) !== -1;
  }

  function passesFilters(row) {
    if (ui.watch && !row.watchlist) return false;
    if (ui.cat && (row.category || "Uncategorised") !== ui.cat) return false;
    if (ui.chain && row.chains.indexOf(ui.chain) === -1) return false;
    return matchesSearch(row, ui.q);
  }

  function filteredRows() {
    return snapshot.rows.filter(passesFilters);
  }

  function sortValue(row, key) {
    if (key === "chains") return row.chains.length;
    return row[key];
  }

  function compareRows(a, b) {
    var va = sortValue(a, ui.sort), vb = sortValue(b, ui.sort);
    if (typeof va === "string") return ui.dir * va.localeCompare(vb);
    return ui.dir * ((va ?? -Infinity) - (vb ?? -Infinity));
  }

  function sortRows(list) {
    return list.slice().sort(compareRows);
  }

  // ---------------------------------------------------------------
  // 7. Row builders — one function per table row shape, so each view
  //    renderer just maps its rows through its builder.
  // ---------------------------------------------------------------
  function changeLabel(row) {
    if (row.change_7d === null) return "—";
    return (row.change_7d >= 0 ? "+" : "") + row.change_7d.toFixed(1) + "%";
  }

  function changeClass(row) {
    if (row.change_7d === null) return "";
    return row.change_7d >= 0 ? "pos" : "neg";
  }

  function chainPills(chains) {
    return chains.slice(0, 3).map(function (c) {
      return "<span class='pill'>" + esc(c) + "</span>";
    }).join("");
  }

  function boardRow(r) {
    var src = r.benchmark_source === "category" ? "cat." : "glob.";
    return "<tr data-slug='" + esc(r.slug) + "'><td class='num'>#" + r.rank + "</td>" +
      "<td><b>" + esc(r.name) + "</b>" + (r.watchlist ? watchBadge() : "") +
      "<br>" + mutedSlug(r.slug) + "</td>" +
      "<td>" + esc(r.category || "—") + "</td>" +
      "<td>" + chainPills(r.chains) + "</td>" +
      "<td class='num'>" + fmtTvl(r.tvl_usd) + "</td>" +
      "<td class='num " + changeClass(r) + "'>" + changeLabel(r) + "</td>" +
      "<td class='num'>" + r.age_days + "d</td>" +
      "<td class='num'>" + r.multiple.toFixed(2) + "× <span class='src'>" + src + "</span></td>" +
      "<td class='num'><b>" + fmtUsd(r.implied_value_usd) + "</b></td>" +
      "<td>" + esc(r.farm_steps[0]).slice(0, 80) + "…</td></tr>";
  }

  function liveRow(r) {
    var ratio = r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd).toFixed(2) + "×" : "—";
    return "<tr><td><b>" + esc(r.name) + "</b><br>" + mutedSlug(r.slug) + "</td>" +
      "<td>" + esc(r.category || "—") + "</td>" +
      "<td class='num'>" + fmtTvl(r.tvl_usd) + "</td>" +
      "<td class='num'><b>" + fmtUsd(r.mcap_usd) + "</b></td>" +
      "<td class='num'>" + ratio + "</td>" +
      "<td class='num'>" + r.age_days + "d</td></tr>";
  }

  // The multiple the board actually uses for a benchmark row: the
  // category median when the category has enough comparables, else the
  // global median, labelled so the fallback is visible.
  function usedMultipleMini(b) {
    return b.source === "category"
      ? b.multiple.toFixed(2) + "×"
      : snapshot.global_multiple.toFixed(2) + "× (global)";
  }

  function usedMultipleFull(b) {
    return b.source === "category"
      ? b.multiple.toFixed(2) + "×"
      : snapshot.global_multiple.toFixed(2) + "× (global fallback)";
  }

  function benchMiniRow(b) {
    return "<tr><td>" + esc(b.category) + "</td><td class='num'>" + b.comparables + "</td>" +
      "<td class='num'>" + b.median.toFixed(2) + "×</td><td class='num'>" + usedMultipleMini(b) + "</td></tr>";
  }

  function benchFullRow(b) {
    return "<tr><td>" + esc(b.category) + "</td><td class='num'>" + b.comparables + "</td>" +
      "<td class='num'>" + b.median.toFixed(2) + "×</td>" +
      "<td class='num'>" + b.q1.toFixed(2) + "× – " + b.q3.toFixed(2) + "×</td>" +
      "<td class='num'>" + usedMultipleFull(b) + "</td></tr>";
  }

  function globalBenchRow() {
    return "<tr><td><b>Global (all live tokens)</b></td><td class='num'>" + snapshot.live.length + "</td>" +
      "<td class='num'>" + snapshot.global_median.toFixed(2) + "×</td><td class='num'>—</td>" +
      "<td class='num'><b>" + snapshot.global_multiple.toFixed(2) + "×</b></td></tr>";
  }

  // ---------------------------------------------------------------
  // 8. View renderers
  // ---------------------------------------------------------------
  function renderBoard() {
    var list = sortRows(filteredRows());
    byId("count").textContent = list.length + " of " + snapshot.rows.length + " protocols";
    byId("rows").innerHTML = list.map(boardRow).join("");
  }

  function renderLive() {
    var list = snapshot.live.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    byId("liverows").innerHTML = list.map(liveRow).join("");
  }

  // The benchmark strip on the board: the eight categories with the most
  // live-token comparables, so the pricing basis is visible without
  // opening the method tab.
  function renderBenchMini() {
    byId("benchminirows").innerHTML = snapshot.benchmarks.slice(0, 8).map(benchMiniRow).join("");
  }

  // The full benchmark table in the method tab: every category, with its
  // median, interquartile range and the multiple the board uses for it.
  function renderComps() {
    var rows = snapshot.benchmarks.map(benchFullRow);
    rows.push(globalBenchRow());
    byId("compsrows").innerHTML = rows.join("");
  }

  function growthLabel(row) {
    if (row.change_7d === null) return "not reported";
    return (row.change_7d >= 0 ? "+" : "") + row.change_7d.toFixed(2) + "%";
  }

  function benchmarkNote(row) {
    if (row.benchmark_source === "category") {
      return "Category benchmark: the median mcap / TVL of the " + row.benchmark_comparables +
        " live tokens in " + (row.category || "its category") + ".";
    }
    return "Thin category: fewer than 3 live tokens, so this row uses the global median mcap / TVL of all " +
      snapshot.live.length + " live tokens.";
  }

  function detailStats(row) {
    return "<div class='kv'>" +
      "<div><b>#" + row.rank + "</b><span>rank of " + snapshot.rows.length + "</span></div>" +
      "<div><b>" + fmtUsd(row.implied_value_usd) + "</b><span>implied value</span></div>" +
      "<div><b>" + fmtTvl(row.tvl_usd) + "</b><span>TVL</span></div>" +
      "<div><b>" + growthLabel(row) + "</b><span>7-day TVL change</span></div>" +
      "<div><b>" + row.multiple.toFixed(3) + "×</b><span>category multiple</span></div>" +
      "<div><b>" + row.age_days + " days</b><span>age at snapshot</span></div></div>";
  }

  function detailCheckBanner(row, again, ok) {
    var text = ok
      ? "✓ Recomputed in this page: " + fmtUsd(again) + " — matches the board's " + fmtUsd(row.implied_value_usd) + "."
      : "✗ Recomputed in this page: " + fmtUsd(again) + " — does NOT match the board's " + fmtUsd(row.implied_value_usd) + ".";
    return "<div class='check " + (ok ? "ok" : "bad") + "'>" + text + "</div>";
  }

  function detailHeader(row) {
    return "<div class='detail-card'><h2>" + esc(row.name) + (row.watchlist ? watchBadge() : "") + "</h2>" +
      "<p style='color:var(--mut);margin:0'>" + esc(row.slug) + " · " + esc(row.category || "Uncategorised") + " · " +
      row.chains.map(esc).join(", ") + " · listed " + esc(row.listed_at || "date not recorded") + "</p>";
  }

  function detailCardHtml(row) {
    var again = recompute(row);
    var ok = again === row.implied_value_usd;
    var chainWord = row.chains.length === 1 ? "chain" : "chains";
    return detailHeader(row) +
      detailStats(row) +
      "<p>Model: " + fmtTvl(row.tvl_usd) + " TVL × " + row.multiple.toFixed(3) + "× multiple × growth factor × age factor × chain factor (" +
      row.chains.length + " " + chainWord + "). " + benchmarkNote(row) +
      " The record shows no token — market cap, CoinGecko id and symbol are all null.</p>" +
      detailCheckBanner(row, again, ok) +
      "<h3>Farm plan — 7 steps</h3><ol class='steps'>" +
      row.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol></div>";
  }

  function renderDetail(slug) {
    var row = snapshot.rows.find(function (x) { return x.slug === slug; });
    if (!row) { showTab("pre"); return; }
    byId("detail").innerHTML = detailCardHtml(row);
  }

  // ---------------------------------------------------------------
  // 9. Tabs and navigation
  // ---------------------------------------------------------------
  function setTabButtons(tab) {
    byId("tab-pre").classList.toggle("active", tab === "pre");
    byId("tab-live").classList.toggle("active", tab === "live");
    byId("tab-method").classList.toggle("active", tab === "method");
  }

  function setViewVisibility(tab) {
    byId("view-board").hidden = tab !== "pre" || !!ui.slug;
    byId("view-live").hidden = tab !== "live";
    byId("view-method").hidden = tab !== "method";
    byId("view-detail").hidden = !ui.slug;
    byId("controls").style.display = (tab === "pre" && !ui.slug) ? "" : "none";
  }

  function renderActiveView(tab) {
    if (tab === "pre" && !ui.slug) { renderBenchMini(); renderBoard(); }
    if (tab === "live") renderLive();
    if (tab === "method") renderComps();
    if (ui.slug) renderDetail(ui.slug);
  }

  function showTab(tab) {
    ui.tab = tab;
    setTabButtons(tab);
    setViewVisibility(tab);
    renderActiveView(tab);
    syncUrl();
  }

  function openDetail(slug) {
    ui.slug = slug;
    showTab("pre");
  }

  function closeDetail() {
    ui.slug = null;
    showTab("pre");
  }

  // ---------------------------------------------------------------
  // 10. Event wiring
  // ---------------------------------------------------------------
  function onFilterChange() {
    renderBoard();
    syncUrl();
  }

  function onSortHeaderClick(th) {
    var key = th.getAttribute("data-sort");
    if (ui.sort === key) {
      ui.dir = -ui.dir;
    } else {
      ui.sort = key;
      ui.dir = key === "name" ? 1 : -1;
    }
    renderBoard();
  }

  function onBoardRowClick(e) {
    var tr = e.target.closest("tr[data-slug]");
    if (tr) openDetail(tr.getAttribute("data-slug"));
  }

  function bindEvents() {
    byId("tab-pre").addEventListener("click", closeDetail);
    byId("tab-live").addEventListener("click", function () { ui.slug = null; showTab("live"); });
    byId("tab-method").addEventListener("click", function () { ui.slug = null; showTab("method"); });
    byId("back").addEventListener("click", closeDetail);
    byId("q").addEventListener("input", function (e) { ui.q = e.target.value; onFilterChange(); });
    byId("cat").addEventListener("change", function (e) { ui.cat = e.target.value; onFilterChange(); });
    byId("chain").addEventListener("change", function (e) { ui.chain = e.target.value; onFilterChange(); });
    byId("watchonly").addEventListener("change", function (e) { ui.watch = e.target.checked; onFilterChange(); });
    byId("rows").addEventListener("click", onBoardRowClick);
    document.querySelectorAll("#board th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () { onSortHeaderClick(th); });
    });
  }

  // ---------------------------------------------------------------
  // 11. Startup
  // ---------------------------------------------------------------
  readParams();
  populateFilters();
  applyControlValues();
  renderStats();
  bindEvents();
  if (ui.slug) {
    showTab("pre");
  } else if (ui.tab === "live") {
    showTab("live");
  } else if (ui.tab === "method") {
    showTab("method");
  } else {
    showTab("pre");
  }
})();

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
  // 3. Valuation model — the same OLS formula main.ts uses, so the
  //    detail view can recompute a row and check it against the
  //    board. The regression coefficients come from the payload
  //    (fit at run time on the snapshot's live tokens), never from
  //    a hardcoded constant in this file.
  // ---------------------------------------------------------------
  function rawMultiple(row) {
    var m = snapshot.model;
    var logPred = m.intercept + m.slope * Math.log10(row.tvl_usd) + row.cat_effect_dex;
    return Math.pow(10, logPred) / row.tvl_usd;
  }

  function clampedMultiple(row) {
    return clamp(rawMultiple(row), snapshot.model.floor, snapshot.model.cap);
  }

  function recompute(row) {
    return Math.max(1, Math.round(row.tvl_usd * clampedMultiple(row)));
  }

  function fmtDex(x) {
    return (x >= 0 ? "+" : "") + x.toFixed(3) + " dex";
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
    // Short effect tag for the narrow Multiple column (2 decimals).
    var tag = r.capped === "cap" ? "capped" : r.capped === "floor" ? "floor" :
      (r.cat_effect_dex >= 0 ? "+" : "") + r.cat_effect_dex.toFixed(2) + " dex";
    var top = r.rank <= 3 ? " class='top3'" : "";
    return "<tr data-slug='" + esc(r.slug) + "'" + top + "><td class='num'>#" + r.rank + "</td>" +
      "<td><b>" + esc(r.name) + "</b>" + (r.watchlist ? watchBadge() : "") +
      "<br>" + mutedSlug(r.slug) + "</td>" +
      "<td>" + esc(r.category || "—") + "</td>" +
      "<td>" + chainPills(r.chains) + "</td>" +
      "<td class='num'>" + fmtTvl(r.tvl_usd) + "</td>" +
      "<td class='num " + changeClass(r) + "'>" + changeLabel(r) + "</td>" +
      "<td class='num'>" + r.age_days + "d</td>" +
      "<td class='num'>" + r.multiple.toFixed(2) + "× <span class='src'>" + tag + "</span></td>" +
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

  // The category-effect table: raw mean residual of the category's
  // live tokens from the regression, and the shrunken effect the
  // board actually uses for it.
  function effectMiniRow(b) {
    return "<tr><td>" + esc(b.category) + "</td><td class='num'>" + b.comparables + "</td>" +
      "<td class='num'>" + fmtDex(b.raw_mean_dex) + "</td><td class='num'>" + fmtDex(b.effect_dex) + "</td></tr>";
  }

  function effectFullRow(b) {
    return effectMiniRow(b);
  }

  function modelSummaryRow() {
    var m = snapshot.model;
    return "<tr><td><b>Regression (all live tokens)</b></td><td class='num'>" + m.n_live + "</td>" +
      "<td class='num'>log10(mcap) = " + m.intercept.toFixed(2) + " + " + m.slope.toFixed(2) + " · log10(TVL)</td>" +
      "<td class='num'>residual sd " + m.residual_sd.toFixed(2) + " dex, R² " + m.r_squared.toFixed(2) + "</td></tr>";
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

  // The effect strip on the board: the eight categories with the most
  // live-token comparables, so the pricing basis is visible without
  // opening the method tab.
  function renderBenchMini() {
    byId("benchminirows").innerHTML = snapshot.category_effects.slice(0, 8).map(effectMiniRow).join("");
  }

  // The full effect table in the method tab: every category, with its
  // raw mean residual and the shrunken effect the board uses for it.
  function renderComps() {
    var rows = snapshot.category_effects.map(effectFullRow);
    rows.push(modelSummaryRow());
    byId("compsrows").innerHTML = rows.join("");
    byId("agefallback").textContent = snapshot.age_fallback_days + " days";
    byId("ols-intercept").textContent = snapshot.model.intercept.toFixed(2);
    byId("ols-slope").textContent = snapshot.model.slope.toFixed(2);
    byId("ols-sd").textContent = snapshot.model.residual_sd.toFixed(2);
    byId("ols-r2").textContent = snapshot.model.r_squared.toFixed(2);
  }

  function growthLabel(row) {
    if (row.change_7d === null) return "not reported";
    return (row.change_7d >= 0 ? "+" : "") + row.change_7d.toFixed(2) + "%";
  }

  function benchmarkNote(row) {
    var m = snapshot.model;
    var base = "Regression: log10(market cap) = " + m.intercept.toFixed(2) + " + " +
      m.slope.toFixed(2) + " · log10(TVL), fit on " + m.n_live + " live tokens. ";
    if (Math.abs(row.cat_effect_dex) < 0.0005) {
      base += "No category effect: " + (row.category || "its category") +
        " has no live tokens, so this row sits on the regression line. ";
    } else {
      base += "Category effect " + fmtDex(row.cat_effect_dex) + " for " +
        (row.category || "its category") + " (raw mean residual shrunk by n ÷ (n + " +
        m.shrink_k + ")). ";
    }
    if (row.capped === "cap") {
      base += "The implied multiple hit the " + m.cap.toFixed(2) + "× cap and was held there.";
    } else if (row.capped === "floor") {
      base += "The implied multiple hit the " + m.floor.toFixed(2) + "× floor and was held there.";
    } else {
      base += "The implied multiple sits inside the [" + m.floor.toFixed(2) + ", " +
        m.cap.toFixed(2) + "] clamp, so no bound binds.";
    }
    return base;
  }

  // The factor breakdown: every number that goes into the implied
  // value, so the detail view shows the multiplication the board was
  // ranked on instead of just stating the result.
  function factorRows(row) {
    var m = snapshot.model;
    var logTvl = Math.log10(row.tvl_usd);
    var base = Math.pow(10, m.intercept + m.slope * logTvl);
    var rawMult = rawMultiple(row);
    var f = [
      ["TVL", fmtTvl(row.tvl_usd), "the protocol's locked value at the snapshot"],
      ["log10(TVL)", logTvl.toFixed(3), "the regression's input: the log of locked value"],
      ["Regression base", fmtUsd(base), "10^(" + m.intercept.toFixed(2) + " + " + m.slope.toFixed(2) + " · log10(TVL)) — the prediction before any category effect"],
      ["Category effect", fmtDex(row.cat_effect_dex), "the shrunken mean residual of " + (row.category || "its category") + "'s live tokens, added in log space"],
      ["Implied multiple (raw)", rawMult.toFixed(3) + "×", "predicted market cap ÷ TVL, before the clamp"],
      ["Implied multiple (used)", row.multiple.toFixed(3) + "×" + (row.capped === "none" ? "" : " (" + row.capped + " bound)"), "the raw multiple clamped to [" + m.floor.toFixed(2) + ", " + m.cap.toFixed(2) + "]"],
      ["Implied value", fmtUsd(row.implied_value_usd), "TVL × multiple used"]
    ];
    return f.map(function (r) {
      return "<tr><td>" + esc(r[0]) + "</td><td class='num'><b>" + esc(r[1]) + "</b></td><td>" + esc(r[2]) + "</td></tr>";
    }).join("");
  }

  function detailStats(row) {
    return "<div class='kv'>" +
      "<div><b>#" + row.rank + "</b><span>rank of " + snapshot.rows.length + "</span></div>" +
      "<div><b>" + fmtUsd(row.implied_value_usd) + "</b><span>implied value</span></div>" +
      "<div><b>" + fmtTvl(row.tvl_usd) + "</b><span>TVL</span></div>" +
      "<div><b>" + growthLabel(row) + "</b><span>7-day TVL change</span></div>" +
      "<div><b>" + row.multiple.toFixed(3) + "×</b><span>implied multiple</span></div>" +
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
    return detailHeader(row) +
      detailStats(row) +
      "<p>Model: " + fmtTvl(row.tvl_usd) + " TVL through log10(market cap) = " +
      snapshot.model.intercept.toFixed(2) + " + " + snapshot.model.slope.toFixed(2) +
      " · log10(TVL), shifted " + fmtDex(row.cat_effect_dex) + " by its category effect" +
      (row.capped === "none" ? "" : ", then held at the " + row.capped + " bound of the multiple clamp") +
      ". " + benchmarkNote(row) +
      " The record shows no token — market cap, CoinGecko id and symbol are all null.</p>" +
      detailCheckBanner(row, again, ok) +
      "<h3>How the value is built</h3><table class='factors'><thead><tr><th>Factor</th><th>Value</th><th>Where it comes from</th></tr></thead><tbody>" +
      factorRows(row) + "</tbody></table>" +
      "<h3>Farm plan — 8 steps</h3><ol class='steps'>" +
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

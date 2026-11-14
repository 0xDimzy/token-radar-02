// Token Radar dashboard: renders window.RADAR (written by main.ts as
// ../data.js, beside this page). No network: every number on the page
// comes from the snapshot payload.
(function () {
  "use strict";
  var D = window.RADAR;
  if (!D) { document.body.innerHTML = "<p style='padding:30px'>Dashboard data (data.js) did not load.</p>"; return; }

  var $ = function (id) { return document.getElementById(id); };
  var fmt$ = function (n) { return "$" + Math.round(n).toLocaleString("en-US"); };
  var fmtTvl = function (n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "b";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "m";
    return "$" + Math.round(n / 1e3) + "k";
  };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var clamp = function (x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; };

  // The same implied-value formula main.ts uses, run in the page so the
  // detail view can recompute a row and check it against the board.
  function recompute(r) {
    var growth = r.change_7d === null ? 0 : clamp(r.change_7d, -50, 100);
    var age = Math.min(r.age_days, 1095);
    return Math.max(1, Math.round(
      r.tvl_usd * r.multiple * (1 + (growth / 100) * 0.6) *
      (0.7 + 0.3 * (age / 1095)) *
      (1 + 0.04 * Math.min(Math.max(r.chains.length - 1, 0), 5))
    ));
  }

  var state = { q: "", cat: "", chain: "", watch: false, tab: "pre", sort: "rank", dir: 1, slug: null };
  var params = new URLSearchParams(location.search);
  if (params.get("q")) state.q = params.get("q");
  if (params.get("category")) state.cat = params.get("category");
  if (params.get("chain")) state.chain = params.get("chain");
  if (params.get("watchlist") === "1") state.watch = true;
  if (params.get("tab") === "live") state.tab = "live";
  if (params.get("tab") === "method") state.tab = "method";
  if (params.get("slug")) state.slug = params.get("slug");

  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.cat) p.set("category", state.cat);
    if (state.chain) p.set("chain", state.chain);
    if (state.watch) p.set("watchlist", "1");
    if (state.tab === "live") p.set("tab", "live");
    if (state.tab === "method") p.set("tab", "method");
    if (state.slug) p.set("slug", state.slug);
    var qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  function fillSelect(el, values) {
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v; o.textContent = v; el.appendChild(o);
    });
  }
  var cats = [...new Set(D.rows.map(function (r) { return r.category || "Uncategorised"; }))].sort();
  var chains = [...new Set(D.rows.flatMap(function (r) { return r.chains; }).concat(D.live.flatMap(function (r) { return r.chains; })))].sort();
  fillSelect($("cat"), cats);
  fillSelect($("chain"), chains);
  $("q").value = state.q; $("cat").value = state.cat; $("chain").value = state.chain;
  $("watchonly").checked = state.watch;

  var top = D.rows[0];
  $("stats").innerHTML =
    "<div><b>" + D.rows.length + "</b><span>pre-token ranked</span></div>" +
    "<div><b>" + D.watchlist_count + "</b><span>watchlist covered</span></div>" +
    "<div><b>" + fmtTvl(top.implied_value_usd) + "</b><span>top implied value</span></div>" +
    "<div><b>" + D.live.length + "</b><span>live-token comparables</span></div>";
  $("asof").textContent = D.as_of;
  $("footcount").textContent = D.rows.length + " ranked, " + D.watchlist_count + " of them on the watchlist";

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && (r.category || "Uncategorised") !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && (r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1)) return false;
      return true;
    });
  }

  function sortRows(list) {
    var k = state.sort, d = state.dir;
    return list.slice().sort(function (a, b) {
      var va = a[k], vb = b[k];
      if (k === "chains") { va = a.chains.length; vb = b.chains.length; }
      if (typeof va === "string") return d * va.localeCompare(vb);
      return d * ((va ?? -Infinity) - (vb ?? -Infinity));
    });
  }

  function renderBoard() {
    var list = sortRows(filteredRows());
    $("count").textContent = list.length + " of " + D.rows.length + " protocols";
    $("rows").innerHTML = list.map(function (r) {
      var chg = r.change_7d === null ? "—" : (r.change_7d >= 0 ? "+" : "") + r.change_7d.toFixed(1) + "%";
      var cls = r.change_7d === null ? "" : (r.change_7d >= 0 ? "pos" : "neg");
      var src = r.benchmark_source === "category" ? "cat." : "glob.";
      return "<tr data-slug='" + esc(r.slug) + "'><td class='num'>#" + r.rank + "</td>" +
        "<td><b>" + esc(r.name) + "</b>" + (r.watchlist ? "<span class='badge'>WATCHLIST</span>" : "") +
        "<br><span style='color:var(--mut);font-size:12px'>" + esc(r.slug) + "</span></td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        "<td>" + r.chains.slice(0, 3).map(function (c) { return "<span class='pill'>" + esc(c) + "</span>"; }).join("") + "</td>" +
        "<td class='num'>" + fmtTvl(r.tvl_usd) + "</td>" +
        "<td class='num " + cls + "'>" + chg + "</td>" +
        "<td class='num'>" + r.age_days + "d</td>" +
        "<td class='num'>" + r.multiple.toFixed(2) + "× <span class='src'>" + src + "</span></td>" +
        "<td class='num'><b>" + fmt$(r.implied_value_usd) + "</b></td>" +
        "<td>" + esc(r.farm_steps[0]).slice(0, 80) + "…</td></tr>";
    }).join("");
  }

  function renderLive() {
    var list = D.live.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    $("liverows").innerHTML = list.map(function (r) {
      var ratio = r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd).toFixed(2) + "×" : "—";
      return "<tr><td><b>" + esc(r.name) + "</b><br><span style='color:var(--mut);font-size:12px'>" + esc(r.slug) + "</span></td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        "<td class='num'>" + fmtTvl(r.tvl_usd) + "</td>" +
        "<td class='num'><b>" + fmt$(r.mcap_usd) + "</b></td>" +
        "<td class='num'>" + ratio + "</td>" +
        "<td class='num'>" + r.age_days + "d</td></tr>";
    }).join("");
  }

  // The benchmark strip on the board: the eight categories with the most
  // live-token comparables, so the pricing basis is visible without
  // opening the method tab.
  function renderBenchMini() {
    var rows = D.benchmarks.slice(0, 8).map(function (b) {
      var used = b.source === "category" ? b.multiple.toFixed(2) + "×" : D.global_multiple.toFixed(2) + "× (global)";
      return "<tr><td>" + esc(b.category) + "</td><td class='num'>" + b.comparables + "</td>" +
        "<td class='num'>" + b.median.toFixed(2) + "×</td><td class='num'>" + used + "</td></tr>";
    });
    $("benchminirows").innerHTML = rows.join("");
  }

  // The full benchmark table in the method tab: every category, with its
  // median, interquartile range and the multiple the board uses for it.
  function renderComps() {
    var rows = D.benchmarks.map(function (b) {
      var used = b.source === "category"
        ? b.multiple.toFixed(2) + "×"
        : D.global_multiple.toFixed(2) + "× (global fallback)";
      return "<tr><td>" + esc(b.category) + "</td><td class='num'>" + b.comparables + "</td>" +
        "<td class='num'>" + b.median.toFixed(2) + "×</td>" +
        "<td class='num'>" + b.q1.toFixed(2) + "× – " + b.q3.toFixed(2) + "×</td>" +
        "<td class='num'>" + used + "</td></tr>";
    });
    rows.push("<tr><td><b>Global (all live tokens)</b></td><td class='num'>" + D.live.length + "</td>" +
      "<td class='num'>" + D.global_median.toFixed(2) + "×</td><td class='num'>—</td>" +
      "<td class='num'><b>" + D.global_multiple.toFixed(2) + "×</b></td></tr>");
    $("compsrows").innerHTML = rows.join("");
  }

  function renderDetail(slug) {
    var r = D.rows.find(function (x) { return x.slug === slug; });
    if (!r) { showTab("pre"); return; }
    var again = recompute(r);
    var ok = again === r.implied_value_usd;
    var growth = r.change_7d === null ? "not reported" : (r.change_7d >= 0 ? "+" : "") + r.change_7d.toFixed(2) + "%";
    var benchNote = r.benchmark_source === "category"
      ? "Category benchmark: the median mcap / TVL of the " + r.benchmark_comparables + " live tokens in " + (r.category || "its category") + "."
      : "Thin category: fewer than 3 live tokens, so this row uses the global median mcap / TVL of all " + D.live.length + " live tokens.";
    $("detail").innerHTML =
      "<div class='detail-card'><h2>" + esc(r.name) + (r.watchlist ? "<span class='badge'>WATCHLIST</span>" : "") + "</h2>" +
      "<p style='color:var(--mut);margin:0'>" + esc(r.slug) + " · " + esc(r.category || "Uncategorised") + " · " + r.chains.map(esc).join(", ") + " · listed " + esc(r.listed_at || "date not recorded") + "</p>" +
      "<div class='kv'>" +
      "<div><b>#" + r.rank + "</b><span>rank of " + D.rows.length + "</span></div>" +
      "<div><b>" + fmt$(r.implied_value_usd) + "</b><span>implied value</span></div>" +
      "<div><b>" + fmtTvl(r.tvl_usd) + "</b><span>TVL</span></div>" +
      "<div><b>" + growth + "</b><span>7-day TVL change</span></div>" +
      "<div><b>" + r.multiple.toFixed(3) + "×</b><span>category multiple</span></div>" +
      "<div><b>" + r.age_days + " days</b><span>age at snapshot</span></div></div>" +
      "<p>Model: " + fmtTvl(r.tvl_usd) + " TVL × " + r.multiple.toFixed(3) + "× multiple × growth factor × age factor × chain factor (" + r.chains.length + " chain" + (r.chains.length === 1 ? "" : "s") + "). " + benchNote + " The record shows no token — market cap, CoinGecko id and symbol are all null.</p>" +
      "<div class='check " + (ok ? "ok" : "bad") + "'>" +
      (ok ? "✓ Recomputed in this page: " + fmt$(again) + " — matches the board's " + fmt$(r.implied_value_usd) + "."
          : "✗ Recomputed in this page: " + fmt$(again) + " — does NOT match the board's " + fmt$(r.implied_value_usd) + ".") +
      "</div>" +
      "<h3>Farm plan — 7 steps</h3><ol class='steps'>" +
      r.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol></div>";
  }

  function showTab(tab) {
    state.tab = tab;
    $("tab-pre").classList.toggle("active", tab === "pre");
    $("tab-live").classList.toggle("active", tab === "live");
    $("tab-method").classList.toggle("active", tab === "method");
    $("view-board").hidden = tab !== "pre" || !!state.slug;
    $("view-live").hidden = tab !== "live";
    $("view-method").hidden = tab !== "method";
    $("view-detail").hidden = !state.slug;
    $("controls").style.display = (tab === "pre" && !state.slug) ? "" : "none";
    if (tab === "pre" && !state.slug) { renderBenchMini(); renderBoard(); }
    if (tab === "live") renderLive();
    if (tab === "method") renderComps();
    if (state.slug) renderDetail(state.slug);
    syncUrl();
  }

  $("tab-pre").addEventListener("click", function () { state.slug = null; showTab("pre"); });
  $("tab-live").addEventListener("click", function () { state.slug = null; showTab("live"); });
  $("tab-method").addEventListener("click", function () { state.slug = null; showTab("method"); });
  $("back").addEventListener("click", function () { state.slug = null; showTab("pre"); });
  $("q").addEventListener("input", function (e) { state.q = e.target.value; renderBoard(); syncUrl(); });
  $("cat").addEventListener("change", function (e) { state.cat = e.target.value; renderBoard(); syncUrl(); });
  $("chain").addEventListener("change", function (e) { state.chain = e.target.value; renderBoard(); syncUrl(); });
  $("watchonly").addEventListener("change", function (e) { state.watch = e.target.checked; renderBoard(); syncUrl(); });
  $("rows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-slug]");
    if (tr) { state.slug = tr.getAttribute("data-slug"); showTab("pre"); }
  });
  document.querySelectorAll("#board th[data-sort]").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-sort");
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === "name" ? 1 : -1; }
      renderBoard();
    });
  });

  if (state.slug) showTab("pre");
  else showTab(state.tab === "live" ? "live" : state.tab === "method" ? "method" : "pre");
})();

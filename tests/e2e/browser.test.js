const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { launch, findBrowser, sleep } = require("../helpers/cdp");
const { startStaticServer } = require("../helpers/static_server");

const READY = `!!window.CTG_APP && document.getElementById("stat-cost").textContent !== "--"`;
const skip = findBrowser() ? false : "no Chromium-based browser found (set CHROME_PATH)";

describe("browser: main workflow", { skip, timeout: 180000 }, () => {
  let site, browser;

  before(async () => {
    site = await startStaticServer();
    browser = await launch();
    await browser.goto(site.url, READY, 30000);
  });

  after(async () => {
    if (browser) await browser.close();
    if (site) site.server.close();
  });

  it("loads the map, a default route and the network size without page errors", async () => {
    const info = await browser.evaluate(`document.getElementById("network-info").textContent`);
    assert.match(info, /nodes · .* roads/);
    const cost = await browser.evaluate(`Number(document.getElementById("stat-cost").textContent)`);
    assert.ok(cost > 0);
    const status = await browser.evaluate(`document.getElementById("stat-status").textContent`);
    assert.match(status, /Found/);
    assert.deepEqual(browser.errors, []);
  });

  it("finds a place by name and snaps it to a road node", async () => {
    await browser.evaluate(`document.getElementById("search-target").focus()`);
    await browser.type("chittagong medical college");
    await sleep(400);
    const first = await browser.evaluate(`document.querySelector("#results-target .node-search-item.active .node-search-name").textContent`);
    assert.match(first, /Medical College/i);
    await browser.key("Enter");
    await sleep(800);
    assert.match(await browser.evaluate(`document.getElementById("search-target").value`), /Medical College/i);
    assert.match(await browser.evaluate(`document.getElementById("snap-target").textContent`), /Road node: .*snapped \d+ m/);
  });

  it("supports keyboard selection and clearing an endpoint", async () => {
    await browser.evaluate(`document.getElementById("search-start").focus()`);
    await browser.type("agrabad");
    await sleep(400);
    await browser.key("ArrowDown");
    const highlighted = await browser.evaluate(`document.querySelector("#results-start .node-search-item.active .node-search-name").textContent`);
    await browser.key("Enter");
    await sleep(800);
    assert.equal(await browser.evaluate(`document.getElementById("search-start").value`), highlighted);

    await browser.evaluate(`document.querySelector('[data-clear="start"]').click()`);
    await sleep(300);
    assert.match(await browser.evaluate(`document.getElementById("stat-status").textContent`), /Choose a start/);
    await browser.evaluate(`document.getElementById("search-start").blur()`);
    await browser.evaluate(`document.querySelector('[data-preset="port-fire"]').click()`);
    await sleep(1500);
    assert.match(await browser.evaluate(`document.getElementById("stat-status").textContent`), /Found/);
  });

  it("draws every algorithm's route in compare mode with toggles and identical-route flags", async () => {
    await browser.evaluate(`(() => { const s = document.getElementById("select-algo"); s.value = "all"; s.dispatchEvent(new Event("change")); })()`);
    await sleep(2500);
    const rows = await browser.evaluate(`document.querySelectorAll("#routes-list .route-row").length`);
    assert.ok(rows >= 6, `expected at least 6 route rows, got ${rows}`);
    const tableRows = await browser.evaluate(`document.querySelectorAll("#table-results-body tr").length`);
    assert.equal(tableRows, rows);
    const flags = await browser.evaluate(`[...document.querySelectorAll(".route-same")].map(e => e.textContent).join("|")`);
    assert.match(flags, /same route as/);
    const drawn = await browser.evaluate(`window.CTG_APP.state.routeLayers.size`);
    await browser.evaluate(`(() => { const b = document.querySelector('[data-route-toggle="dfs"]'); b.checked = false; b.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    assert.equal(await browser.evaluate(`window.CTG_APP.state.routeLayers.size`), drawn - 1);
    await browser.evaluate(`document.querySelector('[data-route-select="bfs"]').click()`);
    assert.equal(await browser.evaluate(`window.CTG_APP.state.selectedRouteKey`), "bfs");
  });

  it("inspects a road, saves a directional closure, reroutes, and resets it", async () => {
    await browser.evaluate(`(() => { const s = document.getElementById("select-algo"); s.value = "astar"; s.dispatchEvent(new Event("change")); })()`);
    await sleep(1500);
    const edgeId = await browser.evaluate(`window.CTG_APP.state.displayedResult.pathEdges[3]`);
    const costBefore = await browser.evaluate(`window.CTG_APP.state.displayedResult.totalCost`);
    await browser.evaluate(`window.CTG_APP.openRoadPopup("${edgeId}")`);
    await sleep(400);
    const inspector = await browser.evaluate(`document.querySelector(".road-inspector").textContent`);
    assert.match(inspector, /OSM way/);
    assert.match(inspector, /One-way/);
    assert.match(inspector, /Cost A → B/);
    await browser.evaluate(`(() => { const s = document.querySelector('.road-inspector [data-field="closed"]'); s.value = "both"; })()`);
    await browser.evaluate(`document.querySelector('.road-inspector [data-action="save-override"]').click()`);
    await sleep(1500);
    const after = await browser.evaluate(`window.CTG_APP.state.displayedResult`);
    assert.ok(!after.pathEdges.includes(edgeId), "route still uses the closed road");
    assert.ok(after.totalCost >= costBefore);
    assert.match(await browser.evaluate(`document.getElementById("btn-reset-overrides").textContent`), /\(1\)/);

    await browser.evaluate(`window.CTG_APP.openRoadPopup("${edgeId}")`);
    await sleep(400);
    await browser.evaluate(`document.querySelector('.road-inspector [data-action="reset-override"]').click()`);
    await sleep(1500);
    assert.equal(await browser.evaluate(`window.CTG_APP.state.displayedResult.totalCost`), costBefore);
  });

  it("applies a built-in scenario and changes the route cost", async () => {
    const base = await browser.evaluate(`window.CTG_APP.state.displayedResult.totalCost`);
    await browser.evaluate(`(() => { const s = document.getElementById("select-scenario"); s.value = "combined_emergency"; s.dispatchEvent(new Event("change")); })()`);
    await sleep(1500);
    assert.match(await browser.evaluate(`document.getElementById("scenario-desc").textContent`), /every road class/);
    assert.ok(await browser.evaluate(`window.CTG_APP.state.displayedResult.totalCost`) > base);
    await browser.evaluate(`(() => { const s = document.getElementById("select-scenario"); s.value = "normal"; s.dispatchEvent(new Event("change")); })()`);
    await sleep(1500);
  });

  it("creates, saves and activates a custom scenario in the studio", async () => {
    await browser.evaluate(`document.getElementById("btn-open-studio").click()`);
    await sleep(300);
    assert.ok(await browser.evaluate(`document.getElementById("studio-dialog").open`));
    await browser.evaluate(`document.getElementById("btn-studio-new").click()`);
    await sleep(300);
    await browser.evaluate(`(() => {
      document.getElementById("studio-name").value = "E2E Flooded Residential";
      document.querySelector('#studio-classes tr[data-class="residential"] [data-cond="rain"]').value = "2.5";
      document.getElementById("btn-studio-save").click();
    })()`);
    await sleep(800);
    await browser.evaluate(`document.getElementById("btn-studio-activate").click()`);
    await sleep(1200);
    await browser.evaluate(`document.getElementById("btn-close-studio").click()`);
    const selected = await browser.evaluate(`document.getElementById("select-scenario").selectedOptions[0].textContent`);
    assert.equal(selected, "E2E Flooded Residential");
    const saved = await browser.evaluate(`JSON.parse(localStorage.getItem("ctg-routing.v1.scenarios")).map(s => s.name)`);
    assert.ok(saved.includes("E2E Flooded Residential"));
  });

  it("compares scenarios and marks the results stale when inputs change", async () => {
    await browser.evaluate(`document.querySelector('[data-tab="tab-benchmark"]').click()`);
    await sleep(800);
    try {
      const checked = await browser.evaluate(`document.querySelectorAll("[data-compare-id]:checked").length`);
      await browser.evaluate(`document.getElementById("btn-compare-scenarios").click()`);
      await sleep(2000);
      assert.equal(await browser.evaluate(`document.querySelectorAll("#compare-body tr").length`), checked);
      assert.ok(await browser.evaluate(`document.getElementById("compare-stale").hidden`));
      await browser.evaluate(`(() => { const s = document.getElementById("slider-traffic"); s.value = String(Number(s.value) === 3 ? 2.5 : 3); s.dispatchEvent(new Event("input")); })()`);
      await sleep(1500);
      assert.equal(await browser.evaluate(`document.getElementById("compare-stale").hidden`), false);
    } finally {
      await browser.evaluate(`document.querySelector('[data-tab="tab-map"]').click()`);
      await sleep(500);
    }
  });

  it("reports a search stopped by a limit instead of claiming no route exists", async () => {
    await browser.evaluate(`(() => { const i = document.getElementById("limit-expansions"); i.value = "20"; i.dispatchEvent(new Event("change")); })()`);
    await sleep(1200);
    assert.match(await browser.evaluate(`document.getElementById("stat-status").textContent`), /expansion limit/);
    assert.equal(await browser.evaluate(`document.getElementById("stat-cost").textContent`), "STOPPED");
    await browser.evaluate(`(() => { const i = document.getElementById("limit-expansions"); i.value = "10000000"; i.dispatchEvent(new Event("change")); })()`);
    await sleep(1200);
  });

  it("lists expanded nodes in order and replays the search step by step", async () => {
    await browser.evaluate(`document.getElementById("btn-run-sim").click()`);
    await sleep(2000);
    const total = await browser.evaluate(`window.CTG_APP.state.displayedResult.visitedNodesOrder.length`);
    assert.match(await browser.evaluate(`document.getElementById("trace-summary").textContent`), /nodes expanded, in order/);
    assert.ok(await browser.evaluate(`document.querySelectorAll("#trace-list .trace-row").length`) > 5);

    await browser.evaluate(`document.querySelector('#trace-list [data-step="4"]').click()`);
    await sleep(300);
    assert.equal(await browser.evaluate(`window.CTG_APP.trace.current`), 4);
    assert.equal(await browser.evaluate(`window.CTG_APP.trace.shown`), 4);
    assert.match(await browser.evaluate(`document.getElementById("trace-detail").textContent`), new RegExp(`Step 5 of ${total.toLocaleString("en-US")}`));
    const expectedNode = await browser.evaluate(`window.CTG_APP.state.displayedResult.visitedNodesOrder[4]`);
    assert.match(await browser.evaluate(`document.getElementById("trace-detail").textContent`), new RegExp(expectedNode));

    await browser.evaluate(`document.querySelector('[data-trace="next"]').click()`);
    assert.equal(await browser.evaluate(`window.CTG_APP.trace.current`), 5);
    await browser.evaluate(`document.querySelector('[data-trace="prev"]').click()`);
    await browser.evaluate(`document.querySelector('[data-trace="prev"]').click()`);
    assert.equal(await browser.evaluate(`window.CTG_APP.trace.shown`), 3);

    await browser.evaluate(`(() => { const i = document.getElementById("trace-jump-input"); i.value = "20"; i.dispatchEvent(new Event("change")); })()`);
    assert.equal(await browser.evaluate(`window.CTG_APP.trace.current`), 19);
    assert.match(await browser.evaluate(`document.getElementById("trace-detail").textContent`), /reached from .* g = [\d.]+ · h = [\d.]+ · f = [\d.]+/);

    await browser.evaluate(`document.querySelector('[data-trace="play"]').click()`);
    await sleep(1200);
    await browser.evaluate(`document.querySelector('[data-trace="play"]').click()`);
    const afterPlay = await browser.evaluate(`window.CTG_APP.trace.current`);
    assert.ok(afterPlay > 19, `playback did not advance (${afterPlay})`);
    await sleep(500);
    assert.equal(await browser.evaluate(`window.CTG_APP.trace.current`), afterPlay);

    await browser.evaluate(`document.querySelector('[data-trace="last"]').click()`);
    assert.match(await browser.evaluate(`document.getElementById("trace-detail").textContent`), /goal reached/);

    await browser.evaluate(`document.getElementById("btn-hide-trace").click()`);
    await sleep(200);
    assert.ok(await browser.evaluate(`document.getElementById("trace-panel").hidden`));
    assert.equal(await browser.evaluate(`document.getElementById("btn-show-trace").hidden`), false);
    await browser.evaluate(`document.getElementById("btn-show-trace").click()`);
    await sleep(200);
    assert.equal(await browser.evaluate(`document.getElementById("trace-panel").hidden`), false);
  });

  it("keeps the controls and a visible map on a narrow screen", async () => {
    await browser.resize(800, 1000);
    await sleep(800);
    const mapHeight = await browser.evaluate(`document.getElementById("map").getBoundingClientRect().height`);
    assert.ok(mapHeight >= 400, `map height ${mapHeight}`);
    assert.ok(await browser.evaluate(`document.getElementById("search-start").getBoundingClientRect().width > 300`));
    await browser.resize(1600, 1000);
    assert.deepEqual(browser.errors, []);
  });
});

describe("browser: missing dataset", { skip, timeout: 60000 }, () => {
  it("shows the setup panel and disables routing when the graph file is missing", async () => {
    const site = await startStaticServer({ hide: ["js/chattogram_graph.js"] });
    const browser = await launch();
    try {
      await browser.goto(site.url, `document.readyState === "complete"`);
      await sleep(1000);
      assert.equal(await browser.evaluate(`document.getElementById("setup-panel").hidden`), false);
      assert.ok(await browser.evaluate(`document.getElementById("search-start").disabled`));
      assert.match(await browser.evaluate(`document.getElementById("setup-panel").textContent`), /build_graph\.js/);
    } finally {
      await browser.close();
      site.server.close();
    }
  });
});

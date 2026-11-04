/* API tests: run server.js on a random port with a throwaway state file. */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("../server.js");

describe("API server", { timeout: 120000 }, () => {
  let server, base, stateDir;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };

  before(async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctg-api-"));
    const app = createApp({ stateFile: path.join(stateDir, "state.json") });
    server = http.createServer(app.handle);
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("reports health, readiness and metadata", async () => {
    assert.deepEqual((await call("GET", "/api/health")).data, { status: "ok", datasetReady: true, placesReady: true });
    assert.equal((await call("GET", "/api/ready")).status, 200);
    const meta = (await call("GET", "/api/metadata")).data;
    assert.ok(meta.graph.nodeCount > 1000);
    assert.equal(meta.revision, 0);
    assert.ok(meta.limits.defaults.maxExpansions > 0);
  });

  it("serves the web app and the API docs, but not private folders", async () => {
    assert.match((await call("GET", "/")).data, /Chattogram Emergency Routing Simulator/);
    assert.match((await call("GET", "/docs")).data, /\/api\/routes/);
    assert.equal((await call("GET", "/openapi.json")).data.openapi, "3.0.3");
    assert.equal((await call("GET", "/.state/state.json")).status, 404);
    assert.equal((await call("GET", "/tools/.cache/x.json")).status, 404);
  });

  it("searches places and returns one place by id", async () => {
    const r = await call("GET", "/api/places?q=medical%20college&limit=5");
    assert.equal(r.status, 200);
    assert.ok(r.data.total > 0 && r.data.places.length <= 5);
    const one = await call("GET", `/api/places/${r.data.places[0].id}`);
    assert.equal(one.data.id, r.data.places[0].id);
    assert.equal((await call("GET", "/api/places/n0")).status, 404);
    assert.equal((await call("GET", "/api/places?limit=500")).status, 422);
  });

  it("resolves coordinates within the snapping limit only", async () => {
    const ok = await call("POST", "/api/resolve", { lat: 22.3593, lng: 91.8307 });
    assert.equal(ok.status, 200);
    assert.ok(ok.data.distanceM <= 500);
    assert.equal((await call("POST", "/api/resolve", { lat: 22.0, lng: 91.0 })).status, 404); // far outside the network
    assert.equal((await call("POST", "/api/resolve", { lat: 22.36, lng: 91.83, maxDistanceM: 5000 })).status, 422);
    assert.equal((await call("POST", "/api/resolve", "{not json")).status, 422);
  });

  it("routes with one algorithm, returning road-following GeoJSON and a bounded trace", async () => {
    const r = await call("POST", "/api/routes", { start: "epz_circle", goal: "cmch", algorithm: "astar" });
    assert.equal(r.status, 200);
    const res = r.data.results[0];
    assert.equal(res.status, "found");
    assert.equal(res.geometry.type, "LineString");
    assert.ok(res.geometry.coordinates.length > res.routeNodes, "geometry should include road shape points");
    const [lng, lat] = res.geometry.coordinates[0];
    assert.ok(lat > 22 && lat < 23 && lng > 91 && lng < 92, "coordinates are [lng, lat]");
    assert.ok(res.trace.nodes.length <= 300);
  });

  it("runs all algorithms on one snapshot and accepts coordinates and place ids as endpoints", async () => {
    const place = (await call("GET", "/api/places?q=medical%20college&limit=1")).data.places[0];
    const r = await call("POST", "/api/routes", { start: { lat: 22.2929, lng: 91.7811 }, goal: place.id, algorithm: "all", includeZeroHeuristic: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.results.map(x => x.algorithm), ["bfs", "dfs", "ucs", "ids", "astar", "gbfs", "astar0"]);
    const cost = k => r.data.results.find(x => x.algorithm === k).cost;
    assert.ok(Math.abs(cost("ucs") - cost("astar")) < 0.011);
    assert.equal(r.data.goal.place, place.id);
  });

  it("reports search limits as statuses and validates inputs", async () => {
    const r = await call("POST", "/api/routes", { start: "epz_circle", goal: "cmch", algorithm: "ucs", limits: { maxExpansions: 10 } });
    assert.equal(r.data.results[0].status, "expansion_limit");
    assert.equal(r.data.results[0].geometry, null);
    assert.equal((await call("POST", "/api/routes", { start: "nope", goal: "cmch" })).status, 404);
    assert.equal((await call("POST", "/api/routes", { start: "epz_circle", goal: "cmch", algorithm: "magic" })).status, 422);
    assert.equal((await call("POST", "/api/routes", { start: "epz_circle", goal: "cmch", env: { trafficLevel: 99 } })).status, 422);
    assert.equal((await call("POST", "/api/routes", { start: "epz_circle", goal: "cmch", scenarioId: "missing" })).status, 404);
  });

  it("returns viewport roads with a limit and inspects one road", async () => {
    const roads = await call("GET", "/api/roads?bbox=22.33,91.81,22.37,91.84&limit=50");
    assert.equal(roads.data.type, "FeatureCollection");
    assert.equal(roads.data.features.length, 50);
    assert.equal(roads.data.truncated, true);
    const filtered = await call("GET", "/api/roads?bbox=22.33,91.81,22.37,91.84&classes=primary&limit=10000");
    assert.ok(filtered.data.features.every(f => f.properties.highway === "primary"));
    const id = roads.data.features[0].id;
    const road = await call("GET", `/api/road?id=${id}`);
    assert.equal(road.data.id, id);
    assert.ok("osmId" in road.data && "oneway" in road.data && "costForward" in road.data);
    assert.equal((await call("GET", "/api/roads?bbox=1,2,3")).status, 422);
    assert.equal((await call("GET", "/api/road?id=e0")).status, 404);
  });

  it("saves, applies and resets road overrides with a revision counter", async () => {
    const before = await call("POST", "/api/routes", { start: "epz_circle", goal: "cmch", algorithm: "astar" });
    const edge = before.data.results[0].edges[2];
    const saved = await call("PUT", `/api/overrides?id=${edge}`, { closed: "both" });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.revision, 1);
    const afterClose = await call("POST", "/api/routes", { start: "epz_circle", goal: "cmch", algorithm: "astar" });
    assert.ok(!afterClose.data.results[0].edges.includes(edge));
    assert.equal(afterClose.data.snapshot.overrides, 1);
    assert.equal((await call("PUT", `/api/overrides?id=${edge}`, { traffic: 50 })).status, 422);
    assert.equal((await call("DELETE", `/api/overrides?id=${edge}`)).status, 204);
    const restored = await call("POST", "/api/routes", { start: "epz_circle", goal: "cmch", algorithm: "astar" });
    assert.equal(restored.data.results[0].cost, before.data.results[0].cost);
    assert.equal((await call("DELETE", "/api/overrides")).status, 204);
  });

  it("manages custom scenarios and protects built-in ones", async () => {
    const list = (await call("GET", "/api/scenarios")).data.scenarios;
    assert.ok(list.some(s => s.id === "heavy_traffic" && s.builtIn));
    const created = await call("POST", "/api/scenarios", { name: "API Flood", classConditions: { residential: { rain: 2.5 } } });
    assert.equal(created.status, 201);
    const id = created.data.id;
    const updated = await call("PUT", `/api/scenarios/${id}`, { name: "API Flood v2", classConditions: { residential: { rain: 1.2 } } });
    assert.equal(updated.data.name, "API Flood v2");
    assert.equal((await call("PUT", "/api/scenarios/heavy_traffic", { name: "x" })).status, 409);
    assert.equal((await call("DELETE", "/api/scenarios/normal")).status, 409);
    assert.equal((await call("POST", "/api/scenarios", { name: "" })).status, 422);

    const cmp = await call("POST", "/api/compare-scenarios", { start: "epz_circle", goal: "cmch", scenarioIds: ["normal", "heavy_traffic", id] });
    assert.equal(cmp.status, 200);
    assert.equal(cmp.data.comparisons.length, 3);
    const costs = cmp.data.comparisons.map(c => c.result.cost);
    assert.ok(costs[1] > costs[0], "heavy traffic should cost more than normal");
    assert.equal((await call("POST", "/api/compare-scenarios", { start: "epz_circle", goal: "cmch", scenarioIds: Array(9).fill("normal") })).status, 422);

    assert.equal((await call("DELETE", `/api/scenarios/${id}`)).status, 204);
    assert.equal((await call("PUT", `/api/scenarios/${id}`, { name: "gone" })).status, 404);
  });

  it("persists state to disk between server instances", async () => {
    await call("POST", "/api/scenarios", { name: "Persisted" });
    const app2 = createApp({ stateFile: path.join(stateDir, "state.json") });
    const s2 = http.createServer(app2.handle);
    await new Promise(r => s2.listen(0, "127.0.0.1", r));
    try {
      const res = await fetch(`http://127.0.0.1:${s2.address().port}/api/scenarios`);
      const names = (await res.json()).scenarios.map(s => s.name);
      assert.ok(names.includes("Persisted"));
    } finally {
      s2.close();
    }
  });
});

describe("API server without a dataset", () => {
  it("answers 503 on dataset endpoints", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctg-nodata-"));
    const app = createApp({ stateFile: path.join(emptyDir, "state.json"), dataDir: emptyDir });
    const server = http.createServer(app.handle);
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      assert.equal((await (await fetch(base + "/api/health")).json()).datasetReady, false);
      assert.equal((await fetch(base + "/api/ready")).status, 503);
      const r = await fetch(base + "/api/routes", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      assert.equal(r.status, 503);
      assert.match((await r.json()).error, /build_graph/);
    } finally {
      server.close();
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

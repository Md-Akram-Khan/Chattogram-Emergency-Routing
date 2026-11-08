const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const builder = require("../tools/build_graph.js");
const { loadModules, ROOT } = require("./helpers/load");

const plain = x => JSON.parse(JSON.stringify(x));

describe("builder: OSM parsing", () => {
  it("reads one-way tags, roundabouts and motorways", () => {
    assert.equal(builder.onewayOf({ oneway: "yes" }), 1);
    assert.equal(builder.onewayOf({ oneway: "-1" }), -1);
    assert.equal(builder.onewayOf({ oneway: "no", junction: "roundabout" }), 0);
    assert.equal(builder.onewayOf({ junction: "roundabout" }), 1);
    assert.equal(builder.onewayOf({ highway: "motorway" }), 1);
    assert.equal(builder.onewayOf({ highway: "residential" }), 0);
  });

  it("splits ways at shared nodes and keeps way id, class and direction", () => {
    const g = i => ({ lat: 22.3, lon: 91.8 + i * 0.001 });
    const osm = { elements: [
      { type: "way", id: 10, nodes: [1, 2, 3], geometry: [g(0), g(1), g(2)], tags: { highway: "primary", oneway: "yes", name: "A Road" } },
      { type: "way", id: 11, nodes: [2, 4], geometry: [g(1), { lat: 22.31, lon: 91.801 }], tags: { highway: "residential" } },
      { type: "way", id: 12, nodes: [5, 6], geometry: [g(5), g(6)], tags: { highway: "footway" } }
    ] };
    const { segments } = builder.buildSegments(osm);
    assert.equal(segments.length, 3);
    const first = segments.find(s => s.u === "n1");
    assert.equal(first.v, "n2");
    assert.equal(first.osmId, 10);
    assert.equal(first.dir, 1);
    assert.equal(first.highway, "primary");
  });

  it("contracts pass-through nodes only when both halves allow the same direction", () => {
    const edge = (u, v, dir) => ({ u, v, dir, coords: [[0, 0], [0, 0.001]], length: 0.1, highway: "primary", name: "", surface: "", osmId: 1 });
    const same = new Map([["a|b", edge("a", "b", 1)], ["b|c", edge("b", "c", 1)]]);
    assert.equal(builder.contractDegreeTwo(same).size, 1);
    const mixed = new Map([["a|b", edge("a", "b", 1)], ["b|c", edge("b", "c", 0)]]);
    assert.equal(builder.contractDegreeTwo(mixed).size, 2);
    const reversed = new Map([["a|b", edge("a", "b", 1)], ["b|c", edge("c", "b", -1)]]);
    const out = [...builder.contractDegreeTwo(reversed).values()];
    assert.equal(out.length, 1);
    assert.equal(out[0].dir, out[0].u === "a" ? 1 : -1);
  });

  it("keeps the largest strongly connected component", () => {
    const e = (u, v, dir) => ({ u, v, dir });
    const scc = builder.largestStronglyConnected([e("a", "b", 0), e("b", "c", 0), e("c", "d", 1)]);
    assert.deepEqual([...scc].sort(), ["a", "b", "c"]);
  });

  it("categorises places into groups", () => {
    assert.deepEqual(plain(builder.placeCategory({ amenity: "hospital" })), { category: "hospital", group: "Health" });
    assert.deepEqual(plain(builder.placeCategory({ shop: "mall" })), { category: "mall", group: "Shopping" });
    assert.deepEqual(plain(builder.placeCategory({ place: "suburb" })), { category: "suburb", group: "Area / Neighbourhood" });
    assert.equal(builder.placeCategory({ building: "yes" }), null);
  });

  it("splits the study area into place tiles that cover it exactly", () => {
    const tiles = builder.placeTiles([22.2, 91.7, 22.4, 91.9], 2);
    assert.equal(tiles.length, 4);
    assert.deepEqual(tiles[0], [22.2, 91.7, 22.3, 91.8]);
    assert.deepEqual(tiles[3], [22.3, 91.8, 22.4, 91.9]);
  });

  it("validates command-line study areas", () => {
    assert.deepEqual(builder.parseArgs(["--area", "city"]).bbox, [22.23, 91.73, 22.43, 91.88]);
    assert.deepEqual(builder.parseArgs(["--bbox", "22.3,91.8,22.31,91.81"]).bbox, [22.3, 91.8, 22.31, 91.81]);
    assert.throws(() => builder.parseArgs(["--bbox", "22.4,91.8,22.3,91.9"]), /S < N/);
    assert.throws(() => builder.parseArgs(["--area", "dhaka"]), /Unknown --area/);
  });

  it("honours Retry-After in seconds and as a date", () => {
    const res = h => ({ headers: { get: () => h } });
    assert.equal(builder.retryAfterMs(res("7")), 7000);
    assert.equal(builder.retryAfterMs(res(null)), null);
    const ms = builder.retryAfterMs(res(new Date(Date.now() + 5000).toUTCString()));
    assert.ok(ms > 3000 && ms <= 5000);
  });
});

const graphFile = path.join(ROOT, "js", "chattogram_graph.js");
const skipData = fs.existsSync(graphFile) ? false : "dataset not built (run node tools/build_graph.js)";

describe("generated dataset", { skip: skipData }, () => {
  const ctx = skipData ? null : loadModules({ data: true });
  const G = ctx && ctx.CHATTOGRAM_GRAPH;
  const P = ctx && ctx.CHATTOGRAM_PLACES;
  const hav = (a, b) => ctx.DynamicCostSystem.haversineDistance(a[0], a[1], b[0], b[1]);

  it("has consistent nodes and edges whose geometry follows the road", () => {
    const pairs = new Set();
    G.edges.forEach(e => {
      const u = G.nodes[e.u], v = G.nodes[e.v];
      assert.ok(u && v, `${e.id} has a missing endpoint`);
      assert.ok(hav([u.lat, u.lng], e.geom[0]) < 0.002, `${e.id} does not start at its node`);
      assert.ok(hav([v.lat, v.lng], e.geom[e.geom.length - 1]) < 0.002, `${e.id} does not end at its node`);
      let len = 0;
      for (let i = 1; i < e.geom.length; i++) len += hav(e.geom[i - 1], e.geom[i]);
      assert.ok(Math.abs(len - e.distance_km) < 0.01 + 0.01 * e.distance_km, `${e.id} length ${e.distance_km} vs drawn ${len}`);
      assert.ok([-1, 0, 1].includes(e.dir));
      assert.ok(Number.isInteger(e.osm_id) && e.osm_id > 0);
      const key = [e.u, e.v].sort().join("|");
      assert.ok(!pairs.has(key), `duplicate node pair ${key}`);
      pairs.add(key);
    });
    assert.equal(G.meta.nodeCount, Object.keys(G.nodes).length);
    assert.equal(G.meta.edgeCount, G.edges.length);
    assert.ok(G.meta.checksum && G.meta.checksum.length === 64);
  });

  it("is strongly connected when one-way streets are respected", () => {
    const out = {}, back = {};
    Object.keys(G.nodes).forEach(id => { out[id] = []; back[id] = []; });
    G.edges.forEach(e => {
      if (e.dir >= 0) { out[e.u].push(e.v); back[e.v].push(e.u); }
      if (e.dir <= 0) { out[e.v].push(e.u); back[e.u].push(e.v); }
    });
    const reach = (adj, s) => {
      const seen = new Set([s]), stack = [s];
      while (stack.length) adj[stack.pop()].forEach(n => { if (!seen.has(n)) { seen.add(n); stack.push(n); } });
      return seen.size;
    };
    const n = Object.keys(G.nodes).length;
    assert.equal(reach(out, "cmch"), n);
    assert.equal(reach(back, "cmch"), n);
  });

  it("places reference existing nodes and report their snapping distance", () => {
    if (!P) return;
    assert.equal(P.meta.placeCount, P.places.length);
    P.places.forEach(p => {
      const node = G.nodes[p.node];
      assert.ok(node, `${p.id} references missing node ${p.node}`);
      const d = Math.round(hav([p.lat, p.lng], [node.lat, node.lng]) * 1000);
      assert.ok(Math.abs(d - p.snapM) <= 2, `${p.id} snap ${p.snapM} vs ${d}`);
    });
  });

  it("A* matches UCS on real routes while respecting one-way streets", () => {
    const S = ctx.GraphSearchSuite;
    const ids = Object.keys(G.nodes);
    const env = { ...ctx.DynamicCostSystem.defaultEnv, overrides: {}, blockedEdges: new Set(), blockedNodes: new Set() };
    const byId = new Map(G.edges.map(e => [e.id, e]));
    let seed = 5;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let k = 0; k < 12; k++) {
      const s = ids[Math.floor(rnd() * ids.length)], t = ids[Math.floor(rnd() * ids.length)];
      const u = S.runUCS(s, t, G, env), a = S.runAStar(s, t, G, env);
      assert.equal(u.status, "found");
      assert.ok(Math.abs(u.totalCost - a.totalCost) < 0.011);
      a.pathEdges.forEach((id, i) => {
        const e = byId.get(id);
        const direction = e.u === a.path[i] ? 1 : -1;
        assert.ok(!e.dir || direction === e.dir, `${id} driven the wrong way`);
      });
    }
  });

  it("round-trips the compact encoding", () => {
    const decoded = { meta: G.meta, nodes: G.nodes, edges: G.edges };
    const order = builder.nodeOrder(decoded);
    const payload = builder.encodeGraph(plain(decoded), order);
    builder.verifyGraphEncoding(plain(decoded), payload);
  });
});

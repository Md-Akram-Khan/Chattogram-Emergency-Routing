const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadModules, makeGraph, neutralEnv } = require("./helpers/load");

const ctx = loadModules();
const { GraphSearchSuite: S, DynamicCostSystem: D, ScenarioSystem, PriorityQueue, SpatialIndex } = ctx;
const plain = x => JSON.parse(JSON.stringify(x));
const ALL = ["bfs", "dfs", "ucs", "ids", "astar", "gbfs", "astar0"];

const diamond = () => makeGraph(
  { A: [22.30, 91.80], B: [22.31, 91.81], C: [22.30, 91.81], E: [22.30, 91.82], D: [22.30, 91.83] },
  [["A", "B", 9], ["B", "D", 9], ["A", "C", 1.1], ["C", "E", 1.1], ["E", "D", 1.1]]
);

describe("PriorityQueue", () => {
  it("returns elements in priority order, ties in insertion order", () => {
    const pq = new PriorityQueue();
    [["c", 3], ["a", 1], ["b1", 2], ["b2", 2], ["d", 4]].forEach(([e, p]) => pq.enqueue(e, p));
    const out = [];
    while (!pq.isEmpty()) out.push(pq.dequeue());
    assert.deepEqual(out, ["a", "b1", "b2", "c", "d"]);
  });
});

describe("search algorithms", () => {
  it("BFS finds the minimum-hop route and UCS / A* the minimum-cost route", () => {
    const g = diamond(), env = neutralEnv();
    const bfs = S.runBFS("A", "D", g, env);
    assert.deepEqual(plain(bfs.path), ["A", "B", "D"]);
    for (const key of ["ucs", "astar", "astar0"]) {
      const r = S.runAlgorithm(key, "A", "D", g, env);
      assert.deepEqual(plain(r.path), ["A", "C", "E", "D"], key);
      assert.equal(r.status, "found");
      assert.equal(r.routeNodes, 4);
    }
  });

  it("IDS finds a minimum-hop route", () => {
    const r = S.runIDS("A", "D", diamond(), neutralEnv());
    assert.equal(r.status, "found");
    assert.equal(r.path.length, 3);
  });

  it("every algorithm returns a valid connected path and consistent metrics", () => {
    const g = diamond(), env = neutralEnv();
    for (const key of ALL) {
      const r = S.runAlgorithm(key, "A", "D", g, env);
      assert.equal(r.found, true, key);
      assert.equal(r.path[0], "A");
      assert.equal(r.path[r.path.length - 1], "D");
      assert.equal(r.pathEdges.length, r.path.length - 1);
      assert.ok(r.nodesGenerated >= r.nodesExpanded - 1, `${key}: generated ${r.nodesGenerated} < expanded ${r.nodesExpanded}`);
    }
  });

  it("A* matches UCS on random graphs (heuristic is admissible)", () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 25; trial++) {
      const nodes = {};
      for (let i = 0; i < 30; i++) nodes[`n${i}`] = [22.3 + rnd() * 0.05, 91.8 + rnd() * 0.05];
      const edges = [];
      const ids = Object.keys(nodes);
      for (let i = 1; i < ids.length; i++) edges.push([ids[i - 1], ids[i]]);
      for (let k = 0; k < 40; k++) edges.push([ids[Math.floor(rnd() * 30)], ids[Math.floor(rnd() * 30)]]);
      const hav = (a, b) => D.haversineDistance(nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1]);
      const g = makeGraph(nodes, edges.filter(([a, b]) => a !== b).map(([a, b]) => [a, b, hav(a, b) * (1 + rnd())]));
      const env = neutralEnv({ trafficLevel: rnd() * 3, floodLevel: rnd() * 2, timeOfDay: "night", safetyPriority: 1.5 });
      const u = S.runUCS("n0", "n29", g, env), a = S.runAStar("n0", "n29", g, env);
      assert.ok(Math.abs(u.totalCost - a.totalCost) < 0.011, `trial ${trial}: UCS ${u.totalCost} vs A* ${a.totalCost}`);
    }
  });

  it("treats identical start and destination as a zero-length route", () => {
    for (const key of ALL) {
      const r = S.runAlgorithm(key, "A", "A", diamond(), neutralEnv());
      assert.equal(r.status, "found", key);
      assert.deepEqual(plain(r.path), ["A"]);
      assert.equal(r.totalCost, 0);
    }
  });
});

describe("directionality and closures", () => {
  const oneWay = () => makeGraph(
    { A: [22.30, 91.80], B: [22.30, 91.81], C: [22.31, 91.805] },
    [["A", "B", 1, { dir: 1 }], ["A", "C", 5], ["C", "B", 5]]
  );

  it("never drives a one-way street the wrong way", () => {
    const g = oneWay();
    assert.deepEqual(plain(S.runUCS("A", "B", g, neutralEnv()).path), ["A", "B"]);
    assert.deepEqual(plain(S.runUCS("B", "A", g, neutralEnv()).path), ["B", "C", "A"]);
  });

  it("allows contraflow when one-way rules are switched off", () => {
    assert.deepEqual(plain(S.runUCS("B", "A", oneWay(), neutralEnv({ respectOneWay: false })).path), ["B", "A"]);
  });

  it("closes a road in one direction only", () => {
    const g = oneWay();
    const env = neutralEnv({ overrides: { e2: { closed: "forward" } } });
    assert.equal(S.runUCS("C", "A", g, env).path.join(""), "CA");
    const r = S.runUCS("A", "C", g, env);
    assert.deepEqual(plain(r.path), ["A", "B", "C"]);
  });

  it("reports unreachable when every way is closed", () => {
    const env = neutralEnv({ blockedEdges: new Set(["e1", "e3"]) });
    for (const key of ALL) {
      const r = S.runAlgorithm(key, "A", "B", oneWay(), env);
      assert.equal(r.status, "unreachable", key);
      assert.equal(r.found, false);
      assert.deepEqual(plain(r.path), []);
    }
  });
});

describe("search limits", () => {
  const line = () => {
    const nodes = {}, edges = [];
    for (let i = 0; i < 50; i++) nodes[`n${i}`] = [22.3, 91.8 + i * 0.001];
    for (let i = 1; i < 50; i++) edges.push([`n${i - 1}`, `n${i}`, 0.1]);
    return makeGraph(nodes, edges);
  };

  it("stops at the expansion limit and says so", () => {
    for (const key of ALL) {
      const r = S.runAlgorithm(key, "n0", "n49", line(), neutralEnv(), { limits: { maxExpansions: 5 } });
      assert.equal(r.status, "expansion_limit", key);
      assert.equal(r.found, false);
    }
  });

  it("stops DFS and IDS at the depth limit and says so", () => {
    for (const key of ["dfs", "ids"]) {
      const r = S.runAlgorithm(key, "n0", "n49", line(), neutralEnv(), { limits: { maxDepth: 10 } });
      assert.equal(r.status, "depth_limit", key);
    }
  });

  it("lets DFS and IDS go as deep as needed by default", () => {
    const nodes = {}, edges = [];
    for (let i = 0; i < 800; i++) nodes[`n${i}`] = [22.3, 91.8 + i * 0.0005];
    for (let i = 1; i < 800; i++) edges.push([`n${i - 1}`, `n${i}`, 0.05]);
    const g = makeGraph(nodes, edges);
    for (const key of ["dfs", "ids"]) {
      assert.equal(S.runAlgorithm(key, "n0", "n799", g, neutralEnv()).status, "found", key);
      assert.equal(S.runAlgorithm(key, "n0", "n799", g, neutralEnv(), { limits: { maxDepth: 600 } }).status, "depth_limit", key);
    }
    assert.equal(S.normalizeLimits({}).maxDepth, 0);
  });

  it("rejects limits outside their bounds", () => {
    assert.throws(() => S.normalizeLimits({ maxExpansions: 0 }), /maxExpansions/);
    assert.throws(() => S.normalizeLimits({ timeoutMs: 10 ** 9 }), /timeoutMs/);
  });
});

describe("cost model, precedence and weights", () => {
  const edge = { id: "e1", u: "A", v: "B", distance_km: 1, road_type: "avenue", flood_susceptibility: 0.5, night_safety: 0.8,
    junction_delay_sec: 0, port_zone: false, name: "x", dir: 0, highway: "residential" };

  it("applies baseline, scenario class, scenario road and user override in order", () => {
    const scenario = { classConditions: { residential: { traffic: 1.5, rain: 0.5 } }, edgeConditions: { e1: { rain: 1.2 } } };
    const env = neutralEnv({ scenario, overrides: { e1: { traffic: 3.5 } } });
    const c = D.edgeConditions(edge, env);
    assert.equal(c.traffic, 3.5);
    assert.equal(c.rain, 1.2);
    assert.equal(D.edgeConditions(edge, neutralEnv({ scenario })).traffic, 1.5);
    assert.equal(D.edgeConditions(edge, neutralEnv()).traffic, null);
  });

  it("lets a saved override reopen a road that the scenario closes", () => {
    const scenario = { classConditions: { residential: { closed: "both" } }, edgeConditions: {} };
    assert.equal(D.calculateEdgeCost(edge, neutralEnv({ scenario })), Infinity);
    assert.notEqual(D.calculateEdgeCost(edge, neutralEnv({ scenario, overrides: { e1: { closed: "none" } } })), Infinity);
  });

  it("weight 0 removes a condition's effect; higher weights raise cost", () => {
    const env = w => neutralEnv({ overrides: { e1: { traffic: 3.5, condition: 1 } }, weights: { traffic: w, condition: w, rain: 1, safety: 0 } });
    const c0 = D.calculateEdgeCost(edge, env(0)), c1 = D.calculateEdgeCost(edge, env(1)), c5 = D.calculateEdgeCost(edge, env(5));
    assert.equal(c0, 1);
    assert.ok(c1 > c0 && c5 > c1);
  });
});

describe("scenarios", () => {
  it("has the six built-in scenarios", () => {
    assert.deepEqual(plain(ScenarioSystem.builtIns().map(s => s.name)), [
      "Normal Day", "Heavy Traffic", "Heavy Rain and Waterlogging", "Night Travel", "Road Blockage", "Combined Emergency"
    ]);
  });

  it("validates custom scenarios", () => {
    assert.throws(() => ScenarioSystem.validate({ name: "" }), /name is required/);
    assert.throws(() => ScenarioSystem.validate({ name: "x", classConditions: { motorway: { traffic: 9 } } }), /traffic/);
    assert.throws(() => ScenarioSystem.validate({ name: "x", classConditions: { highway: {} } }), /unknown road class/);
    assert.throws(() => ScenarioSystem.validate({ name: "x", weights: { traffic: 11, condition: 1, rain: 1, safety: 1 } }), /weight/);
    const ok = ScenarioSystem.validate({ name: " Flood ", classConditions: { residential: { rain: "2.5", traffic: "" } }, edgeConditions: { e5: { closed: "both" } } });
    assert.equal(ok.name, "Flood");
    assert.deepEqual(plain(ok.classConditions), { residential: { rain: 2.5 } });
    assert.deepEqual(plain(ok.edgeConditions), { e5: { closed: "both" } });
  });

  it("duplicates a scenario with a new id", () => {
    const original = ScenarioSystem.builtIns()[1];
    const copy = ScenarioSystem.duplicate(original);
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.builtIn, false);
    assert.equal(copy.name, "Heavy Traffic (copy)");
    assert.deepEqual(plain(copy.classConditions), plain(original.classConditions));
  });
});

describe("spatial index", () => {
  it("nearest matches a brute-force search, and box queries are exact", () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pts = Array.from({ length: 500 }, (_, i) => ({ i, lat: 22.2 + rnd() * 0.2, lng: 91.7 + rnd() * 0.2 }));
    const index = new SpatialIndex(0.005);
    pts.forEach(p => index.insertPoint(p, p.lat, p.lng));
    for (let k = 0; k < 50; k++) {
      const q = [22.2 + rnd() * 0.2, 91.7 + rnd() * 0.2];
      const brute = pts.reduce((best, p) => {
        const d = SpatialIndex.haversine(q[0], q[1], p.lat, p.lng);
        return d < best.d ? { p, d } : best;
      }, { p: null, d: Infinity });
      assert.equal(index.nearest(q[0], q[1]).item, brute.p);
    }
    const box = [22.25, 91.75, 22.3, 91.8];
    const expected = pts.filter(p => p.lat >= box[0] && p.lat <= box[2] && p.lng >= box[1] && p.lng <= box[3]);
    assert.equal(index.query(...box).length, expected.length);
  });
});

#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");

const ROOT = __dirname;
const STATIC_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".md": "text/markdown; charset=utf-8" };
const STATIC_DENY = /^(\.git|\.state|tools\/\.cache|tools\/\.backups|node_modules)(\/|$)/;
const ROAD_LIMIT_DEFAULT = 2500, ROAD_LIMIT_MAX = 10000;
const PLACE_LIMIT_DEFAULT = 20, PLACE_LIMIT_MAX = 100;
const SNAP_DEFAULT_M = 500, SNAP_MAX_M = 2000;
const TRACE_LIMIT = 300;
const MAX_BODY_BYTES = 1 << 20;

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function loadEngine(dataDir) {
  const context = { performance, console };
  context.window = context;
  vm.createContext(context);
  const run = (rel, dir = ROOT) => {
    const src = fs.readFileSync(path.join(dir, rel), "utf8")
      .replace(/^const (\w+) =/m, "var $1 =")
      .replace(/^class (\w+)/m, "var $1 = class $1");
    vm.runInContext(src, context, { filename: rel });
  };
  const errors = [];
  ["chattogram_graph.js", "chattogram_places.js"].forEach(rel => {
    try { run(rel, dataDir); } catch (err) { errors.push(`${rel}: ${err.code === "ENOENT" ? "file not found" : err.message}`); }
  });
  ["js/spatial_index.js", "js/dynamic_cost.js", "js/scenarios.js", "js/algorithms.js"].forEach(rel => run(rel));
  return { ctx: context, loadErrors: errors };
}

function makeStore(file, ScenarioSystem) {
  let state = { revision: 0, overrides: {}, scenarios: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    state = {
      revision: raw.revision || 0,
      overrides: raw.overrides || {},
      scenarios: (raw.scenarios || []).map(s => ScenarioSystem.validate(s))
    };
  } catch (err) { }
  const save = () => {
    state.revision++;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  };
  return { get: () => state, save };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new ApiError(422, "request body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new ApiError(422, "request body is not valid JSON")); }
    });
    req.on("error", reject);
  });
}

function num(value, name, lo, hi, fallback) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new ApiError(422, `${name} is required`);
  }
  const x = Number(value);
  if (!Number.isFinite(x) || x < lo || x > hi) throw new ApiError(422, `${name} must be a number between ${lo} and ${hi}`);
  return x;
}

function parseBbox(value) {
  if (!value) throw new ApiError(422, "bbox is required as south,west,north,east");
  const b = String(value).split(",").map(Number);
  if (b.length !== 4 || b.some(x => !Number.isFinite(x)) || b[0] >= b[2] || b[1] >= b[3]) {
    throw new ApiError(422, "bbox must be south,west,north,east with south < north and west < east");
  }
  return b;
}

function createApp({ stateFile = path.join(ROOT, ".state", "state.json"), dataDir = path.join(ROOT, "js") } = {}) {
  const { ctx, loadErrors } = loadEngine(dataDir);
  const { DynamicCostSystem: D, ScenarioSystem, GraphSearchSuite: S, SpatialIndex } = ctx;
  const graph = ctx.CHATTOGRAM_GRAPH || null;
  const placesData = ctx.CHATTOGRAM_PLACES || null;
  const ready = !!(graph && graph.edges && graph.edges.length);
  const store = makeStore(stateFile, ScenarioSystem);

  const edgeById = new Map(ready ? graph.edges.map(e => [e.id, e]) : []);
  const places = placesData ? placesData.places : [];
  const placeById = new Map(places.map(p => [p.id, p]));
  const nodeIndex = new SpatialIndex(0.004);
  const edgeIndex = new SpatialIndex(0.01);
  if (ready) {
    Object.values(graph.nodes).forEach(n => nodeIndex.insertPoint(n, n.lat, n.lng));
    graph.edges.forEach(e => {
      const lats = e.geom.map(p => p[0]), lngs = e.geom.map(p => p[1]);
      edgeIndex.insertBox(e, Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs));
    });
  }

  const requireReady = () => {
    if (!ready) throw new ApiError(503, `road dataset unavailable: ${loadErrors.join("; ") || "graph is empty"}. Run node tools/build_graph.js`);
  };
  const allScenarios = () => ScenarioSystem.builtIns().concat(store.get().scenarios);
  const findScenario = id => {
    const s = allScenarios().find(x => x.id === id);
    if (!s) throw new ApiError(404, `scenario "${id}" not found`);
    return s;
  };
  const requireNode = (id, name) => {
    if (typeof id !== "string" || !graph.nodes[id]) throw new ApiError(404, `${name} node "${id}" not found`);
    return id;
  };
  const requireEdge = id => {
    const e = edgeById.get(id);
    if (!e) throw new ApiError(404, `road "${id}" not found`);
    return e;
  };

  function buildEnv(body = {}, scenarioId = body.scenarioId || "normal") {
    const b = body.env || {};
    const scenario = findScenario(scenarioId);
    if (b.timeOfDay !== undefined && !["day", "night"].includes(b.timeOfDay)) throw new ApiError(422, "env.timeOfDay must be day or night");
    if (b.season !== undefined && !["dry", "monsoon", "winter"].includes(b.season)) throw new ApiError(422, "env.season must be dry, monsoon or winter");
    let weights = scenario.weights || D.DEFAULT_WEIGHTS;
    if (b.weights && !scenario.weights) {
      weights = {};
      ["traffic", "condition", "rain", "safety"].forEach(k => { weights[k] = num(b.weights[k], `env.weights.${k}`, 0, 10, 1); });
    }
    return {
      trafficLevel: num(b.trafficLevel, "env.trafficLevel", 1, 3.5, D.defaultEnv.trafficLevel),
      floodLevel: num(b.floodLevel, "env.floodLevel", 0, 2.5, D.defaultEnv.floodLevel),
      timeOfDay: b.timeOfDay || D.defaultEnv.timeOfDay,
      season: b.season || D.defaultEnv.season,
      safetyPriority: D.defaultEnv.safetyPriority,
      respectOneWay: b.respectOneWay !== false,
      weights,
      scenario: scenario.id === "normal" ? null : scenario,
      overrides: store.get().overrides,
      blockedEdges: new Set(),
      blockedNodes: new Set()
    };
  }

  function searchOptions(body) {
    try {
      return { limits: S.normalizeLimits(body.limits || {}), includeZeroHeuristic: !!body.includeZeroHeuristic };
    } catch (err) {
      throw new ApiError(422, `limits: ${err.message}`);
    }
  }

  function resolvePoint(point, maxM, name) {
    const lat = num(point && point.lat, `${name}.lat`, -90, 90);
    const lng = num(point && point.lng, `${name}.lng`, -180, 180);
    const hit = nodeIndex.nearest(lat, lng);
    const distanceM = hit ? Math.round(hit.distanceKm * 1000) : Infinity;
    if (!hit || distanceM > maxM) throw new ApiError(404, `no road node within ${maxM} m of ${name} (nearest is ${distanceM} m)`);
    return { node: hit.item.id, distanceM };
  }

  function endpoint(body, key) {
    const maxM = num(body.maxSnapM, "maxSnapM", 1, SNAP_MAX_M, SNAP_DEFAULT_M);
    const v = body[key];
    if (typeof v === "string") {
      if (graph.nodes[v]) return { node: v, distanceM: 0 };
      const place = placeById.get(v);
      if (place) {
        if (place.snapM > maxM) throw new ApiError(404, `place "${v}" is ${place.snapM} m from the nearest road node (limit ${maxM} m)`);
        return { node: place.node, distanceM: place.snapM, place: place.id };
      }
      throw new ApiError(404, `${key} "${v}" is not a node or place id`);
    }
    if (v && typeof v === "object") return resolvePoint(v, maxM, key);
    throw new ApiError(422, `${key} must be a node id, a place id, or {lat, lng}`);
  }

  function shapeResult(r) {
    const coords = [];
    r.pathEdges.forEach((id, i) => {
      const e = edgeById.get(id);
      const g = e.u === r.path[i] ? e.geom : e.geom.slice().reverse();
      (coords.length ? g.slice(1) : g).forEach(([lat, lng]) => coords.push([lng, lat]));
    });
    const trace = r.visitedNodesOrder.slice(0, TRACE_LIMIT);
    return {
      algorithm: r.algoKey, name: r.algoName, status: r.status, found: r.found,
      path: r.path, edges: r.pathEdges, routeNodes: r.routeNodes,
      cost: r.totalCost, distanceKm: r.totalDistance, estimatedTimeMins: r.estimatedTimeMins, pathSafety: r.pathSafety,
      nodesExpanded: r.nodesExpanded, nodesGenerated: r.nodesGenerated, maxQueueSize: r.maxQueueSize, executionTimeMs: r.executionTimeMs,
      geometry: r.found && coords.length > 1 ? { type: "LineString", coordinates: coords } : null,
      trace: { nodes: trace, points: trace.map(id => [graph.nodes[id].lng, graph.nodes[id].lat]), truncated: r.visitedNodesOrder.length > TRACE_LIMIT }
    };
  }

  const snapshot = scenarioId => ({ revision: store.get().revision, scenarioId, overrides: Object.keys(store.get().overrides).length });

  function roadFeature(e, env) {
    return {
      type: "Feature",
      id: e.id,
      geometry: { type: "LineString", coordinates: e.geom.map(([lat, lng]) => [lng, lat]) },
      properties: {
        id: e.id, name: e.name, osmId: e.osm_id, highway: e.highway, roadType: e.road_type, oneway: e.dir,
        u: e.u, v: e.v, distanceKm: e.distance_km,
        costForward: finite(D.calculateEdgeCost(e, env, 1)), costBackward: finite(D.calculateEdgeCost(e, env, -1)),
        closure: D.closureState(e, env)
      }
    };
  }
  const finite = x => (x === Infinity ? null : x);

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  route("GET", /^\/api\/health$/, () => ({ status: "ok", datasetReady: ready, placesReady: !!placesData }));

  route("GET", /^\/api\/ready$/, () => {
    requireReady();
    return { ready: true };
  });

  route("GET", /^\/api\/metadata$/, () => {
    requireReady();
    return {
      graph: graph.meta,
      places: placesData ? placesData.meta : null,
      placeGroups: placesData ? placesData.groups : [],
      revision: store.get().revision,
      savedOverrides: Object.keys(store.get().overrides).length,
      customScenarios: store.get().scenarios.length,
      limits: { defaults: S.DEFAULT_LIMITS, bounds: S.LIMIT_BOUNDS, snapDefaultM: SNAP_DEFAULT_M, snapMaxM: SNAP_MAX_M }
    };
  });

  route("GET", /^\/api\/places$/, (req, url) => {
    requireReady();
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    const group = url.searchParams.get("group");
    const category = url.searchParams.get("category");
    const limit = num(url.searchParams.get("limit"), "limit", 1, PLACE_LIMIT_MAX, PLACE_LIMIT_DEFAULT);
    let list = url.searchParams.get("bbox") ? placeIndex().query(...parseBbox(url.searchParams.get("bbox"))) : places;
    if (group) list = list.filter(p => p.group === group);
    if (category) list = list.filter(p => p.category === category);
    if (q) {
      const words = q.split(/\s+/);
      const text = p => `${p.name} ${p.bn} ${p.alt} ${p.locality} ${p.category}`.toLowerCase();
      list = list.filter(p => words.every(w => text(p).includes(w)))
        .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name));
    }
    return { total: list.length, places: list.slice(0, limit) };
  });
  let _placeIndex = null;
  const placeIndex = () => {
    if (!_placeIndex) {
      _placeIndex = new SpatialIndex(0.004);
      places.forEach(p => _placeIndex.insertPoint(p, p.lat, p.lng));
    }
    return _placeIndex;
  };

  route("GET", /^\/api\/places\/(.+)$/, (req, url, m) => {
    requireReady();
    const p = placeById.get(decodeURIComponent(m[1]));
    if (!p) throw new ApiError(404, `place "${decodeURIComponent(m[1])}" not found`);
    return p;
  });

  route("POST", /^\/api\/resolve$/, (req, url, m, body) => {
    requireReady();
    const maxM = num(body.maxDistanceM, "maxDistanceM", 1, SNAP_MAX_M, SNAP_DEFAULT_M);
    const r = resolvePoint(body, maxM, "point");
    return { ...r, nodeName: graph.nodes[r.node].name };
  });

  route("POST", /^\/api\/routes$/, (req, url, m, body) => {
    requireReady();
    const start = endpoint(body, "start"), goal = endpoint(body, "goal");
    const env = buildEnv(body);
    const options = searchOptions(body);
    const algorithm = body.algorithm || "astar";
    let results;
    if (algorithm === "all") results = S.runAllAlgorithms(start.node, goal.node, graph, env, options);
    else if (S.ALGORITHMS.some(a => a.key === algorithm)) results = [S.runAlgorithm(algorithm, start.node, goal.node, graph, env, options)];
    else throw new ApiError(422, `algorithm must be one of ${S.ALGORITHMS.map(a => a.key).join(", ")}, or all`);
    return { start, goal, snapshot: snapshot(body.scenarioId || "normal"), results: results.map(shapeResult) };
  });

  route("POST", /^\/api\/compare-scenarios$/, (req, url, m, body) => {
    requireReady();
    const ids = body.scenarioIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > ScenarioSystem.MAX_COMPARE) {
      throw new ApiError(422, `scenarioIds must list 1 to ${ScenarioSystem.MAX_COMPARE} scenario ids`);
    }
    const start = endpoint(body, "start"), goal = endpoint(body, "goal");
    const options = searchOptions(body);
    const algorithm = body.algorithm || "astar";
    if (!S.ALGORITHMS.some(a => a.key === algorithm)) throw new ApiError(422, "unknown algorithm");
    const rev = store.get().revision;
    return {
      start, goal, revision: rev,
      comparisons: ids.map(id => {
        const env = buildEnv(body, id);
        return { scenarioId: id, scenarioName: findScenario(id).name, result: shapeResult(S.runAlgorithm(algorithm, start.node, goal.node, graph, env, options)) };
      })
    };
  });

  route("GET", /^\/api\/scenarios$/, () => ({ scenarios: allScenarios() }));

  route("POST", /^\/api\/scenarios$/, (req, url, m, body) => {
    let s;
    try { s = ScenarioSystem.validate({ ...body, id: ScenarioSystem.newId(), revision: 0 }); }
    catch (err) { throw new ApiError(422, err.message); }
    store.get().scenarios.push(s);
    store.save();
    return { status: 201, body: s };
  });

  route("PUT", /^\/api\/scenarios\/([\w-]+)$/, (req, url, m, body) => {
    const existing = findScenario(m[1]);
    if (existing.builtIn) throw new ApiError(409, "built-in scenarios are read-only; duplicate one instead");
    let s;
    try { s = ScenarioSystem.validate({ ...body, id: existing.id, revision: (existing.revision || 0) + 1 }); }
    catch (err) { throw new ApiError(422, err.message); }
    const list = store.get().scenarios;
    list[list.findIndex(x => x.id === existing.id)] = s;
    store.save();
    return s;
  });

  route("DELETE", /^\/api\/scenarios\/([\w-]+)$/, (req, url, m) => {
    const existing = findScenario(m[1]);
    if (existing.builtIn) throw new ApiError(409, "built-in scenarios cannot be deleted");
    store.get().scenarios = store.get().scenarios.filter(x => x.id !== existing.id);
    store.save();
    return { status: 204 };
  });

  route("GET", /^\/api\/roads$/, (req, url) => {
    requireReady();
    const bbox = parseBbox(url.searchParams.get("bbox"));
    const limit = num(url.searchParams.get("limit"), "limit", 1, ROAD_LIMIT_MAX, ROAD_LIMIT_DEFAULT);
    const classes = url.searchParams.get("classes") ? new Set(url.searchParams.get("classes").split(",")) : null;
    const env = buildEnv({}, url.searchParams.get("scenarioId") || "normal");
    let edges = edgeIndex.query(...bbox);
    if (classes) edges = edges.filter(e => classes.has(e.highway));
    const total = edges.length;
    return {
      type: "FeatureCollection",
      total, truncated: total > limit,
      message: total > limit ? `${total} roads match; showing ${limit}. Zoom in or use a smaller bbox.` : undefined,
      features: edges.slice(0, limit).map(e => roadFeature(e, env))
    };
  });

  route("GET", /^\/api\/road$/, (req, url) => {
    requireReady();
    const e = requireEdge(url.searchParams.get("id"));
    const env = buildEnv({}, url.searchParams.get("scenarioId") || "normal");
    return {
      ...roadFeature(e, env).properties,
      floodSusceptibility: e.flood_susceptibility, nightSafety: e.night_safety, portZone: e.port_zone,
      conditions: D.edgeConditions(e, env),
      savedOverride: store.get().overrides[e.id] || null,
      geometry: { type: "LineString", coordinates: e.geom.map(([lat, lng]) => [lng, lat]) }
    };
  });

  route("PUT", /^\/api\/overrides$/, (req, url, m, body) => {
    requireReady();
    const e = requireEdge(url.searchParams.get("id"));
    let c;
    try { c = ScenarioSystem.cleanConditions(body, e.id); }
    catch (err) { throw new ApiError(422, err.message); }
    if (Object.keys(c).length) store.get().overrides[e.id] = c;
    else delete store.get().overrides[e.id];
    store.save();
    return { id: e.id, override: c, revision: store.get().revision };
  });

  route("DELETE", /^\/api\/overrides$/, (req, url) => {
    const id = url.searchParams.get("id");
    if (id) {
      requireEdge(id);
      delete store.get().overrides[id];
    } else {
      store.get().overrides = {};
    }
    store.save();
    return { status: 204 };
  });

  route("GET", /^\/openapi\.json$/, () => OPENAPI);
  route("GET", /^\/docs$/, () => ({ html: docsHtml() }));

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const send = (status, payload, type = "application/json") => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(type === "application/json" ? JSON.stringify(payload) : payload);
    };
    try {
      const match = routes.find(r => r.method === req.method && r.pattern.test(url.pathname));
      if (!match) {
        if (url.pathname.startsWith("/api/")) {
          const known = routes.some(r => r.pattern.test(url.pathname));
          throw new ApiError(known ? 405 : 404, known ? `method ${req.method} not allowed` : "unknown endpoint");
        }
        return serveStatic(url.pathname, res);
      }
      const body = ["POST", "PUT"].includes(req.method) ? await readJson(req) : {};
      const out = await match.handler(req, url, url.pathname.match(match.pattern), body);
      if (out && out.html) return send(200, out.html, "text/html; charset=utf-8");
      if (out && out.status === 204) { res.writeHead(204); return res.end(); }
      if (out && out.status === 201) return send(201, out.body);
      return send(200, out);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if (status === 500) console.error(err);
      return send(status, { error: status === 500 ? "internal error" : err.message, status });
    }
  }

  return { handle, ready };
}

function serveStatic(pathname, res) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || STATIC_DENY.test(rel.replace(/\\/g, "/")) ||
      !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": STATIC_TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = schema => ({ content: { "application/json": { schema } } });
const errors = codes => Object.fromEntries(codes.map(c => [c, { description: { 404: "Not found", 409: "Built-in scenario", 422: "Invalid input", 503: "Dataset unavailable" }[c], ...json(ref("Error")) }]));
const q = (name, description, required = false) => ({ name, in: "query", required, description, schema: { type: "string" } });

const OPENAPI = {
  openapi: "3.0.3",
  info: { title: "Chattogram Emergency Routing API", version: "1.0.0", description: "Graph search on the Chattogram OpenStreetMap road network. All traffic, weather, condition and safety values are simulations." },
  paths: {
    "/api/health": { get: { summary: "Process liveness and dataset-ready flag", responses: { 200: { description: "OK" } } } },
    "/api/ready": { get: { summary: "Dataset readiness (503 when unavailable)", responses: { 200: { description: "Ready" }, ...errors([503]) } } },
    "/api/metadata": { get: { summary: "Dataset statistics, quality report, revision and limits", responses: { 200: { description: "OK" }, ...errors([503]) } } },
    "/api/places": { get: { summary: "Search named places by text, group, category and bbox", parameters: [q("q", "Text in English, Bangla or alternative names, locality or category"), q("group", "Place group"), q("category", "Place category"), q("bbox", "south,west,north,east"), q("limit", "1-100, default 20")], responses: { 200: { description: "Matching places" }, ...errors([422, 503]) } } },
    "/api/places/{id}": { get: { summary: "One place (ids look like n123 or w456)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Place" }, ...errors([404, 503]) } } },
    "/api/resolve": { post: { summary: "Snap a coordinate to the nearest road node", requestBody: json({ type: "object", required: ["lat", "lng"], properties: { lat: { type: "number" }, lng: { type: "number" }, maxDistanceM: { type: "number", default: 500, maximum: 2000 } } }), responses: { 200: { description: "Resolved node and distance" }, ...errors([404, 422, 503]) } } },
    "/api/routes": { post: { summary: "Run one algorithm or all of them (algorithm = all)", requestBody: json(ref("RouteRequest")), responses: { 200: { description: "Results with GeoJSON geometry, metrics and bounded trace" }, ...errors([404, 422, 503]) } } },
    "/api/compare-scenarios": { post: { summary: "Run one query under up to 8 scenarios", requestBody: json({ allOf: [ref("RouteRequest"), { type: "object", required: ["scenarioIds"], properties: { scenarioIds: { type: "array", items: { type: "string" }, maxItems: 8 } } }] }), responses: { 200: { description: "One result per scenario" }, ...errors([404, 422, 503]) } } },
    "/api/scenarios": {
      get: { summary: "List built-in and custom scenarios", responses: { 200: { description: "Scenarios" } } },
      post: { summary: "Create a custom scenario", requestBody: json(ref("Scenario")), responses: { 201: { description: "Created" }, ...errors([422]) } }
    },
    "/api/scenarios/{id}": {
      put: { summary: "Update a custom scenario", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: json(ref("Scenario")), responses: { 200: { description: "Updated" }, ...errors([404, 409, 422]) } },
      delete: { summary: "Delete a custom scenario", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 204: { description: "Deleted" }, ...errors([404, 409]) } }
    },
    "/api/roads": { get: { summary: "Roads in a bbox as GeoJSON (default limit 2500)", parameters: [q("bbox", "south,west,north,east", true), q("classes", "Comma-separated OSM road classes"), q("limit", "1-10000"), q("scenarioId", "Scenario for the cost fields")], responses: { 200: { description: "FeatureCollection; truncated = true when more roads match" }, ...errors([422, 503]) } } },
    "/api/road": { get: { summary: "Inspect one road under a scenario", parameters: [q("id", "Edge id, e.g. e123", true), q("scenarioId", "Scenario")], responses: { 200: { description: "Road attributes, conditions and cost per direction" }, ...errors([404, 503]) } } },
    "/api/overrides": {
      put: { summary: "Save simulated conditions for a road, including closures", parameters: [q("id", "Edge id", true)], requestBody: json(ref("Conditions")), responses: { 200: { description: "Saved" }, ...errors([404, 422, 503]) } },
      delete: { summary: "Reset one road (with id) or every saved override (without)", parameters: [q("id", "Edge id")], responses: { 204: { description: "Reset" }, ...errors([404]) } }
    }
  },
  components: {
    schemas: {
      Error: { type: "object", properties: { error: { type: "string" }, status: { type: "integer" } } },
      Conditions: { type: "object", properties: {
        traffic: { type: "number", minimum: 0, maximum: 3.5, description: "Traffic intensity (Low 1, Moderate 1.5, High 2.2, Severe 3.5)" },
        rain: { type: "number", minimum: 0, maximum: 2.5, description: "Standing water in metres" },
        condition: { type: "number", minimum: 0, maximum: 1, description: "Road damage (Good 0, Fair 0.5, Poor 1)" },
        safety: { type: "number", minimum: 0, maximum: 1, description: "Safety penalty" },
        closed: { type: "string", enum: ["none", "forward", "backward", "both"] } } },
      Scenario: { type: "object", required: ["name"], properties: {
        name: { type: "string", maxLength: 80 }, description: { type: "string", maxLength: 500 },
        classConditions: { type: "object", additionalProperties: ref("Conditions"), description: "Keyed by OSM road class" },
        edgeConditions: { type: "object", additionalProperties: ref("Conditions"), description: "Keyed by edge id" },
        weights: { type: "object", nullable: true, properties: { traffic: { type: "number" }, condition: { type: "number" }, rain: { type: "number" }, safety: { type: "number" } } } } },
      RouteRequest: { type: "object", required: ["start", "goal"], properties: {
        start: { description: "Node id, place id, or {lat, lng}" }, goal: { description: "Node id, place id, or {lat, lng}" },
        algorithm: { type: "string", enum: ["bfs", "dfs", "ucs", "ids", "astar", "gbfs", "astar0", "all"], default: "astar" },
        scenarioId: { type: "string", default: "normal" },
        env: { type: "object", properties: { trafficLevel: { type: "number" }, floodLevel: { type: "number" }, timeOfDay: { type: "string", enum: ["day", "night"] }, season: { type: "string", enum: ["dry", "monsoon", "winter"] }, respectOneWay: { type: "boolean" }, weights: { type: "object" } } },
        limits: { type: "object", properties: { maxExpansions: { type: "integer" }, timeoutMs: { type: "integer" }, maxDepth: { type: "integer", description: "0 (default) = no depth limit" } } },
        maxSnapM: { type: "number", default: 500, maximum: 2000 },
        includeZeroHeuristic: { type: "boolean" } } }
    }
  }
};

function docsHtml() {
  const rows = Object.entries(OPENAPI.paths).flatMap(([p, ops]) => Object.entries(ops).map(([method, op]) =>
    `<tr><td><code>${method.toUpperCase()}</code></td><td><code>${p}</code></td><td>${op.summary}</td></tr>`)).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Routing API Docs</title><style>body{font-family:system-ui,sans-serif;margin:2rem;background:#05110a;color:#f0fdf4}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #1f4d33;padding:.5rem;text-align:left;vertical-align:top}
code{color:#86efac}a{color:#86efac}pre{background:#0a1f14;padding:1rem;border-radius:8px;overflow-x:auto}</style></head><body>
<h1>${OPENAPI.info.title}</h1><p>${OPENAPI.info.description}</p><p>Machine-readable schema: <a href="/openapi.json">/openapi.json</a></p>
<table><thead><tr><th>Method</th><th>Endpoint</th><th>Function</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Example</h2><pre>curl -X POST localhost:8000/api/routes -H "Content-Type: application/json" \\
  -d '{"start":"epz_circle","goal":"cmch","algorithm":"all","scenarioId":"heavy_traffic"}'</pre></body></html>`;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  const port = Number(arg("--port", process.env.PORT || 8000));
  const app = createApp({
    stateFile: path.resolve(arg("--state", path.join(ROOT, ".state", "state.json"))),
    dataDir: path.resolve(arg("--data", path.join(ROOT, "js")))
  });
  http.createServer(app.handle).listen(port, () => {
    console.log(`Chattogram routing server on http://localhost:${port}  (API docs: /docs)`);
    if (!app.ready) console.warn("Road dataset unavailable: routing endpoints return 503 until it is built.");
  });
}

module.exports = { createApp };

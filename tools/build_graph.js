#!/usr/bin/env node
/* ==========================================================================
   CHATTOGRAM ROAD GRAPH & PLACE BUILDER
   Builds js/chattogram_graph.js and js/chattogram_places.js from real
   OpenStreetMap data:
     1. Download drivable streets and public service lanes for the study area
     2. Split ways into segments at intersections (exact OSM node positions),
        keeping one-way direction, OSM way id and OSM road class
     3. Keep parallel roads and loops by splitting them at a midpoint vertex
     4. Optionally prune short dead-end stubs; contract pass-through nodes
        (only where both halves allow the same travel direction)
     5. Keep the largest strongly connected component, so every node can
        reach every other node while respecting one-way streets
     6. Snap the curated landmarks from tools/seed_graph.js onto real roads
     7. Interpolate flood / night-safety attributes from the seed edges
     8. Download named places in a tiled grid (resumable), snap each to the
        nearest road node, and write a compact self-decoding dataset

   Usage:
     node tools/build_graph.js                  build from cache (download if missing)
     node tools/build_graph.js --refresh        re-download roads and places
     node tools/build_graph.js --offline        never touch the network; build from cache,
                                                publishing places that are already cached
     node tools/build_graph.js --diagnose       check Overpass reachability, change nothing
     node tools/build_graph.js --area city      choose a preset study area (see AREAS)
     node tools/build_graph.js --bbox S,W,N,E   explicit study area
     node tools/build_graph.js --place-grid 3   split the place download into 3 x 3 tiles
     node tools/build_graph.js --no-places      skip the place dataset

   Road and place data (c) OpenStreetMap contributors, ODbL.
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(__dirname, ".cache");
const BACKUP_DIR = path.join(__dirname, ".backups");
const SEED_FILE = path.join(__dirname, "seed_graph.js");
const GRAPH_FILE = path.join(ROOT, "js", "chattogram_graph.js");
const PLACES_FILE = path.join(ROOT, "js", "chattogram_places.js");

// Study areas: [south, west, north, east]
const AREAS = {
  chattogram: { name: "Chattogram Metro (city, Kalurghat, south bank)", bbox: [22.20, 91.72, 22.45, 91.90] },
  city: { name: "Chattogram City Core", bbox: [22.23, 91.73, 22.43, 91.88] }
};
const DEFAULT_AREA = "chattogram";

const ROAD_CLASSES = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$";
// Public service lanes (old-city galis, market and campus lanes); not parking aisles or private driveways
const SERVICE_EXCLUDE = "parking_aisle|driveway|drive-through|parking";
const ROAD_FILTER = new RegExp(ROAD_CLASSES);
const isServiceLane = tags => tags.highway === "service" &&
  !new RegExp(SERVICE_EXCLUDE).test(tags.service || "") && !/^(private|no)$/.test(tags.access || "");
const STUB_PRUNE_KM = parseFloat(process.env.STUB_KM || "0"); // drop dead-end stubs shorter than this (0 = keep all)
const SIMPLIFY_TOLERANCE_KM = 0.002;     // max 2 m deviation from the OSM road line
const LANDMARK_JUNCTION_SNAP_KM = 0.025; // reuse a junction this close instead of splitting the road
const PORT_LANDMARKS = ["chattogram_port_g1", "chattogram_port_g4", "saltgola", "epz_circle", "port_connecting_rd"];
const PORT_RADIUS_KM = 1.5;

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const TRANSIENT_HTTP = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS_PER_ENDPOINT = 4;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60000;

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { refresh: false, offline: false, diagnose: false, places: true, placeGrid: 2, area: DEFAULT_AREA, bbox: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--refresh") opts.refresh = true;
    else if (a === "--offline" || a === "--publish-partial") opts.offline = true;
    else if (a === "--diagnose") opts.diagnose = true;
    else if (a === "--no-places") opts.places = false;
    else if (a === "--area") opts.area = argv[++i];
    else if (a === "--bbox") opts.bbox = argv[++i].split(",").map(Number);
    else if (a === "--place-grid") opts.placeGrid = parseInt(argv[++i], 10);
    else throw new Error(`Unknown option: ${a}`);
  }
  if (opts.bbox) {
    const [s, w, n, e] = opts.bbox;
    if (opts.bbox.length !== 4 || opts.bbox.some(x => !Number.isFinite(x)) || s >= n || w >= e) {
      throw new Error("--bbox must be S,W,N,E with S < N and W < E");
    }
    opts.areaName = `Custom area ${opts.bbox.join(", ")}`;
  } else {
    if (!AREAS[opts.area]) throw new Error(`Unknown --area "${opts.area}". Choose one of: ${Object.keys(AREAS).join(", ")}`);
    opts.bbox = AREAS[opts.area].bbox;
    opts.areaName = AREAS[opts.area].name;
  }
  if (!(opts.placeGrid >= 1 && opts.placeGrid <= 6)) throw new Error("--place-grid must be between 1 and 6");
  return opts;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function haversine(a, b) {
  const R = 6371;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLon = (b[1] - a[1]) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function polylineLength(coords) {
  let len = 0;
  for (let i = 1; i < coords.length; i++) len += haversine(coords[i - 1], coords[i]);
  return len;
}

// Local equirectangular projection (km) around a reference latitude
const KM_PER_DEG_LAT = 110.57;
const kmPerDegLng = lat => 111.32 * Math.cos(lat * Math.PI / 180);

// Douglas-Peucker on a local projection
function simplify(coords, tol) {
  if (coords.length <= 2) return coords;
  const kx = kmPerDegLng(coords[0][0]);
  const xy = coords.map(c => [c[1] * kx, c[0] * KM_PER_DEG_LAT]);
  const keep = new Array(coords.length).fill(false);
  keep[0] = keep[coords.length - 1] = true;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = xy[s], [x2, y2] = xy[e];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const t = len2 ? Math.max(0, Math.min(1, ((xy[i][0] - x1) * dx + (xy[i][1] - y1) * dy) / len2)) : 0;
      const d = Math.hypot(xy[i][0] - (x1 + t * dx), xy[i][1] - (y1 + t * dy));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

// Closest point to pt on segment a-b: { point, t, d (km) }
function projectOnSegment(pt, a, b) {
  const kx = kmPerDegLng(pt[0]);
  const ax = (a[1] - pt[1]) * kx, ay = (a[0] - pt[0]) * KM_PER_DEG_LAT;
  const bx = (b[1] - pt[1]) * kx, by = (b[0] - pt[0]) * KM_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return { point, t, d: haversine(pt, point) };
}

const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;
const ceil = (x, dp) => Math.ceil(x * 10 ** dp) / 10 ** dp;

// Uniform grid for nearest-point queries over [lat, lng] items
function makeGridIndex(items, coordOf, cellDeg = 0.005) {
  const grid = new Map();
  const key = (gx, gy) => gx + ":" + gy;
  items.forEach(item => {
    const [lat, lng] = coordOf(item);
    const k = key(Math.floor(lat / cellDeg), Math.floor(lng / cellDeg));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(item);
  });
  return function nearest(pt, maxRings = 40) {
    const gx = Math.floor(pt[0] / cellDeg), gy = Math.floor(pt[1] / cellDeg);
    let best = null, bestD = Infinity;
    for (let r = 0; r <= maxRings; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          (grid.get(key(gx + dx, gy + dy)) || []).forEach(item => {
            const d = haversine(pt, coordOf(item));
            if (d < bestD) { best = item; bestD = d; }
          });
        }
      }
      // Anything in ring r+1 is at least r cells away
      if (best && bestD < r * cellDeg * KM_PER_DEG_LAT * Math.cos(pt[0] * Math.PI / 180)) break;
    }
    return best ? { item: best, d: bestD } : null;
  };
}

// ---------------------------------------------------------------------------
// Overpass access: retries with exponential backoff, Retry-After, incomplete-result checks
// ---------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));

function retryAfterMs(res) {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(h);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

class OverpassError extends Error {}

async function overpassQuery(query, label) {
  let lastFailure = "no attempt made";
  for (const url of OVERPASS_URLS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_ENDPOINT; attempt++) {
      let wait = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
      try {
        console.log(`  ${label}: ${url} (attempt ${attempt})`);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ctg-routing-sim/1.0" },
          body: "data=" + encodeURIComponent(query),
          signal: AbortSignal.timeout(300000)
        });
        if (!res.ok) {
          lastFailure = `HTTP ${res.status}`;
          if (!TRANSIENT_HTTP.has(res.status)) break; // rejected query: try the next endpoint, no retry
          wait = retryAfterMs(res) ?? wait;
        } else {
          const text = await res.text();
          const data = JSON.parse(text);
          // Overpass reports timeouts / memory exhaustion as a "remark" with partial results
          if (data.remark && /error|timed out|out of memory/i.test(data.remark)) {
            lastFailure = `incomplete result (${data.remark.slice(0, 80)})`;
          } else if (!Array.isArray(data.elements)) {
            lastFailure = "response is not OSM JSON";
          } else {
            return { data, text };
          }
        }
      } catch (err) {
        lastFailure = err.name === "TimeoutError" ? "read timeout" :
          err instanceof SyntaxError ? "invalid JSON (response truncated?)" : `connection failure (${err.cause?.code || err.name})`;
      }
      if (attempt < MAX_ATTEMPTS_PER_ENDPOINT) {
        console.warn(`    ${lastFailure}; retrying in ${Math.round(wait / 1000)} s`);
        await sleep(wait);
      }
    }
    console.warn(`    giving up on ${url}: ${lastFailure}`);
  }
  throw new OverpassError(`${label} failed on every endpoint; last failure: ${lastFailure}`);
}

async function diagnose() {
  console.log("Overpass diagnostics (no local files are changed)\n");
  const tiny = "[out:json][timeout:25];node(22.335,91.830,22.336,91.831);out 1;";
  for (const url of OVERPASS_URLS) {
    const statusUrl = url.replace(/interpreter$/, "status");
    let t0 = Date.now();
    try {
      const res = await fetch(statusUrl, { signal: AbortSignal.timeout(20000) });
      console.log(`${statusUrl}\n  status probe: HTTP ${res.status} in ${Date.now() - t0} ms`);
    } catch (err) {
      console.log(`${statusUrl}\n  status probe failed after ${Date.now() - t0} ms: ${err.cause?.code || err.name}`);
    }
    t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ctg-routing-sim/1.0" },
        body: "data=" + encodeURIComponent(tiny),
        signal: AbortSignal.timeout(30000)
      });
      const text = await res.text();
      let verdict = "not OSM JSON";
      try { if (Array.isArray(JSON.parse(text).elements)) verdict = "valid OSM JSON"; } catch { /* keep verdict */ }
      console.log(`  query probe:  HTTP ${res.status} in ${Date.now() - t0} ms, ${verdict}\n`);
    } catch (err) {
      console.log(`  query probe failed after ${Date.now() - t0} ms: ${err.cause?.code || err.name}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Load OSM roads (cached per study area) and seed landmarks
// ---------------------------------------------------------------------------
const bboxKey = bbox => bbox.map(x => x.toFixed(3)).join("_");

async function loadRoads(opts) {
  const cacheFile = path.join(CACHE_DIR, `roads_${bboxKey(opts.bbox)}.json`);
  if (!opts.refresh && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  if (opts.offline) throw new Error(`Offline build: no cached roads for this area (${cacheFile})`);
  const bbox = opts.bbox.join(",");
  const query = `[out:json][timeout:240];(way["highway"~"${ROAD_CLASSES}"](${bbox});` +
    `way["highway"="service"]["service"!~"${SERVICE_EXCLUDE}"]["access"!~"private|no"](${bbox}););out body geom;`;
  const { data, text } = await overpassQuery(query, "roads");
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, text);
  return data;
}

function loadSeed() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(SEED_FILE, "utf8"), sandbox);
  return sandbox.window.CHATTOGRAM_GRAPH;
}

// ---------------------------------------------------------------------------
// 2. Split ways into intersection-to-intersection segments
// ---------------------------------------------------------------------------
// Travel direction relative to the way's node order: 1 forward only, -1 backward only, 0 both
function onewayOf(tags) {
  const o = String(tags.oneway || "").toLowerCase();
  if (o === "no" || o === "false" || o === "0") return 0;
  if (o === "-1" || o === "reverse") return -1;
  if (o === "yes" || o === "true" || o === "1") return 1;
  if (tags.junction === "roundabout" || tags.junction === "circular") return 1;
  if (tags.highway === "motorway" || tags.highway === "motorway_link") return 1;
  return 0;
}

function buildSegments(osm) {
  const ways = osm.elements.filter(el => el.type === "way" && el.geometry &&
    (ROAD_FILTER.test(el.tags.highway) || isServiceLane(el.tags)));

  const useCount = new Map();
  ways.forEach(w => w.nodes.forEach((n, i) => {
    const isEnd = i === 0 || i === w.nodes.length - 1;
    useCount.set(n, (useCount.get(n) || 0) + (isEnd ? 2 : 1));
  }));
  const isJunction = n => useCount.get(n) >= 2;

  const nodeCoords = new Map(); // node id -> [lat, lng]
  const segments = [];
  ways.forEach(w => {
    let start = 0;
    const dir = onewayOf(w.tags);
    w.nodes.forEach((n, i) => {
      if (i > 0 && isJunction(n)) {
        const coords = w.geometry.slice(start, i + 1).map(g => [g.lat, g.lon]);
        const u = `n${w.nodes[start]}`, v = `n${n}`;
        nodeCoords.set(u, coords[0]);
        nodeCoords.set(v, coords[coords.length - 1]);
        segments.push({
          u, v,
          coords,
          length: polylineLength(coords),
          highway: w.tags.highway.replace("_link", ""),
          name: w.tags["name:en"] || w.tags.name || w.tags.ref || "",
          surface: w.tags.surface || "",
          dir,
          osmId: w.id
        });
        start = i;
      }
    });
  });

  return { segments, nodeCoords };
}

// ---------------------------------------------------------------------------
// 3. Simple graph that keeps parallel roads and loops
// ---------------------------------------------------------------------------
const pairKey = (u, v) => (u < v ? `${u}|${v}` : `${v}|${u}`);
const ROAD_RANK = { motorway: 8, trunk: 7, primary: 6, secondary: 5, tertiary: 4, unclassified: 3, residential: 2, living_street: 1, service: 0 };

// Split an edge at its middle vertex into two edges joined by a new node
function splitAtMiddle(edge, nodeCoords, newId) {
  const mid = Math.floor(edge.coords.length / 2);
  const point = edge.coords[mid];
  nodeCoords.set(newId, point);
  const a = edge.coords.slice(0, mid + 1), b = edge.coords.slice(mid);
  return [
    { ...edge, v: newId, coords: a, length: polylineLength(a) },
    { ...edge, u: newId, coords: b, length: polylineLength(b) }
  ];
}

function buildSimpleGraph(segments, nodeCoords) {
  const edges = new Map(); // pairKey -> edge
  let splitCount = 0;
  const add = edge => {
    const key = pairKey(edge.u, edge.v);
    if (edge.u !== edge.v && !edges.has(key)) {
      edges.set(key, edge);
      return;
    }
    // Loop or second road between the same two junctions: keep it as two edges
    if (edge.coords.length < 3) return; // straight duplicate carries no new road
    splitAtMiddle(edge, nodeCoords, `s${++splitCount}`).forEach(add);
  };
  segments.forEach(s => add({ ...s }));
  return edges;
}

// ---------------------------------------------------------------------------
// 4-5. Stub pruning, degree-2 contraction, largest strongly connected component
// ---------------------------------------------------------------------------
// Remove dead-end edges shorter than STUB_PRUNE_KM (mapping stubs, driveways)
function pruneStubs(edges) {
  const degree = new Map();
  edges.forEach(e => {
    degree.set(e.u, (degree.get(e.u) || 0) + 1);
    degree.set(e.v, (degree.get(e.v) || 0) + 1);
  });
  let removed = 0;
  edges.forEach((e, key) => {
    const deadEnd = degree.get(e.u) === 1 || degree.get(e.v) === 1;
    if (deadEnd && e.length < STUB_PRUNE_KM) {
      edges.delete(key);
      removed++;
    }
  });
  return removed;
}

function contractDegreeTwo(edges) {
  const incident = new Map();
  const link = (n, key) => { if (!incident.has(n)) incident.set(n, new Set()); incident.get(n).add(key); };
  edges.forEach((e, key) => { link(e.u, key); link(e.v, key); });

  let changed = true;
  while (changed) {
    changed = false;
    for (const [node, keys] of incident) {
      if (keys.size !== 2) continue;
      const [k1, k2] = [...keys];
      const e1 = edges.get(k1), e2 = edges.get(k2);
      const a = e1.u === node ? e1.v : e1.u;
      const b = e2.u === node ? e2.v : e2.u;
      if (a === b || edges.has(pairKey(a, b))) continue;

      // Orient both halves as a -> node -> b; they must allow the same travel direction
      const dir1 = e1.u === a ? e1.dir : -e1.dir;
      const dir2 = e2.u === node ? e2.dir : -e2.dir;
      if (dir1 !== dir2) continue;

      const c1 = e1.u === a ? e1.coords : e1.coords.slice().reverse();
      const c2 = e2.u === node ? e2.coords : e2.coords.slice().reverse();
      const major = e1.length >= e2.length ? e1 : e2;
      const merged = {
        u: a, v: b,
        coords: c1.concat(c2.slice(1)),
        length: e1.length + e2.length,
        highway: ROAD_RANK[e1.highway] >= ROAD_RANK[e2.highway] ? e1.highway : e2.highway,
        name: major.name || e1.name || e2.name,
        surface: major.surface,
        dir: dir1,
        osmId: major.osmId
      };
      edges.delete(k1); edges.delete(k2);
      const nk = pairKey(a, b);
      edges.set(nk, merged);
      incident.delete(node);
      incident.get(a).delete(k1); incident.get(a).add(nk);
      incident.get(b).delete(k2); incident.get(b).add(nk);
      changed = true;
    }
  }
  return edges;
}

// Iterative Tarjan: largest set of nodes that can all reach each other along allowed directions
function largestStronglyConnected(edges) {
  const out = new Map();
  const node = n => { if (!out.has(n)) out.set(n, []); };
  edges.forEach(e => {
    node(e.u); node(e.v);
    if (e.dir >= 0) out.get(e.u).push(e.v);
    if (e.dir <= 0) out.get(e.v).push(e.u);
  });

  let counter = 0;
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
  let best = [];
  for (const root of out.keys()) {
    if (index.has(root)) continue;
    const visit = v => { index.set(v, counter); low.set(v, counter); counter++; stack.push(v); onStack.add(v); };
    visit(root);
    const work = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame[0];
      const nbrs = out.get(v);
      if (frame[1] < nbrs.length) {
        const w = nbrs[frame[1]++];
        if (!index.has(w)) { visit(w); work.push([w, 0]); }
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      } else {
        work.pop();
        if (work.length) {
          const p = work[work.length - 1][0];
          low.set(p, Math.min(low.get(p), low.get(v)));
        }
        if (low.get(v) === index.get(v)) {
          const comp = [];
          let w;
          do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
          if (comp.length > best.length) best = comp;
        }
      }
    }
  }
  return new Set(best);
}

// ---------------------------------------------------------------------------
// 6. Snap landmarks onto the road network
// ---------------------------------------------------------------------------
function snapLandmarks(seed, roadEdges, nodeCoords) {
  const landmarkOf = new Map(); // graph node id -> landmark id
  const report = [];

  Object.values(seed.nodes).forEach(lm => {
    const pt = [lm.lat, lm.lng];
    let best = null;
    roadEdges.forEach((edge, ei) => {
      for (let i = 1; i < edge.coords.length; i++) {
        const p = projectOnSegment(pt, edge.coords[i - 1], edge.coords[i]);
        if (!best || p.d < best.d) best = { ...p, ei, seg: i };
      }
    });

    const edge = roadEdges[best.ei];
    const dU = haversine(best.point, nodeCoords.get(edge.u));
    const dV = haversine(best.point, nodeCoords.get(edge.v));
    const nearEnd = dU <= dV ? edge.u : edge.v;

    let nodeId;
    if (Math.min(dU, dV) <= LANDMARK_JUNCTION_SNAP_KM && !landmarkOf.has(nearEnd)) {
      nodeId = nearEnd; // landmark sits at an existing junction
    } else {
      // Split the road at the projected point; both halves keep the travel direction
      nodeId = `lm_${lm.id}`;
      nodeCoords.set(nodeId, best.point);
      const a = edge.coords.slice(0, best.seg).concat([best.point]);
      const b = [best.point].concat(edge.coords.slice(best.seg));
      roadEdges.splice(best.ei, 1,
        { ...edge, v: nodeId, coords: a, length: polylineLength(a) },
        { ...edge, u: nodeId, coords: b, length: polylineLength(b) });
    }
    landmarkOf.set(nodeId, lm.id);
    report.push({ id: lm.id, km: best.d, road: edge.name || edge.highway });
  });

  return { landmarkOf, report };
}

// ---------------------------------------------------------------------------
// 7. Attribute interpolation from hand-tuned seed edges
// ---------------------------------------------------------------------------
function makeSeedSampler(seed) {
  const samples = seed.edges.map(e => {
    const u = seed.nodes[e.u], v = seed.nodes[e.v];
    return { pt: [(u.lat + v.lat) / 2, (u.lng + v.lng) / 2], edge: e };
  });
  return function sample(pt) {
    const nearest = samples
      .map(s => ({ s, d: Math.max(haversine(pt, s.pt), 0.05) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 4);
    let wSum = 0, flood = 0, safety = 0;
    nearest.forEach(({ s, d }) => {
      const w = 1 / (d * d);
      wSum += w;
      flood += w * s.edge.flood_susceptibility;
      safety += w * s.edge.night_safety;
    });
    return { flood: flood / wSum, safety: safety / wSum, nearest: nearest[0] };
  };
}

function roadTypeFor(edge, nearestSeed) {
  if (/^(unpaved|dirt|gravel|ground|compacted|mud)$/.test(edge.surface)) return "broken";
  if ((edge.highway === "tertiary" || edge.highway === "unclassified") && nearestSeed.d < 0.4 &&
      (nearestSeed.s.edge.road_type === "alley" || nearestSeed.s.edge.road_type === "broken")) {
    return nearestSeed.s.edge.road_type;
  }
  switch (edge.highway) {
    case "motorway": case "trunk": case "primary": return "arterial";
    case "secondary": return "avenue";
    case "residential": case "living_street": case "service": return "alley"; // narrow neighbourhood lanes
    default: return "street";
  }
}

const SAFETY_SHIFT = { arterial: 0.05, avenue: 0.02, street: -0.04, alley: -0.08, broken: -0.1 };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---------------------------------------------------------------------------
// 8. Named places: tiled, resumable download; categories, names, locality, snapping
// ---------------------------------------------------------------------------
const PLACE_KEYS = ["amenity", "shop", "healthcare", "tourism", "leisure", "office", "historic", "craft", "railway", "public_transport", "place"];

const PLACE_GROUPS = [
  ["Health", /^(hospital|clinic|doctors|dentist|pharmacy|healthcare|laboratory|blood_bank|nursing_home)$/],
  ["Emergency & Government", /^(police|fire_station|townhall|courthouse|post_office|government|ranger_station|embassy|prison)$/],
  ["Education", /^(school|college|university|kindergarten|library|training|research|educational_institution)$/],
  ["Worship", /^place_of_worship$/],
  ["Transport", /^(bus_station|station|ferry_terminal|fuel|taxi|parking|bus_stop|halt|charging_station|car_wash|car_repair)$/],
  ["Finance", /^(bank|atm|bureau_de_change|money_transfer|mobile_money_agent)$/],
  ["Food", /^(restaurant|cafe|fast_food|food_court|bakery|ice_cream|confectionery|sweets|juice)$/],
  ["Leisure & Tourism", /^(hotel|guest_house|hostel|motel|attraction|museum|viewpoint|park|stadium|sports_centre|pitch|playground|garden|theme_park|zoo|memorial|monument|cinema|theatre|community_centre|picnic_site|resort|swimming_pool|golf_course)$/],
  ["Area / Neighbourhood", /^(suburb|neighbourhood|quarter|village|hamlet|locality|town)$/]
];

function placeCategory(tags) {
  for (const k of PLACE_KEYS) {
    if (tags[k] && tags[k] !== "yes") {
      const value = tags[k];
      let group = k === "shop" ? "Shopping" : "Other";
      for (const [g, re] of PLACE_GROUPS) if (re.test(value)) { group = g; break; }
      if (group === "Other" && (k === "tourism" || k === "leisure" || k === "historic")) group = "Leisure & Tourism";
      if (group === "Other" && k === "healthcare") group = "Health";
      if (group === "Other" && k === "office" && value === "government") group = "Emergency & Government";
      return { category: value.replace(/_/g, " "), group };
    }
  }
  return null;
}

function placeTiles(bbox, grid) {
  const [s, w, n, e] = bbox;
  const tiles = [];
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      tiles.push([
        s + (n - s) * i / grid, w + (e - w) * j / grid,
        s + (n - s) * (i + 1) / grid, w + (e - w) * (j + 1) / grid
      ].map(x => round(x, 5)));
    }
  }
  return tiles;
}

async function loadPlaces(opts) {
  const tiles = placeTiles(opts.bbox, opts.placeGrid);
  const elements = new Map(); // "type/id" -> element (deduplicated across tiles)
  const missing = [];
  for (let t = 0; t < tiles.length; t++) {
    const tile = tiles[t];
    const cacheFile = path.join(CACHE_DIR, `places_${bboxKey(opts.bbox)}_g${opts.placeGrid}_t${t}.json`);
    let data = null;
    if (!opts.refresh && fs.existsSync(cacheFile)) {
      data = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } else if (!opts.offline) {
      const b = tile.join(",");
      const parts = PLACE_KEYS.filter(k => k !== "place").map(k => `nwr["name"]["${k}"](${b});`).join("") +
        `node["name"]["place"~"suburb|neighbourhood|quarter|village|hamlet|locality|town"](${b});`;
      try {
        const res = await overpassQuery(`[out:json][timeout:180];(${parts});out center tags;`, `places tile ${t + 1}/${tiles.length}`);
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cacheFile, res.text); // checkpoint: a completed tile is never downloaded again
        data = res.data;
      } catch (err) {
        console.warn(`  ${err.message}`);
      }
    }
    if (!data) { missing.push(t); continue; }
    data.elements.forEach(el => elements.set(`${el.type}/${el.id}`, el));
  }
  return { elements: [...elements.values()], totalTiles: tiles.length, missingTiles: missing };
}

function buildPlaces(placeData, graph, order) {
  const nodeList = order.map((id, pos) => ({ pos, lat: graph.nodes[id].lat, lng: graph.nodes[id].lng }));
  const nearestNode = makeGridIndex(nodeList, n => [n.lat, n.lng]);

  const raw = [];
  placeData.elements.forEach(el => {
    const tags = el.tags || {};
    const cat = placeCategory(tags);
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!cat || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const isBangla = s => /[ঀ-৿]/.test(s || "");
    const name = tags["name:en"] || tags.name;
    const bn = tags["name:bn"] || (isBangla(tags.name) ? tags.name : "");
    const alt = [tags.alt_name, tags.old_name, tags.short_name, tags.official_name, tags.name !== name ? tags.name : ""]
      .filter(Boolean).filter((x, i, a) => a.indexOf(x) === i && x !== name && x !== bn).join("; ");
    raw.push({ el, tags, lat, lng, name, bn, alt, ...cat });
  });

  // Locality: address tags first, otherwise the nearest named neighbourhood within 3 km
  const areas = raw.filter(p => p.group === "Area / Neighbourhood");
  const nearestArea = makeGridIndex(areas, a => [a.lat, a.lng], 0.01);
  const places = raw.map(p => {
    let locality = p.tags["addr:suburb"] || p.tags["addr:city_district"] || p.tags["addr:district"] || p.tags["addr:city"] || "";
    if (!locality && p.group !== "Area / Neighbourhood") {
      const a = nearestArea([p.lat, p.lng], 6);
      if (a && a.d < 3) locality = a.item.name;
    }
    const snap = nearestNode([p.lat, p.lng]);
    return {
      id: `${p.el.type[0]}${p.el.id}`,
      name: p.name, bn: p.bn, alt: p.alt, category: p.category, group: p.group,
      lat: round(p.lat, 6), lng: round(p.lng, 6), locality,
      nodePos: snap.item.pos, snapM: Math.round(snap.d * 1000)
    };
  });
  return places;
}

// ---------------------------------------------------------------------------
// 9. Compact output encoding
// Strings are stored once in a table; junction ids are implied by position
// (j1, j2, ...); coordinates are integers and edge geometry is delta-encoded.
// The generated files decode themselves into plain objects.
// ---------------------------------------------------------------------------
function decodeGraph(P) {
  const S = P.strings;
  const nodes = {};
  const order = [];
  P.nodes.forEach((r, i) => {
    const id = r[0] || "j" + (i + 1);
    const node = { id, name: S[r[1]], type: S[r[2]], lat: r[3] / 1e6, lng: r[4] / 1e6, description: S[r[5]] };
    if (r[0]) node.landmark = true;
    nodes[id] = node;
    order.push(id);
  });
  const edges = P.edges.map((r, i) => {
    const g = r[9];
    const geom = [];
    let lat = 0, lng = 0;
    for (let k = 0; k < g.length; k += 2) {
      lat += g[k];
      lng += g[k + 1];
      geom.push([lat / 1e5, lng / 1e5]);
    }
    return {
      id: "e" + (i + 1), u: order[r[0]], v: order[r[1]],
      distance_km: r[2] / 1000, road_type: S[r[3]],
      flood_susceptibility: r[4] / 100, night_safety: r[5] / 100,
      junction_delay_sec: r[6], port_zone: r[7] === 1, name: S[r[8]], geom,
      dir: r[10], osm_id: r[11], highway: S[r[12]]
    };
  });
  return { meta: P.meta, nodes, edges, order };
}

// Junction jK sits at position K-1 so its id is implied; landmarks follow
function nodeOrder(graph) {
  const all = Object.values(graph.nodes);
  const junctions = all.filter(n => !n.landmark).sort((a, b) => +a.id.slice(1) - +b.id.slice(1));
  junctions.forEach((n, i) => { if (n.id !== "j" + (i + 1)) throw new Error("junction ids are not contiguous"); });
  return junctions.concat(all.filter(n => n.landmark)).map(n => n.id);
}

function makeStringTable() {
  const strings = [];
  const index = new Map();
  const str = x => {
    if (!index.has(x)) { index.set(x, strings.length); strings.push(x); }
    return index.get(x);
  };
  return { strings, str };
}

function encodeGraph(graph, order) {
  const { strings, str } = makeStringTable();
  const position = new Map(order.map((id, i) => [id, i]));

  const nodes = order.map(id => {
    const n = graph.nodes[id];
    return [n.landmark ? n.id : 0, str(n.name), str(n.type), Math.round(n.lat * 1e6), Math.round(n.lng * 1e6), str(n.description)];
  });
  const edges = graph.edges.map((e, i) => {
    if (e.id !== "e" + (i + 1)) throw new Error("edge ids are not contiguous");
    const deltas = [];
    let lat = 0, lng = 0;
    e.geom.forEach(([a, b]) => {
      const la = Math.round(a * 1e5), lo = Math.round(b * 1e5);
      deltas.push(la - lat, lo - lng);
      lat = la; lng = lo;
    });
    return [
      position.get(e.u), position.get(e.v), Math.round(e.distance_km * 1000), str(e.road_type),
      Math.round(e.flood_susceptibility * 100), Math.round(e.night_safety * 100),
      e.junction_delay_sec, e.port_zone ? 1 : 0, str(e.name), deltas,
      e.dir, e.osm_id, str(e.highway)
    ];
  });
  return { meta: graph.meta, strings, nodes, edges };
}

function decodePlaces(P) {
  const S = P.strings;
  const nodeId = pos => (pos < P.junctionCount ? "j" + (pos + 1) : P.landmarkIds[pos - P.junctionCount]);
  const places = P.places.map(r => ({
    id: S[r[0]], name: S[r[1]], bn: S[r[2]], alt: S[r[3]], category: S[r[4]], group: S[r[5]],
    lat: r[6] / 1e6, lng: r[7] / 1e6, locality: S[r[8]], node: nodeId(r[9]), snapM: r[10]
  }));
  return { meta: P.meta, groups: P.groups, places };
}

function encodePlaces(places, order, meta) {
  const { strings, str } = makeStringTable();
  const landmarkIds = order.filter(id => !/^j\d+$/.test(id));
  const junctionCount = order.length - landmarkIds.length;
  return {
    meta,
    groups: [...new Set(places.map(p => p.group))].sort(),
    junctionCount,
    landmarkIds,
    strings,
    places: places.map(p => [
      str(p.id), str(p.name), str(p.bn), str(p.alt), str(p.category), str(p.group),
      Math.round(p.lat * 1e6), Math.round(p.lng * 1e6), str(p.locality), p.nodePos, p.snapM
    ])
  };
}

// Round-trip check: the decoded graph must match what was encoded
function verifyGraphEncoding(graph, payload) {
  const decoded = decodeGraph(JSON.parse(JSON.stringify(payload)));
  const close = (a, b, eps) => Math.abs(a - b) <= eps;
  Object.values(graph.nodes).forEach(n => {
    const d = decoded.nodes[n.id];
    if (!d || d.name !== n.name || d.type !== n.type || !!d.landmark !== !!n.landmark ||
        !close(d.lat, n.lat, 1e-6) || !close(d.lng, n.lng, 1e-6)) throw new Error("node mismatch " + n.id);
  });
  graph.edges.forEach((e, i) => {
    const d = decoded.edges[i];
    if (d.id !== e.id || d.u !== e.u || d.v !== e.v || d.name !== e.name || d.road_type !== e.road_type ||
        d.dir !== e.dir || d.osm_id !== e.osm_id || d.highway !== e.highway ||
        !close(d.distance_km, e.distance_km, 1e-9) || d.geom.length !== e.geom.length ||
        d.geom.some((p, k) => !close(p[0], e.geom[k][0], 1e-7) || !close(p[1], e.geom[k][1], 1e-7))) {
      throw new Error("edge mismatch " + e.id);
    }
  });
}

// ---------------------------------------------------------------------------
// Output with backups and checksums
// ---------------------------------------------------------------------------
function backupOutputs(files) {
  const existing = files.filter(f => fs.existsSync(f));
  if (!existing.length) return null;
  const dir = path.join(BACKUP_DIR, new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  existing.forEach(f => fs.copyFileSync(f, path.join(dir, path.basename(f))));
  return dir;
}

const sha256 = text => crypto.createHash("sha256").update(text).digest("hex");

function writeDataset(file, title, varName, decoder, payload) {
  const header = `/* ==========================================================================
   ${title}
   GENERATED FILE - do not edit by hand. Rebuild with: node tools/build_graph.js
   Data (c) OpenStreetMap contributors, ODbL.
   ========================================================================== */
`;
  const body = `const ${varName} = (${decoder.toString()})(${JSON.stringify(payload)});\n\n` +
    `if (typeof window !== 'undefined') {\n  window.${varName} = ${varName};\n}\n`;
  fs.writeFileSync(file, header + body);
  return Math.round(fs.statSync(file).size / 1024);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.diagnose) return diagnose();

  console.log(`Study area: ${opts.areaName} [${opts.bbox.join(", ")}]`);
  const osm = await loadRoads(opts);
  const seed = loadSeed();

  const { segments, nodeCoords } = buildSegments(osm);
  let edges = buildSimpleGraph(segments, nodeCoords);
  console.log(`OSM: ${segments.length} segments -> ${edges.size} edges`);

  if (STUB_PRUNE_KM > 0) console.log(`Pruned ${pruneStubs(edges)} dead-end stubs < ${STUB_PRUNE_KM} km`);
  edges = contractDegreeTwo(edges);
  const totalNodes = new Set([...edges.values()].flatMap(e => [e.u, e.v])).size;
  const keep = largestStronglyConnected([...edges.values()]);
  const roadEdges = [...edges.values()].filter(e => keep.has(e.u) && keep.has(e.v));
  console.log(`Largest strongly connected component: ${keep.size} of ${totalNodes} junctions, ${roadEdges.length} edges`);

  const { landmarkOf, report } = snapLandmarks(seed, roadEdges, nodeCoords);
  report.filter(r => r.km > 0.15).forEach(r =>
    console.warn(`  note: ${r.id} seed position is ${(r.km * 1000).toFixed(0)} m from the nearest road (${r.road})`));
  const offsets = report.map(r => r.km * 1000).sort((a, b) => a - b);
  console.log(`Snapped ${report.length} landmarks onto roads (median offset ${offsets[offsets.length >> 1].toFixed(0)} m)`);

  // Final node ids: landmarks keep their seed ids, junctions are numbered south to north
  const graphNodes = [...new Set(roadEdges.flatMap(e => [e.u, e.v]))];
  const junctions = graphNodes.filter(n => !landmarkOf.has(n))
    .sort((a, b) => nodeCoords.get(a)[0] - nodeCoords.get(b)[0] || nodeCoords.get(a)[1] - nodeCoords.get(b)[1]);
  const idOf = new Map(junctions.map((n, i) => [n, `j${i + 1}`]));
  landmarkOf.forEach((lmId, n) => idOf.set(n, lmId));

  const degree = new Map();
  roadEdges.forEach(e => {
    degree.set(e.u, (degree.get(e.u) || 0) + 1);
    degree.set(e.v, (degree.get(e.v) || 0) + 1);
  });

  const nodes = {};
  const namesAt = new Map();
  roadEdges.forEach(e => [e.u, e.v].forEach(n => {
    if (!namesAt.has(n)) namesAt.set(n, new Map());
    if (e.name) namesAt.get(n).set(e.name, (namesAt.get(n).get(e.name) || 0) + 1);
  }));
  const landmarks = Object.values(seed.nodes);
  const isLatin = s => !/[ঀ-৿]/.test(s);

  graphNodes.forEach(n => {
    const [lat, lng] = nodeCoords.get(n);
    const id = idOf.get(n);
    if (landmarkOf.has(n)) {
      const lm = seed.nodes[landmarkOf.get(n)];
      nodes[id] = { id, name: lm.name, type: lm.type, lat: round(lat, 6), lng: round(lng, 6), description: lm.description, landmark: true };
      return;
    }
    let names = [...namesAt.get(n).entries()].sort((x, y) => y[1] - x[1]).map(x => x[0]);
    // The same road is often tagged in English on one way and Bengali on the next
    if (names.some(isLatin)) names = names.filter(isLatin);
    let name;
    if (names.length >= 2) {
      name = `${names[0]} × ${names[1]}`;
    } else if (names.length === 1) {
      name = degree.get(n) > 2 ? `${names[0]} Junction` : `${names[0]}`;
    } else {
      const near = landmarks
        .map(lm => ({ lm, d: haversine([lat, lng], [lm.lat, lm.lng]) }))
        .sort((x, y) => x.d - y.d)[0];
      name = `${degree.get(n) > 2 ? "Junction" : "Lane point"} near ${near.lm.name} (${near.d.toFixed(1)} km)`;
    }
    const deg = degree.get(n);
    nodes[id] = {
      id,
      name,
      type: "junction",
      lat: round(lat, 6),
      lng: round(lng, 6),
      description: deg === 1 ? "Dead end" : deg === 2 ? "Point along a road" : `${deg}-way road junction`
    };
  });

  const outEdges = [];
  const sample = makeSeedSampler(seed);
  const portPoints = PORT_LANDMARKS.map(id => seed.nodes[id]).filter(Boolean).map(n => [n.lat, n.lng]);
  const isPortZone = (pt, name) => /port|saltgola/i.test(name) || portPoints.some(p => haversine(pt, p) < PORT_RADIUS_KM);

  roadEdges.forEach(e => {
    const mid = e.coords[Math.floor(e.coords.length / 2)];
    const attrs = sample(mid);
    const roadType = roadTypeFor(e, attrs.nearest);
    const name = e.name || `Unnamed ${e.highway.replace("_", " ")} road`;
    const deg = Math.max(degree.get(e.u), degree.get(e.v));
    outEdges.push({
      id: `e${outEdges.length + 1}`,
      u: idOf.get(e.u),
      v: idOf.get(e.v),
      distance_km: ceil(Math.max(e.length, haversine(e.coords[0], e.coords[e.coords.length - 1])), 3),
      road_type: roadType,
      flood_susceptibility: round(clamp(attrs.flood, 0.02, 0.98), 2),
      night_safety: round(clamp(attrs.safety + (SAFETY_SHIFT[roadType] || 0), 0.3, 0.98), 2),
      junction_delay_sec: deg >= 4 ? 60 : deg === 3 ? 40 : 20,
      port_zone: isPortZone(mid, name),
      name,
      geom: simplify(e.coords, SIMPLIFY_TOLERANCE_KM).map(c => [round(c[0], 5), round(c[1], 5)]),
      dir: e.dir,
      osm_id: e.osmId,
      highway: e.highway
    });
  });

  const classCounts = {};
  outEdges.forEach(e => { classCounts[e.highway] = (classCounts[e.highway] || 0) + 1; });
  const graph = {
    meta: {
      source: "OpenStreetMap contributors (ODbL), processed by tools/build_graph.js",
      generated: new Date().toISOString(),
      area: opts.areaName,
      bbox: opts.bbox,
      nodeCount: Object.keys(nodes).length,
      edgeCount: outEdges.length,
      landmarkCount: landmarkOf.size,
      quality: {
        osmClassCounts: classCounts,
        oneWayEdges: outEdges.filter(e => e.dir !== 0).length,
        junctionsOutsideStrongComponent: totalNodes - keep.size,
        landmarkOffsetMedianM: Math.round(offsets[offsets.length >> 1]),
        landmarkOffsetMaxM: Math.round(offsets[offsets.length - 1]),
        landmarksOver150m: report.filter(r => r.km > 0.15).map(r => r.id)
      }
    },
    nodes,
    edges: outEdges
  };

  const order = nodeOrder(graph);
  const graphPayload = encodeGraph(graph, order);
  verifyGraphEncoding(graph, graphPayload);
  graphPayload.meta.checksum = sha256(JSON.stringify([graphPayload.strings, graphPayload.nodes, graphPayload.edges]));

  let placesPayload = null;
  if (opts.places) {
    const placeData = await loadPlaces(opts);
    const places = buildPlaces(placeData, graph, order);
    const byGroup = {};
    places.forEach(p => { byGroup[p.group] = (byGroup[p.group] || 0) + 1; });
    const placesMeta = {
      source: "OpenStreetMap contributors (ODbL), processed by tools/build_graph.js",
      generated: new Date().toISOString(),
      area: opts.areaName,
      bbox: opts.bbox,
      graphChecksum: graphPayload.meta.checksum,
      placeCount: places.length,
      placesComplete: placeData.missingTiles.length === 0,
      totalPlaceTiles: placeData.totalTiles,
      completedPlaceTiles: placeData.totalTiles - placeData.missingTiles.length,
      missingPlaceTiles: placeData.missingTiles,
      quality: {
        byGroup,
        snappedOver500m: places.filter(p => p.snapM > 500).length,
        snapMedianM: places.length ? places.map(p => p.snapM).sort((a, b) => a - b)[places.length >> 1] : null
      }
    };
    placesPayload = encodePlaces(places, order, placesMeta);
    placesPayload.meta.checksum = sha256(JSON.stringify(placesPayload.places));
    if (!placesMeta.placesComplete) {
      console.warn(`  places incomplete: ${placesMeta.missingPlaceTiles.length} of ${placesMeta.totalPlaceTiles} tiles missing; run again online to resume`);
    }
  }

  const backup = backupOutputs(placesPayload ? [GRAPH_FILE, PLACES_FILE] : [GRAPH_FILE]);
  if (backup) console.log(`Backed up previous dataset to ${path.relative(ROOT, backup)}`);

  const graphKb = writeDataset(GRAPH_FILE,
    `CHATTOGRAM ROAD NETWORK (${graph.meta.nodeCount} NODES & ${graph.meta.edgeCount} DIRECTED-AWARE EDGES)`,
    "CHATTOGRAM_GRAPH", decodeGraph, graphPayload);
  console.log(`Wrote ${path.relative(ROOT, GRAPH_FILE)}: ${graph.meta.nodeCount} nodes, ${graph.meta.edgeCount} edges, ` +
    `${graph.meta.quality.oneWayEdges} one-way (${graphKb} KB)`);
  if (placesPayload) {
    const placesKb = writeDataset(PLACES_FILE, `CHATTOGRAM NAMED PLACES (${placesPayload.meta.placeCount})`,
      "CHATTOGRAM_PLACES", decodePlaces, placesPayload);
    console.log(`Wrote ${path.relative(ROOT, PLACES_FILE)}: ${placesPayload.meta.placeCount} places (${placesKb} KB)`);
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}

module.exports = {
  parseArgs, haversine, polylineLength, simplify, projectOnSegment, makeGridIndex, onewayOf,
  buildSegments, buildSimpleGraph, contractDegreeTwo, largestStronglyConnected, placeCategory, placeTiles,
  decodeGraph, encodeGraph, nodeOrder, decodePlaces, encodePlaces, verifyGraphEncoding, retryAfterMs
};

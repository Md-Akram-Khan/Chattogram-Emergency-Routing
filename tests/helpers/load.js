/* Loads the browser modules (plain scripts that define globals) into one
   isolated Node context, the same way index.html loads them. */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");

const ROOT = path.resolve(__dirname, "..", "..");
const ENGINE = ["js/spatial_index.js", "js/dynamic_cost.js", "js/scenarios.js", "js/algorithms.js"];
const DATA = ["js/chattogram_graph.js", "js/chattogram_places.js"];

function loadModules({ data = false } = {}) {
  const context = { performance, console };
  context.window = context;
  vm.createContext(context);
  (data ? DATA.concat(ENGINE) : ENGINE).forEach(rel => {
    // Top-level const/class bindings are not context properties; expose them as globals
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8")
      .replace(/^const (\w+) =/m, "var $1 =")
      .replace(/^class (\w+)/m, "var $1 = class $1");
    vm.runInContext(src, context, { filename: rel });
  });
  return context;
}

/**
 * Small graph from a compact spec. Nodes: { id: [lat, lng] }.
 * Edges: [u, v, km, { dir, highway, road_type, ... }] with straight geometry.
 */
function makeGraph(nodes, edges) {
  const g = { meta: {}, nodes: {}, edges: [] };
  Object.entries(nodes).forEach(([id, [lat, lng]]) => {
    g.nodes[id] = { id, name: id, type: "junction", lat, lng, description: "test node" };
  });
  edges.forEach(([u, v, km, extra = {}], i) => {
    g.edges.push({
      id: `e${i + 1}`, u, v, distance_km: km, road_type: "avenue", flood_susceptibility: 0, night_safety: 1,
      junction_delay_sec: 0, port_zone: false, name: `road ${i + 1}`, dir: 0, osm_id: i + 1, highway: "primary",
      geom: [[g.nodes[u].lat, g.nodes[u].lng], [g.nodes[v].lat, g.nodes[v].lng]],
      ...extra
    });
  });
  return g;
}

// Neutral environment: every multiplier is 1 except road type, so cost = km * w_road
function neutralEnv(extra = {}) {
  return {
    trafficLevel: 0, floodLevel: 0, timeOfDay: "day", season: "dry", safetyPriority: 0,
    respectOneWay: true, weights: { traffic: 1, condition: 1, rain: 1, safety: 1 },
    scenario: null, overrides: {}, blockedEdges: new Set(), blockedNodes: new Set(),
    ...extra
  };
}

module.exports = { loadModules, makeGraph, neutralEnv, ROOT };

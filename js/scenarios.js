/* ==========================================================================
   SCENARIO SYSTEM
   Built-in, read-only scenarios plus validation for custom scenarios.
   A scenario sets simulated conditions per OSM road class and per road
   (edge id), and can carry its own cost weights. Conditions use the units
   of DynamicCostSystem: traffic intensity (1-3.5), standing water in metres
   (0-2.5), road-condition severity (0-1), safety penalty (0-1), and closure
   ("none" | "forward" | "backward" | "both").
   ========================================================================== */

const ScenarioSystem = {
  ROAD_CLASSES: ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service"],
  MAX_COMPARE: 8,

  LIMITS: {
    traffic: [0, 3.5],
    rain: [0, 2.5],
    condition: [0, 1],
    safety: [0, 1],
    weight: [0, 10]
  },
  CLOSURES: ["none", "forward", "backward", "both"],

  builtIns() {
    const all = conditions => Object.fromEntries(this.ROAD_CLASSES.map(c => [c, { ...conditions }]));
    const some = (classes, conditions) => Object.fromEntries(classes.map(c => [c, { ...conditions }]));
    return [
      {
        id: "normal", builtIn: true, name: "Normal Day",
        description: "No scenario conditions; only the baseline sliders apply.",
        classConditions: {}, edgeConditions: {}, weights: null
      },
      {
        id: "heavy_traffic", builtIn: true, name: "Heavy Traffic",
        description: "Severe traffic on trunk, primary and secondary roads.",
        classConditions: some(["motorway", "trunk", "primary", "secondary"], { traffic: 3.5 }), edgeConditions: {}, weights: null
      },
      {
        id: "heavy_rain", builtIn: true, name: "Heavy Rain and Waterlogging",
        description: "Severe waterlogging and fair road condition on residential, tertiary and unclassified roads.",
        classConditions: some(["tertiary", "unclassified", "residential", "living_street"], { rain: 2.5, condition: 0.5 }),
        edgeConditions: {}, weights: null
      },
      {
        id: "night_travel", builtIn: true, name: "Night Travel",
        description: "Full safety penalty on residential, service and unclassified roads.",
        classConditions: some(["unclassified", "residential", "living_street", "service"], { safety: 1 }), edgeConditions: {}, weights: null
      },
      {
        id: "road_blockage", builtIn: true, name: "Road Blockage",
        description: "No automatic closures: duplicate it and close roads in the copy.",
        classConditions: {}, edgeConditions: {}, weights: null
      },
      {
        id: "combined_emergency", builtIn: true, name: "Combined Emergency",
        description: "Severe traffic, severe waterlogging, fair road condition and full safety penalty on every road class.",
        classConditions: all({ traffic: 3.5, rain: 2.5, condition: 0.5, safety: 1 }), edgeConditions: {}, weights: null
      }
    ];
  },

  /**
   * Validates one condition object; returns a cleaned copy or throws
   */
  cleanConditions(src, where) {
    const out = {};
    ["traffic", "rain", "condition", "safety"].forEach(k => {
      if (src[k] === undefined || src[k] === null || src[k] === "") return;
      const x = Number(src[k]);
      const [lo, hi] = this.LIMITS[k];
      if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${where}: ${k} must be between ${lo} and ${hi}`);
      out[k] = x;
    });
    if (src.closed !== undefined && src.closed !== null && src.closed !== "none") {
      if (!this.CLOSURES.includes(src.closed)) throw new Error(`${where}: closed must be one of ${this.CLOSURES.join(", ")}`);
      out.closed = src.closed;
    }
    return out;
  },

  /**
   * Validates a custom scenario; returns a cleaned copy or throws
   */
  validate(s) {
    if (!s || typeof s !== "object") throw new Error("scenario must be an object");
    const name = String(s.name || "").trim();
    if (!name) throw new Error("scenario name is required");
    if (name.length > 80) throw new Error("scenario name must be at most 80 characters");
    const classConditions = {};
    Object.entries(s.classConditions || {}).forEach(([cls, cond]) => {
      if (!this.ROAD_CLASSES.includes(cls)) throw new Error(`unknown road class "${cls}"`);
      const c = this.cleanConditions(cond || {}, cls);
      if (Object.keys(c).length) classConditions[cls] = c;
    });
    const edgeConditions = {};
    Object.entries(s.edgeConditions || {}).forEach(([edgeId, cond]) => {
      if (!/^e\d+$/.test(edgeId)) throw new Error(`invalid road id "${edgeId}"`);
      const c = this.cleanConditions(cond || {}, edgeId);
      if (Object.keys(c).length) edgeConditions[edgeId] = c;
    });
    let weights = null;
    if (s.weights) {
      weights = {};
      ["traffic", "condition", "rain", "safety"].forEach(k => {
        const x = Number(s.weights[k]);
        const [lo, hi] = this.LIMITS.weight;
        if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`weight ${k} must be between ${lo} and ${hi}`);
        weights[k] = x;
      });
    }
    return {
      id: s.id, builtIn: false, name,
      description: String(s.description || "").slice(0, 500),
      classConditions, edgeConditions, weights,
      revision: s.revision || 0
    };
  },

  newId() {
    return "custom_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  },

  duplicate(s, name) {
    const copy = JSON.parse(JSON.stringify(s));
    return this.validate({ ...copy, id: this.newId(), name: name || `${s.name} (copy)`, revision: 0 });
  }
};

if (typeof window !== 'undefined') {
  window.ScenarioSystem = ScenarioSystem;
}
if (typeof module !== 'undefined') {
  module.exports = ScenarioSystem;
}

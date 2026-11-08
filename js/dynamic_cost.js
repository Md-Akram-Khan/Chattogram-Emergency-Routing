const DynamicCostSystem = {
  defaultEnv: {
    trafficLevel: 2.2,
    floodLevel: 1.2,
    timeOfDay: "night",
    season: "monsoon",
    safetyPriority: 1.5,
    respectOneWay: true,
    weights: { traffic: 1, condition: 1, rain: 1, safety: 1 },
    scenario: null,
    overrides: {},
    blockedEdges: new Set(),
    blockedNodes: new Set()
  },

  DEFAULT_WEIGHTS: { traffic: 1, condition: 1, rain: 1, safety: 1 },

  TRAFFIC_LEVELS: { low: 1.0, moderate: 1.5, high: 2.2, severe: 3.5 },
  RAIN_LEVELS: { none: 0, low: 0.5, moderate: 1.2, severe: 2.5 },
  CONDITION_LEVELS: { good: 0, fair: 0.5, poor: 1 },

  roadWeights: {
    arterial: 0.9,
    avenue: 1.0,
    street: 1.25,
    alley: 1.70,
    broken: 2.20
  },

  freeFlowSpeedKmh: {
    arterial: 50,
    avenue: 40,
    street: 28,
    alley: 15,
    broken: 12
  },

  edgeConditions(edge, env = this.defaultEnv) {
    const c = { traffic: null, rain: null, condition: 0, safety: null, closed: "none" };
    const apply = src => {
      if (!src) return;
      ["traffic", "rain", "condition", "safety", "closed"].forEach(k => {
        if (src[k] !== undefined && src[k] !== null) c[k] = src[k];
      });
    };
    const scenario = env.scenario;
    if (scenario) {
      apply(scenario.classConditions && scenario.classConditions[edge.highway]);
      apply(scenario.edgeConditions && scenario.edgeConditions[edge.id]);
    }
    apply(env.overrides && env.overrides[edge.id]);
    return c;
  },

  canTraverse(edge, env, direction, conditions = this.edgeConditions(edge, env)) {
    if (env.blockedEdges && env.blockedEdges.has(edge.id)) return false;
    if (env.blockedNodes && (env.blockedNodes.has(edge.u) || env.blockedNodes.has(edge.v))) return false;
    if (conditions.closed === "both") return false;
    if (conditions.closed === "forward" && direction === 1) return false;
    if (conditions.closed === "backward" && direction === -1) return false;
    if (env.respectOneWay !== false && edge.dir && direction === -edge.dir) return false;
    return true;
  },

  closureState(edge, env) {
    if (env.blockedEdges && env.blockedEdges.has(edge.id)) return "closed";
    if (env.blockedNodes && (env.blockedNodes.has(edge.u) || env.blockedNodes.has(edge.v))) return "closed";
    const closed = this.edgeConditions(edge, env).closed;
    return closed === "both" ? "closed" : closed === "none" ? "open" : "partial";
  },

  isBlocked(edge, env) {
    return this.closureState(edge, env) === "closed";
  },

  edgeFactors(edge, env = this.defaultEnv, conditions = this.edgeConditions(edge, env)) {
    const w = env.weights || this.DEFAULT_WEIGHTS;
    const roadWeight = this.roadWeights[edge.road_type] || 1.2;
    const isNight = env.timeOfDay === "night";

    let trafficIntensity = conditions.traffic;
    if (trafficIntensity === null) {
      const isPort = edge.port_zone || edge.name.includes("Port") || edge.name.includes("Saltgola");
      trafficIntensity = env.trafficLevel * (isPort ? 1.5 : 1.0) * (isNight ? 0.6 : 1.0);
    }
    const traffic = 1.0 + w.traffic * trafficIntensity;

    let water = conditions.rain;
    if (water === null) {
      water = env.floodLevel * edge.flood_susceptibility * (env.season === "monsoon" ? 1.8 : 1.0);
    }
    const flood = 1.0 + w.rain * water;

    const condition = 1.0 + w.condition * conditions.condition;

    const safetyDeficit = conditions.safety !== null ? conditions.safety : 1.0 - edge.night_safety;
    const safety = isNight
      ? 1.0 + w.safety * safetyDeficit * env.safetyPriority * 2.2
      : 1.0 + w.safety * safetyDeficit * 0.15;

    const junctionDelayMins = (edge.junction_delay_sec / 60.0) * (isNight ? 0.6 : 1.2);

    return { roadWeight, traffic, flood, condition, safety, junctionDelayMins };
  },

  calculateEdgeCost(edge, env = this.defaultEnv, direction = 1) {
    const c = this.edgeConditions(edge, env);
    if (!this.canTraverse(edge, env, direction, c)) return Infinity;
    const f = this.edgeFactors(edge, env, c);

    const dynamicCost = (edge.distance_km * f.roadWeight * f.traffic * f.flood * f.condition * f.safety) + f.junctionDelayMins;

    return Math.round(dynamicCost * 100) / 100;
  },

  congestionIndex(edge, env = this.defaultEnv) {
    const f = this.edgeFactors(edge, env);
    return f.roadWeight * f.traffic * f.flood * f.condition * f.safety;
  },

  calculateEdgeTimeMins(edge, env = this.defaultEnv, direction = 1) {
    const c = this.edgeConditions(edge, env);
    if (!this.canTraverse(edge, env, direction, c)) return Infinity;
    const f = this.edgeFactors(edge, env, c);
    const speed = this.freeFlowSpeedKmh[edge.road_type] || 25;
    return (edge.distance_km / speed) * 60 * f.traffic * f.flood * f.condition + f.junctionDelayMins;
  },

  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  calculateHeuristic(nodeId, targetNodeId, graph, scale = 0.8) {
    const sourceNode = graph.nodes[nodeId];
    const targetNode = graph.nodes[targetNodeId];

    if (!sourceNode || !targetNode) return 0;

    const straightDist = this.haversineDistance(
      sourceNode.lat, sourceNode.lng,
      targetNode.lat, targetNode.lng
    );

    return straightDist * scale;
  }
};

if (typeof window !== 'undefined') {
  window.DynamicCostSystem = DynamicCostSystem;
}
if (typeof module !== 'undefined') {
  module.exports = DynamicCostSystem;
}

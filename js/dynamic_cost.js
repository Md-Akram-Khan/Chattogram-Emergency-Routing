/* ==========================================================================
   CHATTOGRAM DYNAMIC COST & HEURISTIC EVALUATION SYSTEM
   Calculates dynamic cost values under Chattogram urban conditions:
   Tidal Waterlogging (Jolaboddhota), Port Lorry Traffic, Road Condition,
   & Night Safety, with scenario conditions and per-road user overrides.

   Condition precedence for each road (later entries replace earlier ones):
     1. Baseline sliders (traffic, flood depth, time of day, season)
     2. Active scenario conditions for the road's OSM class
     3. Active scenario conditions for that specific road
     4. Saved user override for that road
   ========================================================================== */

const DynamicCostSystem = {
  defaultEnv: {
    trafficLevel: 2.2,       // 1.0 (Light), 1.5 (Moderate), 2.2 (Heavy Port Lorry), 3.5 (Gridlock)
    floodLevel: 1.2,         // 0.0 (None), 0.5 (Ankle), 1.2 (Knee - High Tide), 2.5 (Severe Inundation)
    timeOfDay: "night",      // "day" | "night"
    season: "monsoon",       // "dry" | "monsoon" | "winter"
    safetyPriority: 1.5,     // Safety weight multiplier
    respectOneWay: true,     // false lets emergency vehicles drive against one-way streets
    weights: { traffic: 1, condition: 1, rain: 1, safety: 1 },
    scenario: null,          // active scenario object (see scenarios.js)
    overrides: {},           // edge id -> saved user conditions
    blockedEdges: new Set(), // Quick-blocked edge IDs (both directions)
    blockedNodes: new Set()  // Blocked node IDs
  },

  DEFAULT_WEIGHTS: { traffic: 1, condition: 1, rain: 1, safety: 1 },

  // Named levels used by the condition editor and scenarios
  TRAFFIC_LEVELS: { low: 1.0, moderate: 1.5, high: 2.2, severe: 3.5 },     // traffic intensity
  RAIN_LEVELS: { none: 0, low: 0.5, moderate: 1.2, severe: 2.5 },          // standing water (m)
  CONDITION_LEVELS: { good: 0, fair: 0.5, poor: 1 },                       // surface damage severity

  // Road Surface & Capacity Weight (w_road)
  roadWeights: {
    arterial: 0.9,   // Wide Trunk Highway / CDA Avenue
    avenue: 1.0,     // Main Avenue / Link Road
    street: 1.25,    // Secondary Street
    alley: 1.70,     // Narrow Old City Alley (Khatunganj / Andarkilla)
    broken: 2.20     // Damaged / Broken Surface
  },

  // Free-flow emergency vehicle speed per road type (km/h), used for ETA
  freeFlowSpeedKmh: {
    arterial: 50,
    avenue: 40,
    street: 28,
    alley: 15,
    broken: 12
  },

  /**
   * Effective simulated conditions for one road after applying precedence.
   * null traffic / rain / safety means "use the baseline sliders".
   */
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

  /**
   * Whether the road can be driven in a direction: 1 = u -> v, -1 = v -> u.
   * Checks quick blocks, blocked nodes, closures and (optionally) one-way rules.
   */
  canTraverse(edge, env, direction, conditions = this.edgeConditions(edge, env)) {
    if (env.blockedEdges && env.blockedEdges.has(edge.id)) return false;
    if (env.blockedNodes && (env.blockedNodes.has(edge.u) || env.blockedNodes.has(edge.v))) return false;
    if (conditions.closed === "both") return false;
    if (conditions.closed === "forward" && direction === 1) return false;
    if (conditions.closed === "backward" && direction === -1) return false;
    if (env.respectOneWay !== false && edge.dir && direction === -edge.dir) return false;
    return true;
  },

  /**
   * Closure state for display (one-way rules are not closures):
   * "closed" in both directions, "partial" in one direction, or "open"
   */
  closureState(edge, env) {
    if (env.blockedEdges && env.blockedEdges.has(edge.id)) return "closed";
    if (env.blockedNodes && (env.blockedNodes.has(edge.u) || env.blockedNodes.has(edge.v))) return "closed";
    const closed = this.edgeConditions(edge, env).closed;
    return closed === "both" ? "closed" : closed === "none" ? "open" : "partial";
  },

  isBlocked(edge, env) {
    return this.closureState(edge, env) === "closed";
  },

  /**
   * Individual multipliers that make up the dynamic edge cost
   */
  edgeFactors(edge, env = this.defaultEnv, conditions = this.edgeConditions(edge, env)) {
    const w = env.weights || this.DEFAULT_WEIGHTS;
    const roadWeight = this.roadWeights[edge.road_type] || 1.2;
    const isNight = env.timeOfDay === "night";

    // Traffic Multiplier (Port Container Lorry & Rush Hour Impact)
    let trafficIntensity = conditions.traffic;
    if (trafficIntensity === null) {
      const isPort = edge.port_zone || edge.name.includes("Port") || edge.name.includes("Saltgola");
      trafficIntensity = env.trafficLevel * (isPort ? 1.5 : 1.0) * (isNight ? 0.6 : 1.0);
    }
    const traffic = 1.0 + w.traffic * trafficIntensity;

    // Tidal Surge & Rain Waterlogging (Jolaboddhota Multiplier)
    let water = conditions.rain;
    if (water === null) {
      water = env.floodLevel * edge.flood_susceptibility * (env.season === "monsoon" ? 1.8 : 1.0);
    }
    const flood = 1.0 + w.rain * water;

    // Road surface condition (potholes, damage)
    const condition = 1.0 + w.condition * conditions.condition;

    // Day vs Night Safety Modifier
    const safetyDeficit = conditions.safety !== null ? conditions.safety : 1.0 - edge.night_safety;
    const safety = isNight
      ? 1.0 + w.safety * safetyDeficit * env.safetyPriority * 2.2
      : 1.0 + w.safety * safetyDeficit * 0.15;

    // Junction & Signal Wait Delay
    const junctionDelayMins = (edge.junction_delay_sec / 60.0) * (isNight ? 0.6 : 1.2);

    return { roadWeight, traffic, flood, condition, safety, junctionDelayMins };
  },

  /**
   * Calculates dynamic cost for traversing an edge in Chattogram City.
   * direction: 1 = u -> v (default), -1 = v -> u
   */
  calculateEdgeCost(edge, env = this.defaultEnv, direction = 1) {
    const c = this.edgeConditions(edge, env);
    if (!this.canTraverse(edge, env, direction, c)) return Infinity;
    const f = this.edgeFactors(edge, env, c);

    // Total Dynamic Cost = (Distance * RoadFactor * Traffic * Flood * Condition * Safety) + JunctionDelay
    const dynamicCost = (edge.distance_km * f.roadWeight * f.traffic * f.flood * f.condition * f.safety) + f.junctionDelayMins;

    return Math.round(dynamicCost * 100) / 100;
  },

  /**
   * Per-km congestion index (cost multiplier without junction delay), used for map colouring
   */
  congestionIndex(edge, env = this.defaultEnv) {
    const f = this.edgeFactors(edge, env);
    return f.roadWeight * f.traffic * f.flood * f.condition * f.safety;
  },

  /**
   * Estimated driving time (minutes) for an edge: free-flow speed slowed by
   * traffic, waterlogging and road condition, plus junction wait. Safety is a
   * route preference, not a speed effect, so it is excluded here.
   */
  calculateEdgeTimeMins(edge, env = this.defaultEnv, direction = 1) {
    const c = this.edgeConditions(edge, env);
    if (!this.canTraverse(edge, env, direction, c)) return Infinity;
    const f = this.edgeFactors(edge, env, c);
    const speed = this.freeFlowSpeedKmh[edge.road_type] || 25;
    return (edge.distance_km / speed) * 60 * f.traffic * f.flood * f.condition + f.junctionDelayMins;
  },

  /**
   * Calculates Haversine distance in kilometers
   */
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

  /**
   * Admissible Heuristic Function H(n) for A* and Greedy BFS.
   * `scale` is the minimum cost per straight-line km over all passable edges
   * (see GraphSearchSuite.getSearchContext), so H never overestimates.
   */
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

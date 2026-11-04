/* ==========================================================================
   GRAPH SEARCH ALGORITHMS SUITE
   Implementations of BFS, DFS, UCS, IDS, A*, and Greedy Best-First Search
   (plus a zero-heuristic A* baseline) on a directed view of the road graph,
   with search limits, result statuses and performance instrumentation.

   Result status:
     found            a route was found
     unreachable      the search finished without reaching the goal
     expansion_limit  stopped after limits.maxExpansions node expansions
     depth_limit      DFS / IDS ran out of depth (limits.maxDepth; 0 = no limit, the default)
     timeout          stopped after limits.timeoutMs milliseconds
   Only "unreachable" means no route exists; the limits do not prove that.
   ========================================================================== */

/**
 * Binary min-heap priority queue. Ties are broken by insertion order so
 * results are deterministic.
 */
class PriorityQueue {
  constructor() {
    this.heap = [];
    this.counter = 0;
  }
  less(i, j) {
    const a = this.heap[i], b = this.heap[j];
    return a.priority < b.priority || (a.priority === b.priority && a.order < b.order);
  }
  swap(i, j) {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }
  enqueue(element, priority) {
    this.heap.push({ element, priority, order: this.counter++ });
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  dequeue() {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.heap.length && this.less(l, m)) m = l;
        if (r < this.heap.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top.element;
  }
  isEmpty() {
    return this.heap.length === 0;
  }
  size() {
    return this.heap.length;
  }
}

const GraphSearchSuite = {
  _contextCache: null,

  // maxDepth 0 means no depth limit: plain DFS is complete on a finite graph, and
  // IDS deepens until it finds the goal or has explored everything reachable
  DEFAULT_LIMITS: { maxExpansions: 10000000, timeoutMs: 3000, maxDepth: 0 },
  LIMIT_BOUNDS: { maxExpansions: [1, 50000000], timeoutMs: [10, 60000], maxDepth: [0, 20000] },

  ALGORITHMS: [
    { key: "bfs", name: "BFS (Breadth-First Search)" },
    { key: "dfs", name: "DFS (Depth-First Search)" },
    { key: "ucs", name: "UCS (Uniform Cost Search)" },
    { key: "ids", name: "IDS (Iterative Deepening Search)" },
    { key: "astar", name: "A* Search" },
    { key: "gbfs", name: "Greedy Best-First Search" },
    { key: "astar0", name: "A* (zero heuristic)" }
  ],

  normalizeLimits(limits = {}) {
    const out = {};
    Object.entries(this.DEFAULT_LIMITS).forEach(([k, def]) => {
      const x = limits[k] === undefined ? def : Number(limits[k]);
      const [lo, hi] = this.LIMIT_BOUNDS[k];
      if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${k} must be between ${lo} and ${hi}`);
      out[k] = Math.floor(x);
    });
    return out;
  },

  /**
   * Builds (and caches per environment) the directed adjacency list, an edge
   * lookup by directed node pair, and the heuristic scale for the conditions.
   */
  getSearchContext(graph, envState) {
    const key = JSON.stringify([
      envState.trafficLevel, envState.floodLevel, envState.timeOfDay, envState.season, envState.safetyPriority,
      envState.respectOneWay !== false, envState.weights || null, envState.scenario || null, envState.overrides || null,
      [...(envState.blockedEdges || [])].sort(), [...(envState.blockedNodes || [])].sort()
    ]);
    if (this._contextCache && this._contextCache.graph === graph && this._contextCache.key === key) {
      return this._contextCache.ctx;
    }

    const adj = {};
    const edgeByPair = {};
    let hScale = Infinity;
    Object.keys(graph.nodes).forEach(id => { adj[id] = []; });

    graph.edges.forEach(edge => {
      const u = graph.nodes[edge.u], v = graph.nodes[edge.v];
      const chord = DynamicCostSystem.haversineDistance(u.lat, u.lng, v.lat, v.lng);
      [[edge.u, edge.v, 1], [edge.v, edge.u, -1]].forEach(([from, to, direction]) => {
        const cost = DynamicCostSystem.calculateEdgeCost(edge, envState, direction);
        if (cost === Infinity) return;
        adj[from].push({ neighbor: to, edge, cost, direction });
        edgeByPair[from + "|" + to] = { edge, cost, direction };
        // Cheapest cost per straight-line km: H = scale * haversine is then
        // admissible and consistent, since every arc costs >= scale * its chord
        if (chord > 1e-6) hScale = Math.min(hScale, cost / chord);
      });
    });

    const ctx = { adj, edgeByPair, hScale: hScale === Infinity ? 0 : hScale };
    this._contextCache = { graph, key, ctx };
    return ctx;
  },

  /**
   * Compact integer (CSR) form of the adjacency list for the hot IDS loop:
   * neighbours of node i are targets[offsets[i] .. offsets[i + 1] - 1]
   */
  getIntegerGraph(graph, envState) {
    const ctx = this.getSearchContext(graph, envState);
    if (ctx.intGraph) return ctx.intGraph;

    const ids = Object.keys(ctx.adj);
    const indexOf = new Map(ids.map((id, i) => [id, i]));
    const offsets = new Int32Array(ids.length + 1);
    ids.forEach((id, i) => { offsets[i + 1] = offsets[i] + ctx.adj[id].length; });
    const targets = new Int32Array(offsets[ids.length]);
    ids.forEach((id, i) => ctx.adj[id].forEach((item, k) => { targets[offsets[i] + k] = indexOf.get(item.neighbor); }));

    ctx.intGraph = { ids, indexOf, offsets, targets };
    return ctx.intGraph;
  },

  /**
   * Helper: Builds Adjacency List for the graph under current conditions
   */
  getAdjacencyList(graph, envState) {
    return this.getSearchContext(graph, envState).adj;
  },

  /**
   * Helper: Calculates final path metrics (cost, distance, time, safety)
   */
  calculatePathMetrics(path, graph, envState) {
    const { edgeByPair } = this.getSearchContext(graph, envState);
    let totalCost = 0;
    let totalDistance = 0;
    let totalTime = 0;
    let safetyDistance = 0;
    const pathEdges = [];

    for (let i = 0; i < path.length - 1; i++) {
      const entry = edgeByPair[path[i] + "|" + path[i + 1]];
      if (!entry) continue;
      totalCost += entry.cost;
      totalDistance += entry.edge.distance_km;
      totalTime += DynamicCostSystem.calculateEdgeTimeMins(entry.edge, envState, entry.direction);
      safetyDistance += entry.edge.night_safety * entry.edge.distance_km;
      pathEdges.push(entry.edge.id);
    }

    // Distance-weighted average night safety of the route (0..1)
    const pathSafety = totalDistance > 0 ? safetyDistance / totalDistance : 0;

    return {
      totalCost: Math.round(totalCost * 100) / 100,
      totalDistance: Math.round(totalDistance * 100) / 100,
      estimatedTimeMins: Math.round(totalTime * 10) / 10,
      pathSafety: Math.round(pathSafety * 100) / 100,
      pathEdges: pathEdges
    };
  },

  reconstructPath(parent, startId, targetId) {
    const path = [targetId];
    let curr = targetId;
    while (curr !== startId) {
      curr = parent[curr];
      path.unshift(curr);
    }
    return path;
  },

  newStats() {
    // expansionInfo[i] describes visitedNodesOrder[i]: parent plus g / h / f or depth
    return { visitedNodesOrder: [], expansionInfo: [], nodesExpanded: 0, nodesGenerated: 1, maxQueueSize: 1 };
  },

  // Returns a stop status when a limit is hit, otherwise null
  checkLimits(stats, limits, startTime) {
    if (stats.nodesExpanded >= limits.maxExpansions) return "expansion_limit";
    if ((stats.nodesExpanded & 1023) === 0 && performance.now() - startTime > limits.timeoutMs) return "timeout";
    return null;
  },

  buildResult(algoKey, path, status, stats, startTime, graph, envState) {
    const endTime = performance.now();
    const metrics = this.calculatePathMetrics(path, graph, envState);
    const info = this.ALGORITHMS.find(a => a.key === algoKey);
    return {
      algoName: info.name,
      algoKey: algoKey,
      status: status,
      found: status === "found",
      path: path,
      pathEdges: metrics.pathEdges,
      routeNodes: path.length,
      visitedNodesOrder: stats.visitedNodesOrder,
      expansionInfo: stats.expansionInfo,
      nodesExpanded: stats.nodesExpanded,
      nodesGenerated: stats.nodesGenerated,
      maxQueueSize: stats.maxQueueSize,
      executionTimeMs: Math.round((endTime - startTime) * 1000) / 1000,
      totalCost: metrics.totalCost,
      totalDistance: metrics.totalDistance,
      estimatedTimeMins: metrics.estimatedTimeMins,
      pathSafety: metrics.pathSafety
    };
  },

  // =========================================================================
  // 1. BREADTH-FIRST SEARCH (BFS)
  // =========================================================================
  runBFS(startId, targetId, graph, envState, options = {}) {
    const startTime = performance.now();
    const limits = this.normalizeLimits(options.limits);
    const { adj } = this.getSearchContext(graph, envState);
    const queue = [startId];
    let head = 0;
    const visited = new Set([startId]);
    const parent = {};
    const depth = { [startId]: 0 };
    const stats = this.newStats();
    let status = "unreachable";

    while (head < queue.length) {
      const stop = this.checkLimits(stats, limits, startTime);
      if (stop) { status = stop; break; }
      stats.maxQueueSize = Math.max(stats.maxQueueSize, queue.length - head);
      const current = queue[head++];
      stats.visitedNodesOrder.push(current);
      stats.expansionInfo.push({ parent: parent[current] ?? null, depth: depth[current] });
      stats.nodesExpanded++;

      if (current === targetId) { status = "found"; break; }

      for (const item of adj[current]) {
        if (!visited.has(item.neighbor)) {
          visited.add(item.neighbor);
          parent[item.neighbor] = current;
          depth[item.neighbor] = depth[current] + 1;
          queue.push(item.neighbor);
          stats.nodesGenerated++;
        }
      }
    }

    const path = status === "found" ? this.reconstructPath(parent, startId, targetId) : [];
    return this.buildResult("bfs", path, status, stats, startTime, graph, envState);
  },

  // =========================================================================
  // 2. DEPTH-FIRST SEARCH (DFS) - optionally depth limited by limits.maxDepth
  // =========================================================================
  runDFS(startId, targetId, graph, envState, options = {}) {
    const startTime = performance.now();
    const limits = this.normalizeLimits(options.limits);
    const { adj } = this.getSearchContext(graph, envState);
    const stack = [[startId, 0]];
    const visited = new Set();
    const parent = {};
    const stats = this.newStats();
    let status = "unreachable";
    let depthCut = false;

    while (stack.length > 0) {
      const stop = this.checkLimits(stats, limits, startTime);
      if (stop) { status = stop; break; }
      stats.maxQueueSize = Math.max(stats.maxQueueSize, stack.length);
      const [current, depth] = stack.pop();
      if (visited.has(current)) continue;

      visited.add(current);
      stats.visitedNodesOrder.push(current);
      stats.expansionInfo.push({ parent: parent[current] ?? null, depth });
      stats.nodesExpanded++;

      if (current === targetId) { status = "found"; break; }
      if (limits.maxDepth && depth >= limits.maxDepth) { depthCut = true; continue; }

      for (const item of adj[current]) {
        if (!visited.has(item.neighbor)) {
          parent[item.neighbor] = current;
          stack.push([item.neighbor, depth + 1]);
          stats.nodesGenerated++;
        }
      }
    }
    if (status === "unreachable" && depthCut) status = "depth_limit";

    const path = status === "found" ? this.reconstructPath(parent, startId, targetId) : [];
    return this.buildResult("dfs", path, status, stats, startTime, graph, envState);
  },

  // =========================================================================
  // 3. UNIFORM COST SEARCH (UCS / Dijkstra)
  // =========================================================================
  runUCS(startId, targetId, graph, envState, options = {}) {
    return this.bestFirst("ucs", startId, targetId, graph, envState, options, () => 0);
  },

  // =========================================================================
  // 4. ITERATIVE DEEPENING SEARCH (IDS)
  // Each iteration is a depth-limited graph search: a node is re-expanded
  // only when reached with more remaining depth than before, which keeps
  // iterations linear in graph size instead of exponential in depth.
  // =========================================================================
  runIDS(startId, targetId, graph, envState, options = {}) {
    const startTime = performance.now();
    const limits = this.normalizeLimits(options.limits);
    const { ids, indexOf, offsets, targets } = this.getIntegerGraph(graph, envState);
    const start = indexOf.get(startId);
    const target = indexOf.get(targetId);
    const bestRemaining = new Int32Array(ids.length);
    const firstSeen = new Uint8Array(ids.length);
    const stats = this.newStats();
    const path = [];
    let foundPath = null;
    let cutoff = false;
    let stopped = null;
    let depthLimit = 0;

    const depthLimitedSearch = (node, remaining) => {
      if (stopped) return false;
      if (bestRemaining[node] >= remaining) return false;
      bestRemaining[node] = remaining;
      stopped = this.checkLimits(stats, limits, startTime);
      if (stopped) return false;

      path.push(node);
      stats.nodesExpanded++;
      if (path.length > stats.maxQueueSize) stats.maxQueueSize = path.length;
      if (!firstSeen[node]) {
        firstSeen[node] = 1;
        stats.visitedNodesOrder.push(ids[node]);
        stats.expansionInfo.push({ parent: path.length > 1 ? ids[path[path.length - 2]] : null, depth: path.length - 1, limit: depthLimit });
      }

      if (node === target) return true;
      if (remaining === 0) {
        if (offsets[node + 1] > offsets[node]) cutoff = true;
      } else {
        for (let k = offsets[node]; k < offsets[node + 1]; k++) {
          stats.nodesGenerated++;
          if (depthLimitedSearch(targets[k], remaining - 1)) return true;
        }
      }
      path.pop();
      return false;
    };

    let status = "unreachable";
    // No limit: a simple path never has more edges than the graph has nodes
    const maxDepth = limits.maxDepth || ids.length;
    for (let depth = 0; depth <= maxDepth; depth++) {
      depthLimit = depth;
      bestRemaining.fill(-1);
      cutoff = false;
      if (depthLimitedSearch(start, depth)) {
        foundPath = path.map(i => ids[i]);
        status = "found";
        break;
      }
      if (stopped) { status = stopped; break; }
      if (!cutoff) break; // whole reachable graph explored: no path exists
      if (depth === maxDepth) status = "depth_limit";
    }

    return this.buildResult("ids", foundPath || [], status, stats, startTime, graph, envState);
  },

  // =========================================================================
  // 5. A* SEARCH (A-Star) and the zero-heuristic baseline
  // =========================================================================
  runAStar(startId, targetId, graph, envState, options = {}) {
    const { hScale } = this.getSearchContext(graph, envState);
    const weight = options.heuristicWeight ?? 1.0;
    const h = id => DynamicCostSystem.calculateHeuristic(id, targetId, graph, hScale) * weight;
    return this.bestFirst("astar", startId, targetId, graph, envState, options, h);
  },

  // Same engine as A* with H = 0: shows how much work the heuristic saves
  runAStarZero(startId, targetId, graph, envState, options = {}) {
    return this.bestFirst("astar0", startId, targetId, graph, envState, options, () => 0);
  },

  /**
   * Shared best-first engine for UCS (h = 0) and A* (h = heuristic)
   */
  bestFirst(algoKey, startId, targetId, graph, envState, options, h) {
    const startTime = performance.now();
    const limits = this.normalizeLimits(options.limits);
    const { adj } = this.getSearchContext(graph, envState);
    const pq = new PriorityQueue();
    const gCost = { [startId]: 0 };
    const parent = {};
    const visited = new Set();
    const stats = this.newStats();
    let status = "unreachable";

    pq.enqueue(startId, h(startId));

    while (!pq.isEmpty()) {
      const stop = this.checkLimits(stats, limits, startTime);
      if (stop) { status = stop; break; }
      stats.maxQueueSize = Math.max(stats.maxQueueSize, pq.size());
      const current = pq.dequeue();

      if (visited.has(current)) continue;
      visited.add(current);
      stats.visitedNodesOrder.push(current);
      const hNow = h(current);
      stats.expansionInfo.push({ parent: parent[current] ?? null, g: gCost[current], h: hNow, f: gCost[current] + hNow });
      stats.nodesExpanded++;

      if (current === targetId) { status = "found"; break; }

      for (const item of adj[current]) {
        const tentativeGCost = gCost[current] + item.cost;
        if (tentativeGCost < (gCost[item.neighbor] ?? Infinity)) {
          gCost[item.neighbor] = tentativeGCost;
          parent[item.neighbor] = current;
          pq.enqueue(item.neighbor, tentativeGCost + h(item.neighbor));
          stats.nodesGenerated++;
        }
      }
    }

    const path = status === "found" ? this.reconstructPath(parent, startId, targetId) : [];
    return this.buildResult(algoKey, path, status, stats, startTime, graph, envState);
  },

  // =========================================================================
  // 6. GREEDY BEST-FIRST SEARCH (GBFS)
  // =========================================================================
  runGreedyBFS(startId, targetId, graph, envState, options = {}) {
    const startTime = performance.now();
    const limits = this.normalizeLimits(options.limits);
    const { adj, hScale } = this.getSearchContext(graph, envState);
    const h = id => DynamicCostSystem.calculateHeuristic(id, targetId, graph, hScale);
    const pq = new PriorityQueue();
    const parent = {};
    const visited = new Set();
    const stats = this.newStats();
    let status = "unreachable";

    pq.enqueue(startId, h(startId));

    while (!pq.isEmpty()) {
      const stop = this.checkLimits(stats, limits, startTime);
      if (stop) { status = stop; break; }
      stats.maxQueueSize = Math.max(stats.maxQueueSize, pq.size());
      const current = pq.dequeue();

      if (visited.has(current)) continue;
      visited.add(current);
      stats.visitedNodesOrder.push(current);
      stats.expansionInfo.push({ parent: parent[current] ?? null, h: h(current) });
      stats.nodesExpanded++;

      if (current === targetId) { status = "found"; break; }

      for (const item of adj[current]) {
        if (!visited.has(item.neighbor)) {
          if (!(item.neighbor in parent)) parent[item.neighbor] = current;
          pq.enqueue(item.neighbor, h(item.neighbor));
          stats.nodesGenerated++;
        }
      }
    }

    const path = status === "found" ? this.reconstructPath(parent, startId, targetId) : [];
    return this.buildResult("gbfs", path, status, stats, startTime, graph, envState);
  },

  runAlgorithm(key, startId, targetId, graph, envState, options = {}) {
    switch (key) {
      case "bfs": return this.runBFS(startId, targetId, graph, envState, options);
      case "dfs": return this.runDFS(startId, targetId, graph, envState, options);
      case "ucs": return this.runUCS(startId, targetId, graph, envState, options);
      case "ids": return this.runIDS(startId, targetId, graph, envState, options);
      case "astar": return this.runAStar(startId, targetId, graph, envState, options);
      case "gbfs": return this.runGreedyBFS(startId, targetId, graph, envState, options);
      case "astar0": return this.runAStarZero(startId, targetId, graph, envState, options);
      default: throw new Error(`unknown algorithm "${key}"`);
    }
  },

  /**
   * Runs all 6 algorithms (plus the zero-heuristic A* baseline when
   * options.includeZeroHeuristic) on the same graph snapshot
   */
  runAllAlgorithms(startId, targetId, graph, envState, options = {}) {
    const keys = ["bfs", "dfs", "ucs", "ids", "astar", "gbfs"];
    if (options.includeZeroHeuristic) keys.push("astar0");
    return keys.map(k => this.runAlgorithm(k, startId, targetId, graph, envState, options));
  }
};

if (typeof window !== 'undefined') {
  window.GraphSearchSuite = GraphSearchSuite;
}
if (typeof module !== 'undefined') {
  module.exports = { GraphSearchSuite, PriorityQueue };
}

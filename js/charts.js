/* ==========================================================================
   CHART.JS VISUALIZATION ENGINE
   Renders performance graphs, node expansion metrics, execution times,
   and multi-criteria algorithm comparison radar charts.
   ========================================================================== */

const ChartEngine = {
  charts: {},

  // One colour and short label per algorithm, shared with the map's route layers
  ALGO_COLORS: {
    bfs: "#3b82f6",
    dfs: "#8b5cf6",
    ucs: "#10b981",
    ids: "#ec4899",
    astar: "#00f2fe",
    gbfs: "#f59e0b",
    astar0: "#94a3b8"
  },
  ALGO_SHORT: { bfs: "BFS", dfs: "DFS", ucs: "UCS", ids: "IDS", astar: "A*", gbfs: "Greedy", astar0: "A* (h=0)" },

  /**
   * Initializes or updates all 4 benchmark charts with comparison data
   */
  renderBenchmarkCharts(results) {
    if (!results || results.length === 0) return;

    const labels = results.map(r => this.ALGO_SHORT[r.algoKey] || r.algoName);
    const colors = results.map(r => this.ALGO_COLORS[r.algoKey] || "#64748b");

    // Chart 1: Nodes Expanded Bar Chart
    this.renderNodesChart(labels, results.map(r => r.nodesExpanded), colors);

    // Chart 2: Execution Time (ms) Bar Chart
    this.renderTimeChart(labels, results.map(r => r.executionTimeMs), colors);

    // Chart 3: Dynamic Cost vs Physical Distance
    this.renderCostDistanceChart(labels, results.map(r => r.totalCost), results.map(r => r.totalDistance));

    // Chart 4: Radar Multi-Criteria Chart
    this.renderRadarChart(labels, results);
  },

  renderNodesChart(labels, data, colors) {
    const ctx = document.getElementById("chart-nodes");
    if (!ctx) return;

    if (this.charts.nodesChart) this.charts.nodesChart.destroy();

    this.charts.nodesChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Nodes Expanded (Fewer is Better)",
          data: data,
          backgroundColor: colors.map(c => c + "99"),
          borderColor: colors,
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#9ca3af", font: { family: "Inter" } } }
        },
        scales: {
          x: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true }
        }
      }
    });
  },

  renderTimeChart(labels, data, colors) {
    const ctx = document.getElementById("chart-time");
    if (!ctx) return;

    if (this.charts.timeChart) this.charts.timeChart.destroy();

    this.charts.timeChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Execution Time (ms)",
          data: data,
          backgroundColor: colors.map(c => c + "99"),
          borderColor: colors,
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#9ca3af", font: { family: "Inter" } } }
        },
        scales: {
          x: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true }
        }
      }
    });
  },

  renderCostDistanceChart(labels, costData, distanceData) {
    const ctx = document.getElementById("chart-cost-distance");
    if (!ctx) return;

    if (this.charts.costDistChart) this.charts.costDistChart.destroy();

    this.charts.costDistChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Total Dynamic Cost Metric",
            data: costData,
            backgroundColor: "rgba(0, 242, 254, 0.7)",
            borderColor: "#00f2fe",
            borderWidth: 1
          },
          {
            label: "Physical Distance (km)",
            data: distanceData,
            backgroundColor: "rgba(16, 185, 129, 0.7)",
            borderColor: "#10b981",
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#9ca3af", font: { family: "Inter" } } }
        },
        scales: {
          x: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true }
        }
      }
    });
  },

  renderRadarChart(labels, results) {
    const ctx = document.getElementById("chart-radar");
    if (!ctx) return;

    if (this.charts.radarChart) this.charts.radarChart.destroy();

    // Select top 3 benchmark contenders: UCS, A*, and Greedy BFS
    const ucs = results.find(r => r.algoKey === "ucs") || results[2];
    const astar = results.find(r => r.algoKey === "astar") || results[4];
    const gbfs = results.find(r => r.algoKey === "gbfs") || results[5];

    const maxCost = Math.max(1, ...results.filter(r => r.found).map(r => r.totalCost));
    const maxNodes = Math.max(1, ...results.map(r => r.nodesExpanded));
    const maxTime = Math.max(0.001, ...results.map(r => r.executionTimeMs));

    // Scores out of 100, all derived from measured results
    const calcScore = (res) => {
      if (!res.found) return [0, 0, 0, 0, 0];
      return [
        Math.max(10, Math.round((1 - res.totalCost / (maxCost * 1.2)) * 100)),
        Math.max(10, Math.round((1 - res.nodesExpanded / (maxNodes * 1.2)) * 100)),
        Math.max(10, Math.round((1 - res.executionTimeMs / (maxTime * 1.2)) * 100)),
        Math.round(res.pathSafety * 100),
        100
      ];
    };

    this.charts.radarChart = new Chart(ctx, {
      type: "radar",
      data: {
        labels: ["Cost Optimality", "Node Efficiency", "Execution Speed", "Safety Score", "Completeness"],
        datasets: [
          {
            label: "A* Search",
            data: calcScore(astar),
            borderColor: "#00f2fe",
            backgroundColor: "rgba(0, 242, 254, 0.2)"
          },
          {
            label: "UCS / Dijkstra",
            data: calcScore(ucs),
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.2)"
          },
          {
            label: "Greedy BFS",
            data: calcScore(gbfs),
            borderColor: "#f59e0b",
            backgroundColor: "rgba(245, 158, 11, 0.2)"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#9ca3af", font: { family: "Inter" } } }
        },
        scales: {
          r: {
            angleLines: { color: "rgba(255,255,255,0.1)" },
            grid: { color: "rgba(255,255,255,0.1)" },
            pointLabels: { color: "#9ca3af", font: { size: 11, family: "Inter" } },
            ticks: { display: false }
          }
        }
      }
    });
  }
};

if (typeof window !== 'undefined') {
  window.ChartEngine = ChartEngine;
}

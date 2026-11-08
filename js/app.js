document.addEventListener("DOMContentLoaded", () => {
  const COLORS = {
    clear: "#10b981",
    moderate: "#f59e0b",
    severe: "#ef4444",
    blocked: "#a855f7",
    path: "#facc15",
    explored: "#f8fafc"
  };
  const CONGESTION_MODERATE = 4.0;
  const CONGESTION_SEVERE = 9.0;
  const ROAD_RENDER_LIMIT = 2500;
  const JUNCTION_MIN_ZOOM = 16;
  const JUNCTION_RENDER_LIMIT = 1500;
  const PLACE_MIN_ZOOM = 15;
  const PLACE_RENDER_LIMIT = 100;
  const EXPLORE_ANIMATION_MS = 1200;
  const SLIDER_DEBOUNCE_MS = 120;
  const SEARCH_DEBOUNCE_MS = 250;
  const SEARCH_RESULT_LIMIT = 60;
  const GMAPS_MAX_WAYPOINTS = 8;
  const DEFAULT_SNAP_LIMIT_M = 500;
  const MAX_SNAP_LIMIT_M = 2000;
  const OSM_CLASS_RANK = { motorway: 8, trunk: 7, primary: 6, secondary: 5, tertiary: 4, unclassified: 3, residential: 2, living_street: 1, service: 0 };
  const OSM_CLASS_LABELS = {
    motorway: "Motorway", trunk: "Trunk", primary: "Primary", secondary: "Secondary", tertiary: "Tertiary",
    unclassified: "Unclassified", residential: "Residential", living_street: "Living street", service: "Service lane"
  };
  const PLACE_GROUP_COLORS = {
    "Health": "#ef4444", "Emergency & Government": "#f97316", "Education": "#3b82f6", "Worship": "#14b8a6",
    "Transport": "#eab308", "Finance": "#22c55e", "Food": "#ec4899", "Shopping": "#a855f7",
    "Leisure & Tourism": "#06b6d4", "Area / Neighbourhood": "#94a3b8", "Other": "#64748b"
  };
  const STATUS_TEXT = {
    found: "Found",
    unreachable: "No route (unreachable)",
    expansion_limit: "Stopped: expansion limit",
    depth_limit: "Stopped: depth limit",
    timeout: "Stopped: timeout"
  };
  const LEVEL_OPTIONS = {
    traffic: [["", "Baseline"], ...Object.entries(DynamicCostSystem.TRAFFIC_LEVELS).map(([k, v]) => [String(v), k[0].toUpperCase() + k.slice(1)])],
    rain: [["", "Baseline"], ...Object.entries(DynamicCostSystem.RAIN_LEVELS).map(([k, v]) => [String(v), k[0].toUpperCase() + k.slice(1)])],
    condition: [["", "Good (default)"], ["0.5", "Fair"], ["1", "Poor"]],
    closed: [["none", "Open"], ["forward", "Closed A → B"], ["backward", "Closed B → A"], ["both", "Closed both ways"]]
  };
  const ALGO_COLORS = window.ChartEngine.ALGO_COLORS;
  const ALGO_SHORT = window.ChartEngine.ALGO_SHORT;

  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = id => document.getElementById(id);

  if (!window.CHATTOGRAM_GRAPH || !window.CHATTOGRAM_GRAPH.edges || !window.CHATTOGRAM_GRAPH.edges.length) {
    $("map").hidden = true;
    document.querySelectorAll(".map-overlay-stats, .map-legend-overlay").forEach(el => { el.hidden = true; });
    $("setup-panel").hidden = false;
    $("setup-detail").textContent = "js/chattogram_graph.js is missing or empty, so there is no road graph to route on. Searching and routing are disabled until it is built.";
    $("btn-check-dataset").addEventListener("click", () => window.location.reload());
    document.querySelectorAll(".sidebar input, .sidebar select, .sidebar button, .preset-chip").forEach(el => { el.disabled = true; });
    return;
  }

  const settings = PersistentStore.read("settings", {});
  const LIMITS_VERSION = 2;
  function savedLimits(s) {
    const limits = { ...(s.limits || {}) };
    if (s.limitsVersion !== LIMITS_VERSION) delete limits.maxDepth;
    return limits;
  }
  const graph = window.CHATTOGRAM_GRAPH;
  const placesData = window.CHATTOGRAM_PLACES || null;
  const edgeById = new Map(graph.edges.map(e => [e.id, e]));

  const state = {
    graph,
    places: placesData ? placesData.places : [],
    startNodeId: "epz_circle",
    targetNodeId: "cmch",
    snap: { start: null, target: null },
    selectedAlgo: "astar",
    baseWeights: { ...DynamicCostSystem.DEFAULT_WEIGHTS, ...(settings.baseWeights || {}) },
    limits: { ...GraphSearchSuite.DEFAULT_LIMITS, ...savedLimits(settings) },
    snapLimitM: settings.snapLimitM || DEFAULT_SNAP_LIMIT_M,
    includeZeroHeuristic: !!settings.includeZeroHeuristic,
    customScenarios: PersistentStore.loadScenarios(),
    activeScenarioId: settings.activeScenarioId || "normal",
    roadClasses: new Set(settings.roadClasses || Object.keys(OSM_CLASS_RANK)),
    placeGroups: new Set(settings.placeGroups || (placesData ? placesData.groups : [])),
    showPlaces: !!settings.showPlaces,
    envState: {
      trafficLevel: 2.2,
      floodLevel: 1.2,
      timeOfDay: "night",
      season: "monsoon",
      safetyPriority: 1.5,
      respectOneWay: settings.respectOneWay !== false,
      weights: null,
      scenario: null,
      overrides: PersistentStore.loadOverrides(),
      blockedEdges: new Set(),
      blockedNodes: new Set()
    },
    map: null,
    renderer: null,
    edgeLayers: new Map(),
    visibleEdges: new Set(),
    styleVersion: 0,
    junctionLayer: null,
    placeLayer: null,
    routeLayers: new Map(),
    routeVisible: {},
    selectedRouteKey: null,
    beacons: [],
    showExplored: true,
    tracePlayer: null,
    recalcTimer: null,
    chartsDirty: true,
    currentResults: [],
    displayedResult: null,
    compare: null
  };

  const allScenarios = () => ScenarioSystem.builtIns().concat(state.customScenarios);
  const findScenario = id => allScenarios().find(s => s.id === id) || ScenarioSystem.builtIns()[0];
  const nodeLatLng = id => [state.graph.nodes[id].lat, state.graph.nodes[id].lng];

  function saveSettings() {
    PersistentStore.write("settings", {
      baseWeights: state.baseWeights,
      limits: state.limits,
      limitsVersion: LIMITS_VERSION,
      snapLimitM: state.snapLimitM,
      includeZeroHeuristic: state.includeZeroHeuristic,
      activeScenarioId: state.activeScenarioId,
      roadClasses: [...state.roadClasses],
      placeGroups: [...state.placeGroups],
      showPlaces: state.showPlaces,
      respectOneWay: state.envState.respectOneWay
    });
  }

  function applyScenarioToEnv() {
    const scenario = findScenario(state.activeScenarioId);
    state.activeScenarioId = scenario.id;
    state.envState.scenario = scenario.id === "normal" ? null : scenario;
    state.envState.weights = scenario.weights || state.baseWeights;
  }

  const nodeIndex = new SpatialIndex(0.004);
  Object.values(graph.nodes).forEach(n => nodeIndex.insertPoint(n, n.lat, n.lng));

  const edgeIndex = new SpatialIndex(0.01);
  graph.edges.forEach(e => {
    let s = Infinity, w = Infinity, n = -Infinity, ea = -Infinity;
    e.geom.forEach(([lat, lng]) => { s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lng); ea = Math.max(ea, lng); });
    edgeIndex.insertBox(e, s, w, n, ea);
  });

  const placeIndex = new SpatialIndex(0.004);
  state.places.forEach(p => placeIndex.insertPoint(p, p.lat, p.lng));

  function initMap() {
    const googleStreets = L.tileLayer("https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
      attribution: '&copy; <a href="https://maps.google.com">Google Maps</a>',
      maxZoom: 20
    });
    const googleSatellite = L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      attribution: '&copy; <a href="https://maps.google.com">Google Maps Satellite</a>',
      maxZoom: 20
    });
    const googleTerrain = L.tileLayer("https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}", {
      attribution: '&copy; <a href="https://maps.google.com">Google Maps Terrain</a>',
      maxZoom: 20
    });
    const cartoDark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: "abcd",
      maxZoom: 19
    });

    state.renderer = L.canvas({ padding: 0.5, tolerance: 6 });

    state.map = L.map("map", {
      center: [22.3450, 91.8150],
      zoom: 13,
      zoomSnap: 0.5,
      zoomControl: true,
      preferCanvas: true,
      layers: [googleStreets]
    });
    state.map.attributionControl.addAttribution('Road &amp; place data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');

    L.control.layers({
      "🗺️ Google Maps (Streets)": googleStreets,
      "🛰️ Google Maps (Satellite)": googleSatellite,
      "⛰️ Google Maps (Terrain)": googleTerrain,
      "🌙 Dark Command Center": cartoDark
    }, null, { position: 'topright' }).addTo(state.map);

    L.Popup.prototype.options.autoPanPaddingTopLeft = L.point(20, 200);
    L.Popup.prototype.options.autoPanPaddingBottomRight = L.point(300, 40);

    [["routePane", 440], ["traceTopPane", 460]].forEach(([name, z]) => {
      const pane = state.map.createPane(name);
      pane.style.zIndex = z;
      pane.style.pointerEvents = "none";
    });
    state.routeRenderer = L.canvas({ pane: "routePane", padding: 0.5 });

    state.junctionLayer = L.layerGroup().addTo(state.map);
    state.placeLayer = L.layerGroup().addTo(state.map);
    state.tracePlayer = new TracePlayer({
      map: state.map,
      renderer: state.renderer,
      topRenderer: L.canvas({ pane: "traceTopPane", padding: 0.5 }),
      graph: state.graph,
      el: {
        panel: $("trace-panel"), summary: $("trace-summary"), detail: $("trace-detail"), list: $("trace-list"),
        spacer: $("trace-spacer"), play: document.querySelector('[data-trace="play"]'), speed: $("trace-speed"),
        jump: $("trace-jump-input"), follow: $("trace-follow")
      }
    });

    state.map.on("moveend", refreshViewportLayers);
    state.map.on("click", e => openNearestNodePopup(e.latlng));
    state.map.on("popupopen", e => wirePopup(e.popup.getElement()));
  }

  function viewportBounds() {
    const b = state.map.getBounds().pad(0.1);
    return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
  }

  function refreshViewportLayers() {
    refreshRoadLayer();
    refreshJunctionLayer();
    refreshPlaceLayer();
  }

  function refreshRoadLayer() {
    let edges = edgeIndex.query(...viewportBounds()).filter(e => state.roadClasses.has(e.highway));
    const total = edges.length;
    if (total > ROAD_RENDER_LIMIT) {
      edges.sort((a, b) => (OSM_CLASS_RANK[b.highway] - OSM_CLASS_RANK[a.highway]) || (b.distance_km - a.distance_km));
      edges = edges.slice(0, ROAD_RENDER_LIMIT);
    }
    const next = new Set(edges.map(e => e.id));
    state.visibleEdges.forEach(id => {
      if (!next.has(id)) state.edgeLayers.get(id).polyline.remove();
    });
    let added = 0;
    edges.forEach(e => {
      let entry = state.edgeLayers.get(e.id);
      if (!entry) {
        const polyline = L.polyline(e.geom, {
          renderer: state.renderer,
          weight: e.road_type === "arterial" ? 3.5 : e.road_type === "alley" ? 1.5 : 2.2,
          opacity: 0.8,
          lineCap: "round",
          bubblingMouseEvents: false
        });
        polyline.bindPopup(() => edgePopupHtml(e), { maxWidth: 360, className: "road-popup" });
        entry = { polyline, edge: e, styleVersion: -1 };
        state.edgeLayers.set(e.id, entry);
      }
      styleEdge(entry);
      if (!state.visibleEdges.has(e.id)) { entry.polyline.addTo(state.map); added++; }
    });
    state.visibleEdges = next;
    if (added && state.tracePlayer) state.tracePlayer.raiseDots();

    const notice = $("viewport-notice");
    notice.hidden = total <= ROAD_RENDER_LIMIT;
    notice.textContent = `Showing ${ROAD_RENDER_LIMIT.toLocaleString()} of ${total.toLocaleString()} roads in view (main roads first). Zoom in to see every road.`;
  }

  function edgeColor(edge) {
    if (DynamicCostSystem.closureState(edge, state.envState) !== "open") return COLORS.blocked;
    const congestion = DynamicCostSystem.congestionIndex(edge, state.envState);
    if (congestion >= CONGESTION_SEVERE) return COLORS.severe;
    if (congestion >= CONGESTION_MODERATE) return COLORS.moderate;
    return COLORS.clear;
  }

  function styleEdge(entry) {
    if (entry.styleVersion === state.styleVersion) return;
    entry.styleVersion = state.styleVersion;
    const closure = DynamicCostSystem.closureState(entry.edge, state.envState);
    entry.polyline.setStyle({
      color: edgeColor(entry.edge),
      dashArray: closure === "partial" ? "6, 6" : closure === "closed" ? "2, 6" : null,
      opacity: closure !== "open" ? 0.95 : 0.8
    });
  }

  function restyleEdges() {
    state.styleVersion++;
    state.visibleEdges.forEach(id => styleEdge(state.edgeLayers.get(id)));
  }

  function refreshJunctionLayer() {
    state.junctionLayer.clearLayers();
    if (state.map.getZoom() < JUNCTION_MIN_ZOOM) return;
    nodeIndex.query(...viewportBounds()).slice(0, JUNCTION_RENDER_LIMIT).forEach(node => {
      L.circleMarker([node.lat, node.lng], {
        renderer: state.renderer,
        radius: 3,
        color: "#e2e8f0",
        weight: 1,
        fillColor: "#3b82f6",
        fillOpacity: 0.9,
        bubblingMouseEvents: false
      }).bindPopup(() => nodePopupHtml(node, null)).addTo(state.junctionLayer);
    });
  }

  function refreshPlaceLayer() {
    state.placeLayer.clearLayers();
    if (!state.showPlaces || state.map.getZoom() < PLACE_MIN_ZOOM) return;
    const inView = placeIndex.query(...viewportBounds()).filter(p => state.placeGroups.has(p.group));
    inView.slice(0, PLACE_RENDER_LIMIT).forEach(place => {
      L.circleMarker([place.lat, place.lng], {
        renderer: state.renderer,
        radius: 4.5,
        color: "#0f172a",
        weight: 1,
        fillColor: PLACE_GROUP_COLORS[place.group] || PLACE_GROUP_COLORS.Other,
        fillOpacity: 0.95,
        bubblingMouseEvents: false
      }).bindPopup(() => placePopupHtml(place)).addTo(state.placeLayer);
    });
    if (inView.length > PLACE_RENDER_LIMIT) {
      const notice = $("viewport-notice");
      notice.hidden = false;
      notice.textContent = `Showing ${PLACE_RENDER_LIMIT} of ${inView.length} places in view. Zoom in, or search for a place by name.`;
    }
  }

  function endpointButtons(nodeId, snapM, label) {
    const data = `data-id="${nodeId}" data-snap="${snapM ?? 0}" data-label="${escapeHtml(label || "")}"`;
    return `
      <div style="margin-top: 10px; display: flex; gap: 6px;">
        <button data-action="set-start" ${data} class="btn-secondary popup-btn">Set as Start 🏁</button>
        <button data-action="set-target" ${data} class="btn-secondary popup-btn">Set as Destination 🎯</button>
      </div>`;
  }

  function nodePopupHtml(node, snapM) {
    return `
      <div class="popup-body">
        <strong class="popup-title">${escapeHtml(node.name)}</strong><br/>
        <span class="popup-muted">${escapeHtml(node.description)} · node ${escapeHtml(node.id)}</span>
        ${snapM !== null ? `<br/><span class="popup-muted">Snapped ${snapM} m from the clicked point</span>` : ""}
        ${endpointButtons(node.id, snapM, null)}
      </div>`;
  }

  function placePopupHtml(place) {
    const node = state.graph.nodes[place.node];
    const tooFar = place.snapM > state.snapLimitM;
    return `
      <div class="popup-body">
        <strong class="popup-title">${escapeHtml(place.name)}</strong>
        ${place.bn ? `<br/><span>${escapeHtml(place.bn)}</span>` : ""}<br/>
        <span class="popup-muted">${escapeHtml(place.category)} · ${escapeHtml(place.group)}${place.locality ? " · " + escapeHtml(place.locality) : ""}</span><br/>
        <span class="popup-muted">Nearest road node: ${escapeHtml(node.name)} (${place.snapM} m)</span>
        ${tooFar ? `<p class="form-error">More than the ${state.snapLimitM} m snapping limit from any road.</p>` : endpointButtons(place.node, place.snapM, place.name)}
      </div>`;
  }

  function openNearestNodePopup(latlng) {
    const hit = nodeIndex.nearest(latlng.lat, latlng.lng);
    const popup = L.popup();
    if (!hit) return;
    const snapM = Math.round(hit.distanceKm * 1000);
    if (snapM > state.snapLimitM) {
      popup.setLatLng(latlng).setContent(`<div class="popup-body"><strong>No road node within ${state.snapLimitM} m.</strong><br/>
        <span class="popup-muted">The nearest one is ${snapM} m away. Raise the snapping limit under Search Limits, or click closer to a road.</span></div>`);
    } else {
      popup.setLatLng([hit.item.lat, hit.item.lng]).setContent(nodePopupHtml(hit.item, snapM));
    }
    popup.openOn(state.map);
  }

  function selectOptions(options, value) {
    return options.map(([v, label]) => `<option value="${v}"${String(value ?? "") === v ? " selected" : ""}>${label}</option>`).join("");
  }

  function directionCost(edge, direction) {
    const conditions = DynamicCostSystem.edgeConditions(edge, state.envState);
    if (state.envState.respectOneWay && edge.dir && direction === -edge.dir) return "not allowed (one-way)";
    if (!DynamicCostSystem.canTraverse(edge, state.envState, direction, conditions)) return "closed";
    const cost = DynamicCostSystem.calculateEdgeCost(edge, state.envState, direction);
    const mins = DynamicCostSystem.calculateEdgeTimeMins(edge, state.envState, direction);
    return `${cost} (${mins.toFixed(1)} min)`;
  }

  function edgePopupHtml(edge) {
    const o = state.envState.overrides[edge.id] || {};
    const u = state.graph.nodes[edge.u], v = state.graph.nodes[edge.v];
    const quickBlocked = state.envState.blockedEdges.has(edge.id);
    const custom = state.customScenarios;
    const oneway = edge.dir === 0 ? "No" : edge.dir === 1 ? "Yes, A → B only" : "Yes, B → A only";
    return `
      <div class="popup-body road-inspector" data-edge="${edge.id}">
        <strong class="popup-title">${escapeHtml(edge.name)}</strong>
        <table class="inspector-table">
          <tr><th>OSM way</th><td><a href="https://www.openstreetmap.org/way/${edge.osm_id}" target="_blank" rel="noopener">${edge.osm_id}</a></td></tr>
          <tr><th>OSM class</th><td>${escapeHtml(OSM_CLASS_LABELS[edge.highway] || edge.highway)} (${escapeHtml(edge.road_type)})</td></tr>
          <tr><th>Edge</th><td>${edge.id}</td></tr>
          <tr><th>A (from)</th><td>${escapeHtml(u.name)} <span class="popup-muted">${u.id}</span></td></tr>
          <tr><th>B (to)</th><td>${escapeHtml(v.name)} <span class="popup-muted">${v.id}</span></td></tr>
          <tr><th>Length</th><td>${edge.distance_km} km</td></tr>
          <tr><th>One-way</th><td>${oneway}</td></tr>
          <tr><th>Flood risk</th><td>${Math.round(edge.flood_susceptibility * 100)}%${edge.port_zone ? " · port zone" : ""}</td></tr>
          <tr><th>Night safety</th><td>${Math.round(edge.night_safety * 100)}%</td></tr>
          <tr><th>Cost A → B</th><td>${directionCost(edge, 1)}</td></tr>
          <tr><th>Cost B → A</th><td>${directionCost(edge, -1)}</td></tr>
        </table>

        <div class="editor-title">Simulated conditions for this road${state.envState.overrides[edge.id] ? ' <span class="badge-win">saved override</span>' : ""}</div>
        <div class="editor-grid">
          <label>Traffic</label><select data-field="traffic" class="select-input">${selectOptions(LEVEL_OPTIONS.traffic, o.traffic)}</select>
          <label>Waterlogging</label><select data-field="rain" class="select-input">${selectOptions(LEVEL_OPTIONS.rain, o.rain)}</select>
          <label>Road condition</label><select data-field="condition" class="select-input">${selectOptions(LEVEL_OPTIONS.condition, o.condition)}</select>
          <label>Safety penalty</label>
          <span class="safety-field">
            <input type="checkbox" data-field="safety-on" ${o.safety !== undefined ? "checked" : ""} title="Override the safety penalty">
            <input type="range" data-field="safety" min="0" max="1" step="0.05" value="${o.safety ?? (1 - edge.night_safety).toFixed(2)}">
            <output>${(o.safety ?? (1 - edge.night_safety)).toFixed(2)}</output>
          </span>
          <label>Availability</label><select data-field="closed" class="select-input">${selectOptions(LEVEL_OPTIONS.closed, o.closed || "none")}</select>
        </div>
        <div class="editor-actions">
          <button data-action="save-override" data-id="${edge.id}" class="btn-primary popup-btn">Save &amp; recalculate</button>
          <button data-action="cancel-edit" class="btn-secondary popup-btn">Cancel</button>
          <button data-action="reset-override" data-id="${edge.id}" class="btn-secondary popup-btn">Reset road</button>
          <button data-action="toggle-block" data-id="${edge.id}" class="btn-secondary popup-btn">${quickBlocked ? "🔓 Unblock" : "⛔ Quick block"}</button>
        </div>
        ${custom.length ? `
        <div class="editor-actions">
          <select data-field="scenario-target" class="select-input">${custom.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select>
          <button data-action="add-to-scenario" data-id="${edge.id}" class="btn-secondary popup-btn">Add to scenario</button>
        </div>` : `<p class="popup-muted">Create a custom scenario in the Scenario Studio to add this road to it.</p>`}
        <p class="form-error" data-field="error" hidden></p>
      </div>`;
  }

  function readEditor(container) {
    const get = f => container.querySelector(`[data-field="${f}"]`);
    const raw = {
      traffic: get("traffic").value,
      rain: get("rain").value,
      condition: get("condition").value,
      safety: get("safety-on").checked ? get("safety").value : "",
      closed: get("closed").value
    };
    return ScenarioSystem.cleanConditions(raw, "road");
  }

  function wirePopup(container) {
    const range = container.querySelector('[data-field="safety"]');
    if (range) {
      range.addEventListener("input", () => {
        range.nextElementSibling.textContent = Number(range.value).toFixed(2);
        container.querySelector('[data-field="safety-on"]').checked = true;
      });
    }

    container.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        const error = container.querySelector('[data-field="error"]');
        try {
          switch (action) {
            case "set-start":
            case "set-target":
              setEndpoint(action === "set-start" ? "start" : "target", id, Number(btn.getAttribute("data-snap")), btn.getAttribute("data-label"));
              state.map.closePopup();
              triggerDynamicRecalculation({ fit: true });
              return;
            case "toggle-block":
              if (state.envState.blockedEdges.has(id)) state.envState.blockedEdges.delete(id);
              else state.envState.blockedEdges.add(id);
              break;
            case "save-override": {
              const conditions = readEditor(container);
              if (Object.keys(conditions).length) state.envState.overrides[id] = conditions;
              else delete state.envState.overrides[id];
              PersistentStore.saveOverrides(state.envState.overrides);
              break;
            }
            case "reset-override":
              delete state.envState.overrides[id];
              PersistentStore.saveOverrides(state.envState.overrides);
              break;
            case "cancel-edit":
              state.map.closePopup();
              return;
            case "add-to-scenario": {
              const scenarioId = container.querySelector('[data-field="scenario-target"]').value;
              const scenario = state.customScenarios.find(s => s.id === scenarioId);
              const conditions = readEditor(container);
              if (!Object.keys(conditions).length) throw new Error("Set at least one condition before adding the road to a scenario.");
              scenario.edgeConditions[id] = conditions;
              saveCustomScenario(scenario);
              break;
            }
          }
        } catch (err) {
          if (error) { error.hidden = false; error.textContent = err.message; }
          return;
        }
        state.map.closePopup();
        triggerDynamicRecalculation();
      });
    });
  }

  function setEndpoint(kind, nodeId, snapM, label) {
    state[kind === "start" ? "startNodeId" : "targetNodeId"] = nodeId;
    state.snap[kind] = nodeId ? { snapM: snapM || 0, label: label || null } : null;
  }

  function renderSnapInfo() {
    ["start", "target"].forEach(kind => {
      const el = $(`snap-${kind}`);
      const nodeId = state[kind === "start" ? "startNodeId" : "targetNodeId"];
      if (!nodeId) { el.textContent = ""; return; }
      const node = state.graph.nodes[nodeId];
      const snap = state.snap[kind];
      el.textContent = snap && snap.snapM
        ? `Road node: ${node.name} · snapped ${snap.snapM} m${snap.label ? ` from ${snap.label}` : ""}`
        : `Road node: ${node.name} (${node.id})`;
    });
  }

  function updateBeacons() {
    state.beacons.forEach(b => state.map.removeLayer(b));
    state.beacons = [
      ["start", state.startNodeId, "🏁", "START"],
      ["target", state.targetNodeId, "🎯", "DESTINATION"]
    ].filter(([, id]) => id).map(([kind, id, emoji, label]) => {
      const node = state.graph.nodes[id];
      return L.marker([node.lat, node.lng], {
        icon: L.divIcon({
          className: `beacon-marker beacon-${kind}`,
          html: `
            <div class="beacon-ripple"></div>
            <div class="beacon-core">${emoji}</div>
            <div class="beacon-tag">${label}: ${escapeHtml(node.name)}</div>
          `,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        }),
        zIndexOffset: 1000,
        interactive: false
      }).addTo(state.map);
    });
  }

  function pathLatLngs(result) {
    const latLngs = [];
    result.pathEdges.forEach((edgeId, i) => {
      const edge = edgeById.get(edgeId);
      const coords = edge.u === result.path[i] ? edge.geom : edge.geom.slice().reverse();
      latLngs.push(...(latLngs.length ? coords.slice(1) : coords));
    });
    return latLngs;
  }

  function clearRoutes() {
    state.routeLayers.forEach(layers => layers.forEach(l => l.remove()));
    state.routeLayers.clear();
  }

  function drawRoutes() {
    clearRoutes();
    const compare = state.selectedAlgo === "all";
    state.currentResults.forEach(res => {
      if (!res.found || res.path.length < 2) return;
      if (compare && state.routeVisible[res.algoKey] === false) return;
      const selected = res.algoKey === state.selectedRouteKey;
      const color = compare ? ALGO_COLORS[res.algoKey] : COLORS.path;
      const latLngs = pathLatLngs(res);
      const layers = selected
        ? [
            L.polyline(latLngs, { renderer: state.routeRenderer, color: COLORS.path, weight: 24, opacity: 0.45, lineCap: "round", interactive: false }),
            L.polyline(latLngs, { renderer: state.routeRenderer, color: "#111827", weight: 11, opacity: 0.95, lineCap: "round", interactive: false }),
            L.polyline(latLngs, { renderer: state.routeRenderer, color, weight: 7, opacity: 1, lineCap: "round", interactive: false })
          ]
        : [L.polyline(latLngs, { renderer: state.routeRenderer, color, weight: 3.5, opacity: 0.85, dashArray: "8, 6", interactive: false })];
      state.routeLayers.set(res.algoKey, layers.map(l => l.addTo(state.map)));
    });
    (state.routeLayers.get(state.selectedRouteKey) || []).forEach(l => l.bringToFront());
  }

  function renderRoutesPanel() {
    const panel = $("routes-panel");
    if (state.selectedAlgo !== "all") { panel.hidden = true; return; }
    panel.hidden = false;
    const firstWithRoute = {};
    $("routes-list").innerHTML = state.currentResults.map(res => {
      const sig = res.found ? res.pathEdges.join(",") : null;
      let same = "";
      if (sig !== null) {
        if (firstWithRoute[sig]) same = `<span class="route-same">same route as ${ALGO_SHORT[firstWithRoute[sig]]}</span>`;
        else firstWithRoute[sig] = res.algoKey;
      }
      const checked = state.routeVisible[res.algoKey] !== false ? "checked" : "";
      return `
        <div class="route-row${res.algoKey === state.selectedRouteKey ? " selected" : ""}">
          <input type="checkbox" data-route-toggle="${res.algoKey}" ${checked} ${res.found ? "" : "disabled"} aria-label="Show ${escapeHtml(res.algoName)} route">
          <span class="route-swatch" style="background: ${ALGO_COLORS[res.algoKey]}"></span>
          <button type="button" class="route-name" data-route-select="${res.algoKey}" ${res.found ? "" : "disabled"}>${ALGO_SHORT[res.algoKey]}</button>
          <span class="route-meta">${res.found ? `${res.totalCost} · ${res.totalDistance} km` : STATUS_TEXT[res.status]}</span>
          ${same}
        </div>`;
    }).join("");
  }

  function selectRoute(key) {
    const res = state.currentResults.find(r => r.algoKey === key);
    if (!res) return;
    state.selectedRouteKey = key;
    state.displayedResult = res;
    state.routeVisible[key] = true;
    showResultStats(res);
    drawRoutes();
    renderRoutesPanel();
    animateExplored(res);
  }

  function animateExplored(result) {
    state.tracePlayer.load(result, { animate: state.showExplored });
  }

  function triggerDynamicRecalculation({ fit = false } = {}) {
    clearTimeout(state.recalcTimer);
    applyScenarioToEnv();
    syncNodePickers();
    renderSnapInfo();
    renderScenarioInfo();
    renderOverrideCount();
    restyleEdges();
    updateBeacons();
    runSimulation();
    markCompareStale();
    if (fit) fitToRoute();
  }

  function scheduleRecalculation() {
    clearTimeout(state.recalcTimer);
    state.recalcTimer = setTimeout(() => triggerDynamicRecalculation(), SLIDER_DEBOUNCE_MS);
  }

  function fitToRoute() {
    const layers = state.routeLayers.get(state.selectedRouteKey);
    const ids = [state.startNodeId, state.targetNodeId].filter(Boolean);
    if (!ids.length) return;
    const bounds = layers ? layers[layers.length - 1].getBounds() : L.latLngBounds(ids.map(nodeLatLng));
    state.map.fitBounds(bounds, { padding: [80, 80], maxZoom: 16 });
  }

  function searchOptions() {
    return { limits: state.limits, includeZeroHeuristic: state.includeZeroHeuristic };
  }

  function runSimulation() {
    if (!state.startNodeId || !state.targetNodeId) {
      state.currentResults = [];
      state.displayedResult = null;
      clearRoutes();
      animateExplored(null);
      renderRoutesPanel();
      populateComparisonTable([]);
      showResultStats(null);
      return;
    }

    const args = [state.startNodeId, state.targetNodeId, state.graph, state.envState, searchOptions()];
    if (state.selectedAlgo === "all") {
      state.currentResults = window.GraphSearchSuite.runAllAlgorithms(...args);
      const found = state.currentResults.filter(r => r.found);
      const keep = found.find(r => r.algoKey === state.selectedRouteKey);
      const best = keep || (found.length ? found.reduce((a, b) =>
        (b.totalCost < a.totalCost || (b.totalCost === a.totalCost && b.algoKey === "astar")) ? b : a) : state.currentResults[0]);
      state.selectedRouteKey = best.algoKey;
      state.displayedResult = best;
    } else {
      state.displayedResult = window.GraphSearchSuite.runAlgorithm(state.selectedAlgo, ...args);
      state.currentResults = [state.displayedResult];
      state.selectedRouteKey = state.selectedAlgo;
    }

    showResultStats(state.displayedResult);
    drawRoutes();
    renderRoutesPanel();
    animateExplored(state.displayedResult);
    populateComparisonTable(state.currentResults);

    state.chartsDirty = true;
    if ($("tab-benchmark").classList.contains("active")) renderChartsIfDirty();
  }

  function renderChartsIfDirty() {
    if (!state.chartsDirty || !state.startNodeId || !state.targetNodeId) return;
    state.chartsDirty = false;
    window.ChartEngine.renderBenchmarkCharts(
      state.selectedAlgo === "all" ? state.currentResults : window.GraphSearchSuite.runAllAlgorithms(
        state.startNodeId, state.targetNodeId, state.graph, state.envState, searchOptions()
      )
    );
  }

  function showResultStats(result) {
    const gmapsBtn = $("btn-open-gmaps");
    const statusEl = $("stat-status");
    if (!result) {
      ["stat-cost", "stat-dist", "stat-time", "stat-nodes"].forEach(id => { $(id).textContent = "--"; });
      statusEl.textContent = "Choose a start and a destination.";
      gmapsBtn.style.display = "none";
      return;
    }
    $("stat-nodes").textContent = result.nodesExpanded.toLocaleString();
    statusEl.textContent = `${result.algoName} · ${STATUS_TEXT[result.status]} · ${result.routeNodes} route nodes · ${result.nodesGenerated.toLocaleString()} generated`;
    statusEl.className = `stat-status status-${result.status}`;

    if (!result.found) {
      $("stat-cost").textContent = result.status === "unreachable" ? "NO PATH" : "STOPPED";
      $("stat-dist").textContent = "--";
      $("stat-time").textContent = "--";
      gmapsBtn.onclick = null;
      gmapsBtn.style.display = "none";
      return;
    }

    $("stat-cost").textContent = result.totalCost;
    $("stat-dist").textContent = result.totalDistance + " km";
    $("stat-time").textContent = result.estimatedTimeMins + " mins";

    const inner = result.path.slice(1, -1);
    const stride = Math.max(1, Math.ceil(inner.length / GMAPS_MAX_WAYPOINTS));
    const waypoints = inner.filter((_, i) => i % stride === stride - 1)
      .slice(0, GMAPS_MAX_WAYPOINTS)
      .map(id => nodeLatLng(id).join(","))
      .join("|");
    const [oLat, oLng] = nodeLatLng(result.path[0]);
    const [dLat, dLng] = nodeLatLng(result.path[result.path.length - 1]);
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${oLat},${oLng}&destination=${dLat},${dLng}${waypoints ? '&waypoints=' + encodeURIComponent(waypoints) : ''}&travelmode=driving`;
    gmapsBtn.onclick = () => window.open(gmapsUrl, "_blank");
    gmapsBtn.style.display = "flex";
  }

  function populateComparisonTable(results) {
    const tbody = $("table-results-body");
    tbody.innerHTML = "";

    const foundResults = results.filter(r => r.found);
    const minCost = Math.min(...foundResults.map(r => r.totalCost));
    const minNodes = Math.min(...foundResults.map(r => r.nodesExpanded));

    results.forEach(res => {
      const tr = document.createElement("tr");
      const isBestCost = res.found && res.totalCost === minCost;
      const isBestNodes = res.found && res.nodesExpanded === minNodes;
      tr.innerHTML = `
        <td>
          <span class="badge-algo" style="border: 1px solid ${ALGO_COLORS[res.algoKey]};">${res.algoName}</span>
          ${isBestCost ? '<span class="badge-win">Cost Optimal</span>' : ''}
          ${isBestNodes ? '<span class="badge-win" style="color:#a3e635; border-color:#a3e635;">Efficient</span>' : ''}
        </td>
        <td><span class="status-pill status-${res.status}">${STATUS_TEXT[res.status]}</span></td>
        <td style="font-family: var(--font-mono); font-weight: bold; color: var(--accent-primary);">${res.found ? res.totalCost : "--"}</td>
        <td style="font-family: var(--font-mono);">${res.found ? res.totalDistance + " km" : "--"}</td>
        <td style="font-family: var(--font-mono);">${res.found ? res.estimatedTimeMins + " mins" : "--"}</td>
        <td style="font-family: var(--font-mono);">${res.routeNodes}</td>
        <td style="font-family: var(--font-mono);">${res.nodesExpanded.toLocaleString()}</td>
        <td style="font-family: var(--font-mono);">${res.nodesGenerated.toLocaleString()}</td>
        <td style="font-family: var(--font-mono);">${res.maxQueueSize.toLocaleString()}</td>
        <td style="font-family: var(--font-mono); color: var(--accent-amber);">${res.executionTimeMs} ms</td>
      `;
      tbody.appendChild(tr);
    });
  }

  const normalizeText = s => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const SEARCH_ALIASES = { ctg: "chattogram", chittagong: "chattogram", rd: "road", ave: "avenue", hosp: "hospital" };
  const keyHas = (key, word) => key.includes(word) || (SEARCH_ALIASES[word] !== undefined && key.includes(SEARCH_ALIASES[word]));
  let searchIndex = [];

  function buildSearchIndex() {
    const landmarks = Object.values(state.graph.nodes).filter(n => n.landmark);
    const nodeEntries = Object.values(state.graph.nodes).map(node => {
      let context = `Road node · ${node.description}`;
      if (!node.landmark) {
        let nearest = null, nearestD = Infinity;
        landmarks.forEach(lm => {
          const d = DynamicCostSystem.haversineDistance(node.lat, node.lng, lm.lat, lm.lng);
          if (d < nearestD) { nearest = lm; nearestD = d; }
        });
        if (nearest) context += ` · ${nearestD.toFixed(1)} km from ${nearest.name}`;
      }
      return { kind: "node", node, label: node.name, context, nameKey: normalizeText(node.name), altKey: "", contextKey: normalizeText(context) };
    });
    const placeEntries = state.places.map(place => {
      const context = [place.category, place.locality, place.bn].filter(Boolean).join(" · ");
      return {
        kind: "place", place, label: place.name, context: `Place · ${context}`,
        nameKey: normalizeText(place.name), altKey: normalizeText(`${place.bn} ${place.alt}`),
        contextKey: normalizeText(`${place.category} ${place.group} ${place.locality}`)
      };
    });
    searchIndex = placeEntries.concat(nodeEntries).sort((x, y) => x.label.localeCompare(y.label));
  }

  function searchEndpoints(query) {
    const q = normalizeText(query);
    if (!q) return { matches: searchIndex.slice(0, SEARCH_RESULT_LIMIT), total: searchIndex.length };
    const words = q.split(" ");
    const scored = [];
    searchIndex.forEach(entry => {
      const nameHas = w => keyHas(entry.nameKey, w) || keyHas(entry.altKey, w);
      const inName = words.every(nameHas);
      if (!inName && !words.every(w => nameHas(w) || keyHas(entry.contextKey, w))) return;
      let score = 3;
      if (inName) score = 2;
      if (inName && (" " + entry.nameKey).includes(" " + words[0])) score = 1;
      if (entry.nameKey.startsWith(q) || entry.altKey.startsWith(q)) score = 0;
      scored.push({ entry, score });
    });
    scored.sort((x, y) => x.score - y.score || x.entry.label.localeCompare(y.entry.label));
    return { matches: scored.slice(0, SEARCH_RESULT_LIMIT).map(x => x.entry), total: scored.length };
  }

  function createNodePicker(kind) {
    const input = $(`search-${kind}`);
    const list = $(`results-${kind}`);
    const snapEl = $(`snap-${kind}`);
    let matches = [];
    let active = -1;
    let debounce = null;
    let pending = false;

    const close = () => {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    };

    const highlight = index => {
      active = index;
      list.querySelectorAll("[data-index]").forEach(li => li.classList.toggle("active", +li.dataset.index === index));
      const li = list.querySelector(`[data-index="${index}"]`);
      if (li) {
        li.scrollIntoView({ block: "nearest" });
        input.setAttribute("aria-activedescendant", li.id);
      }
    };

    const render = () => {
      pending = false;
      clearTimeout(debounce);
      const result = searchEndpoints(input.value);
      matches = result.matches;
      const items = matches.map((e, i) => `
        <li role="option" id="${kind}-option-${i}" data-index="${i}" class="node-search-item">
          <span class="node-search-name">${escapeHtml(e.label)}</span>
          <span class="node-search-context">${escapeHtml(e.context)}</span>
        </li>`).join("");
      let footer = "";
      if (result.total === 0) {
        footer = `<li class="node-search-footer">No matching locations</li>`;
      } else if (result.total > matches.length) {
        footer = `<li class="node-search-footer">Showing ${matches.length} of ${result.total}. Keep typing to narrow down</li>`;
      }
      list.innerHTML = items + footer;
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      highlight(matches.length ? 0 : -1);
    };

    const choose = index => {
      const entry = matches[index];
      if (!entry) return;
      if (entry.kind === "place") {
        if (entry.place.snapM > state.snapLimitM) {
          snapEl.textContent = `${entry.place.name} is ${entry.place.snapM} m from the nearest road node, beyond the ${state.snapLimitM} m snapping limit.`;
          snapEl.classList.add("snap-error");
          return;
        }
        setEndpoint(kind, entry.place.node, entry.place.snapM, entry.place.name);
      } else {
        setEndpoint(kind, entry.node.id, 0, null);
      }
      snapEl.classList.remove("snap-error");
      input.blur();
      triggerDynamicRecalculation({ fit: true });
    };

    input.addEventListener("focus", () => {
      input.select();
      render();
    });
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      pending = true;
      debounce = setTimeout(render, SEARCH_DEBOUNCE_MS);
    });
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (list.hidden) { render(); return; }
        if (!matches.length) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        highlight((active + step + matches.length) % matches.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (pending) render();
        choose(active);
      } else if (e.key === "Escape") {
        input.blur();
      }
    });
    list.addEventListener("mousedown", e => {
      const li = e.target.closest("[data-index]");
      e.preventDefault();
      if (li) choose(+li.dataset.index);
    });
    input.addEventListener("blur", () => {
      clearTimeout(debounce);
      pending = false;
      close();
      syncNodePickers();
    });
  }

  function syncNodePickers() {
    [["search-start", state.startNodeId, "start"], ["search-target", state.targetNodeId, "target"]].forEach(([inputId, nodeId, kind]) => {
      const input = $(inputId);
      if (document.activeElement === input) return;
      const snap = state.snap[kind];
      input.value = nodeId ? (snap && snap.label ? snap.label : state.graph.nodes[nodeId].name) : "";
    });
  }

  function saveCustomScenario(scenario) {
    const clean = ScenarioSystem.validate({ ...scenario, revision: (scenario.revision || 0) + 1 });
    const i = state.customScenarios.findIndex(s => s.id === clean.id);
    if (i >= 0) state.customScenarios[i] = clean;
    else state.customScenarios.push(clean);
    PersistentStore.saveScenarios(state.customScenarios);
    renderScenarioSelect();
    renderCompareScenarioList();
    return clean;
  }

  function renderScenarioSelect() {
    const select = $("select-scenario");
    const builtIn = ScenarioSystem.builtIns().map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    const custom = state.customScenarios.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    select.innerHTML = `<optgroup label="Built-in">${builtIn}</optgroup>` + (custom ? `<optgroup label="Custom">${custom}</optgroup>` : "");
    select.value = findScenario(state.activeScenarioId).id;
  }

  function renderScenarioInfo() {
    const s = findScenario(state.activeScenarioId);
    $("scenario-desc").textContent = s.description || "";
    $("scenario-badge").textContent = s.builtIn ? "Built-in" : "Custom";
    const usingScenarioWeights = !!s.weights;
    const customWeights = Object.values(state.baseWeights).some(w => w !== 1);
    $("weights-badge").textContent = usingScenarioWeights ? "(scenario weights active)" : customWeights ? "(custom)" : "";
  }

  let studioSelectedId = null;

  function openStudio() {
    studioSelectedId = studioSelectedId || state.activeScenarioId;
    renderStudio();
    $("studio-dialog").showModal();
  }

  function renderStudio() {
    const scenarios = allScenarios();
    const current = scenarios.find(s => s.id === studioSelectedId) || scenarios[0];
    studioSelectedId = current.id;
    $("studio-list").innerHTML = scenarios.map(s => `
      <button type="button" class="studio-item${s.id === current.id ? " selected" : ""}" data-studio-id="${s.id}">
        <span>${escapeHtml(s.name)}</span>
        <span class="studio-item-meta">${s.builtIn ? "built-in" : "custom"}${s.id === state.activeScenarioId ? " · active" : ""}</span>
      </button>`).join("");

    const readOnly = !!current.builtIn;
    $("studio-readonly").hidden = !readOnly;
    $("btn-studio-delete").disabled = readOnly;
    $("btn-studio-save").disabled = readOnly;
    $("studio-name").value = current.name;
    $("studio-desc").value = current.description || "";
    $("studio-use-weights").checked = !!current.weights;
    const w = current.weights || state.baseWeights;
    $("studio-weights").innerHTML = ["traffic", "condition", "rain", "safety"].map(k => `
      <label for="studio-w-${k}">${k[0].toUpperCase() + k.slice(1)} weight</label>
      <input type="number" id="studio-w-${k}" data-weight="${k}" class="select-input" min="0" max="10" step="0.5" value="${w[k]}">`).join("");
    $("studio-weights").hidden = !current.weights;

    $("studio-classes").innerHTML = ScenarioSystem.ROAD_CLASSES.map(cls => {
      const c = current.classConditions[cls] || {};
      return `
        <tr data-class="${cls}">
          <td>${OSM_CLASS_LABELS[cls]}</td>
          <td><select data-cond="traffic" class="select-input">${selectOptions(LEVEL_OPTIONS.traffic, c.traffic)}</select></td>
          <td><select data-cond="rain" class="select-input">${selectOptions(LEVEL_OPTIONS.rain, c.rain)}</select></td>
          <td><select data-cond="condition" class="select-input">${selectOptions(LEVEL_OPTIONS.condition, c.condition)}</select></td>
          <td><input data-cond="safety" type="number" class="select-input" min="0" max="1" step="0.05" placeholder="baseline" value="${c.safety ?? ""}"></td>
          <td><select data-cond="closed" class="select-input">${selectOptions(LEVEL_OPTIONS.closed, c.closed || "none")}</select></td>
        </tr>`;
    }).join("");

    const edgeEntries = Object.entries(current.edgeConditions);
    $("studio-edges").innerHTML = edgeEntries.length ? edgeEntries.map(([id, c]) => {
      const e = edgeById.get(id);
      const summary = Object.entries(c).map(([k, v]) => `${k}: ${v}`).join(", ");
      return `<div class="studio-edge-row"><span><strong>${escapeHtml(e ? e.name : id)}</strong> <span class="popup-muted">${id}</span><br/><span class="popup-muted">${escapeHtml(summary)}</span></span>
        ${readOnly ? "" : `<button type="button" class="btn-secondary popup-btn" data-remove-edge="${id}">Remove</button>`}</div>`;
    }).join("") : `<p class="popup-muted">No road-specific conditions.</p>`;

    $("studio-form").querySelectorAll("input, select, textarea").forEach(el => { el.disabled = readOnly; });
    $("studio-error").hidden = true;
  }

  function readStudioForm() {
    const current = allScenarios().find(s => s.id === studioSelectedId);
    const classConditions = {};
    $("studio-classes").querySelectorAll("tr[data-class]").forEach(tr => {
      const raw = {};
      tr.querySelectorAll("[data-cond]").forEach(el => { raw[el.getAttribute("data-cond")] = el.value; });
      classConditions[tr.getAttribute("data-class")] = raw;
    });
    let weights = null;
    if ($("studio-use-weights").checked) {
      weights = {};
      $("studio-weights").querySelectorAll("[data-weight]").forEach(el => { weights[el.getAttribute("data-weight")] = el.value; });
    }
    return {
      ...current,
      name: $("studio-name").value,
      description: $("studio-desc").value,
      classConditions,
      edgeConditions: current.edgeConditions,
      weights
    };
  }

  function bindStudio() {
    $("btn-open-studio").addEventListener("click", openStudio);
    $("btn-close-studio").addEventListener("click", () => $("studio-dialog").close());
    $("studio-list").addEventListener("click", e => {
      const item = e.target.closest("[data-studio-id]");
      if (!item) return;
      studioSelectedId = item.getAttribute("data-studio-id");
      renderStudio();
    });
    $("studio-use-weights").addEventListener("change", e => { $("studio-weights").hidden = !e.target.checked; });
    $("btn-studio-new").addEventListener("click", () => {
      const created = saveCustomScenario({ id: ScenarioSystem.newId(), name: "New scenario", description: "", classConditions: {}, edgeConditions: {}, weights: null });
      studioSelectedId = created.id;
      renderStudio();
    });
    $("btn-studio-duplicate").addEventListener("click", () => {
      const current = allScenarios().find(s => s.id === studioSelectedId);
      const copy = saveCustomScenario(ScenarioSystem.duplicate(current));
      studioSelectedId = copy.id;
      renderStudio();
    });
    $("btn-studio-delete").addEventListener("click", () => {
      const current = state.customScenarios.find(s => s.id === studioSelectedId);
      if (!current || !window.confirm(`Delete the scenario "${current.name}"?`)) return;
      state.customScenarios = state.customScenarios.filter(s => s.id !== current.id);
      PersistentStore.saveScenarios(state.customScenarios);
      if (state.activeScenarioId === current.id) state.activeScenarioId = "normal";
      studioSelectedId = "normal";
      renderScenarioSelect();
      renderCompareScenarioList();
      renderStudio();
      saveSettings();
      triggerDynamicRecalculation();
    });
    $("studio-edges").addEventListener("click", e => {
      const btn = e.target.closest("[data-remove-edge]");
      if (!btn) return;
      const scenario = state.customScenarios.find(s => s.id === studioSelectedId);
      delete scenario.edgeConditions[btn.getAttribute("data-remove-edge")];
      saveCustomScenario(scenario);
      renderStudio();
      triggerDynamicRecalculation();
    });
    $("studio-form").addEventListener("submit", e => {
      e.preventDefault();
      try {
        saveCustomScenario(readStudioForm());
        renderStudio();
        triggerDynamicRecalculation();
      } catch (err) {
        $("studio-error").hidden = false;
        $("studio-error").textContent = err.message;
      }
    });
    $("btn-studio-activate").addEventListener("click", () => {
      state.activeScenarioId = studioSelectedId;
      $("select-scenario").value = studioSelectedId;
      saveSettings();
      renderStudio();
      triggerDynamicRecalculation();
    });
  }

  function compareInputsKey() {
    const e = state.envState;
    return JSON.stringify([state.startNodeId, state.targetNodeId, $("compare-algo").value, e.trafficLevel, e.floodLevel,
      e.timeOfDay, e.season, e.respectOneWay, state.baseWeights, e.overrides, [...e.blockedEdges], state.limits, state.customScenarios]);
  }

  function renderCompareScenarioList() {
    const checked = new Set([...document.querySelectorAll("[data-compare-id]:checked")].map(el => el.getAttribute("data-compare-id")));
    if (!checked.size) ["normal", "heavy_traffic", "heavy_rain", "combined_emergency"].forEach(id => checked.add(id));
    $("compare-scenario-list").innerHTML = allScenarios().map(s => `
      <label class="toggle-row"><input type="checkbox" data-compare-id="${s.id}" ${checked.has(s.id) ? "checked" : ""}> <span>${escapeHtml(s.name)}</span></label>`).join("");
    enforceCompareLimit();
  }

  function enforceCompareLimit() {
    const boxes = [...document.querySelectorAll("[data-compare-id]")];
    const count = boxes.filter(b => b.checked).length;
    boxes.forEach(b => { b.disabled = !b.checked && count >= ScenarioSystem.MAX_COMPARE; });
  }

  function runScenarioComparison() {
    const error = $("compare-error");
    error.hidden = true;
    const ids = [...document.querySelectorAll("[data-compare-id]:checked")].map(el => el.getAttribute("data-compare-id"));
    if (!ids.length) { error.hidden = false; error.textContent = "Choose at least one scenario."; return; }
    if (!state.startNodeId || !state.targetNodeId) { error.hidden = false; error.textContent = "Choose a start and a destination first."; return; }
    const algo = $("compare-algo").value;
    const rows = ids.map(id => {
      const scenario = findScenario(id);
      const env = { ...state.envState, scenario: scenario.id === "normal" ? null : scenario, weights: scenario.weights || state.baseWeights };
      return { scenario, result: GraphSearchSuite.runAlgorithm(algo, state.startNodeId, state.targetNodeId, state.graph, env, searchOptions()) };
    });
    state.compare = { key: compareInputsKey(), rows };
    $("compare-body").innerHTML = rows.map(({ scenario, result: r }) => `
      <tr>
        <td>${escapeHtml(scenario.name)}</td>
        <td><span class="status-pill status-${r.status}">${STATUS_TEXT[r.status]}</span></td>
        <td style="font-family: var(--font-mono); color: var(--accent-primary);">${r.found ? r.totalCost : "--"}</td>
        <td style="font-family: var(--font-mono);">${r.found ? r.totalDistance : "--"}</td>
        <td style="font-family: var(--font-mono);">${r.found ? r.estimatedTimeMins : "--"}</td>
        <td style="font-family: var(--font-mono);">${r.routeNodes}</td>
        <td style="font-family: var(--font-mono);">${r.nodesExpanded.toLocaleString()}</td>
        <td style="font-family: var(--font-mono);">${r.executionTimeMs} ms</td>
      </tr>`).join("");
    markCompareStale();
  }

  function markCompareStale() {
    const stale = !!state.compare && state.compare.key !== compareInputsKey();
    $("compare-stale").hidden = !stale;
    $("compare-body").classList.toggle("stale", stale);
  }

  function renderWeightControls() {
    $("weights-controls").innerHTML = ["traffic", "condition", "rain", "safety"].map(k => `
      <div class="control-group">
        <div class="control-label"><span>${{ traffic: "Traffic", condition: "Road condition", rain: "Rain / waterlogging", safety: "Safety" }[k]}</span>
          <span class="value-badge" id="val-w-${k}">${state.baseWeights[k]}</span></div>
        <input type="range" class="range-input" data-weight-slider="${k}" min="0" max="10" step="0.5" value="${state.baseWeights[k]}">
      </div>`).join("");
  }

  function renderLimitControls() {
    $("limit-expansions").value = state.limits.maxExpansions;
    $("limit-timeout").value = state.limits.timeoutMs;
    $("limit-depth").value = state.limits.maxDepth;
    $("limit-snap").value = state.snapLimitM;
    $("toggle-astar0").checked = state.includeZeroHeuristic;
  }

  function readLimitControls() {
    const error = $("limits-error");
    try {
      state.limits = GraphSearchSuite.normalizeLimits({
        maxExpansions: $("limit-expansions").value,
        timeoutMs: $("limit-timeout").value,
        maxDepth: $("limit-depth").value
      });
      const snap = Number($("limit-snap").value);
      if (!Number.isFinite(snap) || snap < 10 || snap > MAX_SNAP_LIMIT_M) throw new Error(`Snapping limit must be between 10 and ${MAX_SNAP_LIMIT_M} m`);
      state.snapLimitM = Math.round(snap);
      error.hidden = true;
      saveSettings();
      triggerDynamicRecalculation();
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
    }
  }

  function renderFilters() {
    const counts = {};
    graph.edges.forEach(e => { counts[e.highway] = (counts[e.highway] || 0) + 1; });
    $("road-filters").innerHTML = Object.keys(OSM_CLASS_RANK).filter(c => counts[c]).map(c => `
      <label class="toggle-row"><input type="checkbox" data-road-class="${c}" ${state.roadClasses.has(c) ? "checked" : ""}>
        <span>${OSM_CLASS_LABELS[c]} <span class="popup-muted">(${counts[c].toLocaleString()})</span></span></label>`).join("");

    if (!placesData) {
      $("toggle-places").disabled = true;
      $("place-filters").innerHTML = `<p class="control-hint">Place dataset not loaded (js/chattogram_places.js). Road search still works.</p>`;
      return;
    }
    const groupCounts = {};
    state.places.forEach(p => { groupCounts[p.group] = (groupCounts[p.group] || 0) + 1; });
    $("place-filters").innerHTML = placesData.groups.map(g => `
      <label class="toggle-row"><input type="checkbox" data-place-group="${escapeHtml(g)}" ${state.placeGroups.has(g) ? "checked" : ""}>
        <span><span class="route-swatch" style="background: ${PLACE_GROUP_COLORS[g] || PLACE_GROUP_COLORS.Other}"></span>${escapeHtml(g)} <span class="popup-muted">(${groupCounts[g] || 0})</span></span></label>`).join("");
    if (placesData.meta && placesData.meta.placesComplete === false) {
      $("place-filters").insertAdjacentHTML("afterbegin",
        `<p class="form-error">Place coverage is partial: ${placesData.meta.missingPlaceTiles.length} of ${placesData.meta.totalPlaceTiles} download tiles are missing.</p>`);
    }
  }

  function renderOverrideCount() {
    const n = Object.keys(state.envState.overrides).length;
    $("btn-reset-overrides").textContent = `♻️ Reset All Road Overrides${n ? ` (${n})` : ""}`;
    $("btn-reset-overrides").disabled = n === 0;
  }

  function bindEvents() {
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");

        const tabId = btn.getAttribute("data-tab");
        const pane = $(tabId);
        if (pane) pane.classList.add("active");

        if (tabId === "tab-map" && state.map) {
          setTimeout(() => state.map.invalidateSize(), 200);
        }
        if (tabId === "tab-benchmark") renderChartsIfDirty();
      });
    });

    buildSearchIndex();
    createNodePicker("start");
    createNodePicker("target");
    document.querySelectorAll("[data-clear]").forEach(btn => {
      btn.addEventListener("click", () => {
        const kind = btn.getAttribute("data-clear");
        setEndpoint(kind, null);
        $(`search-${kind}`).value = "";
        triggerDynamicRecalculation();
        $(`search-${kind}`).focus();
      });
    });

    $("btn-swap-nodes").addEventListener("click", () => {
      [state.startNodeId, state.targetNodeId] = [state.targetNodeId, state.startNodeId];
      [state.snap.start, state.snap.target] = [state.snap.target, state.snap.start];
      triggerDynamicRecalculation({ fit: true });
    });

    $("select-algo").addEventListener("change", (e) => {
      state.selectedAlgo = e.target.value;
      state.routeVisible = {};
      triggerDynamicRecalculation();
    });

    $("toggle-oneway").checked = state.envState.respectOneWay;
    $("toggle-oneway").addEventListener("change", e => {
      state.envState.respectOneWay = e.target.checked;
      saveSettings();
      triggerDynamicRecalculation();
    });

    $("select-scenario").addEventListener("change", e => {
      state.activeScenarioId = e.target.value;
      saveSettings();
      triggerDynamicRecalculation();
    });

    $("slider-traffic").addEventListener("input", (e) => {
      state.envState.trafficLevel = parseFloat(e.target.value);
      $("val-traffic").textContent = state.envState.trafficLevel + "x";
      scheduleRecalculation();
    });

    $("slider-flood").addEventListener("input", (e) => {
      state.envState.floodLevel = parseFloat(e.target.value);
      $("val-flood").textContent = state.envState.floodLevel + "m";
      scheduleRecalculation();
    });

    document.querySelectorAll("[data-time]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-time]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.envState.timeOfDay = btn.getAttribute("data-time");
        triggerDynamicRecalculation();
      });
    });

    $("select-season").addEventListener("change", (e) => {
      state.envState.season = e.target.value;
      triggerDynamicRecalculation();
    });

    $("weights-controls").addEventListener("input", e => {
      const k = e.target.getAttribute("data-weight-slider");
      if (!k) return;
      state.baseWeights[k] = parseFloat(e.target.value);
      $(`val-w-${k}`).textContent = state.baseWeights[k];
      saveSettings();
      scheduleRecalculation();
    });
    $("btn-reset-weights").addEventListener("click", () => {
      state.baseWeights = { ...DynamicCostSystem.DEFAULT_WEIGHTS };
      renderWeightControls();
      saveSettings();
      triggerDynamicRecalculation();
    });

    ["limit-expansions", "limit-timeout", "limit-depth", "limit-snap"].forEach(id => $(id).addEventListener("change", readLimitControls));
    $("toggle-astar0").addEventListener("change", e => {
      state.includeZeroHeuristic = e.target.checked;
      saveSettings();
      triggerDynamicRecalculation();
    });

    $("toggle-explored").addEventListener("change", (e) => {
      state.showExplored = e.target.checked;
      state.tracePlayer.setVisible(state.showExplored);
    });

    const setTraceOpen = open => {
      $("trace-panel").hidden = !open;
      $("btn-show-trace").hidden = open;
      PersistentStore.write("traceOpen", open);
      setTimeout(() => state.map.invalidateSize(), 50);
    };
    $("btn-hide-trace").addEventListener("click", () => setTraceOpen(false));
    $("btn-show-trace").addEventListener("click", () => setTraceOpen(true));
    if (PersistentStore.read("traceOpen", true) === false) setTraceOpen(false);

    $("toggle-places").checked = state.showPlaces;
    $("toggle-places").addEventListener("change", e => {
      state.showPlaces = e.target.checked;
      saveSettings();
      refreshViewportLayers();
    });
    $("place-filters").addEventListener("change", e => {
      const g = e.target.getAttribute("data-place-group");
      if (!g) return;
      if (e.target.checked) state.placeGroups.add(g); else state.placeGroups.delete(g);
      saveSettings();
      refreshViewportLayers();
    });
    $("road-filters").addEventListener("change", e => {
      const c = e.target.getAttribute("data-road-class");
      if (!c) return;
      if (e.target.checked) state.roadClasses.add(c); else state.roadClasses.delete(c);
      saveSettings();
      refreshViewportLayers();
    });

    $("routes-list").addEventListener("click", e => {
      const sel = e.target.closest("[data-route-select]");
      if (sel) selectRoute(sel.getAttribute("data-route-select"));
    });
    $("routes-list").addEventListener("change", e => {
      const key = e.target.getAttribute("data-route-toggle");
      if (!key) return;
      state.routeVisible[key] = e.target.checked;
      drawRoutes();
    });

    $("btn-clear-blocks").addEventListener("click", () => {
      state.envState.blockedEdges.clear();
      triggerDynamicRecalculation();
    });

    $("btn-reset-overrides").addEventListener("click", () => {
      const n = Object.keys(state.envState.overrides).length;
      if (!n || !window.confirm(`Remove all ${n} saved road overrides?`)) return;
      state.envState.overrides = {};
      PersistentStore.saveOverrides(state.envState.overrides);
      triggerDynamicRecalculation();
    });

    $("btn-run-sim").addEventListener("click", () => {
      triggerDynamicRecalculation();
    });

    document.querySelectorAll("[data-preset]").forEach(btn => {
      btn.addEventListener("click", () => {
        const presetKey = btn.getAttribute("data-preset");
        applyPresetScenario(presetKey);
      });
    });

    $("btn-export-csv").addEventListener("click", () => {
      exportResultsToCSV();
    });

    $("compare-algo").innerHTML = GraphSearchSuite.ALGORITHMS.map(a => `<option value="${a.key}"${a.key === "astar" ? " selected" : ""}>${a.name}</option>`).join("");
    $("compare-scenario-list").addEventListener("change", enforceCompareLimit);
    $("compare-algo").addEventListener("change", markCompareStale);
    $("btn-compare-scenarios").addEventListener("click", runScenarioComparison);

    bindStudio();

    const meta = state.graph.meta || {};
    $("network-info").textContent =
      `${(meta.nodeCount || Object.keys(state.graph.nodes).length).toLocaleString()} nodes · ${(meta.edgeCount || state.graph.edges.length).toLocaleString()} roads`;
  }

  function blockadeOnRoute(roadCount) {
    const route = window.GraphSearchSuite.runAStar(state.startNodeId, state.targetNodeId, state.graph, state.envState, searchOptions());
    return route.pathEdges.slice(0, roadCount);
  }

  function applyPresetScenario(key) {
    state.envState.blockedEdges.clear();
    applyScenarioToEnv();

    switch (key) {
      case "monsoon-flood":
        setEndpoint("start", "halishahar_block_l");
        setEndpoint("target", "cmch");
        state.envState.trafficLevel = 1.8;
        state.envState.floodLevel = 2.2;
        state.envState.timeOfDay = "day";
        state.envState.season = "monsoon";
        break;

      case "port-fire":
        setEndpoint("start", "epz_circle");
        setEndpoint("target", "imperial_hosp");
        state.envState.trafficLevel = 3.2;
        state.envState.floodLevel = 0.0;
        state.envState.timeOfDay = "day";
        state.envState.season = "dry";
        break;

      case "midnight-cardiac":
        setEndpoint("start", "chattogram_airport");
        setEndpoint("target", "evercare_hosp");
        state.envState.trafficLevel = 1.0;
        state.envState.floodLevel = 0.4;
        state.envState.timeOfDay = "night";
        state.envState.season = "winter";
        break;

      case "old-ctg-block":
        setEndpoint("start", "khatunganj");
        setEndpoint("target", "cmch");
        state.envState.trafficLevel = 2.5;
        state.envState.floodLevel = 1.2;
        state.envState.timeOfDay = "night";
        state.envState.season = "monsoon";
        blockadeOnRoute(2).forEach(id => state.envState.blockedEdges.add(id));
        break;

      case "bypass-route":
        setEndpoint("start", "oxygen_depot");
        setEndpoint("target", "bitid_faujdarhat");
        state.envState.trafficLevel = 2.0;
        state.envState.floodLevel = 0.5;
        state.envState.timeOfDay = "day";
        state.envState.season = "dry";
        break;
    }

    $("slider-traffic").value = state.envState.trafficLevel;
    $("val-traffic").textContent = state.envState.trafficLevel + "x";
    $("slider-flood").value = state.envState.floodLevel;
    $("val-flood").textContent = state.envState.floodLevel + "m";
    $("select-season").value = state.envState.season;

    document.querySelectorAll("[data-time]").forEach(b => {
      if (b.getAttribute("data-time") === state.envState.timeOfDay) b.classList.add("active");
      else b.classList.remove("active");
    });

    triggerDynamicRecalculation({ fit: true });
  }

  function exportResultsToCSV() {
    if (state.currentResults.length === 0) return;

    let csv = "Algorithm,Status,Dynamic Cost,Distance (km),Estimated Time (mins),Route Nodes,Nodes Expanded,Nodes Generated,Max Queue Size,Execution Time (ms),Path Safety\n";
    state.currentResults.forEach(r => {
      csv += `"${r.algoName}",${r.status},${r.totalCost},${r.totalDistance},${r.estimatedTimeMins},${r.routeNodes},${r.nodesExpanded},${r.nodesGenerated},${r.maxQueueSize},${r.executionTimeMs},${r.pathSafety}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chattogram_benchmark_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  window.CTG_APP = {
    state,
    get trace() { return state.tracePlayer; },
    recalculate: triggerDynamicRecalculation,
    openRoadPopup(edgeId) {
      const edge = edgeById.get(edgeId);
      const mid = edge.geom[edge.geom.length >> 1];
      state.map.setView(mid, 17, { animate: false });
      L.popup({ maxWidth: 360, className: "road-popup" }).setLatLng(mid).setContent(edgePopupHtml(edge)).openOn(state.map);
    }
  };

  initMap();
  renderWeightControls();
  renderLimitControls();
  renderFilters();
  renderScenarioSelect();
  renderCompareScenarioList();
  bindEvents();
  triggerDynamicRecalculation({ fit: true });
  refreshViewportLayers();
});

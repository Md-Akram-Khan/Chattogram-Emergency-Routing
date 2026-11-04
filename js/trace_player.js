/* ==========================================================================
   EXPLORATION TRACE PLAYER
   Lists every node a search expanded, in order, beside the map, and replays
   the search step by step: the map shows the nodes expanded up to the
   current step, the current node, and its path back to the start along the
   real roads. Click a row or an explored dot to jump to that step.
   ========================================================================== */

class TracePlayer {
  static ROW_HEIGHT = 30;
  static COLOR = "#e11d9b"; // magenta: distinct from the green / amber / red road colours
  static AUTO_ANIMATION_MS = 1200;

  /**
   * @param opts.map       Leaflet map
   * @param opts.renderer     Leaflet canvas renderer shared with the roads (explored dots, clickable)
   * @param opts.topRenderer  canvas renderer in a pane above the routes (current step and its path)
   * @param opts.graph     road graph ({ nodes, edges })
   * @param opts.el        DOM elements: panel, summary, detail, list, spacer, play, speed, jump, follow
   */
  constructor({ map, renderer, topRenderer, graph, el }) {
    this.map = map;
    this.renderer = renderer;
    this.topRenderer = topRenderer || renderer;
    this.graph = graph;
    this.el = el;
    this.layer = L.layerGroup().addTo(map);
    this.overlay = L.layerGroup().addTo(map); // current node + its path, above the dots
    this.result = null;
    this.markers = [];
    this.shown = -1;     // index of the last expanded node drawn on the map
    this.current = -1;   // selected step
    this.playing = false;
    this.frame = null;
    this.visible = true;

    // Edge between two nodes in either direction, for drawing paths on real road geometry
    this.edgeByPair = new Map();
    graph.edges.forEach(e => {
      this.edgeByPair.set(e.u + "|" + e.v, e);
      this.edgeByPair.set(e.v + "|" + e.u, e);
    });

    this.bindEvents();
  }

  // ---------------------------------------------------------------------
  // Loading a result
  // ---------------------------------------------------------------------
  load(result, { animate = true } = {}) {
    this.pause();
    this.layer.clearLayers();
    this.overlay.clearLayers();
    this.markers = [];
    this.shown = -1;
    this.current = -1;
    this.result = result && result.visitedNodesOrder.length ? result : null;
    this.parentOf = new Map();
    this.stepOf = new Map();
    if (this.result) {
      this.result.visitedNodesOrder.forEach((id, i) => {
        if (!this.stepOf.has(id)) this.stepOf.set(id, i);
        const info = this.result.expansionInfo && this.result.expansionInfo[i];
        if (info && !this.parentOf.has(id)) this.parentOf.set(id, info.parent);
      });
    }
    this.el.spacer.style.height = `${this.count() * TracePlayer.ROW_HEIGHT}px`;
    this.el.list.scrollTop = 0;
    this.el.jump.max = Math.max(1, this.count());
    this.renderSummary();

    if (!this.result) {
      this.renderDetail();
      this.renderRows();
      return;
    }
    if (animate) {
      // Quick overview of the whole search; the user can then step through it
      this.play(Math.max(60, this.count() / (TracePlayer.AUTO_ANIMATION_MS / 1000)), { auto: true });
    } else {
      this.goTo(this.count() - 1, { pan: false, scroll: false, highlight: false });
    }
  }

  count() {
    return this.result ? this.result.visitedNodesOrder.length : 0;
  }

  // ---------------------------------------------------------------------
  // Moving between steps
  // ---------------------------------------------------------------------
  // highlight = false selects the step without drawing its marker and path
  goTo(index, { pan = this.el.follow.checked, scroll = true, highlight = true } = {}) {
    if (!this.result) return;
    const i = Math.max(0, Math.min(this.count() - 1, index));
    this.drawUpTo(i);
    this.current = i;
    if (highlight) this.drawCurrent(pan);
    else this.overlay.clearLayers();
    this.renderDetail();
    if (scroll) this.scrollToRow(i);
    this.renderRows();
  }

  // Adds or removes explored dots so exactly steps 0..i are on the map
  drawUpTo(i) {
    const order = this.result.visitedNodesOrder;
    for (let k = this.shown + 1; k <= i; k++) {
      if (!this.markers[k]) {
        const node = this.graph.nodes[order[k]];
        const marker = L.circleMarker([node.lat, node.lng], {
          renderer: this.renderer,
          radius: 4,
          color: "#0f172a",
          weight: 1.5,
          fillColor: "#f8fafc",
          fillOpacity: 0.9,
          bubblingMouseEvents: false
        });
        marker.on("click", () => { this.pause(); this.goTo(k, { pan: false }); });
        this.markers[k] = marker;
      }
      if (this.visible) this.markers[k].addTo(this.layer);
    }
    for (let k = this.shown; k > i; k--) this.markers[k].remove();
    this.shown = i;
  }

  // Path from the start to a node through the parents recorded by the search
  pathTo(nodeId) {
    const path = [nodeId];
    const seen = new Set(path);
    let p = this.parentOf.get(nodeId);
    while (p && !seen.has(p)) {
      path.unshift(p);
      seen.add(p);
      p = this.parentOf.get(p);
    }
    return path;
  }

  drawCurrent(pan) {
    this.overlay.clearLayers();
    const id = this.result.visitedNodesOrder[this.current];
    const node = this.graph.nodes[id];

    // The goal's path is the found route, already drawn in yellow: show only the marker
    const isGoal = this.result.found && id === this.result.path[this.result.path.length - 1];
    const path = isGoal ? [id] : this.pathTo(id);
    const latLngs = [];
    for (let k = 0; k < path.length - 1; k++) {
      const e = this.edgeByPair.get(path[k] + "|" + path[k + 1]);
      if (!e) continue;
      const g = e.u === path[k] ? e.geom : e.geom.slice().reverse();
      latLngs.push(...(latLngs.length ? g.slice(1) : g));
    }
    if (latLngs.length > 1) {
      L.polyline(latLngs, { renderer: this.topRenderer, color: "#ffffff", weight: 8, opacity: 0.9, interactive: false }).addTo(this.overlay);
      L.polyline(latLngs, { renderer: this.topRenderer, color: TracePlayer.COLOR, weight: 4.5, opacity: 1, interactive: false }).addTo(this.overlay);
    }
    L.circleMarker([node.lat, node.lng], {
      renderer: this.topRenderer, radius: 9, color: "#ffffff", weight: 3, fillColor: TracePlayer.COLOR, fillOpacity: 1, interactive: false
    }).addTo(this.overlay);

    if (pan && !this.map.getBounds().pad(-0.15).contains([node.lat, node.lng])) {
      this.map.panTo([node.lat, node.lng], { animate: this.rate() <= 20 });
    }
  }

  first() { this.pause(); this.goTo(0); }
  last() { this.pause(); this.goTo(this.count() - 1); }
  next() { this.pause(); this.goTo(this.current + 1); }
  prev() { this.pause(); this.goTo(this.current - 1); }

  rate() {
    return Number(this.el.speed.value);
  }

  // ---------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------
  play(stepsPerSecond = this.rate(), { auto = false } = {}) {
    if (!this.result) return;
    this.pause();
    if (this.current >= this.count() - 1 && !auto) this.goTo(0, { pan: false });
    this.playing = true;
    this.auto = auto;
    this.el.play.textContent = "⏸";
    let last = performance.now();
    let carry = 0;
    const tick = now => {
      carry += (now - last) * stepsPerSecond / 1000;
      last = now;
      const steps = Math.floor(carry);
      if (steps > 0) {
        carry -= steps;
        const target = Math.min(this.count() - 1, this.current + steps);
        if (auto) {
          // Overview animation: draw dots only, update the panel when it ends
          this.drawUpTo(target);
          this.current = target;
        } else {
          this.goTo(target, { pan: this.el.follow.checked && stepsPerSecond <= 20, scroll: true });
        }
        if (target >= this.count() - 1) {
          this.pause();
          if (auto) this.goTo(target, { pan: false, scroll: false, highlight: false });
          return;
        }
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  pause() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.playing = false;
    this.auto = false;
    if (this.el.play) this.el.play.textContent = "▶";
  }

  toggle() {
    if (this.playing && !this.auto) this.pause();
    else this.play();
  }

  // Draws the explored dots above anything added to the shared canvas since
  raiseDots() {
    if (!this.visible) return;
    for (let k = 0; k <= this.shown; k++) this.markers[k].bringToFront();
  }

  // Explored dots on/off (the current step stays visible)
  setVisible(show) {
    this.visible = show;
    if (show) {
      for (let k = 0; k <= this.shown; k++) this.markers[k].addTo(this.layer);
    } else {
      this.layer.clearLayers();
    }
  }

  // ---------------------------------------------------------------------
  // Panel rendering (virtualised list: only rows in view exist in the DOM)
  // ---------------------------------------------------------------------
  valueText(info) {
    if (!info) return "";
    if (info.f !== undefined) return `g ${info.g.toFixed(1)} · h ${info.h.toFixed(1)}`;
    if (info.h !== undefined) return `h ${info.h.toFixed(1)}`;
    if (info.depth !== undefined) return `depth ${info.depth}`;
    return "";
  }

  renderRows() {
    const list = this.el.list;
    const H = TracePlayer.ROW_HEIGHT;
    const n = this.count();
    if (!n) {
      this.el.spacer.innerHTML = `<div class="trace-empty">No expanded nodes yet.</div>`;
      return;
    }
    const start = Math.max(0, Math.floor(list.scrollTop / H) - 8);
    const end = Math.min(n, start + Math.ceil(list.clientHeight / H) + 16);
    const order = this.result.visitedNodesOrder;
    const target = this.result.path.length ? this.result.path[this.result.path.length - 1] : null;
    const onRoute = new Set(this.result.path);
    let html = "";
    for (let k = start; k < end; k++) {
      const id = order[k];
      const node = this.graph.nodes[id];
      const cls = ["trace-row"];
      if (k === this.current) cls.push("current");
      else if (k > this.current) cls.push("pending");
      if (onRoute.has(id)) cls.push("on-route");
      const mark = k === 0 ? "🏁 " : id === target ? "🎯 " : "";
      html += `<div class="${cls.join(" ")}" style="top:${k * H}px" data-step="${k}" role="option" aria-selected="${k === this.current}">
        <span class="trace-num">${k + 1}</span>
        <span class="trace-name" title="${TracePlayer.escape(node.name)}">${mark}${TracePlayer.escape(node.name)}</span>
        <span class="trace-val">${this.valueText(this.result.expansionInfo[k])}</span>
      </div>`;
    }
    this.el.spacer.innerHTML = html;
  }

  // Keeps the row in view: small moves scroll by one row, jumps centre the row
  scrollToRow(i) {
    const H = TracePlayer.ROW_HEIGHT, list = this.el.list;
    const top = i * H;
    if (top >= list.scrollTop && top + H <= list.scrollTop + list.clientHeight) return;
    const near = top >= list.scrollTop - H && top <= list.scrollTop + list.clientHeight;
    if (near) list.scrollTop = top < list.scrollTop ? top : top + H - list.clientHeight;
    else list.scrollTop = Math.max(0, top - (list.clientHeight - H) / 2);
  }

  renderSummary() {
    const r = this.result;
    if (!r) {
      this.el.summary.textContent = "Run a search to see the nodes it expands.";
      return;
    }
    const n = this.count().toLocaleString();
    this.el.summary.textContent = r.algoKey === "ids"
      ? `${r.algoName}: ${n} distinct nodes in first-visit order (${r.nodesExpanded.toLocaleString()} expansions over all depth limits)`
      : `${r.algoName}: ${n} nodes expanded, in order`;
  }

  renderDetail() {
    const r = this.result;
    if (!r || this.current < 0) {
      this.el.detail.innerHTML = r ? "" : `<span class="trace-muted">Select a start and a destination; the search's expanded nodes appear here.</span>`;
      return;
    }
    const id = r.visitedNodesOrder[this.current];
    const node = this.graph.nodes[id];
    const info = r.expansionInfo[this.current] || {};
    const parent = info.parent ? this.graph.nodes[info.parent] : null;
    const isGoal = r.path.length && id === r.path[r.path.length - 1];
    const values = [];
    if (info.g !== undefined) values.push(`g = ${info.g.toFixed(2)}`);
    if (info.h !== undefined) values.push(`h = ${info.h.toFixed(2)}`);
    if (info.f !== undefined) values.push(`f = ${info.f.toFixed(2)}`);
    if (info.depth !== undefined) values.push(`depth = ${info.depth}`);
    if (info.limit !== undefined) values.push(`depth limit = ${info.limit}`);
    this.el.detail.innerHTML = `
      <div class="trace-step">Step ${(this.current + 1).toLocaleString()} of ${this.count().toLocaleString()}${isGoal ? ' · <span class="trace-goal">goal reached</span>' : ""}</div>
      <div class="trace-node">${TracePlayer.escape(node.name)} <span class="trace-muted">${id}</span></div>
      <div class="trace-muted">${parent ? `reached from ${TracePlayer.escape(parent.name)}` : "start node"}${values.length ? " · " + values.join(" · ") : ""}</div>`;
  }

  static escape(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------
  bindEvents() {
    const el = this.el;
    el.panel.querySelectorAll("[data-trace]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-trace");
        if (action === "play") this.toggle();
        else this[action]();
      });
    });
    el.speed.addEventListener("change", () => { if (this.playing && !this.auto) this.play(); });
    el.jump.addEventListener("change", () => {
      const step = parseInt(el.jump.value, 10);
      if (Number.isFinite(step)) { this.pause(); this.goTo(step - 1); }
    });
    el.list.addEventListener("scroll", () => this.renderRows());
    el.list.addEventListener("click", e => {
      const row = e.target.closest("[data-step]");
      if (row) { this.pause(); this.goTo(Number(row.getAttribute("data-step"))); }
    });
    el.list.addEventListener("keydown", e => {
      const keys = { ArrowDown: () => this.next(), ArrowUp: () => this.prev(), ArrowRight: () => this.next(), ArrowLeft: () => this.prev(), Home: () => this.first(), End: () => this.last(), " ": () => this.toggle() };
      if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
    });
  }
}

if (typeof window !== 'undefined') {
  window.TracePlayer = TracePlayer;
}

# 🚑 Chattogram Port City Emergency Vehicle Dispatch & Routing Simulator

A graph-search simulation & decision-support web application for Emergency Vehicle Routing (Ambulance / Fire Service / Rescue) across **Chattogram Metropolitan Area (Port City, Bangladesh)**.

The road network is built from real **OpenStreetMap** data: every drivable street and public service lane in the metro area, Kalurghat and the south bank (19,768 nodes, 24,893 road segments, 2,574 of them one-way), drawn with its exact OSM geometry, plus 6,252 named places. The application models dynamic urban constraints including **Monsoon Tidal Surge & Waterlogging (Jolaboddhota)**, **Chattogram Port Container Lorry Congestion**, **Road Condition**, and **Day vs Night Safety Penalties**. It evaluates **6 Graph Search Algorithms**: BFS, DFS, UCS, IDS, A*, and Greedy Best-First Search, plus a zero-heuristic A* baseline.

See [FEATURES_CHECKLIST.md](FEATURES_CHECKLIST.md) for the feature-by-feature status.

---

## 🌟 Features

- **Full, directed street network**: Built from OpenStreetMap (motorway → residential, living streets and public service lanes; parking aisles and private driveways excluded) by `tools/build_graph.js`. Every edge follows a real road line (within 2 m) and keeps its OSM way ID, road class and one-way direction. The graph is the largest strongly connected part of the network, so every node can reach every other node without driving the wrong way. A switch allows contraflow for emergency vehicles.
- **Search places, roads and junctions**: Start and destination boxes search 6,252 named places (English, Bangla and alternative names, category, locality) and every road node, with keyboard control and a clear button. The chosen point is snapped to the nearest road node and the snapping distance is shown (limit 500 m by default, up to 2,000 m).
- **Click-anywhere routing**: Click the map to snap to the nearest road node within the snapping limit.
- **Road inspector and condition editor**: Click a road to see its OSM way, class, one-way rule, endpoints, length and cost in each direction, and to set its traffic, waterlogging, road condition, safety penalty and closure (one direction or both). Overrides are saved in the browser.
- **Scenarios**: Six built-in scenarios (Normal Day, Heavy Traffic, Heavy Rain and Waterlogging, Night Travel, Road Blockage, Combined Emergency) set conditions by OSM road class. The **Scenario Studio** creates, duplicates, edits and deletes custom scenarios with class conditions, road-specific conditions and their own cost weights.
- **Adjustable cost weights** for traffic, road condition, rain and safety (0–10).
- **Search limits**: Maximum expansions, timeout and maximum DFS/IDS depth. A stopped search reports `expansion_limit`, `timeout` or `depth_limit`; only `unreachable` means no route exists.
- **Compare all algorithms on the map**: Every route is drawn in its algorithm's colour with show/hide toggles; the selected route is thicker, the others dashed, and identical routes are flagged.
- **Exploration trace**: A panel beside the map lists every node the search expanded, in order, with its parent and g / h / f values (or depth). Click a row, or an explored dot on the map, to jump to that step; step with ◀ ▶ or the arrow keys, or play the search back at 2–1000 steps per second. The map shows the nodes expanded so far, the current node, and its path back to the start along the real roads.
- **Viewport rendering**: Only roads in view are drawn (at most 2,500, main roads first); filter roads by OSM class and show named places as plain dots from zoom 15.
- **Real-time reactivity**: Traffic, flood depth, season and day/night recolour the roads and re-run the search:
  - 🟢 **Green**: Clear / Low Cost Road
  - 🟡 **Amber**: Moderate Traffic / Light Flood
  - 🔴 **Red**: Severe Congestion / Submerged Road
  - 🟣 **Purple**: Closed (dashed: closed in one direction)
- **Benchmarks**: Chart.js graphs, a comparison table (status, cost, distance, time, route nodes, expanded and generated nodes, queue size, run time), **scenario comparison** across up to 8 scenarios with stale-result marking, and **CSV export**.
- **Google Maps integration**: Google Streets / Satellite / Terrain base maps and an **"Open Route in Google Maps"** button.
- **Backend API** (optional): `server.js` exposes routing, places, roads, scenarios and overrides as a JSON API with `/docs`.

---

## 📐 Real Scenario Dynamic Cost & Heuristic Functions

### 1. Dynamic Edge Cost Function \(C(u, v)\)
$$C(u, v) = \text{Distance} \times w_{\text{road}} \times (1 + W_t T) \times (1 + W_r R) \times (1 + W_c K) \times (1 + W_s S) + \text{JunctionDelay}$$

\(T\) is traffic intensity, \(R\) standing water, \(K\) road damage and \(S\) the safety penalty; \(W_t, W_r, W_c, W_s\) are the adjustable weights (default 1).

- **Road Surface Weight (\(w_{\text{road}}\))**: Trunk Highway (0.9x), Avenue (1.0x), Street (1.25x), Old City Alley (1.70x), Damaged Surface (2.20x).
- **Port Lorry Congestion**: 1.0x to 3.5x with 1.5x extra sensitivity on roads within 1.5 km of Port Gates, Saltgola, CEPZ and the Port Connecting Road.
- **Tidal Waterlogging (Jolaboddhota)**: Per-road flood susceptibility, interpolated from hand-calibrated corridors (Halishahar, 2 No. Gate, Muradpur, Agrabad C/A); amplified 1.8x in monsoon.
- **Day vs Night Safety Modifier**: Penalizes unlit narrow alleys in Andarkilla/Khatunganj during nighttime dispatch.
- Closed directions and the wrong way along one-way streets are removed from the graph, not given a finite penalty.

### 2. Condition Precedence
For each road, later entries replace earlier ones: baseline sliders → scenario conditions for the road's OSM class → scenario conditions for that road → saved user override.

### 3. Admissible Heuristic Function \(H(n)\)
$$H(n, \text{Goal}) = \text{HaversineDistance}(n, \text{Goal}) \times \min_{(u,v)} \frac{C(u, v)}{\text{HaversineDistance}(u, v)}$$

The scale is the cheapest cost per straight-line km of any passable road direction under the current conditions, so \(H\) is admissible and consistent: A* always returns the same optimal cost as UCS.

### 4. Estimated Travel Time
Free-flow speed per road type (arterial 50, avenue 40, street 28, alley 15, broken 12 km/h), slowed by the traffic, waterlogging and road-condition multipliers, plus junction waits. All traffic, weather, condition and safety values are simulations; no live data feed is connected.

---

## 🔍 Implemented Graph Search Algorithms

1. **BFS (Breadth-First Search)**: Finds minimum hop count path; ignores traffic/flooding.
2. **DFS (Depth-First Search)**: Uninformed deep search with a depth limit; prone to sub-optimal paths in narrow alleys.
3. **UCS (Uniform Cost Search / Dijkstra)**: Guarantees dynamic cost optimal path.
4. **IDS (Iterative Deepening Search)**: Combines space efficiency of DFS with level completeness (depth-limited graph search per iteration on a compact integer graph, so it scales to 20,000 nodes).
5. **A* Search**: Optimal informed search ($F = G + H$), plus a zero-heuristic baseline ($H = 0$).
6. **Greedy Best-First Search**: Fast heuristic-guided search ($F = H$).

---

## 🚀 How to Run Locally

The web app is a static site; the API server is optional. Node 18+ is needed only for the server, the tests and rebuilding the data.

```bash
# Clone repository
git clone https://github.com/Md-Akram-Khan/Chattogram-Emergency-Routing.git
cd Chattogram-Emergency-Routing

# Either: static site only
python -m http.server 8000

# Or: static site plus the JSON API (no npm install needed)
npm start            # node server.js --port 8000
```

Open `http://localhost:8000`. With `npm start`, the API docs are at `http://localhost:8000/docs`.

### API overview

| Method | Endpoint | Function |
|--------|----------|----------|
| GET | `/api/health`, `/api/ready`, `/api/metadata` | Liveness, dataset readiness (503 when missing), dataset statistics and quality report |
| GET | `/api/places?q=&group=&bbox=`, `/api/places/{id}` | Place search and details |
| POST | `/api/resolve` | Snap a coordinate to the nearest road node within a distance limit |
| POST | `/api/routes` | Run one algorithm or `all`; returns GeoJSON geometry, metrics and a bounded trace |
| POST | `/api/compare-scenarios` | One query across up to 8 scenarios |
| GET/POST/PUT/DELETE | `/api/scenarios[/{id}]` | List, create, update and delete custom scenarios (built-ins are read-only: 409) |
| GET | `/api/roads?bbox=&classes=&limit=`, `/api/road?id=` | Viewport roads as GeoJSON, and one road's inspection |
| PUT/DELETE | `/api/overrides[?id=]` | Save or reset simulated road conditions |

The server keeps its overrides and custom scenarios in `.state/state.json`. The browser app keeps its own in localStorage.

---

## 🧪 Tests

```bash
npm test          # engine, data pipeline, generated dataset and API tests
npm run test:e2e  # real-browser UI tests in headless Edge or Chrome (set CHROME_PATH if needed)
npm run test:all  # everything (57 tests)
```

The tests use Node's built-in test runner and need no installed packages. The browser tests load map tiles and the Leaflet / Chart.js CDN files from the network.

---

## 🗺️ Rebuilding the Road and Place Data

`js/chattogram_graph.js` and `js/chattogram_places.js` are generated in a compact self-decoding format (string tables, integer delta-encoded geometry).

```bash
node tools/build_graph.js               # build from the cache in tools/.cache/ (downloads what is missing)
node tools/build_graph.js --refresh     # re-download roads and places from the Overpass API
node tools/build_graph.js --offline     # never use the network; publish whatever is cached
node tools/build_graph.js --diagnose    # check that the Overpass servers answer; changes nothing
node tools/build_graph.js --area city   # smaller preset area (default: --area chattogram)
node tools/build_graph.js --bbox 22.30,91.78,22.38,91.86   # custom study area (S,W,N,E)
```

Downloads retry with exponential backoff on HTTP 429/5xx and honour Retry-After. Places are downloaded in a grid of tiles (`--place-grid N`) and each finished tile is cached, so an interrupted download resumes. Existing datasets are copied to `tools/.backups/` before being replaced, and each dataset records a SHA-256 checksum and a quality report (road-class counts, one-way edges, landmark snapping offsets, place coverage).

Landmarks and the seed flood / night-safety values live in `tools/seed_graph.js`. Hospital, fire station, 2 No Gate, Dewanhat and Saltgola positions there were checked against the same named places in OpenStreetMap.

---

## 📄 License & Data

Road and place data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License (ODbL).

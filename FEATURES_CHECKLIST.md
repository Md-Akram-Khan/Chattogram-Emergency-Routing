# Feature Checklist

Features from the Dhaka Route Lab report, tracked against this project.

Legend: ✅ implemented · 🟡 implemented differently (see note) · ⬜ not implemented

**Summary: 23 ✅ · 3 🟡 · 0 ⬜** — verified by 57 automated tests (`npm run test:all`), all passing.

## A. Routing engine

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Directed road graph: one-way streets respected, closures per direction | ✅ | OSM `oneway`, roundabouts and motorways are kept per edge (2,574 one-way edges). The graph is the largest strongly connected component, so every node can reach every other. A "Respect one-way streets" switch allows contraflow for emergency vehicles. |
| 2 | Search limits with statuses `expansion_limit`, `depth_limit`, `timeout`, `unreachable` | ✅ | Defaults are 10,000,000 expansions, 3,000 ms and **no depth limit** (the Dhaka app uses 100,000 / 3 s / depth 100 on a much smaller area). IDS needs millions of expansions on a 20k-node graph, and a depth limit of 500 made DFS stop on about 31% of routes, so depth is limited only when you set one (0 = no limit). Editable under **Search Limits**; the UI and API never present a stopped search as "no route". |
| 3 | Zero-heuristic A* baseline | ✅ | Selectable as its own algorithm, and optionally included in "Compare all". |
| 4 | Generated-node and route-node counts | ✅ | In the stats bar, comparison table, CSV export and API results. |

## B. Map and route display

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 5 | All routes in compare mode: colours, visibility toggles, selected route thicker, others dashed, identical routes flagged | ✅ | Routes panel on the map; click a name to select it (stats and frontier animation follow), untick to hide. "Same route as …" marks identical edge sequences. |
| 6 | Road-class filter on the map | ✅ | Filter by the 9 OSM road classes (display only; routing still uses every road). |
| 7 | Viewport-based road loading with a limit and "zoom in" notice | 🟡 | The browser app is static, so it loads the compact dataset once (2.9 MB) but **draws** only roads in view, at most 2,500 (main roads first), with a "zoom in" notice. The API's `GET /api/roads?bbox=` returns viewport roads with a limit, like the Dhaka backend. |

## C. Places and endpoint selection

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 8 | OSM place dataset (categories, English/Bangla/alt names, locality) | ✅ | 6,252 named places in 11 groups, each snapped to its nearest road node. Locality comes from address tags or the nearest named neighbourhood. |
| 9 | Place markers with category filter and per-view limit | ✅ | Plain coloured dots (no icons), off by default; zoom 15+, at most 100 per view. |
| 10 | Autocomplete over places and roads with 250 ms debounce, keyboard control and a clear button | ✅ | Matches English, Bangla and alternative names, locality and category; arrow keys, Enter, Escape; × clears an endpoint. |
| 11 | Snapping distance shown, configurable limit (default 500 m, max 2,000 m) | ✅ | Shown under each endpoint box and in popups; map clicks and places beyond the limit are refused with the actual distance. |
| 12 | Spatial index for nearest-node lookup | ✅ | Grid index (`js/spatial_index.js`) for map clicks, places, junction dots and viewport roads. |

## D. Road inspection and condition editing

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 13 | Road inspector: OSM way ID, OSM class, one-way, endpoints, edge ID, length, cost per direction | ✅ | Click any road. The OSM way links to openstreetmap.org (for a road merged from several ways, it is the longest one). |
| 14 | Per-road condition editor with save / cancel / reset road / reset all | 🟡 | Traffic, waterlogging, road condition, safety penalty and availability. **Closures are per direction, but traffic / rain / condition / safety apply to both directions of the road** (the Dhaka app stores every field per directed edge). |
| 15 | Adjustable cost weights (0–10) | ✅ | Traffic, condition, rain and safety weights; a scenario can carry its own weights. |

## E. Scenarios

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 16 | Built-in road-class scenarios | ✅ | Normal Day, Heavy Traffic, Heavy Rain and Waterlogging, Night Travel, Road Blockage, Combined Emergency (read-only). The old start/destination presets remain as "Quick Trips". |
| 17 | Scenario studio: create, name, describe, duplicate, edit, delete; class and road conditions; weights | ✅ | Add a road to a custom scenario from its popup ("Add to scenario"). |
| 18 | Scenario comparison across up to 8 scenarios | ✅ | Benchmark tab, any algorithm. |
| 19 | Persistence of overrides and custom scenarios | 🟡 | The browser app saves to **localStorage** (it has no server); the API server saves to `.state/state.json`. The Dhaka app uses one SQLite database. The two stores here are separate. |
| 20 | Condition precedence and stale-result marking | ✅ | Baseline → scenario class → scenario road → user override; an override can reopen a road a scenario closes. Routes recompute automatically on every change, so they cannot go stale; scenario-comparison results are greyed and flagged when inputs change. |

## Beyond the Dhaka app

| Feature | Status | Notes |
|---------|--------|-------|
| Step-by-step exploration trace | ✅ | Every expanded node listed in order beside the map, with parent and g / h / f or depth; click a row or a map dot to jump there; previous / next, play / pause with speed, go to step; the map shows expansions so far, the current node and its road path back to the start. (The Dhaka app shows a bounded trace of 300 nodes.) |

## F. Engineering and data pipeline

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 21 | Automated tests | ✅ | 57 tests with Node's built-in runner, no dependencies: engine (20), data pipeline and generated dataset (13), API (12), real-browser UI in headless Edge/Chrome (12). |
| 22 | Backend API with validation and error codes | ✅ | `server.js` (Node, no dependencies) instead of FastAPI: health, ready, metadata, places, resolve, routes, compare-scenarios, scenarios CRUD, roads, road, overrides; `/docs` and `/openapi.json`; 404 / 409 / 422 / 503. The web app still also works as a plain static site. |
| 23 | Robust OSM download | ✅ | Retries with exponential backoff on 429/5xx, honours Retry-After, rejects incomplete results, tiled place download that resumes from cached tiles, timestamped backups before overwriting, SHA-256 checksums and a quality report in the metadata, `--diagnose`, `--offline` (publish what is cached). |
| 24 | Configurable study area | ✅ | `--area chattogram` (default) or `--area city`, or `--bbox S,W,N,E`; caches are kept per area. |
| 25 | Missing-dataset setup panel | ✅ | Shown with build commands and a "Check dataset status" button when `js/chattogram_graph.js` is missing; the API answers 503. |
| 26 | Mobile / narrow-screen layout | ✅ | Controls stack above the map below 1,024 px; tested at 800 px wide. |

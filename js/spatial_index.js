/* ==========================================================================
   SPATIAL INDEX
   Uniform lat/lng grid for fast nearest-point lookup (map clicks, place
   snapping) and bounding-box queries (roads and places in the viewport).
   ========================================================================== */

class SpatialIndex {
  /**
   * @param cellDeg grid cell size in degrees (0.005 deg is about 550 m)
   */
  constructor(cellDeg = 0.005) {
    this.cellDeg = cellDeg;
    this.cells = new Map();
  }

  key(gx, gy) {
    return gx + ":" + gy;
  }

  cellOf(lat, lng) {
    return [Math.floor(lat / this.cellDeg), Math.floor(lng / this.cellDeg)];
  }

  // A point item goes in one cell
  insertPoint(item, lat, lng) {
    const [gx, gy] = this.cellOf(lat, lng);
    const k = this.key(gx, gy);
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k).push({ item, lat, lng });
  }

  // An item with an extent (a road) goes in every cell its bounding box touches
  insertBox(item, south, west, north, east) {
    const [gx0, gy0] = this.cellOf(south, west);
    const [gx1, gy1] = this.cellOf(north, east);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const k = this.key(gx, gy);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push({ item, south, west, north, east });
      }
    }
  }

  /**
   * Nearest point item to (lat, lng): { item, distanceKm } or null.
   * Searches outward ring by ring and stops once no closer cell can exist.
   */
  nearest(lat, lng, maxRings = 60, filter = null) {
    const [gx, gy] = this.cellOf(lat, lng);
    const kmPerCell = this.cellDeg * 110.57 * Math.cos(lat * Math.PI / 180);
    let best = null, bestD = Infinity;
    for (let r = 0; r <= maxRings; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cell = this.cells.get(this.key(gx + dx, gy + dy));
          if (!cell) continue;
          cell.forEach(entry => {
            if (filter && !filter(entry.item)) return;
            const d = SpatialIndex.haversine(lat, lng, entry.lat, entry.lng);
            if (d < bestD) { best = entry.item; bestD = d; }
          });
        }
      }
      if (best && bestD < r * kmPerCell) break;
    }
    return best ? { item: best, distanceKm: bestD } : null;
  }

  /**
   * All items whose point or box intersects the bounding box (deduplicated)
   */
  query(south, west, north, east) {
    const [gx0, gy0] = this.cellOf(south, west);
    const [gx1, gy1] = this.cellOf(north, east);
    const seen = new Set();
    const out = [];
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const cell = this.cells.get(this.key(gx, gy));
        if (!cell) continue;
        cell.forEach(entry => {
          if (seen.has(entry.item)) return;
          const inside = entry.lat !== undefined
            ? entry.lat >= south && entry.lat <= north && entry.lng >= west && entry.lng <= east
            : entry.north >= south && entry.south <= north && entry.east >= west && entry.west <= east;
          if (inside) {
            seen.add(entry.item);
            out.push(entry.item);
          }
        });
      }
    }
    return out;
  }

  static haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

if (typeof window !== 'undefined') {
  window.SpatialIndex = SpatialIndex;
}
if (typeof module !== 'undefined') {
  module.exports = SpatialIndex;
}

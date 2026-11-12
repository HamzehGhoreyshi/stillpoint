// The physical world is a list of axis-aligned boxes plus a floor at y = 0.
// Three questions get asked of it:
//   resolveCircle - push a standing body out of walls
//   groundHeight  - what am I standing on?
//   raycast       - what does this bullet / line of sight hit first?

const EPS = 1e-9;

export class CollisionWorld {
  constructor() {
    this.boxes = [];
  }

  addBox(cx, cy, cz, sx, sy, sz) {
    const b = {
      minX: cx - sx / 2, maxX: cx + sx / 2,
      minY: cy - sy / 2, maxY: cy + sy / 2,
      minZ: cz - sz / 2, maxZ: cz + sz / 2,
    };
    this.boxes.push(b);
    return b;
  }

  // Pushes a vertical cylinder (pos.x/z, radius, spanning yMin..yMax) out of
  // every box it overlaps. Boxes entirely below yMin are treated as steps.
  resolveCircle(pos, radius, yMin, yMax) {
    let hit = false;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (yMax <= b.minY || yMin >= b.maxY) continue;
      const cx = pos.x < b.minX ? b.minX : pos.x > b.maxX ? b.maxX : pos.x;
      const cz = pos.z < b.minZ ? b.minZ : pos.z > b.maxZ ? b.maxZ : pos.z;
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (radius - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      } else {
        // centre is inside the box: leave through the nearest side
        const l = pos.x - b.minX, r = b.maxX - pos.x, n = pos.z - b.minZ, f = b.maxZ - pos.z;
        const m = Math.min(l, r, n, f);
        if (m === l) pos.x = b.minX - radius;
        else if (m === r) pos.x = b.maxX + radius;
        else if (m === n) pos.z = b.minZ - radius;
        else pos.z = b.maxZ + radius;
      }
    }
    return hit;
  }

  // Highest surface under a footprint that the body could be standing on.
  groundHeight(x, z, radius, feetY, step) {
    let g = 0;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x + radius <= b.minX || x - radius >= b.maxX) continue;
      if (z + radius <= b.minZ || z - radius >= b.maxZ) continue;
      if (b.maxY <= feetY + step && b.maxY > g) g = b.maxY;
    }
    return g;
  }

  // Distance along a ray to the first surface, or Infinity. Direction must be
  // normalised. `out` (optional) receives the surface normal.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
    let best = maxDist;
    let hit = false;
    let bnx = 0, bny = 0, bnz = 0;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      let tmin = 0, tmax = best, nx = 0, ny = 0, nz = 0;

      if (dx > -EPS && dx < EPS) {
        if (ox < b.minX || ox > b.maxX) continue;
      } else {
        const inv = 1 / dx;
        let t1 = (b.minX - ox) * inv, t2 = (b.maxX - ox) * inv, s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; nx = s; ny = 0; nz = 0; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (dy > -EPS && dy < EPS) {
        if (oy < b.minY || oy > b.maxY) continue;
      } else {
        const inv = 1 / dy;
        let t1 = (b.minY - oy) * inv, t2 = (b.maxY - oy) * inv, s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; nx = 0; ny = s; nz = 0; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (dz > -EPS && dz < EPS) {
        if (oz < b.minZ || oz > b.maxZ) continue;
      } else {
        const inv = 1 / dz;
        let t1 = (b.minZ - oz) * inv, t2 = (b.maxZ - oz) * inv, s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      best = tmin; hit = true; bnx = nx; bny = ny; bnz = nz;
    }

    if (dy < -EPS) {
      const t = -oy / dy;
      if (t >= 0 && t < best) { best = t; hit = true; bnx = 0; bny = 1; bnz = 0; }
    }

    if (!hit) return Infinity;
    if (out) { out.nx = bnx; out.ny = bny; out.nz = bnz; }
    return best;
  }

  // True when nothing solid sits between two points.
  segmentClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-5) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len) === Infinity;
  }
}

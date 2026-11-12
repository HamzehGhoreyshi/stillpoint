// Enemy pathfinding. The arena is cut into 1 m cells; each cell stores its
// walking distance to the player (a "flow field"). An enemy that cannot see
// the player just steps toward the neighbouring cell with the lowest number,
// which leads it around walls. One field serves every enemy.

const NEIGHBOURS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

export class NavGrid {
  constructor(collision, half) {
    this.half = half;
    this.n = Math.round(half * 2);
    const n = this.n;
    this.blocked = new Uint8Array(n * n);
    this.dist = new Float32Array(n * n);
    this.queue = new Int32Array(n * n * 8);
    this.lastCell = -1;
    this.timer = 0;

    const inflate = 0.3; // keep paths a body-width away from walls
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x0 = -half + i - inflate, x1 = -half + i + 1 + inflate;
        const z0 = -half + j - inflate, z1 = -half + j + 1 + inflate;
        for (const b of collision.boxes) {
          if (b.maxY <= 0.5 || b.minY >= 1.8) continue; // steps and overhead beams
          if (x1 <= b.minX || x0 >= b.maxX || z1 <= b.minZ || z0 >= b.maxZ) continue;
          this.blocked[j * n + i] = 1;
          break;
        }
      }
    }
  }

  cellOf(x, z) {
    const n = this.n;
    const i = Math.min(Math.max(Math.floor(x + this.half), 0), n - 1);
    const j = Math.min(Math.max(Math.floor(z + this.half), 0), n - 1);
    return j * n + i;
  }

  nearestFree(cell) {
    if (!this.blocked[cell]) return cell;
    const n = this.n;
    const ci = cell % n, cj = (cell / n) | 0;
    for (let r = 1; r < 6; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          if (!this.blocked[j * n + i]) return j * n + i;
        }
      }
    }
    return cell;
  }

  // Recomputes the field when the player has moved to a new cell.
  update(dt, x, z) {
    this.timer -= dt;
    const cell = this.nearestFree(this.cellOf(x, z));
    if (cell === this.lastCell || this.timer > 0) return;
    this.lastCell = cell;
    this.timer = 0.15;

    const n = this.n, dist = this.dist, blocked = this.blocked, q = this.queue;
    dist.fill(Infinity);
    dist[cell] = 0;
    let head = 0, tail = 0;
    q[tail++] = cell;
    while (head < tail) {
      const c = q[head++];
      const ci = c % n, cj = (c / n) | 0;
      const base = dist[c];
      for (let k = 0; k < 8; k++) {
        const nb = NEIGHBOURS[k];
        const i = ci + nb[0], j = cj + nb[1];
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const t = j * n + i;
        if (blocked[t]) continue;
        // no cutting diagonally across a wall corner
        if (k >= 4 && (blocked[cj * n + i] || blocked[j * n + ci])) continue;
        const nd = base + nb[2];
        if (nd < dist[t] - 1e-4) {
          dist[t] = nd;
          if (tail < q.length) q[tail++] = t;
        }
      }
    }
  }

  // Writes a unit direction (out.x, out.z) that leads toward the player.
  direction(x, z, out) {
    const n = this.n;
    const c = this.cellOf(x, z);
    const ci = c % n, cj = (c / n) | 0;
    let best = this.blocked[c] ? Infinity : this.dist[c];
    let bi = ci, bj = cj;
    for (let k = 0; k < 8; k++) {
      const nb = NEIGHBOURS[k];
      const i = ci + nb[0], j = cj + nb[1];
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const t = j * n + i;
      if (this.blocked[t]) continue;
      if (k >= 4 && (this.blocked[cj * n + i] || this.blocked[j * n + ci])) continue;
      if (this.dist[t] < best) { best = this.dist[t]; bi = i; bj = j; }
    }
    const tx = -this.half + bi + 0.5, tz = -this.half + bj + 0.5;
    const dx = tx - x, dz = tz - z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) { out.x = 0; out.z = 0; return false; }
    out.x = dx / len; out.z = dz / len;
    return true;
  }
}

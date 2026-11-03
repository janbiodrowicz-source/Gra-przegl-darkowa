/**
 * Static island bake: shallow-water halo, cliffs, beach, grass tops and small
 * decorations, rendered once into an offscreen canvas per zoom bucket.
 * Trees/rocks are NOT part of it (they are depth-sorted objects), so clearing
 * them never invalidates the bake.
 */
import { N } from '../core/map.js';
import { hash2 } from '../core/rng.js';
import { CLIFF, HH, HW, LIP, groundCode, groundZ } from './iso.js';

const SX = (gx, gy) => (gx - gy) * HW;
const SY = (gx, gy, z) => (gx + gy) * HH - z;

/** Key that changes only when the island's ground layout changes. */
export function groundKey(tiles) {
  let k = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) k += groundCode(tiles, x, y);
  return k;
}

/** World-space bounding box of the island including halo and cliffs. */
export function islandBounds(tiles, margin = 46) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (groundCode(tiles, x, y) === 'w') continue;
      minX = Math.min(minX, SX(x, y + 1));
      maxX = Math.max(maxX, SX(x + 1, y));
      minY = Math.min(minY, SY(x, y, LIP));
      maxY = Math.max(maxY, SY(x + 1, y + 1, -CLIFF));
    }
  }
  if (!Number.isFinite(minX)) return { x: -200, y: 0, w: 400, h: 300 };
  return { x: minX - margin, y: minY - margin, w: maxX - minX + margin * 2, h: maxY - minY + margin * 2 };
}

/**
 * Bakes the island at `scale` (canvas px per world px).
 * @returns {{ canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number, scale: number }}
 */
export function bakeTerrain(tiles, scale, seed = 0) {
  const b = islandBounds(tiles);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(b.w * scale);
  canvas.height = Math.ceil(b.h * scale);
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  g.translate(-b.x, -b.y);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  const code = (x, y) => groundCode(tiles, x, y);
  const zOf = (x, y) => groundZ(tiles, x, y);

  /* -- 1. shallow water halo (drawn at sea level, mostly hidden under land) -- */
  const coast = new Path2D();
  const south = new Path2D();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (code(x, y) === 'w') continue;
      const w = (cx, cy) => code(cx, cy) === 'w';
      const seg = (p, ax, ay, bx, by) => {
        p.moveTo(SX(ax, ay), SY(ax, ay, -CLIFF));
        p.lineTo(SX(bx, by), SY(bx, by, -CLIFF));
      };
      if (w(x, y - 1)) seg(coast, x, y, x + 1, y);
      if (w(x - 1, y)) seg(coast, x, y, x, y + 1);
      if (w(x + 1, y)) { seg(coast, x + 1, y, x + 1, y + 1); seg(south, x + 1, y, x + 1, y + 1); }
      if (w(x, y + 1)) { seg(coast, x, y + 1, x + 1, y + 1); seg(south, x, y + 1, x + 1, y + 1); }
    }
  }
  for (const [width, color] of [[86, 'rgba(126, 226, 218, 0.16)'], [62, 'rgba(140, 233, 224, 0.22)'], [40, 'rgba(165, 242, 232, 0.3)'], [22, 'rgba(205, 250, 242, 0.38)']]) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke(coast);
  }

  /* -- 2. tiles back-to-front: top, then the faces that drop to lower neighbours -- */
  const order = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (code(x, y) !== 'w') order.push([x, y]);
  order.sort((p, q) => (p[0] + p[1]) - (q[0] + q[1]) || p[0] - q[0]);

  for (const [x, y] of order) {
    const c = code(x, y);
    const z = zOf(x, y);
    const v = hash2(x, y, seed);
    // top
    g.beginPath();
    g.moveTo(SX(x, y), SY(x, y, z));
    g.lineTo(SX(x + 1, y), SY(x + 1, y, z));
    g.lineTo(SX(x + 1, y + 1), SY(x + 1, y + 1, z));
    g.lineTo(SX(x, y + 1), SY(x, y + 1, z));
    g.closePath();
    if (c === 'g') {
      g.fillStyle = (x + y) % 2 ? '#8ace66' : '#86ca62';
      g.fill();
      g.fillStyle = `rgba(255, 255, 220, ${0.04 + v * 0.06})`;
      g.fill();
    } else {
      g.fillStyle = (x + y) % 2 ? '#f3dba1' : '#f1d89b';
      g.fill();
      g.fillStyle = `rgba(255, 250, 230, ${0.05 + v * 0.08})`;
      g.fill();
    }
    // faces
    const faces = [
      // +x face (screen bottom-right), neighbour (x+1, y)
      { nx: x + 1, ny: y, a: [x + 1, y + 1], b: [x + 1, y], dark: true },
      // +y face (screen bottom-left), neighbour (x, y+1)
      { nx: x, ny: y + 1, a: [x, y + 1], b: [x + 1, y + 1], dark: false },
    ];
    for (const f of faces) {
      const nz = zOf(f.nx, f.ny);
      if (nz >= z) continue;
      const toSea = code(f.nx, f.ny) === 'w';
      const ax = SX(f.a[0], f.a[1]), bx = SX(f.b[0], f.b[1]);
      const ayTop = SY(f.a[0], f.a[1], z), byTop = SY(f.b[0], f.b[1], z);
      const ayBot = SY(f.a[0], f.a[1], nz), byBot = SY(f.b[0], f.b[1], nz);
      g.beginPath();
      g.moveTo(ax, ayTop);
      g.lineTo(bx, byTop);
      g.lineTo(bx, byBot);
      g.lineTo(ax, ayBot);
      g.closePath();
      if (!toSea) {
        // grass lip over sand
        g.fillStyle = f.dark ? '#5e9f45' : '#6eb352';
        g.fill();
        continue;
      }
      const grad = g.createLinearGradient(0, Math.min(ayTop, byTop), 0, Math.max(ayBot, byBot));
      if (f.dark) {
        grad.addColorStop(0, c === 'g' ? '#6aa94d' : '#d9b978');
        grad.addColorStop(0.18, c === 'g' ? '#6aa94d' : '#d9b978');
        grad.addColorStop(0.2, '#b98756');
        grad.addColorStop(1, '#8c5f38');
      } else {
        grad.addColorStop(0, c === 'g' ? '#79b95a' : '#ead08f');
        grad.addColorStop(0.18, c === 'g' ? '#79b95a' : '#ead08f');
        grad.addColorStop(0.2, '#cd9a64');
        grad.addColorStop(1, '#a87445');
      }
      g.fillStyle = grad;
      g.fill();
      // strata
      g.strokeStyle = f.dark ? 'rgba(90, 55, 30, 0.25)' : 'rgba(120, 75, 40, 0.22)';
      g.lineWidth = 1;
      for (const t of [0.5, 0.78]) {
        g.beginPath();
        g.moveTo(ax, ayTop + (ayBot - ayTop) * t + (v - 0.5) * 2);
        g.lineTo(bx, byTop + (byBot - byTop) * t - (v - 0.5) * 2);
        g.stroke();
      }
    }
  }

  /* -- 3. decorations on tops -- */
  for (const [x, y] of order) {
    const c = code(x, y);
    const z = zOf(x, y);
    const cx = SX(x + 0.5, y + 0.5), cy = SY(x + 0.5, y + 0.5, z);
    const r1 = hash2(x, y, seed + 11), r2 = hash2(x, y, seed + 23), r3 = hash2(x, y, seed + 37);
    if (c === 'g') {
      // grass tufts
      const tufts = 1 + Math.floor(r1 * 3);
      for (let i = 0; i < tufts; i++) {
        const ox = (hash2(x * 7 + i, y, seed + 3) - 0.5) * 34;
        const oy = (hash2(x, y * 7 + i, seed + 5) - 0.5) * 14;
        g.strokeStyle = 'rgba(70, 130, 50, 0.55)';
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(cx + ox - 2, cy + oy);
        g.lineTo(cx + ox - 3, cy + oy - 4);
        g.moveTo(cx + ox, cy + oy);
        g.lineTo(cx + ox, cy + oy - 5);
        g.moveTo(cx + ox + 2, cy + oy);
        g.lineTo(cx + ox + 3, cy + oy - 4);
        g.stroke();
      }
      // flowers
      if (r2 > 0.62) {
        const colors = ['#ffffff', '#ffd166', '#ff9ab2', '#c9a7ff'];
        const col = colors[Math.floor(r3 * colors.length)];
        const n = 2 + Math.floor(r1 * 3);
        for (let i = 0; i < n; i++) {
          const ox = (hash2(x + i * 13, y, seed + 7) - 0.5) * 30;
          const oy = (hash2(x, y + i * 13, seed + 9) - 0.5) * 12;
          g.fillStyle = col;
          g.beginPath();
          g.arc(cx + ox, cy + oy, 1.5, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(255, 200, 80, 0.9)';
          g.beginPath();
          g.arc(cx + ox, cy + oy, 0.55, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else if (c === 's') {
      if (r1 > 0.45) {
        g.fillStyle = 'rgba(190, 160, 110, 0.55)';
        g.beginPath();
        g.ellipse(cx + (r2 - 0.5) * 26, cy + (r3 - 0.5) * 10, 1.8, 1, 0, 0, Math.PI * 2);
        g.fill();
      }
      if (r2 > 0.8) {
        // a little shell
        g.fillStyle = '#fbe7e0';
        g.beginPath();
        g.ellipse(cx + (r3 - 0.5) * 22, cy + (r1 - 0.5) * 8, 2.2, 1.5, 0.4, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /* -- 4. static foam line where visible cliffs meet the sea -- */
  g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  g.lineWidth = 2.2;
  g.stroke(south);

  return { canvas, x: b.x, y: b.y, w: b.w, h: b.h, scale };
}

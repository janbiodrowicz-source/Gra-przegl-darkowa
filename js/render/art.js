/**
 * Procedural art: isometric primitives and every building, tree and rock.
 * Static parts are drawn once into cached sprites; animated parts (wheat,
 * saw blade, flags, cranes) are drawn each frame on top.
 *
 * Coordinates: x, y in tile units relative to the tile centre, z in pixels.
 * Light comes from the top-left: tops are lightest, +y faces (screen
 * bottom-left) are mid, +x faces (screen bottom-right) are darkest.
 */
import { HW, HH } from './iso.js';

const PX = (x, y) => (x - y) * HW;
const PY = (x, y, z) => (x + y) * HH - z;
const TAU = Math.PI * 2;

/* ------------------------------------------------------------ palette */

export const PAL = {
  cream: { top: '#fff4de', left: '#f7e3bf', right: '#ddc195' },
  plaster: { top: '#fff7e9', left: '#fbead0', right: '#e3c9a0' },
  wood: { top: '#e2a76f', left: '#cc8d54', right: '#ab7140' },
  barn: { top: '#d98a52', left: '#c9763f', right: '#a65d31' },
  darkWood: { top: '#a06f46', left: '#8a5a36', right: '#6e4529' },
  stone: { top: '#dbe2e7', left: '#b9c3cb', right: '#97a2ac' },
  roofRed: { front: '#e57b4f', back: '#c4613b', gable: '#ddc195', edge: '#a8502f' },
  roofBrown: { front: '#9d5a3c', back: '#83462e', gable: '#b06a3f', edge: '#6a3824' },
  roofTeal: { front: '#2aa99b', back: '#1d8a7f', gable: '#ddc195', edge: '#176f66' },
  soil: '#a56b40',
  soilDark: '#82522f',
  window: '#8dd3e4',
  windowLit: '#ffe39a',
  door: '#7d4f2f',
  leaf: ['#4f9c47', '#5daa4f', '#6dbb58', '#88cf6c'],
  pine: ['#2f7a4a', '#3a8c55', '#4c9f63'],
};

/* --------------------------------------------------------- primitives */

function path(g, pts) {
  g.beginPath();
  g.moveTo(PX(pts[0][0], pts[0][1]), PY(pts[0][0], pts[0][1], pts[0][2]));
  for (let i = 1; i < pts.length; i++) g.lineTo(PX(pts[i][0], pts[i][1]), PY(pts[i][0], pts[i][1], pts[i][2]));
  g.closePath();
}

export function poly(g, pts, fill) {
  path(g, pts);
  g.fillStyle = fill;
  g.fill();
}

function line(g, a, b, stroke, width = 1) {
  g.beginPath();
  g.moveTo(PX(a[0], a[1]), PY(a[0], a[1], a[2]));
  g.lineTo(PX(b[0], b[1]), PY(b[0], b[1], b[2]));
  g.strokeStyle = stroke;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.stroke();
}

/** Axis-aligned box: footprint centre (x, y), half sizes, from z0 up h px. */
export function box(g, x, y, hx, hy, z0, h, c) {
  const z1 = z0 + h;
  poly(g, [[x - hx, y + hy, z0], [x + hx, y + hy, z0], [x + hx, y + hy, z1], [x - hx, y + hy, z1]], c.left);
  poly(g, [[x + hx, y + hy, z0], [x + hx, y - hy, z0], [x + hx, y - hy, z1], [x + hx, y + hy, z1]], c.right);
  if (c.top) poly(g, [[x - hx, y - hy, z1], [x + hx, y - hy, z1], [x + hx, y + hy, z1], [x - hx, y + hy, z1]], c.top);
}

/** Rectangle on the +y face plane (y = yPlane): x0..x1, z0..z1. */
function onY(g, yPlane, x0, x1, z0, z1, fill) {
  poly(g, [[x0, yPlane, z0], [x1, yPlane, z0], [x1, yPlane, z1], [x0, yPlane, z1]], fill);
}

/** Rectangle on the +x face plane (x = xPlane): y0..y1, z0..z1. */
function onX(g, xPlane, y0, y1, z0, z1, fill) {
  poly(g, [[xPlane, y0, z0], [xPlane, y1, z0], [xPlane, y1, z1], [xPlane, y0, z1]], fill);
}

/** Window with a light frame on the +y face. */
function windowY(g, yPlane, xc, w, z0, h, lit = false) {
  onY(g, yPlane + 0.001, xc - w / 2 - 0.012, xc + w / 2 + 0.012, z0 - 1, z0 + h + 1, '#fff6e4');
  onY(g, yPlane + 0.002, xc - w / 2, xc + w / 2, z0, z0 + h, lit ? PAL.windowLit : PAL.window);
  line(g, [xc, yPlane + 0.003, z0], [xc, yPlane + 0.003, z0 + h], '#fff6e4', 1);
}

/** Window with a frame on the +x face. */
function windowX(g, xPlane, yc, w, z0, h, lit = false) {
  onX(g, xPlane + 0.001, yc - w / 2 - 0.012, yc + w / 2 + 0.012, z0 - 1, z0 + h + 1, '#efe0c4');
  onX(g, xPlane + 0.002, yc - w / 2, yc + w / 2, z0, z0 + h, lit ? '#f3d27e' : '#6fb7c9');
  line(g, [xPlane + 0.003, yc, z0], [xPlane + 0.003, yc, z0 + h], '#efe0c4', 1);
}

/** Gable roof with the ridge along x. */
function roofX(g, x, y, hx, hy, ze, rise, o, c) {
  const x0 = x - hx - o, x1 = x + hx + o, zr = ze + rise;
  poly(g, [[x0, y, zr], [x1, y, zr], [x1, y - hy - o, ze], [x0, y - hy - o, ze]], c.back);
  poly(g, [[x + hx, y - hy, ze], [x + hx, y + hy, ze], [x + hx, y, zr]], c.gable);
  poly(g, [[x0, y, zr], [x1, y, zr], [x1, y + hy + o, ze], [x0, y + hy + o, ze]], c.front);
  // roof thickness on the visible end and eave
  poly(g, [[x1, y, zr], [x1, y + hy + o, ze], [x1, y + hy + o, ze - 2], [x1, y, zr - 2]], c.edge);
  poly(g, [[x0, y + hy + o, ze], [x1, y + hy + o, ze], [x1, y + hy + o, ze - 2], [x0, y + hy + o, ze - 2]], c.edge);
  line(g, [x0, y, zr], [x1, y, zr], 'rgba(255,255,255,0.35)', 1.2);
}

/** Gable roof with the ridge along y. */
function roofY(g, x, y, hx, hy, ze, rise, o, c) {
  const y0 = y - hy - o, y1 = y + hy + o, zr = ze + rise;
  poly(g, [[x, y0, zr], [x, y1, zr], [x - hx - o, y1, ze], [x - hx - o, y0, ze]], c.front);
  poly(g, [[x - hx, y + hy, ze], [x + hx, y + hy, ze], [x, y + hy, zr]], c.gable);
  poly(g, [[x, y0, zr], [x, y1, zr], [x + hx + o, y1, ze], [x + hx + o, y0, ze]], c.back);
  poly(g, [[x, y1, zr], [x - hx - o, y1, ze], [x - hx - o, y1, ze - 2], [x, y1, zr - 2]], c.edge);
  poly(g, [[x, y1, zr], [x + hx + o, y1, ze], [x + hx + o, y1, ze - 2], [x, y1, zr - 2]], c.edge);
  line(g, [x, y0, zr], [x, y1, zr], 'rgba(255,255,255,0.3)', 1.2);
}

/** Single-slope roof plane, high at the back (−y), low at the front (+y). */
function shedRoof(g, x0, x1, yb, yf, zb, zf, top, edge) {
  poly(g, [[x0, yb, zb], [x1, yb, zb], [x1, yf, zf], [x0, yf, zf]], top);
  poly(g, [[x0, yf, zf], [x1, yf, zf], [x1, yf, zf - 2.5], [x0, yf, zf - 2.5]], edge);
  poly(g, [[x1, yb, zb], [x1, yf, zf], [x1, yf, zf - 2.5], [x1, yb, zb - 2.5]], edge);
}

function shadow(g, x, y, rx, alpha = 0.2) {
  g.beginPath();
  g.ellipse(PX(x, y), PY(x, y, 0), rx, rx * 0.5, 0, 0, TAU);
  g.fillStyle = `rgba(36, 46, 24, ${alpha})`;
  g.fill();
}

/** A log lying along x; the visible end grain faces +x. */
function logX(g, x0, x1, y, zc, r) {
  const top = [[x0, y, zc + r], [x1, y, zc + r], [x1, y, zc - r], [x0, y, zc - r]];
  path(g, top);
  g.fillStyle = '#b06c37';
  g.fill();
  line(g, [x0 + 0.02, y, zc + r * 0.45], [x1 - 0.02, y, zc + r * 0.45], '#c98450', 1.2);
  const ex = PX(x1, y), ey = PY(x1, y, zc);
  g.beginPath();
  g.ellipse(ex, ey, r * 0.62, r, -0.45, 0, TAU);
  g.fillStyle = '#f1c48c';
  g.fill();
  g.beginPath();
  g.ellipse(ex, ey, r * 0.3, r * 0.5, -0.45, 0, TAU);
  g.strokeStyle = '#c98c55';
  g.lineWidth = 0.9;
  g.stroke();
}

function crate(g, x, y, z, s) {
  box(g, x, y, s, s, z, s * 26, PAL.wood);
  line(g, [x - s, y + s, z + 1], [x + s, y + s, z + s * 26 - 1], '#a96f3d', 0.9);
  line(g, [x + s, y + s, z + 1], [x + s, y - s, z + s * 26 - 1], '#8a5a2f', 0.9);
}

function dot(g, sx, sy, r, fill) {
  g.beginPath();
  g.arc(sx, sy, r, 0, TAU);
  g.fillStyle = fill;
  g.fill();
}

/* ============================================================ buildings */

/** Visual tier from level: 1–3 → 1, 4–6 → 2, 7+ → 3. */
export function tierOf(level) {
  return level >= 7 ? 3 : level >= 4 ? 2 : 1;
}

function hut(g, tier) {
  const hx = tier === 1 ? 0.29 : 0.33;
  const hy = tier === 1 ? 0.26 : 0.29;
  shadow(g, 0.05, 0.05, 22 + tier * 2, 0.2);
  let z = 0;
  if (tier === 3) {
    box(g, 0, 0, hx + 0.03, hy + 0.03, 0, 5, PAL.stone);
    z = 5;
  }
  const wallH = tier === 3 ? 21 : tier === 2 ? 17 : 15;
  box(g, 0, 0, hx, hy, z, wallH, tier === 3 ? PAL.plaster : PAL.cream);
  // timber beams on the walls for higher tiers
  if (tier >= 2) {
    line(g, [-hx, hy, z + wallH - 1], [hx, hy, z + wallH - 1], '#b98a5e', 1.4);
    line(g, [hx, hy, z + wallH - 1], [hx, -hy, z + wallH - 1], '#9c7148', 1.4);
  }
  // door + step
  onY(g, hy + 0.001, -0.07, 0.05, z, z + 10, PAL.door);
  onY(g, hy + 0.002, -0.055, 0.035, z + 1, z + 9, '#93603a');
  dot(g, PX(0.03, hy), PY(0.03, hy, z + 5), 0.8, '#f2c48d');
  if (tier >= 2) box(g, -0.01, hy + 0.04, 0.09, 0.04, 0, z + 1.5, PAL.stone);
  // windows
  windowX(g, hx, -0.02, 0.16, z + 5, 6, tier === 3);
  if (tier >= 2) windowY(g, hy, 0.17, 0.1, z + 4, 6);
  if (tier === 3) windowY(g, hy, -0.17, 0.1, z + 12, 6, true);
  // flower box under the side window
  if (tier >= 2) {
    box(g, hx + 0.02, -0.02, 0.025, 0.1, z + 3, 2.5, PAL.darkWood);
    for (const [yy, col] of [[-0.09, '#ff7a9a'], [-0.03, '#ffd166'], [0.03, '#ff7a9a'], [0.09, '#fff1f1']]) {
      dot(g, PX(hx + 0.03, yy), PY(hx + 0.03, yy, z + 6.5), 1.6, col);
    }
  }
  // roof
  const ze = z + wallH;
  const rise = tier === 1 ? 12 : tier === 2 ? 14 : 16;
  roofX(g, 0, 0, hx, hy, ze, rise, 0.06, tier === 3 ? PAL.roofBrown : PAL.roofRed);
  // chimney on the front slope (drawn after the roof)
  const cy = 0.07;
  const roofAt = ze + rise * (1 - cy / (hy + 0.06));
  box(g, 0.15, cy, 0.045, 0.045, roofAt - 3, 11, PAL.stone);
  box(g, 0.15, cy, 0.055, 0.055, roofAt + 7, 2.5, { top: '#c3ccd4', left: '#a8b2bb', right: '#8c97a1' });
  // fence and lantern
  if (tier >= 2) {
    for (const xx of [-0.44, -0.3, 0.3, 0.44]) box(g, xx, 0.44, 0.015, 0.015, 0, 7, PAL.darkWood);
    line(g, [-0.44, 0.44, 5], [-0.3, 0.44, 5], '#8a5a36', 1.3);
    line(g, [0.3, 0.44, 5], [0.44, 0.44, 5], '#8a5a36', 1.3);
  }
  if (tier === 3) {
    line(g, [-0.18, hy + 0.08, 0], [-0.18, hy + 0.08, 15], '#5e4330', 1.4);
    dot(g, PX(-0.18, hy + 0.08), PY(-0.18, hy + 0.08, 16), 4.5, 'rgba(255, 220, 120, 0.35)');
    dot(g, PX(-0.18, hy + 0.08), PY(-0.18, hy + 0.08, 16), 1.9, '#ffe08a');
  }
}

/** Where hut smoke comes out (world offset from the tile centre). */
export function hutChimney(tier) {
  const hy = tier === 1 ? 0.26 : 0.29;
  const z = tier === 3 ? 5 : 0;
  const wallH = tier === 3 ? 21 : tier === 2 ? 17 : 15;
  const rise = tier === 1 ? 12 : tier === 2 ? 14 : 16;
  const roofAt = z + wallH + rise * (1 - 0.07 / (hy + 0.06));
  return { x: PX(0.15, 0.07), y: PY(0.15, 0.07, roofAt + 10) };
}

const FIELD_S = 0.43;
const FIELD_ROWS = [3, 4, 5];
const FIELD_COLS = [4, 5, 6];

function field(g, tier) {
  const s = FIELD_S;
  shadow(g, 0, 0.02, 34, 0.1);
  poly(g, [[-s, s, 1], [s, s, 1], [s, s, -1.5], [-s, s, -1.5]], '#7d4d2b');
  poly(g, [[s, s, 1], [s, -s, 1], [s, -s, -1.5], [s, s, -1.5]], '#6a4024');
  poly(g, [[-s, -s, 1], [s, -s, 1], [s, s, 1], [-s, s, 1]], tier === 3 ? '#9c6136' : PAL.soil);
  const rows = FIELD_ROWS[tier - 1];
  for (let i = 0; i < rows; i++) {
    const y = -s + ((i + 0.5) * 2 * s) / rows;
    line(g, [-s + 0.05, y + 0.05, 1], [s - 0.05, y + 0.05, 1], PAL.soilDark, 1.6);
  }
  if (tier >= 2) {
    for (const [xx, yy] of [[-0.47, -0.47], [0.47, -0.47], [0.47, 0.47], [-0.47, 0.47]]) {
      box(g, xx, yy, 0.016, 0.016, 0, 7, PAL.darkWood);
    }
    line(g, [-0.47, 0.47, 5], [0.47, 0.47, 5], '#8a5a36', 1.2);
    line(g, [0.47, 0.47, 5], [0.47, -0.47, 5], '#73482b', 1.2);
  }
}

/** Animated wheat (drawn every frame). */
export function fieldStalks(g, tier, t, phase, sway = 1) {
  const s = FIELD_S;
  const rows = FIELD_ROWS[tier - 1];
  const cols = FIELD_COLS[tier - 1];
  const h = tier === 1 ? 8 : tier === 2 ? 10 : 11.5;
  const stem = tier === 1 ? '#a7b84a' : '#c49a2f';
  const head = tier === 1 ? '#d8cd5a' : tier === 2 ? '#f0c24c' : '#f6c94a';
  const heads = [];
  g.beginPath();
  for (let i = 0; i < rows; i++) {
    const y = -s + ((i + 0.5) * 2 * s) / rows;
    for (let j = 0; j < cols; j++) {
      const x = -s + ((j + 0.5) * 2 * s) / cols;
      const bx = PX(x, y), by = PY(x, y, 1);
      const w = Math.sin(t * 1.7 + phase + x * 3.1 + y * 2.3) * 1.7 * sway + Math.sin(t * 0.6 + phase) * 0.8 * sway;
      const tx = bx + w, ty = by - h;
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx + w * 0.2, by - h * 0.6, tx, ty);
      heads.push(tx, ty, w);
    }
  }
  g.strokeStyle = stem;
  g.lineWidth = 1.2;
  g.lineCap = 'round';
  g.stroke();
  g.beginPath();
  for (let k = 0; k < heads.length; k += 3) {
    const tx = heads[k], ty = heads[k + 1], w = heads[k + 2];
    g.moveTo(tx + 1.5, ty - 2);
    g.ellipse(tx, ty - 2, 1.5, 3, w * 0.08, 0, TAU);
  }
  g.fillStyle = head;
  g.fill();
  if (tier === 3) {
    // scarecrow (front-right corner)
    const sx = PX(0.3, 0.3), sy = PY(0.3, 0.3, 1);
    g.strokeStyle = '#6e4529';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx, sy - 19);
    g.moveTo(sx - 6, sy - 13);
    g.lineTo(sx + 6, sy - 13);
    g.stroke();
    dot(g, sx, sy - 20, 2.6, '#f0d9a8');
    g.fillStyle = '#c0573a';
    g.fillRect(sx - 3, sy - 16, 6, 6);
    g.beginPath();
    g.moveTo(sx - 5, sy - 21);
    g.lineTo(sx + 5, sy - 21);
    g.lineTo(sx, sy - 26);
    g.closePath();
    g.fillStyle = '#d9a441';
    g.fill();
  }
}

function sawmill(g, tier) {
  shadow(g, 0, 0.02, 30, 0.16);
  box(g, 0, -0.04, 0.4, 0.34, 0, 3.5, PAL.wood);
  for (let i = -3; i <= 3; i++) line(g, [i * 0.1, 0.3, 3.5], [i * 0.1, -0.38, 3.5], 'rgba(130, 80, 40, 0.35)', 0.8);
  // back wall from tier 2
  if (tier >= 2) box(g, 0, -0.33, 0.33, 0.035, 3.5, 18, PAL.barn);
  // log pile on the left
  const n = tier === 1 ? 2 : 3;
  for (let i = 0; i < n; i++) logX(g, -0.36, -0.06, -0.22 + i * 0.1, 7.5, 3.6);
  if (tier >= 2) logX(g, -0.33, -0.09, -0.17, 13.5, 3.4);
  if (tier === 3) logX(g, -0.33, -0.09, -0.07, 13.5, 3.4);
  // posts
  const posts = [[-0.32, -0.3, 22], [0.32, -0.3, 22], [-0.32, 0.12, 18], [0.32, 0.12, 18]];
  for (const [x, y, h] of posts) box(g, x, y, 0.022, 0.022, 3.5, h, PAL.darkWood);
  // roof
  shedRoof(g, -0.38, 0.38, -0.36, 0.18, 27, 21, tier === 3 ? '#7f4a33' : '#9b6542', '#6d3f28');
  for (let i = 1; i < 6; i++) {
    const x = -0.38 + i * (0.76 / 6);
    line(g, [x, -0.36, 27], [x, 0.18, 21], 'rgba(60, 30, 15, 0.25)', 0.9);
  }
  // saw table in front
  box(g, 0.14, 0.26, 0.13, 0.07, 3.5, 6, PAL.darkWood);
  // planks stack (tier 3)
  if (tier === 3) {
    box(g, -0.24, 0.3, 0.12, 0.06, 3.5, 3, PAL.wood);
    box(g, -0.24, 0.3, 0.12, 0.06, 6.5, 3, PAL.wood);
  }
  // sawdust pile
  g.beginPath();
  g.ellipse(PX(0.32, 0.36), PY(0.32, 0.36, 3), 6, 3, 0, 0, TAU);
  g.fillStyle = '#ebcf9c';
  g.fill();
}

/** Spinning saw blade (drawn every frame). */
export function sawBlade(g, tier, t) {
  const cx = PX(0.14, 0.26), cy = PY(0.14, 0.26, 9.5) - 3;
  const r = tier === 1 ? 5.5 : 6.5;
  const a0 = t * 9;
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = a0 + (i / 12) * TAU;
    const a2 = a + TAU / 24;
    g.lineTo(cx + Math.cos(a) * (r + 1.6), cy + Math.sin(a) * (r + 1.6) * 0.92);
    g.lineTo(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r * 0.92);
  }
  g.closePath();
  g.fillStyle = '#c5ced6';
  g.fill();
  g.beginPath();
  g.ellipse(cx, cy, r * 0.62, r * 0.57, 0, 0, TAU);
  g.fillStyle = '#e6ebef';
  g.fill();
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(a0) * r * 0.6, cy + Math.sin(a0) * r * 0.55);
  g.strokeStyle = 'rgba(120,130,140,0.6)';
  g.lineWidth = 1;
  g.stroke();
  dot(g, cx, cy, 1.4, '#6f7c88');
}

function rockMound(g, ox, oy, s, light) {
  // a faceted boulder authored in screen space around (ox, oy)
  const P = (x, y) => [ox + x * s, oy + y * s];
  const shape = [P(-14, 2), P(-16, -6), P(-9, -17), P(2, -21), P(12, -15), P(15, -4), P(9, 3), P(-3, 5)];
  g.beginPath();
  shape.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = light ? '#a9b4be' : '#9aa6b1';
  g.fill();
  g.beginPath();
  for (const [x, y] of [P(-16, -6), P(-9, -17), P(2, -21), P(0, -9), P(-8, -4)]) g.lineTo(x, y);
  g.closePath();
  g.fillStyle = '#ccd5dc';
  g.fill();
  g.beginPath();
  for (const [x, y] of [P(2, -21), P(12, -15), P(15, -4), P(9, 3), P(3, -6), P(0, -9)]) g.lineTo(x, y);
  g.closePath();
  g.fillStyle = '#7f8b97';
  g.fill();
  g.beginPath();
  g.moveTo(...P(-6, -1));
  g.lineTo(...P(-1, -5));
  g.strokeStyle = 'rgba(80, 90, 100, 0.5)';
  g.lineWidth = 1;
  g.stroke();
}

function quarry(g, tier) {
  shadow(g, 0, 0.02, 28, 0.15);
  // dusty ground patch
  poly(g, [[-0.42, -0.42, 0.5], [0.42, -0.42, 0.5], [0.42, 0.42, 0.5], [-0.42, 0.42, 0.5]], 'rgba(214, 196, 160, 0.55)');
  const [mx, my] = [PX(-0.12, -0.16), PY(-0.12, -0.16, 0)];
  rockMound(g, mx, my, tier === 1 ? 1.05 : 1.25, false);
  if (tier >= 2) rockMound(g, PX(-0.3, 0.1), PY(-0.3, 0.1, 0), 0.7, true);
  // cut blocks
  const blocks = tier === 1 ? [[0.2, 0.18]] : tier === 2 ? [[0.2, 0.18], [0.3, 0.02]] : [[0.2, 0.18], [0.3, 0.02], [0.08, 0.32]];
  for (const [x, y] of blocks) box(g, x, y, 0.07, 0.07, 0, 8, PAL.stone);
  if (tier === 3) box(g, 0.25, 0.1, 0.07, 0.07, 8, 7, PAL.stone);
  // pickaxe leaning on the block
  const px0 = PX(0.12, 0.3), py0 = PY(0.12, 0.3, 0);
  g.strokeStyle = '#8a5a36';
  g.lineWidth = 1.8;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(px0, py0);
  g.lineTo(px0 + 7, py0 - 14);
  g.stroke();
  g.beginPath();
  g.moveTo(px0 + 1, py0 - 15);
  g.quadraticCurveTo(px0 + 7, py0 - 18, px0 + 13, py0 - 13);
  g.strokeStyle = '#6e7b87';
  g.lineWidth = 2.2;
  g.stroke();
  // derrick (tier 2+)
  if (tier >= 2) {
    line(g, [0.3, -0.36, 0], [0.18, -0.24, 30], '#6e4529', 2);
    line(g, [0.06, -0.36, 0], [0.18, -0.24, 30], '#7e5232', 2);
    line(g, [0.18, -0.24, 30], [0.38, -0.04, 30], '#7e5232', 2);
  }
  if (tier === 3) {
    box(g, 0.3, 0.32, 0.12, 0.1, 0, 12, PAL.barn);
    shedRoof(g, 0.16, 0.44, 0.2, 0.44, 17, 13, '#7f4a33', '#5f3624');
  }
}

/** Swinging stone block on the derrick (tier 2+). */
export function quarryCrane(g, tier, t) {
  if (tier < 2) return;
  const top = [PX(0.38, -0.04), PY(0.38, -0.04, 30)];
  const swing = Math.sin(t * 1.3) * 2.2;
  const bx = top[0] + swing, by = top[1] + 14;
  g.beginPath();
  g.moveTo(top[0], top[1]);
  g.lineTo(bx, by);
  g.strokeStyle = 'rgba(70, 50, 30, 0.8)';
  g.lineWidth = 0.9;
  g.stroke();
  g.fillStyle = '#c9d2d9';
  g.fillRect(bx - 3.5, by, 7, 5);
  g.fillStyle = '#9ea9b3';
  g.fillRect(bx - 3.5, by + 3.5, 7, 1.5);
}

function market(g, tier) {
  shadow(g, 0, 0.03, 28, 0.16);
  // back posts
  for (const x of [-0.3, 0.3]) box(g, x, -0.16, 0.022, 0.022, 0, 27, PAL.darkWood);
  // second stall behind (tier 2+)
  if (tier >= 2) {
    box(g, -0.22, -0.3, 0.14, 0.1, 0, 8, PAL.wood);
    for (const [xx, col] of [[-0.3, '#e8483b'], [-0.22, '#7cc46a'], [-0.14, '#f2b632']]) {
      dot(g, PX(xx, -0.3), PY(xx, -0.3, 9.5), 2.4, col);
    }
  }
  // counter
  box(g, 0, 0.08, 0.32, 0.14, 0, 9, PAL.wood);
  onY(g, 0.22 + 0.001, -0.32, 0.32, 3, 5, 'rgba(120, 70, 35, 0.35)');
  // produce
  const goods = [[-0.22, 0.03, '#e8483b'], [-0.12, 0.08, '#e8483b'], [-0.02, 0.03, '#f2b632'], [0.08, 0.1, '#f2b632'], [0.16, 0.03, '#7cc46a'], [0.24, 0.1, '#7cc46a']];
  for (const [x, y, col] of goods) {
    dot(g, PX(x, y), PY(x, y, 11), 2.7, col);
    dot(g, PX(x, y) - 0.9, PY(x, y, 11) - 1, 0.9, 'rgba(255,255,255,0.6)');
  }
  // front posts
  for (const x of [-0.3, 0.3]) box(g, x, 0.24, 0.022, 0.022, 0, 21, PAL.darkWood);
  // striped awning (sloping to the front)
  const x0 = -0.36, x1 = 0.36, strips = 6;
  const cols = tier === 3 ? ['#e57b4f', '#fff4dc'] : ['#1aa394', '#fff4dc'];
  for (let i = 0; i < strips; i++) {
    const a = x0 + (i * (x1 - x0)) / strips;
    const b = x0 + ((i + 1) * (x1 - x0)) / strips;
    poly(g, [[a, -0.2, 28], [b, -0.2, 28], [b, 0.3, 21], [a, 0.3, 21]], cols[i % 2]);
  }
  // scalloped valance
  for (let i = 0; i < strips; i++) {
    const a = x0 + ((i + 0.5) * (x1 - x0)) / strips;
    g.beginPath();
    g.ellipse(PX(a, 0.3), PY(a, 0.3, 20.5), 4.6, 2.6, 0, 0, Math.PI);
    g.fillStyle = cols[i % 2];
    g.fill();
  }
  poly(g, [[x1, -0.2, 28], [x1, 0.3, 21], [x1, 0.3, 19.5], [x1, -0.2, 26.5]], tier === 3 ? '#b35a37' : '#14857a');
  // barrels (tier 2+)
  if (tier >= 2) {
    for (const [x, y] of [[0.4, 0.3], [0.4, 0.14]]) {
      const cx = PX(x, y), cy = PY(x, y, 0);
      g.fillStyle = '#9c6a3f';
      g.fillRect(cx - 4, cy - 10, 8, 10);
      g.beginPath();
      g.ellipse(cx, cy - 10, 4, 2, 0, 0, TAU);
      g.fillStyle = '#c38a52';
      g.fill();
      g.fillStyle = '#6e4529';
      g.fillRect(cx - 4, cy - 7.5, 8, 1.2);
      g.fillRect(cx - 4, cy - 3, 8, 1.2);
    }
  }
}

/** Waving flag (+ bunting at tier 3), drawn every frame. */
export function marketFlag(g, tier, t) {
  const bx = PX(-0.42, -0.3), by = PY(-0.42, -0.3, 0);
  const h = 40;
  g.strokeStyle = '#6e4529';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(bx, by);
  g.lineTo(bx, by - h);
  g.stroke();
  g.beginPath();
  const len = 15;
  g.moveTo(bx, by - h);
  for (let i = 1; i <= 6; i++) {
    const f = i / 6;
    g.lineTo(bx + f * len, by - h + Math.sin(t * 5 - f * 3) * 1.6 * f);
  }
  for (let i = 6; i >= 0; i--) {
    const f = i / 6;
    g.lineTo(bx + f * len, by - h + 8 + Math.sin(t * 5 - f * 3) * 1.6 * f);
  }
  g.closePath();
  g.fillStyle = tier === 3 ? '#1aa394' : '#e8483b';
  g.fill();
  dot(g, bx, by - h - 1, 1.6, '#ffd45c');
  if (tier === 3) {
    const a = [PX(-0.3, 0.24), PY(-0.3, 0.24, 21)];
    const b = [PX(0.3, 0.24), PY(0.3, 0.24, 21)];
    const sag = 4 + Math.sin(t * 1.5) * 0.6;
    const colors = ['#ffd45c', '#e8483b', '#1aa394', '#fff4dc'];
    for (let i = 0; i < 7; i++) {
      const f = (i + 0.5) / 7;
      const x = a[0] + (b[0] - a[0]) * f;
      const y = a[1] + (b[1] - a[1]) * f + Math.sin(f * Math.PI) * sag;
      g.beginPath();
      g.moveTo(x - 2.4, y);
      g.lineTo(x + 2.4, y);
      g.lineTo(x, y + 4);
      g.closePath();
      g.fillStyle = colors[i % 4];
      g.fill();
    }
  }
}

function warehouse(g, tier) {
  shadow(g, 0.03, 0.03, 30, 0.18);
  let z = 0;
  if (tier === 3) {
    box(g, 0, 0, 0.39, 0.35, 0, 4, PAL.stone);
    z = 4;
  }
  if (tier >= 2) {
    box(g, -0.34, 0.24, 0.1, 0.14, z, 11, PAL.barn);
    shedRoof(g, -0.46, -0.22, 0.1, 0.4, z + 15, z + 11, '#83462e', '#6a3824');
  }
  const hx = 0.36, hy = 0.32, wallH = 20;
  box(g, 0, 0, hx, hy, z, wallH, PAL.barn);
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.1;
    line(g, [x, hy + 0.002, z + 0.5], [x, hy + 0.002, z + wallH - 0.5], 'rgba(120, 60, 25, 0.35)', 0.8);
    line(g, [hx + 0.002, i * 0.09, z + 0.5], [hx + 0.002, i * 0.09, z + wallH - 0.5], 'rgba(90, 45, 20, 0.35)', 0.8);
  }
  // big door with an X brace
  onY(g, hy + 0.003, -0.13, 0.13, z, z + 15, '#7a4a2c');
  line(g, [-0.13, hy + 0.004, z], [0.13, hy + 0.004, z + 15], '#e9b98a', 1.3);
  line(g, [0.13, hy + 0.004, z], [-0.13, hy + 0.004, z + 15], '#e9b98a', 1.3);
  line(g, [0, hy + 0.004, z], [0, hy + 0.004, z + 15], '#5e3720', 1);
  windowX(g, hx, 0, 0.12, z + 12, 5);
  roofY(g, 0, 0, hx, hy, z + wallH, 16, 0.05, PAL.roofBrown);
  // round loft window on the gable
  g.beginPath();
  g.ellipse(PX(0, hy + 0.003), PY(0, hy + 0.003, z + wallH + 6), 2.6, 3, 0, 0, TAU);
  g.fillStyle = '#ffe9bf';
  g.fill();
  // crates outside
  crate(g, 0.42, 0.36, 0, 0.06);
  if (tier >= 2) crate(g, 0.42, 0.22, 0, 0.055);
  if (tier >= 2) crate(g, 0.42, 0.36, 6.3, 0.05);
  if (tier === 3) box(g, 0.3, -0.3, 0.025, 0.025, z + wallH, 18, PAL.darkWood);
}

/** Crane arm with a swinging crate (tier 3), drawn every frame. */
export function warehouseCrane(g, tier, t) {
  if (tier < 3) return;
  const z = 4 + 20 + 18;
  const a = [PX(0.3, -0.3), PY(0.3, -0.3, z)];
  const b = [PX(0.5, 0.0), PY(0.5, 0.0, z - 2)];
  g.strokeStyle = '#7e5232';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
  const swing = Math.sin(t * 1.1) * 1.8;
  const cx = b[0] + swing, cy = b[1] + 13;
  g.beginPath();
  g.moveTo(b[0], b[1]);
  g.lineTo(cx, cy);
  g.strokeStyle = 'rgba(60, 40, 25, 0.8)';
  g.lineWidth = 0.9;
  g.stroke();
  g.fillStyle = '#cc8d54';
  g.fillRect(cx - 4, cy, 8, 6);
  g.fillStyle = '#a96f3d';
  g.fillRect(cx, cy, 4, 6);
}

const BUILDING_DRAW = { hut, field, sawmill, quarry, market, warehouse };

/** Draws the static part of a building sprite. */
export function drawBuilding(g, type, tier) {
  BUILDING_DRAW[type]?.(g, tier);
}

/** Draws the animated part of a building (or nothing). */
export function drawBuildingDynamic(g, type, tier, t, phase) {
  switch (type) {
    case 'field': fieldStalks(g, tier, t, phase); break;
    case 'sawmill': sawBlade(g, tier, t + phase); break;
    case 'quarry': quarryCrane(g, tier, t + phase); break;
    case 'market': marketFlag(g, tier, t + phase); break;
    case 'warehouse': warehouseCrane(g, tier, t + phase); break;
    default: break;
  }
}

/** Approximate height of each building in world px (for picking & labels). */
export function buildingHeight(type, tier) {
  switch (type) {
    case 'hut': return 34 + tier * 5;
    case 'field': return 16;
    case 'sawmill': return 38;
    case 'quarry': return tier >= 2 ? 46 : 30;
    case 'market': return 48;
    case 'warehouse': return tier === 3 ? 66 : 50;
    default: return 40;
  }
}

/* ========================================================= nature */

export function drawTree(g, variant, onSand) {
  const v = variant;
  if (onSand) return palm(g, v);
  if (v < 0.36) return pine(g, v);
  return roundTree(g, v);
}

function roundTree(g, v) {
  const s = 0.74 + v * 0.2;
  g.beginPath();
  g.ellipse(2, 3, 15 * s, 7.5 * s, 0, 0, TAU);
  g.fillStyle = 'rgba(36, 46, 24, 0.22)';
  g.fill();
  g.fillStyle = '#8a5a36';
  g.fillRect(-2.2, -13 * s, 4.4, 14 * s);
  g.fillStyle = '#6e4529';
  g.fillRect(0, -13 * s, 2.2, 14 * s);
  const [d, m, l, hl] = PAL.leaf;
  dot(g, 0, -24 * s, 12.5 * s, d);
  dot(g, -6 * s, -27 * s, 8.5 * s, m);
  dot(g, 6 * s, -28 * s, 7.5 * s, m);
  dot(g, -1 * s, -32 * s, 8 * s, l);
  dot(g, -5 * s, -33 * s, 3.6 * s, hl);
  dot(g, 6 * s, -20 * s, 5 * s, 'rgba(40, 90, 40, 0.35)');
  if (v > 0.8) {
    dot(g, -6 * s, -22 * s, 1.6, '#e8483b');
    dot(g, 4 * s, -26 * s, 1.6, '#e8483b');
    dot(g, 1 * s, -19 * s, 1.6, '#e8483b');
  }
}

function pine(g, v) {
  const s = 0.74 + v * 0.34;
  g.beginPath();
  g.ellipse(2, 3, 12 * s, 6 * s, 0, 0, TAU);
  g.fillStyle = 'rgba(36, 46, 24, 0.22)';
  g.fill();
  g.fillStyle = '#7a4d2e';
  g.fillRect(-1.8, -8 * s, 3.6, 9 * s);
  const [d, m, l] = PAL.pine;
  const tri = (y, w, h, col) => {
    g.beginPath();
    g.moveTo(-w, y);
    g.lineTo(w, y);
    g.lineTo(0, y - h);
    g.closePath();
    g.fillStyle = col;
    g.fill();
  };
  tri(-6 * s, 11 * s, 16 * s, d);
  tri(-14 * s, 9 * s, 14 * s, m);
  tri(-21 * s, 7 * s, 12 * s, l);
  g.beginPath();
  g.moveTo(0, -33 * s);
  g.lineTo(-7 * s, -21 * s);
  g.lineTo(0, -22 * s);
  g.closePath();
  g.fillStyle = 'rgba(255, 255, 255, 0.12)';
  g.fill();
}

function palm(g, v) {
  g.save();
  g.scale(0.84, 0.84);
  palmShape(g, v);
  g.restore();
}

function palmShape(g, v) {
  const lean = (v - 0.5) * 10;
  g.beginPath();
  g.ellipse(4, 3, 13, 6, 0, 0, TAU);
  g.fillStyle = 'rgba(60, 50, 20, 0.2)';
  g.fill();
  g.strokeStyle = '#b07a46';
  g.lineWidth = 3.4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(lean * 0.2, -16, lean, -30);
  g.stroke();
  g.strokeStyle = '#8f5f35';
  g.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const f = i / 6;
    const x = lean * f * f, y = -30 * f;
    g.beginPath();
    g.moveTo(x - 1.8, y);
    g.lineTo(x + 1.8, y - 1);
    g.stroke();
  }
  const tx = lean, ty = -31;
  const leaves = [[-1, -0.25], [-0.6, -0.9], [0.1, -1.1], [0.7, -0.8], [1, -0.2], [-0.2, 0.3]];
  for (const [dx, dy] of leaves) {
    g.beginPath();
    g.moveTo(tx, ty);
    g.quadraticCurveTo(tx + dx * 9, ty + dy * 9 - 4, tx + dx * 15, ty + dy * 9 + 5);
    g.quadraticCurveTo(tx + dx * 8, ty + dy * 6, tx, ty);
    g.fillStyle = dy < -0.5 ? '#79c95f' : '#5fb24f';
    g.fill();
  }
  dot(g, tx - 1.5, ty + 1.5, 1.8, '#7a4d2e');
  dot(g, tx + 1.5, ty + 2, 1.8, '#6e4529');
}

export function drawRock(g, variant) {
  g.beginPath();
  g.ellipse(1, 2, 17, 8, 0, 0, TAU);
  g.fillStyle = 'rgba(36, 46, 24, 0.2)';
  g.fill();
  rockMound(g, -2, 2, 0.95 + variant * 0.2, variant > 0.5);
  if (variant < 0.7) rockMound(g, 10, 5, 0.45, true);
  if (variant > 0.4) {
    dot(g, -12, 3, 2, '#a3aeb8');
    dot(g, -9, 5, 1.4, '#b5bfc8');
  }
}

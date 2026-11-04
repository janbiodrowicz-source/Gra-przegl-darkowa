/**
 * Ambient life: villagers walking between buildings (BFS on the grid, they go
 * around water, trees and houses), gulls circling the island and soft cloud
 * shadows drifting over it. Purely visual — the game state is never touched.
 */
import { N, idx, inBounds } from '../core/map.js';
import { hash2 } from '../core/rng.js';
import { HH, HW, groundZ } from './iso.js';

const TAU = Math.PI * 2;
const SHIRTS = ['#1aa394', '#e3794d', '#f2b632', '#8e6fd8', '#4f86c6', '#d6587a', '#5daa4f'];
const SKIN = ['#f3c79b', '#e6b088', '#c8865a', '#8d5a3b'];
const HAIR = ['#3b2a20', '#6b4423', '#b07a3c', '#2b2b2b', '#e8d6a8'];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function createLife() {
  const walkers = [];
  const gulls = [];
  const clouds = [];
  let pass = null;
  let passRev = -1;
  let passState = null;
  let seq = 0;
  let shadowBlob = null;

  /* ---------------- grid ---------------- */

  function passability(state) {
    if (pass && passRev === state.rev && passState === state) return pass;
    pass = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const c = state.tiles[idx(x, y)];
        pass[idx(x, y)] = c === 'g' || c === 's' ? 1 : 0;
      }
    }
    for (const b of state.buildings) pass[idx(b.x, b.y)] = 0;
    passRev = state.rev;
    passState = state;
    return pass;
  }

  const free = (x, y) => inBounds(x, y) && pass[idx(x, y)] === 1;

  /** Shortest walkable path (8 directions, no corner cutting). */
  function bfs(from, to) {
    const start = idx(from.x, from.y);
    const goal = idx(to.x, to.y);
    if (start === goal) return [to];
    const prev = new Int16Array(N * N).fill(-1);
    prev[start] = start;
    const queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      if (cur === goal) break;
      const cx = cur % N, cy = (cur / N) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!free(nx, ny)) continue;
        if (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue;
        const ni = idx(nx, ny);
        if (prev[ni] !== -1) continue;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
    if (prev[goal] === -1) return null;
    const path = [];
    for (let c = goal; c !== start; c = prev[c]) path.push({ x: c % N, y: (c / N) | 0 });
    return path.reverse();
  }

  /** A walkable tile next to a building, preferring its front (door) side. */
  function doorOf(b) {
    for (const [dx, dy] of [[0, 1], [1, 0], [1, 1], [-1, 1], [1, -1], [-1, 0], [0, -1], [-1, -1]]) {
      if (free(b.x + dx, b.y + dy)) return { x: b.x + dx, y: b.y + dy };
    }
    return null;
  }

  /* ---------------- walkers ---------------- */

  function newWalker(state) {
    const k = seq++;
    const look = {
      shirt: SHIRTS[Math.floor(hash2(k, 1, 9) * SHIRTS.length)],
      skin: SKIN[Math.floor(hash2(k, 2, 9) * SKIN.length)],
      hair: HAIR[Math.floor(hash2(k, 3, 9) * HAIR.length)],
      hat: hash2(k, 4, 9) > 0.72,
    };
    const homes = state.buildings.filter((b) => doorOf(b));
    const home = homes.length ? homes[Math.floor(Math.random() * homes.length)] : null;
    const door = home ? doorOf(home) : null;
    if (!door) return null;
    return {
      gx: door.x + 0.5, gy: door.y + 0.5,
      path: null, i: 0, target: home.id,
      wait: Math.random() * 2, inside: true,
      speed: 0.55 + Math.random() * 0.25,
      phase: Math.random() * TAU, look, flip: false,
    };
  }

  function plan(w, state) {
    const here = { x: Math.floor(w.gx), y: Math.floor(w.gy) };
    if (!free(here.x, here.y)) {
      // standing somewhere that became blocked (a house was built): hop to any free neighbour
      for (const [dx, dy] of DIRS) {
        if (free(here.x + dx, here.y + dy)) { w.gx = here.x + dx + 0.5; w.gy = here.y + dy + 0.5; return plan(w, state); }
      }
      return false;
    }
    const options = state.buildings.filter((b) => b.id !== w.target);
    for (let tries = 0; tries < 5 && options.length; tries++) {
      const b = options[Math.floor(Math.random() * options.length)];
      const door = doorOf(b);
      if (!door) continue;
      const path = bfs(here, door);
      if (path && path.length <= 22) {
        w.path = path;
        w.i = 0;
        w.target = b.id;
        return true;
      }
    }
    // wander a little
    const near = [];
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (free(here.x + dx, here.y + dy)) near.push({ x: here.x + dx, y: here.y + dy });
    if (!near.length) return false;
    const spot = near[Math.floor(Math.random() * near.length)];
    w.path = bfs(here, spot);
    w.i = 0;
    w.target = -1;
    return !!w.path;
  }

  function updateWalkers(dt, state) {
    passability(state);
    const want = Math.min(10, Math.floor(state.pop / 2));
    while (walkers.length < want) {
      const w = newWalker(state);
      if (!w) break;
      walkers.push(w);
    }
    while (walkers.length > want) walkers.pop();
    for (const w of walkers) {
      if (w.wait > 0) {
        w.wait -= dt;
        if (w.wait <= 0) {
          w.inside = false;
          if (!plan(w, state)) w.wait = 1 + Math.random() * 2;
        }
        continue;
      }
      if (!w.path) {
        if (!plan(w, state)) { w.wait = 1; continue; }
      }
      const node = w.path[w.i];
      if (!node || !free(node.x, node.y)) { w.path = null; continue; }
      const tx = node.x + 0.5, ty = node.y + 0.5;
      const dx = tx - w.gx, dy = ty - w.gy;
      const dist = Math.hypot(dx, dy);
      const step = w.speed * dt;
      // screen direction for facing: screen x grows with (gx - gy)
      if (Math.abs(dx - dy) > 0.01) w.flip = dx - dy < 0;
      if (dist <= step) {
        w.gx = tx;
        w.gy = ty;
        w.i++;
        if (w.i >= w.path.length) {
          w.path = null;
          w.wait = 1.5 + Math.random() * 3.5;
          w.inside = w.target >= 0;
        }
      } else {
        w.gx += (dx / dist) * step;
        w.gy += (dy / dist) * step;
      }
      w.phase += dt * 9;
    }
  }

  function drawWalker(g, w, state) {
    const tx = Math.floor(w.gx), ty = Math.floor(w.gy);
    const z = groundZ(state.tiles, tx, ty);
    const x = (w.gx - w.gy) * HW;
    const y = (w.gx + w.gy) * HH - z;
    const moving = w.wait <= 0 && w.path;
    const bob = moving ? Math.abs(Math.sin(w.phase)) * 1.1 : 0;
    const legA = moving ? Math.sin(w.phase) * 1.6 : 0;
    g.fillStyle = 'rgba(30, 40, 20, 0.25)';
    g.beginPath();
    g.ellipse(x, y, 3, 1.5, 0, 0, TAU);
    g.fill();
    g.strokeStyle = '#4b3a2c';
    g.lineWidth = 1.3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x - 0.9, y - 3.2 - bob);
    g.lineTo(x - 0.9 + legA * 0.5, y - 0.4);
    g.moveTo(x + 0.9, y - 3.2 - bob);
    g.lineTo(x + 0.9 - legA * 0.5, y - 0.4);
    g.stroke();
    g.fillStyle = w.look.shirt;
    g.beginPath();
    g.ellipse(x, y - 5.6 - bob, 2.5, 3, 0, 0, TAU);
    g.fill();
    g.fillStyle = w.look.skin;
    g.beginPath();
    g.arc(x + (w.flip ? -0.3 : 0.3), y - 10 - bob, 2.1, 0, TAU);
    g.fill();
    g.fillStyle = w.look.hat ? '#e9c46a' : w.look.hair;
    g.beginPath();
    if (w.look.hat) g.ellipse(x, y - 11.4 - bob, 3.2, 1.2, 0, 0, TAU);
    else g.arc(x, y - 10.6 - bob, 2.1, Math.PI, TAU);
    g.fill();
  }

  /* ---------------- gulls & clouds ---------------- */

  function ensureSky(bounds) {
    if (!gulls.length) {
      for (let i = 0; i < 2; i++) gulls.push({ a: Math.random() * TAU, speed: (0.07 + Math.random() * 0.03) * (i ? -1 : 1), k: 0.5 + i * 0.12, alt: 70 + i * 26, flap: Math.random() * TAU });
    }
    if (!clouds.length) {
      for (let i = 0; i < 3; i++) {
        clouds.push({
          x: bounds.x + Math.random() * bounds.w,
          y: bounds.y + Math.random() * bounds.h,
          r: 110 + Math.random() * 90,
          vx: 7 + Math.random() * 4,
          vy: -2 - Math.random() * 2,
        });
      }
    }
    if (!shadowBlob) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(15, 40, 45, 1)');
      grad.addColorStop(0.6, 'rgba(15, 40, 45, 0.6)');
      grad.addColorStop(1, 'rgba(15, 40, 45, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      shadowBlob = c;
    }
  }

  function updateSky(dt, bounds) {
    ensureSky(bounds);
    for (const gl of gulls) {
      gl.a += gl.speed * dt;
      gl.flap += dt * (5 + Math.sin(gl.a * 3) * 1.5);
    }
    for (const c of clouds) {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.x - c.r > bounds.x + bounds.w) {
        c.x = bounds.x - c.r;
        c.y = bounds.y + Math.random() * bounds.h;
      }
      if (c.y + c.r < bounds.y) c.y = bounds.y + bounds.h + c.r * 0.5;
    }
  }

  function drawCloudShadows(g) {
    if (!shadowBlob) return;
    g.globalAlpha = 0.075;
    for (const c of clouds) {
      g.drawImage(shadowBlob, c.x - c.r, c.y - c.r * 0.5, c.r * 2, c.r);
      g.drawImage(shadowBlob, c.x - c.r * 0.2, c.y - c.r * 0.55, c.r * 1.3, c.r * 0.7);
    }
    g.globalAlpha = 1;
  }

  function drawGulls(g, bounds) {
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    for (const gl of gulls) {
      const x = cx + Math.cos(gl.a) * bounds.w * gl.k;
      const y = cy + Math.sin(gl.a) * bounds.h * gl.k * 0.8 - gl.alt;
      const wing = Math.sin(gl.flap) * 3.2;
      // soft shadow far below on the water/ground
      g.fillStyle = 'rgba(20, 50, 50, 0.12)';
      g.beginPath();
      g.ellipse(x + 10, y + gl.alt * 0.9, 4, 1.6, 0, 0, TAU);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.8;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(x - 7, y - wing);
      g.quadraticCurveTo(x - 3.5, y - 2.5 - wing * 0.4, x, y);
      g.quadraticCurveTo(x + 3.5, y - 2.5 - wing * 0.4, x + 7, y - wing);
      g.stroke();
      g.strokeStyle = 'rgba(60, 70, 80, 0.7)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x - 7, y - wing);
      g.lineTo(x - 5.6, y - wing * 0.85 - 0.4);
      g.moveTo(x + 7, y - wing);
      g.lineTo(x + 5.6, y - wing * 0.85 - 0.4);
      g.stroke();
    }
  }

  function reset() {
    walkers.length = 0;
    pass = null;
  }

  return {
    walkers,
    update(dt, state, bounds) {
      updateWalkers(dt, state);
      updateSky(dt, bounds);
    },
    /** Visible walkers with their depth key (comparable with object depth x + y). */
    visibleWalkers() {
      const out = [];
      for (const w of walkers) if (!w.inside) out.push(w);
      out.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
      return out;
    },
    depthOf: (w) => w.gx + w.gy - 1,
    drawWalker,
    drawCloudShadows,
    drawGulls,
    reset,
  };
}

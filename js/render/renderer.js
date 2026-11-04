/**
 * Map renderer (canvas 2D): sea, baked island, depth-sorted objects, ghost,
 * selection, particles. Owns the camera; input.js drives it.
 * Reads game.state and ui.state every frame — never mutates the game.
 */
import { BUILDINGS } from '../config.js';
import { N, idx, inBounds } from '../core/map.js';
import { hash2 } from '../core/rng.js';
import { canPlace } from '../core/actions.js';
import { auraOf, auraTargetsAt, buildingAt } from '../core/economy.js';
import { getRates } from '../core/sim.js';
import { HH, HW, LIP, groundCode, groundZ, tileCenter, toGrid } from './iso.js';
import { bakeTerrain, coastSegments, groundKey, islandBounds } from './terrain.js';
import { BAKERY_CHIMNEY, buildingHeight, drawBuilding, drawBuildingDynamic, drawRock, drawTree, hutChimney, tierOf } from './art.js';
import { createFx } from './fx.js';

/** Portrait phones: extra zoom over a whole-island fit, and where the island centre sits (0 = top, 1 = bottom of the free area). */
const PORTRAIT_ZOOM = 1.38;
const PORTRAIT_LIFT = 0.45;
import { createLife } from './life.js';
import { iconDataUrl } from '../ui/icons.js';

const TAU = Math.PI * 2;
const TREE_VARIANTS = 6;
const ROCK_VARIANTS = 4;
const BOX_BUILDING = { x0: -58, y0: -104, w: 116, h: 134 };
const BOX_TREE = { x0: -36, y0: -66, w: 72, h: 80 };
const BOX_ROCK = { x0: -30, y0: -34, w: 60, h: 46 };

const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function createRenderer({ canvas, game, ui, bus }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const view = { w: 1, h: 1, dpr: 1 };
  const cam = { x: 0, y: 0, zoom: 1, min: 0.3, max: 3, fit: 1, vx: 0, vy: 0, anim: null };
  const fx = createFx();

  let state = null;
  let rev = -1;
  let tilesKey = '';
  let bounds = { x: 0, y: 0, w: 1, h: 1 };
  let terrain = null;
  let terrainWanted = 0;
  let spriteScale = 1;
  let lastZoomChange = 0;
  let fitted = false;
  let userMoved = false;
  const sprites = new Map();
  const objects = [];
  const appear = new Map();     // building id → time it appeared
  const bounce = new Map();     // building id → time it was upgraded
  const smokeAt = new Map();    // building id → next smoke time
  const yieldAt = new Map();    // building id → next floating "+N"
  let placeCache = { key: '', tiles: [] };
  let waves = [];
  let seaGrad = null;
  let seaGradH = 0;
  let glow = null;
  let time = 0;
  let bg = null;          // cached static layer: sea + glow + baked island (screen-sized)
  let bgCtx = null;
  let bgKey = '';
  let terrainVersion = 0;
  const life = createLife();
  let hover = null; // tile under the mouse (desktop), when it holds something clickable
  let coast = [];
  let sparkles = [];
  const statuses = [];
  let lastFloat = -1;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const statusIcons = {};
  const STATUS_STYLE = {
    staff: { icon: 'worker', color: '#c0392b' },
    full: { icon: 'box', color: '#b86a00' },
    hungry: { icon: 'food', color: '#c0392b' },
  };
  for (const [kind, st] of Object.entries(STATUS_STYLE)) {
    const img = new Image();
    img.src = iconDataUrl(st.icon, 48, st.color);
    statusIcons[kind] = img;
  }

  /* ------------------------------------------------------- setup */

  function makeGlow() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(150, 240, 228, 0.75)');
    grad.addColorStop(0.45, 'rgba(110, 222, 214, 0.35)');
    grad.addColorStop(1, 'rgba(90, 200, 205, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return c;
  }
  glow = makeGlow();

  // Resource icons for floating texts (decoded SVG data URLs — no network).
  for (const name of ['wood', 'stone', 'food', 'coins']) {
    const img = new Image();
    img.decoding = 'async';
    img.src = iconDataUrl(name, 64);
    img.decode?.().then(() => fx.setIcon(name, img)).catch(() => fx.setIcon(name, img));
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    view.w = Math.max(1, r.width);
    view.h = Math.max(1, r.height);
    // DPR capped at 2 and at ~3 Mpx of canvas (huge hi-DPI desktop windows stay smooth)
    view.dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3e6 / (view.w * view.h)));
    canvas.width = Math.max(1, Math.round(view.w * view.dpr));
    canvas.height = Math.max(1, Math.round(view.h * view.dpr));
    seaGrad = null;
    computeLimits();
    if (!fitted || !userMoved) fitCamera();
    else clampCam();
    requestSpriteScale(true);
  }

  function safeRect() {
    const s = ui.safeArea?.() ?? { top: 0, bottom: view.h, left: 0, right: view.w };
    return {
      top: Math.max(0, s.top),
      bottom: Math.min(view.h, s.bottom),
      left: Math.max(0, s.left),
      right: Math.min(view.w, s.right),
    };
  }

  function computeLimits() {
    const s = safeRect();
    const sw = Math.max(80, s.right - s.left);
    const sh = Math.max(80, s.bottom - s.top);
    const core = islandBounds(state?.tiles ?? game.state.tiles, 8);
    const whole = Math.min(sw / core.w, sh / core.h) * 0.97;
    // Tall phone screens: the iso diamond is twice as wide as it is tall, so a
    // width-fit leaves a lot of empty sea above and below. Zoom in and let the
    // (mostly beach) left/right tips run off-screen — the player can pan there.
    const tall = sh > sw * 1.15;
    cam.fit = tall ? Math.min(whole * PORTRAIT_ZOOM, (sh / core.h) * 0.92) : whole;
    cam.min = Math.min(cam.fit, whole) * 0.85;
    cam.max = Math.max(cam.fit * 3.2, 1.6);
    cam.zoom = Math.min(cam.max, Math.max(cam.min, cam.zoom));
  }

  function fitCamera() {
    const s = safeRect();
    const core = islandBounds(state?.tiles ?? game.state.tiles, 8);
    cam.zoom = cam.fit;
    const cx = core.x + core.w / 2;
    const cy = core.y + core.h / 2;
    cam.x = cx - ((s.left + s.right) / 2 - view.w / 2) / cam.zoom;
    // on tall screens sit the island a little above the middle (the build bar is heavy)
    const tall = s.bottom - s.top > (s.right - s.left) * 1.15;
    const ty = tall ? s.top + (s.bottom - s.top) * PORTRAIT_LIFT : (s.top + s.bottom) / 2;
    cam.y = cy - (ty - view.h / 2) / cam.zoom;
    fitted = true;
    clampCam();
  }

  function clampCam() {
    const m = 40;
    cam.x = Math.min(bounds.x + bounds.w - m, Math.max(bounds.x + m, cam.x));
    cam.y = Math.min(bounds.y + bounds.h - m, Math.max(bounds.y + m, cam.y));
  }

  /* ------------------------------------------------------ camera API */

  const worldToScreen = (wx, wy) => [(wx - cam.x) * cam.zoom + view.w / 2, (wy - cam.y) * cam.zoom + view.h / 2];
  const screenToWorld = (sx, sy) => [(sx - view.w / 2) / cam.zoom + cam.x, (sy - view.h / 2) / cam.zoom + cam.y];

  function panBy(dx, dy) {
    cam.anim = null;
    userMoved = true;
    cam.x -= dx / cam.zoom;
    cam.y -= dy / cam.zoom;
    clampCam();
  }

  function zoomAt(sx, sy, factor) {
    cam.anim = null;
    userMoved = true;
    const [wx, wy] = screenToWorld(sx, sy);
    const next = Math.min(cam.max, Math.max(cam.min, cam.zoom * factor));
    if (next === cam.zoom) return;
    cam.zoom = next;
    cam.x = wx - (sx - view.w / 2) / cam.zoom;
    cam.y = wy - (sy - view.h / 2) / cam.zoom;
    clampCam();
    lastZoomChange = performance.now();
  }

  function fling(vx, vy) {
    cam.vx = -vx / cam.zoom;
    cam.vy = -vy / cam.zoom;
  }

  function stopFling() {
    cam.vx = 0;
    cam.vy = 0;
  }

  /** Smoothly moves the camera so tile (x, y) sits inside the visible area. */
  function ensureVisible(x, y, { force = false, lift = 30 } = {}) {
    if (!state) return;
    const c = tileCenter(x, y);
    const wy = c.y - groundZ(state.tiles, x, y) - lift;
    const [sx, sy] = worldToScreen(c.x, wy);
    const s = safeRect();
    const pad = 36;
    const inside = sx > s.left + pad && sx < s.right - pad && sy > s.top + pad && sy < s.bottom - pad;
    if (inside && !force) return;
    const tx = (s.left + s.right) / 2;
    const ty = (s.top + s.bottom) / 2;
    const nx = c.x - (tx - view.w / 2) / cam.zoom;
    const ny = wy - (ty - view.h / 2) / cam.zoom;
    cam.anim = { x0: cam.x, y0: cam.y, x1: nx, y1: ny, t: 0, dur: 0.45 };
    stopFling();
  }

  /** Smooth zoom centred on a tile (inside the visible area). */
  function zoomTo(x, y, zoom) {
    if (!state) return;
    const c = tileCenter(x, y);
    const wy = c.y - groundZ(state.tiles, x, y) - 20;
    const s = safeRect();
    const tx = (s.left + s.right) / 2;
    const ty = (s.top + s.bottom) / 2;
    const nx = c.x - (tx - view.w / 2) / zoom;
    const ny = wy - (ty - view.h / 2) / zoom;
    cam.anim = { x0: cam.x, y0: cam.y, x1: nx, y1: ny, z0: cam.zoom, z1: zoom, t: 0, dur: 0.5 };
    stopFling();
  }

  function recenter() {
    computeLimits();
    const from = { x: cam.x, y: cam.y, z: cam.zoom };
    fitCamera();
    const to = { x: cam.x, y: cam.y, z: cam.zoom };
    cam.x = from.x;
    cam.y = from.y;
    cam.zoom = from.z;
    cam.anim = { x0: from.x, y0: from.y, x1: to.x, y1: to.y, z0: from.z, z1: to.z, t: 0, dur: 0.5 };
  }

  /* --------------------------------------------------------- sprites */

  /** Sprite resolution for a zoom level (exact, so blits are close to 1:1). */
  const scaleFor = (zoom) => Math.min(3.5, Math.max(0.4, Math.round(zoom * view.dpr * 20) / 20));

  function requestSpriteScale(now = false) {
    const target = scaleFor(cam.zoom);
    if (target === spriteScale && terrain) return;
    if (now) applySpriteScale(target);
    else terrainWanted = target;
  }

  function applySpriteScale(scale) {
    if (scale !== spriteScale) {
      for (const k of sprites.keys()) {
        if (!k.endsWith(`@${spriteScale}`) && !k.endsWith(`@${scale}`)) sprites.delete(k);
      }
    }
    spriteScale = scale;
    terrainWanted = 0;
    rebakeTerrain();
  }

  function rebakeTerrain() {
    if (!state) return;
    const scale = Math.min(spriteScale, 3);
    terrain = bakeTerrain(state.tiles, scale, state.seed);
    terrainVersion++;
  }

  function sprite(key, box, draw) {
    const k = `${key}@${spriteScale}`;
    let sp = sprites.get(k);
    if (!sp) {
      const c = document.createElement('canvas');
      c.width = Math.ceil(box.w * spriteScale);
      c.height = Math.ceil(box.h * spriteScale);
      const g = c.getContext('2d');
      g.scale(spriteScale, spriteScale);
      g.translate(-box.x0, -box.y0);
      g.lineJoin = 'round';
      draw(g);
      sp = { canvas: c, box };
      sprites.set(k, sp);
    }
    return sp;
  }

  function buildingSprite(type, tier) {
    return sprite(`b:${type}:${tier}`, BOX_BUILDING, (g) => drawBuilding(g, type, tier));
  }

  function treeSprite(v, onSand) {
    return sprite(`t:${v}:${onSand ? 1 : 0}`, BOX_TREE, (g) => drawTree(g, (v + 0.5) / TREE_VARIANTS, onSand));
  }

  function rockSprite(v) {
    return sprite(`r:${v}`, BOX_ROCK, (g) => drawRock(g, (v + 0.5) / ROCK_VARIANTS));
  }

  function blit(sp, wx, wy) {
    const b = sp.box;
    ctx.drawImage(sp.canvas, wx + b.x0, wy + b.y0, b.w, b.h);
  }

  /* --------------------------------------------------------- objects */

  function syncState() {
    const s = game.state;
    if (s !== state) {
      state = s;
      rev = -1;
      tilesKey = '';
      appear.clear();
      bounce.clear();
      smokeAt.clear();
      yieldAt.clear();
      fx.clear();
      life.reset();
      fitted = false;
      userMoved = false;
    }
    if (s.rev !== rev) {
      rev = s.rev;
      const key = groundKey(s.tiles);
      if (key !== tilesKey) {
        tilesKey = key;
        bounds = islandBounds(s.tiles, 120);
        coast = coastSegments(s.tiles);
        makeWaves();
        if (view.w > 1) {
          computeLimits();
          if (!fitted) fitCamera();
        }
        rebakeTerrain();
      }
      rebuildObjects();
    }
  }

  function rebuildObjects() {
    objects.length = 0;
    for (const b of state.buildings) objects.push({ kind: 'b', b, x: b.x, y: b.y, d: b.x + b.y + b.x * 0.001 });
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const c = state.tiles[idx(x, y)];
        if (c === 't') objects.push({ kind: 't', x, y, d: x + y + x * 0.001, v: Math.floor(hash2(x, y, state.seed) * TREE_VARIANTS), sand: groundCode(state.tiles, x, y) === 's' });
        else if (c === 'r') objects.push({ kind: 'r', x, y, d: x + y + x * 0.001, v: Math.floor(hash2(x, y, state.seed + 5) * ROCK_VARIANTS) });
      }
    }
    objects.sort((a, b) => a.d - b.d);
  }

  function makeWaves() {
    waves = [];
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    for (let i = 0; i < 54; i++) {
      const a = hash2(i, 3, 77) * TAU;
      const r = 0.42 + hash2(i, 9, 77) * 0.9;
      const wx = cx + Math.cos(a) * bounds.w * r * 0.62;
      const wy = cy + Math.sin(a) * bounds.h * r * 0.66;
      // keep waves off the island (they are drawn above the cached terrain)
      let onLand = false;
      for (const [dx, dy] of [[0, 0], [24, 0], [-24, 0], [0, 14], [0, -14]]) {
        const { gx, gy } = toGrid(wx + dx, wy + dy, -14);
        const tx = Math.floor(gx), ty = Math.floor(gy);
        if (inBounds(tx, ty) && groundCode(state.tiles, tx, ty) !== 'w') onLand = true;
        const g2 = toGrid(wx + dx, wy + dy, 0);
        const ux = Math.floor(g2.gx), uy = Math.floor(g2.gy);
        if (inBounds(ux, uy) && groundCode(state.tiles, ux, uy) !== 'w') onLand = true;
      }
      if (onLand) continue;
      waves.push({ x: wx, y: wy, p: hash2(i, 1, 77) * TAU, s: 0.7 + hash2(i, 5, 77) * 0.6 });
    }
    // twinkles of sunlight on the water, kept off the island like the waves
    sparkles = waves.filter((_, i) => i % 2 === 0).map((w, i) => ({ x: w.x + 30 * Math.cos(i), y: w.y + 18 * Math.sin(i * 1.7), p: hash2(i, 2, 91) * TAU }));
  }

  /* --------------------------------------------------------- picking */

  function groundTileAt(wx, wy) {
    for (const z of [LIP, 0]) {
      const { gx, gy } = toGrid(wx, wy, z);
      const x = Math.floor(gx), y = Math.floor(gy);
      if (inBounds(x, y) && groundZ(state.tiles, x, y) === z) return { x, y };
    }
    const { gx, gy } = toGrid(wx, wy, 0);
    return { x: Math.floor(gx), y: Math.floor(gy) };
  }

  /** Tile under a screen point; objects (buildings, trees) win over the ground. */
  function pick(sx, sy, { groundOnly = false } = {}) {
    if (!state) return null;
    const [wx, wy] = screenToWorld(sx, sy);
    if (!groundOnly) {
      for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        const c = tileCenter(o.x, o.y);
        const base = c.y - groundZ(state.tiles, o.x, o.y);
        const h = o.kind === 'b' ? buildingHeight(o.b.type, tierOf(o.b.level)) : o.kind === 't' ? 42 : 22;
        const halfW = o.kind === 'b' ? 27 : 18;
        if (Math.abs(wx - c.x) <= halfW && wy <= base + 12 && wy >= base - h) return { x: o.x, y: o.y };
      }
    }
    return groundTileAt(wx, wy);
  }

  /* ------------------------------------------------------- thumbnails */

  /** Building thumbnail as a <canvas> (for cards and the details panel). */
  function thumb(type, level = 1, where = 'card') {
    const size = where === 'panel' ? [66, 66] : where === 'place' ? [56, 56] : [56, 50];
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (where === 'panel' ? 1.5 : 1.25);
    const c = document.createElement('canvas');
    c.width = Math.round(size[0] * dpr);
    c.height = Math.round(size[1] * dpr);
    c.style.width = `${size[0]}px`;
    c.style.height = `${size[1]}px`;
    const g = c.getContext('2d');
    const tier = tierOf(level);
    const h = buildingHeight(type, tier);
    const wide = type === 'field' || type === 'warehouse' || type === 'sawmill' || type === 'fisher' || type === 'fountain' || type === 'mill';
    const crop = { x0: wide ? -38 : -32, y0: -(h + 6), w: wide ? 76 : 64, h: h + 6 + (type === 'field' ? 22 : 18) };
    const k = Math.min(c.width / crop.w, c.height / crop.h);
    g.translate(c.width / 2, (c.height - crop.h * k) / 2 - crop.y0 * k);
    g.scale(k, k);
    g.lineJoin = 'round';
    drawBuilding(g, type, tier);
    drawBuildingDynamic(g, type, tier, 0.6, 0);
    return c;
  }

  /* ------------------------------------------------------------ events */

  bus.on('built', (e) => {
    appear.set(e.id, time);
    if (!state) return;
    const c = tileCenter(e.x, e.y);
    const z = groundZ(state.tiles, e.x, e.y);
    fx.burst('dust', c.x, c.y - z, 12, { speed: 34, r: 7, grow: 9, life: 0.8, alpha: 0.75, drag: 3, flat: 0.5 });
    fx.spawn('ring', c.x, c.y - z, { r: 18, grow: 26, life: 0.55, color: 'rgba(255,255,255,0.9)' });
  });
  bus.on('upgraded', (e) => {
    bounce.set(e.id, time);
    if (!state) return;
    const c = tileCenter(e.x, e.y);
    const z = groundZ(state.tiles, e.x, e.y);
    fx.burst('spark', c.x, c.y - z - 26, 12, { speed: 46, r: 3.4, life: 0.9, ay: 40, flat: 1, color: '#ffd45c', spin: 6 });
    fx.spawn('ring', c.x, c.y - z, { r: 20, grow: 30, life: 0.7, color: 'rgba(255, 214, 92, 0.95)' });
  });
  bus.on('demolished', (e) => {
    if (!state) return;
    const c = tileCenter(e.x, e.y);
    const z = groundZ(state.tiles, e.x, e.y);
    fx.burst('dust', c.x, c.y - z - 8, 18, { speed: 42, r: 9, grow: 12, life: 1.1, alpha: 0.85, drag: 2.5, flat: 0.7 });
    fx.burst('chip', c.x, c.y - z - 12, 10, { speed: 60, r: 2.4, life: 0.9, ay: 160, flat: 1, color: '#a96f3d', spin: 8, vy: -50 });
    let i = 0;
    for (const [k, v] of Object.entries(e.refund || {})) fx.text(c.x, c.y - z - 30, `+${Math.floor(v)}`, { icon: k, delay: i++ * 0.15 });
  });
  bus.on('cleared', (e) => {
    if (!state) return;
    const c = tileCenter(e.x, e.y);
    const z = groundZ(state.tiles, e.x, e.y);
    if (e.kind === 't') {
      fx.burst('leaf', c.x, c.y - z - 26, 14, { speed: 50, r: 3, life: 1.2, ay: 70, flat: 1, color: '#5daa4f', spin: 5, vy: -30 });
      fx.burst('dust', c.x, c.y - z, 6, { speed: 20, r: 6, grow: 6, life: 0.7, alpha: 0.6, drag: 3 });
    } else {
      fx.burst('chip', c.x, c.y - z - 10, 12, { speed: 55, r: 2.6, life: 0.9, ay: 170, flat: 1, color: '#a9b4be', spin: 7, vy: -45 });
      fx.burst('dust', c.x, c.y - z, 8, { speed: 24, r: 7, grow: 7, life: 0.8, alpha: 0.7, drag: 3 });
    }
    for (const [k, v] of Object.entries(e.gained || {})) fx.text(c.x, c.y - z - 34, `+${Math.floor(v)}`, { icon: k });
  });
  bus.on('ui:select', (target) => {
    if (!target || !state) return;
    if (target.kind === 'building') {
      const b = state.buildings.find((o) => o.id === target.id);
      if (b) setTimeout(() => ensureVisible(b.x, b.y), 30);
    } else {
      setTimeout(() => ensureVisible(target.x, target.y), 30);
    }
  });
  bus.on('ui:mode', (u) => {
    if (u.mode !== 'place' || !u.ghost) return;
    const comfy = 44 / (HW * 2); // zoom at which a tile is ~44 px wide (comfortable for fingers)
    if (cam.zoom < comfy * 0.98) setTimeout(() => zoomTo(u.ghost.x, u.ghost.y, Math.min(cam.max, comfy)), 30);
    else setTimeout(() => ensureVisible(u.ghost.x, u.ghost.y), 30);
  });

  /* ------------------------------------------------------------ update */

  function update(dt, now) {
    time += dt;
    syncState();

    if (cam.anim) {
      const a = cam.anim;
      a.t += dt / a.dur;
      const k = easeInOut(Math.min(1, a.t));
      cam.x = a.x0 + (a.x1 - a.x0) * k;
      cam.y = a.y0 + (a.y1 - a.y0) * k;
      if (a.z0 != null) {
        cam.zoom = a.z0 + (a.z1 - a.z0) * k;
        lastZoomChange = now;
      }
      if (a.t >= 1) cam.anim = null;
      clampCam();
    } else if (cam.vx || cam.vy) {
      cam.x += cam.vx * dt;
      cam.y += cam.vy * dt;
      const k = Math.exp(-5.5 * dt);
      cam.vx *= k;
      cam.vy *= k;
      if (Math.hypot(cam.vx, cam.vy) * cam.zoom < 8) stopFling();
      clampCam();
    }

    // re-render sprites at the new zoom once zooming has settled
    if (now - lastZoomChange > 220) {
      const target = scaleFor(cam.zoom);
      if (target !== spriteScale) applySpriteScale(target);
    }

    emitAmbient(dt);
    life.update(dt, state, bounds);
    fx.update(dt);
  }

  /** Chimney smoke and periodic "+N" yields from producing buildings. */
  let ambientRates = null;
  let ambientRatesAt = -1;
  function emitAmbient(dt) {
    if (!state) return;
    if (!ambientRates || time - ambientRatesAt > 0.5 || ambientRates.__rev !== state.rev) {
      ambientRates = getRates(state);
      ambientRates.__rev = state.rev;
      ambientRatesAt = time;
    }
    const rates = ambientRates;
    if (time - (emitAmbient.statusAt ?? -9) > 0.5) {
      emitAmbient.statusAt = time;
      refreshStatuses(rates);
    }
    for (const o of objects) {
      if (o.kind !== 'b') continue;
      const b = o.b;
      const tier = tierOf(b.level);
      const c = tileCenter(b.x, b.y);
      const z = groundZ(state.tiles, b.x, b.y);
      if (b.type === 'hut') {
        const next = smokeAt.get(b.id) ?? time + hash2(b.id, 1) * 0.8;
        if (time >= next) {
          const ch = hutChimney(tier);
          fx.spawn('smoke', c.x + ch.x, c.y - z + ch.y, {
            vx: 5 + Math.random() * 3, vy: -12 - Math.random() * 6, r: 2.6, grow: 6.5, life: 2.4, alpha: 0.55, drag: 0.4,
          });
          smokeAt.set(b.id, time + (reduced ? 1.2 : 0.38) + Math.random() * 0.25);
        }
        continue;
      }
      if (b.type === 'bakery' && (rates.per.get(b.id)?.workers ?? 0) > 0) {
        const next = smokeAt.get(b.id) ?? time + hash2(b.id, 1) * 0.8;
        if (time >= next) {
          fx.spawn('smoke', c.x + BAKERY_CHIMNEY.x, c.y - z + BAKERY_CHIMNEY.y, {
            vx: 4 + Math.random() * 3, vy: -12 - Math.random() * 6, r: 2.8, grow: 7, life: 2.6, alpha: 0.6, drag: 0.4,
          });
          smokeAt.set(b.id, time + (reduced ? 1.2 : 0.42) + Math.random() * 0.25);
        }
      }
      const def = BUILDINGS[b.type];
      if (!def.produce) continue;
      const p = rates.per.get(b.id);
      if (!p || p.workers === 0) continue;
      const period = 6;
      const next = yieldAt.get(b.id) ?? time + 2 + hash2(b.id, 7) * period;
      if (time >= next) {
        yieldAt.set(b.id, time + period);
        // only for buildings on screen, and never more than ~3 labels per second
        const [vx, vy] = worldToScreen(c.x, c.y - z);
        if (vx < -20 || vy < 0 || vx > view.w + 20 || vy > view.h + 20) continue;
        if (time - lastFloat < 0.3) { yieldAt.set(b.id, time + 0.6 + Math.random()); continue; }
        lastFloat = time;
        for (const [res, rate] of Object.entries(p.rate)) {
          const amount = rate * (res === 'food' ? 1 : rates.mult) * period;
          if (amount < 1) continue;
          fx.text(c.x, c.y - z - buildingHeight(b.type, tier) + 4, `+${Math.floor(amount)}`, { icon: res, life: 1.6, size: 14 });
        }
        if (b.type === 'quarry') fx.burst('dust', c.x - 8, c.y - z - 6, 4, { speed: 14, r: 4, grow: 5, life: 0.9, alpha: 0.55, drag: 2 });
      }
    }
  }

  /** Status bubbles: no workers, storage full, hungry homes. */
  function refreshStatuses(rates) {
    statuses.length = 0;
    let hungryHuts = 0;
    for (const o of objects) {
      if (o.kind !== 'b') continue;
      const b = o.b;
      const def = BUILDINGS[b.type];
      let kind = null;
      if (def.produce) {
        const p = rates.per.get(b.id);
        if (p && p.workers === 0) kind = 'staff';
        else if (Object.keys(def.produce).every((r) => state.flags.full[r])) kind = 'full';
      } else if (b.type === 'hut' && rates.hungry && hungryHuts < 3) {
        kind = 'hungry';
        hungryHuts++;
      }
      if (kind) statuses.push({ b, kind });
    }
  }

  function drawStatuses(t) {
    const sel = ui.state.selected;
    for (const s of statuses) {
      const b = s.b;
      if (sel && sel.kind === 'building' && sel.id === b.id) continue;
      const c = tileCenter(b.x, b.y);
      const top = c.y - groundZ(state.tiles, b.x, b.y) - buildingHeight(b.type, tierOf(b.level)) - 4;
      const [sx, sy0] = worldToScreen(c.x, top);
      const sy = sy0 - 14 + (reduced ? 0 : Math.sin(t * 2.4 + b.id) * 2);
      const st = STATUS_STYLE[s.kind];
      ctx.beginPath();
      ctx.arc(sx, sy, 12, 0, TAU);
      ctx.moveTo(sx - 4.5, sy + 10);
      ctx.lineTo(sx, sy + 17);
      ctx.lineTo(sx + 4.5, sy + 10);
      ctx.closePath();
      ctx.fillStyle = 'rgba(40, 26, 16, 0.22)';
      ctx.save();
      ctx.translate(0, 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fffaf0';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = st.color;
      ctx.stroke();
      const img = statusIcons[s.kind];
      if (img.complete && img.naturalWidth) ctx.drawImage(img, sx - 8, sy - 8, 16, 16);
    }
  }

  /* -------------------------------------------------------------- draw */

  /** Rebuilds the cached static layer when the camera, size or island changed. */
  function ensureBackground() {
    if (!bg || bg.width !== canvas.width || bg.height !== canvas.height) {
      bg = document.createElement('canvas');
      bg.width = canvas.width;
      bg.height = canvas.height;
      bgCtx = bg.getContext('2d', { alpha: false });
      bgKey = '';
      seaGrad = null;
    }
    const key = `${cam.x.toFixed(2)}|${cam.y.toFixed(2)}|${cam.zoom.toFixed(5)}|${terrainVersion}|${canvas.width}x${canvas.height}`;
    if (key === bgKey) return;
    bgKey = key;
    const g = bgCtx;
    const { w, h, dpr } = view;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!seaGrad || seaGradH !== h) {
      seaGrad = g.createLinearGradient(0, 0, 0, h);
      seaGrad.addColorStop(0, '#2da2b7');
      seaGrad.addColorStop(1, '#1c7f98');
      seaGradH = h;
    }
    g.fillStyle = seaGrad;
    g.fillRect(0, 0, w, h);
    const [gx, gy] = worldToScreen(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
    const r = Math.max(bounds.w, bounds.h) * cam.zoom * 0.78;
    g.globalAlpha = 0.85;
    g.drawImage(glow, gx - r, gy - r, r * 2, r * 2);
    g.globalAlpha = 1;
    if (terrain) {
      const z = cam.zoom;
      g.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - cam.x * z), dpr * (h / 2 - cam.y * z));
      g.drawImage(terrain.canvas, terrain.x, terrain.y, terrain.w, terrain.h);
    }
  }

  function drawWaves(t) {
    if (reduced) t = 0;
    ctx.lineCap = 'round';
    // animated surf along the visible cliffs
    if (coast.length) {
      for (const [off, alpha, dash] of [[3.5 + Math.sin(t * 1.3) * 1.6, 0.6, [9, 6]], [8.5 + Math.sin(t * 1.3 + 1.7) * 2.2, 0.32, [5, 9]]]) {
        ctx.beginPath();
        for (const [ax, ay, bx, by] of coast) {
          ctx.moveTo(ax, ay + off);
          ctx.lineTo(bx, by + off);
        }
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.lineWidth = 1.6;
        ctx.setLineDash(dash);
        ctx.lineDashOffset = -t * 7;
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // sun twinkles
    ctx.fillStyle = '#ffffff';
    for (const sp of sparkles) {
      const a = Math.sin(t * 1.9 + sp.p);
      if (a < 0.6) continue;
      ctx.globalAlpha = (a - 0.6) * 1.6;
      const r = 2.2 * a;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y - r);
      ctx.lineTo(sp.x + r * 0.3, sp.y);
      ctx.lineTo(sp.x, sp.y + r);
      ctx.lineTo(sp.x - r * 0.3, sp.y);
      ctx.closePath();
      ctx.moveTo(sp.x - r, sp.y);
      ctx.lineTo(sp.x, sp.y + r * 0.3);
      ctx.lineTo(sp.x + r, sp.y);
      ctx.lineTo(sp.x, sp.y - r * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#e9fffb';
    ctx.lineWidth = 1.6;
    for (const w of waves) {
      const a = Math.sin(t * 0.7 + w.p);
      if (a <= 0.05) continue;
      ctx.globalAlpha = a * 0.45;
      const x = w.x + Math.sin(t * 0.25 + w.p) * 6;
      const y = w.y;
      const s = 7 * w.s;
      ctx.beginPath();
      ctx.moveTo(x - s, y);
      ctx.quadraticCurveTo(x - s / 2, y + s * 0.45, x, y);
      ctx.quadraticCurveTo(x + s / 2, y + s * 0.45, x + s, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function diamond(x, y, z, inset = 0) {
    const i = inset;
    ctx.beginPath();
    ctx.moveTo((x + i - (y + i)) * HW, (x + i + y + i) * HH - z);
    ctx.lineTo((x + 1 - i - (y + i)) * HW, (x + 1 - i + y + i) * HH - z);
    ctx.lineTo((x + 1 - i - (y + 1 - i)) * HW, (x + 1 - i + y + 1 - i) * HH - z);
    ctx.lineTo((x + i - (y + 1 - i)) * HW, (x + i + y + 1 - i) * HH - z);
    ctx.closePath();
  }

  function placementTiles(type) {
    const key = `${state.rev}:${type}`;
    if (placeCache.key === key && placeCache.state === state) return placeCache.tiles;
    const list = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const r = canPlace(state, type, x, y);
        if (!(r.ok || r.reason === 'cost')) continue;
        // aura buildings (wells) light up where they would help the most neighbours
        const bonus = (r.bonus || 0) + (BUILDINGS[type].aura ? auraTargetsAt(state, type, x, y) * auraOf(type, 1) : 0);
        list.push({ x, y, bonus });
      }
    }
    placeCache = { key, state, tiles: list };
    return list;
  }

  function drawPlacement(t) {
    const type = ui.state.placing;
    const tiles = placementTiles(type);
    for (const p of tiles) {
      const z = groundZ(state.tiles, p.x, p.y);
      diamond(p.x, p.y, z, 0.07);
      ctx.fillStyle = p.bonus > 0 ? `rgba(150, 255, 150, ${0.16 + Math.min(0.3, p.bonus * 0.35)})` : 'rgba(255, 255, 255, 0.16)';
      ctx.fill();
    }
    const g = ui.state.ghost;
    if (!g || !inBounds(g.x, g.y)) return;
    const ok = canPlace(state, type, g.x, g.y).ok;
    const z = groundZ(state.tiles, g.x, g.y);
    diamond(g.x, g.y, z, 0.02);
    ctx.fillStyle = ok ? 'rgba(70, 210, 130, 0.45)' : 'rgba(235, 80, 60, 0.45)';
    ctx.fill();
    ctx.lineWidth = 2.2 / Math.max(0.6, cam.zoom);
    ctx.strokeStyle = ok ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 220, 210, 0.95)';
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -t * 20;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawGhost(t) {
    const g = ui.state.ghost;
    if (!g || !inBounds(g.x, g.y)) return;
    const type = ui.state.placing;
    const check = canPlace(state, type, g.x, g.y);
    const c = tileCenter(g.x, g.y);
    const z = groundZ(state.tiles, g.x, g.y);
    const bob = Math.sin(t * 4) * 1.6 - 3;
    ctx.globalAlpha = check.ok ? 0.88 : 0.45;
    blit(buildingSprite(type, 1), c.x, c.y - z + bob);
    drawBuildingDynamicAt(type, 1, c.x, c.y - z + bob, t, 0);
    ctx.globalAlpha = 1;
  }

  function drawGhostLabel() {
    const g = ui.state.ghost;
    if (!g || !inBounds(g.x, g.y)) return;
    const type = ui.state.placing;
    const check = canPlace(state, type, g.x, g.y);
    const bonus = check.bonus || 0;
    const auraN = BUILDINGS[type].aura ? auraTargetsAt(state, type, g.x, g.y) : 0;
    if (!(check.ok && (bonus > 0 || auraN > 0))) return;
    const c = tileCenter(g.x, g.y);
    const z = groundZ(state.tiles, g.x, g.y);
    const [sx, sy] = worldToScreen(c.x, c.y - z - buildingHeight(type, 1) - 10);
    const label = auraN > 0 ? `+${Math.round(auraOf(type, 1) * 100)}% ×${auraN}` : `+${Math.round(bonus * 100)}%`;
    ctx.font = '900 13px ui-rounded, "SF Pro Rounded", Nunito, Inter, system-ui, sans-serif';
    const w = ctx.measureText(label).width + 20;
    const h = 22;
    ctx.fillStyle = 'rgba(28, 110, 70, 0.92)';
    roundRect(sx - w / 2, sy - h / 2, w, h, 11);
    ctx.fill();
    ctx.fillStyle = '#eafff2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, sx, sy + 0.5);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function selectedTile() {
    const sel = ui.state.selected;
    if (!sel) return null;
    if (sel.kind === 'building') {
      const b = state.buildings.find((o) => o.id === sel.id);
      return b ? { x: b.x, y: b.y } : null;
    }
    return { x: sel.x, y: sel.y };
  }

  function drawSelection(t) {
    if (hover && !(ui.state.selected && selectedTile()?.x === hover.x && selectedTile()?.y === hover.y)) {
      diamond(hover.x, hover.y, groundZ(state.tiles, hover.x, hover.y), 0.01);
      ctx.lineWidth = 2 / Math.max(0.6, cam.zoom);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fill();
    }
    const s = selectedTile();
    if (!s) return;
    const z = groundZ(state.tiles, s.x, s.y);
    const pulse = 0.5 + Math.sin(t * 5) * 0.5;
    diamond(s.x, s.y, z, -0.02);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.12 + pulse * 0.1})`;
    ctx.fill();
    ctx.lineWidth = (2.4 + pulse * 1.2) / Math.max(0.6, cam.zoom);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.stroke();
  }

  function drawBuildingDynamicAt(type, tier, x, y, t, phase) {
    if (type === 'hut') return;
    ctx.save();
    ctx.translate(x, y);
    drawBuildingDynamic(ctx, type, tier, t, phase);
    ctx.restore();
  }

  function drawObjects(t) {
    const sel = ui.state.selected;
    const walkers = life.visibleWalkers();
    let wi = 0;
    for (const o of objects) {
      while (wi < walkers.length && life.depthOf(walkers[wi]) < o.d) life.drawWalker(ctx, walkers[wi++], state);
      const c = tileCenter(o.x, o.y);
      const z = groundZ(state.tiles, o.x, o.y);
      const bx = c.x, by = c.y - z;
      if (o.kind === 't') {
        const sp = treeSprite(o.v, o.sand);
        const sway = reduced ? 0 : Math.sin(t * 1.1 + o.x * 1.7 + o.y) * 0.025;
        ctx.save();
        ctx.translate(bx, by);
        ctx.transform(1, 0, sway, 1, 0, 0);
        blit(sp, 0, 0);
        ctx.restore();
        continue;
      }
      if (o.kind === 'r') {
        blit(rockSprite(o.v), bx, by);
        continue;
      }
      const b = o.b;
      const tier = tierOf(b.level);
      const sp = buildingSprite(b.type, tier);
      let sx = 1, sy = 1;
      const a = appear.get(b.id);
      if (a != null) {
        // grows out of the ground with a little overshoot
        const k = Math.min(1, (time - a) / 0.55);
        const e = easeOutBack(k);
        sx = 0.8 + 0.2 * Math.min(1.1, e);
        sy = Math.max(0.01, e);
        if (k >= 1) appear.delete(b.id);
      }
      const u = bounce.get(b.id);
      if (u != null) {
        const k = Math.min(1, (time - u) / 0.6);
        const w = Math.sin(k * Math.PI * 3) * (1 - k) * 0.12;
        sx *= 1 + w;
        sy *= 1 - w;
        if (k >= 1) bounce.delete(b.id);
      }
      const lift = sel && sel.kind === 'building' && sel.id === b.id ? -2 - Math.sin(t * 5) * 1 : 0;
      if (sx !== 1 || sy !== 1 || lift) {
        ctx.save();
        ctx.translate(bx, by + lift);
        ctx.scale(sx, sy);
        blit(sp, 0, 0);
        drawBuildingDynamic(ctx, b.type, tier, t, b.id * 0.7);
        ctx.restore();
      } else {
        blit(sp, bx, by);
        drawBuildingDynamicAt(b.type, tier, bx, by, t, b.id * 0.7);
      }
    }
    while (wi < walkers.length) life.drawWalker(ctx, walkers[wi++], state);
  }

  function draw(now) {
    if (!state) return;
    const t = time;
    const { w, h, dpr } = view;
    const prof = globalThis.__prof;
    let t0 = prof ? performance.now() : 0;
    const mark = (name) => {
      if (!prof) return;
      const t1 = performance.now();
      prof[name] = (prof[name] || 0) + (t1 - t0);
      t0 = t1;
    };
    ensureBackground();
    mark('bgBuild');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    mark('bgBlit');
    const z = cam.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - cam.x * z), dpr * (h / 2 - cam.y * z));
    drawWaves(t);
    mark('waves');
    const placing = ui.state.mode === 'place';
    if (placing) drawPlacement(t);
    else drawSelection(t);
    drawObjects(t);
    mark('objects');
    if (placing) drawGhost(t);
    life.drawCloudShadows(ctx);
    if (!reduced) life.drawGulls(ctx, bounds);
    fx.drawWorld(ctx);
    mark('fxWorld');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!placing) {
      drawStatuses(t);
      drawSelectionMarker(t);
    }
    fx.drawScreen(ctx, worldToScreen);
    if (placing) drawGhostLabel();
    mark('fxScreen');
    if (prof) prof.frames = (prof.frames || 0) + 1;
  }

  /** Bobbing chevron above the selected object (constant screen size). */
  function drawSelectionMarker(t) {
    const s = selectedTile();
    if (!s) return;
    const sel = ui.state.selected;
    let h = 36;
    if (sel.kind === 'building') {
      const b = state.buildings.find((o) => o.id === sel.id);
      if (b) h = buildingHeight(b.type, tierOf(b.level));
    } else {
      h = state.tiles[idx(s.x, s.y)] === 't' ? 40 : 22;
    }
    const c = tileCenter(s.x, s.y);
    const [sx, sy0] = worldToScreen(c.x, c.y - groundZ(state.tiles, s.x, s.y) - h);
    const sy = sy0 - 12 - Math.abs(Math.sin(t * 3.2)) * 7;
    ctx.beginPath();
    ctx.moveTo(sx - 9, sy - 9);
    ctx.lineTo(sx + 9, sy - 9);
    ctx.lineTo(sx, sy + 2);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(40, 26, 16, 0.55)';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  /* -------------------------------------------------------------- loop */

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));
  syncState();
  resize();

  game.onFrame((dt, now) => {
    update(dt, now);
    draw(now);
  });

  return {
    cam,
    fx,
    pick,
    panBy,
    zoomAt,
    fling,
    stopFling,
    ensureVisible,
    recenter,
    thumb,
    resize,
    worldToScreen,
    screenToWorld,
    /** Desktop hover feedback: outline + pointer cursor over clickable things. */
    setHover(tile) {
      let next = null;
      if (tile && state && inBounds(tile.x, tile.y)) {
        const c = state.tiles[idx(tile.x, tile.y)];
        if (c === 't' || c === 'r' || buildingAt(state, tile.x, tile.y)) next = tile;
      }
      if (next?.x === hover?.x && next?.y === hover?.y) return;
      hover = next;
      canvas.style.cursor = hover ? 'pointer' : '';
    },
    /** Screen position (CSS px) of a tile centre at ground level. */
    tileToScreen(x, y) {
      const c = tileCenter(x, y);
      return worldToScreen(c.x, c.y - (state ? groundZ(state.tiles, x, y) : 0));
    },
    stats: () => ({ sprites: sprites.size, particles: fx.activeCount(), scale: spriteScale, zoom: cam.zoom }),
    buildingAtScreen(sx, sy) {
      const p = pick(sx, sy);
      return p && state ? buildingAt(state, p.x, p.y) : null;
    },
  };
}

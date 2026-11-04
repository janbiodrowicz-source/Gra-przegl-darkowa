/**
 * Island map: tile codes, grid helpers and a seeded island generator.
 *
 * Tiles are stored as a string of size×size characters (row-major):
 *   w – water (sea / pond)   s – sand (beach)   g – grass
 *   t – tree (clearable)     r – rock (clearable)
 * Everything outside the grid counts as sea.
 */
import { BIOMES, MAP } from '../config.js?v=0.3.3';
import { mulberry32, randInt, shuffle } from './rng.js?v=0.3.3';

export const TILE = Object.freeze({ WATER: 'w', SAND: 's', GRASS: 'g', TREE: 't', ROCK: 'r' });

/** Adjacency kinds that refer to tiles (everything else refers to building ids). */
export const TILE_KINDS = Object.freeze({ water: 'w', tree: 't', rock: 'r' });

export const N = MAP.size;

export const NEIGHBORS4 = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]]);
export const NEIGHBORS8 = Object.freeze([
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
]);

export const idx = (x, y) => y * N + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < N && y < N;

/** Tile code at (x, y); outside of the grid is sea. */
export function tileAt(tiles, x, y) {
  return inBounds(x, y) ? tiles[idx(x, y)] : TILE.WATER;
}

export const isLand = (c) => c !== TILE.WATER;
export const isBuildable = (c) => c === TILE.GRASS || c === TILE.SAND;
export const isClearable = (c) => c === TILE.TREE || c === TILE.ROCK;

/** Returns a copy of `tiles` with (x, y) replaced by `code`. */
export function setTile(tiles, x, y, code) {
  const i = idx(x, y);
  return tiles.slice(0, i) + code + tiles.slice(i + 1);
}

/** True when any 4-neighbour of (x, y) is water (or outside the grid). */
export function touchesWater(tiles, x, y) {
  for (const [dx, dy] of NEIGHBORS4) if (tileAt(tiles, x + dx, y + dy) === TILE.WATER) return true;
  return false;
}

/** Water connected to the open sea (not an inland pond), memoised per tiles string. */
let seaCache = { tiles: null, mask: null };
export function seaMask(tiles) {
  if (seaCache.tiles === tiles) return seaCache.mask;
  const mask = new Uint8Array(N * N);
  const stack = [];
  for (let i = 0; i < N; i++) {
    for (const [x, y] of [[i, 0], [i, N - 1], [0, i], [N - 1, i]]) {
      const j = idx(x, y);
      if (tiles[j] === TILE.WATER && !mask[j]) { mask[j] = 1; stack.push(j); }
    }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const j = idx(nx, ny);
      if (!mask[j] && tiles[j] === TILE.WATER) { mask[j] = 1; stack.push(j); }
    }
  }
  seaCache = { tiles, mask };
  return mask;
}

/** A sea tile right next to the island (where a pier can stand). */
export function isShoreWater(tiles, x, y) {
  if (!inBounds(x, y) || !seaMask(tiles)[idx(x, y)]) return false;
  for (const [dx, dy] of NEIGHBORS4) {
    const c = tileAt(tiles, x + dx, y + dy);
    if (c !== TILE.WATER) return true;
  }
  return false;
}

/** Tile code a cleared tree/rock leaves behind: sand on the shore, grass inland. */
export function clearedTileCode(tiles, x, y) {
  return touchesWater(tiles, x, y) ? TILE.SAND : TILE.GRASS;
}

/* ------------------------------------------------------------------ */
/* Generator                                                           */
/* ------------------------------------------------------------------ */

/**
 * Deterministically generates an island for a seed and a biome (see BIOMES).
 * @returns {{ tiles: string, start: { x: number, y: number } }}
 */
export function generateIsland(seed, biome = 'home') {
  const B = BIOMES[biome] || BIOMES.home;
  for (let attempt = 0; attempt < 24; attempt++) {
    const result = tryGenerate((seed + attempt * 7919) >>> 0, B);
    if (result) return result;
  }
  return fallbackIsland();
}

function tryGenerate(seed, B) {
  const rnd = mulberry32(seed);
  const c = (N - 1) / 2;
  const total = N * N;

  // Coarse value noise for an organic coastline.
  const G = 5;
  const grid = Array.from({ length: G * G }, () => rnd());
  const noise = (x, y) => {
    const gx = (x / (N - 1)) * (G - 1);
    const gy = (y / (N - 1)) * (G - 1);
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = Math.min(G - 1, x0 + 1), y1 = Math.min(G - 1, y0 + 1);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = grid[y0 * G + x0], b = grid[y0 * G + x1];
    const d = grid[y1 * G + x0], e = grid[y1 * G + x1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (d * (1 - sx) + e * sx) * sy;
  };

  const height = new Float64Array(total);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // The outer ring is always sea, so the coastline never runs along the grid edge.
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) {
        height[idx(x, y)] = -Infinity;
        continue;
      }
      const dx = (x - c) / (c + 0.5);
      const dy = (y - c) / (c + 0.5);
      const dist = Math.sqrt(dx * dx + dy * dy);
      height[idx(x, y)] = 1 - dist * 1.05 + (noise(x, y) - 0.5) * 0.6 + (rnd() - 0.5) * 0.1;
    }
  }

  // Pick the threshold so the island has a predictable amount of land.
  const target = randInt(rnd, B.land[0], B.land[1]);
  const sorted = Array.from(height).sort((p, q) => q - p);
  const threshold = sorted[target - 1];
  const land = new Uint8Array(total);
  for (let i = 0; i < total; i++) land[i] = height[i] >= threshold ? 1 : 0;

  // Keep only the main landmass and fill enclosed lakes (a pond is added on purpose later).
  const centre = idx(Math.round(c), Math.round(c));
  if (!land[centre]) return null;
  keepComponent(land, centre);
  fillEnclosedWater(land);
  // islets cut off by the coastline are dropped above — retry when too much land went with them
  let kept = 0;
  for (let i = 0; i < total; i++) kept += land[i];
  if (kept < B.land[0] - 2) return null;

  const t = new Array(total);
  for (let i = 0; i < total; i++) t[i] = land[i] ? TILE.GRASS : TILE.WATER;

  // Start tile: land closest to the centre whose whole neighbourhood is land.
  const start = pickStart(t, c);
  if (!start) return null;
  const nearStart = (x, y) => Math.max(Math.abs(x - start.x), Math.abs(y - start.y)) <= 1;

  // Small ponds inland (they give fields a reason to live there).
  for (let i = 0; i < B.ponds; i++) addPond(t, rnd, start, i === 0 ? 4 : 7);

  // Beaches.
  const asString = () => t.join('');
  let str = asString();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (t[idx(x, y)] === TILE.GRASS && touchesWater(str, x, y)) t[idx(x, y)] = TILE.SAND;
    }
  }

  // Forest clusters + scattered trees.
  const grass = () => {
    const out = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (t[idx(x, y)] === TILE.GRASS && !nearStart(x, y)) out.push([x, y]);
    }
    return out;
  };
  const distFromStart = (x, y) => Math.hypot(x - start.x, y - start.y);
  const centres = shuffle(rnd, grass().filter(([x, y]) => distFromStart(x, y) >= 3));
  const forests = randInt(rnd, B.forests[0], B.forests[1]);
  let placedForests = 0;
  for (const [fx, fy] of centres) {
    if (placedForests >= forests) break;
    // keep forest clusters apart from each other
    if (t[idx(fx, fy)] !== TILE.GRASS) continue;
    let tooClose = false;
    for (let y = fy - 2; y <= fy + 2 && !tooClose; y++) {
      for (let x = fx - 2; x <= fx + 2; x++) if (inBounds(x, y) && t[idx(x, y)] === TILE.TREE) { tooClose = true; break; }
    }
    if (tooClose) continue;
    growCluster(t, rnd, fx, fy, randInt(rnd, B.forestSize[0], B.forestSize[1]), TILE.TREE, nearStart, [TILE.GRASS]);
    placedForests++;
  }
  for (const [x, y] of shuffle(rnd, grass()).slice(0, randInt(rnd, B.trees[0], B.trees[1]))) t[idx(x, y)] = TILE.TREE;
  // A couple of palms on the beach.
  const beach = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (t[idx(x, y)] === TILE.SAND && !nearStart(x, y)) beach.push([x, y]);
  }
  for (const [x, y] of shuffle(rnd, beach).slice(0, randInt(rnd, B.palms[0], B.palms[1]))) t[idx(x, y)] = TILE.TREE;

  // Rock outcrops, preferably away from the centre.
  const rockSpots = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const code = t[idx(x, y)];
    if ((code === TILE.GRASS || code === TILE.SAND) && !nearStart(x, y) && distFromStart(x, y) >= 3) rockSpots.push([x, y]);
  }
  shuffle(rnd, rockSpots);
  let outcrops = 0;
  for (const [rx, ry] of rockSpots) {
    if (outcrops >= B.rocks) break;
    if (t[idx(rx, ry)] === TILE.ROCK || t[idx(rx, ry)] === TILE.TREE) continue;
    let near = false;
    for (let y = ry - 2; y <= ry + 2 && !near; y++) {
      for (let x = rx - 2; x <= rx + 2; x++) if (inBounds(x, y) && t[idx(x, y)] === TILE.ROCK) { near = true; break; }
    }
    if (near) continue;
    growCluster(t, rnd, rx, ry, randInt(rnd, B.rockSize[0], B.rockSize[1]), TILE.ROCK, nearStart, [TILE.GRASS, TILE.SAND]);
    outcrops++;
  }

  str = asString();
  // Quality checks: enough room to build, enough nature to enjoy.
  let buildable = 0, trees = 0, rocks = 0;
  for (const ch of str) {
    if (isBuildable(ch)) buildable++;
    else if (ch === TILE.TREE) trees++;
    else if (ch === TILE.ROCK) rocks++;
  }
  const needTrees = Math.min(14, B.forests[0] * 3);
  const needRocks = Math.min(5, B.rocks * 2);
  if (buildable < target * 0.5 || trees < needTrees || rocks < needRocks) return null;
  return { tiles: str, start };
}

function keepComponent(land, from) {
  const seen = new Uint8Array(land.length);
  const stack = [from];
  seen[from] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const j = idx(nx, ny);
      if (!seen[j] && land[j]) { seen[j] = 1; stack.push(j); }
    }
  }
  for (let i = 0; i < land.length; i++) if (land[i] && !seen[i]) land[i] = 0;
}

function fillEnclosedWater(land) {
  // Water connected to the border is sea; any other water becomes land.
  const sea = new Uint8Array(land.length);
  const stack = [];
  for (let i = 0; i < N; i++) {
    for (const [x, y] of [[i, 0], [i, N - 1], [0, i], [N - 1, i]]) {
      const j = idx(x, y);
      if (!land[j] && !sea[j]) { sea[j] = 1; stack.push(j); }
    }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const j = idx(nx, ny);
      if (!land[j] && !sea[j]) { sea[j] = 1; stack.push(j); }
    }
  }
  for (let i = 0; i < land.length; i++) if (!land[i] && !sea[i]) land[i] = 1;
}

function allNeighborsLand(t, x, y) {
  for (const [dx, dy] of NEIGHBORS8) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(nx, ny) || t[idx(nx, ny)] === TILE.WATER) return false;
  }
  return true;
}

function pickStart(t, c) {
  let best = null, bestD = Infinity;
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      if (t[idx(x, y)] === TILE.WATER || !allNeighborsLand(t, x, y)) continue;
      const d = Math.hypot(x - c, y - c);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best;
}

function addPond(t, rnd, start, maxDist = 4) {
  const candidates = [];
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const d = Math.max(Math.abs(x - start.x), Math.abs(y - start.y));
      if (d < 2 || d > maxDist) continue;
      if (t[idx(x, y)] !== TILE.GRASS || !allNeighborsLand(t, x, y)) continue;
      candidates.push([x, y]);
    }
  }
  if (!candidates.length) return;
  const [px, py] = candidates[Math.floor(rnd() * candidates.length)];
  t[idx(px, py)] = TILE.WATER;
  // Sometimes the pond gets a second tile.
  if (rnd() < 0.6) {
    const options = NEIGHBORS4
      .map(([dx, dy]) => [px + dx, py + dy])
      .filter(([x, y]) => inBounds(x, y) && t[idx(x, y)] === TILE.GRASS && allNeighborsLand(t, x, y)
        && Math.max(Math.abs(x - start.x), Math.abs(y - start.y)) >= 2);
    if (options.length) {
      const [qx, qy] = options[Math.floor(rnd() * options.length)];
      t[idx(qx, qy)] = TILE.WATER;
    }
  }
}

function growCluster(t, rnd, x0, y0, size, code, forbidden, allowed) {
  const cells = [[x0, y0]];
  t[idx(x0, y0)] = code;
  let guard = 0;
  while (cells.length < size && guard++ < 60) {
    const [bx, by] = cells[Math.floor(rnd() * cells.length)];
    const [dx, dy] = NEIGHBORS8[Math.floor(rnd() * 8)];
    const nx = bx + dx, ny = by + dy;
    if (!inBounds(nx, ny) || forbidden(nx, ny)) continue;
    if (!allowed.includes(t[idx(nx, ny)])) continue;
    t[idx(nx, ny)] = code;
    cells.push([nx, ny]);
  }
}

/**
 * Re-centres a v1 island (MAP.legacySize grid) inside the current grid.
 * @returns {{ tiles: string, offset: number }}
 */
export function padLegacyTiles(tiles, from = MAP.legacySize) {
  const off = Math.floor((N - from) / 2);
  const t = new Array(N * N).fill(TILE.WATER);
  for (let y = 0; y < from; y++) for (let x = 0; x < from; x++) t[idx(x + off, y + off)] = tiles[y * from + x];
  return { tiles: t.join(''), offset: off };
}

/** Used only if the generator keeps failing (should never happen). */
function fallbackIsland() {
  const c = (N - 1) / 2;
  const t = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - c, y - c);
      t.push(d < 4.6 ? TILE.GRASS : d < 5.6 ? TILE.SAND : TILE.WATER);
    }
  }
  const s = Math.round(c);
  t[idx(s - 3, s - 2)] = TILE.TREE;
  t[idx(s - 3, s - 1)] = TILE.TREE;
  t[idx(s + 3, s + 2)] = TILE.ROCK;
  return { tiles: t.join(''), start: { x: s, y: s } };
}

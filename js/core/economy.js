/**
 * Pure economy formulas: costs, capacities, base production, adjacency.
 * Nothing here mutates state except the explicit resource helpers
 * (pay / grant) that work on a plain resource object.
 */
import { BALANCE, BUILDINGS, CAPPED, RESOURCES, QUESTS } from '../config.js';
import { NEIGHBORS8, TILE_KINDS, tileAt } from './map.js';

/* ---------------- resource helpers ---------------- */

export function emptyRes() {
  const r = {};
  for (const k of RESOURCES) r[k] = 0;
  return r;
}

/** Scales a cost object, rounding up (prices) or down (refunds). */
export function scaleCost(cost, factor, round = Math.ceil) {
  const out = {};
  for (const k in cost) {
    const v = round(cost[k] * factor - (round === Math.ceil ? 1e-9 : -1e-9));
    if (v > 0) out[k] = v;
  }
  return out;
}

export function canAfford(res, cost) {
  for (const k in cost) if ((res[k] ?? 0) + 1e-9 < cost[k]) return false;
  return true;
}

/** Missing amounts for a cost ({} when affordable). */
export function missingFor(res, cost) {
  const out = {};
  for (const k in cost) {
    const lack = cost[k] - (res[k] ?? 0);
    if (lack > 1e-9) out[k] = lack;
  }
  return out;
}

export function pay(res, cost) {
  for (const k in cost) res[k] = Math.max(0, (res[k] ?? 0) - cost[k]);
}

/** Adds amounts respecting caps; returns what was actually granted. */
export function grant(res, amounts, caps) {
  const granted = {};
  for (const k in amounts) {
    const before = res[k] ?? 0;
    const cap = caps?.[k] ?? Infinity;
    const after = Math.min(cap, before + amounts[k]);
    res[k] = Math.max(before, after);
    const got = res[k] - before;
    if (got > 0) granted[k] = got;
  }
  return granted;
}

export function addInto(target, amounts) {
  for (const k in amounts) target[k] = (target[k] ?? 0) + amounts[k];
  return target;
}

/* ---------------- buildings ---------------- */

export function countType(state, type) {
  let n = 0;
  for (const b of state.buildings) if (b.type === type) n++;
  return n;
}

export function buildingAt(state, x, y) {
  for (const b of state.buildings) if (b.x === x && b.y === y) return b;
  return null;
}

export function getBuilding(state, id) {
  for (const b of state.buildings) if (b.id === id) return b;
  return null;
}

/** Price of the next building of a type. */
export function buildCost(state, type) {
  const def = BUILDINGS[type];
  return scaleCost(def.cost, Math.pow(BALANCE.costGrowth, countType(state, type)));
}

/** Price of upgrading `b` to the next level, or null at max level. */
export function upgradeCost(b) {
  if (b.level >= BALANCE.maxLevel) return null;
  return scaleCost(BUILDINGS[b.type].upgrade, Math.pow(BALANCE.upgradeGrowth, b.level - 1));
}

/** Resources returned when demolishing `b`. */
export function refundOf(b) {
  return scaleCost(b.spent || {}, BALANCE.refund, Math.floor);
}

export function housingOf(type, level) {
  const d = BUILDINGS[type];
  return d.housing ? d.housing + (d.housingPerLevel || 0) * (level - 1) : 0;
}

export function slotsOf(type, level) {
  const d = BUILDINGS[type];
  return d.workers ? d.workers + (d.workersPerLevel || 0) * (level - 1) : 0;
}

export function storageOf(type, level) {
  const d = BUILDINGS[type];
  return d.storage ? d.storage + (d.storagePerLevel || 0) * (level - 1) : 0;
}

/** Production per second at full staff, without bonuses (null for non-producers). */
export function baseRateOf(type, level) {
  const d = BUILDINGS[type];
  if (!d.produce) return null;
  const out = {};
  for (const k in d.produce) out[k] = d.produce[k] * level;
  return out;
}

export function producesFood(type) {
  return !!BUILDINGS[type].produce && 'food' in BUILDINGS[type].produce;
}

/* ---------------- unlocks ---------------- */

export function unlockQuestOf(type) {
  return BUILDINGS[type].unlock || null;
}

export function isUnlocked(state, type) {
  const q = BUILDINGS[type]?.unlock;
  return !q || state.quests[q] === 'claimed';
}

export function questIndex(id) {
  return QUESTS.findIndex((q) => q.id === id);
}

/* ---------------- adjacency ---------------- */

/** Key used by occupancy maps (works for out-of-grid coordinates too). */
export const occKey = (x, y) => y * 1000 + x;

/** Map(occKey → building) for fast neighbour lookups. */
export function occupancy(state) {
  const occ = new Map();
  for (const b of state.buildings) occ.set(occKey(b.x, b.y), b);
  return occ;
}

/**
 * Counts neighbours of (x, y) matching an adjacency kind.
 * `occ` is an optional occupancy map for speed.
 */
export function neighborCount(state, kind, x, y, occ = null) {
  const tileCode = TILE_KINDS[kind];
  let n = 0;
  for (const [dx, dy] of NEIGHBORS8) {
    const nx = x + dx, ny = y + dy;
    if (tileCode) {
      if (tileAt(state.tiles, nx, ny) === tileCode) n++;
    } else {
      const b = occ ? occ.get(occKey(nx, ny)) : buildingAt(state, nx, ny);
      if (b && b.type === kind) n++;
    }
  }
  return n;
}

/** Production bonus (0.3 = +30 %) a building of `type` would get at (x, y). */
export function adjacencyBonus(state, type, x, y, occ = null) {
  const adj = BUILDINGS[type]?.adjacency;
  if (!adj) return 0;
  return neighborCount(state, adj.kind, x, y, occ) * adj.bonus;
}

/* ---------------- capacities ---------------- */

export function capsOf(state) {
  let extra = 0;
  for (const b of state.buildings) extra += storageOf(b.type, b.level);
  const caps = {};
  for (const k of RESOURCES) caps[k] = CAPPED.includes(k) ? BALANCE.baseCap + extra : Infinity;
  return caps;
}

export function popCapOf(state) {
  let n = 0;
  for (const b of state.buildings) n += housingOf(b.type, b.level);
  return n;
}

/** Clamps resources to current caps; returns the amounts that were lost. */
export function clampToCaps(state, caps = capsOf(state)) {
  const lost = {};
  for (const k of CAPPED) {
    if (state.res[k] > caps[k]) {
      lost[k] = state.res[k] - caps[k];
      state.res[k] = caps[k];
    }
  }
  return lost;
}

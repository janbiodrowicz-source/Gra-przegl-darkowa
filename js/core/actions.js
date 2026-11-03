/**
 * Player commands. Each returns { ok: true, events, ... } or { ok: false, reason }.
 * Reasons map to i18n keys `reason.<reason>`.
 */
import { BALANCE, BUILDINGS } from '../config.js';
import {
  adjacencyBonus, baseRateOf, buildCost, buildingAt, canAfford, capsOf, clampToCaps,
  countType, getBuilding, grant, isUnlocked, pay, refundOf, upgradeCost, addInto,
} from './economy.js';
import { TILE, clearedTileCode, idx, inBounds, isClearable, setTile } from './map.js';
import { updateQuests } from './quests.js';

export { claimQuest } from './quests.js';

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/**
 * Checks whether `type` can be placed at (x, y).
 * Always reports the adjacency bonus and cost so the ghost can display them.
 */
export function canPlace(state, type, x, y) {
  if (!BUILDINGS[type]) return fail('notFound');
  const cost = buildCost(state, type);
  if (!isUnlocked(state, type)) return fail('locked', { cost });
  if (!inBounds(x, y)) return fail('outOfBounds', { cost });
  const code = state.tiles[idx(x, y)];
  const bonus = adjacencyBonus(state, type, x, y);
  if (code === TILE.WATER) return fail('water', { cost, bonus });
  if (isClearable(code)) return fail('blocked', { cost, bonus });
  if (buildingAt(state, x, y)) return fail('occupied', { cost, bonus });
  if (!canAfford(state.res, cost)) return fail('cost', { cost, bonus, tileOk: true });
  return { ok: true, cost, bonus, tileOk: true };
}

/** Production a new building would have at (x, y) with full staff. */
export function placementPreview(state, type, x, y) {
  const bonus = adjacencyBonus(state, type, x, y);
  const base = baseRateOf(type, 1);
  let rate = null;
  if (base) {
    rate = {};
    for (const k in base) rate[k] = base[k] * (1 + bonus);
  }
  return { bonus, rate };
}

export function build(state, type, x, y) {
  const check = canPlace(state, type, x, y);
  if (!check.ok) return check;
  pay(state.res, check.cost);
  const b = { id: state.nextId++, type, x, y, level: 1, spent: { ...check.cost } };
  state.buildings.push(b);
  state.stats.built[type] = (state.stats.built[type] || 0) + 1;
  state.rev++;
  const events = [{ type: 'built', id: b.id, building: type, x, y, cost: check.cost }];
  updateQuests(state, events);
  return { ok: true, building: b, events };
}

export function upgrade(state, id) {
  const b = getBuilding(state, id);
  if (!b) return fail('notFound');
  const cost = upgradeCost(b);
  if (!cost) return fail('maxLevel');
  if (!canAfford(state.res, cost)) return fail('cost', { cost });
  pay(state.res, cost);
  addInto(b.spent, cost);
  b.level++;
  state.stats.upgrades++;
  state.rev++;
  const events = [{ type: 'upgraded', id: b.id, building: b.type, level: b.level, x: b.x, y: b.y, cost }];
  updateQuests(state, events);
  return { ok: true, building: b, events };
}

/** What demolishing would do (refund and storage that would be lost). */
export function demolishPreview(state, id) {
  const b = getBuilding(state, id);
  if (!b) return fail('notFound');
  if (b.type === 'hut' && countType(state, 'hut') <= 1) return fail('lastHut');
  const refund = refundOf(b);
  const capsAfter = capsOf({ buildings: state.buildings.filter((o) => o.id !== id) });
  const lost = {};
  for (const k in capsAfter) {
    const over = (state.res[k] ?? 0) + (refund[k] ?? 0) - capsAfter[k];
    if (over > 1e-9) lost[k] = over;
  }
  return { ok: true, refund, lost, capsAfter };
}

export function demolish(state, id) {
  const preview = demolishPreview(state, id);
  if (!preview.ok) return preview;
  const i = state.buildings.findIndex((b) => b.id === id);
  const b = state.buildings[i];
  state.buildings.splice(i, 1);
  state.rev++;
  const caps = capsOf(state);
  const refund = grant(state.res, preview.refund, caps);
  const lost = clampToCaps(state, caps);
  state.stats.demolished++;
  const events = [{ type: 'demolished', id, building: b.type, x: b.x, y: b.y, refund, lost }];
  updateQuests(state, events);
  return { ok: true, refund, lost, events };
}

/** Clears a tree or a rock, giving a small amount of resources. */
export function clearTile(state, x, y) {
  if (!inBounds(x, y)) return fail('outOfBounds');
  const code = state.tiles[idx(x, y)];
  const yieldDef = BALANCE.clearYield[code];
  if (!yieldDef) return fail('notClearable');
  state.tiles = setTile(state.tiles, x, y, clearedTileCode(state.tiles, x, y));
  state.stats.cleared++;
  state.rev++;
  const gained = grant(state.res, yieldDef, capsOf(state));
  const events = [{ type: 'cleared', x, y, kind: code, gained }];
  updateQuests(state, events);
  return { ok: true, gained, events };
}

/** Dev/debug helper: adds resources (respects caps). */
export function cheatGive(state, amounts) {
  const gained = grant(state.res, amounts, capsOf(state));
  return { ok: true, gained, events: [{ type: 'cheat', gained }] };
}

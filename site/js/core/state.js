/**
 * Game state factory. The state is a plain JSON-friendly object; the only
 * runtime-only field is `rev` (bumped whenever buildings or tiles change,
 * used to invalidate derived-data caches).
 */
import { BALANCE, GAME, QUESTS, RESOURCES } from '../config.js?v=0.3.2';
import { generateIsland } from './map.js?v=0.3.2';

export function defaultStats() {
  const produced = {};
  for (const k of RESOURCES) produced[k] = 0;
  return { built: {}, upgrades: 0, demolished: 0, cleared: 0, produced, maxPop: BALANCE.startPop };
}

export function defaultFlags() {
  return { hungry: false, full: {}, hints: {} };
}

export function defaultMeta() {
  return { prestige: 0, prestigePoints: 0, prestigeCount: 0, islands: 1 };
}

/**
 * Creates a fresh game.
 * @param {{ seed: number, now?: number, biome?: string }} opts  `now` is a wall-clock timestamp (ms).
 */
export function createState({ seed, now = 0, biome = 'home' }) {
  const { tiles, start } = generateIsland(seed >>> 0, biome);
  const state = {
    v: GAME.saveVersion,
    seed: seed >>> 0,
    biome,
    time: 0,
    res: { ...BALANCE.startRes },
    pop: BALANCE.startPop,
    tiles,
    buildings: [],
    nextId: 1,
    quests: Object.fromEntries(QUESTS.map((q, i) => [q.id, i === 0 ? 'active' : 'locked'])),
    stats: defaultStats(),
    flags: defaultFlags(),
    meta: defaultMeta(),
    createdAt: now,
    rev: 0,
  };
  // The settlers arrive with one hut already standing.
  state.buildings.push({ id: state.nextId++, type: 'hut', x: start.x, y: start.y, level: 1, spent: {} });
  return state;
}

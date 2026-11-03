/**
 * Wysepka — game data & balance.
 *
 * Every tunable number lives here; the rules that use them live in js/core/*.
 * Adding a building = an entry in BUILDINGS + BUILDING_ORDER, a draw function
 * in js/render/art.js and two i18n keys (b.<id>.name / b.<id>.desc).
 */

export const GAME = Object.freeze({
  id: 'wysepka',
  version: '0.1.0',
  saveVersion: 1,
  saveKey: 'wysepka.save',
  backupKey: 'wysepka.save.bak',
  settingsKey: 'wysepka.settings',
  step: 0.1,               // fixed logic step [s]
  maxFrameDt: 0.1,         // clamp for animation delta of a single frame [s]
  catchUpThreshold: 2,     // frame gaps longer than this are simulated like offline time [s]
  maxStepsPerFrame: 40,    // safety valve for the fixed-step accumulator
  autosaveEvery: 15,       // [s]
  saveAfterActionDelay: 1, // [s] debounce for saving after player actions
  offlineCap: 8 * 3600,    // offline progress limit [s]
  offlineStep: 5,          // simulation step used for offline progress [s]
  offlineReportMin: 60,    // "welcome back" screen only after this many seconds away
});

export const MAP = Object.freeze({
  size: 14,                // grid is size × size; the outer ring is always sea,
                           // so the island itself spans about 12 × 12 tiles
  landMin: 100,            // generated island has between landMin..landMax land tiles
  landMax: 112,
  defaultSeed: 20261103,
});

/** Resources in HUD order. */
export const RESOURCES = Object.freeze(['wood', 'stone', 'food', 'coins']);
/** Resources limited by storage. */
export const CAPPED = Object.freeze(['wood', 'stone', 'food']);

export const BALANCE = Object.freeze({
  startRes: Object.freeze({ wood: 50, stone: 15, food: 30, coins: 0 }),
  startPop: 2,
  baseCap: 150,            // wood/stone/food limit without warehouses
  foodPerPerson: 0.1,      // food eaten by one resident per second
  popGrowth: 0.2,          // residents arriving per second (free housing + food needed)
  hungerPenalty: 0.5,      // max production loss when the granary is empty (0.5 = −50 %)
  taxPerPerson: 0.02,      // coins per resident per second
  gatherWood: 0.1,         // brushwood collected by villagers, always on [wood/s]
  refund: 0.5,             // share of everything spent that demolition returns
  costGrowth: 1.15,        // each next building of the same type costs ×1.15
  upgradeGrowth: 1.15,     // each next level costs ×1.15
  maxLevel: 10,
  /** What clearing a tile gives (tile code → resources). */
  clearYield: Object.freeze({
    t: Object.freeze({ wood: 6 }),
    r: Object.freeze({ stone: 5 }),
  }),
});

/**
 * Building definitions.
 *  cost        – price of the first building of this type (×costGrowth per owned one)
 *  upgrade     – price of level 1→2 (×upgradeGrowth per level)
 *  produce     – resources per second at level 1 with full staff (scales linearly with level)
 *  workers     – job slots at level 1 (+workersPerLevel per level)
 *  housing     – residents at level 1 (+housingPerLevel per level)
 *  storage     – extra wood/stone/food limit at level 1 (+storagePerLevel per level)
 *  adjacency   – production bonus per neighbouring tile/building of `kind` (8-neighbourhood)
 *                kind: 'water' | 'tree' | 'rock' | any building id
 *  unlock      – id of the quest that must be claimed first
 */
export const BUILDINGS = Object.freeze({
  hut: Object.freeze({
    cost: { wood: 20 },
    upgrade: { wood: 25, stone: 10, coins: 5 },
    housing: 4, housingPerLevel: 2,
  }),
  field: Object.freeze({
    cost: { wood: 15 },
    upgrade: { wood: 20, coins: 5 },
    produce: { food: 0.7 },
    workers: 1, workersPerLevel: 1,
    adjacency: { kind: 'water', bonus: 0.1 },
  }),
  sawmill: Object.freeze({
    cost: { wood: 30, stone: 5 },
    upgrade: { wood: 30, stone: 15, coins: 8 },
    produce: { wood: 0.6 },
    workers: 2, workersPerLevel: 1,
    adjacency: { kind: 'tree', bonus: 0.1 },
  }),
  quarry: Object.freeze({
    cost: { wood: 40 },
    upgrade: { wood: 40, stone: 10, coins: 8 },
    produce: { stone: 0.5 },
    workers: 2, workersPerLevel: 1,
    adjacency: { kind: 'rock', bonus: 0.15 },
  }),
  market: Object.freeze({
    cost: { wood: 60, stone: 40 },
    upgrade: { wood: 50, stone: 40, coins: 10 },
    produce: { coins: 0.4 },
    workers: 2, workersPerLevel: 1,
    adjacency: { kind: 'hut', bonus: 0.1 },
    unlock: 'q3',
  }),
  warehouse: Object.freeze({
    cost: { wood: 60, stone: 60 },
    upgrade: { wood: 60, stone: 60, coins: 15 },
    storage: 150, storagePerLevel: 100,
    unlock: 'q4',
  }),
});

/** Build bar order. */
export const BUILDING_ORDER = Object.freeze(['hut', 'field', 'sawmill', 'quarry', 'market', 'warehouse']);

/**
 * Quest chain. Each quest becomes active after the previous one is claimed.
 * goal types:
 *   have     { buildings: { type: count } }  – own that many buildings
 *   pop      { count }                       – reach that many residents
 *   level    { level }                       – any building reaches that level
 *   cleared  { count }                       – clear that many trees/rocks
 *   resource { res, amount }                 – hold that much of a resource
 */
export const QUESTS = Object.freeze([
  Object.freeze({ id: 'q1', goal: { type: 'have', buildings: { field: 1 } }, reward: { wood: 25 } }),
  Object.freeze({ id: 'q2', goal: { type: 'have', buildings: { sawmill: 1, quarry: 1 } }, reward: { wood: 20, stone: 15 } }),
  Object.freeze({ id: 'q3', goal: { type: 'have', buildings: { hut: 3 } }, reward: { wood: 30, stone: 20 } }),
  Object.freeze({ id: 'q4', goal: { type: 'pop', count: 12 }, reward: { coins: 40 } }),
  Object.freeze({ id: 'q5', goal: { type: 'level', level: 3 }, reward: { coins: 100 } }),
]);

/** Prestige is only a hook for now (see js/core/prestige.js). */
export const PRESTIGE = Object.freeze({
  enabled: false,
});

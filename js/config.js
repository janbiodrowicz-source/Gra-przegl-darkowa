/**
 * Wysepka — game data & balance.
 *
 * Every tunable number lives here; the rules that use them live in js/core/*.
 * Adding a building = an entry in BUILDINGS + BUILDING_ORDER, a draw function
 * in js/render/art.js and two i18n keys (b.<id>.name / b.<id>.desc).
 */

export const GAME = Object.freeze({
  id: 'wysepka',
  version: '0.2.0',
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
/** Resources limited by storage (coins too — otherwise a night offline would make them meaningless). */
export const CAPPED = Object.freeze(['wood', 'stone', 'food', 'coins']);

export const BALANCE = Object.freeze({
  startRes: Object.freeze({ wood: 40, stone: 10, food: 20, coins: 0 }),
  startPop: 2,
  baseCap: 140,            // wood/stone/food limit without warehouses
  coinCap: 500,            // treasury limit without warehouses
  coinCapPerStorage: 2,    // each point of warehouse storage adds this many coins of room
  foodPerPerson: 0.1,      // food eaten by one resident per second
  popGrowth: 0.08,         // residents arriving per second (free housing + food needed)
  hungerPenalty: 0.5,      // max production loss when the granary is empty (0.5 = −50 %)
  taxPerPerson: 0.01,      // coins per resident per second
  gatherWood: 0.2,         // brushwood collected by villagers, always on [wood/s]
  refund: 0.5,             // share of everything spent that demolition returns
  costGrowth: 1.15,        // each next building of the same type costs ×1.15
  upgradeGrowth: 1.15,     // each next level costs ×1.15
  maxLevel: 10,
  charmCoinBonus: 0.04,    // each point of charm (decorations) adds +4 % to all coin income
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
 *  aura        – bonus this building gives to neighbouring buildings of `targets`
 *                ({ targets, bonus, bonusPerLevel }) — e.g. a well waters nearby fields
 *  charm       – decoration points (+charmPerLevel); charm raises all coin income
 *  coastal     – must be placed next to water
 *  unlock      – id of the quest that must be claimed first
 */
export const BUILDINGS = Object.freeze({
  hut: Object.freeze({
    cost: { wood: 32 },
    upgrade: { wood: 35, stone: 20, coins: 55 },
    housing: 4, housingPerLevel: 2,
  }),
  field: Object.freeze({
    cost: { wood: 15 },
    upgrade: { wood: 30, stone: 10, coins: 50 },
    produce: { food: 0.45 },
    workers: 1, workersPerLevel: 1,
    adjacency: { kind: 'water', bonus: 0.1 },
  }),
  sawmill: Object.freeze({
    cost: { wood: 35, stone: 5 },
    upgrade: { wood: 40, stone: 25, coins: 55 },
    produce: { wood: 0.4 },
    workers: 2, workersPerLevel: 1,
    adjacency: { kind: 'tree', bonus: 0.1 },
  }),
  quarry: Object.freeze({
    cost: { wood: 45 },
    upgrade: { wood: 50, stone: 15, coins: 55 },
    produce: { stone: 0.25 },
    workers: 2, workersPerLevel: 1,
    adjacency: { kind: 'rock', bonus: 0.15 },
  }),
  market: Object.freeze({
    cost: { wood: 80, stone: 50 },
    upgrade: { wood: 60, stone: 50, coins: 70 },
    produce: { coins: 0.25 },
    workers: 2, workersPerLevel: 1,
    adjacency: { kind: 'hut', bonus: 0.1 },
    unlock: 'q3',
  }),
  warehouse: Object.freeze({
    cost: { wood: 70, stone: 70 },
    upgrade: { wood: 80, stone: 80, coins: 80 },
    storage: 150, storagePerLevel: 100,
    unlock: 'q4',
  }),
  /* ---- second wave (after the first five quests) ---- */
  fisher: Object.freeze({
    cost: { wood: 60, stone: 20 },
    upgrade: { wood: 50, stone: 30, coins: 70 },
    produce: { food: 0.55 },
    workers: 1, workersPerLevel: 1,
    adjacency: { kind: 'water', bonus: 0.12 },
    coastal: true,
    unlock: 'q5',
  }),
  well: Object.freeze({
    cost: { wood: 40, stone: 50 },
    upgrade: { wood: 30, stone: 60, coins: 80 },
    aura: { targets: ['field', 'bakery'], bonus: 0.25, bonusPerLevel: 0.05 },
    unlock: 'q5',
  }),
  mill: Object.freeze({
    cost: { wood: 120, stone: 70, coins: 60 },
    upgrade: { wood: 80, stone: 60, coins: 100 },
    produce: { food: 0.5 },
    workers: 2, workersPerLevel: 1,
    adjacency: { kind: 'field', bonus: 0.2 },
    unlock: 'q6',
  }),
  bakery: Object.freeze({
    cost: { wood: 120, stone: 90, coins: 150 },
    upgrade: { wood: 70, stone: 80, coins: 130 },
    produce: { food: 0.35, coins: 0.35 },
    workers: 2, workersPerLevel: 1,
    adjacency: { kind: 'mill', bonus: 0.3 },
    unlock: 'q7',
  }),
  flowers: Object.freeze({
    cost: { wood: 20, coins: 60 },
    upgrade: { wood: 10, coins: 90 },
    charm: 1, charmPerLevel: 1,
    unlock: 'q8',
  }),
  fountain: Object.freeze({
    cost: { stone: 200, coins: 500 },
    upgrade: { stone: 120, coins: 400 },
    charm: 6, charmPerLevel: 2,
    unlock: 'q10',
  }),
});

/** Build bar order. */
export const BUILDING_ORDER = Object.freeze(['hut', 'field', 'sawmill', 'quarry', 'market', 'warehouse', 'fisher', 'well', 'mill', 'bakery', 'flowers', 'fountain']);

/**
 * Quest chain. Each quest becomes active after the previous one is claimed.
 * goal types:
 *   have     { buildings: { type: count } }  – own that many buildings
 *   pop      { count }                       – reach that many residents
 *   level    { level }                       – any building reaches that level
 *   cleared  { count }                       – clear that many trees/rocks
 *   resource { res, amount }                 – hold that much of a resource
 *   charm    { amount }                      – reach that much charm (decorations)
 */
export const QUESTS = Object.freeze([
  Object.freeze({ id: 'q1', goal: { type: 'have', buildings: { field: 1 } }, reward: { wood: 20 } }),
  Object.freeze({ id: 'q2', goal: { type: 'have', buildings: { sawmill: 1, quarry: 1 } }, reward: { wood: 25, stone: 10 } }),
  Object.freeze({ id: 'q3', goal: { type: 'have', buildings: { hut: 4 } }, reward: { wood: 40, stone: 25 } }),
  Object.freeze({ id: 'q4', goal: { type: 'level', level: 2 }, reward: { coins: 50 } }),
  Object.freeze({ id: 'q5', goal: { type: 'pop', count: 30 }, reward: { coins: 200 } }),
  // second set: ~30–60 more minutes
  Object.freeze({ id: 'q6', goal: { type: 'have', buildings: { fisher: 1, well: 1 } }, reward: { food: 60, coins: 120 } }),
  Object.freeze({ id: 'q7', goal: { type: 'have', buildings: { mill: 1, field: 5 } }, reward: { wood: 80, stone: 60 } }),
  Object.freeze({ id: 'q8', goal: { type: 'have', buildings: { bakery: 1 } }, reward: { coins: 200 } }),
  Object.freeze({ id: 'q9', goal: { type: 'charm', amount: 8 }, reward: { coins: 250 } }),
  Object.freeze({ id: 'q10', goal: { type: 'pop', count: 60 }, reward: { stone: 100, coins: 300 } }),
  Object.freeze({ id: 'q11', goal: { type: 'level', level: 6 }, reward: { wood: 150, stone: 150 } }),
  Object.freeze({ id: 'q12', goal: { type: 'resource', res: 'food', amount: 800 }, reward: { coins: 500 } }),
  Object.freeze({ id: 'q13', goal: { type: 'charm', amount: 30 }, reward: { coins: 700 } }),
  Object.freeze({ id: 'q14', goal: { type: 'pop', count: 150 }, reward: { coins: 1000 } }),
]);

/** Prestige is only a hook for now (see js/core/prestige.js). */
export const PRESTIGE = Object.freeze({
  enabled: false,
});

/**
 * Save system: versioned JSON in a key/value storage (localStorage through
 * platform.storage), sequential migrations, a known-good backup, and strict
 * sanitising of everything that comes back from storage.
 *
 * Storage format (v2):  { v, savedAt, tab, world: { main, active, scout, seed, found,
 *                         quests, meta, islands: [ { ...persistent island fields } ] } }
 * v1 stored a single island as `state` on a 14×14 grid.
 */
import { BALANCE, BIOMES, BUILDINGS, GAME, MAP, QUESTS, RESOURCES, WORLD } from '../config.js';
import { createState, defaultFlags, defaultMeta, defaultStats } from '../core/state.js';
import { TILE, idx, inBounds, isClearable, clearedTileCode, padLegacyTiles, setTile } from '../core/map.js';
import { activeIsland, createWorld, linkWorld, worldFromState } from '../core/world.js';

/**
 * Migrations: MIGRATIONS[n] turns a version-n save into version n+1.
 */
export const MIGRATIONS = Object.freeze({
  /** v1 → v2: one island becomes a world; the 14×14 grid is centred in the bigger one. */
  1: (data) => {
    const st = data.state;
    if (typeof st.tiles === 'string' && st.tiles.length === MAP.legacySize * MAP.legacySize) {
      const { tiles, offset } = padLegacyTiles(st.tiles);
      st.tiles = tiles;
      if (Array.isArray(st.buildings)) {
        for (const b of st.buildings) {
          if (b && Number.isInteger(b.x) && Number.isInteger(b.y)) { b.x += offset; b.y += offset; }
        }
      }
    }
    st.biome = 'home';
    data.world = { islands: [st], main: 0, active: 0, quests: st.quests, meta: st.meta, scout: null, seed: st.seed, found: 0 };
    delete data.state;
    return data;
  },
});

export class SaveError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'SaveError';
    this.code = code; // empty | json | format | newer | migration
  }
}

const PERSIST = ['seed', 'biome', 'time', 'res', 'pop', 'tiles', 'buildings', 'nextId', 'stats', 'flags', 'createdAt'];
const QUEST_STATUS = new Set(['locked', 'active', 'done', 'claimed']);

/** Serialises a world (or, for convenience, a single island state). */
export function serialize(worldOrState, now, tab = null) {
  const world = worldOrState.islands ? worldOrState : worldFromState(worldOrState);
  const islands = world.islands.map((s) => {
    const data = {};
    for (const k of PERSIST) data[k] = s[k];
    return data;
  });
  const out = {
    main: world.main, active: world.active, scout: world.scout, seed: world.seed, found: world.found,
    quests: world.quests, meta: world.meta, islands,
  };
  return JSON.stringify({ v: GAME.saveVersion, savedAt: now, tab, world: out });
}

/** Runs migrations from data.v up to `target`. */
export function migrate(data, migrations = MIGRATIONS, target = GAME.saveVersion) {
  if (!Number.isInteger(data.v) || data.v < 0) throw new SaveError('format', 'bad version');
  if (data.v > target) throw new SaveError('newer', `save v${data.v} > game v${target}`);
  let d = data;
  while (d.v < target) {
    const fn = migrations[d.v];
    if (typeof fn !== 'function') throw new SaveError('migration', `no migration from v${d.v}`);
    const from = d.v;
    d = fn(d);
    if (!d || typeof d !== 'object') throw new SaveError('migration', `migration from v${from} returned nothing`);
    d.v = from + 1;
  }
  return d;
}

/** Parses + migrates + sanitises a stored string. Throws SaveError. */
export function parseSave(str, migrations = MIGRATIONS) {
  if (str == null || str === '') throw new SaveError('empty');
  let data;
  try {
    data = JSON.parse(str);
  } catch {
    throw new SaveError('json');
  }
  const body = data && typeof data === 'object' ? (data.world ?? data.state) : null;
  if (!body || typeof body !== 'object') throw new SaveError('format');
  data = migrate(data, migrations);
  if (!data.world || typeof data.world !== 'object') throw new SaveError('format');
  const world = sanitizeWorld(data.world);
  return {
    world,
    state: activeIsland(world),
    savedAt: Number.isFinite(data.savedAt) ? data.savedAt : null,
    tab: typeof data.tab === 'string' ? data.tab : null,
  };
}

/** Rebuilds a valid world from untrusted data (islands, shared quests, scouting). */
export function sanitizeWorld(raw) {
  const list = Array.isArray(raw.islands) ? raw.islands.filter((x) => x && typeof x === 'object').slice(0, WORLD.maxIslands) : [];
  if (!list.length) throw new SaveError('format', 'no islands');
  const islands = list.map((isl) => sanitize({ ...isl, quests: raw.quests, meta: raw.meta }));
  const count = islands.length;
  const pick = (v, fallback) => (Number.isInteger(v) && v >= 0 && v < count ? v : fallback);
  const world = {
    islands,
    main: pick(raw.main, 0),
    active: 0,
    quests: islands[0].quests,
    meta: islands[0].meta,
    scout: null,
    seed: Number.isInteger(raw.seed) ? raw.seed >>> 0 : islands[0].seed,
    found: Math.round(num(raw.found, 0, 0, 1e6)),
  };
  world.active = pick(raw.active, world.main);
  const sc = raw.scout;
  if (sc && typeof sc === 'object' && Number.isInteger(sc.from) && sc.from >= 0 && sc.from < count) {
    if (Array.isArray(sc.offers)) {
      const owned = new Set(islands.map((s) => s.biome));
      const offers = sc.offers
        .filter((o) => o && BIOMES[o.biome] && !owned.has(o.biome) && Number.isInteger(o.seed))
        .slice(0, WORLD.offers)
        .map((o) => ({ biome: o.biome, seed: o.seed >>> 0 }));
      if (offers.length) world.scout = { from: sc.from, offers };
    } else if (num(sc.left, 0, 0) > 0) {
      const total = num(sc.total, WORLD.scoutTime, 1, 1e5);
      world.scout = { from: sc.from, left: Math.min(num(sc.left, 0, 0), total), total };
    }
  }
  return linkWorld(world);
}

const num = (v, fallback, min = -Infinity, max = Infinity) =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** Rebuilds a valid state from untrusted data, repairing whatever is broken. */
export function sanitize(raw) {
  const seed = Number.isInteger(raw.seed) ? raw.seed >>> 0 : MAP.defaultSeed;
  const biome = BIOMES[raw.biome] ? raw.biome : 'home';
  const s = createState({ seed, now: num(raw.createdAt, 0, 0), biome });
  const fresh = s.buildings[0];

  const total = MAP.size * MAP.size;
  if (typeof raw.tiles === 'string' && raw.tiles.length === total && /^[wsgtr]+$/.test(raw.tiles)) {
    s.tiles = raw.tiles;
  }

  s.time = num(raw.time, 0, 0);
  for (const k of RESOURCES) s.res[k] = num(raw.res?.[k], k === 'coins' ? 0 : BALANCE.startRes[k], 0);
  s.pop = num(raw.pop, BALANCE.startPop, 0, 1e6);

  // Buildings
  s.buildings = [];
  const usedTiles = new Set();
  const usedIds = new Set();
  let maxId = 0;
  if (Array.isArray(raw.buildings)) {
    for (const b of raw.buildings) {
      if (!b || typeof b !== 'object' || !BUILDINGS[b.type]) continue;
      if (!Number.isInteger(b.x) || !Number.isInteger(b.y) || !inBounds(b.x, b.y)) continue;
      const tileIndex = idx(b.x, b.y);
      const onWater = !!BUILDINGS[b.type].onWater;
      if (usedTiles.has(tileIndex) || (s.tiles[tileIndex] === TILE.WATER) !== onWater) continue;
      if (isClearable(s.tiles[tileIndex])) s.tiles = setTile(s.tiles, b.x, b.y, clearedTileCode(s.tiles, b.x, b.y));
      let id = Number.isInteger(b.id) && b.id > 0 && !usedIds.has(b.id) ? b.id : 0;
      const spent = {};
      if (b.spent && typeof b.spent === 'object') {
        for (const k of RESOURCES) if (num(b.spent[k], 0, 0) > 0) spent[k] = b.spent[k];
      }
      const level = Math.round(num(b.level, 1, 1, BALANCE.maxLevel));
      const entry = { id, type: b.type, x: b.x, y: b.y, level, spent };
      usedTiles.add(tileIndex);
      if (id) { usedIds.add(id); maxId = Math.max(maxId, id); }
      s.buildings.push(entry);
    }
  }
  // Give ids to entries that lost them.
  for (const b of s.buildings) if (!b.id) { b.id = ++maxId; usedIds.add(b.id); }
  // A town always needs at least one hut (otherwise nobody could ever live there).
  if (!s.buildings.some((b) => b.type === 'hut')) {
    const spot = findFreeSpot(s, fresh.x, fresh.y);
    if (spot) s.buildings.push({ id: ++maxId, type: 'hut', x: spot.x, y: spot.y, level: 1, spent: {} });
  }
  s.nextId = Math.max(num(raw.nextId, 1, 1), maxId + 1);

  // Quests: keep valid statuses, then repair the chain.
  let firstOpen = true;
  for (const q of QUESTS) {
    const st = QUEST_STATUS.has(raw.quests?.[q.id]) ? raw.quests[q.id] : 'locked';
    if (st === 'claimed') { s.quests[q.id] = 'claimed'; continue; }
    if (firstOpen) {
      s.quests[q.id] = st === 'done' ? 'done' : 'active';
      firstOpen = false;
    } else {
      s.quests[q.id] = 'locked';
    }
  }

  // Stats / flags / meta: defaults merged with valid numbers.
  const stats = defaultStats();
  const rs = raw.stats || {};
  stats.upgrades = num(rs.upgrades, 0, 0);
  stats.demolished = num(rs.demolished, 0, 0);
  stats.cleared = num(rs.cleared, 0, 0);
  stats.maxPop = num(rs.maxPop, s.pop, 0);
  for (const k of RESOURCES) stats.produced[k] = num(rs.produced?.[k], 0, 0);
  for (const type of Object.keys(BUILDINGS)) {
    const v = num(rs.built?.[type], 0, 0);
    if (v > 0) stats.built[type] = v;
  }
  s.stats = stats;

  const flags = defaultFlags();
  const rf = raw.flags || {};
  flags.hungry = rf.hungry === true;
  for (const k of RESOURCES) if (rf.full?.[k] === true) flags.full[k] = true;
  if (rf.hints && typeof rf.hints === 'object') {
    for (const [k, v] of Object.entries(rf.hints)) if (v === true) flags.hints[k] = true;
  }
  s.flags = flags;

  const meta = defaultMeta();
  const rm = raw.meta || {};
  meta.prestige = num(rm.prestige, 0, 0);
  meta.prestigePoints = num(rm.prestigePoints, 0, 0);
  meta.prestigeCount = num(rm.prestigeCount, 0, 0);
  meta.islands = Math.round(num(rm.islands, 1, 1, WORLD.maxIslands));
  s.meta = meta;

  s.rev = 0;
  return s;
}

function findFreeSpot(state, cx, cy) {
  let best = null, bestD = Infinity;
  const taken = new Set(state.buildings.map((b) => idx(b.x, b.y)));
  for (let y = 0; y < MAP.size; y++) {
    for (let x = 0; x < MAP.size; x++) {
      const c = state.tiles[idx(x, y)];
      if ((c !== TILE.GRASS && c !== TILE.SAND) || taken.has(idx(x, y))) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best;
}

/**
 * Loads the game from storage.
 * status: 'new' | 'loaded' | 'backup' (main save broken, backup used)
 *       | 'corrupt' (nothing usable, new game) | 'newer' (save from a newer version; read-only)
 */
export function loadGame(storage, { now, newSeed }) {
  const fresh = () => {
    const world = createWorld({ seed: newSeed, now });
    return { world, state: activeIsland(world) };
  };
  const main = storage.get(GAME.saveKey);
  if (main == null) return { ...fresh(), status: 'new', savedAt: null };
  try {
    const parsed = parseSave(main);
    storage.set(GAME.backupKey, main); // remember the last save that loaded fine
    return { world: parsed.world, state: parsed.state, status: 'loaded', savedAt: parsed.savedAt };
  } catch (error) {
    if (error.code === 'newer') {
      return { ...fresh(), status: 'newer', savedAt: null, error, readOnly: true };
    }
    storage.set(`${GAME.saveKey}.corrupt`, main);
    const backup = storage.get(GAME.backupKey);
    if (backup) {
      try {
        const parsed = parseSave(backup);
        return { world: parsed.world, state: parsed.state, status: 'backup', savedAt: parsed.savedAt, error };
      } catch { /* fall through */ }
    }
    return { ...fresh(), status: 'corrupt', savedAt: null, error };
  }
}

export function writeSave(storage, world, now, tab) {
  return storage.set(GAME.saveKey, serialize(world, now, tab));
}

export function clearSave(storage) {
  storage.remove(GAME.saveKey);
  storage.remove(GAME.backupKey);
}

/* ---------------- settings (kept apart so a reset does not touch them) ---------------- */

export const DEFAULT_SETTINGS = Object.freeze({ sound: true, lang: 'pl' });

export function loadSettings(storage, { languages = ['pl', 'en'], locale = null } = {}) {
  const out = { ...DEFAULT_SETTINGS };
  const raw = storage.get(GAME.settingsKey);
  let parsed = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (parsed && typeof parsed === 'object') {
    if (typeof parsed.sound === 'boolean') out.sound = parsed.sound;
    if (languages.includes(parsed.lang)) out.lang = parsed.lang;
  } else if (locale) {
    const short = String(locale).slice(0, 2).toLowerCase();
    if (languages.includes(short)) out.lang = short;
  }
  return out;
}

export function saveSettings(storage, settings) {
  return storage.set(GAME.settingsKey, JSON.stringify(settings));
}

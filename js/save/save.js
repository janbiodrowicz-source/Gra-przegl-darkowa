/**
 * Save system: versioned JSON in a key/value storage (localStorage through
 * platform.storage), sequential migrations, a known-good backup, and strict
 * sanitising of everything that comes back from storage.
 *
 * Storage format:  { v, savedAt, tab, state: { ...persistent fields } }
 */
import { BALANCE, BUILDINGS, GAME, MAP, QUESTS, RESOURCES } from '../config.js';
import { createState, defaultFlags, defaultMeta, defaultStats } from '../core/state.js';
import { TILE, idx, inBounds, isClearable, clearedTileCode, setTile } from '../core/map.js';

/**
 * Migrations: MIGRATIONS[n] turns a version-n save into version n+1.
 * Example for the future:
 *   1: (data) => { data.state.meta.prestigeCount ??= 0; return data; },
 */
export const MIGRATIONS = Object.freeze({});

export class SaveError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'SaveError';
    this.code = code; // empty | json | format | newer | migration
  }
}

const PERSIST = ['seed', 'time', 'res', 'pop', 'tiles', 'buildings', 'nextId', 'quests', 'stats', 'flags', 'meta', 'createdAt'];
const QUEST_STATUS = new Set(['locked', 'active', 'done', 'claimed']);

export function serialize(state, now, tab = null) {
  const data = {};
  for (const k of PERSIST) data[k] = state[k];
  return JSON.stringify({ v: GAME.saveVersion, savedAt: now, tab, state: data });
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
  if (!data || typeof data !== 'object' || !data.state || typeof data.state !== 'object') {
    throw new SaveError('format');
  }
  data = migrate(data, migrations);
  return {
    state: sanitize(data.state),
    savedAt: Number.isFinite(data.savedAt) ? data.savedAt : null,
    tab: typeof data.tab === 'string' ? data.tab : null,
  };
}

const num = (v, fallback, min = -Infinity, max = Infinity) =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** Rebuilds a valid state from untrusted data, repairing whatever is broken. */
export function sanitize(raw) {
  const seed = Number.isInteger(raw.seed) ? raw.seed >>> 0 : MAP.defaultSeed;
  const s = createState({ seed, now: num(raw.createdAt, 0, 0) });
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
      if (usedTiles.has(tileIndex) || s.tiles[tileIndex] === TILE.WATER) continue;
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
  const main = storage.get(GAME.saveKey);
  if (main == null) return { state: createState({ seed: newSeed, now }), status: 'new', savedAt: null };
  try {
    const parsed = parseSave(main);
    storage.set(GAME.backupKey, main); // remember the last save that loaded fine
    return { state: parsed.state, status: 'loaded', savedAt: parsed.savedAt };
  } catch (error) {
    if (error.code === 'newer') {
      return { state: createState({ seed: newSeed, now }), status: 'newer', savedAt: null, error, readOnly: true };
    }
    storage.set(`${GAME.saveKey}.corrupt`, main);
    const backup = storage.get(GAME.backupKey);
    if (backup) {
      try {
        const parsed = parseSave(backup);
        return { state: parsed.state, status: 'backup', savedAt: parsed.savedAt, error };
      } catch { /* fall through */ }
    }
    return { state: createState({ seed: newSeed, now }), status: 'corrupt', savedAt: null, error };
  }
}

export function writeSave(storage, state, now, tab) {
  return storage.set(GAME.saveKey, serialize(state, now, tab));
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

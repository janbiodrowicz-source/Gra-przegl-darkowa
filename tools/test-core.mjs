#!/usr/bin/env node
/**
 * Core logic tests — plain Node, no frameworks:  node tools/test-core.mjs
 * The core is DOM-free, so the exact same modules the browser uses run here.
 */
import assert from 'node:assert/strict';
import { BALANCE, BUILDINGS, GAME, MAP, QUESTS, RESOURCES } from '../js/config.js';
import { N, TILE, generateIsland, idx, isBuildable, isClearable, tileAt } from '../js/core/map.js';
import { createState } from '../js/core/state.js';
import * as eco from '../js/core/economy.js';
import { derive, getRates, simulate, tick, timeToAfford, buildingInfo } from '../js/core/sim.js';
import * as actions from '../js/core/actions.js';
import { questProgress, currentQuest } from '../js/core/quests.js';
import { canPrestige, applyPrestige } from '../js/core/prestige.js';
import { SaveError, loadGame, loadSettings, migrate, parseSave, sanitize, serialize, writeSave } from '../js/save/save.js';
import { DICTS, setLang, t } from '../js/i18n.js';
import { createBus } from '../js/core/events.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ---------------- helpers ---------------- */

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    persistent: true,
    map: m,
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, v); return true; },
    remove: (k) => { m.delete(k); },
  };
}

function freeTile(state, pred = () => true) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (isBuildable(state.tiles[idx(x, y)]) && !eco.buildingAt(state, x, y) && pred(x, y)) return { x, y };
    }
  }
  return null;
}

function findTile(state, code) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (state.tiles[idx(x, y)] === code) return { x, y };
  return null;
}

function run(state, seconds, step = GAME.step) {
  const out = [];
  for (let t = 0; t < seconds - 1e-9; t += step) tick(state, step, out);
  return out;
}

function rich(state, n = 10000) {
  for (const k of RESOURCES) state.res[k] = n;
  // lift storage limits for tests that need lots of resources
  state.__caps = true;
}

/** Places a building directly (bypassing costs) — test setup only. */
function place(state, type, x, y, level = 1) {
  const b = { id: state.nextId++, type, x, y, level, spent: {} };
  state.buildings.push(b);
  state.rev++;
  return b;
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/* ---------------- map ---------------- */

test('island generation is deterministic and valid for many seeds', () => {
  const a = generateIsland(123);
  const b = generateIsland(123);
  assert.equal(a.tiles, b.tiles);
  assert.deepEqual(a.start, b.start);
  for (let seed = 1; seed <= 300; seed++) {
    const { tiles, start } = generateIsland(seed * 7741);
    assert.equal(tiles.length, N * N, `seed ${seed}: length`);
    assert.match(tiles, /^[wsgtr]+$/, `seed ${seed}: codes`);
    const startTile = tiles[idx(start.x, start.y)];
    assert.ok(isBuildable(startTile), `seed ${seed}: start tile buildable`);
    let land = 0, buildable = 0;
    for (const c of tiles) { if (c !== TILE.WATER) land++; if (isBuildable(c)) buildable++; }
    assert.ok(land >= MAP.landMin - 4 && land <= MAP.landMax + 2, `seed ${seed}: land ${land}`);
    assert.ok(buildable >= 55, `seed ${seed}: buildable ${buildable}`);
    // the start hut has free room around it
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      assert.ok(!isClearable(tileAt(tiles, start.x + dx, start.y + dy)), `seed ${seed}: clear start area`);
    }
  }
});

test('different seeds give different islands', () => {
  assert.notEqual(generateIsland(1).tiles, generateIsland(2).tiles);
});

/* ---------------- state & economy ---------------- */

test('new game: start hut, resources, first quest active', () => {
  const s = createState({ seed: 42, now: 1000 });
  assert.equal(s.buildings.length, 1);
  assert.equal(s.buildings[0].type, 'hut');
  assert.deepEqual(s.res, { ...BALANCE.startRes });
  assert.equal(s.quests.q1, 'active');
  assert.equal(s.quests.q2, 'locked');
  assert.equal(currentQuest(s).id, 'q1');
});

test('build costs grow ×1.15 per owned building (rounded up)', () => {
  const s = createState({ seed: 42 });
  const base = BUILDINGS.field.cost.wood;
  assert.deepEqual(eco.buildCost(s, 'field'), { wood: base });
  const spot = freeTile(s);
  place(s, 'field', spot.x, spot.y);
  assert.deepEqual(eco.buildCost(s, 'field'), { wood: Math.ceil(base * 1.15 - 1e-9) });
  const spot2 = freeTile(s);
  place(s, 'field', spot2.x, spot2.y);
  assert.deepEqual(eco.buildCost(s, 'field'), { wood: Math.ceil(base * 1.15 * 1.15 - 1e-9) });
  // the free start hut counts as owned
  assert.deepEqual(eco.buildCost(s, 'hut'), { wood: Math.ceil(BUILDINGS.hut.cost.wood * 1.15) });
});

test('upgrade costs grow ×1.15 per level and stop at max level', () => {
  const b = { type: 'sawmill', level: 1, spent: {} };
  assert.deepEqual(eco.upgradeCost(b), { ...BUILDINGS.sawmill.upgrade });
  b.level = 3;
  const base = BUILDINGS.sawmill.upgrade;
  assert.deepEqual(eco.upgradeCost(b), Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.ceil(v * 1.15 ** 2 - 1e-9)])));
  b.level = BALANCE.maxLevel;
  assert.equal(eco.upgradeCost(b), null);
});

test('housing, slots, storage and refunds', () => {
  assert.equal(eco.housingOf('hut', 1), 4);
  assert.equal(eco.housingOf('hut', 3), 8);
  assert.equal(eco.slotsOf('sawmill', 1), 2);
  assert.equal(eco.slotsOf('sawmill', 4), 5);
  assert.equal(eco.storageOf('warehouse', 2), 250);
  assert.deepEqual(eco.refundOf({ spent: { wood: 45, stone: 7 } }), { wood: 22, stone: 3 });
});

/* ---------------- actions ---------------- */

test('build: validation reasons and success', () => {
  const s = createState({ seed: 99 });
  const water = findTile(s, TILE.WATER);
  assert.equal(actions.canPlace(s, 'field', water.x, water.y).reason, 'water');
  const hut = s.buildings[0];
  assert.equal(actions.canPlace(s, 'field', hut.x, hut.y).reason, 'occupied');
  const tree = findTile(s, TILE.TREE);
  assert.equal(actions.canPlace(s, 'field', tree.x, tree.y).reason, 'blocked');
  assert.equal(actions.canPlace(s, 'field', -1, 3).reason, 'outOfBounds');
  const spot = freeTile(s);
  assert.equal(actions.canPlace(s, 'market', spot.x, spot.y).reason, 'locked');
  s.res.wood = 5;
  assert.equal(actions.canPlace(s, 'field', spot.x, spot.y).reason, 'cost');
  s.res.wood = 50;
  const r = actions.build(s, 'field', spot.x, spot.y);
  assert.ok(r.ok);
  assert.equal(s.res.wood, 35);
  assert.deepEqual(r.building.spent, { wood: 15 });
  assert.ok(r.events.some((e) => e.type === 'built'));
  assert.ok(r.events.some((e) => e.type === 'questDone' && e.id === 'q1'));
});

test('upgrade: pays, levels up, tracks spent', () => {
  const s = createState({ seed: 5 });
  rich(s, 140);
  const hut = s.buildings[0];
  const r = actions.upgrade(s, hut.id);
  assert.ok(r.ok);
  assert.equal(hut.level, 2);
  assert.deepEqual(hut.spent, { ...BUILDINGS.hut.upgrade });
  s.res.coins = 0;
  assert.equal(actions.upgrade(s, hut.id).reason, 'cost');
});

test('demolish: 50% refund, last hut is protected', () => {
  const s = createState({ seed: 7 });
  const hut = s.buildings[0];
  assert.equal(actions.demolish(s, hut.id).reason, 'lastHut');
  const spot = freeTile(s);
  const built = actions.build(s, 'field', spot.x, spot.y);
  const woodBefore = s.res.wood;
  const r = actions.demolish(s, built.building.id);
  assert.ok(r.ok);
  assert.equal(s.res.wood, woodBefore + 7);
  assert.equal(s.buildings.length, 1);
});

test('demolishing a warehouse clamps resources to the new limit', () => {
  const s = createState({ seed: 8 });
  s.quests.q4 = 'claimed';
  const spot = freeTile(s);
  const w = place(s, 'warehouse', spot.x, spot.y);
  s.res.wood = 290;
  const preview = actions.demolishPreview(s, w.id);
  assert.ok(preview.lost.wood > 0);
  const r = actions.demolish(s, w.id);
  assert.ok(r.ok);
  assert.equal(s.res.wood, BALANCE.baseCap);
});

test('clearing a tree gives wood and frees the tile', () => {
  const s = createState({ seed: 11 });
  const tree = findTile(s, TILE.TREE);
  const before = s.res.wood;
  const r = actions.clearTile(s, tree.x, tree.y);
  assert.ok(r.ok);
  assert.equal(s.res.wood, before + BALANCE.clearYield.t.wood);
  assert.ok(isBuildable(s.tiles[idx(tree.x, tree.y)]));
  assert.equal(s.stats.cleared, 1);
  assert.equal(actions.clearTile(s, tree.x, tree.y).reason, 'notClearable');
});

/* ---------------- simulation ---------------- */

test('workers go to fields first', () => {
  const s = createState({ seed: 3 });
  const a = freeTile(s);
  place(s, 'sawmill', a.x, a.y);
  const b = freeTile(s);
  const field = place(s, 'field', b.x, b.y);
  s.pop = 1;
  const d = derive(s);
  assert.equal(d.per.get(field.id).workers, 1);
  assert.equal(d.employed, 1);
  assert.equal(d.jobs, 3);
});

test('production matches rates (field + sawmill, fed town)', () => {
  const s = createState({ seed: 21 });
  const a = freeTile(s);
  const saw = place(s, 'sawmill', a.x, a.y);
  const b = freeTile(s);
  const field = place(s, 'field', b.x, b.y);
  s.pop = 4; // = housing of the start hut, so it stays constant
  s.res.food = 100;
  s.res.wood = 0;
  const d = derive(s);
  const fieldRate = d.per.get(field.id).rate.food;
  const sawRate = d.per.get(saw.id).rate.wood;
  assert.ok(near(fieldRate, BUILDINGS.field.produce.food * (1 + eco.adjacencyBonus(s, 'field', b.x, b.y))));
  run(s, 10);
  assert.ok(near(s.res.wood, (sawRate + BALANCE.gatherWood) * 10, 1e-6), `wood ${s.res.wood}`);
  assert.ok(near(s.res.food, 100 + (fieldRate - 4 * BALANCE.foodPerPerson) * 10, 1e-6), `food ${s.res.food}`);
});

test('hunger halves production (fields excluded) and stops growth', () => {
  const s = createState({ seed: 22 });
  const a = freeTile(s);
  const saw = place(s, 'sawmill', a.x, a.y);
  s.pop = 3;
  s.res.food = 0;
  s.res.wood = 0;
  const r = getRates(s);
  assert.equal(r.mult, 1 - BALANCE.hungerPenalty);
  assert.ok(r.hungry);
  const out = run(s, 1);
  assert.ok(out.some((e) => e.type === 'hungerStart'));
  assert.ok(s.flags.hungry);
  assert.equal(s.pop, 3, 'no growth while hungry');
  const sawRate = derive(s).per.get(saw.id).rate.wood;
  assert.ok(near(s.res.wood, (sawRate * 0.5 + BALANCE.gatherWood) * 1, 1e-6));
});

test('population grows into free housing', () => {
  const s = createState({ seed: 23 });
  s.pop = 2;
  s.res.food = 100;
  run(s, 5);
  assert.ok(near(s.pop, 2 + 5 * BALANCE.popGrowth, 1e-6), `pop ${s.pop}`);
  run(s, 2 / BALANCE.popGrowth + 5);
  assert.equal(s.pop, 4);
});

test('storage cap clamps and emits storageFull', () => {
  const s = createState({ seed: 24 });
  s.res.wood = BALANCE.baseCap - 0.05;
  const out = run(s, 2);
  assert.equal(s.res.wood, BALANCE.baseCap);
  assert.ok(out.some((e) => e.type === 'storageFull' && e.res === 'wood'));
});

test('offline is capped at 8 h and matches the online simulation', () => {
  const make = () => {
    const s = createState({ seed: 31 });
    const a = freeTile(s);
    place(s, 'field', a.x, a.y);
    const b = freeTile(s);
    place(s, 'sawmill', b.x, b.y);
    const c = freeTile(s);
    place(s, 'quarry', c.x, c.y);
    s.res.food = 50;
    return s;
  };
  const online = make();
  run(online, 600);
  const offline = make();
  const rep = simulate(offline, 600);
  assert.equal(rep.seconds, 600);
  for (const k of RESOURCES) {
    assert.ok(Math.abs(online.res[k] - offline.res[k]) <= Math.max(1, online.res[k] * 0.02), `${k}: ${online.res[k]} vs ${offline.res[k]}`);
  }
  const long = make();
  const rep2 = simulate(long, 10 * 3600);
  assert.equal(rep2.seconds, GAME.offlineCap);
  assert.ok(rep2.capped);
  assert.ok(rep2.fullAt.wood != null, 'wood storage fills during 8 h');
  assert.ok(rep2.overflow.wood > 0);
  assert.ok(near(long.time, GAME.offlineCap));
});

test('negative or broken offline durations do nothing', () => {
  const s = createState({ seed: 32 });
  const before = JSON.stringify(s.res);
  assert.equal(simulate(s, -500).seconds, 0);
  assert.equal(simulate(s, NaN).seconds, 0);
  assert.equal(JSON.stringify(s.res), before);
});

test('timeToAfford reports blockers', () => {
  const s = createState({ seed: 33 });
  s.res.wood = 0;
  const r1 = timeToAfford(s, { wood: 10 });
  assert.ok(Number.isFinite(r1.seconds) && r1.seconds > 0, 'brushwood income makes it finite');
  assert.equal(timeToAfford(s, { stone: 999 }).blocker, 'cap');
  s.res.stone = 0;
  assert.equal(timeToAfford(s, { stone: 10 }).blocker, 'income');
  s.res.wood = 50;
  assert.equal(timeToAfford(s, { wood: 10 }).seconds, 0);
});

test('buildingInfo exposes current and next level numbers', () => {
  const s = createState({ seed: 34 });
  const a = freeTile(s);
  const saw = place(s, 'sawmill', a.x, a.y);
  s.pop = 4;
  const info = buildingInfo(s, saw);
  assert.equal(info.slots, 2);
  assert.equal(info.workers, 2);
  assert.equal(info.next.level, 2);
  assert.ok(info.next.fullRate.wood > info.fullRate.wood);
});

/* ---------------- quests ---------------- */

test('quest chain: progress, claim, rewards, unlocks', () => {
  const s = createState({ seed: 41 });
  assert.equal(actions.claimQuest(s, 'q1').reason, 'notReady');
  const spot = freeTile(s);
  actions.build(s, 'field', spot.x, spot.y);
  assert.equal(s.quests.q1, 'done');
  const wood = s.res.wood;
  const r = actions.claimQuest(s, 'q1');
  assert.ok(r.ok);
  assert.equal(s.res.wood, wood + QUESTS[0].reward.wood);
  assert.equal(s.quests.q1, 'claimed');
  assert.equal(s.quests.q2, 'active');
  assert.deepEqual(questProgress(s, QUESTS[1]), { cur: 0, max: 2 });
  // q3 claim unlocks the market
  s.quests.q2 = 'claimed';
  s.quests.q3 = 'done';
  assert.ok(!eco.isUnlocked(s, 'market'));
  const r3 = actions.claimQuest(s, 'q3');
  assert.ok(r3.events.some((e) => e.type === 'unlocked' && e.building === 'market'));
  assert.ok(eco.isUnlocked(s, 'market'));
  assert.equal(s.quests.q4, 'active');
});

test('prestige hook is present but disabled', () => {
  const s = createState({ seed: 1 });
  assert.equal(canPrestige(s), false);
  assert.equal(applyPrestige(s).ok, false);
});

/* ---------------- save ---------------- */

test('save round-trip keeps the game identical', () => {
  const s = createState({ seed: 51, now: 111 });
  const spot = freeTile(s);
  actions.build(s, 'field', spot.x, spot.y);
  run(s, 30);
  const str = serialize(s, 5000, 'tabA');
  const { state, savedAt, tab } = parseSave(str);
  assert.equal(savedAt, 5000);
  assert.equal(tab, 'tabA');
  for (const k of ['seed', 'tiles', 'buildings', 'nextId', 'quests', 'res', 'pop', 'stats', 'meta', 'createdAt']) {
    assert.deepEqual(state[k], s[k], k);
  }
});

test('broken saves: json, format, newer version, backups', () => {
  assert.throws(() => parseSave('{oops'), (e) => e instanceof SaveError && e.code === 'json');
  assert.throws(() => parseSave('{"v":1}'), (e) => e.code === 'format');
  assert.throws(() => parseSave(JSON.stringify({ v: 999, state: {} })), (e) => e.code === 'newer');

  const good = createState({ seed: 61 });
  const goodStr = serialize(good, 1000, 'x');
  const store = memStorage({ [GAME.saveKey]: '{broken', [GAME.backupKey]: goodStr });
  const res = loadGame(store, { now: 2000, newSeed: 1 });
  assert.equal(res.status, 'backup');
  assert.equal(res.state.seed, 61);
  assert.equal(store.get(`${GAME.saveKey}.corrupt`), '{broken');

  const store2 = memStorage({ [GAME.saveKey]: '{broken' });
  assert.equal(loadGame(store2, { now: 2000, newSeed: 1 }).status, 'corrupt');

  const store3 = memStorage({ [GAME.saveKey]: JSON.stringify({ v: 999, state: {} }) });
  const r3 = loadGame(store3, { now: 1, newSeed: 1 });
  assert.equal(r3.status, 'newer');
  assert.equal(r3.readOnly, true);

  const store4 = memStorage();
  assert.equal(loadGame(store4, { now: 1, newSeed: 77 }).status, 'new');
  const s4 = createState({ seed: 77 });
  writeSave(store4, s4, 123, 't');
  const r4 = loadGame(store4, { now: 500, newSeed: 1 });
  assert.equal(r4.status, 'loaded');
  assert.equal(r4.savedAt, 123);
  assert.equal(store4.get(GAME.backupKey), store4.get(GAME.saveKey), 'loaded save becomes the backup');
});

test('migrations run in order and missing ones fail loudly', () => {
  const migs = {
    0: (d) => ({ ...d, state: { ...d.state, a: 1 } }),
    1: (d) => ({ ...d, state: { ...d.state, b: d.state.a + 1 } }),
  };
  const out = migrate({ v: 0, state: {} }, migs, 2);
  assert.equal(out.v, 2);
  assert.deepEqual(out.state, { a: 1, b: 2 });
  assert.throws(() => migrate({ v: 0, state: {} }, {}, 1), (e) => e.code === 'migration');
});

test('sanitize repairs untrusted data', () => {
  const base = createState({ seed: 71 });
  const water = findTile(base, TILE.WATER);
  const tree = findTile(base, TILE.TREE);
  const free = freeTile(base, (x, y) => !(x === base.buildings[0].x && y === base.buildings[0].y));
  const raw = {
    seed: 71,
    tiles: base.tiles,
    res: { wood: 'lots', stone: -5, food: NaN, coins: 12 },
    pop: Infinity,
    buildings: [
      { id: 1, type: 'field', x: water.x, y: water.y, level: 1 },     // on water → dropped
      { id: 2, type: 'castle', x: free.x, y: free.y, level: 1 },      // unknown → dropped
      { id: 3, type: 'sawmill', x: tree.x, y: tree.y, level: 99 },    // on a tree → tile cleared, level clamped
      { id: 3, type: 'field', x: free.x, y: free.y, level: 2 },       // duplicate id → new id
    ],
    quests: { q1: 'claimed', q2: 'banana', q3: 'claimed' },
  };
  const s = sanitize(raw);
  assert.equal(s.res.wood, BALANCE.startRes.wood);
  assert.equal(s.res.stone, 0);
  assert.equal(s.res.coins, 12);
  assert.equal(s.pop, BALANCE.startPop);
  assert.ok(!s.buildings.some((b) => b.type === 'castle'));
  assert.ok(!s.buildings.some((b) => b.x === water.x && b.y === water.y));
  const saw = s.buildings.find((b) => b.type === 'sawmill');
  assert.equal(saw.level, BALANCE.maxLevel);
  assert.ok(isBuildable(s.tiles[idx(tree.x, tree.y)]));
  const ids = s.buildings.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.ok(s.buildings.some((b) => b.type === 'hut'), 'a hut is added when missing');
  assert.ok(s.nextId > Math.max(...ids));
  assert.equal(s.quests.q1, 'claimed');
  assert.equal(s.quests.q2, 'active');
  assert.equal(s.quests.q3, 'claimed');
  assert.equal(s.quests.q4, 'locked');
});

test('settings: defaults, locale hint, stored values', () => {
  assert.equal(loadSettings(memStorage()).lang, 'pl');
  assert.equal(loadSettings(memStorage(), { locale: 'en-US' }).lang, 'en');
  const st = memStorage({ [GAME.settingsKey]: JSON.stringify({ sound: false, lang: 'en' }) });
  assert.deepEqual(loadSettings(st, { locale: 'pl-PL' }), { sound: false, lang: 'en' });
  const bad = memStorage({ [GAME.settingsKey]: '{nope' });
  assert.deepEqual(loadSettings(bad), { sound: true, lang: 'pl' });
});

/* ---------------- i18n & bus ---------------- */

test('i18n: PL and EN have the same keys and plural forms work', () => {
  const pl = Object.keys(DICTS.pl).sort();
  const en = Object.keys(DICTS.en).sort();
  assert.deepEqual(en.filter((k) => !pl.includes(k)), [], 'extra keys in EN');
  assert.deepEqual(pl.filter((k) => !en.includes(k)), [], 'missing keys in EN');
  for (const type of Object.keys(BUILDINGS)) {
    assert.ok(DICTS.pl[`b.${type}.name`] && DICTS.en[`b.${type}.name`], `name of ${type}`);
  }
  for (const q of QUESTS) assert.ok(DICTS.pl[`q.${q.id}.title`] && DICTS.en[`q.${q.id}.title`], `quest ${q.id}`);
  setLang('pl');
  assert.equal(t('unit.residents', { n: 1 }), '1 mieszkaniec');
  assert.equal(t('unit.residents', { n: 5 }), '5 mieszkańców');
  assert.equal(t('unit.huts', { n: 3 }), '3 chaty');
  assert.equal(t('unit.huts', { n: 5 }), '5 chat');
  assert.equal(t('unit.huts', { n: 22 }), '22 chaty');
  assert.equal(t('toast.built', { name: 'Pole' }), 'Postawiono: Pole');
  setLang('en');
  assert.equal(t('unit.huts', { n: 1 }), '1 hut');
  assert.equal(t('unit.huts', { n: 2 }), '2 huts');
  setLang('pl');
});

test('bus: listeners, wildcard, isolation of failures', () => {
  const bus = createBus();
  const seen = [];
  bus.on('a', (p) => seen.push(['a', p]));
  bus.on('*', (p, type) => seen.push(['*', type]));
  bus.on('a', () => { throw new Error('boom'); });
  const origError = console.error;
  console.error = () => {};
  bus.emit('a', 1);
  console.error = origError;
  assert.deepEqual(seen, [['a', 1], ['*', 'a']]);
});

/* ---------------- runner ---------------- */

let failed = 0;
const started = Date.now();
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n    ')}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed in ${Date.now() - started} ms`);
process.exit(failed ? 1 : 0);

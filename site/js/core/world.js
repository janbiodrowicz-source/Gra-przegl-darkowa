/**
 * Archipelago: a world is a list of island states plus what they share.
 *
 *  world = {
 *    islands: [state, …]   – each one a full island state (see core/state.js)
 *    main, active           – index of the home-port island the game opens on, and of the one on screen
 *    quests, meta           – SHARED objects: every island state points at the same ones
 *    scout                  – null | { from, left, total } while a ship is out | { from, offers } when back
 *    seed, found            – world seed and the number of scouting trips (seeds for new islands)
 *  }
 *
 * Every island keeps working while it is not on screen (same tick(), same
 * offline simulation). Pure logic like the rest of core: no DOM, no clock.
 */
import { BIOME_ORDER, BUILDINGS, RESOURCES, WORLD } from '../config.js?v=0.3.2';
import { createState } from './state.js?v=0.3.2';
import { canAfford, capsOf, countType, pay, scaleCost } from './economy.js?v=0.3.2';
import { simulate, tick } from './sim.js?v=0.3.2';
import { updateQuests } from './quests.js?v=0.3.2';
import { hash2 } from './rng.js?v=0.3.2';

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/** Points every island at the shared quests/meta (call after loading or adding islands). */
export function linkWorld(world) {
  world.meta.islands = world.islands.length;
  for (const s of world.islands) {
    s.quests = world.quests;
    s.meta = world.meta;
  }
  return world;
}

/** Wraps a single island state into a world (new games, v1 saves, demos). */
export function worldFromState(state) {
  return linkWorld({
    islands: [state],
    main: 0,
    active: 0,
    quests: state.quests,
    meta: state.meta,
    scout: null,
    seed: state.seed,
    found: 0,
  });
}

export function createWorld({ seed, now = 0 }) {
  return worldFromState(createState({ seed, now }));
}

export const activeIsland = (world) => world.islands[world.active];
export const mainIsland = (world) => world.islands[world.main];

/* ---------------------------------------------------------------- time */

/**
 * Advances every island by dt. Events of the island on screen pass through;
 * from the others only what matters everywhere (quests) or needs attention
 * (hunger) — tagged with the island index.
 */
export function tickWorld(world, dt, out = null) {
  for (let i = 0; i < world.islands.length; i++) {
    if (i === world.active) {
      tick(world.islands[i], dt, out);
    } else {
      const evs = out ? [] : null;
      tick(world.islands[i], dt, evs);
      if (out) for (const e of evs) if (BACKGROUND_EVENTS.has(e.type)) out.push({ ...e, island: i });
    }
  }
  advanceScout(world, dt, out);
}

const BACKGROUND_EVENTS = new Set(['questDone', 'hungerStart', 'hungerEnd']);

/**
 * Offline progress for the whole archipelago. Returns the report of the island
 * on screen (what the welcome screen shows) plus a short summary of the others.
 */
export function simulateWorld(world, seconds, opts = {}) {
  let report = null;
  const others = [];
  for (let i = 0; i < world.islands.length; i++) {
    const r = simulate(world.islands[i], seconds, opts);
    if (i === world.active) report = r;
    else others.push({ island: i, gained: r.gained, hungrySeconds: r.hungrySeconds, popGained: r.popGained });
  }
  // background islands stay quiet (their summary is enough); a returning ship is news
  advanceScout(world, report.seconds, report.events);
  report.others = others;
  return report;
}

/* ---------------------------------------------------------------- islands */

export function setActive(world, index) {
  if (!Number.isInteger(index) || !world.islands[index]) return fail('notFound');
  if (index === world.active) return { ok: true, events: [] };
  world.active = index;
  return { ok: true, events: [{ type: 'islandSwitched', island: index }] };
}

export function setMain(world, index) {
  if (!Number.isInteger(index) || !world.islands[index]) return fail('notFound');
  world.main = index;
  return { ok: true, events: [{ type: 'mainChanged', island: index }] };
}

/** Biomes that can still be found. */
export function freeBiomes(world) {
  const owned = new Set(world.islands.map((s) => s.biome));
  return BIOME_ORDER.filter((b) => !owned.has(b));
}

/* ---------------------------------------------------------------- port & scouting */

/** Scouting trip length from an island (its port level makes ships faster; farther seas take longer). */
export function scoutTime(state, islands = 1) {
  const port = state.buildings.find((b) => BUILDINGS[b.type]?.port);
  const level = port ? port.level : 1;
  return WORLD.scoutTime * Math.pow(WORLD.scoutTimeGrowth, Math.max(0, islands - 1)) / (1 + WORLD.scoutSpeedPerLevel * (level - 1));
}

/** The newest island must grow a little before the next trip (null when it may go). */
export function growthNeeded(world) {
  if (world.islands.length < 2) return null;
  const newest = world.islands[world.islands.length - 1];
  const pop = Math.floor(newest.pop + 1e-9);
  return pop >= WORLD.growBeforeNext ? null : { island: world.islands.length - 1, pop, need: WORLD.growBeforeNext };
}

export function hasPort(state) {
  return state.buildings.some((b) => BUILDINGS[b.type]?.port);
}

/** Why scouting from `index` is impossible right now (null when it is possible). */
export function scoutBlocker(world, index) {
  const s = world.islands[index];
  if (!s) return 'notFound';
  if (!hasPort(s)) return 'noPort';
  if (world.islands.length >= WORLD.maxIslands || !freeBiomes(world).length) return 'maxIslands';
  if (world.scout && world.scout.left > 0) return 'scoutBusy';
  if (growthNeeded(world)) return 'growFirst';
  if (!canAfford(s.res, WORLD.scoutCost)) return 'cost';
  return null;
}

export function startScout(world, index) {
  const why = scoutBlocker(world, index);
  if (why) return fail(why, { cost: WORLD.scoutCost });
  const s = world.islands[index];
  pay(s.res, WORLD.scoutCost);
  const total = scoutTime(s, world.islands.length);
  world.scout = { from: index, left: total, total };
  return { ok: true, events: [{ type: 'scoutStarted', island: index, seconds: total }] };
}

function advanceScout(world, dt, out) {
  const sc = world.scout;
  if (!sc || !(sc.left > 0)) return;
  sc.left = Math.max(0, sc.left - dt);
  if (sc.left > 0) return;
  world.found++;
  const biomes = freeBiomes(world);
  // a stable shuffle of what is left, seeded by the world and the trip number
  const pick = biomes
    .map((b, i) => ({ b, k: hash2(world.found, i, world.seed) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, WORLD.offers);
  sc.offers = pick.map(({ b }, i) => ({ biome: b, seed: ((world.seed ^ (world.found * 0x9e3779b1)) + i * 7919) >>> 0 }));
  delete sc.left;
  delete sc.total;
  if (out) out.push({ type: 'scoutReturned', island: sc.from, offers: sc.offers.length });
}

/** Price of settling the next island. */
export function colonizeCost(world) {
  return scaleCost(WORLD.colonizeCost, Math.pow(WORLD.colonizeGrowth, Math.max(0, world.islands.length - 1)));
}

/**
 * Settles one of the islands found by the last trip. Paid by the island the
 * ship sailed from; the newcomers start like the very first settlers.
 */
export function colonize(world, offerIndex, now = 0) {
  const sc = world.scout;
  const offer = sc?.offers?.[offerIndex];
  if (!offer) return fail('notFound');
  if (world.islands.length >= WORLD.maxIslands) return fail('maxIslands');
  const from = world.islands[sc.from];
  const cost = colonizeCost(world);
  if (!canAfford(from.res, cost)) return fail('cost', { cost });
  pay(from.res, cost);
  const island = createState({ seed: offer.seed, now, biome: offer.biome });
  // no tutorial hints again on the new island; the first ship brings settlers and supplies
  island.flags.hints = { ...from.flags.hints };
  island.res = { ...island.res, ...WORLD.settlerCargo };
  island.pop = WORLD.settlerPop;
  island.stats.maxPop = island.pop;
  world.islands.push(island);
  world.scout = null;
  linkWorld(world);
  const index = world.islands.length - 1;
  const events = [{ type: 'colonized', island: index, biome: offer.biome, cost }];
  updateQuests(island, events);
  return { ok: true, island: index, events };
}

/** Throws the offers away (e.g. to scout again). */
export function dismissOffers(world) {
  if (world.scout?.offers) world.scout = null;
  return { ok: true, events: [] };
}

/** Short status of every island for the archipelago window. */
export function islandSummaries(world) {
  return world.islands.map((s, i) => ({
    index: i,
    biome: s.biome,
    pop: Math.floor(s.pop + 1e-9),
    buildings: s.buildings.length,
    hungry: !!s.flags.hungry,
    full: RESOURCES.filter((k) => s.flags.full[k]),
    port: hasPort(s),
    main: i === world.main,
    active: i === world.active,
    caps: capsOf(s),
    huts: countType(s, 'hut'),
  }));
}


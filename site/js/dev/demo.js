/**
 * Demo settlement for screenshots and manual testing (?demo).
 * Built with the real actions, so it is always a valid state.
 */
import { QUESTS } from '../config.js';
import { createState } from '../core/state.js';
import { build, clearTile, suggestSpot, upgrade } from '../core/actions.js';
import { capsOf, popCapOf } from '../core/economy.js';
import { getRates } from '../core/sim.js';
import { N } from '../core/map.js';
import { linkWorld, worldFromState } from '../core/world.js';

/** stage 1: ~15 min town (quest 5); stage 2: ~40 min town with the second wave. */
export function buildDemoState(seed = 20261103, stage = 1) {
  const s = createState({ seed, now: Date.now() });
  const claimed = stage === 2 ? 10 : 4;
  for (const q of QUESTS.slice(0, claimed)) s.quests[q.id] = 'claimed';
  s.quests[QUESTS[claimed].id] = 'active';
  const plenty = () => { s.res = { wood: 1e5, stone: 1e5, food: 1e5, coins: 1e5 }; };
  plenty();

  const plan = [
    ['field', 2], ['hut', 2], ['sawmill', 1], ['quarry', 1], ['market', 1],
    ['hut', 2], ['warehouse', 1], ['field', 2], ['sawmill', 1],
  ];
  if (stage === 2) {
    plan.push(['well', 1], ['field', 2], ['mill', 1], ['bakery', 1], ['fisher', 1], ['hut', 3],
      ['flowers', 3], ['fountain', 1], ['market', 1], ['warehouse', 1]);
  }
  for (const [type, n] of plan) {
    for (let i = 0; i < n; i++) {
      const spot = suggestSpot(s, type);
      if (spot) build(s, type, spot.x, spot.y);
    }
  }
  // A few upgrades so the levels show.
  const byType = (type) => s.buildings.filter((b) => b.type === type);
  for (const b of [byType('hut')[0], byType('sawmill')[0], byType('field')[0], byType('market')[0]]) {
    if (!b) continue;
    upgrade(s, b.id);
    if (b.type !== 'market') upgrade(s, b.id);
  }
  // Chop one tree so a stump-free clearing exists next to town.
  for (let i = 0; i < s.tiles.length; i++) {
    if (s.tiles[i] === 't') {
      clearTile(s, i % N, Math.floor(i / N));
      break;
    }
  }

  const caps = capsOf(s);
  s.res = { wood: Math.round(caps.wood * 0.72), stone: Math.round(caps.stone * 0.46), food: Math.round(caps.food * 0.61), coins: Math.round(caps.coins * 0.55) };
  s.pop = popCapOf(s) - 1;
  s.stats.maxPop = s.pop;
  if (stage === 2) {
    plenty();
    for (const b of s.buildings) if (b.type === 'hut' || b.type === 'flowers') { upgrade(s, b.id); upgrade(s, b.id); upgrade(s, b.id); }
    const caps2 = capsOf(s);
    s.res = { wood: Math.round(caps2.wood * 0.6), stone: Math.round(caps2.stone * 0.5), food: Math.round(caps2.food * 0.7), coins: Math.round(caps2.coins * 0.4) };
    s.pop = popCapOf(s) - 2;
    s.stats.maxPop = s.pop;
  }
  s.time = stage === 2 ? 40 * 60 : 15 * 60;
  getRates(s);
  return s;
}

/** stage 3: the archipelago — home island with a harbour, two settled islands, scouts back with offers. */
export function buildDemoWorld(seed = 20261103) {
  const home = buildDemoState(seed, 2);
  for (const q of QUESTS.slice(0, 15)) home.quests[q.id] = 'claimed';
  home.quests.q16 = 'claimed';
  home.quests.q17 = 'active';
  const world = worldFromState(home);
  const settle = (biome, s2, plan) => {
    const isl = createState({ seed: s2, now: Date.now(), biome });
    isl.res = { wood: 1e5, stone: 1e5, food: 1e5, coins: 1e5 };
    world.islands.push(isl);
    linkWorld(world);
    for (const [type, n] of plan) for (let i = 0; i < n; i++) {
      const spot = suggestSpot(isl, type);
      if (spot) build(isl, type, spot.x, spot.y);
    }
    const caps = capsOf(isl);
    isl.res = { wood: Math.round(caps.wood * 0.5), stone: Math.round(caps.stone * 0.8), food: Math.round(caps.food * 0.4), coins: 120 };
    isl.pop = popCapOf(isl) - 1;
    return isl;
  };
  home.res = { wood: 1e5, stone: 1e5, food: 1e5, coins: 1e5 };
  const portSpot = suggestSpot(home, 'port');
  if (portSpot) build(home, 'port', portSpot.x, portSpot.y);
  const caps = capsOf(home);
  home.res = { wood: Math.round(caps.wood * 0.6), stone: Math.round(caps.stone * 0.5), food: Math.round(caps.food * 0.7), coins: Math.round(caps.coins * 0.6) };
  settle('snow', seed + 11, [['field', 2], ['hut', 3], ['quarry', 3], ['sawmill', 1], ['warehouse', 1]]);
  settle('tropic', seed + 23, [['fisher', 3], ['hut', 4], ['field', 1], ['sawmill', 1], ['market', 1], ['flowers', 2]]);
  world.islands[2].flags.hungry = true; // shows the red dot
  world.found = 2;
  world.scout = { from: 0, offers: [{ biome: 'forest', seed: seed + 31 }, { biome: 'fertile', seed: seed + 47 }] };
  return linkWorld(world);
}

export const DEMO_REPORT = Object.freeze({
  requested: 3 * 3600 + 14 * 60,
  seconds: 3 * 3600 + 14 * 60,
  capped: false,
  gained: { wood: 1240, stone: 386, food: 212, coins: 2150 },
  overflow: { wood: 310, stone: 0, food: 0, coins: 0 },
  fullAt: { wood: 2520 },
  hungerAt: null,
  hungrySeconds: 0,
  popGained: 2,
  events: [],
});


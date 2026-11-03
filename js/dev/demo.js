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

export function buildDemoState(seed = 20261103) {
  const s = createState({ seed, now: Date.now() });
  for (const q of QUESTS.slice(0, 4)) s.quests[q.id] = 'claimed';
  s.quests.q5 = 'active';
  const plenty = () => { s.res = { wood: 1e5, stone: 1e5, food: 1e5, coins: 1e5 }; };
  plenty();

  const plan = [
    ['field', 2], ['hut', 2], ['sawmill', 1], ['quarry', 1], ['market', 1],
    ['hut', 2], ['warehouse', 1], ['field', 2], ['sawmill', 1],
  ];
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
  s.res = { wood: Math.round(caps.wood * 0.72), stone: Math.round(caps.stone * 0.46), food: Math.round(caps.food * 0.61), coins: 1260 };
  s.pop = popCapOf(s) - 1;
  s.stats.maxPop = s.pop;
  s.time = 15 * 60;
  getRates(s);
  return s;
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


#!/usr/bin/env node
/**
 * Balance bot: plays the archipelago with the real core (no DOM) and checks
 * the pacing targets.  Usage:  node tools/balance.mjs [--minutes=120] [--seeds=5] [--verbose]
 *
 * Two player profiles:
 *   active – checks in every 3 s (an engaged first session), chops a few trees early
 *   casual – checks in every 45 s (glances at the game), chops at most 2 trees
 */
import { BALANCE, BUILDINGS, BUILDING_ORDER, CAPPED, QUESTS, WORLD } from '../site/js/config.js?v=0.3.2';
import { colonize, colonizeCost, createWorld, growthNeeded, hasPort, scoutBlocker, startScout, tickWorld } from '../site/js/core/world.js?v=0.3.2';
import { createState } from '../site/js/core/state.js?v=0.3.2';
import { buildCost, canAfford, countType, isUnlocked, upgradeCost, charmOf, housingOf } from '../site/js/core/economy.js?v=0.3.2';
import { build, claimQuest, clearTile, placementPreview, suggestSpot, upgrade } from '../site/js/core/actions.js?v=0.3.2';
import { currentQuest, questProgress } from '../site/js/core/quests.js?v=0.3.2';
import { getRates, tick, timeToAfford } from '../site/js/core/sim.js?v=0.3.2';
import { N, idx } from '../site/js/core/map.js?v=0.3.2';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v = 'true'] = a.replace(/^--/, '').split('=');
  return [k, v];
}));
const MINUTES = Number(args.minutes || 120);
const LONG = MINUTES >= 55;     // second-wave targets only make sense for a full hour
const WORLDLY = MINUTES >= 110; // archipelago targets need two hours
const SEEDS = Number(args.seeds || 5);
const VERBOSE = args.verbose === 'true';

const PROFILES = {
  active: { every: 3, actionsPerCheck: 2, maxChops: 10, chopUntil: 300 },
  casual: { every: 45, actionsPerCheck: 4, maxChops: 2, chopUntil: 120 },
};

const fmtT = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ------------------------------------------------------------------ bot */

function wants(s, growing = false) {
  const r = getRates(s);
  const list = [];
  const want = (kind, type, why, id = null) => list.push({ kind, type, why, id });
  const popCap = r.popCap;
  const q = currentQuest(s);
  if (growing && s.pop >= popCap - 2) wantHousing(s, want, 'quest grow');

  // 1) food first: never let the town starve for long
  const futureCons = Math.max(s.pop, Math.min(popCap, s.pop + 4)) * BALANCE.foodPerPerson;
  if (r.hungry || r.gross.food < futureCons + 0.05) want('build', bestMaker(s, 'food'), 'food');

  // 1b) idle hands → more production of the scarcest resource (wood is used by everything)
  if (r.idle >= 2) {
    const score = { wood: r.gross.wood / 1, stone: r.gross.stone / 0.45 };
    if (countType(s, 'market') > 0) score.coins = r.gross.coins / 0.5;
    const res = Object.entries(score).sort((a, b) => a[1] - b[1])[0][0];
    want('build', bestMaker(s, res), 'idle hands');
  }

  // 2) freshly unlocked buildings are irresistible
  for (const type of ['market', 'warehouse', 'fisher', 'well', 'mill', 'bakery', 'flowers', 'fountain', 'port']) {
    if (isUnlocked(s, type) && countType(s, type) === 0) want('build', type, 'new');
  }

  // 3) the current quest
  if (q && s.quests[q.id] === 'active') {
    const g = q.goal;
    if (g.type === 'have') {
      for (const [type, n] of Object.entries(g.buildings)) if (countType(s, type) < n) want('build', type, `quest ${q.id}`);
    } else if (g.type === 'pop') {
      if (popCap < g.count) wantHousing(s, want, `quest ${q.id}`);
    } else if (g.type === 'charm') {
      const c = bestCharm(s);
      if (c) want(c.kind, c.type, `quest ${q.id}`, c.id);
    } else if (g.type === 'resource') {
      if (r.caps[g.res] < g.amount) want('build', 'warehouse', `quest ${q.id}`);
      else if (r.net[g.res] < 0.5) want('build', bestMaker(s, g.res), `quest ${q.id}`);
    } else if (g.type === 'level') {
      // the cheapest way to get one building to the required level
      const best = [...s.buildings].filter((b) => b.level < g.level && upgradeCost(b))
        .sort((a, b) => (g.level - a.level) * sumCost(upgradeCost(a)) - (g.level - b.level) * sumCost(upgradeCost(b)))[0];
      if (best) want('upgrade', best.type, `quest ${q.id}`, best.id);
    }
  }

  // 5) housing when full and people are needed
  if (s.pop >= popCap - 0.5 && r.jobs >= popCap - 1) wantHousing(s, want, 'housing');

  // 6) storage when full or when something does not fit
  if (isUnlocked(s, 'warehouse')) {
    const fullish = ['wood', 'stone'].some((k) => s.res[k] >= r.caps[k] * 0.95);
    const blocked = list.some((w) => w.kind === 'build' && timeToAfford(s, buildCost(s, w.type), r).blocker === 'cap');
    if (fullish || blocked) want('build', 'warehouse', 'storage');
  }

  // 7) upgrade the producer of the scarcest resource when people are available
  if (r.idle >= 1) {
    const need = { wood: r.gross.wood / 1, stone: r.gross.stone / 0.6, coins: r.gross.coins / 0.5 };
    if (r.gross.food < futureCons + 0.3) need.food = 0;
    const res = Object.entries(need).sort((a, b) => a[1] - b[1])[0]?.[0];
    const ups = s.buildings.filter((b) => BUILDINGS[b.type].produce && res in BUILDINGS[b.type].produce && upgradeCost(b))
      .sort((a, b) => sumCost(upgradeCost(a)) - sumCost(upgradeCost(b)));
    if (ups[0]) want('upgrade', ups[0].type, 'upgrade', ups[0].id);
  }
  // 7b) charm pays for itself once there is a coin economy
  if (isUnlocked(s, 'flowers') && r.gross.coins > 0.8) {
    const c = bestCharm(s);
    if (c) want(c.kind, c.type, 'charm', c.id);
  }
  // 8) otherwise more huts (more taxes, more people)
  wantHousing(s, want, 'grow');
  return { list, rates: r };
}

/** The unlocked building that makes `res` most cheaply (rate per resource spent). */
function bestMaker(s, res) {
  let best = null, bestScore = -Infinity;
  for (const type of BUILDING_ORDER) {
    const def = BUILDINGS[type];
    if (!def.produce || !(res in def.produce) || !isUnlocked(s, type)) continue;
    const spot = suggestSpot(s, type);
    if (!spot) continue;
    const prev = placementPreview(s, type, spot.x, spot.y);
    const score = (prev.rate?.[res] ?? 0) / (sumCost(buildCost(s, type)) * (def.workers || 1));
    if (score > bestScore) { bestScore = score; best = type; }
  }
  return best || (res === 'food' ? 'field' : res === 'wood' ? 'sawmill' : res === 'stone' ? 'quarry' : 'market');
}

/** A new hut, or upgrading one when that houses people more cheaply (or the island is full). */
function wantHousing(s, want, why) {
  const spot = suggestSpot(s, 'hut');
  const newCost = sumCost(buildCost(s, 'hut')) / housingOf('hut', 1);
  const huts = s.buildings.filter((b) => b.type === 'hut' && upgradeCost(b))
    .map((b) => ({ b, per: sumCost(upgradeCost(b)) / (housingOf('hut', b.level + 1) - housingOf('hut', b.level)) }))
    .sort((a, b) => a.per - b.per);
  if (huts[0] && (!spot || huts[0].per < newCost * 0.9)) want('upgrade', 'hut', why, huts[0].b.id);
  else if (spot) want('build', 'hut', why);
}

/** Cheapest charm per resource: a new flowerbed/fountain or an upgrade of one. */
function bestCharm(s) {
  const opts = [];
  for (const type of ['flowers', 'fountain']) {
    if (isUnlocked(s, type) && suggestSpot(s, type)) opts.push({ kind: 'build', type, per: sumCost(buildCost(s, type)) / charmOf(type, 1) });
  }
  for (const b of s.buildings) {
    if (!BUILDINGS[b.type].charm || !upgradeCost(b)) continue;
    opts.push({ kind: 'upgrade', type: b.type, id: b.id, per: sumCost(upgradeCost(b)) / (charmOf(b.type, b.level + 1) - charmOf(b.type, b.level)) });
  }
  return opts.sort((a, b) => a.per - b.per)[0] || null;
}

const sumCost = (c) => Object.values(c).reduce((a, b) => a + b, 0);

function costOf(s, w) {
  if (w.kind === 'build') return buildCost(s, w.type);
  const b = s.buildings.find((o) => o.id === w.id);
  return b ? upgradeCost(b) : null;
}

function rockTarget(s) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (s.tiles[idx(x, y)] !== 'r') continue;
      let useful = false;
      for (const b of s.buildings) if (b.type === 'quarry' && Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) <= 1) useful = true;
      if (!useful) return { x, y };
    }
  }
  return null;
}

function chopTarget(s) {
  // a tree that no sawmill benefits from
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (s.tiles[idx(x, y)] !== 't') continue;
      let useful = false;
      for (const b of s.buildings) if (b.type === 'sawmill' && Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) <= 1) useful = true;
      if (!useful) return { x, y };
    }
  }
  return null;
}

function play(seed, profile, minutes, log) {
  const world = createWorld({ seed, now: 0 });
  const s = world.islands[0]; // the home island: pacing milestones are measured here
  const events = [];
  const actions = [];
  const milestones = {};
  let chops = 0;
  let stuck = 0;
  let maxStuck = 0;
  const T = minutes * 60;
  const out = [];
  const note = (t, text) => { events.push({ t, text }); if (log) out.push(`${fmtT(t)}  ${text}`); };

  /** One check-in on one island: claim-free actions, saving up for archipelago goals. */
  function islandTurn(isl, t, home) {
    let done = 0;
    // archipelago: scouting and settling come first and are worth saving for
    const index = world.islands.indexOf(isl);
    if (world.scout?.offers && world.scout.from === index) {
      const cost = colonizeCost(world);
      if (canAfford(isl.res, cost)) {
        const r = colonize(world, 0, 0);
        if (r.ok) {
          note(t, `⚓ settle ${world.islands[r.island].biome} (island ${world.islands.length})`);
          milestones[`island_${world.islands.length}`] ??= t;
          actions.push(t);
          return;
        }
      } else if (timeToAfford(isl, cost).seconds < 300) return; // save up
    }
    if (!world.scout && hasPort(isl)) {
      const why = scoutBlocker(world, index);
      if (!why) {
        startScout(world, index);
        note(t, '⛵ scout');
        milestones.firstScout ??= t;
        actions.push(t);
        done++;
      } else if (why === 'cost' && timeToAfford(isl, WORLD.scoutCost).seconds < 90) return;
    }
    let blockedByWood = false;
    let blockedByStone = false;
    let guard = 0;
    // the newest island must reach N residents before the next trip: homes (and food) first
    const growing = growthNeeded(world)?.island === index;
    while (done < profile.actionsPerCheck && guard++ < 6) {
      const { list, rates } = wants(isl, growing); // re-evaluated after every action
      let acted = false;
      for (const w of list) {
        if (w.kind === 'build' && !isUnlocked(isl, w.type)) continue;
        const cost = costOf(isl, w);
        if (!cost) continue;
        if (!canAfford(isl.res, cost)) {
          if ((cost.wood ?? 0) > isl.res.wood) blockedByWood = true;
          else if ((cost.stone ?? 0) > isl.res.stone) blockedByStone = true;
          // the top priorities are worth waiting for if they come soon
          const eta = timeToAfford(isl, cost, rates).seconds;
          if (eta < 40 && (w.why === 'food' || w.why.startsWith('quest'))) break;
          if (eta < 60 && w.why === 'new') break; // worth saving up for a brand-new building
          if (eta < 240 && w.type === 'port') break; // the harbour opens the world
          continue;
        }
        let r;
        if (w.kind === 'build') {
          const spot = suggestSpot(isl, w.type);
          if (!spot) continue;
          r = build(isl, w.type, spot.x, spot.y);
          if (r.ok) {
            note(t, `${home ? '' : `[${isl.biome}] `}build ${w.type} (${w.why})`);
            if (home) milestones.firstBuild ??= t;
          }
        } else {
          r = upgrade(isl, w.id);
          if (r.ok) note(t, `${home ? '' : `[${isl.biome}] `}upgrade ${w.type} → ${r.building.level} (${w.why})`);
        }
        if (r && r.ok) {
          done++;
          actions.push(t);
          acted = true;
          break;
        }
      }
      if (!acted) break;
    }
    if (!done && (blockedByWood || blockedByStone) && (home ? chops < profile.maxChops && t <= profile.chopUntil : true)) {
      const spot = blockedByWood ? chopTarget(isl) : rockTarget(isl);
      if (spot && clearTile(isl, spot.x, spot.y).ok) {
        if (home) chops++;
        note(t, `${home ? '' : `[${isl.biome}] `}chop`);
        actions.push(t);
      }
    }
  }

  for (let t = 0; t <= T; t++) {
    if (t % profile.every === 0) {
      // claim first (free); rewards go to the island the quest was finished on — the bot uses home
      for (const q of QUESTS) {
        if (s.quests[q.id] === 'done') {
          const r = claimQuest(s, q.id);
          if (r.ok) {
            note(t, `★ claim ${q.id}`);
            actions.push(t);
            for (const e of r.events) if (e.type === 'unlocked') { note(t, `  unlocked ${e.building}`); milestones[`unlock_${e.building}`] ??= t; }
          }
        }
      }
      for (const isl of world.islands) islandTurn(isl, t, isl === s);
      // dead-end detector (home island): nothing affordable soon and no income for what is missing
      const r2 = getRates(s);
      const anySoon = BUILDING_ORDER.some((type) => isUnlocked(s, type) && timeToAfford(s, buildCost(s, type), r2).seconds < 120);
      stuck = anySoon || world.islands.length > 1 ? 0 : stuck + profile.every;
      maxStuck = Math.max(maxStuck, stuck);
    }
    const evs = [];
    tickWorld(world, 1, evs);
    for (const e of evs) {
      if (e.type === 'questDone') { note(t, `✓ ${e.id} done`); milestones[`done_${e.id}`] ??= t; }
      if (e.island != null) continue;
      if (e.type === 'scoutReturned') note(t, '⛵ scouts back');
      if (e.type === 'hungerStart') { note(t, '! hunger'); milestones.firstHunger ??= t; }
      if (e.type === 'hungerEnd') note(t, '  fed again');
      if (e.type === 'storageFull') {
        note(t, `▣ ${e.res} full`);
        if (e.res !== 'food') milestones.firstFull ??= t;
      }
    }
    if (log && t % 60 === 0 && t > 0) {
      const r = getRates(s);
      out.push(`${fmtT(t)}  · wood ${s.res.wood.toFixed(0)} (${r.net.wood.toFixed(2)}/s) stone ${s.res.stone.toFixed(0)} (${r.net.stone.toFixed(2)}) food ${s.res.food.toFixed(0)} (${r.net.food.toFixed(2)}) coins ${s.res.coins.toFixed(0)} (${r.net.coins.toFixed(2)}) pop ${s.pop.toFixed(1)}/${r.popCap} jobs ${r.jobs} buildings ${s.buildings.length}${world.islands.length > 1 ? ` | islands ${world.islands.map((i) => `${i.biome}:${Math.floor(i.pop)}`).join(' ')}` : ''}`);
    }
  }
  // gaps between actions
  const gaps = (from, to) => {
    const ts = [from, ...actions.filter((a) => a > from && a < to), to];
    let max = 0;
    for (let i = 1; i < ts.length; i++) max = Math.max(max, ts[i] - ts[i - 1]);
    return max;
  };
  return {
    seed,
    milestones,
    maxGapEarly: gaps(0, Math.min(T, 300)),
    maxGapMid: T > 300 ? gaps(300, Math.min(T, 900)) : 0,
    maxGapLate: T > 900 ? gaps(900, T) : 0,
    actions: actions.length,
    chops,
    maxStuck,
    final: { buildings: s.buildings.length, pop: Math.floor(s.pop), quests: QUESTS.filter((q) => s.quests[q.id] === 'claimed').length, islands: world.islands.length },
    log: out,
  };
}

/* --------------------------------------------------------------- report */

// Pacing milestones are judged by the median over islands (layouts differ: a forest next to the
// sawmill or rocks by the quarry change the tempo); gaps and dead ends by the worst island.
// The bot plays like a very focused player; humans read, explore and hesitate (≈1.3–1.5× slower),
// so the windows sit a bit before the design targets (≈8 min / 6–10 min / 12–15 min).
const TARGETS = [
  ['first build', (r) => r.milestones.firstBuild, (v) => v != null && v <= 10, '≤ 0:10', 'all'],
  ['all 6 buildings unlocked', (r) => Math.max(r.milestones.unlock_market ?? Infinity, r.milestones.unlock_warehouse ?? Infinity), (v) => v >= 4.5 * 60 && v <= 9 * 60, '4:30–9:00', 'median'],
  ['first full wood/stone', (r) => r.milestones.firstFull ?? Infinity, (v) => v >= 4 * 60 && v <= 10 * 60, '4–10 min', 'median'],
  ['quest 5 done', (r) => r.milestones.done_q5 ?? Infinity, (v) => v >= 9 * 60 && v <= 14 * 60, '9–14 min', 'median'],
  ['quest 10 done', (r) => r.milestones.done_q10 ?? Infinity, (v) => !LONG || (v >= 20 * 60 && v <= 32 * 60), '20–32 min', 'median'],
  ['quest 14 done', (r) => r.milestones.done_q14 ?? Infinity, (v) => !LONG || (v >= 38 * 60 && v <= 55 * 60), '38–55 min', 'median'],
  ['harbour built', (r) => r.milestones.firstScout ?? Infinity, (v) => !WORLDLY || (v >= 42 * 60 && v <= 60 * 60), '42–60 min', 'median'],
  ['2nd island', (r) => r.milestones.island_2 ?? Infinity, (v) => !WORLDLY || (v >= 45 * 60 && v <= 65 * 60), '45–65 min', 'median'],
  ['5th island', (r) => r.milestones.island_5 ?? Infinity, (v) => !WORLDLY || (v >= 70 * 60 && v <= 105 * 60), '70–105 min', 'median'],
  ['max gap 0–5 min', (r) => r.maxGapEarly, (v) => v <= 70, '≤ 70 s', 'all'],
  ['max gap 5–15 min', (r) => r.maxGapMid, (v) => v <= 150, '≤ 150 s', 'all'],
  ['max gap after 15 min', (r) => r.maxGapLate, (v) => v <= 180, '≤ 180 s', 'all'],
  ['dead ends', (r) => r.maxStuck, (v) => v < 120, '< 120 s', 'all'],
];

const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};

let failures = 0;
for (const [name, profile] of Object.entries(PROFILES)) {
  const runs = [];
  for (let i = 0; i < SEEDS; i++) runs.push(play(1000 + i * 7919, profile, MINUTES, VERBOSE && i === 0));
  console.log(`\n=== ${name} player (check-in every ${profile.every}s, ${SEEDS} islands, ${MINUTES} min) ===`);
  if (VERBOSE) console.log(runs[0].log.join('\n'));
  const cell = (v) => (v == null || !Number.isFinite(v) ? '—' : fmtT(v));
  for (const [label, get, ok, target, agg] of TARGETS) {
    const values = runs.map(get);
    const seconds = label.startsWith('max gap') || label === 'dead ends';
    const verdict = agg === 'median' ? ok(median(values)) : values.every((v) => ok(v));
    const pass = name === 'active' ? verdict : true; // targets are for an engaged first session
    if (!pass) failures++;
    const shown = seconds ? values.map((v) => `${v}s`) : values.map(cell);
    const aggText = agg === 'median' ? `median ${cell(median(values))}` : 'every island';
    console.log(`${pass ? '✓' : '✗'} ${label.padEnd(26)} ${shown.join('  ').padEnd(58)} ${aggText.padEnd(16)} target ${target}`);
  }
  const f = runs[0].final;
  console.log(`  milestones (seed ${runs[0].seed}): ${Object.entries(runs[0].milestones).map(([k, v]) => `${k}=${fmtT(v)}`).join(', ')}`);
  console.log(`  after ${MINUTES} min: ${f.buildings} buildings, ${f.pop} residents, ${f.quests}/${QUESTS.length} quests, ${f.islands} islands, ${runs[0].actions} actions, ${runs[0].chops} chops`);
}
console.log(failures ? `\n${failures} target(s) missed` : '\nAll pacing targets met ✨');
process.exit(failures ? 1 : 0);

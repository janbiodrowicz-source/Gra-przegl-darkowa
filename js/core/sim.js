/**
 * Simulation: derived data (workers, rates, caps), the fixed-step tick,
 * offline progress and helper queries for the UI. Pure logic — time is
 * always passed in, never read from a clock.
 */
import { BALANCE, BUILDINGS, CAPPED, GAME, RESOURCES } from '../config.js';
import {
  adjacencyBonus, baseRateOf, capsOf, emptyRes, housingOf, occupancy, popCapOf,
  producesFood, refundOf, slotsOf, storageOf, upgradeCost,
} from './economy.js';
import { prestigeMultiplier } from './prestige.js';
import { updateQuests } from './quests.js';

const cache = new WeakMap();

/** Forces derived data to be recomputed (call after manual state edits). */
export function invalidate(state) {
  state.rev = (state.rev || 0) + 1;
}

/**
 * Derived data, memoised per (state.rev, whole residents).
 * Workers are assigned automatically: fields first (food keeps the town alive),
 * then every other producer round-robin.
 */
export function derive(state) {
  const workers = Math.max(0, Math.floor(state.pop + 1e-9));
  const hit = cache.get(state);
  if (hit && hit.rev === state.rev && hit.workers === workers) return hit.data;
  const data = computeDerived(state, workers);
  cache.set(state, { rev: state.rev, workers, data });
  return data;
}

function computeDerived(state, workers) {
  const occ = occupancy(state);
  const caps = capsOf(state);
  const popCap = popCapOf(state);

  const producers = [];
  let jobs = 0;
  for (const b of state.buildings) {
    if (!BUILDINGS[b.type]?.produce) continue;
    producers.push(b);
    jobs += slotsOf(b.type, b.level);
  }

  const alloc = new Map();
  let left = workers;
  const groups = [producers.filter((b) => producesFood(b.type)), producers.filter((b) => !producesFood(b.type))];
  for (const group of groups) {
    let progressed = true;
    while (left > 0 && progressed) {
      progressed = false;
      for (const b of group) {
        if (left <= 0) break;
        const cur = alloc.get(b.id) || 0;
        if (cur < slotsOf(b.type, b.level)) {
          alloc.set(b.id, cur + 1);
          left--;
          progressed = true;
        }
      }
    }
  }

  const prod = emptyRes();
  const per = new Map();
  const pm = prestigeMultiplier(state);
  for (const b of producers) {
    const slots = slotsOf(b.type, b.level);
    const w = alloc.get(b.id) || 0;
    const staff = slots > 0 ? w / slots : 1;
    const bonus = adjacencyBonus(state, b.type, b.x, b.y, occ);
    const base = baseRateOf(b.type, b.level);
    const rate = {};
    for (const k in base) {
      rate[k] = base[k] * staff * (1 + bonus) * pm;
      prod[k] += rate[k];
    }
    per.set(b.id, { workers: w, slots, staff, bonus, base, rate });
  }

  return { occ, caps, popCap, jobs, workers, employed: workers - left, idle: left, prod, per };
}

/** Production multiplier while the granary is empty (1 = no hunger). */
export function hungerMultiplier(foodStock, foodProd, consumption) {
  if (foodStock > 1e-6 || foodProd >= consumption) return 1;
  const satisfied = consumption > 0 ? Math.min(1, foodProd / consumption) : 1;
  return 1 - BALANCE.hungerPenalty * (1 - satisfied);
}

/**
 * Current per-second rates for the UI.
 * gross: what flows in; net: gross minus consumption (only food is consumed).
 */
export function getRates(state) {
  const d = derive(state);
  const consumption = state.pop * BALANCE.foodPerPerson;
  const mult = hungerMultiplier(state.res.food, d.prod.food, consumption);
  const taxes = Math.floor(state.pop + 1e-9) * BALANCE.taxPerPerson;
  const gross = {
    wood: d.prod.wood * mult + BALANCE.gatherWood,
    stone: d.prod.stone * mult,
    food: d.prod.food,
    coins: (d.prod.coins + taxes) * mult,
  };
  const net = { ...gross, food: d.prod.food - consumption };
  return { ...d, gross, net, consumption: { food: consumption }, taxes, mult, hungry: mult < 0.9999 };
}

/**
 * Advances the simulation by `dt` seconds.
 * @param {object[]|null} out     receives events ({ type, ... })
 * @param {object|null}   report  offline report being accumulated (see simulate)
 */
export function tick(state, dt, out = null, report = null) {
  if (!(dt > 0)) return;
  const d = derive(state);
  const B = BALANCE;
  const r = state.res;
  const produced = state.stats.produced;

  // 1) Food first: it decides whether the town is hungry this step.
  const consumption = state.pop * B.foodPerPerson;
  const foodNet = d.prod.food - consumption;
  let mult = 1;
  produced.food += d.prod.food * dt;
  if (foodNet < 0 && r.food + foodNet * dt <= 0) {
    const available = r.food / dt + d.prod.food;
    const satisfied = consumption > 0 ? Math.min(1, available / consumption) : 1;
    mult = 1 - B.hungerPenalty * (1 - satisfied);
    r.food = 0;
  } else {
    r.food += foodNet * dt;
  }

  // 2) Everything else (hunger slows it down; brushwood gathering always works).
  const taxes = Math.floor(state.pop + 1e-9) * B.taxPerPerson;
  const wood = (d.prod.wood * mult + B.gatherWood) * dt;
  const stone = d.prod.stone * mult * dt;
  const coins = (d.prod.coins + taxes) * mult * dt;
  r.wood += wood;
  r.stone += stone;
  r.coins += coins;
  produced.wood += wood;
  produced.stone += stone;
  produced.coins += coins;

  // 3) Storage limits.
  for (const k of CAPPED) {
    const cap = d.caps[k];
    if (r[k] >= cap - 1e-9) {
      if (r[k] > cap) {
        if (report) report.overflow[k] += r[k] - cap;
        r[k] = cap;
      }
      if (report && report.fullAt[k] == null) report.fullAt[k] = report.elapsed;
      if (!state.flags.full[k]) {
        state.flags.full[k] = true;
        if (out) out.push({ type: 'storageFull', res: k });
      }
    } else if (state.flags.full[k] && r[k] < cap * 0.98) {
      state.flags.full[k] = false;
    }
  }

  // 4) Population grows into free housing while everybody is fed.
  const hungry = mult < 0.9999;
  if (!hungry && state.pop < d.popCap) state.pop = Math.min(d.popCap, state.pop + B.popGrowth * dt);
  if (state.pop > d.popCap) state.pop = d.popCap;
  if (state.pop > state.stats.maxPop) state.stats.maxPop = state.pop;

  if (report && hungry) report.hungrySeconds += dt;
  if (hungry !== state.flags.hungry) {
    state.flags.hungry = hungry;
    if (out) out.push({ type: hungry ? 'hungerStart' : 'hungerEnd' });
    if (hungry && report && report.hungerAt == null) report.hungerAt = report.elapsed;
  }

  updateQuests(state, out);
  state.time += dt;
}

/**
 * Simulates `seconds` of offline time (capped) in coarse steps using the same tick().
 * @returns {object} report: { requested, seconds, capped, gained, overflow, fullAt, hungerAt, hungrySeconds, popGained, events }
 */
export function simulate(state, seconds, { step = GAME.offlineStep, cap = GAME.offlineCap } = {}) {
  const requested = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const total = Math.min(requested, cap);
  const startRes = { ...state.res };
  const startPop = state.pop;
  const report = {
    requested,
    seconds: total,
    capped: requested > cap + 1e-6,
    gained: {},
    overflow: emptyRes(),
    fullAt: {},
    hungerAt: state.flags.hungry ? 0 : null,
    hungrySeconds: 0,
    popGained: 0,
    elapsed: 0,
    events: [],
  };
  let t = 0;
  while (t < total - 1e-9) {
    const dt = Math.min(step, total - t);
    report.elapsed = t;
    tick(state, dt, report.events, report);
    t += dt;
  }
  report.elapsed = total;
  for (const k of RESOURCES) report.gained[k] = state.res[k] - startRes[k];
  report.popGained = state.pop - startPop;
  return report;
}

/**
 * How long until `cost` is affordable at current rates.
 * blocker: null | 'cap' (cost exceeds storage) | 'income' (no income of a missing resource)
 */
export function timeToAfford(state, cost, rates = getRates(state)) {
  let worst = 0;
  for (const k in cost) {
    const need = cost[k] - (state.res[k] ?? 0);
    if (need <= 1e-9) continue;
    if (cost[k] > (rates.caps[k] ?? Infinity) + 1e-9) return { seconds: Infinity, blocker: 'cap', res: k };
    const rate = rates.net[k];
    if (!(rate > 1e-9)) return { seconds: Infinity, blocker: 'income', res: k };
    worst = Math.max(worst, need / rate);
  }
  return { seconds: worst, blocker: null, res: null };
}

/** Everything the details panel needs about one building. */
export function buildingInfo(state, b, rates = getRates(state)) {
  const p = rates.per.get(b.id);
  const bonus = p ? p.bonus : adjacencyBonus(state, b.type, b.x, b.y);
  const rate = {};
  if (p) for (const k in p.rate) rate[k] = k === 'food' ? p.rate[k] : p.rate[k] * rates.mult;
  const fullRate = scaleRate(baseRateOf(b.type, b.level), 1 + bonus);
  const cost = upgradeCost(b);
  return {
    id: b.id,
    type: b.type,
    level: b.level,
    maxLevel: BALANCE.maxLevel,
    bonus,
    workers: p ? p.workers : 0,
    slots: slotsOf(b.type, b.level),
    housing: housingOf(b.type, b.level),
    storage: storageOf(b.type, b.level),
    rate,
    fullRate,
    upgradeCost: cost,
    refund: refundOf(b),
    next: cost ? {
      level: b.level + 1,
      slots: slotsOf(b.type, b.level + 1),
      housing: housingOf(b.type, b.level + 1),
      storage: storageOf(b.type, b.level + 1),
      fullRate: scaleRate(baseRateOf(b.type, b.level + 1), 1 + bonus),
    } : null,
  };
}

function scaleRate(rate, k) {
  if (!rate) return null;
  const out = {};
  for (const key in rate) out[key] = rate[key] * k;
  return out;
}

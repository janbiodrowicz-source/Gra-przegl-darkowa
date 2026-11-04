/**
 * Quest chain logic. Status per quest: 'locked' → 'active' → 'done' → 'claimed'.
 */
import { BUILDINGS, BUILDING_ORDER, QUESTS } from '../config.js?v=0.3.4';
import { capsOf, countType, grant, totalCharm } from './economy.js?v=0.3.4';

export function getQuest(id) {
  return QUESTS.find((q) => q.id === id) || null;
}

/** Progress of a quest goal as { cur, max }. */
export function questProgress(state, quest) {
  const g = quest.goal;
  switch (g.type) {
    case 'have': {
      let cur = 0, max = 0;
      for (const [type, need] of Object.entries(g.buildings)) {
        cur += Math.min(need, countType(state, type));
        max += need;
      }
      return { cur, max };
    }
    case 'pop':
      return { cur: Math.min(g.count, Math.floor(state.pop + 1e-9)), max: g.count };
    case 'level': {
      let best = 0;
      for (const b of state.buildings) if (b.level > best) best = b.level;
      return { cur: Math.min(best, g.level), max: g.level };
    }
    case 'cleared':
      return { cur: Math.min(state.stats.cleared, g.count), max: g.count };
    case 'islands':
      return { cur: Math.min(state.meta?.islands ?? 1, g.count), max: g.count };
    case 'charm':
      return { cur: Math.min(totalCharm(state), g.amount), max: g.amount };
    case 'resource':
      return { cur: Math.min(Math.floor(state.res[g.res] ?? 0), g.amount), max: g.amount };
    default:
      return { cur: 0, max: 1 };
  }
}

export function isQuestComplete(state, quest) {
  const p = questProgress(state, quest);
  return p.cur >= p.max;
}

/** Marks active quests whose goal is met as done. Pushes events into `out`. */
export function updateQuests(state, out = null) {
  for (const q of QUESTS) {
    if (state.quests[q.id] === 'active' && isQuestComplete(state, q)) {
      state.quests[q.id] = 'done';
      if (out) out.push({ type: 'questDone', id: q.id });
    }
  }
}

/** The quest to show in the tracker: first one that is active or done. */
export function currentQuest(state) {
  for (const q of QUESTS) {
    const s = state.quests[q.id];
    if (s === 'active' || s === 'done') return q;
  }
  return null;
}

export function questList(state) {
  return QUESTS.map((q) => ({ quest: q, status: state.quests[q.id], progress: questProgress(state, q) }));
}

export function claimableCount(state) {
  let n = 0;
  for (const q of QUESTS) if (state.quests[q.id] === 'done') n++;
  return n;
}

/** Buildings unlocked by claiming quest `id`. */
export function unlocksOf(id) {
  return BUILDING_ORDER.filter((type) => BUILDINGS[type].unlock === id);
}

/** Claims a finished quest: grants the reward, applies unlocks, activates the next quest. */
export function claimQuest(state, id) {
  const quest = getQuest(id);
  if (!quest) return { ok: false, reason: 'notFound' };
  if (state.quests[id] !== 'done') return { ok: false, reason: 'notReady' };

  const granted = grant(state.res, quest.reward, capsOf(state));
  state.quests[id] = 'claimed';
  const events = [{ type: 'questClaimed', id, reward: quest.reward, granted }];
  for (const building of unlocksOf(id)) events.push({ type: 'unlocked', building });

  const next = QUESTS[QUESTS.indexOf(quest) + 1];
  if (next && state.quests[next.id] === 'locked') {
    state.quests[next.id] = 'active';
    events.push({ type: 'questActivated', id: next.id });
  }
  updateQuests(state, events);
  return { ok: true, granted, events };
}

/**
 * Bottom bar: building cards (cost, time-to-afford, locks) and the placement
 * bar that replaces them while a building is being placed (✕ / info / ✓).
 */
import { BUILDING_ORDER, BUILDINGS } from '../config.js';
import { t } from '../i18n.js';
import { buildCost, canAfford, countType, isUnlocked } from '../core/economy.js';
import { canPlace, placementPreview } from '../core/actions.js';
import { getQuest } from '../core/quests.js';
import { timeToAfford } from '../core/sim.js';
import { h, setClass, setText } from './dom.js';
import { amounts, chip, icon } from './icons.js';
import { fmt, fmtClock, fmtPct } from './format.js';

export function createBuildBar({ onCard, onConfirm, onCancel, artFor }) {
  const cards = {};

  for (const type of BUILDING_ORDER) {
    const costEls = {};
    const costRow = h('span.card__cost', null, Object.keys(BUILDINGS[type].cost).map((res) => {
      const num = h('span.cost__num');
      const el = h(`span.cost.cost--${res}`, null, h('span', { html: icon(res) }), num);
      costEls[res] = { el, num };
      return el;
    }));
    const eta = h('span.card__eta');
    const count = h('span.card__count');
    const art = h('span.card__art');
    art.append(artFor ? artFor(type) : h('span', { html: icon(type) }));
    const el = h('button.card', { type: 'button', dataset: { type }, 'aria-label': t(`b.${type}.name`), onclick: () => onCard(type) },
      count,
      h('span.card__new', null, t('ui.newBadge')),
      eta,
      art,
      h('span.card__lock', { html: icon('lock') }),
      h('span.card__name', null, t(`b.${type}.name`)),
      costRow);
    cards[type] = { el, costEls, eta, count, art };
  }

  const track = h('div.buildbar__track', null, BUILDING_ORDER.map((type) => cards[type].el));

  // Placement bar
  const pArt = h('span.placebar__art');
  const pTitle = h('span.placebar__title');
  const pMeta = h('span.placebar__meta');
  const confirm = h('button.btn.btn--primary.btn--round.placebar__ok', { type: 'button', 'aria-label': t('ui.place'), onclick: onConfirm, html: icon('check') });
  const placebar = h('div.placebar', null,
    h('button.btn.btn--round.placebar__cancel', { type: 'button', 'aria-label': t('ui.cancel'), onclick: onCancel, html: icon('close') }),
    h('div.placebar__info', null, pArt, h('span.placebar__text', null, pTitle, pMeta)),
    confirm);
  const hint = h('div.placehint');

  const el = h('nav.buildbar', { 'aria-label': t('ui.build') }, track, placebar, hint);
  let placingType = null;

  function update(state, rates, ui) {
    for (const type of BUILDING_ORDER) {
      const c = cards[type];
      const unlocked = isUnlocked(state, type);
      const cost = buildCost(state, type);
      const afford = unlocked && canAfford(state.res, cost);
      for (const [res, { el: costEl, num }] of Object.entries(c.costEls)) {
        setText(num, fmt(cost[res] ?? 0));
        setClass(costEl, 'is-missing', unlocked && (state.res[res] ?? 0) + 1e-9 < (cost[res] ?? 0));
      }
      setClass(c.el, 'is-locked', !unlocked);
      setClass(c.el, 'is-poor', unlocked && !afford);
      setClass(c.el, 'is-active', ui.mode === 'place' && ui.placing === type);
      setClass(c.el, 'is-new', unlocked && !!state.flags.hints[`new_${type}`]);
      const n = countType(state, type);
      setText(c.count, n ? `×${n}` : '');
      if (unlocked && !afford) {
        const eta = timeToAfford(state, cost, rates);
        setText(c.eta, eta.blocker === 'cap' ? t('ui.capShort') : eta.blocker ? '—' : fmtClock(eta.seconds));
        setClass(c.eta, 'is-blocked', !!eta.blocker);
      }
    }

    const placing = ui.mode === 'place';
    setClass(el, 'is-placing', placing);
    if (placing) {
      if (placingType !== ui.placing) {
        placingType = ui.placing;
        pArt.replaceChildren(artFor ? artFor(ui.placing) : h('span', { html: icon(ui.placing) }));
        setText(pTitle, t(`b.${ui.placing}.name`));
      }
      const g = ui.ghost;
      let ok = false;
      let key = 'none';
      let nodes = null;
      if (g) {
        const check = canPlace(state, ui.placing, g.x, g.y);
        ok = check.ok;
        if (ok) {
          const prev = placementPreview(state, ui.placing, g.x, g.y);
          key = `ok:${g.x},${g.y}:${prev.bonus}`;
          nodes = [...amounts(prev.rate || {}, { rate: true })];
          if (prev.bonus > 0) nodes.push(chip('sparkle', fmtPct(prev.bonus)));
          if (!nodes.length) nodes.push(t(`b.${ui.placing}.desc`));
        } else {
          key = `bad:${check.reason}`;
          nodes = [t(`reason.${check.reason}`)];
        }
      } else {
        nodes = [t('reason.occupied')];
      }
      if (pMeta.__key !== key) {
        pMeta.__key = key;
        pMeta.replaceChildren(...nodes);
      }
      setClass(pMeta, 'is-bad', !ok);
      confirm.disabled = !ok;
      setText(hint, ui.hint || '');
      setClass(hint, 'is-shown', !!ui.hint);
    } else {
      placingType = null;
      setClass(hint, 'is-shown', false);
    }
  }

  /** Explains why a card can't be used right now. */
  function whyNot(state, rates, type) {
    if (!isUnlocked(state, type)) {
      const q = getQuest(BUILDINGS[type].unlock);
      return { reason: 'locked', text: t('ui.unlockBy', { quest: q ? t(`q.${q.id}.title`) : '?' }) };
    }
    const cost = buildCost(state, type);
    if (!canAfford(state.res, cost)) {
      const eta = timeToAfford(state, cost, rates);
      const missing = {};
      for (const [k, v] of Object.entries(cost)) if ((state.res[k] ?? 0) < v) missing[k] = Math.ceil(v - state.res[k]);
      const tail = eta.blocker === 'cap' ? t('ui.capTooSmall') : eta.blocker ? t('ui.noIncome') : t('ui.affordIn', { t: fmtClock(eta.seconds) });
      return { reason: 'cost', text: [`${t('ui.missing')} `, ...amounts(missing), ` · ${tail}`] };
    }
    return null;
  }

  return { el, update, whyNot, cards };
}

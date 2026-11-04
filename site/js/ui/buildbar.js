/**
 * Bottom bar: building cards (cost, time-to-afford, locks) and the placement
 * bar that replaces them while a building is being placed (✕ / info / ✓).
 */
import { BUILDING_ORDER, BUILDINGS } from '../config.js?v=0.3.4';
import { t } from '../i18n.js?v=0.3.4';
import { buildCost, canAfford, countType, isUnlocked } from '../core/economy.js?v=0.3.4';
import { canPlace, placementPreview } from '../core/actions.js?v=0.3.4';
import { getQuest } from '../core/quests.js?v=0.3.4';
import { timeToAfford } from '../core/sim.js?v=0.3.4';
import { h, retrigger, setClass, setText } from './dom.js?v=0.3.4';
import { amounts, chip, icon } from './icons.js?v=0.3.4';
import { fmt, fmtClock, fmtPct } from './format.js?v=0.3.4';

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
      h('span.card__hand', { html: icon('hand') }),
      eta,
      art,
      h('span.card__lock', { html: icon('lock') }),
      h('span.card__name', null, t(`b.${type}.name`)),
      costRow);
    cards[type] = { el, costEls, eta, count, art };
  }

  const track = h('div.buildbar__track', null, BUILDING_ORDER.map((type) => cards[type].el));
  // desktop: a plain mouse wheel scrolls the cards sideways; fades show there is more
  const edges = () => {
    const over = track.scrollWidth > track.clientWidth + 2;
    setClass(track, 'is-overflow', over);
    setClass(track, 'at-start', over && track.scrollLeft < 4);
    setClass(track, 'at-end', over && track.scrollLeft > track.scrollWidth - track.clientWidth - 4);
  };
  track.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || track.scrollWidth <= track.clientWidth) return;
    track.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  track.addEventListener('scroll', edges, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(edges).observe(track);

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
      // a little "pop" the moment a building becomes affordable
      if (c.wasAffordable === false && afford) retrigger(c.el, 'is-ready');
      c.wasAffordable = afford;
      setClass(c.el, 'is-active', ui.mode === 'place' && ui.placing === type);
      setClass(c.el, 'is-new', unlocked && !!state.flags.hints[`new_${type}`]);
      setClass(c.el, 'is-hinted', ui.hintCard === type && afford && ui.mode !== 'place');
      const n = countType(state, type);
      setText(c.count, n ? `×${n}` : '');
      if (unlocked && !afford) {
        const eta = timeToAfford(state, cost, rates);
        // no income of a missing resource: show WHICH one is missing ("🪨 brak")
        const key = eta.blocker === 'income' ? `inc:${eta.res}` : eta.blocker === 'cap' ? 'cap' : fmtClock(eta.seconds);
        if (c.eta.__key !== key) {
          c.eta.__key = key;
          if (eta.blocker === 'income') c.eta.replaceChildren(h('span', { html: icon(eta.res) }), t('ui.noneShort'));
          else c.eta.textContent = eta.blocker === 'cap' ? t('ui.capShort') : key;
        }
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
          key = `ok:${g.x},${g.y}:${prev.bonus}:${prev.auraCount}`;
          nodes = [...amounts(prev.rate || {}, { rate: true })];
          if (prev.bonus > 0) nodes.push(chip('sparkle', fmtPct(prev.bonus)));
          if (prev.aura) nodes.push(chip('drop', t('ui.auraFor', { pct: Math.round(prev.aura * 100), n: prev.auraCount })));
          if (prev.charm) nodes.push(chip('sparkle', `${t('ui.charm')} +${prev.charm}`));
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
      if (eta.blocker === 'income') {
        return { reason: 'income', res: eta.res, text: [`${t('ui.missing')} `, ...amounts(missing), ` — ${sourceHint(state, eta.res)}`] };
      }
      const tail = eta.blocker === 'cap' ? t('ui.capTooSmall') : t('ui.affordIn', { t: fmtClock(eta.seconds) });
      return { reason: 'cost', text: [`${t('ui.missing')} `, ...amounts(missing), ` · ${tail}`] };
    }
    return null;
  }

  /** Scrolls the bar so a card is visible (e.g. right after it was unlocked). */
  function reveal(type) {
    const card = cards[type]?.el;
    if (!card || track.scrollWidth <= track.clientWidth) return;
    const left = card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2;
    track.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }

  return { el, update, whyNot, cards, reveal };
}

/** Where a resource comes from — the first unlocked producer, or the next quest that unlocks one. */
export function sourceHint(state, res) {
  const makers = BUILDING_ORDER.filter((type) => BUILDINGS[type].produce && res in BUILDINGS[type].produce);
  const open = makers.filter((type) => isUnlocked(state, type));
  const extra = res === 'stone' && state.tiles.includes('r') ? t('src.rock') : res === 'wood' && state.tiles.includes('t') ? t('src.tree') : '';
  if (open.length) {
    const names = open.slice(0, 2).map((type) => t(`b.${type}.name`)).join(t('src.or'));
    return t('src.build', { names }) + (extra ? t('src.or') + extra : '');
  }
  if (extra) return extra;
  const q = makers.length ? getQuest(BUILDINGS[makers[0]].unlock) : null;
  return q ? t('src.quest', { quest: t(`q.${q.id}.title`), name: t(`b.${makers[0]}.name`) }) : t('src.wait');
}

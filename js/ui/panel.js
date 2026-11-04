/**
 * Slide-in details panel (bottom sheet on phones, right sidebar on wide screens)
 * for a selected building or a tree/rock tile.
 */
import { BALANCE, BUILDINGS } from '../config.js';
import { t } from '../i18n.js';
import { canAfford, getBuilding } from '../core/economy.js';
import { demolishPreview } from '../core/actions.js';
import { buildingInfo } from '../core/sim.js';
import { idx } from '../core/map.js';
import { h, setClass, setText } from './dom.js';
import { amounts, chip, icon } from './icons.js';
import { fmt, fmtPct, fmtRate } from './format.js';

function costChips(cost) {
  return Object.entries(cost).map(([k, v]) => h(`span.cost.cost--${k}`, null, h('span', { html: icon(k) }), h('span.cost__num', null, fmt(v))));
}

/** Replaces children only when the content key changes (no DOM churn at 10 Hz). */
function setNodes(el, key, build) {
  if (el.__key === key) return;
  el.__key = key;
  el.replaceChildren(...build());
}

function stat(label, valueNode, extraClass = '') {
  return h(`div.stat${extraClass}`, null, h('span.stat__label', null, label), h('span.stat__value', null, valueNode));
}

export function createPanel({ onUpgrade, onDemolish, onClear, onClose, artFor }) {
  const el = h('aside.panel', { 'aria-hidden': 'true', role: 'region', 'aria-label': t('ui.details') });
  let target = null;
  let refs = null;
  let confirmTimer = 0;

  function close() {
    if (!target) return;
    target = null;
    refs = null;
    clearTimeout(confirmTimer);
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
  }

  function header(artNode, title, sub) {
    const subEl = h('div.panel__sub', null, sub);
    const head = h('div.panel__head', null,
      h('div.panel__art', null, artNode),
      h('div.panel__titles', null, h('h2.panel__title', null, title), subEl),
      h('button.icon-btn.panel__close', { type: 'button', 'aria-label': t('ui.close'), onclick: onClose, html: icon('close') }));
    return { head, subEl };
  }

  function renderBuilding(state, rates, b) {
    const def = BUILDINGS[b.type];
    const { head, subEl } = header(artFor ? artFor(b.type, b.level) : h('span', { html: icon(b.type) }), t(`b.${b.type}.name`), '');
    const pips = h('div.pips', { 'aria-hidden': 'true' }, Array.from({ length: BALANCE.maxLevel }, () => h('i')));
    const stats = h('div.stats');
    const r = { kind: 'building', id: b.id, subEl, pips, stats, statRefs: {} };

    if (def.produce) {
      for (const res of Object.keys(def.produce)) {
        const v = h('span.stat__num');
        r.statRefs[`rate_${res}`] = v;
        stats.append(stat(t('ui.production'), [h('span', { html: icon(res) }), v]));
      }
      const w = h('span.stat__num');
      r.statRefs.workers = w;
      stats.append(stat(t('ui.workers'), [h('span.stat__glyph', { html: icon('worker') }), w]));
    }
    if (def.housing) {
      const v = h('span.stat__num');
      r.statRefs.housing = v;
      stats.append(stat(t('ui.housing'), [h('span', { html: icon('pop') }), v]));
      const tax = h('span.stat__num');
      r.statRefs.tax = tax;
      stats.append(stat(t('ui.taxes'), [h('span', { html: icon('coins') }), tax]));
    }
    if (def.storage) {
      const v = h('span.stat__num');
      r.statRefs.storage = v;
      stats.append(stat(t('ui.storage'), [h('span.stat__glyph', { html: icon('box') }), v]));
    }
    if (def.adjacency) {
      const v = h('span.stat__num');
      r.statRefs.bonus = v;
      const rule = h('span.stat__rule', null, t(`adj.${def.adjacency.kind}`, { pct: Math.round(def.adjacency.bonus * 100) }));
      const glyph = def.adjacency.kind === 'hut' ? 'home' : def.adjacency.kind;
      stats.append(h('div.stat.stat--bonus.stat--wide', null,
        h('span.stat__label', null, t('ui.bonus')),
        h('span.stat__value', null, h('span', { html: icon(glyph) }), v, rule)));
    }

    if (def.aura) {
      const v = h('span.stat__num');
      r.statRefs.aura = v;
      const names = def.aura.targets.map((type) => t(`b.${type}.name`)).join(', ');
      r.statRefs.auraRule = h('span.stat__rule');
      r.statRefs.auraNames = names;
      stats.append(h('div.stat.stat--bonus.stat--wide', null,
        h('span.stat__label', null, t('ui.aura')),
        h('span.stat__value', null, h('span', { html: icon('drop') }), v, r.statRefs.auraRule)));
    }
    if (def.charm) {
      const v = h('span.stat__num');
      r.statRefs.charm = v;
      stats.append(stat(t('ui.charm'), [h('span', { html: icon('sparkle') }), v]));
      const tot = h('span.stat__num');
      r.statRefs.charmTotal = tot;
      stats.append(stat(t('ui.charmTotal'), [h('span', { html: icon('coins') }), tot]));
      stats.append(h('div.stat.stat--wide', null, h('span.stat__rule', null, t('ui.charmRule', { pct: Math.round(BALANCE.charmCoinBonus * 100) }))));
    }

    r.next = h('div.next');
    r.upCost = h('span.btn__costrow');
    r.upBtn = h('button.btn.btn--primary.btn--block.panel__upgrade', { type: 'button', onclick: () => onUpgrade(b.id) },
      h('span.btn__icon', { html: icon('up') }),
      h('span.btn__stack', null, h('span.btn__label', null, t('ui.upgrade')), r.upCost));
    r.demoLabel = h('span.btn__label');
    r.demoBtn = h('button.btn.btn--danger.panel__demolish', { type: 'button', 'aria-label': t('ui.demolish'), onclick: () => armDemolish(b.id) },
      h('span.btn__icon', { html: icon('trash') }), r.demoLabel);

    el.replaceChildren(head,
      h('div.panel__body', null, h('p.panel__desc', null, t(`b.${b.type}.desc`)), pips, stats, r.next),
      h('div.panel__foot', null, h('div.panel__actions', null, r.upBtn, r.demoBtn)));
    return r;
  }

  function renderTile(state, x, y, code) {
    const yieldDef = BALANCE.clearYield[code];
    const { head } = header(h('span.panel__glyph', { html: icon(code === 't' ? 'tree' : 'rock') }), t(`tile.${code}.name`), t('ui.nature'));
    const btn = h('button.btn.btn--primary.btn--block', { type: 'button', onclick: () => onClear(x, y) },
      h('span.btn__icon', { html: icon(code === 't' ? 'axe' : 'pick') }), h('span.btn__label', null, t(`ui.clear.${code}`)),
      h('span.btn__cost', null, amounts(yieldDef, { sign: '+' })));
    el.replaceChildren(head,
      h('div.panel__body', null, h('p.panel__desc', null, t(`tile.${code}.desc`))),
      h('div.panel__foot', null, h('div.panel__actions', null, btn)));
    return { kind: 'tile', x, y, code };
  }

  function armDemolish(id) {
    if (!refs || refs.kind !== 'building') return;
    if (refs.armed) {
      clearTimeout(confirmTimer);
      refs.armed = false;
      onDemolish(id);
      return;
    }
    refs.armed = true;
    refs.demoBtn.classList.add('is-armed');
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      if (!refs) return;
      refs.armed = false;
      refs.demoBtn.classList.remove('is-armed');
    }, 3200);
  }

  function open(next, state, rates) {
    target = next;
    refs = null;
    render(state, rates);
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
  }

  function render(state, rates) {
    if (!target) return;
    if (target.kind === 'building') {
      const b = getBuilding(state, target.id);
      if (!b) return close();
      refs = renderBuilding(state, rates, b);
      refs.level = b.level;
    } else {
      const code = state.tiles[idx(target.x, target.y)];
      if (code !== 't' && code !== 'r') return close();
      refs = renderTile(state, target.x, target.y, code);
    }
    update(state, rates);
  }

  function update(state, rates) {
    if (!target || !refs) return;
    if (target.kind === 'tile') {
      const code = state.tiles[idx(target.x, target.y)];
      if (code !== refs.code) close();
      return;
    }
    const b = getBuilding(state, target.id);
    if (!b) return close();
    if (refs.level !== b.level) {
      // level changed (upgrade): re-render art and labels
      const armed = refs.armed;
      refs = renderBuilding(state, rates, b);
      refs.level = b.level;
      refs.armed = armed;
    }
    const info = buildingInfo(state, b, rates);
    setText(refs.subEl, t('ui.levelOf', { n: b.level, max: BALANCE.maxLevel }));
    [...refs.pips.children].forEach((pip, i) => setClass(pip, 'is-on', i < b.level));
    const s = refs.statRefs;
    for (const res of Object.keys(info.fullRate || {})) {
      if (s[`rate_${res}`]) setText(s[`rate_${res}`], fmtRate(info.rate[res] ?? 0));
    }
    if (s.workers) {
      setText(s.workers, `${info.workers}/${info.slots}`);
      setClass(s.workers.parentNode.parentNode, 'is-warn', info.workers < info.slots);
    }
    if (s.housing) setText(s.housing, String(info.housing));
    if (s.tax) setText(s.tax, fmtRate(info.housing * BALANCE.taxPerPerson * info.coinMult));
    if (s.aura) {
      setText(s.aura, fmtPct(info.aura));
      setText(s.auraRule, t('ui.auraRule', { pct: Math.round(info.aura * 100), names: s.auraNames }));
    }
    if (s.charm) setText(s.charm, `+${info.charm}`);
    if (s.charmTotal) setText(s.charmTotal, fmtPct(info.coinMult - 1));
    if (s.storage) setText(s.storage, `+${fmt(info.storage)}`);
    if (s.bonus) setText(s.bonus, fmtPct(info.bonus));

    // next level preview
    if (info.next) {
      const n = info.next;
      setNodes(refs.next, `n:${b.level}:${info.bonus}:${info.coinMult}`, () => {
        const nodes = [h('b', null, `${t('ui.nextLevel', { n: n.level })}:`)];
        if (n.fullRate) nodes.push(...amounts(n.fullRate, { rate: true }));
        if (n.slots) nodes.push(chip('worker', String(n.slots)));
        if (n.housing) nodes.push(chip('pop', String(n.housing)));
        if (n.storage) nodes.push(chip('box', `+${fmt(n.storage)}`));
        if (n.aura) nodes.push(chip('drop', fmtPct(n.aura)));
        if (n.charm) nodes.push(chip('sparkle', `+${n.charm}`));
        return nodes;
      });
      const afford = canAfford(state.res, info.upgradeCost);
      setNodes(refs.upCost, `c:${b.level}`, () => costChips(info.upgradeCost));
      for (const el of refs.upCost.children) {
        const res = [...el.classList].find((c) => c.startsWith('cost--'))?.slice(6);
        setClass(el, 'is-missing', !!res && (state.res[res] ?? 0) + 1e-9 < info.upgradeCost[res]);
      }
      refs.upBtn.disabled = false;
      setClass(refs.upBtn, 'is-poor', !afford);
      setClass(refs.upBtn, 'is-pulsing', afford);
    } else {
      setNodes(refs.next, 'max', () => [h('b', null, t('ui.maxLevel'))]);
      refs.upBtn.disabled = true;
      setClass(refs.upBtn, 'is-pulsing', false);
      setNodes(refs.upCost, 'max', () => []);
    }

    // demolish label (refund, or why not)
    const prev = demolishPreview(state, b.id);
    refs.demoBtn.disabled = !prev.ok;
    if (refs.armed && prev.ok) {
      const lostKey = Object.entries(prev.lost).map(([k, v]) => `${k}${Math.floor(v)}`).join();
      setNodes(refs.demoLabel, `armed:${JSON.stringify(prev.refund)}:${lostKey}`, () => {
        const nodes = [`${t('ui.demolishConfirm')} `, ...amounts(prev.refund, { sign: '+' })];
        if (Object.keys(prev.lost).length) nodes.push(` · ${t('ui.lost')} `, ...amounts(prev.lost, { sign: '−' }));
        return nodes;
      });
    } else {
      setNodes(refs.demoLabel, prev.ok ? 'idle' : `no:${prev.reason}`, () => [prev.ok ? t('ui.demolish') : t(`reason.${prev.reason}`)]);
      refs.demoBtn.classList.remove('is-armed');
    }
  }

  return {
    el,
    open,
    close,
    update,
    refresh: (state, rates) => render(state, rates),
    get target() { return target; },
  };
}

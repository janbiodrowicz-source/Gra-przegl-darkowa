/**
 * Top HUD: resource chips (value, rate, storage bar), population,
 * the current quest pill and the settings button.
 */
import { BALANCE, CAPPED, RESOURCES } from '../config.js?v=0.3.3';
import { t } from '../i18n.js?v=0.3.3';
import { currentQuest, questProgress } from '../core/quests.js?v=0.3.3';
import { h, setClass, setText, setVar } from './dom.js?v=0.3.3';
import { icon } from './icons.js?v=0.3.3';
import { fmt, fmtRate } from './format.js?v=0.3.3';

export function createHud({ onChip, onQuests, onClaim, onSettings, onIslands }) {
  const chips = {};

  const chip = (key) => {
    const val = h('span.res__val');
    const rate = h('span.res__rate');
    const fill = h('i');
    const capped = CAPPED.includes(key);
    const el = h(`button.res.res--${key}`, {
      type: 'button',
      'aria-label': t(`res.${key}`),
      onclick: () => onChip(key, el),
    },
    h('span.res__ico', { html: icon(key) }),
    h('span.res__txt', null, val, rate),
    capped ? h('span.res__cap', null, fill) : null);
    chips[key] = { el, val, rate, fill: capped ? fill : null, last: null };
    return el;
  };

  const qTitle = h('span.qpill__title');
  const qCount = h('span.qpill__count');
  const qFill = h('i');
  const qMain = h('button.qpill__main', { type: 'button', 'aria-label': t('ui.quests'), onclick: onQuests },
    h('span.qpill__ico', { html: icon('quest') }),
    h('span.qpill__body', null,
      h('span.qpill__line', null, qTitle, qCount),
      h('span.qpill__bar', null, qFill)));
  const qClaim = h('button.btn.btn--gold.btn--sm.qpill__claim', { type: 'button', onclick: (e) => onClaim(e.currentTarget) }, t('ui.claim'));
  const qpill = h('div.qpill', null, qMain, qClaim);

  // archipelago: shows the island on screen; a dot when another island needs you
  const islIco = h('span.hud-isl__ico');
  const islDot = h('span.hud-isl__dot');
  const islBtn = h('button.hud-isl', { type: 'button', 'aria-label': t('isl.open'), title: t('isl.open'), onclick: () => onIslands?.() }, islIco, islDot);
  let islKey = '';

  const gear = h('button.hud-btn', { type: 'button', 'aria-label': t('ui.settings'), onclick: onSettings, html: icon('gear') });

  const el = h('header.hud', null,
    h('div.hud__res', null, RESOURCES.map(chip)),
    h('div.hud__aux', null, h('div.hud__spacer'), chip('pop'), qpill, islBtn, h('div.hud__spacer.hud__spacer--end'), gear));

  function update(state, rates, world = null) {
    if (world) {
      const shown = world.islands.length > 1 || world.quests.q14 === 'claimed';
      setClass(islBtn, 'is-shown', shown);
      const key = `${state.biome}`;
      if (islKey !== key) {
        islKey = key;
        islIco.innerHTML = icon(`isl_${state.biome || 'home'}`);
      }
      const alert = world.scout?.offers ? 'good' : world.islands.some((s, i) => i !== world.active && s.flags.hungry) ? 'bad' : '';
      setClass(islDot, 'is-good', alert === 'good');
      setClass(islDot, 'is-bad', alert === 'bad');
      setText(islDot, world.islands.length > 1 ? String(world.islands.length) : '');
    }
    for (const k of RESOURCES) {
      const c = chips[k];
      const value = state.res[k];
      const cap = rates.caps[k];
      const full = Number.isFinite(cap) && value >= cap - 0.5;
      const hungry = k === 'food' && rates.hungry;
      setText(c.val, fmt(value));
      let rateText;
      if (hungry) rateText = t('ui.hungry');
      else if (full) rateText = t('ui.full');
      else rateText = fmtRate(rates.net[k]);
      setText(c.rate, rateText);
      setClass(c.rate, 'is-neg', hungry || (!full && rates.net[k] < -0.004));
      setClass(c.rate, 'is-zero', !full && !hungry && Math.abs(rates.net[k]) < 0.005);
      setClass(c.el, 'is-full', full);
      setClass(c.el, 'is-hungry', hungry);
      if (c.fill) setVar(c.fill, '--fill', Math.min(1, value / cap).toFixed(3));
    }

    const p = chips.pop;
    const people = Math.floor(state.pop + 1e-9);
    setText(p.val, `${people}/${rates.popCap}`);
    const housed = people >= rates.popCap;
    const growing = !rates.hungry && state.pop < rates.popCap;
    setText(p.rate, housed ? t('ui.full') : growing ? fmtRate(BALANCE.popGrowth) : '—');
    setClass(p.el, 'is-full', housed);
    setClass(p.rate, 'is-zero', !housed && !growing);

    const q = currentQuest(state);
    if (q) {
      const prog = questProgress(state, q);
      setText(qTitle, t(`q.${q.id}.title`));
      setText(qCount, `${prog.cur}/${prog.max}`);
      setVar(qFill, '--p', (prog.cur / prog.max).toFixed(3));
      const done = state.quests[q.id] === 'done';
      setClass(qpill, 'is-done', done);
      setClass(qClaim, 'is-pulsing', done);
      setClass(qpill, 'is-complete', false);
    } else {
      setText(qTitle, t('ui.allDoneShort'));
      setText(qCount, '');
      setVar(qFill, '--p', 1);
      setClass(qpill, 'is-done', false);
      setClass(qpill, 'is-complete', true);
    }
  }

  return { el, update, chips, qClaim };
}

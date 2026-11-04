/**
 * Archipelago UI: the islands window (switch / main island / scouting status),
 * the "scouts are back" window with the islands found, and the scouting block
 * shown in the harbour's details panel.
 */
import { BIOMES, WORLD } from '../config.js?v=0.3.4';
import { t } from '../i18n.js?v=0.3.4';
import { canAfford, capsOf } from '../core/economy.js?v=0.3.4';
import { colonizeCost, freeBiomes, growthNeeded, islandSummaries, scoutBlocker, scoutTime } from '../core/world.js?v=0.3.4';
import { h, setClass, setText, setVar } from './dom.js?v=0.3.4';
import { icon } from './icons.js?v=0.3.4';
import { fmt, fmtClock, fmtPct } from './format.js?v=0.3.4';

export const biomeIcon = (biome) => icon(`isl_${biome}`);
export const islandName = (world, index) => t(`biome.${world.islands[index]?.biome ?? 'home'}.name`);

function costChips(cost, res = null) {
  return Object.entries(cost).map(([k, v]) => {
    const el = h(`span.cost.cost--${k}`, null, h('span', { html: icon(k) }), h('span.cost__num', null, fmt(v)));
    if (res) setClass(el, 'is-missing', (res[k] ?? 0) + 1e-9 < v);
    return el;
  });
}

/** Biome speciality as chips: [🪵 +50%] [🌾 −25%]. */
export function modChips(biome) {
  const mods = BIOMES[biome]?.mods || {};
  return Object.entries(mods).map(([k, v]) => {
    const el = h(`span.amt.amt--${k}.mod${v >= 1 ? '.is-up' : '.is-down'}`, { html: icon(k) });
    el.append(fmtPct(v - 1));
    return el;
  });
}

/** Does anything on another island need attention (hunger, ship back)? */
export function worldAlert(world) {
  if (world.scout?.offers) return 'offers';
  if (world.islands.some((s, i) => i !== world.active && s.flags.hungry)) return 'hungry';
  return null;
}

/* ------------------------------------------------------------ islands window */

export function islandsDialog({ game, onSail, onMain, onOffers, onClose }) {
  const list = h('div.isles');
  const status = h('div.isles__status');
  const count = h('span.isles__count');
  const rows = [];

  function build() {
    const world = game.world;
    rows.length = 0;
    list.replaceChildren(...world.islands.map((s, i) => {
      const name = h('span.isle__name', null, t(`biome.${s.biome}.name`));
      const tag = h('span.isle__tag', null, h('span', { html: icon('star') }), t('isl.main'));
      const meta = h('span.isle__meta');
      const warn = h('span.isle__warn');
      const sail = h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => onSail(i) }, h('span', { html: icon('ship') }), t('isl.sail'));
      const here = h('span.isle__here', null, t('isl.here'));
      const main = h('button.icon-btn.isle__star', { type: 'button', 'aria-label': t('isl.makeMain'), title: t('isl.makeMain'), onclick: () => onMain(i), html: icon('star') });
      const node = h('div.isle', null,
        h('span.isle__ico', { html: biomeIcon(s.biome) }),
        h('div.isle__text', null, h('div.isle__line', null, name, tag), meta, h('div.isle__mods', null, modChips(s.biome)), warn),
        h('div.isle__actions', null, main, sail, here));
      rows.push({ node, tag, meta, warn, sail, here, main });
      return node;
    }));
  }

  function update() {
    const world = game.world;
    if (rows.length !== world.islands.length) build();
    const sums = islandSummaries(world);
    for (const s of sums) {
      const r = rows[s.index];
      setClass(r.node, 'is-active', s.active);
      setClass(r.tag, 'is-hidden', !s.main);
      setClass(r.main, 'is-on', s.main);
      r.main.disabled = s.main;
      setText(r.meta, `${t('unit.residents', { n: s.pop })} · ${t('isl.buildings', { n: s.buildings })}`);
      const warn = s.hungry ? t('isl.hungry') : s.full.length ? t('isl.full') : '';
      setText(r.warn, warn);
      setClass(r.warn, 'is-bad', s.hungry);
      setClass(r.sail, 'is-hidden', s.active);
      setClass(r.here, 'is-hidden', !s.active);
    }
    setText(count, t('isl.count', { n: world.islands.length, max: WORLD.maxIslands }));
    // scouting status line
    const sc = world.scout;
    let key, nodes;
    if (sc?.offers) {
      key = 'offers';
      nodes = [h('span', { html: icon('ship') }), h('span.isles__msg', null, t('isl.scoutBack')),
        h('button.btn.btn--gold.btn--sm', { type: 'button', onclick: onOffers }, t('port.offers'))];
    } else if (sc && sc.left > 0) {
      key = `away:${Math.ceil(sc.left)}`;
      nodes = [h('span', { html: icon('ship') }), h('span.isles__msg', null, t('isl.scoutAway', { t: fmtClock(sc.left) }))];
    } else if (!freeBiomes(world).length || world.islands.length >= WORLD.maxIslands) {
      key = 'all';
      nodes = [h('span', { html: icon('star') }), h('span.isles__msg', null, t('isl.allFound'))];
    } else if (growthNeeded(world) && world.islands.some((s) => s.buildings.some((b) => b.type === 'port'))) {
      const g = growthNeeded(world);
      key = `grow:${g.pop}`;
      nodes = [h('span', { html: icon('pop') }), h('span.isles__msg', null, t('port.growFirst', { name: islandName(world, g.island), n: g.need, cur: g.pop }))];
    } else if (world.islands.some((s) => s.buildings.some((b) => b.type === 'port'))) {
      key = 'ready';
      nodes = [h('span', { html: icon('ship') }), h('span.isles__msg', null, t('isl.scoutReady'))];
    } else {
      key = 'noport';
      nodes = [h('span', { html: icon('info') }), h('span.isles__msg', null, t('isl.noPort'))];
    }
    if (status.__key !== key) {
      status.__key = key;
      status.replaceChildren(...nodes);
    }
  }

  build();
  update();
  const body = h('div.modal__body', null,
    h('div.isles__head', null, count, h('span.modal__hint', null, t('isl.mainHint'))),
    list, status);
  return { id: 'islands', title: t('isl.title'), body, className: 'modal--islands', update, onClose };
}

/* ------------------------------------------------------------ islands found */

export function offersDialog({ game, onSettle, onAgain, onLater }) {
  const world = game.world;
  const sc = world.scout;
  const from = world.islands[sc.from];
  const cost = colonizeCost(world);
  const costRow = h('div.offers__cost', null, h('span.offers__label', null, t('offers.cost')), ...costChips(cost, from.res));
  const caps = capsOf(from);
  const tooBig = Object.keys(cost).some((k) => cost[k] > caps[k]);
  const buttons = [];
  const cards = sc.offers.map((o, i) => {
    const btn = h('button.btn.btn--primary.btn--block', { type: 'button', onclick: () => onSettle(i) }, h('span', { html: icon('ship') }), t('offers.settle'));
    buttons.push(btn);
    const land = BIOMES[o.biome].land;
    return h('div.offer', null,
      h('div.offer__top', null,
        h('span.offer__ico', { html: biomeIcon(o.biome) }),
        h('div.offer__text', null,
          h('div.offer__name', null, t(`biome.${o.biome}.name`)),
          h('div.offer__desc', null, t(`biome.${o.biome}.desc`)))),
      h('div.offer__mods', null, modChips(o.biome), h('span.offer__land', null, t('offers.land', { n: `~${Math.round((land[0] + land[1]) / 2)}` }))),
      btn);
  });

  function update() {
    const ok = canAfford(from.res, cost);
    for (const b of buttons) setClass(b, 'is-poor', !ok);
    for (const el of costRow.querySelectorAll('.cost')) {
      const k = [...el.classList].find((c) => c.startsWith('cost--'))?.slice(6);
      if (k) setClass(el, 'is-missing', (from.res[k] ?? 0) + 1e-9 < cost[k]);
    }
  }
  update();
  const body = h('div.modal__body', null,
    h('p.modal__lead', null, t('offers.lead')),
    h('div.offers', null, cards),
    costRow,
    h('p.modal__hint', null, t('offers.payFrom', { name: t(`biome.${from.biome}.name`) })),
    tooBig ? h('p.modal__hint.offers__warn', null, t('offers.tooBig')) : null,
    h('div.modal__actions', null,
      h('button.btn', { type: 'button', onclick: onAgain }, t('offers.again')),
      h('button.btn.btn--primary', { type: 'button', 'data-autofocus': true, onclick: onLater }, t('offers.later'))));
  return { id: 'offers', title: t('offers.title'), art: null, body, className: 'modal--offers', update };
}

/* ------------------------------------------------------------ harbour panel block */

/** Scouting block for the harbour's details panel. */
export function createPortBlock({ getWorld, onScout, onOffers }) {
  const msg = h('div.port__msg');
  const bar = h('div.port__bar', null, h('i'));
  const cost = h('span.btn__costrow');
  const send = h('button.btn.btn--primary.btn--block.port__send', { type: 'button', onclick: () => onScout() },
    h('span.btn__icon', { html: icon('ship') }),
    h('span.btn__stack', null, h('span.btn__label', null, t('port.send')), cost));
  const offers = h('button.btn.btn--gold.btn--block', { type: 'button', onclick: () => onOffers() }, h('span', { html: icon('ship') }), t('port.offers'));
  const el = h('div.port', null, h('div.port__title', null, h('span', { html: icon('ship') }), t('port.title')), msg, bar, send, offers);
  let costKey = '';

  function update(state) {
    const world = getWorld();
    const index = world.islands.indexOf(state);
    const sc = world.scout;
    const why = scoutBlocker(world, index);
    const away = !!(sc && sc.left > 0);
    const back = !!sc?.offers;
    const done = why === 'maxIslands';
    setClass(bar, 'is-hidden', !away);
    setClass(send, 'is-hidden', away || back || done);
    setClass(offers, 'is-hidden', !back);
    if (away) {
      setVar(bar.firstChild, '--p', (1 - sc.left / sc.total).toFixed(3));
      const other = sc.from !== index ? ` ${t('port.otherIsland', { name: islandName(world, sc.from) })}` : '';
      setText(msg, t('port.back', { t: fmtClock(sc.left) }) + other);
    } else if (back) {
      setText(msg, t('isl.scoutBack'));
    } else if (done) {
      setText(msg, t('port.done'));
    } else if (why === 'growFirst') {
      const g = growthNeeded(world);
      setText(msg, t('port.growFirst', { name: islandName(world, g.island), n: g.need, cur: g.pop }));
    } else {
      setText(msg, t('port.time', { t: fmtClock(scoutTime(state, world.islands.length)) }));
    }
    if (!costKey) {
      costKey = 'x';
      cost.replaceChildren(...costChips(WORLD.scoutCost));
    }
    for (const c of cost.children) {
      const k = [...c.classList].find((x) => x.startsWith('cost--'))?.slice(6);
      if (k) setClass(c, 'is-missing', (state.res[k] ?? 0) + 1e-9 < WORLD.scoutCost[k]);
    }
    setClass(send, 'is-poor', why === 'cost' || why === 'growFirst');
  }

  return { el, update };
}

/**
 * UI controller. Owns UI-only state (placement mode, ghost tile, selection),
 * builds the DOM components, refreshes them ~10×/s, reacts to game events
 * and exposes a small API for the map/input layer (stage c).
 */
import { BALANCE, BUILDING_ORDER, QUESTS } from '../config.js';
import { onLangChange, setLang, t } from '../i18n.js';
import { buildCost, buildingAt, canAfford, countType, isUnlocked } from '../core/economy.js';
import { suggestSpot } from '../core/actions.js';
import { getRates } from '../core/sim.js';
import { currentQuest } from '../core/quests.js';
import { idx, inBounds } from '../core/map.js';
import { h, retrigger, setClass } from './dom.js';
import { amounts, icon } from './icons.js';
import { fmt, fmtPct, fmtRate } from './format.js';
import { createHud } from './hud.js';
import { bump, centerOf, confetti, flyResources } from './juice.js';
import { createBuildBar } from './buildbar.js';
import { createPanel } from './panel.js';
import { createToasts } from './toasts.js';
import { conflictDialog, createModalLayer, questsDialog, settingsDialog, welcomeDialog } from './modals.js';

const defaultArt = (type) => h('span.art-svg', { html: icon(type) });

export function createUI({ game, bus, sfx, audio, platform }) {
  const root = document.getElementById('ui');
  root.classList.add('ui');
  const ui = { mode: 'idle', placing: null, ghost: null, selected: null, hint: '', multi: false };
  const isTouch = matchMedia('(pointer: coarse)').matches;
  let artFor = defaultArt;
  let locate = null; // (tileX, tileY) → [sx, sy] provided by the renderer
  let parts = null;
  let tip = null;
  let tipTimer = 0;
  let acc = 1;
  const fullToastAt = {};

  const toast = (text, opts) => parts?.toasts.show(text, opts);
  const rates = () => getRates(game.state);

  /* ---------------- build ---------------- */

  function build() {
    hideTip();
    const hud = createHud({
      onChip: (key, el) => { sfx.click(); toggleTip(key, el); },
      onQuests: () => openQuests(),
      onClaim: (el) => claimCurrent(el),
      onSettings: () => openSettings(),
    });
    const bar = createBuildBar({
      onCard: (type) => onCard(type),
      onConfirm: () => confirmPlacement(),
      onCancel: () => cancelPlacement(),
      artFor: (type) => artFor(type, 1, 'card'),
    });
    const panel = createPanel({
      onUpgrade: (id) => {
        const r = game.dispatch('upgrade', id);
        if (r.ok) update();
      },
      onDemolish: (id) => {
        const r = game.dispatch('demolish', id);
        if (r.ok) deselect(true);
      },
      onClear: (x, y) => {
        const r = game.dispatch('clearTile', x, y);
        if (r.ok) deselect(true);
      },
      onClose: () => deselect(),
      artFor: (type, level) => artFor(type, level, 'panel'),
    });
    const toasts = createToasts();
    const modals = createModalLayer({ sfx });
    root.replaceChildren(hud.el, bar.el, panel.el, toasts.el, modals.el);
    parts = { hud, bar, panel, toasts, modals };
    update();
  }

  /* ---------------- refresh ---------------- */

  /** Early quests point at the card to tap (a little hand), until it is built. */
  function hintCard(s) {
    const q = currentQuest(s);
    if (!q || s.quests[q.id] !== 'active' || q.goal.type !== 'have' || QUESTS.indexOf(q) > 2) return null;
    for (const [type, n] of Object.entries(q.goal.buildings)) {
      if (countType(s, type) < n && isUnlocked(s, type)) return type;
    }
    return null;
  }

  function update() {
    if (!parts) return;
    const s = game.state;
    const r = rates();
    ui.hintCard = hintCard(s);
    parts.hud.update(s, r);
    parts.bar.update(s, r, ui);
    parts.panel.update(s, r);
    parts.modals.update(s, r);
    setClass(root, 'has-panel', !!parts.panel.target);
    setClass(root, 'is-placing', ui.mode === 'place');
  }

  game.onFrame((dt) => {
    acc += dt;
    if (acc < 0.1) return;
    acc = 0;
    update();
  });

  /* ---------------- placement ---------------- */

  function onCard(type) {
    sfx.click();
    if (ui.mode === 'place' && ui.placing === type) return cancelPlacement();
    const why = parts.bar.whyNot(game.state, rates(), type);
    if (why) {
      sfx.error();
      // the first time wood is short: tell the player that trees can be chopped
      const st = game.state;
      if (why.reason === 'cost' && !st.flags.hints.chopTip && st.tiles.includes('t')
        && (buildCost(st, type).wood ?? 0) > st.res.wood) {
        game.dispatch('setHint', 'chopTip');
        setTimeout(() => toast(t('toast.chopTip'), { kind: 'info', icon: 'axe', ms: 5200 }), 400);
      }
      const card = parts.bar.cards[type]?.el;
      if (card) retrigger(card, 'is-shake');
      toast(why.text, { kind: why.reason === 'locked' ? 'info' : 'warn', icon: why.reason === 'locked' ? 'lock' : why.reason === 'income' ? why.res : 'clock', ms: why.reason === 'income' ? 5200 : undefined });
      return;
    }
    startPlacement(type);
  }

  function startPlacement(type) {
    deselect(true);
    hideTip();
    ui.mode = 'place';
    ui.placing = type;
    ui.ghost = suggestSpot(game.state, type);
    if (game.state.flags.hints[`new_${type}`]) game.dispatch('setHint', `new_${type}`, false);
    ui.hint = game.state.flags.hints.placeTip ? '' : t(isTouch ? 'ui.placeHint' : 'ui.placeHintDesktop');
    sfx.select();
    bus.emit('ui:mode', ui);
    update();
  }

  function confirmPlacement() {
    if (ui.mode !== 'place' || !ui.ghost) return;
    const { x, y } = ui.ghost;
    const type = ui.placing;
    const r = game.dispatch('build', type, x, y);
    if (!r.ok) return;
    if (!game.state.flags.hints.placeTip) game.dispatch('setHint', 'placeTip');
    bus.emit('ui:placed', { type, x, y, id: r.building.id });
    if (ui.multi && canAfford(game.state.res, buildCost(game.state, type))) {
      ui.ghost = suggestSpot(game.state, type, { x, y });
      ui.hint = '';
      update();
      return;
    }
    cancelPlacement(true);
  }

  function cancelPlacement(silent = false) {
    if (ui.mode !== 'place') return;
    ui.mode = 'idle';
    ui.placing = null;
    ui.ghost = null;
    ui.hint = '';
    if (!silent) sfx.close();
    bus.emit('ui:mode', ui);
    update();
  }

  function moveGhost(x, y, silent = false) {
    if (ui.mode !== 'place') return;
    if (ui.ghost && ui.ghost.x === x && ui.ghost.y === y) return;
    ui.ghost = { x, y };
    if (!silent) sfx.tick();
    update();
  }

  /* ---------------- selection ---------------- */

  function select(target) {
    if (ui.mode === 'place') return;
    hideTip();
    ui.selected = target;
    parts.panel.open(target, game.state, rates());
    sfx.select();
    bus.emit('ui:select', target);
    update();
  }

  function deselect(silent = false) {
    if (!ui.selected && !parts?.panel.target) return;
    ui.selected = null;
    parts.panel.close();
    if (!silent) sfx.close();
    bus.emit('ui:select', null);
    update();
  }

  /**
   * Tap on the map. While placing: mouse clicks build right away; on touch the
   * first tap moves the ghost and a second tap on the same tile (or ✓) builds.
   */
  function mapTap(x, y, { pointerType = 'touch' } = {}) {
    hideTip();
    if (ui.mode === 'place') {
      if (!inBounds(x, y)) return;
      const same = ui.ghost && ui.ghost.x === x && ui.ghost.y === y;
      if (pointerType === 'mouse' || same) {
        moveGhost(x, y, true);
        confirmPlacement();
      } else {
        moveGhost(x, y);
      }
      return;
    }
    tapTile(x, y);
  }

  /** Desktop: the ghost follows the mouse. */
  function mapHover(x, y) {
    if (ui.mode !== 'place' || !inBounds(x, y)) return;
    moveGhost(x, y, true);
  }

  /** Screen area not covered by the HUD, bottom bar or the open panel (CSS px, layout boxes). */
  function safeArea() {
    const W = root.clientWidth || innerWidth;
    const H = root.clientHeight || innerHeight;
    if (!parts) return { top: 0, bottom: H, left: 0, right: W };
    const hud = parts.hud.el;
    let top = hud.offsetTop + hud.offsetHeight;
    let bottom = parts.bar.el.offsetTop;
    let right = W;
    if (parts.panel.target) {
      const p = parts.panel.el;
      const side = p.offsetLeft > W * 0.35 && p.offsetWidth < W * 0.65;
      if (side) right = p.offsetLeft;
      else bottom = Math.min(bottom, p.offsetTop);
    }
    return { top: top + 4, bottom: bottom - 4, left: 4, right: right - 4 };
  }

  /** Selection by tile (buildings, trees, rocks). */
  function tapTile(x, y) {
    if (ui.mode === 'place') {
      if (inBounds(x, y)) moveGhost(x, y);
      return;
    }
    if (!inBounds(x, y)) return deselect();
    const b = buildingAt(game.state, x, y);
    if (b) return select({ kind: 'building', id: b.id });
    const code = game.state.tiles[idx(x, y)];
    if (code === 't' || code === 'r') return select({ kind: 'tile', x, y });
    deselect();
  }

  /* ---------------- quests, settings, welcome ---------------- */

  function openQuests() {
    sfx.click();
    hideTip();
    parts.modals.open(questsDialog({ game, onClaim: (id, el) => claim(id, el) }));
  }

  /** Flying resource icons into the HUD (coin sound when they land). */
  function fly(amounts, from) {
    if (!parts) return;
    const chipEls = {};
    for (const [k, c] of Object.entries(parts.hud.chips)) chipEls[k] = c.el;
    flyResources(root, chipEls, amounts, from, () => sfx.coin());
  }

  function claim(id, sourceEl = null) {
    const from = centerOf(sourceEl) || centerOf(parts.hud.el.querySelector('.qpill'));
    const r = game.dispatch('claimQuest', id);
    if (!r.ok) return;
    const chips = amounts(r.granted, { sign: '+' });
    if (chips.length) toast([`${t('ui.reward')}: `, ...chips], { kind: 'good', icon: 'star' });
    fly(r.granted, from);
    update();
  }

  function claimCurrent(el = null) {
    const q = currentQuest(game.state);
    if (q && game.state.quests[q.id] === 'done') claim(q.id, el);
    else openQuests();
  }

  let reopenSettings = false;
  function openSettings() {
    sfx.click();
    hideTip();
    parts.modals.open(settingsDialog({
      game,
      onSound: (on) => {
        game.setSetting('sound', on);
        audio.setSoundEnabled(on);
        if (on) sfx.click();
      },
      onLang: (code) => {
        game.setSetting('lang', code);
        reopenSettings = true;
        setLang(code);
      },
      onReset: () => {
        parts.modals.close();
        game.reset();
      },
    }));
  }

  function showWelcome(report) {
    const canDouble = platform.hasRewardedAds();
    parts.modals.open(welcomeDialog({
      report,
      canDouble,
      onDouble: async (btn) => {
        btn.disabled = true;
        audio.setMuted(true);
        game.platform.gameplayStop();
        let ok = false;
        try { ok = await platform.showRewardedAd(); } catch { ok = false; }
        audio.setMuted(false);
        game.platform.gameplayStart();
        if (ok) {
          const from = centerOf(btn);
          const r = game.dispatch('grantReward', report.gained);
          const chips = amounts(r.gained, { sign: '+' });
          if (chips.length) toast([`${t('ui.reward')}: `, ...chips], { kind: 'good', icon: 'star' });
          fly(r.gained, from);
        }
        parts.modals.close();
      },
      onClose: () => parts.modals.close(),
    }));
  }

  /* ---------------- resource tooltip ---------------- */

  function hideTip() {
    clearTimeout(tipTimer);
    if (tip) {
      tip.el.remove();
      tip = null;
    }
  }

  function toggleTip(key, anchor) {
    if (tip && tip.key === key) return hideTip();
    hideTip();
    const s = game.state;
    const r = rates();
    const rows = [];
    if (key === 'pop') {
      rows.push([t('ui.housing'), `${Math.floor(s.pop + 1e-9)}/${r.popCap}`]);
      rows.push([t('ui.employed'), `${r.employed}/${r.jobs}`]);
      rows.push([t('ui.idle'), String(r.idle)]);
    } else {
      const byType = {};
      for (const b of s.buildings) {
        const p = r.per.get(b.id);
        if (!p || p.rate[key] == null) continue;
        byType[b.type] = (byType[b.type] || 0) + (key === 'food' ? p.rate[key] : p.rate[key] * r.mult);
      }
      for (const [type, v] of Object.entries(byType)) rows.push([t(`b.${type}.name`), fmtRate(v)]);
      if (key === 'wood') rows.push([t('ui.gathering'), fmtRate(BALANCE.gatherWood)]);
      if (key === 'coins') rows.push([t('ui.taxes'), fmtRate(r.taxes * r.mult)]);
      if (key === 'food') rows.push([t('ui.consumption'), fmtRate(-r.consumption.food)]);
      if (r.hungry && key !== 'food') rows.push([t('ui.hungerPenalty'), fmtPct(r.mult - 1)]);
      if (Number.isFinite(r.caps[key])) rows.push([t('ui.cap'), fmt(r.caps[key])]);
    }
    const el = h('div.tip', { role: 'tooltip' },
      h('div.tip__title', null, h('span', { html: icon(key) }), t(`res.${key}`)),
      rows.map(([a, b]) => h('div.tip__row', null, h('span', null, a), h('b', null, b))));
    root.append(el);
    const ar = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    el.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, ar.left + ar.width / 2 - w / 2))}px`;
    el.style.top = `${ar.bottom + 8}px`;
    tip = { el, key };
    tipTimer = setTimeout(hideTip, 4500);
  }

  window.addEventListener('pointerdown', (e) => {
    if (tip && !e.target.closest?.('.tip, .res')) hideTip();
  }, { capture: true, passive: true });

  /* ---------------- keyboard ---------------- */

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') ui.multi = true;
    const onButton = e.target?.closest?.('button');
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(e.key) || (e.key === ' ' && !onButton)) {
      e.preventDefault(); // never scroll the host page (portal iframes)
    }
    if (e.key === 'Escape') {
      if (parts.modals.isOpen) { if (parts.modals.dismissible) parts.modals.close(); }
      else if (ui.mode === 'place') cancelPlacement();
      else if (ui.selected) deselect();
      else hideTip();
      return;
    }
    if (parts.modals.isOpen || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= BUILDING_ORDER.length) onCard(BUILDING_ORDER[n - 1]);
    else if (e.key === 'Enter' && ui.mode === 'place' && !onButton) confirmPlacement();
    else if (e.key === 'q' || e.key === 'Q') openQuests();
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') ui.multi = false; });
  window.addEventListener('blur', () => { ui.multi = false; });

  /* ---------------- game events ---------------- */

  const name = (type) => t(`b.${type}.name`);
  bus.on('built', () => sfx.build());
  bus.on('upgraded', (e) => {
    sfx.upgrade();
    toast(t('toast.upgraded', { name: name(e.building), n: e.level }), { kind: 'good', icon: 'up' });
  });
  bus.on('demolished', (e) => {
    sfx.demolish();
    if (locate) {
      const [sx, sy] = locate(e.x, e.y);
      fly(e.refund, { x: sx, y: sy - 20 });
    }
    toast(t('toast.demolished', { name: name(e.building) }), { kind: 'info', icon: 'trash' });
  });
  bus.on('cleared', (e) => {
    if (e.kind === 't') sfx.chop();
    else sfx.crack();
    if (locate) {
      const [sx, sy] = locate(e.x, e.y);
      fly(e.gained, { x: sx, y: sy - 24 });
    }
  });
  bus.on('questDone', (e) => {
    sfx.questReady();
    const pill = parts?.hud.el.querySelector('.qpill');
    const c = centerOf(pill);
    if (c) {
      confetti(root, c.x, c.y);
      bump(pill);
    }
    toast(t('toast.questDone', { name: t(`q.${e.id}.title`) }), { kind: 'good', icon: 'quest' });
  });
  bus.on('questClaimed', () => {
    sfx.quest();
    platform.happyTime();
  });
  bus.on('questActivated', (e) => {
    setTimeout(() => {
      toast(t('toast.newQuest', { name: t(`q.${e.id}.title`) }), { kind: 'info', icon: 'quest', ms: 3200 });
      const q = QUESTS.find((x) => x.id === e.id);
      if (q?.goal.type === 'level' && !game.state.flags.hints.upgradeTip) {
        game.dispatch('setHint', 'upgradeTip');
        setTimeout(() => toast(t('toast.upgradeTip'), { kind: 'info', icon: 'up', ms: 5200 }), 1400);
      }
    }, 900);
  });
  bus.on('unlocked', (e) => {
    game.dispatch('setHint', `new_${e.building}`);
    toast(t('toast.unlocked', { name: name(e.building) }), { kind: 'good', icon: e.building, ms: 3600 });
  });
  bus.on('hungerStart', () => {
    sfx.warn();
    toast(t('toast.hungerStart'), { kind: 'bad', icon: 'food', ms: 4200 });
  });
  bus.on('hungerEnd', () => toast(t('toast.hungerEnd'), { kind: 'good', icon: 'food' }));
  bus.on('storageFull', (e) => {
    const now = performance.now();
    if (now - (fullToastAt[e.res] || -1e9) < 90000) return;
    fullToastAt[e.res] = now;
    toast(t('toast.storageFull', { res: t(`res.${e.res}`) }), { kind: 'warn', icon: 'box' });
  });
  bus.on('actionFailed', (e) => {
    sfx.error();
    toast(t(`reason.${e.reason}`), { kind: 'bad', icon: 'warn' });
  });
  bus.on('offline', ({ report }) => showWelcome(report));
  bus.on('saveFailed', () => toast(t('toast.saveFailed'), { kind: 'warn', icon: 'warn', ms: 5200 }));
  bus.on('conflict', () => parts.modals.open(conflictDialog()));
  bus.on('reset', () => {
    cancelPlacement(true);
    deselect(true);
    toast(t('toast.reset'), { kind: 'good', icon: 'sparkle' });
    update();
  });
  bus.on('pause', () => audio.suspendAudio());
  bus.on('resume', () => audio.resumeAudio());

  onLangChange(() => {
    document.documentElement.lang = game.settings.lang;
    document.title = t('game.title');
    cancelPlacement(true);
    if (parts) parts.panel.close();
    ui.selected = null;
    build();
    if (reopenSettings) {
      reopenSettings = false;
      openSettings();
    }
  });

  build();

  return {
    state: ui,
    update,
    toast,
    tapTile,
    mapTap,
    mapHover,
    safeArea,
    moveGhost,
    startPlacement,
    confirmPlacement,
    cancelPlacement,
    select,
    deselect,
    openQuests,
    openSettings,
    showWelcome,
    /** First-run greeting. */
    welcome() {
      setTimeout(() => toast(t('toast.welcome'), { kind: 'good', icon: 'field', ms: 5200 }), 700);
    },
    /** Lets the renderer tell where a tile is on screen (for flying rewards). */
    setWorldLocator(fn) {
      locate = fn;
    },
    /** Lets the renderer provide canvas thumbnails for cards and the panel. */
    setArtProvider(fn) {
      artFor = fn || defaultArt;
      build();
    },
    get parts() { return parts; },
  };
}

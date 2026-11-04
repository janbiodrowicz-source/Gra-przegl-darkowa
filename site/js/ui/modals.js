/**
 * Modal layer (one dialog at a time, queued) + the game's dialogs:
 * welcome back, settings, quests and the "open in another tab" lock.
 */
import { CAPPED, GAME, QUESTS, RESOURCES } from '../config.js?v=0.3.3';
import { getLang, LANGUAGES, t } from '../i18n.js?v=0.3.3';
import { questList, unlocksOf } from '../core/quests.js?v=0.3.3';
import { h, setText, setClass, setVar } from './dom.js?v=0.3.3';
import { icon } from './icons.js?v=0.3.3';
import { fmt, fmtDuration } from './format.js?v=0.3.3';

let keyboardMode = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key === 'Enter' || e.key === 'Escape') keyboardMode = true; }, true);
  window.addEventListener('pointerdown', () => { keyboardMode = false; }, true);
}

export function createModalLayer({ sfx }) {
  const el = h('div.modal-layer', { 'aria-hidden': 'true' });
  let current = null;
  const queue = [];
  let lastFocus = null;

  el.addEventListener('pointerdown', (e) => {
    if (e.target === el && current?.dismissible) close();
  });

  function show(spec) {
    current = spec;
    lastFocus = document.activeElement;
    const titleId = `m-${Math.random().toString(36).slice(2, 7)}`;
    const head = h('div.modal__head', null,
      spec.art ? h('div.modal__art', { html: spec.art }) : null,
      h('h2.modal__title', { id: titleId }, spec.title),
      spec.dismissible ? h('button.icon-btn.modal__close', { type: 'button', 'aria-label': t('ui.close'), onclick: () => close(), html: icon('close') }) : null);
    const box = h(`div.modal${spec.className ? '.' + spec.className : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' }, head, spec.body);
    el.replaceChildren(box);
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    sfx?.open();
    // Keyboard users land on the main action; pointer users get no focus ring.
    const focusTarget = keyboardMode ? (box.querySelector('[data-autofocus]') || box.querySelector('button')) : box;
    setTimeout(() => focusTarget?.focus({ preventScroll: true }), 50);
  }

  /** Opens a dialog. spec: { id, title, body (Node), art?, dismissible?, className?, priority?, onClose? } */
  function open(spec) {
    const s = { dismissible: true, ...spec };
    if (current) {
      if (s.priority) {
        queue.unshift(current);
        show(s);
      } else if (current.id !== s.id && !queue.some((q) => q.id === s.id)) {
        queue.push(s);
      }
      return;
    }
    show(s);
  }

  function close() {
    if (!current) return;
    const closing = current;
    current = null;
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    sfx?.close();
    closing.onClose?.();
    setTimeout(() => {
      if (current) return;
      el.replaceChildren();
      if (queue.length) show(queue.shift());
      else lastFocus?.focus?.({ preventScroll: true });
    }, 220);
  }

  return {
    el,
    open,
    close,
    get isOpen() { return !!current; },
    get currentId() { return current?.id ?? null; },
    get dismissible() { return !!current?.dismissible; },
    /** Refreshes the open dialog's live parts. */
    update(...args) { current?.update?.(...args); },
  };
}

/* ---------------- dialogs ---------------- */

const SUN_ART = `<svg viewBox="0 0 120 70" aria-hidden="true">
  <circle cx="86" cy="22" r="14" fill="#ffd45c"/><circle cx="86" cy="22" r="20" fill="#ffd45c" opacity=".25"/>
  <ellipse cx="60" cy="58" rx="46" ry="9" fill="#5cc2c9" opacity=".55"/>
  <ellipse cx="56" cy="54" rx="34" ry="8" fill="#f3d9a0"/><ellipse cx="56" cy="51" rx="27" ry="6" fill="#88c96a"/>
  <path d="M43 50V39l11-8 11 8v11z" fill="#fff1d6"/><path d="M39 40.5l15-12.5 15 12.5-3.4 2.6L54 33.5l-11.6 9.6z" fill="#e3794d"/>
  <rect x="51.5" y="43" width="5" height="7" rx="1" fill="#8a5a36"/>
  <circle cx="74" cy="47" r="5" fill="#5daa4f"/><rect x="73.2" y="50" width="1.6" height="3" fill="#8a5a36"/>
</svg>`;

/** "Welcome back" summary of offline progress. */
export function welcomeDialog({ report, canDouble, onDouble, onClose }) {
  const gains = RESOURCES.filter((k) => report.gained[k] >= 1);
  const counters = [];
  const list = h('div.gains', null, gains.map((k) => {
    const val = h('span.gain__val', null, `+${fmt(report.gained[k])}`);
    counters.push([val, report.gained[k]]);
    return h(`div.gain.gain--${k}`, null, h('span.gain__ico', { html: icon(k) }), val);
  }));
  // count up from zero (skipped for reduced motion)
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const t0 = performance.now() + 250;
    const step = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / 900));
      const e = 1 - Math.pow(1 - k, 3);
      for (const [el, v] of counters) el.textContent = `+${fmt(v * e)}`;
      if (k < 1 && list.isConnected !== false) requestAnimationFrame(step);
    };
    for (const [el] of counters) el.textContent = '+0';
    requestAnimationFrame(step);
  }
  const notes = h('div.notes');
  const fullTimes = CAPPED.map((k) => report.fullAt[k]).filter((v) => v != null);
  const lost = CAPPED.some((k) => report.overflow[k] >= 1);
  if (fullTimes.length && lost) {
    notes.append(h('div.note', null, h('span.note__ico', { html: icon('box') }), t('welcome.full', { t: fmtDuration(Math.min(...fullTimes)) })));
  }
  if (report.others?.length) {
    const hungry = report.others.filter((o) => o.hungrySeconds >= 60).length;
    notes.append(h('div.note', null, h('span.note__ico', { html: icon('ship') }),
      t('welcome.others', { n: report.others.length }) + (hungry ? ` ${t('welcome.othersHungry', { n: hungry })}` : '')));
  }
  if (report.hungerAt != null && report.hungrySeconds >= 30) {
    notes.append(h('div.note.note--bad', null, h('span.note__ico', { html: icon('food') }), t('welcome.hunger', { t: fmtDuration(report.hungerAt) })));
  }
  const doubleBtn = canDouble
    ? h('button.btn.btn--gold', { type: 'button', onclick: () => onDouble?.(doubleBtn) }, h('span', { html: icon('star') }), t('welcome.double'))
    : null;
  const body = h('div.modal__body', null,
    h('p.modal__lead', null, t('welcome.away', { t: fmtDuration(report.requested) })),
    report.capped ? h('p.modal__hint', null, t('welcome.capped', { t: fmtDuration(GAME.offlineCap) })) : null,
    gains.length ? h('p.modal__label', null, t('welcome.gained')) : h('p.modal__hint', null, t('welcome.nothing')),
    gains.length ? list : null,
    notes.childNodes.length ? notes : null,
    h('div.modal__actions', null,
      doubleBtn,
      h('button.btn.btn--primary.btn--wide', { type: 'button', 'data-autofocus': true, onclick: onClose }, t('welcome.collect'))));
  return { id: 'welcome', title: t('welcome.title'), art: SUN_ART, body, className: 'modal--welcome' };
}

/** Settings: sound, language, hold-to-reset. */
export function settingsDialog({ game, onSound, onLang, onReset }) {
  const soundIco = h('span.setting__ico', { html: icon(game.settings.sound ? 'soundOn' : 'soundOff') });
  const soundBtn = h('button.switch', {
    type: 'button', role: 'switch', 'aria-checked': String(game.settings.sound), 'aria-label': t('settings.sound'),
    onclick: () => {
      const next = soundBtn.getAttribute('aria-checked') !== 'true';
      soundBtn.setAttribute('aria-checked', String(next));
      soundIco.innerHTML = icon(next ? 'soundOn' : 'soundOff');
      onSound(next);
    },
  }, h('span.switch__knob'));

  const langSeg = h('div.seg', { role: 'group', 'aria-label': t('settings.language') },
    LANGUAGES.map((code) => h('button', {
      type: 'button', 'aria-pressed': String(getLang() === code), lang: code,
      onclick: () => { if (getLang() !== code) onLang(code); },
    }, code.toUpperCase())));

  const fill = h('span.hold__fill');
  const label = h('span.hold__label', null, t('settings.resetHold'));
  const hold = h('button.btn.btn--danger.btn--block.hold', { type: 'button' }, fill, h('span', { html: icon('trash') }), label);
  let timer = 0;
  const start = (e) => {
    e.preventDefault();
    hold.classList.add('is-holding');
    clearTimeout(timer);
    timer = setTimeout(() => {
      hold.classList.remove('is-holding');
      onReset();
    }, 1500);
  };
  const stop = () => {
    clearTimeout(timer);
    hold.classList.remove('is-holding');
  };
  hold.addEventListener('pointerdown', start);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hold.addEventListener(ev, stop);
  hold.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(e); });
  hold.addEventListener('keyup', stop);

  const body = h('div.modal__body', null,
    h('div.setting', null, soundIco, h('span.setting__label', null, t('settings.sound')), soundBtn),
    h('div.setting', null, h('span.setting__ico', { html: icon('globe') }), h('span.setting__label', null, t('settings.language')), langSeg),
    h('div.divider'),
    h('div.setting.setting--col', null,
      h('span.setting__label', null, t('settings.reset')),
      h('p.modal__hint', null, t('settings.resetInfo')),
      hold),
    h('div.divider'),
    h('p.modal__foot', null, `${t('game.title')} · ${t('settings.version', { v: GAME.version })}`,
      game.platform.storage.persistent ? null : h('span.modal__warn', null, ` · ${t('settings.storageOff')}`)));
  return { id: 'settings', title: t('settings.title'), body, className: 'modal--settings', onClose: stop };
}

/** Quest list with live progress and claim buttons. */
export function questsDialog({ game, onClaim }) {
  const listEl = h('div.quests');
  const rows = new Map();
  for (const q of QUESTS) {
    const title = h('div.quest__title', null, t(`q.${q.id}.title`));
    const desc = h('div.quest__desc', null, t(`q.${q.id}.desc`));
    const count = h('span.quest__count');
    const fill = h('i');
    const reward = h('div.quest__reward', null, h('span.quest__rlabel', null, t('ui.reward')),
      Object.entries(q.reward).map(([k, v]) => h('span.cost', null, h('span', { html: icon(k) }), fmt(v))));
    const unlocks = unlocksOf(q.id);
    const unlockNote = unlocks.length
      ? h('div.quest__unlock', null, h('span', { html: icon('lock') }), unlocks.map((b) => t(`b.${b}.name`)).join(', '))
      : null;
    const claim = h('button.btn.btn--gold.btn--sm', { type: 'button', onclick: (e) => onClaim(q.id, e.currentTarget) }, t('ui.claim'));
    const badge = h('span.quest__badge');
    const node = h('div.quest', { dataset: { id: q.id } },
      h('div.quest__top', null, badge, h('div.quest__text', null, title, desc)),
      h('div.quest__progress', null, h('div.quest__bar', null, fill), count),
      h('div.quest__bottom', null, reward, unlockNote, claim));
    rows.set(q.id, { node, count, fill, claim, badge });
    listEl.append(node);
  }
  const doneNote = h('p.modal__hint.quests__done', null, t('ui.allDone'));

  function update(state) {
    const items = questList(state);
    let shownLocked = false;
    let allClaimed = true;
    for (const { quest, status, progress } of items) {
      const r = rows.get(quest.id);
      if (status !== 'claimed') allClaimed = false;
      const hideRow = status === 'locked' && shownLocked;
      if (status === 'locked') shownLocked = true;
      setClass(r.node, 'is-hidden', hideRow);
      setClass(r.node, 'is-claimed', status === 'claimed');
      setClass(r.node, 'is-locked', status === 'locked');
      setClass(r.node, 'is-done', status === 'done');
      setText(r.count, `${progress.cur}/${progress.max}`);
      setVar(r.fill, '--p', (progress.cur / progress.max).toFixed(3));
      r.claim.disabled = status !== 'done';
      setClass(r.claim, 'is-pulsing', status === 'done');
      r.badge.innerHTML = status === 'claimed' ? icon('check') : status === 'locked' ? icon('lock') : icon('quest');
    }
    setClass(doneNote, 'is-hidden', !allClaimed);
  }
  update(game.state);
  const body = h('div.modal__body', null, listEl, doneNote);
  return { id: 'quests', title: t('ui.quests'), body, className: 'modal--quests', update };
}

/** Shown when the game is opened in another tab — the current tab stops writing. */
export function conflictDialog() {
  const body = h('div.modal__body', null,
    h('p.modal__lead', null, t('conflict.text')),
    h('div.modal__actions', null,
      h('button.btn.btn--primary.btn--wide', { type: 'button', 'data-autofocus': true, onclick: () => location.reload() }, t('conflict.reload'))));
  return { id: 'conflict', title: t('conflict.title'), body, dismissible: false, priority: true, className: 'modal--conflict' };
}

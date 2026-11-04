/** Toast notifications: short, stacked, de-duplicated. */
import { h, retrigger } from './dom.js?v=0.3.2';
import { icon } from './icons.js?v=0.3.2';

const MAX = 3;

export function createToasts() {
  const el = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
  const live = new Map(); // text → { node, timer }

  function hide(text) {
    const entry = live.get(text);
    if (!entry) return;
    live.delete(text);
    clearTimeout(entry.timer);
    entry.node.classList.remove('is-in');
    entry.node.classList.add('is-out');
    setTimeout(() => entry.node.remove(), 320);
  }

  /**
   * @param {string|Node|Array<string|Node>} content
   * @param {{ kind?: 'info'|'good'|'warn'|'bad', icon?: string, ms?: number }} opts
   */
  function show(content, { kind = 'info', icon: ic = null, ms = 2800 } = {}) {
    const textNode = h('span.toast__text', null, content);
    const text = textNode.textContent; // de-duplication key
    const existing = live.get(text);
    if (existing) {
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => hide(text), ms);
      retrigger(existing.node, 'is-bump');
      return;
    }
    const node = h(`div.toast.toast--${kind}`, null,
      ic ? h('span.toast__ico', { html: icon(ic) }) : null,
      textNode);
    el.appendChild(node);
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('is-in')));
    live.set(text, { node, timer: setTimeout(() => hide(text), ms) });
    while (live.size > MAX) hide(live.keys().next().value);
  }

  function clearAll() {
    for (const text of [...live.keys()]) hide(text);
  }

  return { el, show, clearAll };
}

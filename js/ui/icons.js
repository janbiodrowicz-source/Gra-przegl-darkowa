/**
 * Icon set — inline SVG, one consistent style:
 *  - resource & building icons: soft flat colours, light from the top-left
 *  - UI glyphs: rounded 2px strokes in currentColor
 * All strings are static and trusted (safe for innerHTML).
 */
import { fmt, fmtRate } from './format.js';

const RES = {
  wood: `
    <rect x="2" y="12" width="17" height="7" rx="3.5" fill="#b36d35"/>
    <path d="M5 13.7h9" stroke="#cd8b52" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="18" cy="15.5" r="3.5" fill="#f2c48d"/>
    <circle cx="18" cy="15.5" r="1.8" fill="none" stroke="#cf9257" stroke-width="1.1"/>
    <rect x="5" y="5" width="15" height="7" rx="3.5" fill="#c27a3d"/>
    <path d="M8 6.7h8" stroke="#d99a5f" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="19" cy="8.5" r="3.5" fill="#f6cf9c"/>
    <circle cx="19" cy="8.5" r="1.8" fill="none" stroke="#cf9257" stroke-width="1.1"/>`,
  stone: `
    <path d="M3.5 18.5 5.8 10.2 11.5 5.5 18 7.2 21 14.5 18.4 19.2 7.4 20z" fill="#95a2ae"/>
    <path d="M5.8 10.2 11.5 5.5 18 7.2 13.6 11.4z" fill="#c6d0d9"/>
    <path d="M13.6 11.4 18 7.2 21 14.5 18.4 19.2 14.2 18.6z" fill="#76838f"/>
    <path d="M7.6 14.6l2.8-1.3" stroke="#7d8a96" stroke-width="1.2" stroke-linecap="round"/>`,
  food: `
    <path d="M12 21.5V9" stroke="#b9832a" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M12 21.4c-1.4-1.7-3.4-2.5-5-2.5M12 21.4c1.4-1.7 3.4-2.5 5-2.5" stroke="#9fb23f" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    <ellipse cx="12" cy="5.4" rx="2" ry="3" fill="#f7c95a"/>
    <g fill="#ebb23f">
      <ellipse cx="9.4" cy="9.4" rx="1.8" ry="2.9" transform="rotate(-32 9.4 9.4)"/>
      <ellipse cx="14.6" cy="9.4" rx="1.8" ry="2.9" transform="rotate(32 14.6 9.4)"/>
      <ellipse cx="9.4" cy="13.4" rx="1.8" ry="2.9" transform="rotate(-32 9.4 13.4)"/>
      <ellipse cx="14.6" cy="13.4" rx="1.8" ry="2.9" transform="rotate(32 14.6 13.4)"/>
    </g>
    <path d="M11.3 4.2v2" stroke="#fff0b3" stroke-width="1" stroke-linecap="round"/>`,
  coins: `
    <circle cx="12" cy="13.2" r="8" fill="#d8971c"/>
    <circle cx="12" cy="11.6" r="8" fill="#ffc93d"/>
    <circle cx="12" cy="11.6" r="5.6" fill="none" stroke="#eaa823" stroke-width="1.3"/>
    <path d="M12 8.3l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z" fill="#eaa823"/>
    <path d="M7.3 8.6a6 6 0 0 1 3.3-2.6" stroke="#fff3c4" stroke-width="1.4" stroke-linecap="round" fill="none"/>`,
  pop: `
    <circle cx="16.4" cy="9.4" r="2.9" fill="#eaa877"/>
    <path d="M11.6 20.2a4.8 4.8 0 0 1 9.6 0z" fill="#2c9c8c"/>
    <circle cx="8.6" cy="8" r="3.3" fill="#f3bd90"/>
    <path d="M2.8 20.2a5.8 5.8 0 0 1 11.6 0z" fill="#e07a4f"/>`,
};

const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

const UI = {
  gear: `
    <circle cx="12" cy="12" r="6.4" ${S} stroke-width="2.2"/>
    <circle cx="12" cy="12" r="2.4" fill="currentColor"/>
    <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" ${S} stroke-width="2.8"/>`,
  quest: `
    <rect x="5" y="4.5" width="14" height="15" rx="1.5" fill="#f8e6bd"/>
    <rect x="3.5" y="3" width="17" height="3.4" rx="1.7" fill="#d9ad62"/>
    <rect x="3.5" y="17.6" width="17" height="3.4" rx="1.7" fill="#d9ad62"/>
    <path d="M8 9.6h8M8 12.4h8M8 15.1h5" stroke="#a9773d" stroke-width="1.4" stroke-linecap="round"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" ${S} stroke-width="2.6"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5" ${S} stroke-width="2.8"/>`,
  up: `<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" ${S} stroke-width="2.6"/>`,
  trash: `
    <path d="M4.5 7h15M9.5 7V5.3c0-.7.5-1.3 1.2-1.3h2.6c.7 0 1.2.6 1.2 1.3V7M6.6 7l.8 11.5c.1 1.1.9 1.9 2 1.9h5.2c1.1 0 1.9-.8 2-1.9L17.4 7" ${S} stroke-width="2"/>
    <path d="M10.2 10.6v5.8M13.8 10.6v5.8" ${S} stroke-width="1.8"/>`,
  hammer: `
    <path d="M13.4 10.6 5.2 18.8" ${S} stroke-width="2.8"/>
    <rect x="9.2" y="4.6" width="11.6" height="5.4" rx="1.4" transform="rotate(45 15 7.3)" fill="currentColor"/>`,
  lock: `
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" ${S} stroke-width="2.2"/>
    <rect x="5" y="10.2" width="14" height="10.3" rx="2.6" fill="currentColor"/>
    <circle cx="12" cy="15.2" r="1.7" fill="#fff" opacity=".9"/>`,
  clock: `<circle cx="12" cy="12" r="8.5" ${S} stroke-width="2.2"/><path d="M12 7.5V12l3 2" ${S} stroke-width="2.2"/>`,
  globe: `
    <circle cx="12" cy="12" r="8.5" ${S} stroke-width="2"/>
    <path d="M3.8 9.5h16.4M3.8 14.5h16.4M12 3.5c2.4 2.4 3.4 5.3 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.3-3.4-8.5s1-6.1 3.4-8.5z" ${S} stroke-width="1.8"/>`,
  soundOn: `
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/>
    <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11" ${S} stroke-width="2"/>`,
  soundOff: `
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/>
    <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" ${S} stroke-width="2.2"/>`,
  axe: `
    <path d="M17.2 6.8 5.4 18.6" ${S} stroke-width="2.6"/>
    <path d="M14.4 6.2 10.8 2.6Q21.6 1.8 21.4 13.2L17.8 9.6z" fill="currentColor"/>`,
  pick: `
    <path d="M12.8 11.2 5 19" ${S} stroke-width="2.4"/>
    <path d="M4.5 7.4C9 3 15.6 2.6 20 6.2c-1.4.1-2.8.6-4 1.4L16.4 12c-.9-.9-2-1.6-3.1-2-1.9-1.6-5.2-2.7-8.8-2.6z" fill="currentColor"/>`,
  info: `<circle cx="12" cy="12" r="8.5" ${S} stroke-width="2.2"/><path d="M12 11v5.5" ${S} stroke-width="2.4"/><circle cx="12" cy="7.8" r="1.4" fill="currentColor"/>`,
  star: `<path d="M12 3.2l2.6 5.5 6 .7-4.5 4.1 1.2 5.9L12 16.5l-5.3 2.9 1.2-5.9-4.5-4.1 6-.7z" fill="#ffc93d" stroke="#e6a21f" stroke-width="1.2" stroke-linejoin="round"/>`,
  sparkle: `<path d="M12 3c.6 4.5 2.5 6.4 7 7-4.5.6-6.4 2.5-7 7-.6-4.5-2.5-6.4-7-7 4.5-.6 6.4-2.5 7-7z" fill="currentColor"/>`,
  warn: `<path d="M10.3 4.6 2.9 17.6A2 2 0 0 0 4.6 20.6h14.8a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z" fill="currentColor"/><path d="M12 9v4.6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.9" r="1.3" fill="#fff"/>`,
  worker: `
    <circle cx="12" cy="9.3" r="3.6" fill="currentColor"/>
    <path d="M7.2 8.4a4.8 4.8 0 0 1 9.6 0z" fill="currentColor" opacity=".55"/>
    <path d="M5 20.5a7 7 0 0 1 14 0z" fill="currentColor"/>`,
  home: `<path d="M4.5 11 12 4.5l7.5 6.5M6.8 9.4v9.8h10.4V9.4" ${S} stroke-width="2.2"/><path d="M10.2 19.2v-5h3.6v5" ${S} stroke-width="2"/>`,
  box: `<path d="M4.5 8 12 4.5 19.5 8v8.5L12 20l-7.5-3.5z" ${S} stroke-width="2"/><path d="M4.5 8 12 11.5 19.5 8M12 11.5V20" ${S} stroke-width="2"/>`,
  chevron: `<path d="M9.5 6l6 6-6 6" ${S} stroke-width="2.6"/>`,
  bolt: `<path d="M13.5 2.8 5.8 13.2h5.1l-1.4 8 7.7-10.4h-5.1z" fill="currentColor"/>`,
  leaf: `<path d="M5 19C5 10 10.5 5 19.5 4.5 19 13.5 14 19 5 19z" fill="currentColor"/><path d="M5 19 13 11" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`,
  water: `<path d="M12 3.5c3.2 4.2 5.6 7.4 5.6 10.3a5.6 5.6 0 0 1-11.2 0c0-2.9 2.4-6.1 5.6-10.3z" fill="#47b8d6"/><path d="M9.3 14.4a3 3 0 0 0 2 2.6" stroke="#d9f6ff" stroke-width="1.5" stroke-linecap="round" fill="none"/>`,
  tree: `<path d="M12 21v-5" stroke="#8a5a36" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="10.5" r="6.5" fill="#5daa4f"/><circle cx="9.8" cy="8.6" r="2.6" fill="#7cc46a"/>`,
  rock: `<path d="M4 18.5 6.6 11l5-4.2 6 2.2L20.5 17l-2.6 2.6H6.6z" fill="#98a4b0"/><path d="M6.6 11l5-4.2 6 2.2-4.4 3.4z" fill="#c6d0d9"/>`,
};

/** Building symbols (40×40). The map renderer draws the real isometric art. */
const BLD = {
  hut: `
    <ellipse cx="20" cy="34.5" rx="14" ry="2.6" fill="#3b2a20" opacity=".14"/>
    <rect x="25" y="8" width="4.2" height="8" rx="1" fill="#a7b1bb"/>
    <rect x="10" y="18" width="20" height="16" rx="1.6" fill="#fdeccd"/>
    <rect x="10" y="18" width="20" height="3.2" fill="#ecd4aa"/>
    <path d="M5 20.4 20 7.6 35 20.4z" fill="#e3794d"/>
    <path d="M20 7.6 35 20.4H20z" fill="#c8623c"/>
    <rect x="17" y="24.5" width="6" height="9.5" rx="1.2" fill="#8a5a36"/>
    <rect x="11.6" y="22.6" width="4.2" height="4.2" rx=".9" fill="#86cfe0"/>
    <rect x="24.4" y="22.6" width="4.2" height="4.2" rx=".9" fill="#86cfe0"/>`,
  field: `
    <ellipse cx="20" cy="34.5" rx="15" ry="2.6" fill="#3b2a20" opacity=".14"/>
    <rect x="4.5" y="26" width="31" height="8" rx="4" fill="#9c6037"/>
    <path d="M8 29.5h24" stroke="#82502e" stroke-width="1.4" stroke-linecap="round"/>
    <g stroke="#c08b2b" stroke-width="1.5" stroke-linecap="round">
      <path d="M10 28V15M15 28V12M20 28V14M25 28V11M30 28V15"/>
    </g>
    <g fill="#f3c24f">
      <ellipse cx="10" cy="13.6" rx="2" ry="3.4"/><ellipse cx="15" cy="10.6" rx="2" ry="3.4"/>
      <ellipse cx="20" cy="12.6" rx="2" ry="3.4"/><ellipse cx="25" cy="9.6" rx="2" ry="3.4"/>
      <ellipse cx="30" cy="13.6" rx="2" ry="3.4"/>
    </g>`,
  sawmill: `
    <ellipse cx="20" cy="34.5" rx="15" ry="2.6" fill="#3b2a20" opacity=".14"/>
    <rect x="3.5" y="25" width="23" height="8.5" rx="4.25" fill="#b36d35"/>
    <circle cx="26.2" cy="29.25" r="4.25" fill="#f2c48d"/>
    <circle cx="26.2" cy="29.25" r="2.2" fill="none" stroke="#cf9257" stroke-width="1.2"/>
    <g transform="translate(23 15)">
      <path d="M0-11 2-8.5 5.5-9.6 5.6-6 9.1-4.8 7.3-1.6 9.6 1.3 6.3 2.6 6.3 6.2 2.8 5.6 1 8.7-1.6 6.4-4.8 7.9-5.4 4.3-8.9 3.3-7.1.1-9 -3.1-5.6-4.2-5.4-7.8-1.9-7z" fill="#c2cbd3"/>
      <circle r="5" fill="#e3e8ec"/><circle r="1.8" fill="#7a8794"/>
    </g>`,
  quarry: `
    <ellipse cx="20" cy="34.5" rx="15" ry="2.6" fill="#3b2a20" opacity=".14"/>
    <path d="M4.5 33.5 7 24.5l6-4.5 6.5 2.5 2.5 11z" fill="#95a2ae"/>
    <path d="M7 24.5l6-4.5 6.5 2.5-5 3.6z" fill="#c6d0d9"/>
    <path d="M18.5 33.5 21 26l5-3.2 5 2 3.5 8.7z" fill="#8794a0"/>
    <path d="M21 26l5-3.2 5 2-4 2.6z" fill="#b8c3cd"/>
    <path d="M27.5 18.5 16 7" stroke="#8a5a36" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M9.5 10.5c4-4.6 10.6-5.8 15.8-3.2-1.4.3-2.7 1-3.8 2l1 4.4c-1-.8-2.2-1.3-3.4-1.6-2.4-1.4-6-2-9.6-1.6z" fill="#7a8794"/>`,
  market: `
    <ellipse cx="20" cy="34.5" rx="15" ry="2.6" fill="#3b2a20" opacity=".14"/>
    <rect x="8" y="15" width="2.2" height="19" fill="#8a5a36"/>
    <rect x="29.8" y="15" width="2.2" height="19" fill="#8a5a36"/>
    <rect x="7" y="24" width="26" height="10" rx="1.6" fill="#c27a3d"/>
    <rect x="7" y="24" width="26" height="2.4" fill="#d6955a"/>
    <path d="M5 16 8 8h24l3 8z" fill="#fff4dc"/>
    <path d="M8 8h4.8L11 16H5zM17.6 8h4.8l.6 8h-6zM27.2 8H32l3 8h-6z" fill="#1aa394"/>
    <path d="M5 16h30v1.6a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0z" fill="#e3794d"/>
    <circle cx="12.5" cy="22.4" r="2.2" fill="#e8483b"/><circle cx="16.6" cy="22.6" r="2" fill="#f2b632"/>
    <circle cx="23.5" cy="22.4" r="2.2" fill="#7cc46a"/><circle cx="27.6" cy="22.6" r="2" fill="#e8483b"/>`,
  warehouse: `
    <ellipse cx="20" cy="34.5" rx="15.5" ry="2.6" fill="#3b2a20" opacity=".14"/>
    <rect x="6.5" y="16" width="27" height="18" rx="1.4" fill="#c98448"/>
    <path d="M11 16v18M15.5 16v18M24.5 16v18M29 16v18" stroke="#b06f38" stroke-width="1.1"/>
    <path d="M3.5 17.5 20 6l16.5 11.5z" fill="#9b4f36"/>
    <path d="M20 6l16.5 11.5H20z" fill="#7f3f2c"/>
    <rect x="14.5" y="21.5" width="11" height="12.5" rx="1" fill="#7a4a2c"/>
    <path d="M14.5 21.5l11 12.5M25.5 21.5l-11 12.5" stroke="#f2c48d" stroke-width="1.4"/>
    <circle cx="20" cy="12.6" r="2" fill="#fbe3b5"/>`,
};

function svg(body, viewBox, cls) {
  return `<svg class="${cls}" viewBox="${viewBox}" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Any icon by name: resource, UI glyph or building symbol. */
export function icon(name, cls = 'ico') {
  if (RES[name]) return svg(RES[name], '0 0 24 24', `${cls} ico--${name}`);
  if (UI[name]) return svg(UI[name], '0 0 24 24', `${cls} ico--${name}`);
  if (BLD[name]) return svg(BLD[name], '0 0 40 40', `${cls} ico--b-${name}`);
  return svg('', '0 0 24 24', cls);
}

/** Same as icon() but returns a DOM element. */
export function iconEl(name, cls = 'ico') {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name, cls).trim();
  return tpl.content.firstChild;
}

/**
 * Amount chips: [icon]+25 … for resource objects. Icons instead of words keep
 * texts language-neutral (and spare Polish the genitive gymnastics).
 */
export function amounts(obj, { sign = '', rate = false } = {}) {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (!Number.isFinite(v) || Math.abs(v) < (rate ? 0.005 : 0.5)) continue;
    const el = document.createElement('span');
    el.className = `amt amt--${k}`;
    el.innerHTML = icon(k);
    el.append(rate ? fmtRate(v) : `${sign}${fmt(v)}`);
    out.push(el);
  }
  return out;
}

/** A single glyph + text chip (e.g. bonus percentage). */
export function chip(name, text) {
  const el = document.createElement('span');
  el.className = `amt amt--${name}`;
  el.innerHTML = icon(name);
  el.append(text);
  return el;
}

/** SVG markup as a data URL (lets the canvas draw the very same icons). */
export function iconDataUrl(name, size = 48) {
  const markup = icon(name).replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

export const ICON_NAMES = Object.freeze({ res: Object.keys(RES), ui: Object.keys(UI), buildings: Object.keys(BLD) });

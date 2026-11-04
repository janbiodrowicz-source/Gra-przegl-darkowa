/**
 * Tiny i18n: t(key, params) with {placeholder} interpolation and plural
 * forms via Intl.PluralRules (Polish needs one / few / many).
 *
 * Plural entries are objects: { one: '{n} chata', few: '{n} chaty', many: '{n} chat', other: '…' }
 * and are selected with params.n.
 */
import pl from './lang/pl.js?v=0.3.2';
import en from './lang/en.js?v=0.3.2';

export const DICTS = Object.freeze({ pl, en });
export const LANGUAGES = Object.freeze(Object.keys(DICTS));
export const DEFAULT_LANG = 'pl';

let current = DEFAULT_LANG;
const listeners = new Set();
const pluralRules = new Map();
const missing = new Set();

export function getLang() {
  return current;
}

export function setLang(lang) {
  const next = DICTS[lang] ? lang : DEFAULT_LANG;
  if (next === current) return;
  current = next;
  for (const fn of listeners) fn(current);
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function plural(lang, n) {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(lang);
    pluralRules.set(lang, rules);
  }
  return rules.select(n);
}

export function has(key, lang = current) {
  return DICTS[lang]?.[key] !== undefined;
}

export function t(key, params = null) {
  let entry = DICTS[current][key];
  if (entry === undefined) entry = DICTS[DEFAULT_LANG][key];
  if (entry === undefined) {
    if (!missing.has(key)) {
      missing.add(key);
      console.warn(`[i18n] missing key "${key}"`);
    }
    return key;
  }
  if (typeof entry === 'object') {
    const n = Number(params?.n ?? 0);
    entry = entry[plural(current, n)] ?? entry.other ?? entry.many ?? Object.values(entry)[0];
  }
  if (!params) return entry;
  return entry.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
}

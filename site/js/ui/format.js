/**
 * Readable numbers and times.
 *   fmt(1234) → "1.2K", fmt(56789) → "56K", fmt(3.4e6) → "3.4M"
 *   fmtRate(0.8) → "+0.8/s"
 *   fmtClock(42) → "0:42",  fmtDuration(8040) → "2 h 14 min"
 */
import { t } from '../i18n.js?v=0.3.3';

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'];
const MINUS = '−';

/** Compact number, always rounded down so "20" never shows before 20 is reached. */
export function fmt(n) {
  if (n === Infinity) return '∞';
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? MINUS : '';
  let v = Math.abs(n);
  if (v < 1000) return sign + Math.floor(v + 1e-9);
  let i = 0;
  while (v >= 1000 && i < SUFFIXES.length - 1) {
    v /= 1000;
    i++;
  }
  const body = v < 10 ? trimZero((Math.floor(v * 10 + 1e-9) / 10).toFixed(1)) : String(Math.floor(v + 1e-9));
  return sign + body + SUFFIXES[i];
}

/** Like fmt but keeps one decimal for small values (used for costs/rewards precision). */
export function fmtExact(n) {
  if (Math.abs(n) < 1000) return String(Math.round(n));
  return fmt(n);
}

function trimZero(s) {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** A signed per-second rate. */
export function fmtRate(r, { perSec = true } = {}) {
  const v = Math.abs(r);
  let body;
  if (v < 0.005) body = '0';
  else if (v < 0.1) body = v.toFixed(2);
  else if (v < 10) body = trimZero(v.toFixed(1));
  else body = fmt(v);
  const sign = v < 0.005 ? '' : r < 0 ? MINUS : '+';
  return sign + body + (perSec ? '/s' : '');
}

/** Percent from a fraction: 0.2 → "+20%". */
export function fmtPct(f, signed = true) {
  const p = Math.round(f * 100);
  return `${signed && p > 0 ? '+' : p < 0 ? MINUS : ''}${Math.abs(p)}%`;
}

/** Countdown style: 0:42, 12:05, 1:02:03. */
export function fmtClock(sec) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** Human duration with i18n units: "45 s", "3 min", "2 h 14 min". */
export function fmtDuration(sec) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return t('time.s', { n: s });
  const totalMin = Math.floor(s / 60);
  if (totalMin < 60) return t('time.m', { n: totalMin });
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${t('time.h', { n: h })} ${t('time.m', { n: m })}` : t('time.h', { n: h });
}

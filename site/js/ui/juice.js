/**
 * UI "juice": resource icons flying into the HUD, chip bumps and confetti.
 * Web Animations API + transform/opacity only; skipped for reduced motion.
 */
import { icon } from './icons.js';
import { retrigger } from './dom.js';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Icons fly from a screen point to each resource chip.
 * @param {HTMLElement} root   overlay to put the icons in
 * @param {Record<string, HTMLElement>} chips  resource → chip element
 * @param {Record<string, number>} amounts
 * @param {{x:number,y:number}} from  CSS px
 * @param {(res:string)=>void} onArrive
 */
export function flyResources(root, chips, amounts, from, onArrive) {
  let delay = 0;
  for (const [res, value] of Object.entries(amounts || {})) {
    const chip = chips[res];
    if (!chip || !(value >= 1)) continue;
    if (reducedMotion() || !from) {
      bump(chip);
      onArrive?.(res);
      continue;
    }
    const r = chip.getBoundingClientRect();
    const to = { x: r.left + 19, y: r.top + r.height / 2 };
    const count = Math.min(7, Math.max(2, Math.round(Math.log2(value + 1))));
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = 'fly';
      el.innerHTML = icon(res);
      root.appendChild(el);
      const jx = (Math.random() - 0.5) * 70;
      const jy = (Math.random() - 0.5) * 46 - 10;
      const mx = from.x + jx * 0.6 + (to.x - from.x) * 0.3;
      const my = Math.min(from.y, to.y) + (Math.max(from.y, to.y) - Math.min(from.y, to.y)) * 0.35 - 30;
      const anim = el.animate([
        { transform: `translate(${from.x}px, ${from.y}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${from.x + jx}px, ${from.y + jy}px) scale(1.15)`, opacity: 1, offset: 0.22 },
        { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${to.x}px, ${to.y}px) scale(0.65)`, opacity: 0.85 },
      ], { duration: 820 + i * 50, delay: delay + i * 60, easing: 'cubic-bezier(.5, .05, .4, 1)', fill: 'both' });
      const last = i === count - 1;
      anim.onfinish = () => {
        el.remove();
        bump(chip);
        if (last || i === 0) onArrive?.(res);
      };
    }
    delay += 110;
  }
}

export function bump(el) {
  if (el) retrigger(el, 'is-bump');
}

const CONFETTI = ['#ffc93d', '#e3794d', '#1aa394', '#7cc46a', '#ff8fab', '#8e6fd8'];

/** A small confetti burst from a screen point. */
export function confetti(root, x, y, n = 18) {
  if (reducedMotion()) return;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('span');
    el.className = 'confetti';
    el.style.background = CONFETTI[i % CONFETTI.length];
    if (i % 3 === 0) el.style.borderRadius = '50%';
    root.appendChild(el);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    const v = 60 + Math.random() * 90;
    const dx = Math.cos(a) * v;
    const dy = Math.sin(a) * v;
    const rot = (Math.random() - 0.5) * 720;
    const anim = el.animate([
      { transform: `translate(${x}px, ${y}px) rotate(0deg) scale(1)`, opacity: 1 },
      { transform: `translate(${x + dx}px, ${y + dy}px) rotate(${rot / 2}deg) scale(1)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x + dx * 1.25}px, ${y + dy + 90}px) rotate(${rot}deg) scale(0.6)`, opacity: 0 },
    ], { duration: 1000 + Math.random() * 500, easing: 'cubic-bezier(.2, .7, .4, 1)', fill: 'both' });
    anim.onfinish = () => el.remove();
  }
}

/** Centre of an element's box in CSS px. */
export function centerOf(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

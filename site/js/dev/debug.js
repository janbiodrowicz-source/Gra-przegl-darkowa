/**
 * Developer overlay (loaded on demand with ?debug). Shows live numbers and
 * offers cheats for testing: resources, random actions, time skips.
 * Not translated on purpose — it is a tool, not part of the game.
 */
import { BUILDING_ORDER, QUESTS, RESOURCES } from '../config.js';
import { buildCost, canAfford, isUnlocked, upgradeCost } from '../core/economy.js';
import { N, idx, isBuildable, isClearable } from '../core/map.js';
import { getRates } from '../core/sim.js';
import { canPlace } from '../core/actions.js';

const CSS = `
#dbg{position:fixed;left:8px;top:calc(8px + env(safe-area-inset-top,0px));z-index:9999;max-width:min(360px,calc(100vw - 16px));
  font:12px/1.35 "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;color:#eafff9;background:rgba(14,28,34,.86);
  border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:auto;user-select:text}
#dbg header{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;font-weight:700;color:#7ff0d8}
#dbg header span{margin-left:auto;font-weight:400;color:#9fb9b4}
#dbg pre{margin:0;padding:0 10px 8px;white-space:pre-wrap;max-height:42vh;overflow:auto}
#dbg .btns{display:flex;flex-wrap:wrap;gap:6px;padding:0 10px 10px}
#dbg button{font:inherit;color:#0d2a2a;background:#7ff0d8;border:0;border-radius:8px;padding:6px 8px;min-height:32px;cursor:pointer}
#dbg button:active{transform:translateY(1px)}
#dbg.collapsed pre,#dbg.collapsed .btns{display:none}
`;

const f1 = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

export function mountDebug(game, { collapsed = false } = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'dbg';
  if (collapsed) root.classList.add('collapsed');
  root.innerHTML = '<header>🛠 debug <span></span></header><pre></pre><div class="btns"></div>';
  document.body.appendChild(root);
  const head = root.querySelector('header span');
  const pre = root.querySelector('pre');
  const btns = root.querySelector('.btns');
  root.querySelector('header').addEventListener('click', () => root.classList.toggle('collapsed'));

  const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const log = [];
  const note = (msg) => {
    log.unshift(msg);
    log.length = Math.min(log.length, 4);
  };

  const actions = {
    '+100 all': () => game.dispatch('cheatGive', { wood: 100, stone: 100, food: 100, coins: 100 }),
    'build random': () => {
      const s = game.state;
      const types = BUILDING_ORDER.filter((t) => isUnlocked(s, t) && canAfford(s.res, buildCost(s, t)));
      if (!types.length) return note('nothing affordable');
      const type = rnd(types);
      const spots = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (canPlace(s, type, x, y).ok) spots.push([x, y]);
      if (!spots.length) return note('no free tile');
      const [x, y] = rnd(spots);
      const r = game.dispatch('build', type, x, y);
      note(`build ${type} @${x},${y}: ${r.ok ? 'ok' : r.reason}`);
    },
    'upgrade random': () => {
      const s = game.state;
      const list = s.buildings.filter((b) => { const c = upgradeCost(b); return c && canAfford(s.res, c); });
      if (!list.length) return note('no affordable upgrade');
      const b = rnd(list);
      const r = game.dispatch('upgrade', b.id);
      note(`upgrade ${b.type}#${b.id} → ${r.ok ? b.level : r.reason}`);
    },
    'demolish random': () => {
      const s = game.state;
      if (s.buildings.length < 2) return note('nothing to demolish');
      const b = rnd(s.buildings.slice(1));
      const r = game.dispatch('demolish', b.id);
      note(`demolish ${b.type}#${b.id}: ${r.ok ? JSON.stringify(r.refund) : r.reason}`);
    },
    'clear tile': () => {
      const s = game.state;
      const spots = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (isClearable(s.tiles[idx(x, y)])) spots.push([x, y]);
      if (!spots.length) return note('nothing to clear');
      const [x, y] = rnd(spots);
      const r = game.dispatch('clearTile', x, y);
      note(`clear @${x},${y}: ${r.ok ? JSON.stringify(r.gained) : r.reason}`);
    },
    'claim quests': () => {
      for (const q of QUESTS) if (game.state.quests[q.id] === 'done') game.dispatch('claimQuest', q.id);
    },
    'skip 1h': () => { const r = game.skip(3600); note(r ? `skipped ${Math.round(r.seconds)}s` : 'skip failed'); },
    'skip 9h': () => { const r = game.skip(9 * 3600); note(r ? `skipped ${Math.round(r.seconds)}s (capped: ${r.capped})` : 'skip failed'); },
    'time x10': () => { game.timeScale = game.timeScale === 1 ? 10 : 1; note(`time ×${game.timeScale}`); },
    save: () => note(game.save() ? 'saved' : 'save failed'),
    reset: () => { game.reset(); note('reset'); },
  };
  for (const [label, fn] of Object.entries(actions)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', fn);
    btns.appendChild(b);
  }

  let acc = 1;
  game.onFrame((dt) => {
    acc += dt;
    if (acc < 0.25) return;
    acc = 0;
    const s = game.state;
    const r = getRates(s);
    head.textContent = `${Math.round(game.fps)} fps · ×${game.timeScale}`;
    const lines = [];
    lines.push(`t=${s.time.toFixed(0)}s  seed=${s.seed}  load=${game.loadStatus}${game.readOnly ? ' (read-only)' : ''}`);
    for (const k of RESOURCES) {
      const cap = Number.isFinite(r.caps[k]) ? `/${r.caps[k]}` : '';
      lines.push(`${k.padEnd(6)} ${f1(s.res[k]).padStart(7)}${cap.padEnd(6)} ${r.net[k] >= 0 ? '+' : ''}${f1(r.net[k])}/s`);
    }
    lines.push(`pop    ${s.pop.toFixed(1)}/${r.popCap}  jobs ${r.employed}/${r.jobs}  idle ${r.idle}${r.hungry ? `  HUNGRY ×${r.mult.toFixed(2)}` : ''}`);
    lines.push(`quests ${QUESTS.map((q) => `${q.id}:${s.quests[q.id][0]}`).join(' ')}`);
    const counts = {};
    for (const b of s.buildings) counts[b.type] = (counts[b.type] || 0) + 1;
    lines.push(`bld    ${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(' ')}`);
    let free = 0;
    for (let i = 0; i < s.tiles.length; i++) if (isBuildable(s.tiles[i])) free++;
    lines.push(`tiles  buildable ${free - s.buildings.length}  storage ${game.platform.storage.persistent ? 'local' : 'MEMORY'}`);
    if (game.lastReport) {
      const g = game.lastReport.gained;
      lines.push(`offline ${Math.round(game.lastReport.seconds)}s: ${RESOURCES.map((k) => `${k[0]}${g[k] >= 0 ? '+' : ''}${f1(g[k])}`).join(' ')}`);
    }
    for (const l of log) lines.push(`> ${l}`);
    pre.textContent = lines.join('\n');
  });
  return root;
}

#!/usr/bin/env node
/**
 * Browser QA: runs scenarios in Chromium (Playwright), saves screenshots for a
 * phone (390×844, touch) and a desktop (1280×720), and fails on console errors,
 * page errors, failed requests or ANY request that leaves the local server.
 *
 *   node tools/shots.mjs [--only=fresh,offline] [--out=shots] [--dsf=2] [--fps] [--vp=mobile,desktop]
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './serve.mjs';

// CommonJS resolution also finds a globally installed Playwright (NODE_PATH).
const { chromium } = createRequire(import.meta.url)('playwright');

const args =Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v = 'true'] = a.replace(/^--/, '').split('=');
  return [k, v];
}));
const OUT = resolve(args.out || 'shots');
const DSF = Number(args.dsf || 1);
const ONLY = args.only ? args.only.split(',') : null;
const FPS = args.fps === 'true';
const VPS = (args.vp || 'mobile,desktop').split(',');

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: DSF },
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: DSF },
  landphone: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: DSF },
};

const wait = (page, ms) => page.waitForTimeout(ms);
const game = (page, fn, arg) => page.evaluate(fn, arg);

/** Scenario: { path, fresh (clear storage first), run(page) → extra info } */
export const SCENARIOS = {
  fresh: {
    path: '?test',
    fresh: true,
    async run(page) {
      await wait(page, 1500);
      return game(page, () => ({ status: window.__game.loadStatus, res: window.__game.state.res }));
    },
  },
  demo: {
    path: '?test&demo',
    fresh: true,
    async run(page) {
      await wait(page, 1800);
    },
  },
  wave2: {
    // the ~40 min town: windmill, bakery, fisher, well, flowerbeds, fountain
    path: '?test&demo=2',
    fresh: true,
    async run(page) {
      await wait(page, 1800);
      return game(page, () => ({ quest: window.__ui ? document.querySelector('.qpill__title')?.textContent : null, buildings: window.__game.state.buildings.length }));
    },
  },
  wave2panel: {
    path: '?test&demo=2',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await game(page, () => {
        const b = window.__game.state.buildings.find((x) => x.type === 'well');
        window.__ui.select({ kind: 'building', id: b.id });
      });
      await wait(page, 700);
    },
  },
  wave2place: {
    path: '?test&demo=2',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await page.click('.card[data-type="fisher"]');
      await wait(page, 900);
      return game(page, () => document.querySelector('.placebar__meta')?.textContent);
    },
  },
  legacy: {
    // a v1 save (14×14 island, five quests done) loads into the archipelago version
    path: '?test',
    fresh: true,
    async run(page) {
      await wait(page, 600);
      await game(page, async () => {
        const { createState } = await import('/js/core/state.js?v=0.3.1');
        const { N } = await import('/js/core/map.js?v=0.3.1');
        const s = createState({ seed: 4242 });
        const off = Math.floor((N - 14) / 2);
        let tiles = '';
        for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) tiles += s.tiles[(y + off) * N + x + off];
        const quests = { q1: 'claimed', q2: 'claimed', q3: 'claimed', q4: 'claimed', q5: 'claimed', q6: 'active' };
        const state = { seed: s.seed, time: 600, res: { wood: 120, stone: 80, food: 90, coins: 300 }, pop: 3, tiles,
          buildings: s.buildings.map((b) => ({ ...b, x: b.x - off, y: b.y - off })), nextId: s.nextId, quests,
          stats: s.stats, flags: s.flags, meta: { prestige: 0, prestigePoints: 0, prestigeCount: 0 }, createdAt: 1 };
        window.__game.readOnly = true; // keep this tab from overwriting the injected save
        localStorage.setItem('wysepka.save', JSON.stringify({ v: 1, savedAt: Date.now() - 5000, tab: 'old', state }));
      });
      await page.reload({ waitUntil: 'load' });
      await wait(page, 1500);
      return game(page, () => ({ status: window.__game.loadStatus, islands: window.__game.world.islands.length, q6: window.__game.state.quests.q6, hut: window.__game.state.buildings[0] && [window.__game.state.buildings[0].x, window.__game.state.buildings[0].y] }));
    },
  },
  isles: {
    // archipelago: island button with a red dot, the islands window
    path: '?test&demo=3',
    fresh: true,
    async run(page) {
      await wait(page, 1200);
      await game(page, () => window.__ui.openIslands());
      await wait(page, 700);
      return game(page, () => ({ islands: window.__game.world.islands.length, rows: document.querySelectorAll('.isle').length }));
    },
  },
  offers: {
    path: '?test&demo=3',
    fresh: true,
    async run(page) {
      await wait(page, 1000);
      await game(page, () => window.__ui.openOffers());
      await wait(page, 700);
      return game(page, () => document.querySelectorAll('.offer').length);
    },
  },
  harbour: {
    // harbour panel: send the ship; the ship sprite disappears while away
    path: '?test&demo=3',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await game(page, () => {
        const g = window.__game;
        g.dispatchWorld('dismissOffers');
        const b = g.state.buildings.find((x) => x.type === 'port');
        window.__ui.select({ kind: 'building', id: b.id });
      });
      await wait(page, 500);
      await page.click('.port__send');
      await wait(page, 700);
      return game(page, () => ({ scout: window.__game.world.scout }));
    },
  },
  sail: {
    // switch to the snow island
    path: '?test&demo=3',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await game(page, () => window.__game.dispatchWorld('setActive', 1));
      await wait(page, 1400);
      return game(page, () => ({ biome: window.__game.state.biome }));
    },
  },
  sail2: {
    path: '?test&demo=3',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await game(page, () => window.__game.dispatchWorld('setActive', 2));
      await wait(page, 1400);
      return game(page, () => ({ biome: window.__game.state.biome }));
    },
  },
  panel: {
    path: '?test&demo',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await game(page, () => {
        const b = window.__game.state.buildings.find((x) => x.type === 'sawmill');
        window.__ui.select({ kind: 'building', id: b.id });
      });
      await wait(page, 700);
    },
  },
  tile: {
    path: '?test',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await game(page, () => {
        const s = window.__game.state;
        const i = s.tiles.indexOf('t');
        const n = Math.sqrt(s.tiles.length);
        window.__ui.select({ kind: 'tile', x: i % n, y: Math.floor(i / n) });
      });
      await wait(page, 700);
    },
  },
  noincome: {
    // no stone income: the card pill names the missing resource, a tap explains where to get it
    path: '?test',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await game(page, () => {
        const g = window.__game;
        g.state.res.stone = 0;
        g.state.rev++;
      });
      await wait(page, 400);
      await page.click('.card[data-type="sawmill"]');
      await wait(page, 600);
      return game(page, () => document.querySelector('.toast__text')?.textContent);
    },
  },
  quests: {
    path: '?test',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await game(page, async () => {
        const g = window.__game;
        const { suggestSpot } = await import('/js/core/actions.js?v=0.3.1');
        const spot = suggestSpot(g.state, 'field');
        g.dispatch('build', 'field', spot.x, spot.y);
        window.__ui.openQuests();
      });
      await wait(page, 900);
    },
  },
  settings: {
    path: '?test',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await game(page, () => window.__ui.openSettings());
      await wait(page, 700);
    },
  },
  welcome: {
    path: '?test&demo',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await game(page, async () => {
        const m = await import('/js/dev/demo.js?v=0.3.1');
        window.__ui.showWelcome(m.DEMO_REPORT);
      });
      await wait(page, 900);
    },
  },
  place: {
    path: '?test&demo',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      await game(page, () => window.__ui.startPlacement('field'));
      await wait(page, 700);
    },
  },
  english: {
    path: '?test&demo',
    fresh: true,
    async run(page) {
      await wait(page, 600);
      await game(page, () => { window.__game.setSetting('lang', 'en'); });
      await game(page, async () => { (await import('/js/i18n.js?v=0.3.1')).setLang('en'); });
      await wait(page, 600);
      await game(page, () => {
        const b = window.__game.state.buildings.find((x) => x.type === 'market');
        window.__ui.select({ kind: 'building', id: b.id });
      });
      await wait(page, 700);
    },
  },
  interact: {
    path: '?test',
    fresh: true,
    async run(page) {
      await wait(page, 900);
      const count = () => game(page, () => window.__game.state.buildings.length);
      const before = await count();
      // card → placement bar → confirm
      await page.click('.card[data-type="field"]');
      await wait(page, 250);
      if (!(await page.isVisible('.placebar'))) throw new Error('placement bar not shown');
      await page.click('.placebar__ok');
      await wait(page, 300);
      if ((await count()) !== before + 1) throw new Error('building not placed via UI');
      // quest pill claim (q1 done after the field)
      await page.click('.qpill__claim', { force: true }); // it pulses forever, so it is never "stable"
      await wait(page, 300);
      const q = await game(page, () => window.__game.state.quests.q1);
      if (q !== 'claimed') throw new Error(`quest not claimed: ${q}`);
      // keyboard: 1 → hut placement, Escape cancels
      await page.keyboard.press('1');
      await wait(page, 150);
      const mode = await game(page, () => window.__ui.state.mode);
      await page.keyboard.press('Escape');
      await wait(page, 150);
      const mode2 = await game(page, () => window.__ui.state.mode);
      if (mode !== 'place' || mode2 !== 'idle') throw new Error(`keyboard placement failed: ${mode}/${mode2}`);
      // settings: switch to English and back
      await page.click('.hud-btn');
      await wait(page, 300);
      await page.click('.seg button[lang="en"]');
      await wait(page, 400);
      const title = await page.textContent('.modal__title');
      if (!/Settings/.test(title)) throw new Error(`language switch failed: ${title}`);
      await page.click('.seg button[lang="pl"]');
      await wait(page, 400);
      // hold to reset
      const box = await page.locator('.hold').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await wait(page, 1700);
      await page.mouse.up();
      await wait(page, 400);
      const after = await count();
      if (after !== 1) throw new Error(`reset failed, buildings: ${after}`);
      return { placed: true, claimed: true, keyboard: true, lang: true, reset: true };
    },
  },
  mapclick: {
    path: '?test',
    fresh: true,
    async run(page, context) {
      await wait(page, 1000);
      const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      const tap = async (x, y) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
      const tileXY = (x, y) => game(page, ([tx, ty]) => window.__renderer.tileToScreen(tx, ty), [x, y]);
      const sel = () => game(page, () => window.__ui.state.selected);
      // 1) tap the start hut
      const hut = await game(page, () => window.__game.state.buildings[0]);
      const [hx, hy] = await tileXY(hut.x, hut.y);
      await tap(hx, hy - 10);
      await wait(page, 300);
      const s1 = await sel();
      if (!s1 || s1.kind !== 'building') throw new Error(`hut not selected: ${JSON.stringify(s1)}`);
      // close the panel (on desktop it covers the right side) and let the camera settle
      await page.keyboard.press('Escape');
      await wait(page, 700);
      // 2) tap a tree
      const tree = await game(page, () => {
        // a tree far from the hut, with nothing standing in front of it
        const s = window.__game.state; const n = Math.sqrt(s.tiles.length); const h = s.buildings[0];
        let best = null, bestD = -1;
        for (let i = 0; i < s.tiles.length; i++) {
          if (s.tiles[i] !== 't') continue;
          const x = i % n, y = Math.floor(i / n);
          const front = [[1, 0], [0, 1], [1, 1]].some(([dx, dy]) => 'tr'.includes(s.tiles[(y + dy) * n + x + dx]));
          const [sx, sy] = window.__renderer.tileToScreen(x, y);
          const visible = sx > 40 && sx < innerWidth - 40 && sy > 160 && sy < innerHeight - 160;
          const d = Math.hypot(x - h.x, y - h.y);
          if (!front && visible && d > bestD) { bestD = d; best = { x, y }; }
        }
        return best;
      });
      const [tx, ty] = await tileXY(tree.x, tree.y);
      await tap(tx, ty - 12);
      await wait(page, 600);
      const s2 = await sel();
      if (!s2 || s2.kind !== 'tile') throw new Error(`tree not selected: ${JSON.stringify(s2)}`);
      // close the panel
      await page.click('.panel__close');
      await wait(page, 450);
      // 3) placement through the map
      const before = await game(page, () => window.__game.state.buildings.length);
      await page.click('.card[data-type="field"]');
      await wait(page, 900); // the camera may zoom in to a finger-friendly size first
      const spot = await game(page, async () => {
        const { canPlace } = await import('/js/core/actions.js?v=0.3.1');
        const s = window.__game.state; const n = Math.sqrt(s.tiles.length); const g = window.__ui.state.ghost;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          if ((x !== g.x || y !== g.y) && canPlace(s, 'field', x, y).ok) {
            const [sx, sy] = window.__renderer.tileToScreen(x, y);
            if (sx > 40 && sx < innerWidth - 40 && sy > 140 && sy < innerHeight - 160) return { x, y };
          }
        }
        return null;
      });
      const [px, py] = await tileXY(spot.x, spot.y);
      await tap(px, py);
      await wait(page, 250);
      if (touch) {
        const g = await game(page, () => window.__ui.state.ghost);
        if (g.x !== spot.x || g.y !== spot.y) throw new Error('ghost did not move on tap');
        await tap(px, py); // second tap on the same tile builds
        await wait(page, 250);
      }
      const after = await game(page, () => window.__game.state.buildings.length);
      const placedAt = await game(page, () => { const b = window.__game.state.buildings.at(-1); return { x: b.x, y: b.y, type: b.type }; });
      if (after !== before + 1 || placedAt.x !== spot.x || placedAt.y !== spot.y) throw new Error(`placement via map failed ${JSON.stringify(placedAt)} vs ${JSON.stringify(spot)}`);
      // 4) drag pans the camera
      const cam0 = await game(page, () => ({ x: window.__renderer.cam.x, y: window.__renderer.cam.y, z: window.__renderer.cam.zoom }));
      const vw = page.viewportSize().width, vh = page.viewportSize().height;
      if (touch) {
        const cdp = await context.newCDPSession(page);
        const pt = (x, y) => [{ x, y, id: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(vw / 2, vh / 2) });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(vw / 2 - i * 12, vh / 2 - i * 6) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        // pinch zoom with two fingers
        const two = (d) => [{ x: vw / 2 - d, y: vh / 2, id: 1 }, { x: vw / 2 + d, y: vh / 2, id: 2 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: two(40) });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: two(40 + i * 10) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(vw / 2, vh / 2);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(vw / 2 - i * 12, vh / 2 - i * 6);
        await page.mouse.up();
        await page.mouse.move(vw / 2, vh / 2);
        await page.mouse.wheel(0, -400);
      }
      await wait(page, 400);
      const cam1 = await game(page, () => ({ x: window.__renderer.cam.x, y: window.__renderer.cam.y, z: window.__renderer.cam.zoom }));
      if (Math.abs(cam1.x - cam0.x) < 5 && Math.abs(cam1.y - cam0.y) < 5) throw new Error('drag did not pan');
      if (!(cam1.z > cam0.z * 1.1)) throw new Error(`zoom did not change ${cam0.z} → ${cam1.z}`);
      return { selectHut: true, selectTree: true, placed: spot, panned: true, zoom: +(cam1.z / cam0.z).toFixed(2) };
    },
  },
  offline: {
    path: '?test',
    fresh: true,
    async run(page) {
      await wait(page, 800);
      // Freeze saving, push savedAt 3 h into the past, reload → offline progress.
      await game(page, () => {
        const g = window.__game;
        g.save();
        g.readOnly = true;
        const raw = JSON.parse(localStorage.getItem('wysepka.save'));
        raw.savedAt -= 3 * 3600 * 1000;
        localStorage.setItem('wysepka.save', JSON.stringify(raw));
      });
      await page.reload();
      await wait(page, 1500);
      const report = await game(page, () => {
        const r = window.__game.lastReport;
        return r && { seconds: Math.round(r.seconds), gained: r.gained, fullAt: r.fullAt, hungerAt: r.hungerAt };
      });
      if (!report || Math.abs(report.seconds - 10800) > 5) throw new Error(`offline report missing/wrong: ${JSON.stringify(report)}`);
      return report;
    },
  },
};

async function measureFps(page, context) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const frames = await page.evaluate(() => new Promise((done) => {
    const times = [];
    let last = performance.now();
    const start = last;
    function f(now) {
      times.push(now - last);
      last = now;
      if (now - start < 3000) requestAnimationFrame(f);
      else done(times.slice(5));
    }
    requestAnimationFrame(f);
  }));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const sorted = [...frames].sort((a, b) => a - b);
  const avg = frames.reduce((p, q) => p + q, 0) / frames.length;
  return { avgFps: +(1000 / avg).toFixed(1), p95ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), frames: frames.length };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { server, url } = await startServer({ port: 0, quiet: true });
  const origin = new URL(url).origin;
  const browser = await chromium.launch();
  const summary = [];
  let problems = 0;

  for (const [name, sc] of Object.entries(SCENARIOS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    for (const vpName of VPS) {
      const context = await browser.newContext(VIEWPORTS[vpName]);
      const page = await context.newPage();
      const issues = [];
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') issues.push(`console.${m.type()}: ${m.text()}`);
      });
      page.on('pageerror', (e) => issues.push(`pageerror: ${e.message}`));
      page.on('requestfailed', (r) => issues.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
      page.on('request', (r) => {
        const u = r.url();
        if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) issues.push(`external request: ${u}`);
      });
      page.on('response', (r) => {
        if (r.status() >= 400) issues.push(`http ${r.status()}: ${r.url()}`);
      });

      let info = null;
      try {
        if (sc.fresh) {
          await page.goto(`${url}__blank`, { waitUntil: 'domcontentloaded' });
          await page.evaluate(() => localStorage.clear());
        }
        await page.goto(url + sc.path, { waitUntil: 'load' });
        info = await sc.run(page, context);
        if (FPS) info = { ...(info || {}), fps: await measureFps(page, context) };
        const file = resolve(OUT, `${name}-${vpName}.png`);
        await page.screenshot({ path: file });
      } catch (err) {
        issues.push(`scenario failed: ${err.message}`);
      }
      problems += issues.length;
      summary.push({ scenario: name, viewport: vpName, issues, info });
      console.log(`${issues.length ? '✗' : '✓'} ${name} @ ${vpName}${info ? ' ' + JSON.stringify(info) : ''}`);
      for (const i of issues) console.log(`    ${i}`);
      await context.close();
    }
  }

  await browser.close();
  server.close();
  writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(problems ? `\n${problems} problem(s) found` : '\nAll clean ✨');
  process.exit(problems ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

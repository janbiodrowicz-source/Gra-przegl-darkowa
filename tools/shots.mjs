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

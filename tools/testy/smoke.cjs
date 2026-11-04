// Test dymny Wysepki: otwiera grę w przeglądarce headless (z ?debug=1), czeka i sprawdza, że:
// gra się wczytuje bez błędów (konsola, wyjątki, błędy 404), nie wysyła nic poza własny adres,
// czas płynie i surowce rosną, budowanie i zapis działają, archipelag (3 wyspy, przełączanie,
// okna) działa, a stary zapis v1 wczytuje się do nowej wersji. Zapisuje zrzuty ekranu.
// Wypisuje wiersze „OK nazwa” albo „FAIL nazwa”; kod wyjścia 1, gdy cokolwiek padnie.
//   BASE=http://localhost:8137 node tools/testy/smoke.cjs katalog_na_zrzuty
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8137';
const OUT = process.argv[2] || '.';
let blad = false;
const ocena = (nazwa, ok, szczegoly = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nazwa}${szczegoly ? ` — ${szczegoly}` : ''}`);
  if (!ok) blad = true;
};

const TELEFON = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const KOMPUTER = { viewport: { width: 1280, height: 720 } };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const origin = new URL(BASE).origin;

  /** Nowa karta w czystym kontekście (pusty localStorage) z podsłuchem błędów. */
  async function karta(opcje) {
    const ctx = await b.newContext(opcje);
    const p = await ctx.newPage();
    p.__bledy = [];
    p.on('pageerror', (e) => p.__bledy.push(`wyjątek: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') p.__bledy.push(`konsola: ${m.text()}`); });
    p.on('requestfailed', (r) => p.__bledy.push(`żądanie nieudane: ${r.url()}`));
    p.on('response', (r) => { if (r.status() >= 400) p.__bledy.push(`HTTP ${r.status()}: ${r.url()}`); });
    p.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) p.__bledy.push(`zapytanie na zewnątrz: ${u}`);
    });
    return p;
  }

  const gra = (p, f, arg) => p.evaluate(f, arg);
  const gotowa = (p) => p.waitForSelector('html.is-ready', { timeout: 20000 }).catch(() => {});
  const bezBledow = async (nazwa, p) => {
    const zDebug = await p.evaluate(() => window.__bledy || []);
    ocena(`${nazwa}: brak błędów`, p.__bledy.length === 0 && zDebug.length === 0, [...p.__bledy, ...zDebug].slice(0, 3).join(' | '));
  };
  const zrzut = (p, nazwa) => p.screenshot({ path: `${OUT}/${nazwa}.png` });

  // ---------------------------------------------------------------- wersja
  {
    const p = await karta(TELEFON);
    const r = await p.goto(`${BASE}/js/wersja.js`);
    const tekst = await r.text();
    const wersja = /WERSJA = '([^']+)'/.exec(tekst)?.[1];
    ocena('wersja.js dostępny', !!wersja, wersja || 'brak');
    console.log(`     (testowana wersja: ${wersja})`);
    await p.context().close();
  }

  // ---------------------------------------------------------------- nowa gra na telefonie
  {
    const p = await karta(TELEFON);
    await p.goto(`${BASE}/?debug=1&test`);
    await gotowa(p);
    ocena('nowa gra: wczytała się (is-ready)', await p.evaluate(() => document.documentElement.classList.contains('is-ready')));
    ocena('nowa gra: okienko ?debug=1 jest', await p.evaluate(() => !!document.getElementById('dbg')));
    await p.waitForTimeout(12000);
    const s = await gra(p, () => {
      const st = window.__gra.game.state;
      return {
        czas: st.time, drewno: st.res.wood, wyspy: window.__gra.game.world.islands.length, budynki: st.buildings.length,
        hud: !!document.querySelector('.hud .res'), karty: document.querySelectorAll('.buildbar .card').length,
      };
    });
    ocena('nowa gra: czas płynie', s.czas > 8, `t=${s.czas.toFixed(1)}s`);
    ocena('nowa gra: surowce rosną (drewno > 40)', s.drewno > 40, `drewno=${s.drewno.toFixed(1)}`);
    ocena('nowa gra: 1 wyspa, 1 chata', s.wyspy === 1 && s.budynki === 1, `wyspy=${s.wyspy} budynki=${s.budynki}`);
    ocena('nowa gra: HUD i karty budynków', s.hud && s.karty >= 12, `kart=${s.karty}`);
    await zrzut(p, 'nowa-gra-telefon');

    // budowanie + zapis + ponowne wczytanie
    const buduj = await gra(p, async () => {
      const v = new URL(document.querySelector('script[src*="main.js"]').src).search;
      const { suggestSpot } = await import(`/js/core/actions.js${v}`);
      const g = window.__gra.game;
      const spot = suggestSpot(g.state, 'field');
      const r = g.dispatch('build', 'field', spot.x, spot.y);
      g.save();
      return { ok: r.ok, reason: r.reason, budynki: g.state.buildings.length };
    });
    ocena('budowanie: pole postawione', buduj.ok && buduj.budynki === 2, buduj.reason || '');
    await p.reload();
    await gotowa(p);
    await p.waitForTimeout(1500);
    const po = await gra(p, () => ({ budynki: window.__gra.game.state.buildings.length, status: window.__gra.game.loadStatus }));
    ocena('zapis: po odświeżeniu budynki wracają', po.budynki === 2 && po.status === 'loaded', `budynki=${po.budynki} status=${po.status}`);
    await bezBledow('nowa gra', p);
    await p.context().close();
  }

  // ---------------------------------------------------------------- archipelag (demo)
  {
    const p = await karta(KOMPUTER);
    await p.goto(`${BASE}/?debug=1&test&demo=3`);
    await gotowa(p);
    await p.waitForTimeout(3000);
    const w = await gra(p, () => {
      const g = window.__gra.game;
      return {
        wyspy: g.world.islands.length, biomy: g.world.islands.map((s) => s.biome),
        port: g.state.buildings.some((x) => x.type === 'port'), oferty: g.world.scout?.offers?.length ?? 0,
      };
    });
    ocena('archipelag: 3 wyspy', w.wyspy === 3, w.biomy.join(','));
    ocena('archipelag: port na wyspie głównej', w.port);
    ocena('archipelag: zwiad wrócił z ofertami', w.oferty === 2, `oferty=${w.oferty}`);
    await zrzut(p, 'archipelag-wyspa-domowa');

    await gra(p, () => window.__gra.ui.openIslands());
    await p.waitForTimeout(800);
    ocena('archipelag: okno wysp ma 3 wiersze', (await p.$$('.isle')).length === 3);
    await zrzut(p, 'archipelag-okno-wysp');
    await gra(p, () => window.__gra.game.dispatchWorld('setActive', 1)); // śnieżna
    await p.waitForTimeout(1500);
    ocena('archipelag: przełączenie na Mroźną Skałę', (await gra(p, () => window.__gra.game.state.biome)) === 'snow');
    await zrzut(p, 'archipelag-snieg');
    await gra(p, () => window.__gra.game.dispatchWorld('setActive', 2)); // tropikalna
    await p.waitForTimeout(1500);
    ocena('archipelag: przełączenie na Rajską Lagunę', (await gra(p, () => window.__gra.game.state.biome)) === 'tropic');
    await zrzut(p, 'archipelag-tropik');
    await gra(p, () => window.__gra.game.dispatchWorld('setActive', 0));
    await p.click('.modal__close'); // okno wysp jest jeszcze otwarte: inne czekałoby w kolejce
    await p.waitForTimeout(600);
    await gra(p, () => window.__gra.ui.openOffers());
    await p.waitForTimeout(800);
    ocena('archipelag: okno znalezionych wysp ma 2 oferty', (await p.$$('.offer')).length === 2);
    await zrzut(p, 'archipelag-oferty');
    await bezBledow('archipelag', p);
    await p.context().close();
  }

  // ---------------------------------------------------------------- stary zapis v1
  {
    const p = await karta(TELEFON);
    await p.goto(`${BASE}/?test`);
    await p.waitForTimeout(800);
    await gra(p, async () => {
      const v = new URL(document.querySelector('script[src*="main.js"]').src).search;
      const { createState } = await import(`/js/core/state.js${v}`);
      const { N } = await import(`/js/core/map.js${v}`);
      const s = createState({ seed: 4242 });
      const off = Math.floor((N - 14) / 2);
      let tiles = '';
      for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) tiles += s.tiles[(y + off) * N + x + off];
      const quests = { q1: 'claimed', q2: 'claimed', q3: 'claimed', q4: 'claimed', q5: 'claimed', q6: 'active' };
      const state = {
        seed: s.seed, time: 600, res: { wood: 120, stone: 80, food: 90, coins: 300 }, pop: 3, tiles,
        buildings: s.buildings.map((x) => ({ ...x, x: x.x - off, y: x.y - off })), nextId: s.nextId, quests,
        stats: s.stats, flags: s.flags, meta: { prestige: 0, prestigePoints: 0, prestigeCount: 0 }, createdAt: 1,
      };
      window.__gra.game.readOnly = true; // ta karta nie nadpisze wstrzykniętego zapisu
      localStorage.setItem('wysepka.save', JSON.stringify({ v: 1, savedAt: Date.now() - 5000, tab: 'stara', state }));
    });
    await p.reload();
    await gotowa(p);
    await p.waitForTimeout(1500);
    const z = await gra(p, () => {
      const g = window.__gra.game;
      return { status: g.loadStatus, wyspy: g.world.islands.length, q6: g.state.quests.q6, drewno: g.state.res.wood };
    });
    ocena('stary zapis v1: wczytany do nowej wersji', z.status === 'loaded' && z.wyspy === 1 && z.q6 === 'active', JSON.stringify(z));
    ocena('stary zapis v1: surowce zachowane', z.drewno >= 120, `drewno=${z.drewno.toFixed(0)}`);
    await zrzut(p, 'stary-zapis');
    await bezBledow('stary zapis', p);
    await p.context().close();
  }

  await b.close();
  console.log(blad ? '\nWYNIK: są błędy' : '\nWYNIK: wszystko OK');
  process.exit(blad ? 1 : 0);
})();

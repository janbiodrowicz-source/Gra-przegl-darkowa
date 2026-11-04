/**
 * Boot: platform → settings & save → i18n → audio → UI → loop.
 */
import { platform } from './platform.js?v=0.3.2';
import { bus } from './core/events.js?v=0.3.2';
import { Game } from './game.js?v=0.3.2';
import { setLang, t } from './i18n.js?v=0.3.2';
import * as audio from './audio/sfx.js?v=0.3.2';
import { createUI } from './ui/ui.js?v=0.3.2';
import { createRenderer } from './render/renderer.js?v=0.3.2';
import { createInput } from './input.js?v=0.3.2';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const TEST = params.has('test');
const DEMO = params.has('demo');

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('is-hidden');
  setTimeout(() => splash.remove(), 600);
}

function showFatal(err) {
  console.error(err);
  const splash = document.getElementById('splash');
  const msg = splash?.querySelector('.splash__msg');
  if (msg) msg.textContent = t('game.fatal');
  splash?.classList.add('is-error');
}

async function boot() {
  platform.loadingStart();
  await platform.init();

  const game = new Game({ platform, bus });
  const loaded = game.load();
  setLang(game.settings.lang);
  document.documentElement.lang = game.settings.lang;
  document.title = t('game.title');

  if (DEMO) {
    // Demo island for screenshots: never written to storage.
    const { buildDemoState, buildDemoWorld } = await import('./dev/demo.js?v=0.3.2');
    const stage = params.get('demo');
    if (stage === '3') game.world = buildDemoWorld();
    else game.state = buildDemoState(undefined, stage === '2' ? 2 : 1);
    game.readOnly = true;
    game.lastReport = null;
  }

  audio.initAudio({ enabled: game.settings.sound });
  platform.onAdStart(() => audio.setMuted(true));
  platform.onAdEnd(() => audio.setMuted(false));

  const ui = createUI({ game, bus, sfx: audio.sfx, audio, platform });

  const canvas = document.getElementById('map');
  const renderer = createRenderer({ canvas, game, ui, bus });
  ui.setArtProvider((type, level, where) => renderer.thumb(type, level, where));
  ui.setWorldLocator((x, y) => renderer.tileToScreen(x, y));
  createInput({
    canvas,
    renderer,
    onTap: (sx, sy, pointerType) => {
      const tile = renderer.pick(sx, sy, { groundOnly: ui.state.mode === 'place' });
      if (tile) ui.mapTap(tile.x, tile.y, { pointerType });
    },
    onHover: (sx, sy) => {
      if (sx < 0) return renderer.setHover(null);
      if (ui.state.mode === 'place') {
        renderer.setHover(null);
        const tile = renderer.pick(sx, sy, { groundOnly: true });
        if (tile) ui.mapHover(tile.x, tile.y);
        return;
      }
      renderer.setHover(renderer.pick(sx, sy));
    },
  });

  if (DEBUG) {
    const { mountDebug } = await import('./dev/debug.js?v=0.3.2');
    mountDebug(game, { collapsed: true, renderer });
  }
  if (DEBUG || TEST) {
    window.__gra = { game, ui, renderer };   // testy w tools/testy/ czytają stąd
    window.__game = game;
    window.__ui = ui;
    window.__renderer = renderer;
  }

  game.start();
  platform.loadingStop();
  document.documentElement.classList.add('is-ready');
  hideSplash();

  // Things to tell the player once the UI exists.
  if (!DEMO) {
    if (loaded.status === 'backup') ui.toast(t('toast.loadBackup'), { kind: 'warn', icon: 'warn', ms: 5000 });
    if (loaded.status === 'corrupt') ui.toast(t('toast.loadCorrupt'), { kind: 'bad', icon: 'warn', ms: 5000 });
    if (loaded.status === 'newer') ui.toast(t('toast.loadNewer'), { kind: 'warn', icon: 'warn', ms: 6000 });
    if (!platform.storage.persistent) ui.toast(t('toast.saveFailed'), { kind: 'warn', icon: 'warn', ms: 5200 });
    if (game.lastReport) ui.showWelcome(game.lastReport);
    if (loaded.status === 'new') ui.welcome();
  }
}

boot().catch(showFatal);

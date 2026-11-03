/**
 * Boot: platform → settings & save → i18n → (UI, renderer, audio) → loop.
 */
import { platform } from './platform.js';
import { bus } from './core/events.js';
import { Game } from './game.js';
import { setLang, t } from './i18n.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const TEST = params.has('test');

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
  game.load();
  setLang(game.settings.lang);
  document.documentElement.lang = game.settings.lang;
  document.title = t('game.title');

  // Stage (a): there is no game UI yet, so the developer panel is the test page.
  const { mountDebug } = await import('./dev/debug.js');
  mountDebug(game);

  if (DEBUG || TEST) window.__game = game;

  game.start();
  platform.loadingStop();
  document.documentElement.classList.add('is-ready');
  hideSplash();
}

boot().catch(showFatal);

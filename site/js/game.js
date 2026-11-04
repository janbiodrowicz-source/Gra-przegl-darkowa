/**
 * Game controller: owns the state, runs the loop (requestAnimationFrame +
 * fixed logic step), handles pause on visibilitychange, offline progress,
 * autosave and multi-tab conflicts. It knows nothing about the DOM UI or the
 * canvas — those subscribe to the bus and register frame hooks.
 */
import { GAME } from './config.js?v=0.3.2';
import * as actions from './core/actions.js?v=0.3.2';
import * as worldActions from './core/world.js?v=0.3.2';
import { activeIsland, createWorld, simulateWorld, tickWorld, worldFromState } from './core/world.js?v=0.3.2';
import { invalidate } from './core/sim.js?v=0.3.2';
import { clearSave, loadGame, loadSettings, saveSettings, writeSave } from './save/save.js?v=0.3.2';
import { LANGUAGES } from './i18n.js?v=0.3.2';

const WORLD_ACTIONS = {
  setActive: worldActions.setActive,
  setMain: worldActions.setMain,
  startScout: worldActions.startScout,
  colonize: (world, offer) => worldActions.colonize(world, offer, Date.now()),
  dismissOffers: worldActions.dismissOffers,
};

export const randomSeed = () => ((Math.random() * 0x7fffffff) >>> 0) || 1;

export class Game {
  constructor({ platform, bus }) {
    this.platform = platform;
    this.bus = bus;
    this.world = null;          // the archipelago; `state` is the island on screen
    this.settings = null;
    this.tab = Math.random().toString(36).slice(2, 10);

    this.running = false;
    this.hidden = false;
    this.paused = false;        // hard pause (tab conflict)
    this.readOnly = false;      // save from a newer version → never overwrite it
    this.conflict = false;
    this.timeScale = 1;         // debug only

    this.raf = 0;
    this.last = 0;
    this.acc = 0;
    this.sinceSave = 0;
    this.dirty = false;
    this.hiddenAt = 0;
    this.warnedSave = false;
    this.lastReport = null;
    this.loadStatus = 'new';
    this.pending = [];          // events waiting to be emitted
    this.frameHooks = new Set();
    this.fps = 0;

    this._frame = this._frame.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._onPageHide = () => this.save();
    this._onStorage = this._onStorage.bind(this);
  }

  /** The island on screen. Assigning a single island (demo, debug) makes it a one-island world. */
  get state() {
    return this.world ? activeIsland(this.world) : null;
  }

  set state(s) {
    this.world = s ? worldFromState(s) : null;
  }

  /* ---------------- boot ---------------- */

  load() {
    const now = Date.now();
    this.settings = loadSettings(this.platform.storage, { languages: LANGUAGES, locale: this.platform.getLocale() });
    const result = loadGame(this.platform.storage, { now, newSeed: randomSeed() });
    this.world = result.world;
    // the game always opens on the main island
    this.world.active = this.world.main;
    this.loadStatus = result.status;
    this.readOnly = !!result.readOnly;
    if (result.savedAt != null) this.applyOffline((now - result.savedAt) / 1000, 'load');
    return result;
  }

  start() {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this._onVisibility);
    window.addEventListener('pagehide', this._onPageHide);
    window.addEventListener('beforeunload', this._onPageHide);
    window.addEventListener('storage', this._onStorage);
    if (document.hidden) {
      this.hidden = true;
      this.hiddenAt = Date.now();
      return;
    }
    this._resumeLoop();
  }

  onFrame(fn) {
    this.frameHooks.add(fn);
    return () => this.frameHooks.delete(fn);
  }

  /* ---------------- loop ---------------- */

  _resumeLoop() {
    this.last = performance.now();
    this.acc = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this._frame);
    this.platform.gameplayStart();
  }

  _frame(now) {
    this.raf = requestAnimationFrame(this._frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.1;

    if (!this.paused) {
      if (dt > GAME.catchUpThreshold) {
        // The browser throttled us without a visibilitychange (e.g. hidden iframe):
        // account the gap like offline time instead of losing it.
        this.applyOffline(dt, 'catchup');
      } else {
        this.acc += dt * this.timeScale;
        let steps = 0;
        while (this.acc >= GAME.step && steps < GAME.maxStepsPerFrame * this.timeScale) {
          tickWorld(this.world, GAME.step, this.pending);
          this.acc -= GAME.step;
          steps++;
        }
        if (this.acc > GAME.step * 4) this.acc = 0;
      }
      this.flush();

      this.sinceSave += dt;
      if (this.sinceSave >= GAME.autosaveEvery || (this.dirty && this.sinceSave >= GAME.saveAfterActionDelay)) {
        this.save();
      }
    }

    const fdt = Math.min(dt, GAME.maxFrameDt);
    for (const fn of this.frameHooks) {
      try {
        fn(fdt, now);
      } catch (err) {
        console.error('[game] frame hook failed', err);
      }
    }
  }

  /* ---------------- visibility & tabs ---------------- */

  _onVisibility() {
    if (document.hidden) this.pause();
    else this.resume();
  }

  /** Tab hidden: stop the loop, save, tell the portal. */
  pause() {
    if (!this.running || this.hidden) return;
    this.hidden = true;
    this.hiddenAt = Date.now();
    cancelAnimationFrame(this.raf);
    this.save();
    this.platform.gameplayStop();
    this.bus.emit('pause');
  }

  /** Tab visible again: credit the time away like offline progress. */
  resume() {
    if (!this.running || !this.hidden) return;
    this.hidden = false;
    if (!this.paused) {
      const away = (Date.now() - this.hiddenAt) / 1000;
      this.applyOffline(away, 'resume');
      this.flush();
    }
    this._resumeLoop();
    this.bus.emit('resume');
  }

  _onStorage(e) {
    if (e.key !== GAME.saveKey || !e.newValue || this.conflict) return;
    let tab = null;
    try { tab = JSON.parse(e.newValue)?.tab ?? null; } catch { tab = null; }
    if (tab && tab !== this.tab) {
      this.conflict = true;
      this.paused = true;
      this.bus.emit('conflict');
    }
  }

  /* ---------------- progress ---------------- */

  applyOffline(seconds, source) {
    if (!(seconds > 0.5) || this.paused) return null;
    const report = simulateWorld(this.world, seconds);
    this.pending.push(...report.events);
    this.dirty = true;
    if (report.seconds >= GAME.offlineReportMin) {
      this.lastReport = report;
      this.bus.emit('offline', { report, source });
    }
    return report;
  }

  /** Runs a player command from core/actions (on the island on screen) and emits its events. */
  dispatch(name, ...args) {
    const fn = actions[name];
    if (typeof fn !== 'function') throw new Error(`Unknown action "${name}"`);
    if (this.paused) return { ok: false, reason: 'disabled' };
    return this._finish(name, fn(this.state, ...args));
  }

  /** Runs an archipelago command from core/world (setActive, startScout, colonize…). */
  dispatchWorld(name, ...args) {
    const fn = WORLD_ACTIONS[name];
    if (!fn) throw new Error(`Unknown world action "${name}"`);
    if (this.paused) return { ok: false, reason: 'disabled' };
    return this._finish(name, fn(this.world, ...args));
  }

  _finish(name, result) {
    if (result.ok) {
      this.dirty = true;
      if (result.events) this.pending.push(...result.events);
      this.flush();
    } else {
      this.bus.emit('actionFailed', { action: name, reason: result.reason, result });
    }
    return result;
  }

  flush() {
    if (!this.pending.length) return;
    const events = this.pending;
    this.pending = [];
    for (const e of events) this.bus.emit(e.type, e);
  }

  /* ---------------- saving ---------------- */

  save() {
    this.sinceSave = 0;
    this.dirty = false;
    if (this.readOnly || this.conflict || !this.state) return false;
    const ok = writeSave(this.platform.storage, this.world, Date.now(), this.tab);
    if (!ok && !this.warnedSave) {
      this.warnedSave = true;
      this.bus.emit('saveFailed');
    }
    return ok;
  }

  setSetting(key, value) {
    this.settings = { ...this.settings, [key]: value };
    saveSettings(this.platform.storage, this.settings);
    this.bus.emit('settings', { key, value, settings: this.settings });
  }

  /** Wipes progress and rolls a new island (settings stay). */
  reset() {
    clearSave(this.platform.storage);
    this.world = createWorld({ seed: randomSeed(), now: Date.now() });
    this.lastReport = null;
    this.readOnly = false;
    this.save();
    this.bus.emit('reset');
  }

  /** Debug: advance time as if the player had been away. */
  skip(seconds) {
    return this.applyOffline(seconds, 'debug');
  }

  /** Debug: call after editing state by hand. */
  touch() {
    invalidate(this.state);
    this.dirty = true;
  }
}

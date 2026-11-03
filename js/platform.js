/**
 * Thin platform layer — the only place that will talk to a portal SDK
 * (CrazyGames, Poki, …). Today every hook is a safe no-op, so the game runs
 * the same on itch.io, a portal, or a local server. Nothing here performs
 * network requests.
 *
 * Dev switch: `?ads=mock` simulates a rewarded ad (1.2 s, always succeeds)
 * so the "×2" flow can be tested without any SDK.
 */

const adListeners = { start: new Set(), end: new Set() };
const memory = new Map();
let local = null;          // window.localStorage when usable
let playing = false;
let mockAds = false;

function probeLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const key = '__wysepka_probe__';
    ls.setItem(key, '1');
    ls.removeItem(key);
    return ls;
  } catch {
    return null; // private mode, sandboxed iframe, disabled cookies…
  }
}

function emitAd(kind) {
  for (const fn of adListeners[kind]) {
    try { fn(); } catch (err) { console.error('[platform] ad listener failed', err); }
  }
}

export const platform = {
  name: 'web',

  /** Called once at boot, before anything reads storage. */
  async init() {
    local = probeLocalStorage();
    try {
      mockAds = new URLSearchParams(globalThis.location?.search || '').get('ads') === 'mock';
    } catch {
      mockAds = false;
    }
  },

  /* ---- loading / gameplay lifecycle (portal analytics + ad pacing) ---- */
  loadingStart() {},
  loadingStop() {},
  gameplayStart() {
    if (playing) return;
    playing = true;
    // SDK: game.gameplayStart()
  },
  gameplayStop() {
    if (!playing) return;
    playing = false;
    // SDK: game.gameplayStop()
  },
  /** A celebratory moment (quest claimed, milestone). */
  happyTime() {
    // SDK: game.happytime()
  },

  /* ---- ads ---- */
  hasRewardedAds() {
    return mockAds;
  },
  /** Interstitial between sessions; resolves when finished (true if shown). */
  async showMidgameAd() {
    return false;
  },
  /** Rewarded ad; resolves true only if the player earned the reward. */
  async showRewardedAd() {
    if (!mockAds) return false;
    emitAd('start');
    await new Promise((r) => setTimeout(r, 1200));
    emitAd('end');
    return true;
  },
  onAdStart(fn) { adListeners.start.add(fn); return () => adListeners.start.delete(fn); },
  onAdEnd(fn) { adListeners.end.add(fn); return () => adListeners.end.delete(fn); },

  /** Preferred language from the portal (e.g. 'en-US'), or null. */
  getLocale() {
    return null;
  },

  /* ---- persistence (swap for SDK cloud data later) ---- */
  storage: {
    get persistent() {
      return !!local;
    },
    get(key) {
      try {
        if (local) return local.getItem(key);
      } catch { /* fall back to memory */ }
      return memory.has(key) ? memory.get(key) : null;
    },
    set(key, value) {
      memory.set(key, value);
      try {
        if (local) {
          local.setItem(key, value);
          return true;
        }
      } catch {
        return false; // quota exceeded / revoked access
      }
      return false;
    },
    remove(key) {
      memory.delete(key);
      try { local?.removeItem(key); } catch { /* ignore */ }
    },
  },
};

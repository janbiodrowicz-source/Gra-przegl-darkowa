/**
 * Prestige hook ("Nowa wyprawa"). Intentionally empty for now: the state already
 * reserves `meta.prestige`, `meta.prestigePoints` and `meta.prestigeCount`,
 * and the UI hides the feature while PRESTIGE.enabled is false.
 *
 * A future implementation could: compute points from lifetime production,
 * reset the island (new seed) while keeping meta, and apply a global
 * production multiplier of (1 + prestigePoints * k).
 */
import { PRESTIGE } from '../config.js?v=0.3.2';

export function isPrestigeEnabled() {
  return PRESTIGE.enabled;
}

/** Whether the player may start a new expedition right now. */
export function canPrestige(_state) {
  return false;
}

/** Points the player would receive. */
export function prestigeReward(_state) {
  return 0;
}

/** Global production multiplier from prestige (1 = none). */
export function prestigeMultiplier(state) {
  return 1 + 0 * (state?.meta?.prestigePoints ?? 0);
}

/** Performs the reset. Not implemented yet. */
export function applyPrestige(_state) {
  return { ok: false, reason: 'disabled', events: [] };
}

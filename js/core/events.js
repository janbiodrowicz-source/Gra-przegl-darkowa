/**
 * Minimal event bus. Core functions return plain event objects
 * ({ type, ... }); the game controller emits them here and UI, renderer
 * and audio subscribe. No DOM, safe to import in Node.
 */
export function createBus() {
  const listeners = new Map();

  function on(type, fn) {
    let set = listeners.get(type);
    if (!set) listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => off(type, fn);
  }

  function off(type, fn) {
    listeners.get(type)?.delete(fn);
  }

  function emit(type, payload) {
    const exact = listeners.get(type);
    if (exact) for (const fn of [...exact]) safeCall(fn, payload, type);
    const any = listeners.get('*');
    if (any) for (const fn of [...any]) safeCall(fn, payload, type);
  }

  function clear() {
    listeners.clear();
  }

  return { on, off, emit, clear };
}

function safeCall(fn, payload, type) {
  try {
    fn(payload, type);
  } catch (err) {
    // One faulty listener must never break the game loop.
    console.error(`[bus] listener for "${type}" failed`, err);
  }
}

/** Shared application bus. */
export const bus = createBus();

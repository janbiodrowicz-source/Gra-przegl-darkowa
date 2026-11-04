/**
 * Map input: one Pointer Events pipeline for mouse, touch and pen.
 *  - tap (short, no movement)  → onTap(sx, sy, pointerType)
 *  - drag                      → pan (with inertia on release)
 *  - two fingers               → pinch zoom + pan
 *  - mouse wheel               → zoom around the cursor
 *  - mouse hover               → onHover(sx, sy)
 *  - arrow keys / +/-          → pan / zoom (desktop)
 */
export function createInput({ canvas, renderer, onTap, onHover }) {
  const pointers = new Map();
  let mode = 'idle'; // idle | tap | pan | pinch
  let pinch = null;
  let tapStart = null;
  const samples = []; // recent pan deltas for fling velocity

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const slop = (type) => (type === 'mouse' ? 5 : 10);

  function startPinch() {
    const [a, b] = [...pointers.values()];
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
    };
    mode = 'pinch';
    renderer.stopFling();
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = local(e);
    pointers.set(e.pointerId, { x, y, sx: x, sy: y, type: e.pointerType });
    renderer.stopFling();
    if (pointers.size === 1) {
      mode = 'tap';
      tapStart = { x, y, t: performance.now(), type: e.pointerType };
      samples.length = 0;
    } else if (pointers.size === 2) {
      startPinch();
    }
  }

  function onMove(e) {
    const [x, y] = local(e);
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && e.buttons === 0) onHover?.(x, y);
      return;
    }
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;

    if (mode === 'tap' && Math.hypot(x - p.sx, y - p.sy) > slop(p.type)) {
      mode = 'pan';
      canvas.classList.add('is-dragging');
    }
    if (mode === 'pan' && pointers.size === 1) {
      renderer.panBy(dx, dy);
      samples.push({ dx, dy, t: performance.now() });
      if (samples.length > 6) samples.shift();
    } else if (mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      renderer.zoomAt(mx, my, dist / pinch.dist);
      renderer.panBy(mx - pinch.mx, my - pinch.my);
      pinch = { dist, mx, my };
    }
  }

  function onUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    canvas.releasePointerCapture?.(e.pointerId);

    if (mode === 'tap' && tapStart && performance.now() - tapStart.t < 650 && e.type !== 'pointercancel') {
      onTap?.(p.x, p.y, p.type);
    } else if (mode === 'pan' && pointers.size === 0) {
      const now = performance.now();
      const recent = samples.filter((s) => now - s.t < 90);
      if (recent.length) {
        const span = Math.max(16, now - recent[0].t);
        const vx = recent.reduce((a, s) => a + s.dx, 0) / (span / 1000);
        const vy = recent.reduce((a, s) => a + s.dy, 0) / (span / 1000);
        if (Math.hypot(vx, vy) > 120) renderer.fling(vx, vy);
      }
    }

    if (pointers.size === 0) {
      mode = 'idle';
      tapStart = null;
      canvas.classList.remove('is-dragging');
    } else if (pointers.size === 1) {
      // lifting one finger of a pinch continues as a pan with the other one
      const [rest] = pointers.values();
      rest.sx = rest.x;
      rest.sy = rest.y;
      mode = 'pan';
      samples.length = 0;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const [x, y] = local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    renderer.zoomAt(x, y, Math.exp(-delta * 0.0016));
  }

  function onKey(e) {
    if (e.target?.closest?.('button, input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = 60;
    switch (e.key) {
      case 'ArrowLeft': renderer.panBy(step, 0); break;
      case 'ArrowRight': renderer.panBy(-step, 0); break;
      case 'ArrowUp': renderer.panBy(0, step); break;
      case 'ArrowDown': renderer.panBy(0, -step); break;
      case '+': case '=': renderer.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.15); break;
      case '-': case '_': renderer.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.15); break;
      default: break;
    }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pointers.size) onHover?.(-1, -1); });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKey);
  // iOS Safari: block the native pinch-zoom gesture on the page.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  return {
    get mode() { return mode; },
  };
}

/**
 * Particles and floating texts. Pooled objects, soft pre-rendered sprites,
 * no allocations in the hot path. World-space particles are drawn with the
 * camera transform; floating texts are drawn in screen space (constant size).
 */

const TAU = Math.PI * 2;
const MAX_PARTS = 260;
const MAX_TEXTS = 40;

function softSprite(color, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.55, color.replace(/[\d.]+\)$/, '0.55)'));
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export function createFx() {
  const sprites = {
    smoke: softSprite('rgba(255, 255, 255, 1)'),
    dust: softSprite('rgba(214, 186, 140, 1)'),
    glow: softSprite('rgba(255, 236, 160, 1)'),
  };
  const parts = Array.from({ length: MAX_PARTS }, () => ({ alive: false }));
  const texts = Array.from({ length: MAX_TEXTS }, () => ({ alive: false }));
  let cursor = 0;
  let tcursor = 0;
  const icons = new Map(); // name → HTMLImageElement (decoded SVG)

  function take() {
    for (let i = 0; i < MAX_PARTS; i++) {
      const p = parts[(cursor + i) % MAX_PARTS];
      if (!p.alive) {
        cursor = (cursor + i + 1) % MAX_PARTS;
        return p;
      }
    }
    const p = parts[cursor]; // pool full: recycle the oldest slot
    cursor = (cursor + 1) % MAX_PARTS;
    return p;
  }

  /**
   * kinds: smoke | dust | spark | leaf | chip | ring
   * Coordinates in world px.
   */
  function spawn(kind, x, y, o = {}) {
    const p = take();
    p.alive = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.ax = o.ax ?? 0;
    p.ay = o.ay ?? 0;
    p.r = o.r ?? 4;
    p.grow = o.grow ?? 0;
    p.life = 0;
    p.max = o.life ?? 1;
    p.alpha = o.alpha ?? 1;
    p.color = o.color ?? '#fff';
    p.spin = o.spin ?? 0;
    p.rot = o.rot ?? Math.random() * TAU;
    p.drag = o.drag ?? 0;
    return p;
  }

  function burst(kind, x, y, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = (o.angle ?? 0) + (o.spread ?? TAU) * (i / n + Math.random() * 0.2) - (o.spread ?? TAU) / 2;
      const sp = (o.speed ?? 30) * (0.6 + Math.random() * 0.7);
      spawn(kind, x + (Math.random() - 0.5) * (o.jitter ?? 6), y + (Math.random() - 0.5) * (o.jitter ?? 6) * 0.5, {
        ...o,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * (o.flat ?? 0.5) + (o.vy ?? 0),
        r: (o.r ?? 4) * (0.7 + Math.random() * 0.6),
        life: (o.life ?? 0.8) * (0.75 + Math.random() * 0.5),
      });
    }
  }

  /** Floating label ("+12" with an icon) anchored to a world point. */
  function text(x, y, label, o = {}) {
    let tx = null;
    for (let i = 0; i < MAX_TEXTS; i++) {
      const c = texts[(tcursor + i) % MAX_TEXTS];
      if (!c.alive) { tx = c; tcursor = (tcursor + i + 1) % MAX_TEXTS; break; }
    }
    if (!tx) { tx = texts[tcursor]; tcursor = (tcursor + 1) % MAX_TEXTS; }
    tx.alive = true;
    tx.x = x;
    tx.y = y;
    tx.label = label;
    tx.icon = o.icon ?? null;
    tx.color = o.color ?? '#ffffff';
    tx.life = 0;
    tx.max = o.life ?? 1.5;
    tx.rise = o.rise ?? 34;
    tx.size = o.size ?? 15;
    tx.delay = o.delay ?? 0;
  }

  /** Registers an <img> (decoded) to draw next to floating texts. */
  function setIcon(name, img) {
    icons.set(name, img);
  }

  function update(dt) {
    for (const p of parts) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) { p.alive = false; continue; }
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.grow * dt;
      p.rot += p.spin * dt;
    }
    for (const t of texts) {
      if (!t.alive) continue;
      t.life += dt;
      if (t.life >= t.max + t.delay) t.alive = false;
    }
  }

  /** Draws world-space particles (camera transform already set). */
  function drawWorld(g) {
    for (const p of parts) {
      if (!p.alive) continue;
      const f = p.life / p.max;
      switch (p.kind) {
        case 'smoke':
        case 'dust': {
          const a = p.alpha * (f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85);
          if (a <= 0.01) break;
          g.globalAlpha = a;
          const s = p.r * 2;
          g.drawImage(p.kind === 'smoke' ? sprites.smoke : sprites.dust, p.x - p.r, p.y - p.r, s, s);
          break;
        }
        case 'spark': {
          const a = p.alpha * (1 - f);
          g.globalAlpha = a;
          g.fillStyle = p.color;
          const r = p.r * (1 - f * 0.5);
          g.beginPath();
          for (let i = 0; i < 8; i++) {
            const ang = p.rot + (i * TAU) / 8;
            const rr = i % 2 ? r * 0.38 : r;
            g.lineTo(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr);
          }
          g.closePath();
          g.fill();
          break;
        }
        case 'leaf':
        case 'chip': {
          g.globalAlpha = p.alpha * (f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3);
          g.fillStyle = p.color;
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          if (p.kind === 'leaf') {
            g.beginPath();
            g.ellipse(0, 0, p.r, p.r * 0.5, 0, 0, TAU);
            g.fill();
          } else {
            g.fillRect(-p.r * 0.6, -p.r * 0.6, p.r * 1.2, p.r * 1.2);
          }
          g.restore();
          break;
        }
        case 'ring': {
          const a = p.alpha * (1 - f);
          g.globalAlpha = a;
          g.strokeStyle = p.color;
          g.lineWidth = 2.5 * (1 - f) + 0.5;
          g.beginPath();
          g.ellipse(p.x, p.y, p.r + f * p.grow, (p.r + f * p.grow) * 0.5, 0, 0, TAU);
          g.stroke();
          break;
        }
        default:
          break;
      }
    }
    g.globalAlpha = 1;
  }

  /** Draws floating texts in screen space. `toScreen(x, y)` maps world → CSS px. */
  function drawScreen(g, toScreen) {
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    for (const t of texts) {
      if (!t.alive || t.life < t.delay) continue;
      const f = (t.life - t.delay) / t.max;
      const [sx, sy] = toScreen(t.x, t.y);
      const ease = 1 - (1 - f) * (1 - f);
      const y = sy - ease * t.rise;
      const a = f < 0.12 ? f / 0.12 : f > 0.7 ? 1 - (f - 0.7) / 0.3 : 1;
      const pop = f < 0.12 ? 0.6 + (f / 0.12) * 0.5 : f < 0.22 ? 1.1 - ((f - 0.12) / 0.1) * 0.1 : 1;
      const size = t.size * pop;
      g.globalAlpha = Math.max(0, a);
      g.font = `900 ${size}px ui-rounded, "SF Pro Rounded", Nunito, Inter, system-ui, sans-serif`;
      const img = t.icon ? icons.get(t.icon) : null;
      const iw = img ? size * 1.1 : 0;
      const tw = g.measureText(t.label).width;
      const total = iw + (img ? 2 : 0) + tw;
      let x = sx - total / 2;
      if (img) {
        g.drawImage(img, x, y - iw / 2, iw, iw);
        x += iw + 2;
      }
      g.lineWidth = Math.max(2.5, size * 0.22);
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(40, 26, 16, 0.85)';
      g.strokeText(t.label, x, y);
      g.fillStyle = t.color;
      g.fillText(t.label, x, y);
    }
    g.globalAlpha = 1;
  }

  function clear() {
    for (const p of parts) p.alive = false;
    for (const t of texts) t.alive = false;
  }

  function activeCount() {
    let n = 0;
    for (const p of parts) if (p.alive) n++;
    return n;
  }

  return { spawn, burst, text, setIcon, update, drawWorld, drawScreen, clear, activeCount, sprites };
}

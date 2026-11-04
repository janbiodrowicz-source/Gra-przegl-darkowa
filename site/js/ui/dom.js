/** Tiny DOM helpers (no framework). */

/**
 * h('button.btn.btn--primary', { onclick, 'aria-label': 'x' }, 'text', child)
 * Tag may carry classes after dots. Props: on* → listeners, class/className,
 * dataset (object), style (object), html (innerHTML from trusted strings), others → attributes.
 */
export function h(tagSpec, props = null, ...children) {
  const [tag, ...classes] = tagSpec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'class' || key === 'className') {
        el.className = [el.className, value].filter(Boolean).join(' ');
      } else if (key === 'dataset') {
        Object.assign(el.dataset, value);
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key === 'html') {
        el.innerHTML = value;
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Sets textContent only when it changed (avoids needless layout). */
export function setText(el, text) {
  const s = String(text);
  if (el.__text !== s) {
    el.__text = s;
    el.textContent = s;
  }
}

/** Toggles a class only when needed. */
export function setClass(el, name, on) {
  if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on);
}

/** Sets an attribute only when it changed. */
export function setAttr(el, name, value) {
  const v = value == null ? null : String(value);
  if (el.getAttribute(name) !== v) {
    if (v == null) el.removeAttribute(name);
    else el.setAttribute(name, v);
  }
}

/** Sets a CSS custom property only when it changed. */
export function setVar(el, name, value) {
  const v = String(value);
  el.__vars ||= {};
  if (el.__vars[name] !== v) {
    el.__vars[name] = v;
    el.style.setProperty(name, v);
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Restarts a CSS animation class (e.g. a "bump"). */
export function retrigger(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // reflow so the animation can restart
  el.classList.add(cls);
}

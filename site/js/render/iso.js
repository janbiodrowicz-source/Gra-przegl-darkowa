/**
 * Isometric (2:1 dimetric) projection.
 * Grid coords (gx, gy) are continuous: tile (x, y) spans [x, x+1] × [y, y+1].
 * World coords are pixels at zoom 1; z (height) goes up the screen.
 */
import { clearedTileCode, tileAt } from '../core/map.js?v=0.3.2';

export const TILE_W = 64;
export const TILE_H = 32;
export const HW = TILE_W / 2;
export const HH = TILE_H / 2;

export const CLIFF = 14;   // sand/grass above the sea
export const LIP = 3;      // grass above sand

export const toWX = (gx, gy) => (gx - gy) * HW;
export const toWY = (gx, gy, z = 0) => (gx + gy) * HH - z;

/** World point → continuous grid coords (at height z). */
export function toGrid(wx, wy, z = 0) {
  const a = wx / HW;
  const b = (wy + z) / HH;
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
}

/** World coords of a tile's centre at ground level (z = 0). */
export function tileCenter(x, y) {
  return { x: (x - y) * HW, y: (x + y + 1) * HH };
}

/** Ground code ignoring trees/rocks (what the tile would be once cleared). */
export function groundCode(tiles, x, y) {
  const c = tileAt(tiles, x, y);
  return c === 't' || c === 'r' ? clearedTileCode(tiles, x, y) : c;
}

/** Height of the ground surface of a tile. */
export function groundZ(tiles, x, y) {
  const c = groundCode(tiles, x, y);
  if (c === 'w') return -CLIFF;
  return c === 'g' ? LIP : 0;
}

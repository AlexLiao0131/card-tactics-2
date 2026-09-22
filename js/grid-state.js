export const GRID_WIDTH = 8;
export const GRID_HEIGHT = 6;

const key = (x, y) => `${x},${y}`;

export class GridState {
  constructor({ width = GRID_WIDTH, height = GRID_HEIGHT, tiles = [] } = {}) {
    this.width = width;
    this.height = height;
    this.tiles = tiles;
    this._index = new Map(tiles.map(tile => [key(tile.x, tile.y), tile]));
  }

  tileAt(x, y) {
    return this._index.get(key(x, y)) ?? null;
  }

  has(x, y) {
    return this._index.has(key(x, y));
  }

  neighbors(x, y) {
    return [[1,0],[-1,0],[0,1],[0,-1]]
      .map(([dx,dy]) => this.tileAt(x + dx, y + dy))
      .filter(Boolean);
  }
}

export const TILE_SIZE = 2;
export const ELEVATION_HEIGHT = 0.8;

export function tileCenterWorld(tile) {
  return new BABYLON.Vector3(
    tile.x * TILE_SIZE,
    Number(tile.elevation || 0) * ELEVATION_HEIGHT,
    tile.y * TILE_SIZE
  );
}

export function unitWorldPosition(unit, tile) {
  const base = tileCenterWorld(tile);
  return new BABYLON.Vector3(base.x, base.y + 0.9, base.z);
}

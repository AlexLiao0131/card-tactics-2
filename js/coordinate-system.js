export const TILE_SIZE=2;
export const ELEVATION_HEIGHT=.8;
export const UNIT_VISUAL_HEIGHT=1.6;
export function groundWorldY(tile){return Number(tile?.elevation||0)*ELEVATION_HEIGHT}
export function tileCenterWorld(tile){return new BABYLON.Vector3(tile.x*TILE_SIZE,groundWorldY(tile),tile.y*TILE_SIZE)}

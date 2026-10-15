export const TILE_SIZE=2;
export const ELEVATION_HEIGHT=.8;
export const UNIT_VISUAL_HEIGHT=1.6;
export function groundWorldY(tile){return Number(tile?.elevation||0)*ELEVATION_HEIGHT}
export function tileCenterWorld(tile){return new BABYLON.Vector3(tile.x*TILE_SIZE,groundWorldY(tile),tile.y*TILE_SIZE)}

// Transparency is composed once across the existing visual renderers.
// Native Babylon alphaIndex ordering: water -> environmental illumination ->
// optical obstruction -> source glows -> tactical information.
export const SURFACE_RENDER_ORDER=Object.freeze({
  STORED_WATER:10,RUNOFF:11,CASCADE:12,FOAM:13,
  RADIANCE:15,OPTICAL_HAZE:17,SOURCE_GLOW:18,TACTICAL_OVERLAY:20
});

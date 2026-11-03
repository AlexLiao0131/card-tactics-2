/**
 * Server-owned battlefield from the exact single-player procedural generator.
 * No copied terrain, Core, capture-point or map-size rules live here.
 * This is an authoritative immutable *initial* map, NOT a running tactical
 * simulation. Effects / moves must only be enabled when their canonical
 * server-side reducer is connected.
 */
import { StageDatabase } from '../../js/stage-database.js';
// The original generator uses the original global terrain registry.
import '../../js/terrain-database.js';
import { MapGenerator } from '../../js/map-generator.js';
import { PvpCommandError } from '../../shared/pvp-command-contract.mjs';

export const PVP_BATTLEFIELD_SCHEMA = 'ct2-pvp-battlefield-v1';
export const PVP_STAGE_ID = 'versus_core_battle';

const isPoint = p => p && Number.isInteger(p.x) && Number.isInteger(p.y);

/**
 * `seed` comes from the server's cryptographic RNG at room start and is never
 * selected or submitted by a player. MapGenerator does all actual world work.
 * MapGenerator is imported from the original js/ so no rules are duplicated.
 */
export function createOfficialBattlefield({ serverSeed, mapSize } = {}) {
  if (!Number.isSafeInteger(serverSeed) || serverSeed < 0 || serverSeed > 0xffffffff) {
    throw new PvpCommandError('SERVER_SEED_REQUIRED');
  }
  const stage = StageDatabase.get(PVP_STAGE_ID);
  if (stage?.mode !== 'VERSUS' || stage?.ruleset !== 'CORE_CAPTURE' ||
      stage?.battlefield?.type !== 'PROCEDURAL') {
    throw new PvpCommandError('OFFICIAL_STAGE_UNAVAILABLE');
  }
  const selectedSize = mapSize ?? stage.battlefield.defaultSize;
  if (typeof selectedSize !== 'string' || !Object.hasOwn(MapGenerator.SIZE_PRESETS,selectedSize)) {
    throw new PvpCommandError('INVALID_MAP_SIZE');
  }
  const generated = MapGenerator.generateVersus({
    size:selectedSize, seed:serverSeed, coreRules:stage.coreRules
  });
  const { map, cores, deploymentPoints, meta }=generated??{};
  const expected=MapGenerator.SIZE_PRESETS[selectedSize];
  if (!map || !Array.isArray(map.tiles) || !Array.isArray(map.objects) ||
      map.width !== expected.width || map.height !== expected.height ||
      map.tiles.length !== expected.width*expected.height ||
      !Array.isArray(cores) || cores.length !== 2 ||
      !Array.isArray(deploymentPoints) ||
      !cores.every(c=>isPoint(c) && Number.isFinite(c.hp) && c.hp>0) ||
      new Set(cores.map(c=>c.owner)).size !== 2 ||
      !cores.some(c=>c.owner==='PLAYER') || !cores.some(c=>c.owner==='ENEMY') ||
      !deploymentPoints.some(p=>p.owner==='PLAYER') ||
      !deploymentPoints.some(p=>p.owner==='ENEMY') ||
      !meta || meta.validation !== 'PASS') {
    throw new PvpCommandError('CANONICAL_MAP_GENERATION_FAILED');
  }
  // The returned map and Core stats are the generator's own output, not
  // recreated from an independent PVP ruleset. Persist it in the Durable Object.
  return {schema:PVP_BATTLEFIELD_SCHEMA,stageId:PVP_STAGE_ID,
    map,cores,deploymentPoints,meta};
}

/**
 * Public terrain is shared by both players at the same authority revision.
 * There are no player positions or secret hands in this initial state.
 * All fields are canonical generator output: do not infer tiles client-side.
 */
export function projectOfficialBattlefield(battlefield) {
  if (battlefield?.schema !== PVP_BATTLEFIELD_SCHEMA) {
    throw new PvpCommandError('BATTLEFIELD_NOT_READY');
  }
  return {schema:battlefield.schema,stageId:battlefield.stageId,
    map:battlefield.map,cores:battlefield.cores,
    deploymentPoints:battlefield.deploymentPoints,meta:battlefield.meta};
}

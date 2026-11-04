/**
 * Official browser + Worker battle initialization. NO parallel environment rules.
 * Server seed and submitted decks come from the Durable Object, never from peers.
 * All gameplay state is built by the same js/BattleSetupEngine used by single-player.
 */
import '../../js/terrain-database.js';
import '../../js/environment-object-engine.js';
import '../../js/map-database.js';
import '../../js/hydrology-engine.js';
import '../../js/mass-flow-engine.js';
import '../../js/climate-engine.js';
import '../../js/environment-resolver.js';
import '../../js/map-generator.js';
import '../../js/conductivity-engine.js';
import '../../js/environment-engine.js';
import '../../js/stage-database.js';
import '../../js/skill-database.js';
import '../../js/equipment-database.js';
import '../../js/companion-database.js';
import '../../js/character-database.js';
import '../../js/card-database.js';
import '../../js/loadout-database.js';
import '../../js/pack-database.js';
import '../../js/deck-engine.js';
import '../../js/deployment-engine.js';
import '../../js/card-phase-engine.js';
import '../../js/battle-engine.js';
import '../../js/effect-engine.js';
import '../../js/burial-engine.js';
import '../../js/tactical-engine.js';
import '../../js/vertical-mobility-engine.js';
import '../../js/unit-runtime-engine.js';
import '../../js/stage-engine.js';
import { BattleSetupEngine } from '../../js/battle-setup-engine.js';
import { StageDatabase } from '../../js/stage-database.js';
import { PvpCommandError } from '../../shared/pvp-command-contract.mjs';
import { PVP_BATTLEFIELD_SCHEMA, PVP_STAGE_ID } from './pvp-battlefield.mjs';

// LCG is used only to supply the pre-existing DeckEngine.shuffle random callback;
// nothing about cards, combat values, map geometry or climate is reimplemented.
const nextRandom = state => () => {
  state.value=(Math.imul(state.value,1664525)+1013904223)>>>0;
  return state.value/4294967296;
};

export function initializeCanonicalWorld({seed,mapSize,decks}) {
  if(!Number.isSafeInteger(seed) || seed<0 || seed>0xffffffff)
    throw new PvpCommandError('SERVER_SEED_REQUIRED');
  const sizes=globalThis.MapGenerator.SIZE_PRESETS;
  if(!Object.hasOwn(sizes,mapSize))throw new PvpCommandError('INVALID_MAP_SIZE');
  if(!Array.isArray(decks)||decks.length!==2||!decks.every(Array.isArray))
    throw new PvpCommandError('TWO_VALID_DECKS_REQUIRED');
  // Stage source of truth validates stage type and existing Core rules.
  const stage=StageDatabase.get(PVP_STAGE_ID);
  if(stage?.mode!=='VERSUS'||stage.ruleset!=='CORE_CAPTURE')
    throw new PvpCommandError('OFFICIAL_STAGE_UNAVAILABLE');
  // Random callback is scoped to this invocation, no Math.random override.
  const rng={value:seed>>>0};
  const setup=BattleSetupEngine.create({stageId:PVP_STAGE_ID,
    battleSetup:{seed,mapSize,deck:decks[0],enemyDeck:decks[1]},
    TEAM:{PLAYER:'P',ENEMY:'E'},random:nextRandom(rng)});
  if(setup?.stage?.generatedBattlefield?.validation!=='PASS' ||
      setup?.map?.tiles?.length!==sizes[mapSize].width*sizes[mapSize].height ||
      setup?.cores?.length!==2 || !Array.isArray(setup.stage.deploymentPoints) ||
      !setup.environmentState || !setup.cardState || !setup.enemyCardState) {
    throw new PvpCommandError('CANONICAL_BATTLE_SETUP_FAILED');
  }
  // Persistent initial World state, including the existing Hydrology and Climate state.
  // We do not save the RNG state after setup because the opening GameCore owns
  // the continuing random-state stream separately.
  const {stage:fullStage,map,cores,stageState,environmentState}=setup;
  const battlefield={schema:PVP_BATTLEFIELD_SCHEMA,stageId:PVP_STAGE_ID,
    map,cores,deploymentPoints:fullStage.deploymentPoints,
    meta:fullStage.generatedBattlefield};
  const world={battlefield,stage:fullStage,stageState,environmentState,
    units:setup.units||[]};
  structuredClone(world); // No nonserializable values may enter the Durable Object.
  return world;
}

/**
 * Bridge existing BattleEnvironmentController, not a copied climate/water engine.
 * A full room command must provide the official gameplay event and death hooks.
 * No silent no-op callbacks are allowed when live units could take damage.
 */
import '../../js/environment-contact-engine.js';
import '../../js/displacement-engine.js';
import '../../js/collision-engine.js';
import '../../js/fall-engine.js';
import '../../js/trajectory-engine.js';
import '../../js/post-engagement-engine.js';
import '../../js/battle-environment-controller.js';
import { StageDatabase } from '../../js/stage-database.js';
import { PvpCommandError } from '../../shared/pvp-command-contract.mjs';
import { PVP_STAGE_ID } from './pvp-battlefield.mjs';

export function createCanonicalEnvironmentController(world,callbacks) {
  if(!world?.battlefield?.map || !world.environmentState || !Array.isArray(world.units))
    throw new PvpCommandError('WORLD_NOT_INITIALIZED');
  for(const key of ['damageUnitFlat','handleDefeated','stageEvent','pushLog']) {
    if(typeof callbacks?.[key]!=='function')
      throw new PvpCommandError('CANONICAL_ENVIRONMENT_HOOK_REQUIRED');
  }
  const stage=StageDatabase.get(PVP_STAGE_ID);
  stage.deploymentPoints=world.battlefield.deploymentPoints;
  stage.cores=world.battlefield.cores;
  return globalThis.BattleEnvironmentController.create({
    TEAM:{PLAYER:'P',ENEMY:'E'},
    state:()=>({map:world.battlefield.map,environmentState:world.environmentState,
      units:world.units,stage,stageState:world.stageState,round:world.round}),
    ...callbacks
  });
}

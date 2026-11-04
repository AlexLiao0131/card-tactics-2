/**
 * Experimental, server-side canonical unit deployment adapter.
 *
 * No tactical transitions are enabled by this module. The production Worker
 * must NOT accept deployment until the entire move/engagement/environment
 * reducer is available, tested, and wired into a per-room GameCore.
 *
 * The owner of rules stays in js/; the only responsibility here is to hand
 * authoritative map, zones and seat identity into those rules.
 */
import '../../js/terrain-database.js';
import '../../js/skill-database.js';
import '../../js/equipment-database.js';
import '../../js/character-database.js';
import '../../js/companion-database.js';
import '../../js/card-database.js';
import '../../js/loadout-database.js';
import '../../js/effect-engine.js';
import '../../js/tactical-engine.js';
import { createUnitRuntimeEngine } from '../../js/unit-runtime-engine.js';
import { DeploymentEngine } from '../../js/deployment-engine.js';
import { CardDatabase } from '../../js/card-database.js';
import { createCardPhaseEngine } from '../../js/card-phase-engine.js';
import { createDeckEngine } from '../../js/deck-engine.js';
import { PvpCommandError } from '../../shared/pvp-command-contract.mjs';

const CARD_PHASE = ['PLAYER_CARD_PHASE','ENEMY_CARD_PHASE'];
const OWNER = ['PLAYER','ENEMY'];
const TEAM = ['P','E'];
const inputKeys = fields => Object.keys(fields||{}).sort().join('|');

export function projectDeployedUnits(units,seat) {
  if(seat!==0 && seat!==1) throw new PvpCommandError('BAD_SEAT');
  return (units||[]).map(unit=>({
    id:unit.id,team:unit.team,characterId:unit.character?.id,
    cardId:unit.cardId,x:unit.x,y:unit.y,z:unit.z,
    hp:unit.hp,mana:unit.mana,alive:unit.alive,facing:unit.facing,
    moved:unit.moved,acted:unit.acted,waited:unit.waited
  }));
}

export function deployCanonicalCard(game, action, seat) {
  if(seat!==0 && seat!==1) throw new PvpCommandError('BAD_SEAT');
  if(!game?.battlefield?.map || !Array.isArray(game.units) ||
     !Array.isArray(game.cards) || !Number.isSafeInteger(game.nextUnitSerial)) {
    throw new PvpCommandError('BATTLEFIELD_NOT_READY');
  }
  if(game.phase!==CARD_PHASE[seat] || game.activeSeat!==seat)
    throw new PvpCommandError('NOT_YOUR_TURN');
  if(!action || inputKeys(action)!=='cardId|type|x|y' || action.type!=='DEPLOY_CARD' ||
     typeof action.cardId!=='string' || !Number.isSafeInteger(action.x) ||
     !Number.isSafeInteger(action.y)) throw new PvpCommandError('INVALID_DEPLOY_COMMAND');
  const card=CardDatabase.get(action.cardId);
  if(!CardDatabase.isCharacter(card))throw new PvpCommandError('INVALID_DEPLOY_CARD');
  const deckEngine=createDeckEngine({cardDatabase:CardDatabase});
  const cardPhase=createCardPhaseEngine({deckEngine,cardDatabase:CardDatabase});
  const cardState=game.cards[seat];
  if(!cardPhase.canPlay(cardState,card))throw new PvpCommandError('CARD_NOT_PLAYABLE');
  const legal=DeploymentEngine.canDeploy({
    stage:{deploymentPoints:game.battlefield.deploymentPoints},
    map:game.battlefield.map,units:game.units,
    owner:OWNER[seat],x:action.x,y:action.y
  });
  if(!legal)throw new PvpCommandError('ILLEGAL_DEPLOY_TILE');

  // Use the identical canonical UnitRuntimeEngine as single-player. No new
  // combat-stat formulas, base HP/MP, status or extra-resource rules here.
  const unitId=`pvp-${game.battlefield.meta.seed}-${game.nextUnitSerial}`;
  const unitRuntime=createUnitRuntimeEngine(); // Each authority operation has its own roster registry.
  const created=unitRuntime.createFromCard({
    id:unitId,team:TEAM[seat],card,x:action.x,y:action.y,
    map:game.battlefield.map,cores:game.battlefield.cores
  });
  if(!created)throw new PvpCommandError('CANONICAL_DEPLOY_FAILED');
  // Actual single-player deployment rule: newly deployed units may not move
  // or act until their next beginPlayerTurn reset.
  created.cardId=card.id;
  created.deployedRound=game.round;
  created.moved=true;
  created.acted=true;
  created.waited=true;
  if(!cardPhase.commit(cardState,card))throw new PvpCommandError('CARD_COMMIT_FAILED');
  // RuntimeEngine owns live state and keeps a map reference. The Durable
  // Object must store only the per-room structural state, not a map copy per
  // unit. Reattach non-serializable view references during simulation later.
  const {_runtimeMap, ...persisted}=created;
  game.units.push(persisted);
  game.nextUnitSerial++;
  return {accepted:true,state:game,unitId};
}

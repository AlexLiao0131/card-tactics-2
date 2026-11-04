/**
 * PvP targetable card adapter for synchronous canonical CardPhaseController
 * effects. No alternative AoE, healing, buff, hydrology or crystal rules.
 * AREA_DAMAGE uses the original controller's shared, synchronous gameplay
 * reducer; browser animation remains asynchronous and presentation-only.
 */
import {CardDatabase} from '../../js/card-database.js';
import {CardPhaseEngine} from '../../js/card-phase-engine.js';
import {StageDatabase} from '../../js/stage-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import '../../js/card-phase-controller.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';
import {createCanonicalEnvironmentController} from './pvp-environment-controller.mjs';

const PHASE=['PLAYER_CARD_PHASE','ENEMY_CARD_PHASE'];
const fail=code=>{throw new PvpCommandError(code)};
const exact=(obj,fields)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===fields.slice().sort().join('|');
export function isCanonicalSynchronousTargetCard(card){
  return globalThis.CardPhaseController.commandKind(card)==='TARGETED';
}

export function playCanonicalTargetedCard(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_CARD_PHASE');
  if(!exact(action,['type','cardId','x','y'])||action.type!=='PLAY_TARGET_CARD'||
     typeof action.cardId!=='string'||!Number.isSafeInteger(action.x)||!Number.isSafeInteger(action.y))
    fail('INVALID_TARGET_CARD_COMMAND');
  const card=CardDatabase.get(action.cardId);
  if(!isCanonicalSynchronousTargetCard(card))fail('FULL_CARD_ORCHESTRATION_REQUIRED');
  const cards=game.cards[seat];
  if(!CardPhaseEngine.canPlay(cards,card))fail('CARD_NOT_PLAYABLE');
  const map=game.battlefield.map,stage=StageDatabase.get(game.stageId);
  stage.cores=game.battlefield.cores;
  stage.deploymentPoints=game.battlefield.deploymentPoints;
  const environment=createCanonicalEnvironmentController(game,hooks);
  if(typeof globalThis.CardPhaseController?.create!=='function')fail('OFFICIAL_CARD_CONTROLLER_REQUIRED');
  const state=()=>({stage,map,units:game.units,cores:game.battlefield.cores,
    round:game.round,phase:'PVP_CARD_ACTIVE',cardState:cards,
    enemyCardState:game.cards[1-seat],environmentState:game.environmentState});
  const ctrl=globalThis.CardPhaseController.create({
    TEAM:{PLAYER:seat===0?'P':'E',ENEMY:seat===0?'E':'P'},
    PHASE:{CARD:'PVP_CARD_ACTIVE',PLAYER:'PVP_TACTICAL_ACTIVE'},
    state,getPendingCard:()=>card,setPendingCard:()=>{},random:engine.random,
    pushLog:hooks.pushLog,
    checkMatchEnd:checkMatchEnd||(()=>false),
    render:()=>{},emitState:()=>{},clearSelection:()=>{},
    logEnvironmentEvent:environment.logEnvironmentEvent,
    resolveEnvironmentEvents:environment.resolveEnvironmentEvents,
    applyEnvironmentHazardToUnit:environment.applyEnvironmentHazardToUnit,
    applyForcedMovement:environment.applyForcedMovement,
    damageUnitFlat:hooks.damageUnitFlat,
    handleDefeated:hooks.handleDefeated,
    unitAt:(x,y)=>game.units.find(u=>u.alive&&u.occupiesTile!==false&&u.x===x&&u.y===y)||null,
    aoeTiles:(center,radius)=>TacticalEngine.aoeTiles(map,center,radius),
    resolveAreaDamageSynchronously:true,
    setPhase:()=>fail('UNEXPECTED_TARGET_CARD_PHASE_TRANSITION')
  });
  if(ctrl.select(card.id)!==true)fail('OFFICIAL_TARGET_CARD_SELECT_REJECTED');
  const before=cards.crystals;
  const ok=ctrl.resolveAt(card,{x:action.x,y:action.y});
  if(ok!==true)fail('OFFICIAL_TARGET_CARD_REJECTED');
  return {accepted:true,state:game,cardId:card.id,x:action.x,y:action.y,
    crystalsBefore:before,crystalsAfter:cards.crystals};
}

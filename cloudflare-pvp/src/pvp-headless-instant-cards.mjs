/**
 * PvP-authoritative instant card command (WEATHER / STEAL_HAND). Uses CardPhaseController.select,
 * not duplicated Cloudflare-specific weather / hydrology or crystal formulas.
 * Targeted/AoE/other spells require their own verified orchestration.
 */
import {CardDatabase} from '../../js/card-database.js';
import {CardPhaseEngine} from '../../js/card-phase-engine.js';
import {StageDatabase} from '../../js/stage-database.js';
import '../../js/card-phase-controller.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';
import {createCanonicalEnvironmentController} from './pvp-environment-controller.mjs';

const PHASE=['PLAYER_CARD_PHASE','ENEMY_CARD_PHASE'];
const fail=code=>{throw new PvpCommandError(code)};
const sameKeys=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');

export function playCanonicalInstantCard(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_CARD_PHASE');
  if(!sameKeys(action,['type','cardId'])||action.type!=='PLAY_INSTANT_CARD'||
      typeof action.cardId!=='string'||!action.cardId)
    fail('INVALID_INSTANT_CARD_COMMAND');
  const card=CardDatabase.get(action.cardId);
  if(globalThis.CardPhaseController.commandKind(card)!=='INSTANT')
    fail('FULL_CARD_ORCHESTRATION_REQUIRED');
  const cards=game.cards[seat];
  if(!CardPhaseEngine.canPlay(cards,card))fail('CARD_NOT_PLAYABLE');
  const stage=StageDatabase.get(game.stageId);
  stage.cores=game.battlefield.cores;
  stage.deploymentPoints=game.battlefield.deploymentPoints;
  const environment=createCanonicalEnvironmentController(game,hooks);
  const originalController=globalThis.CardPhaseController?.create;
  if(typeof originalController!=='function')fail('OFFICIAL_CARD_CONTROLLER_REQUIRED');
  // The single-player controller's state adapter presents the current seat as
  // the active player. WEATHER modifies the common atmosphere without a team
  // target. Automatic UI turn ending is suppressed: PvP ends phases explicitly.
  const state=()=>({stage,map:game.battlefield.map,units:game.units,
    round:game.round,phase:'PVP_CARD_ACTIVE',cardState:cards,
    enemyCardState:game.cards[1-seat],environmentState:game.environmentState});
  // PVP_CARD_ACTIVE is the original controller's CARD constant in this scoped
  // invocation; global game.phase is never overwritten or client-controlled.
  const controller=originalController({
    TEAM:{PLAYER:seat===0?'P':'E',ENEMY:seat===0?'E':'P'},
    PHASE:{CARD:'PVP_CARD_ACTIVE',PLAYER:'PVP_TACTICAL_ACTIVE'},
    state,getPendingCard:()=>card,setPendingCard:()=>{},random:engine.random,
    pushLog:hooks.pushLog,
    logEnvironmentEvent:environment.logEnvironmentEvent,
    resolveEnvironmentEvents:environment.resolveEnvironmentEvents,
    checkMatchEnd:checkMatchEnd||(()=>false),
    render:()=>{},emitState:()=>{},clearSelection:()=>{},
    setPhase:()=>fail('UNEXPECTED_WEATHER_PHASE_TRANSITION')
  });
  const before=cards.crystals;
  if(controller.select(card.id)!==true)fail('OFFICIAL_INSTANT_CARD_REJECTED');
  return {accepted:true,state:game,cardId:card.id,
    crystalsBefore:before,crystalsAfter:cards.crystals};
}

/**
 * Experimental headless turn orchestration. Calls the existing CardPhaseEngine,
 * UnitRuntimeEngine, EffectEngine, StageEngine and BattleEnvironmentController.
 * Must remain off production until all special abilities, neutral actor turns,
 * and cross-round presentation/gameplay events share the same coordinator.
 */
import {CardPhaseEngine} from '../../js/card-phase-engine.js';
import {StageDatabase} from '../../js/stage-database.js';
import {EnvironmentEngine} from '../../js/environment-engine.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';
import {createCanonicalEnvironmentController} from './pvp-environment-controller.mjs';
import {createCanonicalAreaFields} from './pvp-field-controller.mjs';
import {createCanonicalPerception} from './pvp-perception-controller.mjs';

function fail(code){throw new PvpCommandError(code);}
export function advanceCanonicalRound(game,engine,callbacks,checkMatchEnd){
  if(game.phase!=='ENEMY_TACTICAL_PHASE'||game.activeSeat!==1||game.pendingAttack)
    fail('NOT_END_OF_ROUND');
  // The original single-player turn coordinator has additional active-field,
  // hallucination and neutral actor steps. Never silently skip an active
  // feature until the same rule path is available headlessly.
  if(game.units.some(u=>u.alive&&u.team==='N'))
    fail('UNSUPPORTED_CROSS_ROUND_MECHANIC');
  CardPhaseEngine.resolveTurnEndEffects(game.cards[1],{units:game.units,team:'E'});
  // The original browser calls endHallucinationTurn(E) at the start of
  // beginPlayerTurn. Mirror HP, terrain, Core and environment never commit.
  createCanonicalPerception(game,engine).end('E');
  game.round++;
  const areaFields=createCanonicalAreaFields(game,engine,callbacks);
  areaFields.expireSmoke();
  // See tactical-game.beginPlayerTurn: reset units; environment contact; DOT;
  // ROUND_START; weather roll; next player's card phase. Do not invent game
  // values or a parallel hydrology engine.
  engine.unitRuntime.resetActions(game.units,'P');
  engine.effect.syncConditionalPassives(game.units,game.environmentState,{rearmTeam:'P'});
  const environment=createCanonicalEnvironmentController(game,callbacks);
  environment.applyEnvironmentHazards({reason:'回合開始仍處於燃燒區'});
  if(checkMatchEnd())return {accepted:true,state:game};
  for(const unit of game.units.filter(u=>u.alive))engine.effect.tick(unit,{units:game.units});
  if(checkMatchEnd())return {accepted:true,state:game};
  areaFields.tickSanctuaries('P');
  if(checkMatchEnd())return {accepted:true,state:game};
  callbacks.stageEvent({type:'ROUND_START',round:game.round,team:'PLAYER'});
  EnvironmentEngine.tick(game.environmentState);
  environment.resolveWeatherEvents();
  if(checkMatchEnd())return {accepted:true,state:game};
  const rules=StageDatabase.get(game.stageId).cardRules;
  // At this same point original beginPlayerTurn enters the player's mirror
  // before the card phase; the server RNG supplies fake-tile selection.
  createCanonicalPerception(game,engine).begin('P');
  game.activeSeat=0;
  game.phase='PLAYER_CARD_PHASE';
  CardPhaseEngine.begin(game.cards[0],{handSize:rules.handSize});
  return {accepted:true,state:game};
}

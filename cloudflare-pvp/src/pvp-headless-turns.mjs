import {beginPlayerRoundSequence} from '../../js/battle-round-sequence.js';
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
export function advanceCanonicalRound(game,engine,callbacks,checkMatchEnd,{onRoundStart=null}={}){
  if(game.phase!=='ENEMY_TACTICAL_PHASE'||game.activeSeat!==1||game.pendingAttack)
    fail('NOT_END_OF_ROUND');
  // An authorized berserk Livia is a cross-round neutral participant; its
  // original team is preserved and the shared duality state owns recovery.
  // Ordinary unknown/monster neutral actors still require their own turn
  // coordinator and must never silently pass this headless guard.
  if(game.units.some(u=>u.alive&&u.team==='N'&&
     !(u.controlOverride?.type==='BERSERK'&&
       (u.controlOverride.originalTeam==='P'||u.controlOverride.originalTeam==='E'))))
    fail('UNSUPPORTED_CROSS_ROUND_MECHANIC');
  CardPhaseEngine.resolveTurnEndEffects(game.cards[1],{units:game.units,team:'E'});
  const fields=createCanonicalAreaFields(game,engine,callbacks);
  const environment=createCanonicalEnvironmentController(game,callbacks);
  beginPlayerRoundSequence({
    endEnemyPerception:()=>createCanonicalPerception(game,engine).end('E'),
    checkMatchEnd:()=>checkMatchEnd(),
    // Recovery must run BEFORE resetActions(P) and new-round effects. A
    // freshly recovered Livia gets exactly one normal player action.
    advanceRound:()=>{game.round++;onRoundStart?.(game.round);},
    expireSmoke:()=>fields.expireSmoke(),
    resetActions:()=>{
      engine.unitRuntime.resetActions(game.units,'P');
      engine.effect.syncConditionalPassives(game.units,game.environmentState,{rearmTeam:'P'});
    },
    clearInput:()=>{game.pendingMove=null;},
    logRoundStart:()=>callbacks.pushLog(`Round ${game.round}｜我方回合開始。`,'SYSTEM'),
    environmentAvailable:()=>!!game.environmentState,
    applyEnvironmentHazards:()=>environment.applyEnvironmentHazards({reason:'回合開始仍處於燃燒區'}),
    tickEffects:()=>game.units.filter(u=>u.alive).forEach(u=>engine.effect.tick(u,{units:game.units})),
    tickSanctuaries:()=>fields.tickSanctuaries('P'),
    stageRoundStart:()=>callbacks.stageEvent({type:'ROUND_START',round:game.round,team:'PLAYER'}),
    tickEnvironment:()=>EnvironmentEngine.tick(game.environmentState),
    resolveWeatherEvents:()=>environment.resolveWeatherEvents(),
    beginPlayerPerception:()=>createCanonicalPerception(game,engine).begin('P'),
    beginCardPhase:()=>{
      game.activeSeat=0;game.phase='PLAYER_CARD_PHASE';
      const rules=StageDatabase.get(game.stageId).cardRules;
      CardPhaseEngine.begin(game.cards[0],{handSize:rules.handSize});
    }
  });
  return {accepted:true,state:game};
}

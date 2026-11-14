/** Test-only composition of the independently owned shared capability engines.
 * Production imports each module by responsibility; there is NO Livia engine. */
import {UnitTraitEngine} from '../../js/unit-trait-engine.js';
import {BattlefieldFieldEngine} from '../../js/battlefield-field-engine.js';
import {NeutralActorEngine} from '../../js/neutral-actor-engine.js';
import {BattleRoundRuleEngine} from '../../js/battle-round-rule-engine.js';
export const mechanics=Object.freeze({...UnitTraitEngine,...BattlefieldFieldEngine,
  chooseBerserkAttack:NeutralActorEngine.chooseAttack,chooseBerserkMove:NeutralActorEngine.chooseMove,
  onRoundStart:BattleRoundRuleEngine.onRoundStart});
export function control(unit,round,originalTeam='P'){
  unit.team='N';unit.participatesInTurn=false;
  unit.controlOverride={type:'BERSERK',sourceResource:'duality',startedRound:round,
    originalTeam,originalParticipation:true,actionDoneRound:null};
  return unit.controlOverride;
}
export function state(mechanics,unit){mechanics.initialize(unit);return unit.resourceMechanicStates.duality;}

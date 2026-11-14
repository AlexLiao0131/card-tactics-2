/** Shared ROUND_START resource/status/field orchestration (local, Gemini, PvP). */
import {UnitTraitEngine} from './unit-trait-engine.js';
import {BattlefieldFieldEngine} from './battlefield-field-engine.js';
function onRoundStart(world){
  const result=UnitTraitEngine.onRoundStart(world);
  BattlefieldFieldEngine.onRoundStart(world);
  return result;
}
export const BattleRoundRuleEngine=Object.freeze({onRoundStart});
globalThis.BattleRoundRuleEngine=BattleRoundRuleEngine;

/** Shared ROUND_START resource/status/field orchestration (local, Gemini, PvP). */
import {UnitTraitEngine} from './unit-trait-engine.js';
import {UnitRuntimeEngine} from './unit-runtime-engine.js';
import {BattlefieldFieldEngine} from './battlefield-field-engine.js';
function onRoundStart(world){
  const result=UnitTraitEngine.onRoundStart(world);
  // Restore a catkin only after its actual neutral action was completed in the
  // previous round; reuse the same round gate in the browser and Worker.
  const restored=UnitRuntimeEngine.onFeralityRoundStart(world);
  BattlefieldFieldEngine.onRoundStart(world);
  return {...result,feralityRestored:restored};
}
export const BattleRoundRuleEngine=Object.freeze({onRoundStart});
globalThis.BattleRoundRuleEngine=BattleRoundRuleEngine;

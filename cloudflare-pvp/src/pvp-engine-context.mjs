/**
 * Synchronous per-command canonical dependency scope.
 * Existing js/ engines own all gameplay rules and unit/effect state.
 * Every Durable Object command is synchronous between the transaction's
 * awaited read/write boundaries; no callback may await while scoped.
 * This bridge is temporary until all rule modules accept explicit DI.
 */
import {createUnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {createEffectEngine} from '../../js/effect-engine.js';
import {createBattleResolution} from '../../js/battle-resolution.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';
import {isSanctuaryProtected} from '../../js/battle-area-field-engine.js';
import {createCanonicalPerception} from './pvp-perception-controller.mjs';

export function canonicalRandom(state) {
  if(!state || !Number.isSafeInteger(state.randomState))
    throw new PvpCommandError('SERVER_RANDOM_STATE_REQUIRED');
  return () => {
    state.randomState=(Math.imul(state.randomState,1664525)+1013904223)>>>0;
    return state.randomState/4294967296;
  };
}

export function withCanonicalEngines(state, execute) {
  if(typeof execute!=='function')throw new PvpCommandError('CANONICAL_COMMAND_REQUIRED');
  const random=canonicalRandom(state);
  const officialRuntime=createUnitRuntimeEngine();
  const engine={
    // Official cost is charged to the acting mirror unit, then the shared
    // perception engine transfers precisely that expenditure to its real twin.
    unitRuntime:{...officialRuntime,consumeSkill(...args){
      const spent=officialRuntime.consumeSkill(...args);
      if(spent&&state.perceptionState?.session?.active)
        createCanonicalPerception(state,engine).charge(args[0],spent);
      return spent;
    }},
    effect:createEffectEngine({random,sanctuaryProtects:unit=>isSanctuaryProtected(state.fieldState,unit)}),
    battleResolution:createBattleResolution({random})
  };
  const existing={
    EffectEngine:globalThis.EffectEngine,
    UnitRuntimeEngine:globalThis.UnitRuntimeEngine,
    BattleResolution:globalThis.BattleResolution
  };
  try {
    globalThis.EffectEngine=engine.effect;
    globalThis.UnitRuntimeEngine=engine.unitRuntime;
    globalThis.BattleResolution=engine.battleResolution;
    // Do NOT use an async callback here: globals are restored on return.
    const result=execute({...engine,random});
    if(result&&typeof result.then==='function')throw new PvpCommandError('ASYNCHRONOUS_GAME_CORE_FORBIDDEN');
    return result;
  } finally {
    globalThis.EffectEngine=existing.EffectEngine;
    globalThis.UnitRuntimeEngine=existing.UnitRuntimeEngine;
    globalThis.BattleResolution=existing.BattleResolution;
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {EffectEngine as singletonEffect} from '../../js/effect-engine.js';
import {UnitRuntimeEngine as singletonUnit} from '../../js/unit-runtime-engine.js';

const create=()=>({randomState:12345});
test('isolated effects/RNG per room restore official global engine after each synchronous command',()=>{
  const a=create(),b=create();
  const ra=withCanonicalEngines(a,({random,effect,unitRuntime})=>{
    assert.notEqual(effect,singletonEffect);
    assert.notEqual(unitRuntime,singletonUnit);
    return [random(),random()];
  });
  assert.equal(globalThis.EffectEngine,singletonEffect);
  assert.equal(globalThis.UnitRuntimeEngine,singletonUnit);
  const rb=withCanonicalEngines(b,({random})=>[random(),random()]);
  assert.deepEqual(ra,rb);
  assert.equal(a.randomState,b.randomState);
});
test('room scope restores original rules after failure',()=>{
  const s=create();
  assert.throws(()=>withCanonicalEngines(s,()=>{throw Error('invalid action');}),/invalid action/);
  assert.equal(globalThis.EffectEngine,singletonEffect);
  assert.equal(globalThis.UnitRuntimeEngine,singletonUnit);
  assert.throws(()=>withCanonicalEngines(s,()=>Promise.resolve(true)),{code:'ASYNCHRONOUS_GAME_CORE_FORBIDDEN'});
});
test('invalid random state rejected; effect engine still unchanged',()=>{
  assert.throws(()=>withCanonicalEngines({},()=>{}),{code:'SERVER_RANDOM_STATE_REQUIRED'});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeCanonicalWorld } from '../src/pvp-canonical-setup.mjs';
import {createCanonicalEnvironmentController} from '../src/pvp-environment-controller.mjs';
import {EnvironmentEngine} from '../../js/environment-engine.js';
const deck=Array(20).fill('imperial_swordsman_card');
const create=()=>({ ...initializeCanonicalWorld({seed:1234,mapSize:'SMALL',decks:[deck,deck]}),round:1 });
const callbacks=()=>({damageUnitFlat:()=>{throw Error('unexpected unit damage');},
  handleDefeated:()=>{throw Error('unexpected unit death');},
  stageEvent:()=>{},pushLog:()=>{},random:()=>0.5});
test('headless environment uses actual single-player environmental controller without browser',()=>{
 const world=create();
 const ctrl=createCanonicalEnvironmentController(world,callbacks());
 assert.equal(globalThis.window,undefined);
 assert.equal(typeof ctrl.applyEnvironmentHazards,'function');
 ctrl.applyEnvironmentHazards();
 assert.doesNotThrow(()=>structuredClone(world));
});
test('every required casualty and event handler is mandatory (no fake silent environmental resolution)',()=>{
 const world=create();
 assert.throws(()=>createCanonicalEnvironmentController(world,{}),{code:'CANONICAL_ENVIRONMENT_HOOK_REQUIRED'});
 assert.throws(()=>createCanonicalEnvironmentController({},callbacks()),{code:'WORLD_NOT_INITIALIZED'});
});
test('same world seed and deterministic climate yield the same official environmental changes',()=>{
 const a=create(),b=create();
 const aController=createCanonicalEnvironmentController(a,callbacks());
 const bController=createCanonicalEnvironmentController(b,callbacks());
 aController.applyEnvironmentHazards();bController.applyEnvironmentHazards();
 assert.deepEqual(a.battlefield.map,b.battlefield.map);
 assert.deepEqual(a.environmentState,b.environmentState);
});

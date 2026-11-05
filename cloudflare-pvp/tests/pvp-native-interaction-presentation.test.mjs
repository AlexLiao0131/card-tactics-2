import test from 'node:test';
import assert from 'node:assert/strict';
import {BabylonRenderer} from '../../js/babylon-renderer.js';

test('official BabylonRenderer owns selection highlights, unit HUD and anchor without refreshing terrain or water',()=>{
  const calls=[];
  const renderer={
    highlights:{sync:s=>calls.push(['highlights',s])},
    unitHud:{sync:s=>calls.push(['unitHud',s])},
    syncActionAnchor:s=>calls.push(['actionAnchor',s]),
    syncSubsystem:(name,callback)=>{callback();return true},
    terrain:{sync:()=>assert.fail('read-only selection must never rebuild terrain')},
    water:{sync:()=>assert.fail('read-only selection must never rebuild water')}
  };
  const state={revision:6,map:{tiles:[{x:3,y:5,reachable:true}]},units:[{id:'u1',selected:true}]};
  assert.equal(BabylonRenderer.prototype.syncInteractionPresentation.call(renderer,state),true);
  assert.deepEqual(calls.map(([name])=>name),['highlights','unitHud','actionAnchor']);
  assert.ok(calls.every(([,s])=>s===state));
  assert.equal(renderer.lastState,state);
});

test('native interaction cannot commit a partially failed HUD or tile overlay',()=>{
  const renderer={
    highlights:{sync:()=>{}},unitHud:{sync:()=>{throw Error('GPU overlay missing')}},
    syncActionAnchor:()=>{},syncSubsystem:(_name,callback)=>{try{callback();return true}catch{return false}},
    lastState:{revision:5}
  };
  assert.equal(BabylonRenderer.prototype.syncInteractionPresentation.call(renderer,{map:{tiles:[]},units:[]}),false);
  assert.equal(renderer.lastState.revision,5);
});

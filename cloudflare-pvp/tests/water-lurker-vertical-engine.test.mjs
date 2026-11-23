import test from 'node:test';
import assert from 'node:assert/strict';
import {VerticalMobilityEngine as vertical} from '../../js/vertical-mobility-engine.js';
const make=(id='water_lurker')=>({id,alive:true,x:2,y:2,character:{
 id,collision:id==='water_lurker'?{height:1}:undefined,
 terrainTraits:['AQUATIC'],verticalMobility:{defaultMode:'SWIMMING',modes:['SWIMMING','DIVING'],surfaceImmersion:1,diveDepth:1.5,maxDiveDepth:4}
},verticalState:{requestedMode:'SWIMMING'}});
const t={x:2,y:2,elevation:0,waterDepth:1};
test('用真正的共用 VerticalMobilityEngine：1 格深水允許巨章下潛及上浮',()=>{
 const u=make();assert.equal(vertical.bodyHeight(u),1);
 assert.equal(vertical.describe(u,t).mode,'SWIMMING');
 let outcome=vertical.setMode(u,t,'DIVING');assert.equal(outcome.ok,true);assert.equal(outcome.state.mode,'DIVING');
 outcome=vertical.setMode(u,t,'SWIMMING');assert.equal(outcome.ok,true);assert.equal(outcome.state.mode,'SWIMMING');
});
test('一般角色仍保留 2 格垂直碰撞限制，不會被巨章特例改變',()=>{
 const u=make('other');assert.equal(vertical.bodyHeight(u),2);
 const outcome=vertical.setMode(u,t,'DIVING');assert.equal(outcome.ok,false);
 assert.equal(outcome.reason,'WATER_TOO_SHALLOW');
});
test('水深減少後巨章無法繼續自行下潛',()=>{
 const u=make(),shallow={...t,waterDepth:.5};
 const result=vertical.setMode(u,shallow,'DIVING');assert.equal(result.ok,false);
 assert.equal(result.reason,'WATER_TOO_SHALLOW');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './water-lurker-render-fixture.mjs';
test('preserve existing mantle face eyes beak suckers and independent grip geometry',()=>{
 const x=fixture();x.sync();const fx=x.entry(),names=fx.root.getChildMeshes().map(m=>m.name);
 for(const name of ['raised-mantle','face','brow','beak','eye-socket','glowing-eye','pupil','siphon','underbody'])assert.ok(names.some(n=>n.includes(name)),name);
 assert.equal(fx.gripLinks.length,22);assert.equal(fx.gripPads.length,8);assert.equal(fx.gripRig.enabled,false);
});
test('visible death uses the common UnitRenderer queue and then disposes the actual model',()=>{
 const x=fixture();x.sync();const fx=x.entry();x.sync([{type:'UNIT_ANIMATION',unitId:'oct',sequence:20,state:'DEATH',duration:1050}],[x.hero]);
 x.tick(1000);assert.equal(x.entry(),fx);x.tick(2051);assert.equal(x.entry(),undefined);assert.ok(fx.root.disposed);
});

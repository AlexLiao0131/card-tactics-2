import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './water-lurker-render-fixture.mjs';
test('UnitRenderer owns the actual octopus mesh, one unit / one root, five articulated existing tentacles',()=>{
 const x=fixture();x.sync();const fx=x.entry();assert.equal(fx.kind,'AQUATIC_MONSTER');
 assert.equal(x.renderer.meshes.get('oct'),fx.root);assert.equal(x.renderer.entries.size,2);
 assert.equal(fx.arms.length,5);assert.ok(fx.arms.every(a=>a.pivots.length===5));
 assert.equal(fx.root.position.x,5);assert.equal(fx.root.position.z,5);assert.ok(Math.abs(fx.root.position.y-2.4)<1e-9);
 const names=fx.root.getChildMeshes().map(m=>m.name);assert.equal(names.filter(n=>n.includes('lurker-tentacle')).length,25);
 assert.ok(names.filter(n=>n.includes('lurker-sucker')).length>=15);
 const built=x.builds();x.tick(1000);x.tick(1100);assert.notEqual(fx.arms[0].joint.rotation.z,0);assert.equal(x.builds(),built);
 x.sync([], [x.hero]);assert.equal(x.renderer.entries.has('oct'),false);assert.ok(fx.root.disposed);
});
test('four directions smoothly rotate the very same visible rig around the center',()=>{
 const x=fixture();x.sync();x.tick(1000);const fx=x.entry(),root=fx.root;
 for(const [facing,angle] of [['E',Math.PI/2],['N',Math.PI],['W',-Math.PI/2],['S',0]]){
  x.monster.facing=facing;x.sync();for(let i=0;i<15;i++)x.tick(fx.lastPoseTime+100);
  assert.ok(Math.abs(Math.atan2(Math.sin(root.rotation.y-angle),Math.cos(root.rotation.y-angle)))<.001);
  assert.equal(root.position.x,5);assert.equal(root.position.z,5);assert.equal(x.entry().root,root);
 }
});
test('real WALK uses original path and arrives at official footprint center',()=>{
 const x=fixture();x.sync();x.tick(1000);x.monster.x=3;x.monster.facing='E';
 x.sync([{type:'UNIT_ANIMATION',unitId:'oct',sequence:20,state:'WALK',kind:'UNIT',path:[{x:2,y:2,z:0},{x:3,y:2,z:0}],duration:400}]);
 x.tick(1100);assert.equal(x.entry().root.position.x,5);x.tick(1300);assert.equal(x.entry().root.position.x,6);x.tick(1501);assert.equal(x.entry().root.position.x,7);
});

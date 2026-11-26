import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './water-lurker-render-fixture.mjs';
test('miss, resisted PULL, no movement, hidden target do not start a grip',()=>{
 const x=fixture();x.sync();x.sync([x.action]);assert.equal(x.entry().pendingGrabs.length,0);
 x.sync([x.action,{...x.pull,kind:'DODGE'}]);assert.equal(x.entry().pendingGrabs.length,0);
 x.sync([x.action,{...x.pull,path:[{x:5,y:2},{x:5,y:2}]}]);assert.equal(x.entry().pendingGrabs.length,0);
 x.sync([x.action,x.pull],[x.monster]);assert.equal(x.entry().pendingGrabs.length,0);
});
function grab(){const x=fixture();x.monster.facing='E';x.sync();x.tick(1000);x.hero.x=4;x.sync([x.action,x.pull]);x.tick(1100);return x;}
test('grip uses exact official victim movement, rotates into world coordinates and releases at movement end',()=>{
 const x=grab(),fx=x.entry(),hero=x.victim();assert.ok(fx.grab);assert.equal(fx.gripRig.enabled,true);
 const count=x.builds();x.tick(1280);assert.ok(hero.root.position.y>hero.basePosition.y+.1);assert.equal(hero.root.parent,undefined);
 const yaw=fx.root.rotation.y,c=Math.cos(yaw),s=Math.sin(yaw);
 const ends=fx.gripLinks.filter(m=>m.enabled).slice(-6).map(m=>({x:fx.root.position.x+c*m.position.x+s*m.position.z,z:fx.root.position.z-s*m.position.x+c*m.position.z}));
 assert.ok(ends.length>0&&ends.every(p=>Math.hypot(p.x-hero.root.position.x,p.z-hero.root.position.z)<2));
 x.tick(1461);assert.equal(fx.grab,null);assert.equal(fx.gripRig.enabled,false);assert.ok(Math.abs(hero.root.position.y-hero.basePosition.y)<.056);assert.equal(x.renderer.aquaticMonsterRig.offsets.size,0);assert.equal(hero.root.position.x,8);assert.equal(x.builds(),count);
 x.hero.x=5;x.hero.selected=true;x.sync([{type:'UNIT_ANIMATION',unitId:'hero',sequence:25,state:'WALK',kind:'UNIT',path:[{x:4,y:2,z:0},{x:5,y:2,z:0}],duration:400}]);x.tick(1500);x.tick(1901);assert.equal(hero.root.position.x,10);assert.equal(fx.grab,null);
});
test('new selection, death, visibility loss, and map reset clear the pose and grip immediately',()=>{
 for(const condition of ['selected','dead','hidden','map']){
  const x=grab();x.tick(1280);const fx=x.entry(),hero=x.victim();assert.ok(fx.grab);
  if(condition==='selected'){x.hero.selected=true;x.sync();}
  if(condition==='dead')x.sync([{type:'UNIT_ANIMATION',sequence:40,unitId:'hero',state:'DEATH'}],[x.monster]);
  if(condition==='hidden')x.sync([],[x.monster]);
  if(condition==='map'){x.map.id='new';x.sync();}
  assert.equal(fx.grab,null,condition);assert.equal(fx.gripRig.enabled,false,condition);assert.equal(x.renderer.aquaticMonsterRig.offsets.size,0);
  assert.equal(hero.root.parent,undefined);
 }
});
test('queued grip waits for its specific FORCED_MOVE and cannot replay on duplicate sync',()=>{
 const x=fixture();x.sync();x.hero.x=4;x.sync([x.action,x.pull]);x.sync([x.action,x.pull]);assert.equal(x.entry().pendingGrabs.length,1);
 x.tick(1000);x.tick(1361);assert.equal(x.entry().grab,null);
});

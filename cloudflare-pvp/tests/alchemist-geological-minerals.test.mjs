import test from 'node:test';
import assert from 'node:assert/strict';
import {ResourceEngine} from '../../js/resource-engine.js';
import {SKILLS} from '../../js/skill-database.js';
import '../../js/battle-environment-controller.js';

const harvest=globalThis.BattleEnvironmentController;
globalThis.EnvironmentObjectEngine={activeObjectsAt:(map,x,y)=>map.objects.filter(o=>!o.destroyed&&!o.carriedBy&&o.x===x&&o.y===y)};
globalThis.EnvironmentEngine={effectAt:()=>[]};
const cell=(x,y,terrain='PLAIN',elevation=0,extra={})=>({x,y,terrain,elevation,waterDepth:0,...extra});
const map=(tiles,objects=[])=>({id:'MINERAL_ROCK_GEOLOGY',seed:45,tiles,objects});
const alchemist=(id='ALC',x=0,y=0)=>({id,alive:true,x,y,character:{id:'alchemist',alchemyHarvest:true}});
const collect=(m,u)=>harvest.collectAlchemyOnStep({map:m,environmentState:{},unit:u,x:u.x,y:u.y,round:1});

test('naturally generated HIGH_GROUND stone is a MINERAL source without a BOULDER',()=>{
 const m=map([cell(0,0,'HIGH_GROUND',3)]),u=alchemist();
 const before=JSON.stringify(m.tiles);
 const events=collect(m,u);
 assert.equal(events.length,1);
 assert.deepEqual(events.map(x=>[x.kind,x.sourceId,x.sourceType]),[['MINERAL','BEDROCK:0,0','BEDROCK']]);
 assert.equal(ResourceEngine.materialCount(u,'MINERAL'),1);
 assert.equal(JSON.stringify(m.tiles),before);
 assert.equal(m.objects.length,0);
 assert.equal(collect(m,u).length,0);
});

test('cliff face can be sampled from below but not solid objects behind the cliff',()=>{
 const m=map([cell(0,0,'PLAIN',0),cell(1,0,'HIGH_GROUND',4)],[{id:'boulder',type:'BOULDER',x:1,y:0,blocksMovement:true}]);
 const u=alchemist();
 const events=collect(m,u);
 assert.deepEqual(events.map(x=>x.sourceId),['BEDROCK:1,0']);
 assert.equal(events[0].sourceType,'CLIFF_FACE');
 assert.equal(ResourceEngine.materialCount(u,'MINERAL'),1);
 assert.ok(!('OBJECT:boulder' in m.alchemyHarvestedSources));
});

test('one native bedrock is shared across the cliff foot and plateau; second alchemist gets nothing',()=>{
 const m=map([cell(0,0,'PLAIN',0),cell(1,0,'HIGH_GROUND',3),cell(2,0,'PLAIN',3)]),u=alchemist();
 assert.deepEqual(collect(m,u).map(x=>x.sourceId),['BEDROCK:1,0']);
 const other=alchemist('SECOND',2,0);
 assert.deepEqual(collect(m,other),[]);
 assert.equal(ResourceEngine.materialCount(other,'MINERAL'),0);
});

test('magically created highlands and walls are not natural mineral mines',()=>{
 for(const t of [cell(1,0,'HIGH_GROUND',3,{alchemyTransmuted:true}),cell(1,0,'WALL',3)]){
  const m=map([cell(0,0,'PLAIN',0),t]);
  assert.deepEqual(collect(m,alchemist()),[]);
 }
});

test('plain rockless low ground, water and ordinary riverbed cannot be mistaken for ore',()=>{
 const m=map([cell(0,0),cell(1,0,'PLAIN',0,{waterDepth:1})]);
 assert.deepEqual(collect(m,alchemist()),[]);
 const river=map([cell(0,0,'PLAIN',0,{river:true,hydrologyBedMaterial:'ROCK',waterDepth:1})]);
 assert.deepEqual(collect(river,alchemist()).map(x=>x.kind),['CRYSTAL_SAND']);
});

test('failed storage must not consume a rock source, no item or one-time quality roll',()=>{
 const m=map([cell(0,0,'HIGH_GROUND',3)]),u=alchemist();
 const original=ResourceEngine.changeMaterial;
 globalThis.ResourceEngine={...ResourceEngine,changeMaterial:()=>false};
 try{assert.deepEqual(collect(m,u),[]);assert.deepEqual(m.alchemyHarvestedSources,{});}
 finally{globalThis.ResourceEngine=ResourceEngine;}
 assert.equal(collect(m,u).length,1);
});

test('mined natural ore satisfies both canonical explosion and hard-shell potion recipes, with real debit',()=>{
 const m=map([cell(0,0,'HIGH_GROUND',3)]),u=alchemist();
 collect(m,u);
 for(const id of ['alchemy_explosion','alchemy_hard_shell_potion']){
  const normal=SKILLS[id].variants.find(v=>v.id==='NORMAL');
  assert.deepEqual(normal.materialCost,{kind:'MINERAL',quality:'NORMAL',affinity:'NONE',amount:1});
  assert.equal(ResourceEngine.hasMaterial(u,normal.materialCost),true);
 }
 assert.equal(ResourceEngine.changeMaterial(u,{kind:'MINERAL',quality:'NORMAL',affinity:'NONE',amount:-1}),true);
 assert.equal(ResourceEngine.hasMaterial(u,SKILLS.alchemy_explosion.variants[0].materialCost),false);
 assert.equal(collect(m,u).length,0);
});

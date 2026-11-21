import test from 'node:test';
import assert from 'node:assert/strict';
import {ResourceEngine} from '../../js/resource-engine.js';
import '../../js/battle-environment-controller.js';

const harvest=globalThis.BattleEnvironmentController;
globalThis.EnvironmentObjectEngine={activeObjectsAt:(map,x,y)=>map.objects.filter(o=>!o.destroyed&&!o.carriedBy&&o.x===x&&o.y===y)};
globalThis.EnvironmentEngine={effectAt:(state,x,y)=>state?.effects?.[`${x},${y}`]||[]};
const mapWith=(objects=[],tiles=[{x:0,y:0,terrain:'PLAIN',elevation:0},{x:1,y:0,terrain:'PLAIN',elevation:0}],seed=25)=>({id:'TEST',seed,objects,tiles});
const unit=(id='ALC')=>({id,alive:true,x:0,y:0,character:{id:'alchemist',name:'煉金術士',alchemyHarvest:true}});
const collect=(map,u,x=0,y=0,env={},round=null)=>{u.x=x;u.y=y;return harvest.collectAlchemyOnStep({map,environmentState:env,unit:u,x,y,round})};
const book=u=>ResourceEngine.materialSnapshot(u);

test('no alchemist means no harvesting or world inventory mutations',()=>{
  const m=mapWith([{id:'bush1',type:'BUSH',x:0,y:0,blocksMovement:false}]);const u=unit();u.character.alchemyHarvest=false;
  assert.deepEqual(collect(m,u),[]);assert.equal(m.alchemyHarvestedSources,undefined);assert.deepEqual(book(u),{});
});
test('non-destructive plant gathering: one source in entire battle, no world damage',()=>{
 const m=mapWith([{id:'bush1',type:'BUSH',x:0,y:0,durability:24,blocksMovement:false}]);const u=unit(),other=unit('OTHER');
 const before=JSON.stringify({objects:m.objects,tiles:m.tiles});
 const result=collect(m,u);assert.equal(result.length,1);assert.equal(result[0].kind,'HERB');
 assert.equal(ResourceEngine.materialCount(u,'HERB'),1);
 assert.equal(JSON.stringify({objects:m.objects,tiles:m.tiles}),before);
 assert.deepEqual(collect(m,u),[]);assert.deepEqual(collect(m,other),[]);
 assert.equal(ResourceEngine.materialCount(other,'HERB'),0);
});
test('real route only, legal adjacent rock but not across cliff / wall',()=>{
  const rock={id:'ore1',type:'BOULDER',x:1,y:0,blocksMovement:true,durability:90};
  const m=mapWith([rock]);const u=unit();
  assert.equal(collect(m,u).length,1);
  assert.equal(ResourceEngine.materialCount(u,'MINERAL'),1);
  assert.equal(rock.durability,90);
  assert.deepEqual(collect(m,u),[]);
  const cliff=mapWith([{...rock}], [{x:0,y:0,terrain:'PLAIN',elevation:0},{x:1,y:0,terrain:'HIGH_GROUND',elevation:4}]);
  assert.deepEqual(collect(cliff,unit()),[]);
  const wall=mapWith([{...rock}], [{x:0,y:0,terrain:'PLAIN',elevation:0},{x:1,y:0,terrain:'WALL',elevation:0}]);
  assert.deepEqual(collect(wall,unit()),[]);
});
test('authored riverbed can provide crystal sand without changing hydrology',()=>{
 const tiles=[{x:0,y:0,terrain:'PLAIN',elevation:0,river:true,waterDepth:0.5,iceThickness:0.25,hydrologyBedMaterial:'SILT'}];
 const m=mapWith([],tiles),u=unit();const before=JSON.stringify(m.tiles);
 assert.equal(collect(m,u)[0].kind,'CRYSTAL_SAND');
 assert.equal(ResourceEngine.materialCount(u,'CRYSTAL_SAND'),1);
 assert.equal(JSON.stringify(m.tiles),before);
});
test('high quality has inherent affinity and never requires a second element ingredient',()=>{
 let found=null;
 for(let i=1;i<1200;i++){
  const m=mapWith([{id:`b${i}`,type:'BUSH',x:0,y:0,blocksMovement:false}],undefined,i);const u=unit();const result=collect(m,u);
  if(result[0]?.quality==='HIGH'){found={m,u,result};break;}
 }
 assert.ok(found);
 assert.equal(ResourceEngine.materialCount(found.u,'HERB','HIGH','NATURE'),1);
 assert.equal(ResourceEngine.materialCount(found.u,'HERB'),1);
 assert.ok(ResourceEngine.hasMaterial(found.u,{kind:'HERB',quality:'HIGH',affinity:'NATURE'}));
 assert.equal(ResourceEngine.changeMaterial(found.u,{kind:'HERB',quality:'HIGH',affinity:'NATURE',amount:-1}),true);
 assert.equal(ResourceEngine.materialCount(found.u,'HERB'),1);
 assert.equal(ResourceEngine.changeMaterial(found.u,{kind:'HERB',quality:'HIGH',affinity:'NATURE',amount:-1}),false);
});
test('active fire and electric conditions override source affinity, ice is not a fake damage element',()=>{
 const affin=(effect,tileExtra={})=>{
  const m=mapWith([{id:'tree',type:'TREE',x:0,y:0,blocksMovement:false}], [{x:0,y:0,terrain:'FOREST',elevation:0,...tileExtra}]);
  return harvest.alchemyAffinity(m,{effects:{'0,0':effect}}, {x:0,y:0,kind:'WOOD'});
 };
 assert.equal(affin([{type:'BURNING'}]),'FIRE');
 assert.equal(affin([{type:'ELECTRIFIED'}]),'THUNDER');
 assert.equal(affin([],{iceThickness:0.25}),'ICE');
 assert.equal(affin([],{snowDepth:0.25}),'ICE');
 assert.equal(affin([]),'NATURE');
});
test('cancel move refunds exactly those sources and permits same deterministic first draw again',()=>{
 const m=mapWith([{id:'b1',type:'BUSH',x:0,y:0,blocksMovement:false}]),u=unit();u._alchemyHarvestUndo=[];
 const before=book(u),first=collect(m,u);
 assert.equal(first.length,1);assert.equal(harvest.rollbackAlchemyHarvest(u,m),1);
 assert.deepEqual(book(u),before);
 assert.deepEqual(m.alchemyHarvestedSources,{});
 const again=collect(m,u);assert.equal(again[0].quality,first[0].quality);
 assert.equal(again[0].affinity,first[0].affinity);
 assert.equal(harvest.rollbackAlchemyHarvest(u,m),0); // no staged transaction on second collect
});
test('committing an undoable move makes its gains irreversible by rollback',()=>{
 const m=mapWith([{id:'b2',type:'BUSH',x:0,y:0,blocksMovement:false}]),u=unit();u._alchemyHarvestUndo=[];
 collect(m,u);harvest.commitAlchemyHarvest(u);
 assert.equal(harvest.rollbackAlchemyHarvest(u,m),0);
 assert.equal(ResourceEngine.materialCount(u,'HERB'),1);
});
test('PvP step-by-step moves share one round transaction; new round clears old undo journal',()=>{
 const m=mapWith([{id:'b1',type:'BUSH',x:0,y:0,blocksMovement:false},{id:'b2',type:'BUSH',x:2,y:0,blocksMovement:false}],
  [{x:0,y:0,terrain:'PLAIN',elevation:0},{x:1,y:0,terrain:'PLAIN',elevation:0},{x:2,y:0,terrain:'PLAIN',elevation:0}]),u=unit();
 collect(m,u,0,0,{},1);collect(m,u,2,0,{},1);
 assert.equal(u._alchemyHarvestUndo.length,2);
 assert.equal(harvest.rollbackAlchemyHarvest(u,m),2);
 assert.equal(ResourceEngine.materialCount(u,'HERB'),0);
 collect(m,u,0,0,{},1);harvest.commitAlchemyHarvest(u);
 collect(m,u,2,0,{},2);
 assert.equal(u._alchemyHarvestUndo.length,1);
 assert.equal(harvest.rollbackAlchemyHarvest(u,m),1);
 assert.equal(ResourceEngine.materialCount(u,'HERB'),1);
});
test('quality roll is reproducible, without 30% re-roll exploit',()=>{
 let hits=0;const N=2000;
 for(let i=0;i<N;i++)if(harvest.collectAlchemyOnStep({map:mapWith([{id:`b${i}`,type:'BUSH',x:0,y:0,blocksMovement:false}],undefined,i),unit:unit(),x:0,y:0})[0].quality==='HIGH')hits++;
 assert.ok(hits>N*.25&&hits<N*.35,`observed ${hits}/${N}`);
});

test('latest real elemental event wins while still active; expired marks cannot fake affinity',()=>{
 const m=mapWith([{id:'tree',type:'TREE',x:0,y:0,blocksMovement:false}],
   [{x:0,y:0,terrain:'FOREST',elevation:0}]),u=unit();
 const env={effects:{'0,0':[{type:'BURNING'},{type:'ELECTRIFIED'}]}};
 const controller=harvest.create({state:()=>({map:m,units:[u],environmentState:env}),
   pushLog:()=>{},handleDefeated:()=>{},stageEvent:()=>{}});
 controller.logEnvironmentEvent({type:'IGNITE',x:0,y:0});
 assert.equal(harvest.alchemyAffinity(m,env,{x:0,y:0,kind:'WOOD'}),'FIRE');
 controller.logEnvironmentEvent({type:'ELECTRIC_CONDUCTION',x:0,y:0,regionSize:1});
 assert.equal(harvest.alchemyAffinity(m,env,{x:0,y:0,kind:'WOOD'}),'THUNDER');
 env.effects['0,0']=[{type:'BURNING'}];
 assert.equal(harvest.alchemyAffinity(m,env,{x:0,y:0,kind:'WOOD'}),'FIRE');
 env.effects['0,0']=[];
 assert.equal(harvest.alchemyAffinity(m,env,{x:0,y:0,kind:'WOOD'}),'NATURE');
});

test('legal riverbank collects real adjacent riverbed crystal sand without wading or touching river water',()=>{
 const tiles=[{x:0,y:0,terrain:'PLAIN',elevation:0},{x:1,y:0,terrain:'PLAIN',elevation:0,river:true,waterDepth:3}];
 const m=mapWith([],tiles),u=unit();const before=JSON.stringify(m.tiles);
 assert.equal(collect(m,u).length,1);
 assert.equal(ResourceEngine.materialCount(u,'CRYSTAL_SAND'),1);
 assert.equal(JSON.stringify(m.tiles),before);
 assert.deepEqual(collect(m,u),[]);
 const blocked=mapWith([], [{x:0,y:0,terrain:'PLAIN',elevation:0},{x:1,y:0,terrain:'WALL',elevation:0,river:true,waterDepth:3}]);
 assert.deepEqual(collect(blocked,unit()),[]);
 const cliff=mapWith([], [{x:0,y:0,terrain:'PLAIN',elevation:0},{x:1,y:0,terrain:'PLAIN',elevation:-4,river:true,waterDepth:3}]);
 assert.deepEqual(collect(cliff,unit()),[]);
});

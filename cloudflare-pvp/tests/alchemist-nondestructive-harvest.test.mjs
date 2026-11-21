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
 assert.equal(collect(m,u).length,2); // One geological riverbed + one shore alluvial deposit.
 assert.equal(ResourceEngine.materialCount(u,'CRYSTAL_SAND'),2);
 assert.equal(JSON.stringify(m.tiles),before);
 assert.deepEqual(collect(m,u),[]);
 const blocked=mapWith([], [{x:0,y:0,terrain:'PLAIN',elevation:0},{x:1,y:0,terrain:'WALL',elevation:0,river:true,waterDepth:3}]);
 assert.deepEqual(collect(blocked,unit()),[]);
 const cliff=mapWith([], [{x:0,y:0,terrain:'PLAIN',elevation:0},{x:1,y:0,terrain:'PLAIN',elevation:-4,river:true,waterDepth:3}]);
 assert.deepEqual(collect(cliff,unit()),[]);
});

// Added regression: actual authored river pools, bank deposits, and holy-shield
// affinities are distinct from arbitrary WATER tiles or ordinary shields.
test('authored natural channel pocket supplies a real one-time crystal sand source',()=>{
 const m=mapWith([], [{x:0,y:0,terrain:'PLAIN',elevation:0},
   {x:1,y:0,terrain:'PLAIN',elevation:-.5,hydrologyNaturalChannelPool:true,waterDepth:1.2}],42);
 const u=unit(),before=JSON.stringify(m.tiles);const first=collect(m,u);
 assert.equal(first.length,1);assert.equal(first[0].sourceId,'RIVERBED:1,0');
 assert.equal(ResourceEngine.materialCount(u,'CRYSTAL_SAND'),1);
 assert.deepEqual(collect(m,u),[]);assert.equal(JSON.stringify(m.tiles),before);
});
test('a real connected river bank is its own once-per-battle sediment source',()=>{
 const m=mapWith([], [{x:0,y:0,terrain:'PLAIN',elevation:0},
   {x:1,y:0,terrain:'PLAIN',elevation:0,river:true,hydrologyBedMaterial:'GRAVEL'}],61);
 const u=unit('ALC1'),other=unit('ALC2');
 const picked=collect(m,u);assert.deepEqual(new Set(picked.map(e=>e.sourceId)),
   new Set(['RIVERBANK:0,0','RIVERBED:1,0']));
 assert.equal(ResourceEngine.materialCount(u,'CRYSTAL_SAND'),2);
 assert.deepEqual(collect(m,other),[]);
 assert.equal(m.tiles[0].river,undefined);assert.equal(m.tiles[0].terrain,'PLAIN');
});
test('rainwater, disconnected bank and cliffs cannot fabricate river sediment',()=>{
 const tile=(x,y,extra={})=>({x,y,terrain:'PLAIN',elevation:0,...extra});
 const flooded=mapWith([], [tile(0,0,{waterDepth:3}),tile(1,0,{waterDepth:5})]);
 assert.deepEqual(collect(flooded,unit()),[]);
 const cliff=mapWith([], [tile(0,0,{elevation:6}),tile(1,0,{river:true,elevation:0})]);
 assert.deepEqual(collect(cliff,unit()),[]);
});
test('active holy shield in actual source contact grants HOLY high quality, without altering quality roll',()=>{
 const m0=mapWith([{id:'b1',type:'BUSH',x:0,y:0,blocksMovement:false}], [{x:0,y:0,terrain:'PLAIN',elevation:0}],80);
 const src={x:0,y:0,kind:'HERB'};
 const holy={id:'HOLY',alive:true,x:0,y:1,effects:[{id:'HOLY_SHIELD',type:'BUFF',classification:'POSITIVE',remaining:2}]};
 assert.equal(harvest.alchemyAffinity(m0,{},src,[holy]),'HOLY');
 for(let seed=1;seed<1300;seed++){
   const m=mapWith([{id:'b1',type:'BUSH',x:0,y:0,blocksMovement:false}], [{x:0,y:0,terrain:'PLAIN',elevation:0}],seed);
   const caster=unit(),shield={...holy,effects:holy.effects.map(x=>({...x}))};
   const result=harvest.collectAlchemyOnStep({map:m,unit:caster,units:[caster,shield],x:0,y:0});
   if(result[0]?.quality==='HIGH'){
     assert.equal(result[0].affinity,'HOLY');
     assert.equal(ResourceEngine.materialCount(caster,'HERB','HIGH','HOLY'),1);
     assert.equal(ResourceEngine.materialCount(caster,'HERB'),1);
     assert.equal(shield.effects[0].remaining,2);
     assert.deepEqual(harvest.collectAlchemyOnStep({map:m,unit:caster,units:[caster,shield],x:0,y:0}),[]);
     return;
   }
 }
 assert.fail('No deterministic high-quality fixture found');
});
test('expired or ordinary/water shields cannot create HOLY; live saint overflow shield can',()=>{
 const m=mapWith([], [{x:0,y:0,terrain:'FOREST',elevation:0}],99),
   src={x:0,y:0,kind:'WOOD'},sh=(id,hp)=>({id:'X',alive:true,x:0,y:0,
     effects:[{id,type:'SHIELD',classification:'POSITIVE',shieldHp:hp}]});
 assert.equal(harvest.alchemyAffinity(m,{},src,[sh('NEREIA_TSUNAMI_WATER_SHIELD',50)]),'NATURE');
 assert.equal(harvest.alchemyAffinity(m,{},src,[sh('ALCH_ARMOR_HOLY',0)]),'NATURE');
 assert.equal(harvest.alchemyAffinity(m,{},src,[{id:'Y',alive:true,x:0,y:0,effects:[{id:'HOLY_SHIELD',type:'BUFF',remaining:0}]}]),'NATURE');
 assert.equal(harvest.alchemyAffinity(m,{},src,[sh('SAINT_OVERHEAL_SHIELD',12)]),'HOLY');
 assert.equal(harvest.alchemyAffinity(m,{},src,[{id:'X',alive:true,x:2,y:0,effects:[{id:'HOLY_SHIELD',type:'BUFF'}]}]),'NATURE');
});
test('active fire/electric contact still wins over nearby holy shield; no global holy aura',()=>{
 const m=mapWith([], [{x:0,y:0,terrain:'FOREST',elevation:0}],20),
   src={x:0,y:0,kind:'WOOD'},holy=[{id:'X',alive:true,x:0,y:0,effects:[{id:'HOLY_SHIELD',type:'BUFF'}]}];
 assert.equal(harvest.alchemyAffinity(m,{effects:{'0,0':[{type:'ELECTRIFIED'}]}},src,holy),'THUNDER');
 assert.equal(harvest.alchemyAffinity(m,{effects:{'0,0':[{type:'BURNING'}]}},src,holy),'FIRE');
});

test('riverbank and channel sample both roll 30% independently and are both undone atomically',()=>{
 const m=mapWith([], [{x:0,y:0,terrain:'PLAIN',elevation:0},{x:1,y:0,terrain:'PLAIN',elevation:0,river:true}],109),u=unit();
 u._alchemyHarvestUndo=[];
 const before=JSON.stringify(m.tiles),sample=collect(m,u,0,0,{},3);
 assert.equal(sample.length,2);
 assert.equal(Object.keys(m.alchemyHarvestedSources).length,2);
 assert.equal(ResourceEngine.materialCount(u,'CRYSTAL_SAND'),2);
 assert.equal(harvest.rollbackAlchemyHarvest(u,m),2);
 assert.equal(ResourceEngine.materialCount(u,'CRYSTAL_SAND'),0);
 assert.deepEqual(m.alchemyHarvestedSources,{});
 assert.equal(JSON.stringify(m.tiles),before);
});

test('shield changes only quality affinity; normal drop and 30% frequency remain identical',()=>{
 const holy={id:'H',alive:true,x:0,y:0,effects:[{id:'HOLY_SHIELD',type:'BUFF',remaining:2}]};
 let rareWith=0,rareWithout=0;
 for(let i=1;i<=2000;i++){
  const base=()=>mapWith([{id:'x',type:'BUSH',x:0,y:0,blocksMovement:false}],
   [{x:0,y:0,terrain:'PLAIN',elevation:0}],i);
  const u=unit(),withShield=harvest.collectAlchemyOnStep({map:base(),unit:u,units:[u,holy],x:0,y:0})[0];
  const without=collect(base(),unit())[0];
  if(withShield.quality==='HIGH')rareWith++;
  if(without.quality==='HIGH')rareWithout++;
  assert.equal(withShield.quality,without.quality);
  if(withShield.quality==='HIGH'){assert.equal(withShield.affinity,'HOLY');assert.equal(without.affinity,'NATURE');}
 }
 assert.equal(rareWith,rareWithout);assert.ok(rareWith>500&&rareWith<700,`unexpected ${rareWith}`);
});

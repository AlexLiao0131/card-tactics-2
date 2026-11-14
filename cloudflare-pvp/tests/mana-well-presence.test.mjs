import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BattlefieldFieldEngine as fields} from '../../js/battlefield-field-engine.js';

const tacticalSource=readFileSync(new URL('../../js/tactical-game.js',import.meta.url),'utf8');
const pvpSource=readFileSync(new URL('../src/pvp-headless-tactical.mjs',import.meta.url),'utf8');
const originalTactical=globalThis.TacticalEngine;
const originalRuntime=globalThis.UnitRuntimeEngine;

test('mana-well owner detection requires a living fielded Livia and is team-private',()=>{
 const source=livia();
 assert.equal(fields.canSenseManaWells([source],'P'),true);
 assert.equal(fields.canSenseManaWells([source],'E'),false);
 source.alive=false;
 assert.equal(fields.canSenseManaWells([source],'P'),false);
 assert.equal(fields.canSenseManaWells([soldier('P')],'P'),false);
});

test('stale mana wells and round markers are removed when Livia leaves the battlefield',()=>{
 const map=grid();
 map.manaWells=[{x:1,y:1,team:'P',amount:24},{x:3,y:3,team:'E',amount:24}];
 map.manaWellSpawnedRounds={P:2,E:2};
 const removed=fields.pruneManaWells(map,[soldier('P')]);
 assert.equal(removed,2);
 assert.deepEqual(map.manaWells,[]);
 assert.deepEqual(map.manaWellSpawnedRounds,{});
});

test('without Livia, round processing creates no wells and clears stale team markers',()=>{
 const map=grid();
 map.manaWells=[{x:1,y:1,team:'P',amount:24}];
 map.manaWellSpawnedRounds={P:1};
 assert.equal(fields.spawnWells(map,[soldier('P')],2,()=>0),0);
 assert.deepEqual(map.manaWells,[]);
 assert.deepEqual(map.manaWellSpawnedRounds,{});
});

test('well creation is tied to a living source and is pruned immediately after source death',()=>{
 installTactical();
 const map=grid(),source=livia();
 assert.equal(fields.spawnWells(map,[source],1,()=>0),1);
 assert.equal(map.manaWells.length,1);
 assert.equal(map.manaWells[0].team,'P');
 assert.equal(fields.canSenseManaWells([source],'P'),true);
 source.alive=false;
 assert.equal(fields.pruneManaWells(map,[source]),1);
 assert.equal(map.manaWells.length,0);
});

test('a stale well cannot restore MP to a team without its living Livia source',()=>{
 const map=grid(),unit={id:'ally',team:'P',alive:true,x:1,y:1,mana:10,maxMana:120,character:{name:'ally'}};
 map.manaWells=[{x:1,y:1,team:'P',amount:24}];
 let restoreCalls=0;
 globalThis.UnitRuntimeEngine={restoreMana(){restoreCalls++;return 24;}};
 const result=fields.onEnterTile(map,[unit],unit,1);
 assert.equal(result.restored,0);
 assert.equal(restoreCalls,0);
 assert.equal(unit.mana,10);
});

test('ordinary resource users such as Ophi do not dereference a null trait resource key on deployment',()=>{
 const match=tacticalSource.match(/function onUnitCreated\(unit\)\{[\s\S]*?return unit;\}/);
 assert.ok(match,'onUnitCreated function must remain present');
 const create=new Function('globalThis','EffectEngine','syncSmokeCover','UnitRuntimeEngine','map','units','round','environmentState',`${match[0]};return onUnitCreated;`);
 const fakeGlobal={
   UnitTraitEngine:{resourceKey:()=>null,hasResource:()=>false},
   BattlefieldFieldEngine:{spawnWells(){throw new Error('non-resource unit must not spawn wells');}}
 };
 const fn=create(fakeGlobal,{syncConditionalPassives(){}},()=>{}, {syncForestSouls(){}},grid(),[],3,{});
 const ophi={id:'ophi',character:{id:'ophi',resourceRules:{forestSoul:{max:30}}}};
 assert.doesNotThrow(()=>fn(ophi));
 assert.equal(ophi.resourceMechanicStates,undefined);
});

test('local and PvP flows both prune wells after their source Livia is defeated',()=>{
 assert.match(tacticalSource,/function handleDefeated\(unit,source,skillOrEffect\)[\s\S]*?deathLifecycle\.finalize\(unit,source,skillOrEffect\)[\s\S]*?pruneManaWells/);
 assert.match(tacticalSource,/function render\(\)\{[\s\S]*?pruneManaWells\?\.\(map,units\)/);
 assert.match(pvpSource,/const handleDefeated=\(unit,source,cause\)=>\{[\s\S]*?death\.finalize\(unit,source,cause\)[\s\S]*?pruneManaWells/);
});

test.after(()=>{
 if(originalTactical===undefined)delete globalThis.TacticalEngine;else globalThis.TacticalEngine=originalTactical;
 if(originalRuntime===undefined)delete globalThis.UnitRuntimeEngine;else globalThis.UnitRuntimeEngine=originalRuntime;
});

function installTactical(){
 globalThis.TacticalEngine={
   canOccupyTerrain:(_unit,tile)=>tile.terrain!=='WALL',
   isBlockedByObject:()=>false,
   canTraverseElevation:(from,to)=>Math.abs(Number(from.elevation||0)-Number(to.elevation||0))<=1,
   tile:(map,x,y)=>map.tiles.find(tile=>tile.x===x&&tile.y===y)||null
 };
}
function grid(width=5,height=5){
 return{id:'mana-well-test',width,height,tiles:Array.from({length:width*height},(_,i)=>({
   x:i%width,y:Math.floor(i/width),terrain:'PLAIN',elevation:0
 }))};
}
function livia(){
 return{id:'livia',team:'P',x:2,y:2,alive:true,occupiesTile:true,character:{id:'livia',name:'莉維亞',resourceRules:{mana:true,duality:{}}},resources:{}};
}
function soldier(team='P'){
 return{id:'soldier',team,x:0,y:0,alive:true,character:{id:'soldier',name:'士兵',resourceRules:{mana:true}}};
}

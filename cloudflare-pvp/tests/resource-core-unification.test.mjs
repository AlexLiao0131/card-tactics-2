import test from 'node:test';
import assert from 'node:assert/strict';
import {ResourceEngine as core} from '../../js/resource-engine.js';
import {mechanics as livia,state} from './shared-mechanics-fixture.mjs';
import {UnitRuntimeEngine as runtime} from '../../js/unit-runtime-engine.js';

const unit=(id,resourceRules={},attrs={int:20,wil:20})=>({id,alive:true,team:'P',character:{id,name:id,resourceRules,attributes:attrs},resources:{},mana:undefined});

test('one declarative duality entry initializes exactly once in shared core',()=>{
 const u=unit('livia',{mana:true,duality:{}});
 runtime.syncResources(u,{initialize:true});
 assert.deepEqual(u.resources.duality,{value:50,max:100,label:'雙極'});
 const obj=u.resources.duality;
 assert.equal(livia.initialize(u),obj);
 assert.equal(core.change(u,'duality',15),15);
 assert.equal(u.resources.duality.value,65);
 assert.equal(livia.setPolarity(u,100),35);
 assert.equal(core.value(u,'duality'),100);
 assert.equal(runtime.resourceSnapshot(u).duality.value,100);
});

test('cannot fabricate duality resource on another unit via generic runtime',()=>{
 const u=unit('leon',{mana:true});
 runtime.syncResources(u,{initialize:true});
 assert.equal(runtime.changeResource(u,'duality',50),0);
 assert.equal(core.change(u,'duality',50),0);
 assert.equal(u.resources.duality,undefined);
});

test('MP is adjusted exclusively in shared core, preserving original attributes formula',()=>{
 const u=unit('livia',{mana:true,duality:{}},{int:20,wil:20});
 assert.equal(runtime.syncMana(u,{initialize:true}).mana,120);
 assert.equal(runtime.drainMana(u,42),42);
 assert.equal(runtime.restoreMana(u,17),17);
 assert.equal(core.changeMana(u,-200),-95);
 assert.equal(u.mana,0);
 assert.equal(runtime.restoreMana(u,300),120);
 assert.equal(u.mana,120);
});

test('faith / holyPower / humidity / blood mutations share one clamp and resource storage',()=>{
 const saint=unit('church_saint',{faith:{label:'信仰',max:100,initial:50,naturalRecovery:0}});
 runtime.syncResources(saint,{initialize:true});
 assert.equal(runtime.changeFaith(saint,70),50);
 assert.equal(runtime.changeFaith(saint,-110),-100);
 assert.equal(saint.resources.faith.value,0);
 const templar=unit('church_templar_hero',{holyPower:{label:'聖能',max:3,initial:0,naturalRecovery:0}});
 assert.equal(runtime.changeHolyPower(templar,5),3);
 assert.equal(runtime.changeHolyPower(templar,-2),-2);
 const queen=unit('nereia',{humidity:{label:'濕度',max:100,initial:100,naturalRecovery:0}});
 assert.equal(runtime.changeHumidity(queen,-27),-27);
 assert.equal(queen.resources.humidity.value,73);
 const vampire=unit('seraphina',{blood:{label:'血能',max:100,initial:0,naturalRecovery:0}});
 assert.equal(runtime.changeBlood(vampire,100),100);
 assert.equal(vampire._bloodAwakened,true);
 assert.equal(runtime.changeBlood(vampire,-100),-100);
 assert.equal(vampire._bloodAwakened,false);
});

test('sanity overdraft remains a cost RULE; core holds clamped state and uniform readback',()=>{
 const u=unit('velsa',{sanity:{label:'Sanity',max:100,initial:100,naturalRecovery:0,costMode:'DRAIN',allowOverdraft:true}});
 runtime.syncResources(u,{initialize:true});
 assert.equal(runtime.changeResource(u,'sanity',-180),-100);
 assert.equal(core.snapshot(u).sanity.value,0);
});

test('forest soul plant collection uses central writer and preserves fractional values',()=>{
 const u=unit('ophi',{forestSoul:{label:'森靈之魂',max:30,initial:0,naturalRecovery:0,collectionRadius:2,regenerationRounds:3}});
 u.id='OPHI';u.x=1;u.y=1;runtime.syncResources(u,{initialize:true});
 const map={objects:[{id:'tree',type:'TREE',x:2,y:1,maxDurability:72,durability:36}]};
 runtime.syncForestSouls(map,[u],1,{emit:false});
 assert.equal(u.resources.forestSoul.value,1.5);
 assert.equal(core.value(u,'forestSoul'),1.5);
 assert.equal(map.objects[0].ophiForestSoul.respawnRound,4);
});

test('purple full skips N+1 exactly then uses shared recover once N+2 even on berserk',()=>{
 const u=unit('livia',{mana:true,duality:{}});
 livia.initialize(u);state(livia,u).round=5;
 livia.setPolarity(u,100);
 livia.afterCommittedSkill(u,{id:'nether_slash'});
 assert.equal(state(livia,u).holdUntil,6);
 const map={tiles:[],manaWells:[],spatialDistortions:[]};
 livia.onRoundStart({map,units:[u],round:6,random:()=>.99});
 assert.equal(livia.polarity(u),100);
 state(livia,u).fullRounds=1;
 livia.onRoundStart({map,units:[u],round:7,random:()=>0});
 assert.equal(livia.polarity(u),90);
 assert.equal(livia.status(u).berserk,true);
 livia.onRoundStart({map,units:[u],round:7,random:()=>0});
 assert.equal(livia.polarity(u),90);
});

test('committed skill consumes MP and Sanity via one authoritative core without a second deduction',()=>{
 const u=unit('velsa',{mana:true,sanity:{label:'Sanity',max:100,initial:100,naturalRecovery:0,allowOverdraft:true}});
 runtime.syncMana(u,{initialize:true});runtime.syncResources(u,{initialize:true});
 const skill={id:'test_spell',name:'test',attackType:'MAGIC',category:'MAGIC',manaCost:20,resourceCosts:{sanity:25},power:1};
 assert.equal(runtime.canUseSkill(u,skill),true);
 const spent=runtime.consumeSkill(u,skill);
 assert.equal(spent.cost,20);
 assert.equal(spent.resources.sanity.cost,25);
 assert.equal(u.mana,100);
 assert.equal(core.value(u,'sanity'),75);
 assert.equal(runtime.resourceSnapshot(u).sanity.value,75);
});

test('blood skill cost reuses shared mutation and retains awakened full/zero boundaries',()=>{
 const u=unit('seraphina',{mana:true,blood:{label:'血能',max:100,initial:100,naturalRecovery:0}});
 runtime.syncMana(u,{initialize:true});runtime.syncResources(u,{initialize:true});runtime.reconcileBlood(u);
 assert.equal(u._bloodAwakened,true);
 const skill={id:'test_blood',attackType:'MAGIC',category:'MAGIC',manaCost:0,resourceCosts:{blood:100},power:1};
 const spent=runtime.consumeSkill(u,skill);
 assert.equal(spent.resources.blood.cost,100);
 assert.equal(core.value(u,'blood'),0);
 assert.equal(u._bloodAwakened,false);
});

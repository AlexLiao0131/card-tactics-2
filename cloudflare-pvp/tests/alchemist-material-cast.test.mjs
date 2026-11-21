import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ResourceEngine} from '../../js/resource-engine.js';

// Evaluate the real UnitRuntimeEngine function without bootstrapping Babylon,
// DOM, Cloudflare or unrelated character files. No gameplay formulas are copied.
const text=readFileSync(new URL('../../js/unit-runtime-engine.js',import.meta.url),'utf8')
  .replace(/^import .*;\s*$/gm,'')
  .replace('export function createUnitRuntimeEngine','function createUnitRuntimeEngine')
  .replace('export const UnitRuntimeEngine','const UnitRuntimeEngine')
  .replace('globalThis.UnitRuntimeEngine=UnitRuntimeEngine;','globalThis.UnitRuntimeEngine=UnitRuntimeEngine;');
const world={
 ResourceEngine,
 globalThis:null,
 UnitTraitEngine:{transformedSkill:(_u,skill)=>skill,resourceKey:()=>null,afterCommittedSkill:()=>{},initialize:()=>{},status:()=>null},
 ColinShieldMobilityEngine:{shieldOccupied:()=>false},
 SkillDatabase:{passiveList:()=>[]}
};
world.globalThis=world;
vm.runInNewContext(text,world,{filename:'unit-runtime-engine.js'});
const runtime=world.UnitRuntimeEngine;
function alchemist(){const u={id:'ALC',alive:true,moved:false,acted:false,waited:false,character:{id:'alchemist',alchemyHarvest:true,resourceRules:{mana:false,alchemyRune:{label:'煉成紋路',max:3,initial:0,naturalRecovery:0}}}};ResourceEngine.syncMana(u,{initialize:true});ResourceEngine.sync(u,{initialize:true});return u;}
const base={id:'alchemy_bomb',category:'MAGIC',manaCost:0,alchemyCast:{mode:'BASIC'},materialCost:{kind:'MINERAL',quality:'NORMAL',affinity:'NONE',amount:1}};
const fire={...base,materialCost:{kind:'MINERAL',quality:'HIGH',affinity:'FIRE',amount:1}};
const terrain={id:'alchemy_terrain',category:'MAGIC',manaCost:0,alchemyCast:{mode:'TERRAIN'}};

test('alchemy is denied before any matching material; ordinary MP is zero',()=>{
 const u=alchemist();assert.equal(u.maxMana,0);
 assert.equal(runtime.canUseSkill(u,base),false);
 assert.equal(runtime.consumeSkill(u,base),null);
 assert.equal(ResourceEngine.value(u,'alchemyRune'),0);
});
test('one selected high quality fire mineral alone pays and charges one rune',()=>{
 const u=alchemist();
 assert.equal(ResourceEngine.changeMaterial(u,{kind:'MINERAL',quality:'HIGH',affinity:'FIRE',amount:1}),true);
 assert.equal(runtime.canUseSkill(u,fire),true);
 const receipt=runtime.consumeSkill(u,fire);assert.ok(receipt);
 assert.equal(receipt.material.quality,'HIGH');assert.equal(receipt.material.affinity,'FIRE');
 assert.equal(ResourceEngine.materialCount(u,'MINERAL','HIGH','FIRE'),0);
 assert.equal(ResourceEngine.materialCount(u,'MINERAL','NORMAL','NONE'),0);
 assert.equal(ResourceEngine.value(u,'alchemyRune'),1);
 assert.equal(runtime.canUseSkill(u,fire),false);
});
test('ordinary material cannot pay a high-quality variant (and vice versa)',()=>{
 const u=alchemist();ResourceEngine.changeMaterial(u,{kind:'MINERAL',amount:1});
 assert.equal(runtime.canUseSkill(u,fire),false);
 assert.equal(runtime.canUseSkill(u,base),true);
 const spent=runtime.consumeSkill(u,base);assert.ok(spent);assert.equal(ResourceEngine.materialCount(u,'MINERAL'),0);
 assert.equal(ResourceEngine.value(u,'alchemyRune'),1);
});
test('three basic casts fill one rune, terrain consumes 3/3 and no material',()=>{
 const u=alchemist();ResourceEngine.changeMaterial(u,{kind:'MINERAL',amount:4});
 for(let i=0;i<3;i++)assert.ok(runtime.consumeSkill(u,base));
 assert.equal(ResourceEngine.value(u,'alchemyRune'),3);
 assert.ok(runtime.canUseSkill(u,terrain));
 const before=ResourceEngine.materialCount(u,'MINERAL');
 assert.ok(runtime.consumeSkill(u,terrain));
 assert.equal(ResourceEngine.value(u,'alchemyRune'),0);
 assert.equal(ResourceEngine.materialCount(u,'MINERAL'),before);
 assert.equal(runtime.canUseSkill(u,terrain),false);
});
test('a full rune does not overflow when casting a fourth ordinary spell',()=>{
 const u=alchemist();ResourceEngine.changeMaterial(u,{kind:'MINERAL',amount:4});
 for(let i=0;i<4;i++)assert.ok(runtime.consumeSkill(u,base));
 assert.equal(ResourceEngine.value(u,'alchemyRune'),3);
});
test('non-alchemist cannot use alchemy by forging a material inventory',()=>{
 const u=alchemist();u.character.alchemyHarvest=false;
 ResourceEngine.changeMaterial(u,{kind:'MINERAL',amount:2});
 assert.equal(runtime.canUseSkill(u,base),false);
 assert.equal(runtime.canUseSkill(u,terrain),false);
});
test('invalid amount / missing declared material prevents spending and rune gain',()=>{
 const u=alchemist();ResourceEngine.changeMaterial(u,{kind:'MINERAL',amount:2});
 const invalid={...base,materialCost:{kind:'MINERAL',quality:'NORMAL',affinity:'NONE'}};
 assert.equal(runtime.canUseSkill(u,invalid),false);
 assert.equal(runtime.consumeSkill(u,invalid),null);
 assert.equal(ResourceEngine.materialCount(u,'MINERAL'),2);
 assert.equal(ResourceEngine.value(u,'alchemyRune'),0);
});
test('parent menu checks all material choices but cannot cast without explicit selection',()=>{
 const u=alchemist();
 const parent={id:'alchemy_bomb',category:'MAGIC',manaCost:0,alchemyCast:{mode:'BASIC'},variants:[
   {id:'NORMAL',materialCost:{kind:'MINERAL',quality:'NORMAL',affinity:'NONE',amount:1}},
   {id:'FIRE',materialCost:{kind:'MINERAL',quality:'HIGH',affinity:'FIRE',amount:1}}
 ]};
 ResourceEngine.changeMaterial(u,{kind:'MINERAL',quality:'HIGH',affinity:'FIRE',amount:1});
 assert.equal(runtime.canUseSkill(u,parent),true);
 assert.equal(runtime.consumeSkill(u,parent),null);
 assert.equal(runtime.consumeSkill(u,{...parent,...parent.variants[1],variants:undefined,variantId:'FIRE'}).material.affinity,'FIRE');
 assert.equal(ResourceEngine.materialCount(u,'MINERAL','HIGH','FIRE'),0);
});
test('authored material amount is checked, not silently hardcoded to one',()=>{
 const u=alchemist(),craft={...base,materialCost:{kind:'MINERAL',quality:'NORMAL',affinity:'NONE',amount:2}};
 ResourceEngine.changeMaterial(u,{kind:'MINERAL',amount:1});
 assert.equal(runtime.canUseSkill(u,craft),false);
 ResourceEngine.changeMaterial(u,{kind:'MINERAL',amount:1});
 assert.equal(runtime.canUseSkill(u,craft),true);
 assert.ok(runtime.consumeSkill(u,craft));
 assert.equal(ResourceEngine.materialCount(u,'MINERAL'),0);
});
test('ultimate refuses additional MP, materials or duplicate scalar-resource costs',()=>{
 const u=alchemist();ResourceEngine.change(u,'alchemyRune',3);
 for(const invalid of [{...terrain,manaCost:1},{...terrain,resourceCosts:{alchemyRune:3}},{...terrain,materialCost:{kind:'MINERAL',quality:'NORMAL',affinity:'NONE',amount:1}}]){
   assert.equal(runtime.canUseSkill(u,invalid),false);
   assert.equal(runtime.consumeSkill(u,invalid),null);
 }
 assert.equal(ResourceEngine.value(u,'alchemyRune'),3);
});

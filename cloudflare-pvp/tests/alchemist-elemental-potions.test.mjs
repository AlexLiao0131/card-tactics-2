import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {ResourceEngine} from '../../js/resource-engine.js';
import {createEffectEngine} from '../../js/effect-engine.js';
import {WaterInteractionEngine} from '../../js/battle-environment-controller.js';
import {readFileSync} from 'node:fs';

const engine=createEffectEngine({random:()=>.999});
globalThis.EffectEngine=engine;
const unit=()=>({id:'t',team:'P',alive:true,hp:130,
  character:{id:'tester',combat:{hp:220,atk:10,matk:10,def:10,mdef:10,move:3},attributes:{},modifiers:{},passives:[]},effects:[]});
const cast=(u,id,form)=>{const s=SkillDatabase.resolveVariant(id,form);for(const e of s.effects||[]){const result=engine.apply({source:u,target:u,effect:e});assert.equal(result.applied,true,`${s.name} ${e.type}: ${result.reason}`);}return s;};
const negative=(id,type='BUFF')=>({id,type,name:id,classification:'NEGATIVE',duration:2,modifiers:{evasion:-3}});
const burn={id:'BURN',type:'DAMAGE_OVER_TIME',classification:'NEGATIVE',duration:2,amount:10};
const poison={id:'POISON',type:'DAMAGE_OVER_TIME',classification:'NEGATIVE',duration:2,amount:9};
const iceSlow=negative('ALCH_ICE_SLOW');

test('all three canonical potions have 9 real recipes and retain one authentic ingredient each',()=>{
 const families=[['alchemy_healing_potion','HERB'],['alchemy_power_potion','WOOD'],['alchemy_hard_shell_potion','MINERAL']];
 for(const [id,kind] of families){const parent=SkillDatabase.get(id);assert.equal(parent.variants.length,9);
  for(const v of parent.variants){const r=SkillDatabase.resolveVariant(id,v.id);
   assert.equal(r.materialCost.kind,kind);assert.equal(r.materialCost.amount,1);
   assert.equal(r.alchemyCast.mode,'BASIC');assert.ok(r.name.includes('藥'),r.name);
  }
 }
});
test('water hard-shell quenches only burn, then gives real water walk and unchanged water-film shield',()=>{
 const u=unit();engine.apply({target:u,effect:burn});engine.apply({target:u,effect:poison});
 const s=cast(u,'alchemy_hard_shell_potion','HIGH_WATER');
 assert.equal(s.materialCost.affinity,'WATER');assert.equal(engine.hasEffect(u,'BURN'),false);
 assert.equal(engine.hasEffect(u,'POISON'),true);assert.equal(WaterInteractionEngine.activeWaterRules(u).waterWalk,true);
 assert.equal(s.effects.find(e=>e.type==='SHIELD').amount,25);
 engine.removeEffectById(u,'ALCH_ARMOR');
 assert.equal(WaterInteractionEngine.activeWaterRules(u).waterWalk,false);
});
test('healing water removes burning without deleting poison or bleeding',()=>{
 const u=unit();engine.apply({target:u,effect:burn});engine.apply({target:u,effect:poison});
 const s=cast(u,'alchemy_healing_potion','HIGH_WATER');
 assert.ok(s.effects.some(e=>e.type==='DISPEL'&&e.statusIds[0]==='BURN'));
 assert.equal(engine.hasEffect(u,'BURN'),false);assert.equal(engine.hasEffect(u,'POISON'),true);
 assert.equal(u.hp,195);
});
test('healing thunder removes an existing stun, not unrelated negative DOT',()=>{
 const u=unit();engine.apply({target:u,effect:negative('STUN','STUN')});engine.apply({target:u,effect:poison});
 cast(u,'alchemy_healing_potion','HIGH_THUNDER');
 assert.equal(engine.hasEffect(u,'STUN'),false);assert.equal(engine.hasEffect(u,'POISON'),true);
});
test('healing holy retains full canonical cleanse plus original 2-turn regen',()=>{
 const u=unit();engine.apply({target:u,effect:negative('STUN','STUN')});engine.apply({target:u,effect:poison});
 cast(u,'alchemy_healing_potion','HIGH_HOLY');
 assert.equal(engine.hasEffect(u,'STUN'),false);assert.equal(engine.hasEffect(u,'POISON'),false);
 assert.equal(engine.hasEffect(u,'ALCH_HOLY_REGEN'),true);
});
test('ice hard-shell wards only ICE-typed external damage and declared ice slow',()=>{
 const u=unit();cast(u,'alchemy_hard_shell_potion','HIGH_ICE');
 assert.equal(engine.applyDamage(u,27,{damageType:'ICE'}).hpLoss,0);
 assert.equal(engine.apply({target:u,effect:iceSlow}).reason,'ALCHEMY_STATUS_WARD');
 assert.equal(engine.applyDamage(u,27,{damageType:'THUNDER'}).hpLoss,27);
 engine.removeEffectById(u,'ALCH_ARMOR_ICE');
 assert.equal(engine.apply({target:u,effect:iceSlow}).applied,true);
});
test('thunder hard-shell blocks THUNDER-typed external lightning and new stun',()=>{
 const u=unit();cast(u,'alchemy_hard_shell_potion','HIGH_THUNDER');
 assert.equal(engine.applyDamage(u,35,{kind:'EXTERNAL',damageType:'THUNDER'}).hpLoss,0);
 assert.equal(engine.apply({target:u,effect:negative('STUN','STUN')}).reason,'ALCHEMY_STATUS_WARD');
 assert.equal(engine.applyDamage(u,21,{kind:'EXTERNAL',damageType:'FIRE'}).hpLoss,21);
 engine.removeEffectById(u,'ALCH_ARMOR_THUNDER');
 assert.equal(engine.apply({target:u,effect:negative('STUN','STUN')}).applied,true);
});
test('fire hard-shell keeps real BURN ward without granting universal immunity',()=>{
 const u=unit();cast(u,'alchemy_hard_shell_potion','HIGH_FIRE');
 assert.equal(engine.apply({target:u,effect:burn}).reason,'FIRE_WARD');
 assert.equal(engine.applyDamage(u,20,{damageType:'FIRE'}).hpLoss,0);
 assert.equal(engine.applyDamage(u,20,{damageType:'THUNDER'}).hpLoss,20);
});
test('holy hard-shell purifies poison and retains original shield amount',()=>{
 const u=unit();engine.apply({target:u,effect:poison});
 const s=cast(u,'alchemy_hard_shell_potion','HIGH_HOLY');
 assert.equal(engine.hasEffect(u,'POISON'),false);
 assert.equal(s.effects.find(e=>e.type==='SHIELD').amount,42);
});
test('dark hard-shell blocks exactly one negative effect without wasting a Saint Grace charge',()=>{
 const u=unit();cast(u,'alchemy_hard_shell_potion','HIGH_DARK');
 assert.equal(engine.apply({target:u,effect:iceSlow}).reason,'NEGATIVE_EFFECT_GUARD');
 assert.equal(engine.hasEffect(u,'ALCH_ARMOR_DARK'),false);
 assert.equal(engine.apply({target:u,effect:iceSlow}).applied,true);
});
test('water power potion reads official WaterInteractionEngine rules for two turns',()=>{
 const u=unit();cast(u,'alchemy_power_potion','HIGH_WATER');
 assert.equal(WaterInteractionEngine.activeWaterRules(u).waterWalk,true);
 const s=SkillDatabase.resolveVariant('alchemy_power_potion','HIGH_WATER');
 assert.equal(s.effects.find(e=>e.id==='ALCH_POWER_WATER').modifiers.evasion,9);
 engine.removeEffectById(u,'ALCH_POWER_WATER');
 assert.equal(WaterInteractionEngine.activeWaterRules(u).waterWalk,false);
});
test('thunder power potion really blocks THUNDER damage and keeps original accuracy bonus',()=>{
 const u=unit();cast(u,'alchemy_power_potion','HIGH_THUNDER');
 assert.equal(engine.applyDamage(u,24,{damageType:'THUNDER'}).hpLoss,0);
 assert.equal(u.character.modifiers.accuracy,16);
 engine.removeEffectById(u,'ALCH_POWER_THUNDER');
 assert.equal(engine.applyDamage(u,24,{damageType:'THUNDER'}).hpLoss,24);
});
test('poison, internal bleed, and non-explicit magic damage are NOT globally nullified',()=>{
 const u=unit();cast(u,'alchemy_hard_shell_potion','HIGH_THUNDER');
 assert.equal(engine.apply({target:u,effect:poison}).applied,true);
 assert.equal(engine.applyDamage(u,13,{kind:'INTERNAL',damageType:'THUNDER'}).hpLoss,13);
 assert.equal(engine.applyDamage(u,10,{kind:'EXTERNAL',damageType:'MAGIC'}).hpLoss,10);
});
test('elemental effect previews report their real mechanic, not just a material recipe',()=>{
 for(const [id,form,expected] of [
  ['alchemy_hard_shell_potion','HIGH_THUNDER','外部元素防護 THUNDER'],
  ['alchemy_power_potion','HIGH_WATER','水上行走'],
  ['alchemy_hard_shell_potion','HIGH_DARK','擋下一次負面狀態'],
  ['alchemy_healing_potion','HIGH_WATER','解除指定狀態：燃燒']
 ]){
  const s=SkillDatabase.resolveVariant(id,form);
  const inspection=SkillDatabase.inspect(s);
  assert.ok(inspection.mechanics.join(' ').includes(expected),`${s.name} missing ${expected}: ${inspection.mechanics}`);
 }
});
test('both actual browser lightning paths carry THUNDER tag; boiling is unchanged',()=>{
 const src=readFileSync(new URL('../../js/battle-environment-controller.js',import.meta.url),'utf8');
 assert.match(src,/水體雷電傳導/);
 assert.match(src,/damageType:"THUNDER"/);
 assert.match(src,/落雷擊中/);
 assert.match(src,/沸騰水域/);
});
test('one natural mineral serves either explosion or hard-shell, single debit still authoritative',()=>{
 const bomb=SkillDatabase.resolveVariant('alchemy_explosion','HIGH_THUNDER');
 const shell=SkillDatabase.resolveVariant('alchemy_hard_shell_potion','HIGH_THUNDER');
 assert.deepEqual(bomb.materialCost,shell.materialCost);
 const u={};assert.equal(ResourceEngine.changeMaterial(u,{...shell.materialCost,amount:1}),true);
 assert.ok(ResourceEngine.hasMaterial(u,bomb.materialCost));
 assert.equal(ResourceEngine.changeMaterial(u,{...shell.materialCost,amount:-1}),true);
 assert.equal(ResourceEngine.hasMaterial(u,bomb.materialCost),false);
});

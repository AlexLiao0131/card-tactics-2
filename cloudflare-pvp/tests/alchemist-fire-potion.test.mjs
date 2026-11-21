import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {createEffectEngine} from '../../js/effect-engine.js';
const engine=createEffectEngine({random:()=>1});
const spell=SkillDatabase.resolveVariant('alchemy_hard_shell_potion','HIGH_FIRE');
const unit=()=>({id:'target',team:'P',alive:true,hp:200,
  character:{id:'tester',combat:{hp:200,atk:10,matk:10,def:10,mdef:10,move:3},attributes:{},modifiers:{},passives:[]},effects:[]});
const ignite={type:'DAMAGE_OVER_TIME',id:'BURN',name:'燃燒',classification:'NEGATIVE',duration:2,amount:12};
const explosiveBurn={type:'DAMAGE_OVER_TIME',id:'ALCH_FIRE_BURN',name:'煉成燃燒',classification:'NEGATIVE',duration:2,amount:11};
const toxin={type:'DAMAGE_OVER_TIME',id:'POISON',name:'中毒',classification:'NEGATIVE',duration:2,amount:6};
function castFirePotion(u){return spell.effects.map(effect=>engine.apply({target:u,source:u,effect}));}
test('high-fire hard-shell is a real fire potion and keeps one high FIRE mineral as ingredient',()=>{
 assert.equal(spell.name,'防火藥劑');
 assert.deepEqual(spell.materialCost,{kind:'MINERAL',quality:'HIGH',affinity:'FIRE',amount:1});
 assert.equal(spell.effects.find(x=>x.id==='ALCH_ARMOR_FIRE')?.fireWard,true);
 assert.ok(spell.effects.find(x=>x.id==='ALCH_ARMOR_FIRE')?.modifiers?.mdef>0);
});
test('fire potion extinguishes active BURN and does not remove POISON',()=>{
 const u=unit();assert.equal(engine.apply({target:u,effect:ignite}).applied,true);
 assert.equal(engine.apply({target:u,effect:toxin}).applied,true);
 assert.equal(engine.hasEffect(u,'BURN'),true);
 assert.equal(castFirePotion(u).every(x=>x.applied),true);
 assert.equal(engine.hasEffect(u,'BURN'),false);
 assert.equal(engine.hasEffect(u,'POISON'),true);
});
test('ward stops burning status and alchemical fire DOT before consuming another effect guard',()=>{
 const u=unit();castFirePotion(u);
 assert.equal(engine.apply({target:u,effect:ignite}).reason,'FIRE_WARD');
 assert.equal(engine.apply({target:u,effect:explosiveBurn}).reason,'FIRE_WARD');
 assert.equal(engine.apply({target:u,effect:toxin}).applied,true);
});
test('fire terrain damage is blocked only while potion is active; normal and other damage is not',()=>{
 const u=unit();castFirePotion(u);
 assert.equal(engine.applyDamage(u,25,{damageType:'FIRE'}).hpLoss,0);
 assert.equal(engine.applyDamage(u,25,{damageType:'FIRE'}).fireWard,true);
 assert.equal(engine.applyDamage(u,25,{damageType:'PHYSICAL'}).hpLoss,25);
 assert.equal(engine.applyDamage(u,25,{damageType:'THUNDER'}).hpLoss,25);
 engine.removeEffectById(u,'ALCH_ARMOR_FIRE');
 assert.equal(engine.applyDamage(u,25,{damageType:'FIRE'}).hpLoss,25);
});
test('expired or dispelled potion no longer blocks ignition',()=>{
 const u=unit();castFirePotion(u);
 u.effects.find(e=>e.id==='ALCH_ARMOR_FIRE').remaining=0;
 assert.equal(engine.apply({target:u,effect:ignite}).applied,true);
});

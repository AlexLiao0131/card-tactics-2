import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const folder=path.resolve(import.meta.dirname,'../../js');
const {BattleEngine}=await import(pathToFileURL(path.join(folder,'battle-engine.js')));
globalThis.BattleEngine=BattleEngine;
globalThis.SkillDatabase={getPassive:(id)=>id==='PATIENT'?{bloodRestoration:{values:{str:20,agi:20,int:20,wil:20,vit:20}}}:null,passiveList:()=>[]};
globalThis.UnitRuntimeEngine={humidityMdefBonus:()=>0,syncMana:(u)=>{
  const a=u.character.attributes;u.maxMana=u.character.resourceRules?.mana===false?0:Math.round(40+2*a.int+2*a.wil);
  u.mana=Math.max(0,Math.min(u.mana??u.maxMana,u.maxMana));
}};
globalThis.UnitTraitEngine={statBonus:()=>0};
const {EffectEngine}=await import(pathToFileURL(path.join(folder,'effect-engine.js')));
function make({id='unit',attributes={str:13,agi:18,int:20,wil:20,vit:14,luk:16},combat={hp:235,atk:78,matk:102,def:57,mdef:94,move:5},blood=false,form='HUMAN',forms=null,passives=[]}={}){
 const unit={id,hp:combat.hp,mana:120,character:{id,attributes:{...attributes},combat:{...combat},passives:[...passives],resourceRules:{mana:true},modifiers:{},...(forms?{forms}:{} )},effects:[],alive:true};
 if(forms){unit.currentForm=form;unit._originalFormProfile={move:combat.move};}
 if(blood)unit._bloodAwakened=true;
 return unit;
}
let n=0;const test=(name,fn)=>{const out=fn(); if(out&&typeof out.then==='function'){return out.then(()=>{n++;console.log('PASS',name)});} n++;console.log('PASS',name);};
test('all default sixdims produce exactly the existing baseline character data',()=>{
  const roster=[
   {attributes:{str:13,agi:18,int:20,wil:20,vit:14,luk:16},combat:{hp:235,atk:78,matk:102,def:57,mdef:94,move:5}},
   {attributes:{str:20,agi:20,int:8,wil:14,vit:20,luk:12},combat:{hp:285,atk:108,matk:20,def:74,mdef:59,move:5}},
   {attributes:{str:18,agi:19,int:17,wil:16,vit:15,luk:14},combat:{hp:245,atk:104,matk:78,def:64,mdef:72,move:5}},
   {attributes:{str:20,agi:20,int:20,wil:20,vit:20,luk:16},combat:{hp:210,atk:94,matk:90,def:55,mdef:90,move:5}},
  ];
  for(const c of roster){const projected=BattleEngine.deriveCombatFromAttributes(c.combat,c.attributes,c.attributes);assert.deepEqual(projected,c.combat);const u=make(c);EffectEngine.syncModifiers(u);assert.deepEqual(u.character.combat,c.combat);}
});
test('changes in STR, INT, WIL and VIT map to the right existing combat fields',()=>{
 const u=make();u.effects.push({type:'ATTRIBUTE_MODIFIER',values:{str:2,int:-5,wil:-2,vit:4}});EffectEngine.syncModifiers(u);
 assert.equal(u.character.combat.atk,Math.round(78*15/13));
 assert.equal(u.character.combat.matk,Math.round(102*15/20));
 assert.equal(u.character.combat.mdef,Math.round(94*18/20));
 assert.equal(u.character.combat.def,Math.round(57*18/14));
 assert.equal(u.character.combat.hp,Math.round(235*18/14));
 assert.equal(u.hp,235); // maximum may grow, but no auto-heal
});
test('VIT reduction clamps current HP, reversing does not heal',()=>{
 const u=make();u.hp=230;u.effects.push({type:'ATTRIBUTE_MODIFIER',values:{vit:-8}});EffectEngine.syncModifiers(u);
 assert.equal(u.character.combat.hp,Math.round(235*6/14));assert.equal(u.hp,u.character.combat.hp);
 u.effects.length=0;EffectEngine.syncModifiers(u);assert.equal(u.character.combat.hp,235);assert.ok(u.hp<235);
});
test('temporary combat buffs add exactly once; refreshes do not stack',()=>{
 const u=make();u.effects.push({type:'ATTRIBUTE_MODIFIER',values:{str:2,vit:2},modifiers:{atk:8,def:10}});
 for(let k=0;k<50;k++) {EffectEngine.syncModifiers(u);assert.equal(u.character.combat.atk,Math.round(78*15/13)+8);assert.equal(u.character.combat.def,Math.round(57*16/14)+10);}
 u.effects.length=0;EffectEngine.syncModifiers(u);assert.equal(u.character.combat.atk,78);assert.equal(u.character.combat.def,57);
});
test('5V awakening modifies all physical/magical core stats and returns exactly to original',()=>{
 const u=make({id:'seraphina',attributes:{str:18,agi:19,int:17,wil:16,vit:15,luk:14},combat:{hp:245,atk:104,matk:78,def:64,mdef:72,move:5}});
 u.hp=150;u._bloodAwakened=true;EffectEngine.syncModifiers(u);
 assert.deepEqual(Object.fromEntries(['str','agi','int','wil','vit'].map(k=>[k,u.character.attributes[k]])),{str:20,agi:20,int:20,wil:20,vit:20});
 assert.equal(u.character.combat.atk,Math.round(104*20/18));
 assert.equal(u.character.combat.matk,Math.round(78*20/17));
 assert.equal(u.character.combat.mdef,Math.round(72*20/16));
 assert.equal(u.character.combat.hp,Math.round(245*20/15));
 assert.equal(u.hp,150);assert.equal(u.maxMana,40+2*20+2*20);
 u._bloodAwakened=false;EffectEngine.syncModifiers(u);
 assert.equal(u.character.combat.atk,104);assert.equal(u.character.combat.hp,245);assert.equal(u.hp,150);
});
test('AGI and LUK modify known official combat maths without new coefficients',()=>{
 const u=make();const other=make({id:'foe'});
 const skill={power:1,attackType:'SLASH',element:'NONE',weapon:'sword'};
 u.character.weapons={sword:{attackType:'SLASH',element:'NONE'}};
 other.character.armor={type:'LIGHT',element:'NONE'};
 const before=BattleEngine.hitChance(u.character,other.character,skill);
 u.effects.push({type:'ATTRIBUTE_MODIFIER',values:{agi:2,luk:3}});EffectEngine.syncModifiers(u);
 assert.equal(BattleEngine.hitChance(u.character,other.character,skill),before+4);
 assert.equal(BattleEngine.critChance(u.character,skill),5+(16+3)*.5);
});
test('shape movement modifier survives repeated status sync and deforms only once',()=>{
 const forms={HUMAN:{movementModifier:0},CHEETAH:{movementModifier:1},SEAL:{movementModifier:-2},RAVEN:{movementModifier:2}};
 const u=make({forms,form:'CHEETAH'});
 for(let k=0;k<30;k++){EffectEngine.syncModifiers(u);assert.equal(u.character.combat.move,6)}
 u.effects.push({type:'BUFF',modifiers:{move:2}});EffectEngine.syncModifiers(u);assert.equal(u.character.combat.move,8);
 u.currentForm='SEAL';EffectEngine.syncModifiers(u);assert.equal(u.character.combat.move,5);
 u.effects.length=0;EffectEngine.syncModifiers(u);assert.equal(u.character.combat.move,3);
 u.currentForm='HUMAN';EffectEngine.syncModifiers(u);assert.equal(u.character.combat.move,5);
});
test('all same-base stat derivations are pure and do not mutate the profile',()=>{
 const a={str:20,int:20,vit:20,wil:20};const c={hp:200,atk:100,matk:100,def:50,mdef:60,move:4};
 const serialized=JSON.stringify({a,c});for(let k=0;k<500;k++)BattleEngine.deriveCombatFromAttributes(c,a,{str:19,int:13,vit:12,wil:18});assert.equal(JSON.stringify({a,c}),serialized);
});
await test('all existing 2026-11-18 prototype roster entries preserve their original combat baseline',async()=>{
  const {CHARACTERS}=await import(pathToFileURL(path.join(folder,'character-database.js')));
  let checked=0;
  for(const c of Object.values(CHARACTERS)){
    if(!c?.attributes||!c?.combat)continue;
    const source=JSON.stringify(c.combat);
    const unit=make({id:c.id,attributes:c.attributes,combat:c.combat});
    EffectEngine.syncModifiers(unit);
    assert.deepEqual(unit.character.combat,c.combat,c.id);
    assert.equal(JSON.stringify(c.combat),source);
    checked++;
  }
  assert.ok(checked>=30,`roster too small: ${checked}`);
  console.log('    roster size',checked);
});
await test('PvP room instance and browser singleton generate identical derived combat states',()=>{
  const a=make(),b=make();
  a.effects.push({type:'ATTRIBUTE_MODIFIER',values:{str:2,vit:3,int:1,wil:-3},modifiers:{atk:7,def:9,move:1}});
  b.effects.push(JSON.parse(JSON.stringify(a.effects[0])));
  EffectEngine.syncModifiers(a);
  // Worker owns a separately created instance of precisely the same module.
  b.effects.push({type:'ATTRIBUTE_OVERRIDE',values:{agi:17}});
  a.effects.push({type:'ATTRIBUTE_OVERRIDE',values:{agi:17}});
  // Asserting a second official effect-engine instance, not a custom wrapper.
  globalThis.EffectEngine.syncModifiers(a);
  // Loaded from exported factory rather than relying on global singleton.
  return import(pathToFileURL(path.join(folder,'effect-engine.js'))).then(({createEffectEngine})=>{
    const isolated=createEffectEngine({random:()=>0.5});
    isolated.syncModifiers(b);
    assert.deepEqual(a.character.combat,b.character.combat);
    assert.deepEqual(a.character.attributes,b.character.attributes);
  });
});
console.log('PASSED',n,'suite checks');

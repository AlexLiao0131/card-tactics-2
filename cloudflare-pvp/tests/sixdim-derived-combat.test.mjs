import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {BattleEngine}=await import(path.join(root,'js/battle-engine.js'));
const {CHARACTERS}=await import(path.join(root,'js/character-database.js'));
globalThis.BattleEngine=BattleEngine;
globalThis.SkillDatabase={getPassive:id=>id==='PATIENT'?{bloodRestoration:{values:{str:20,agi:20,int:20,wil:20,vit:20}}}:null,passiveList:ids=>ids?.includes('AVRESHI_BARKSKIN')?[{physicalDefenseBonusRatio:.2}]:[]};
globalThis.UnitRuntimeEngine={humidityMdefBonus:()=>0,syncMana:u=>{const a=u.character.attributes;u.maxMana=u.character.resourceRules?.mana===false?0:40+2*a.int+2*a.wil;u.mana=Math.max(0,Math.min(u.mana??u.maxMana,u.maxMana));}};
globalThis.UnitTraitEngine={statBonus:()=>0};
const {EffectEngine,createEffectEngine}=await import(path.join(root,'js/effect-engine.js'));
const historic={"magda":{"hp":285,"atk":108,"matk":20,"def":74,"mdef":59,"move":5},"livia":{"hp":210,"atk":94,"matk":90,"def":55,"mdef":90,"move":5},"leon":{"hp":260,"atk":100,"matk":35,"def":75,"mdef":58,"move":4},"kahn":{"hp":225,"atk":96,"matk":42,"def":58,"mdef":65,"move":5},"cassandra":{"hp":195,"atk":38,"matk":105,"def":40,"mdef":95,"move":4},"imperial_swordsman":{"hp":240,"atk":78,"matk":28,"def":68,"mdef":44,"move":4},"imperial_spearman":{"hp":235,"atk":76,"matk":24,"def":62,"mdef":42,"move":4},"imperial_archer":{"hp":205,"atk":72,"matk":28,"def":48,"mdef":45,"move":4},"imperial_heavy_guard":{"hp":300,"atk":80,"matk":24,"def":95,"mdef":52,"move":3},"imperial_hammer":{"hp":260,"atk":84,"matk":24,"def":70,"mdef":44,"move":3},"imperial_mage":{"hp":190,"atk":35,"matk":88,"def":38,"mdef":68,"move":4},"imperial_cavalry":{"hp":255,"atk":86,"matk":24,"def":68,"mdef":45,"move":7},"forest_beast":{"hp":240,"atk":70,"matk":20,"def":50,"mdef":40,"move":4},"unarmored_dummy":{"hp":220,"atk":40,"matk":20,"def":30,"mdef":30,"move":0},"water_guard_test":{"hp":250,"atk":65,"matk":45,"def":65,"mdef":70,"move":4},"elf_guard_test":{"hp":250,"atk":76,"matk":62,"def":72,"mdef":78,"move":5},"avreshi":{"hp":235,"atk":78,"matk":102,"def":57,"mdef":94,"move":5},"reina":{"hp":255,"atk":96,"matk":68,"def":78,"mdef":82,"move":5},"elf_shapeshifter":{"hp":230,"atk":76,"matk":70,"def":52,"mdef":70,"move":5},"elf_ranger":{"hp":225,"atk":82,"matk":52,"def":64,"mdef":65,"move":5},"elf_guard":{"hp":295,"atk":82,"matk":45,"def":96,"mdef":76,"move":4},"elf_priest":{"hp":205,"atk":42,"matk":92,"def":46,"mdef":88,"move":5},"ophi":{"hp":225,"atk":98,"matk":88,"def":60,"mdef":88,"move":5},"ophi_eagle":{"hp":90,"atk":0,"matk":0,"def":28,"mdef":45,"move":7},"colin":{"hp":310,"atk":98,"matk":60,"def":92,"mdef":80,"move":4},"church_apprentice":{"hp":230,"atk":74,"matk":35,"def":62,"mdef":52,"move":4},"church_heavy_knight":{"hp":300,"atk":82,"matk":38,"def":96,"mdef":62,"move":3},"church_templar":{"hp":285,"atk":90,"matk":60,"def":90,"mdef":78,"move":4},"church_bishop":{"hp":205,"atk":40,"matk":94,"def":45,"mdef":92,"move":4},"church_templar_hero":{"hp":320,"atk":108,"matk":82,"def":104,"mdef":92,"move":4},"church_saint":{"hp":215,"atk":42,"matk":110,"def":48,"mdef":108,"move":4},"seraphina":{"hp":245,"atk":104,"matk":78,"def":64,"mdef":72,"move":5},"water_lurker":{"hp":360,"atk":88,"matk":42,"def":66,"mdef":64,"move":3},"nereia":{"hp":300,"atk":100,"matk":100,"def":82,"mdef":96,"move":4},"cat_thief_hero":{"hp":220,"atk":100,"matk":42,"def":54,"mdef":52,"move":6},"angel_archer_hero":{"hp":240,"atk":98,"matk":82,"def":58,"mdef":92,"move":5},"velsa":{"hp":245,"atk":44,"matk":112,"def":58,"mdef":104,"move":4}};
let checks=0;function check(title,fn){fn();checks++;console.log('PASS',title)}
function make(id='avreshi',options={}){
 const c=CHARACTERS[id];const character=structuredClone(c);
 const unit={id,alive:true,hp:character.combat.hp,mana:100,effects:[],character,...options};
 if(character.forms&&character.forms.HUMAN){unit.currentForm='HUMAN';unit._originalFormProfile={move:character.combat.move};}
 return unit;
}
const simple=['hp','atk','matk','def','mdef'];
check('40 character entries + 37 independent baselines exactly preserved',()=>{
 assert.equal(Object.keys(CHARACTERS).length,40);assert.equal(Object.keys(historic).length,37);
 for(const [id,stats] of Object.entries(historic)){for(const [key,n] of Object.entries(stats))assert.equal(CHARACTERS[id].combat[key],n,`${id}.${key}`);}
 assert.equal(CHARACTERS.imperial_spearman_test,CHARACTERS.imperial_spearman);
 assert.equal(CHARACTERS.imperial_hammer_test,CHARACTERS.imperial_hammer);
 assert.equal(CHARACTERS.imperial_mage_test,CHARACTERS.imperial_mage);
});
check('no manually authored HP/ATK/MATK/DEF/MDEF source values remain',()=>{
 const source=fs.readFileSync(path.join(root,'js/character-database.js'),'utf8');
 assert.equal((source.match(/combat:\{hp:/g)||[]).length,0);
 assert.equal((source.match(/statAdjustments:\{/g)||[]).length,37);
});
check('six-attribute source is deterministic, pure, monotonic, finite for every role',()=>{
 for(const [id] of Object.entries(historic)){
  const c=CHARACTERS[id],before=JSON.stringify(c);
  const a=BattleEngine.deriveCombatFromAttributes(c.combat,c.attributes,c.attributes,c);
  assert.deepEqual(a,c.combat,id);
  for(const [dim,fields] of [['str',['atk']],['int',['matk']],['wil',['mdef']],['vit',['hp','def']]]){
   const changed=BattleEngine.deriveCombatFromAttributes(c.combat,c.attributes,{...c.attributes,[dim]:c.attributes[dim]+1},c);
   for(const key of fields)assert.ok(changed[key]>=a[key],`${id}/${dim}/${key}`);
   for(const key of simple.filter(x=>!fields.includes(x)))assert.equal(changed[key],a[key],`${id}/${dim} unexpectedly modified ${key}`);
  }
  assert.equal(JSON.stringify(c),before,`${id} mutated`);
 }
});
check('new character needs only archetype + sixdims + MOVE, no base-combat authoring',()=>{
 const c={id:'alchemist-test',archetype:'ALCHEMIST',statProfile:'CASTER',attributes:{str:8,agi:14,int:18,wil:16,vit:11,luk:17},combat:{move:5}};
 const out=BattleEngine.deriveCombatFromAttributes(c.combat,c.attributes,c.attributes,c);
 for(const key of simple)assert.ok(Number.isInteger(out[key])&&out[key]>0,`invalid ${key}`);
 assert.equal(out.move,5);
});
check('unknown archetype fails fast instead of silently guessed role',()=>{
 const a={str:10,int:10,wil:10,vit:10};
 assert.throws(()=>BattleEngine.deriveCombatFromAttributes({move:5},a,a,{archetype:'UNKNOWN_HERO'}),/UNMAPPED_STAT_ARCHETYPE/);
});
check('MP, AGI HIT/EVA ratings, LUK CRIT and action speed retain official formulas',()=>{
 let a=make('avreshi'),d=make('magda');
 assert.equal(BattleEngine.hitChance(a.character,d.character,{}),85+(18-20)*2);
 assert.equal(BattleEngine.critChance(a.character,{}),5+16*.5);
 assert.equal(BattleEngine.actionSpeed(a.character,{}),18*4);
 EffectEngine.syncModifiers(a);assert.equal(a.maxMana,40+2*20+2*20);
});
check('sixdim Buff is real combat delta, does not scale existing custom role bonus twice',()=>{
 const u=make();const c=u.character;
 const expected=BattleEngine.deriveCombatFromAttributes(c.combat,c.attributes,{...c.attributes,str:c.attributes.str+2,vit:c.attributes.vit+3},c);
 u.hp=200;u.effects.push({type:'ATTRIBUTE_MODIFIER',values:{str:2,vit:3}});EffectEngine.syncModifiers(u);
 assert.equal(u.character.combat.atk,expected.atk);assert.equal(u.character.combat.def,expected.def);
 assert.equal(u.character.combat.hp,expected.hp);assert.equal(u.hp,200);
 for(let i=0;i<200;i++)EffectEngine.syncModifiers(u);
 assert.equal(u.character.combat.atk,expected.atk);assert.equal(u.character.combat.hp,expected.hp);
 u.effects.length=0;EffectEngine.syncModifiers(u);
 for(const key of simple)assert.equal(u.character.combat[key],CHARACTERS.avreshi.combat[key]);
});
check('flat combat Buff once, derived + flat additive order retained',()=>{
 const u=make();u.effects=[{type:'ATTRIBUTE_MODIFIER',values:{vit:2,str:2},modifiers:{atk:8,def:10,mdef:7}}];
 const base=BattleEngine.deriveCombatFromAttributes(u.character.combat,u.character.attributes,{...u.character.attributes,vit:16,str:15},u.character);
 for(let j=0;j<50;j++){
  EffectEngine.syncModifiers(u);assert.equal(u.character.combat.atk,base.atk+8);
  assert.equal(u.character.combat.def,base.def+10);assert.equal(u.character.combat.mdef,base.mdef+7);
 }
});
check('VIT loss clamps current HP; expiration does not heal',()=>{
 const u=make('magda');u.hp=250;
 u.effects=[{type:'ATTRIBUTE_MODIFIER',values:{vit:-10}}];EffectEngine.syncModifiers(u);
 const newMax=u.character.combat.hp;assert.ok(newMax<285);assert.equal(u.hp,Math.min(250,newMax));
 u.effects=[];EffectEngine.syncModifiers(u);assert.equal(u.character.combat.hp,285);assert.equal(u.hp,Math.min(250,newMax));
});
check('original Druid permanent Barkskin DEF +20% survives attribute refresh',()=>{
 const u=make('avreshi');u.character.combat.def=Math.round(u.character.combat.def*1.2);
 u.effects=[{type:'ATTRIBUTE_MODIFIER',values:{vit:2}}];EffectEngine.syncModifiers(u);
 const shift=BattleEngine.deriveCombatFromAttributes(CHARACTERS.avreshi.combat,CHARACTERS.avreshi.attributes,{...CHARACTERS.avreshi.attributes,vit:16},CHARACTERS.avreshi).def-CHARACTERS.avreshi.combat.def;
 assert.equal(u.character.combat.def,Math.round((57+shift)*1.2));
});
check('Seraphina 5V awakening changes combat with canonical slope and restores baseline exactly',()=>{
 const u=make('seraphina');u._bloodAwakened=true;u.hp=180;
 EffectEngine.syncModifiers(u);
 const attrs={...CHARACTERS.seraphina.attributes,str:20,agi:20,int:20,wil:20,vit:20};
 const expected=BattleEngine.deriveCombatFromAttributes(CHARACTERS.seraphina.combat,CHARACTERS.seraphina.attributes,attrs,CHARACTERS.seraphina);
 for(const key of simple)assert.equal(u.character.combat[key],expected[key],key);
 assert.equal(u.character.attributes.luk,CHARACTERS.seraphina.attributes.luk);
 assert.equal(u.hp,180);assert.equal(u.maxMana,120);
 u._bloodAwakened=false;EffectEngine.syncModifiers(u);
 for(const key of simple)assert.equal(u.character.combat[key],CHARACTERS.seraphina.combat[key]);
});
check('Druid all 4 forms keep exact movement + status adjustment without stacking',()=>{
 const u=make('avreshi');const expected={HUMAN:5,CHEETAH:6,SEAL:3,RAVEN:7};
 for(const [name,m] of Object.entries(expected)){
  u.currentForm=name;
  for(let i=0;i<20;i++){EffectEngine.syncModifiers(u);assert.equal(u.character.combat.move,m);}
  u.effects=[{type:'BUFF',modifiers:{move:2}}];EffectEngine.syncModifiers(u);assert.equal(u.character.combat.move,m+2);
  u.effects=[];
 }
});
check('Magda rage character remains mana disabled with unchanged base stats',()=>{
 const u=make('magda');EffectEngine.syncModifiers(u);
 assert.equal(u.maxMana,0);assert.equal(u.character.combat.atk,108);
 assert.equal(u.character.combat.hp,285);
});
check('battle resolution expected damage/hit equality for baseline source values across all pairings',()=>{
 const ids=Object.keys(historic);
 for(const ia of ids){for(const ib of ids){
  const a=structuredClone(CHARACTERS[ia]),d=structuredClone(CHARACTERS[ib]);
  a.weapons={sword:{attackType:'SLASH',element:'NONE',affixes:[]}};
  d.armor={type:'MEDIUM',element:'NONE'};a.skills=['test'];
  const s={id:'test',weapon:'sword',power:1.1,attackType:'SLASH',element:'NONE'};
  const z=BattleEngine.calculate(a,d,s,{forceHit:true,disableCrit:true});
  assert.equal(z.damage,Math.round(Math.max(1,historic[ia].atk*1.1-historic[ib].def*.5)),`${ia} / ${ib}`);
 }}
});
check('PvP factory/singleplayer return exact same resulting derived combat',()=>{
 const a=make('seraphina'),b=make('seraphina');
 a.effects=[{type:'ATTRIBUTE_MODIFIER',values:{int:1,wil:-2,vit:2,str:1},modifiers:{atk:7,move:1}}];b.effects=structuredClone(a.effects);
 EffectEngine.syncModifiers(a);createEffectEngine({random:()=>.5}).syncModifiers(b);
 assert.deepEqual(a.character.combat,b.character.combat);assert.deepEqual(a.character.attributes,b.character.attributes);
});
console.log(`PASSED ${checks} cases; ${Object.keys(historic).length} baseline rows; ${Object.keys(historic).length**2} pairwise damage checks`);

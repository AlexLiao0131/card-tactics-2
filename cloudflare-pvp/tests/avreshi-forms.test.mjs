import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/terrain-database.js';
import '../../js/skill-database.js';
import '../../js/card-database.js';
import '../../js/character-database.js';
import '../../js/equipment-database.js';
import '../../js/companion-database.js';
import {LoadoutDatabase} from '../../js/loadout-database.js';
import '../../js/hydrology-engine.js';
import '../../js/effect-engine.js';
import '../../js/tactical-engine.js';
import '../../js/vertical-mobility-engine.js';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {VISUALS} from '../../js/visual-database.js';
import {VfxDatabase} from '../../js/vfx-database.js';
const map=()=>({width:6,height:6,tiles:Array.from({length:36},(_,i)=>({x:i%6,y:Math.floor(i/6),terrain:'PLAIN',elevation:0,waterDepth:0})),objects:[]});
const create=()=>{const m=map(),u=UnitRuntimeEngine.create({id:'a1',team:'P',characterId:'avreshi',x:2,y:2,map:m});return{m,u}};
test('艾芙蕾希資料庫與裝備依官方 Resolve 建立',()=>{
  assert.equal(LoadoutDatabase.validate(),true);
  const character=LoadoutDatabase.resolveCharacter('avreshi');
  assert.equal(character.race,'ELF');
  assert.equal(character.forms.default,'HUMAN');
  assert.equal(character.forms.available.length,4);
  assert.equal(globalThis.CardDatabase.get('avreshi_card').loadoutId,'avreshi_default');
});
test('四形態直接切換技能、行動與 HP 不重置',()=>{
  const {u}=create();const hp=u.hp;const mana=u.mana;
  assert.equal(u.currentForm,'HUMAN');
  assert.equal(UnitRuntimeEngine.canUseSkill(u,globalThis.SkillDatabase.get('avreshi_bite')),false);
  u.hp-=15;u.moved=true;
  assert(UnitRuntimeEngine.shiftForm(u,'CHEETAH'));
  assert(u.character.skills.includes('avreshi_bite'));
  assert(!u.character.skills.includes('avreshi_moonfire'));
  assert.equal(u.hp,hp-15);assert.equal(u.moved,true);assert.equal(u.mana,mana);
  assert(UnitRuntimeEngine.shiftForm(u,'SEAL'));
  assert(u.character.skills.includes('avreshi_dive'));
  assert(UnitRuntimeEngine.shiftForm(u,'RAVEN'));
  assert(u.character.skills.includes('avreshi_share_vision'));
  assert(!u.character.skills.includes('avreshi_wrath'));
  assert.equal(u.verticalState?.mode,'FLYING');
  assert(UnitRuntimeEngine.shiftForm(u,'HUMAN'));
  assert.equal(u.currentForm,'HUMAN');
  assert.equal(u.verticalState?.mode,'GROUND');
});
test('滿月增幅月火、半月增幅憤怒，並不重複疊加',()=>{
  const {u}=create();
  const moon=globalThis.SkillDatabase.get('avreshi_moonfire');
  const wrath=globalThis.SkillDatabase.get('avreshi_wrath');
  const full=UnitRuntimeEngine.applyResourceScaling(u,moon,{timeOfDay:'NIGHT',moonlight:'FULL'});
  assert(full.power>moon.power);
  assert.equal(UnitRuntimeEngine.applyResourceScaling(u,full,{timeOfDay:'NIGHT',moonlight:'FULL'}).power,full.power);
  assert.equal(UnitRuntimeEngine.applyResourceScaling(u,moon,{timeOfDay:'DAY',moonlight:'FULL'}).power,moon.power);
  assert(UnitRuntimeEngine.applyResourceScaling(u,wrath,{timeOfDay:'NIGHT',moonlight:'PARTIAL'}).power>wrath.power);
  assert.equal(u.resources?.moonBlessing,undefined);
});
test('獵豹感染只經正式狀態效果定義，回春是真正的 HOT',()=>{
  for(const id of ['avreshi_pounce','avreshi_bite','avreshi_claw','avreshi_shred']){
    const sk=globalThis.SkillDatabase.get(id);
    assert(sk.statusEffects.some(e=>e.id==='AVRESHI_WOUND_INFECTION'&&e.type==='DAMAGE_OVER_TIME'&&e.chance>0));
  }
  assert(globalThis.SkillDatabase.get('avreshi_rejuvenation').effects.some(e=>e.type==='HEAL_OVER_TIME'));
  assert.equal(globalThis.EquipmentDatabase.get('avreshi_moon_spear').inherentMagic.element,'NATURE');
});
test('Babylon 四形態全部有正式外觀定義與原共用 VFX 路由',()=>{
  for(const id of ['human','cheetah','seal','raven'])assert(VISUALS.characters['avreshi_'+id]?.battle?.kind);
  assert.equal(VISUALS.characters.avreshi_cheetah.battle.kind,'QUADRUPED');
  assert.equal(VISUALS.characters.avreshi_seal.battle.kind,'QUADRUPED');
  assert.equal(VISUALS.characters.avreshi_raven.battle.kind,'BIRD');
  assert(VfxDatabase.routeSkill('avreshi_moonfire').length>0);
  assert(VfxDatabase.routeSkill('avreshi_whirlpool').length>0);
});

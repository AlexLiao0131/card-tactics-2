import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SkillDatabase} from '../../js/skill-database.js';
import {LOADOUTS} from '../../js/loadout-database.js';
import {ResourceEngine} from '../../js/resource-engine.js';
import {createEffectEngine} from '../../js/effect-engine.js';
import {WaterInteractionEngine} from '../../js/battle-environment-controller.js';
import {VfxDatabase} from '../../js/vfx-database.js';
const effect=createEffectEngine({random:()=>.999});globalThis.EffectEngine=effect;
const unit=()=>({id:'friend',team:'P',alive:true,hp:120,x:2,y:2,
  character:{id:'test',combat:{hp:200,atk:14,matk:14,def:15,mdef:15,move:5},attributes:{},modifiers:{},passives:[]},effects:[]});
const swift=SkillDatabase.get('alchemy_swiftness_potion');
const breath=SkillDatabase.get('alchemy_underwater_breathing_potion');
test('both real potions are in the canonical hero loadout (not hidden variants)',()=>{
 for(const s of [swift,breath]){
  assert.ok(LOADOUTS.alchemist_default.skillIds.includes(s.id));
  assert.equal(s.alchemyCast.mode,'BASIC');assert.equal(s.target,'ALLY');
  assert.equal(s.manaCost,0);assert.equal(s.materialCost.amount,1);
  assert.equal(s.variants,undefined);
 }
 assert.equal(swift.materialCost.kind,'WOOD');assert.equal(breath.materialCost.kind,'HERB');
});
test('same wood can make strength potion or swiftness, but not both',()=>{
 const u={};const cost=swift.materialCost;
 const old=SkillDatabase.resolveVariant('alchemy_power_potion','NORMAL').materialCost;
 assert.deepEqual(cost,old);assert.ok(ResourceEngine.changeMaterial(u,{...cost,amount:1}));
 assert.ok(ResourceEngine.hasMaterial(u,old));assert.ok(ResourceEngine.hasMaterial(u,cost));
 assert.ok(ResourceEngine.changeMaterial(u,{...cost,amount:-1}));
 assert.equal(ResourceEngine.hasMaterial(u,old),false);assert.equal(ResourceEngine.hasMaterial(u,cost),false);
});
test('same herb makes healing or underwater breathing; no additional water crystal',()=>{
 const u={};const cost=breath.materialCost;
 assert.deepEqual(cost,SkillDatabase.resolveVariant('alchemy_healing_potion','NORMAL').materialCost);
 assert.ok(ResourceEngine.changeMaterial(u,{...cost,amount:1}));
 assert.ok(ResourceEngine.changeMaterial(u,{...cost,amount:-1}));
 assert.equal(ResourceEngine.hasMaterial(u,cost),false);
});
test('godspeed is a real movement buff: +2 MOVE, no free reset, expiry restores base without stacking',()=>{
 const u=unit();u.moved=true;u.acted=false;
 assert.equal(effect.apply({source:u,target:u,effect:swift.effects[0]}).applied,true);
 assert.equal(u.character.combat.move,7);assert.equal(u.moved,true);
 assert.equal(u.character.modifiers.speed,undefined);
 assert.equal(effect.apply({source:u,target:u,effect:swift.effects[0]}).applied,true);
 assert.equal(u.character.combat.move,7);
 effect.tick(u);assert.equal(u.character.combat.move,7);
 effect.tick(u);assert.equal(u.character.combat.move,7);
 effect.tick(u);assert.equal(u.character.combat.move,5);
});
test('underwater potion grants breathing, not water walking or absolute immunity',()=>{
 const u=unit();
 assert.equal(WaterInteractionEngine.activeWaterRules(u).breathing,false);
 assert.equal(effect.apply({source:u,target:u,effect:breath.effects[0]}).applied,true);
 assert.deepEqual(WaterInteractionEngine.activeWaterRules(u),{breathing:true,waterWalk:false,preventSinking:false});
 const tile={x:2,y:2,terrain:'WATER',waterDepth:3};
 globalThis.HydrologyEngine={waterDepth:t=>t.waterDepth};
 u.waterInteraction={state:'SWIMMING',depth:3,fatigue:6};
 const during=WaterInteractionEngine.resolve(u,tile,{trigger:'TICK'});
 assert.equal(during.state,'SWIMMING');assert.equal(during.damage,0);
 u.waterInteraction.forcedSubmergeTurns=1;
 const wave=WaterInteractionEngine.resolve(u,tile,{trigger:'TICK'});
 assert.equal(wave.state,'SINKING');assert.equal(wave.damage,0);
 effect.removeEffectById(u,'ALCH_UNDERWATER_BREATHING_POTION');
 const after=WaterInteractionEngine.resolve(u,tile,{trigger:'TICK'});
 assert.equal(after.state,'SINKING');assert.ok(after.damage>0);
});
test('underwater expiration and dispel remove breathing; preview shows real rules',()=>{
 const u=unit();effect.apply({source:u,target:u,effect:breath.effects[0]});
 assert.match(SkillDatabase.inspect(swift).mechanics.join('|'),/移動力 \+2/);
 assert.match(SkillDatabase.inspect(breath).mechanics.join('|'),/水下呼吸/);
 effect.tick(u);effect.tick(u);assert.equal(WaterInteractionEngine.activeWaterRules(u).breathing,true);
 effect.tick(u);assert.equal(WaterInteractionEngine.activeWaterRules(u).breathing,false);
});
test('existing shared Babylon dispatcher has distinct visible roles, no new engine',()=>{
 assert.equal(VfxDatabase.roleFor('arcane',swift.id),'ALCHEMY_SWIFT');
 assert.equal(VfxDatabase.roleFor('arcane',breath.id),'ALCHEMY_BREATH');
 assert.ok(VfxDatabase.routeSkill(swift.id).includes('arcane'));
 assert.ok(VfxDatabase.routeSkill(breath.id).includes('arcane'));
 const vfx=readFileSync(new URL('../../js/arcane-sigil-vfx.js',import.meta.url),'utf8');
 assert.match(vfx,/alchemy-swiftness-sprint-arrow/);
 assert.match(vfx,/alchemy-underwater-breathing-bubble/);
});

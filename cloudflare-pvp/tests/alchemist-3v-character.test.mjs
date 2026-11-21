import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {CharacterDatabase} from '../../js/character-database.js';
import {BattleEngine} from '../../js/battle-engine.js';
import {SkillDatabase} from '../../js/skill-database.js';
import {LoadoutDatabase} from '../../js/loadout-database.js';
import {ResourceEngine} from '../../js/resource-engine.js';
import {VfxDatabase} from '../../js/vfx-database.js';
import {CardDatabase} from '../../js/card-database.js';
import {PackDatabase} from '../../js/pack-database.js';
import {VisualDatabase} from '../../js/visual-database.js';
const hero=CharacterDatabase.get('alchemist');
test('single 3V character uses canonical six-dimensional combat derivation',()=>{
 assert.equal(hero.genetics.grade,'3V');
 assert.deepEqual(hero.genetics.values,['AGI','INT','WIL']);
 for(const k of ['agi','int','wil'])assert.equal(hero.attributes[k],20);
 for(const k of ['str','vit','luk'])assert.ok(hero.attributes[k]<20);
 assert.equal(hero.resourceRules.mana,false);
 const derived=BattleEngine.deriveCombatFromAttributes({move:hero.combat.move},hero.attributes,hero.attributes,hero);
 for(const stat of ['hp','atk','matk','def','mdef'])assert.equal(hero.combat[stat],derived[stat]);
});
test('character, card, pack and visual use the same selected identity',()=>{
 assert.equal(hero.name,'梅莉安・羅森菲爾');
 const card=CardDatabase.get('alchemist_card');
 assert.equal(card.name,hero.name);assert.equal(card.characterId,hero.id);
 assert.ok(PackDatabase.product('ALCHEMY_FIXED').cards.includes(card.id));
 const visual=VisualDatabase.characterBattle(hero.visualId);
 assert.equal(visual.kind,'FIGURE');
 assert.ok(['alchemist.png','alchemist.PNG'].some(file=>existsSync(new URL(`../../assets/images/cards/heroes/${file}`,import.meta.url))));
});
test('five canonical spells provide one normal and eight infused high-quality variants each',()=>{
 const idList=['alchemy_mana_stone','alchemy_healing_potion','alchemy_power_potion','alchemy_hard_shell_potion','alchemy_explosion'];
 const expected=['NATURE','WATER','ICE','FIRE','THUNDER','HOLY','DARK','STONE'];
 for(const id of idList){
  const skill=SkillDatabase.get(id);
  assert.equal(skill.alchemyCast.mode,'BASIC');
  assert.equal(skill.manaCost,0);
  assert.equal(skill.variants.length,9);
  assert.equal(skill.variants[0].materialCost.quality,'NORMAL');
  assert.equal(skill.variants[0].materialCost.amount,1);
  assert.deepEqual(skill.variants.slice(1).map(v=>v.materialCost.affinity),expected);
  for(const v of skill.variants){
   assert.equal(v.materialCost.amount,1);
   const active=SkillDatabase.resolveVariant(skill,v.id);
   assert.equal(active.materialCost.quality,v.materialCost.quality);
   assert.equal(active.id,id);
  }
 }
});
test('ultimate uses no material and exposes seven real terrain transformations',()=>{
 const skill=SkillDatabase.get('alchemy_world_transmutation');
 assert.equal(skill.alchemyCast.mode,'TERRAIN');
 assert.equal(skill.manaCost,0);assert.equal(skill.variants.length,7);
 for(const v of skill.variants){assert.ok(v.alchemyTerrain);assert.equal(v.materialCost,undefined);}
});

test('armor recipe is replaced by hard-shell potion across formal loadout and VFX routing',()=>{
 assert.throws(()=>SkillDatabase.get('alchemy_armor'),/Unknown skill/);
 const skill=SkillDatabase.get('alchemy_hard_shell_potion');
 assert.equal(skill.name,'硬殼藥劑');
 const loadout=LoadoutDatabase.get('alchemist_default');
 assert.ok(loadout.skillIds.includes(skill.id));
 assert.ok(!loadout.skillIds.includes('alchemy_armor'));
 assert.equal(VfxDatabase.roleFor('arcane',skill.id),'ALCHEMY_SHELL');
});
test('a normal mineral can be used for either explosion or hard-shell, with one shared debit',()=>{
 const shell=SkillDatabase.resolveVariant(SkillDatabase.get('alchemy_hard_shell_potion'),'NORMAL');
 const blast=SkillDatabase.resolveVariant(SkillDatabase.get('alchemy_explosion'),'NORMAL');
 assert.deepEqual(shell.materialCost,blast.materialCost);
 const unit={materialInventory:{}};
 assert.ok(ResourceEngine.changeMaterial(unit,{...shell.materialCost,amount:1}));
 assert.ok(ResourceEngine.hasMaterial(unit,shell.materialCost));
 assert.ok(ResourceEngine.hasMaterial(unit,blast.materialCost));
 assert.ok(ResourceEngine.changeMaterial(unit,{...shell.materialCost,amount:-1}));
 assert.equal(ResourceEngine.hasMaterial(unit,shell.materialCost),false);
 assert.equal(ResourceEngine.hasMaterial(unit,blast.materialCost),false);
});
test('one high-fire mineral can make either high-fire explosion or high-fire hard-shell',()=>{
 const shell=SkillDatabase.resolveVariant(SkillDatabase.get('alchemy_hard_shell_potion'),'HIGH_FIRE');
 const blast=SkillDatabase.resolveVariant(SkillDatabase.get('alchemy_explosion'),'HIGH_FIRE');
 assert.deepEqual(shell.materialCost,blast.materialCost);
 const unit={materialInventory:{}};
 assert.ok(ResourceEngine.changeMaterial(unit,{...shell.materialCost,amount:1}));
 assert.ok(ResourceEngine.hasMaterial(unit,shell.materialCost));
 assert.ok(ResourceEngine.hasMaterial(unit,blast.materialCost));
 assert.ok(ResourceEngine.changeMaterial(unit,{...blast.materialCost,amount:-1}));
 assert.equal(ResourceEngine.hasMaterial(unit,shell.materialCost),false);
});

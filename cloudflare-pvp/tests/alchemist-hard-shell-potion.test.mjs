import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {LoadoutDatabase} from '../../js/loadout-database.js';
import {ResourceEngine} from '../../js/resource-engine.js';
import {VfxDatabase} from '../../js/vfx-database.js';
const P='alchemy_hard_shell_potion';
const shell=SkillDatabase.get(P);
const bomb=SkillDatabase.get('alchemy_explosion');
test('old armor skill is removed and hero loadout references the hard-shell potion',()=>{
 assert.throws(()=>SkillDatabase.get('alchemy_armor'),/Unknown skill/);
 const loadout=LoadoutDatabase.get('alchemist_default');
 assert.ok(loadout.skillIds.includes(P));
 assert.ok(!loadout.skillIds.includes('alchemy_armor'));
 assert.equal(loadout.skillIds.filter(id=>['alchemy_mana_stone','alchemy_healing_potion','alchemy_power_potion',P,'alchemy_explosion'].includes(id)).length,5);
 assert.equal(shell.name,'硬殼藥劑');assert.equal(shell.category,'MAGIC');assert.equal(shell.target,'ALLY');
 assert.ok(!shell.name.includes('護甲'));
});
test('normal mineral enables either explosion or potion and is debited once by official inventory',()=>{
 const a=SkillDatabase.resolveVariant(shell,'NORMAL');const b=SkillDatabase.resolveVariant(bomb,'NORMAL');
 assert.deepEqual(a.materialCost,b.materialCost);
 const u={materialInventory:{}};
 assert.equal(ResourceEngine.changeMaterial(u,{...a.materialCost,amount:1}),true);
 assert.equal(ResourceEngine.hasMaterial(u,a.materialCost),true);
 assert.equal(ResourceEngine.hasMaterial(u,b.materialCost),true);
 assert.equal(ResourceEngine.changeMaterial(u,{...a.materialCost,amount:-1}),true);
 assert.equal(ResourceEngine.hasMaterial(u,a.materialCost),false);
 assert.equal(ResourceEngine.hasMaterial(u,b.materialCost),false);
});
test('all nine hard-shell potions retain authored costs and buff durations, not equipment mutation',()=>{
 assert.equal(shell.variants.length,9);
 for(const v of shell.variants){
  assert.ok(v.name.endsWith('藥劑'),v.name); // elemental variants may have specialized names
  const active=SkillDatabase.resolveVariant(shell,v.id);
  assert.equal(active.id,P);assert.equal(active.materialCost.kind,'MINERAL');
  assert.equal(active.materialCost.amount,1);
  assert.ok(active.effects.some(e=>e.type==='BUFF'&&e.duration===2));
  assert.equal(active.target,'ALLY');assert.equal(active.alchemyCast.mode,'BASIC');
 }
 assert.equal(shell.variants.find(v=>v.id==='HIGH_HOLY').effects.some(e=>e.id==='ALCH_ARMOR_HOLY'),true);
});
test('VFX route uses shared arcane shell role and old skill cannot route',()=>{
 assert.equal(VfxDatabase.roleFor('arcane',P),'ALCHEMY_SHELL');
 assert.equal(VfxDatabase.roleFor('arcane','alchemy_armor'),null);
});

test('one rare fire mineral supports either fire explosion or fire hard-shell, never both after one spend',()=>{
 const a=SkillDatabase.resolveVariant(shell,'HIGH_FIRE');
 const b=SkillDatabase.resolveVariant(bomb,'HIGH_FIRE');
 assert.deepEqual(a.materialCost,b.materialCost);
 const u={materialInventory:{}};
 assert.equal(ResourceEngine.changeMaterial(u,{...a.materialCost,amount:1}),true);
 assert.equal(ResourceEngine.hasMaterial(u,a.materialCost),true);
 assert.equal(ResourceEngine.hasMaterial(u,b.materialCost),true);
 assert.equal(ResourceEngine.changeMaterial(u,{...b.materialCost,amount:-1}),true);
 assert.equal(ResourceEngine.hasMaterial(u,a.materialCost),false);
 assert.equal(ResourceEngine.hasMaterial(u,b.materialCost),false);
});

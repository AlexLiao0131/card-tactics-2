import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';

test('alchemy details are sourced from the currently selected canonical variant',()=>{
 const parent=SkillDatabase.get('alchemy_healing_potion');
 const normal=SkillDatabase.resolveVariant(parent,'NORMAL');
 const nature=SkillDatabase.resolveVariant(parent,'HIGH_NATURE');
 const plain=SkillDatabase.inspect(normal);const enhanced=SkillDatabase.inspect(nature);
 assert.ok(plain.mechanics.join(' ').includes('立即治療 55 HP'));
 assert.ok(enhanced.mechanics.join(' ').includes('立即治療 65 HP'));
 assert.ok(enhanced.mechanics.join(' ').includes('每回合 14 HP'));
 assert.ok(!plain.mechanics.join(' ').includes('每回合 14 HP'));
});
test('alchemy explosion previews actual area and status magnitude',()=>{
 const skill=SkillDatabase.resolveVariant(SkillDatabase.get('alchemy_explosion'),'HIGH_FIRE');
 const info=SkillDatabase.inspect(skill).mechanics.join(' ');
 assert.ok(info.includes('半徑 1'));
 assert.ok(info.includes('威力倍率 1.08'));
 assert.ok(info.includes('11/回合 × 2 回合'));
});
test('three-cell underwater cliff shows hydrology protection and rune spend in preview',()=>{
 const skill=SkillDatabase.resolveVariant(SkillDatabase.get('alchemy_world_transmutation'),'CLIFF');
 const info=SkillDatabase.inspect(skill);
 assert.ok(info.mechanics.join(' ').includes('一般水域可升起岩盤'));
 assert.ok(info.mechanics.join(' ').includes('符文消耗 3/3'));
});
test('material-free basic damage skill uses MATK and does not grant a rune',()=>{
 const skill=SkillDatabase.get('alchemist_staff_strike');
 assert.equal(skill.attackType,'MAGIC');
 assert.deepEqual(skill.range,{min:1,max:3});
 assert.ok(!skill.materialCost&&!skill.alchemyCast);
});

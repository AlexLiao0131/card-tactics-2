import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {battleCommandEntries,battleSkillsForMenu,battleSkillCategory,
  battleSkillButtonLabel} from '../../js/battle-command-menu-ui.js';

test('one structural source models the original commands without guessed move/core/end rows',()=>{
  const entries=battleCommandEntries({capture:{id:'point',name:'中央據點'}});
  assert.deepEqual(entries.map(e=>e.label),[
    '佔領｜中央據點','攻擊','狀態','道具','對話','魔法／特殊技能','待機']);
  assert.equal(entries.some(e=>/結束戰棋|攻擊 Core|^移動$/.test(e.label)),false);
  assert.deepEqual(battleCommandEntries({canAttack:false}).map(e=>e.id),
    ['STATUS','ITEMS','DIALOGUE','SPECIAL','WAIT']);
});

test('skill classification and variants are strictly original database data',()=>{
  const names=['slash','magic_bolt','shadow_step','elemental_enchant'];
  const skills=SkillDatabase.list(names);
  assert.deepEqual(battleSkillsForMenu(skills,{mode:'attack-menu'}).map(s=>s.id),['slash']);
  assert.deepEqual(battleSkillsForMenu(skills,{mode:'special-menu'}).map(s=>s.id),
    ['magic_bolt','shadow_step','elemental_enchant']);
  assert.equal(battleSkillCategory(SkillDatabase.get('slash')),'attack');
  assert.equal(battleSkillCategory(SkillDatabase.get('nether_slash')),'special');
  assert.equal(battleSkillCategory(SkillDatabase.get('angel_lift_drop')),'attack');
  assert.equal(battleSkillCategory(SkillDatabase.get('nereia_deep_drag')),'attack');
  assert.equal(battleSkillCategory(SkillDatabase.get('angel_carry_ally')),'special');
  assert.throws(()=>SkillDatabase.get('angel_wing_control'),/Unknown skill:/);
  assert.throws(()=>SkillDatabase.get('aquatic_depth_control'),/Unknown skill:/);
  assert.equal(battleSkillCategory({id:'unknown',category:'PASSIVE'}),null);
});

test('official skill label never fabricates unspecified range or MP cost',()=>{
  const skill=SkillDatabase.get('magic_bolt');
  assert.equal(battleSkillButtonLabel(skill),skill.name);
  assert.equal(battleSkillButtonLabel(skill,{min:2,max:4},'10 MP'),
    `${skill.name}｜射程 2-4｜10 MP`);
});

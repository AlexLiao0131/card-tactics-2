import test from 'node:test';
import assert from 'node:assert/strict';
import {SKILLS,SkillDatabase} from '../../js/skill-database.js';
import {LoadoutDatabase} from '../../js/loadout-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {holyArrowRainTiles} from '../../js/holy-arrow-rain-vfx.js';
import '../../js/hydrology-engine.js';
import '../../js/environment-engine.js';
import {isCanonicalImmediateMapSkill} from '../src/pvp-headless-map-skills.mjs';

const skill=SkillDatabase.get('angel_holy_arrow_rain');
const map=()=>({tiles:Array.from({length:11*11},(_,i)=>({x:i%11,y:Math.floor(i/11),terrain:'PLAIN',elevation:0})),objects:[]});
const actor=mode=>({id:'angel',team:'P',alive:true,acted:false,waited:false,moved:false,
  character:{id:'angel_archer_hero',attributes:{int:16,wil:20},combat:{move:5},
    verticalMobility:{canFly:true,modes:['FLYING']}},
  verticalState:{mode},mana:90});

test('Holy Arrow Rain is a real magic skill, not a decorative or direct attack',()=>{
  assert.equal(skill.category,'MAGIC');
  assert.equal(skill.target,'TILE');
  assert.equal(skill.targetType,'AOE');
  assert.equal(skill.areaDamage.mode,'MAGIC_POWER');
  assert.equal(skill.areaDamage.relation,'ENEMY');
  assert.equal(skill.attackType,'MAGIC');
  assert.equal(skill.element,'HOLY');
  assert.equal(skill.requirements.flying,true);
  assert.equal(isCanonicalImmediateMapSkill(skill),true);
  assert.equal(LoadoutDatabase.get('angel_archer_hero_default').skillIds.includes(skill.id),true);
});

test('Holy Arrow Rain has independently balanced pure-MATK spell numbers',()=>{
  const enchantShot=SKILLS.angel_holy_shot;
  assert.equal(skill.power,.95);
  assert.equal(skill.manaCost,32);
  assert.deepEqual(skill.range,{min:2,max:5});
  assert.equal('weapon' in skill,false,'the held bow is an animation prop, never the damage source');
  assert.equal(skill.offenseStat,'MATK');
  assert.equal(skill.defenseStat,'MDEF');
  assert.equal(skill.attackType,'MAGIC');
  assert.equal(skill.areaDamage.centerMultiplier,undefined);
  assert.equal(skill.statusEffects,undefined);
  assert.notEqual(skill.manaCost,enchantShot.manaCost,'independent MP cost');
  assert.notEqual(skill.power,enchantShot.power,'independent MATK coefficient');
});

test('only airborne hero can cast; grounded hero is rejected by official runtime',()=>{
  assert.equal(UnitRuntimeEngine.canUseSkill(actor('GROUND'),skill),false);
  assert.equal(UnitRuntimeEngine.canUseSkill(actor('FLYING'),skill),true);
  const empty=actor('FLYING');empty.mana=0;
  assert.equal(UnitRuntimeEngine.canUseSkill(empty,skill),false);
});

test('exactly 13 tiles in the official Manhattan radius-2 diamond',()=>{
  const world=map(),center={x:5,y:5};
  const actual=TacticalEngine.aoeTiles(world,center,skill.radius);
  const displayed=holyArrowRainTiles(world,center);
  assert.equal(actual.length,13);
  assert.deepEqual(displayed.map(t=>`${t.x},${t.y}`).sort(),actual.map(t=>`${t.x},${t.y}`).sort());
  assert.deepEqual([0,1,2,3,4].map(y=>actual.filter(t=>t.y===y+3).length),[1,3,5,3,1]);
  assert.equal(holyArrowRainTiles(world,{x:0,y:0}).length,6);
});

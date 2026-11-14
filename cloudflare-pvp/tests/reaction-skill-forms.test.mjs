import assert from 'node:assert/strict';
import {BattleResolution} from '../../js/battle-resolution.js';
import {SkillDatabase} from '../../js/skill-database.js';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';

globalThis.UnitRuntimeEngine=UnitRuntimeEngine;
const attacker={id:'enemy',alive:true,team:'E',x:4,y:4,character:{id:'enemy',skills:[],weapons:{},passives:[]}};
const physical={id:'enemy_slash',attackType:'SLASH',target:'ENEMY',range:{min:1,max:1}};
const magic={id:'enemy_magic',attackType:'MAGIC',target:'ENEMY',range:{min:1,max:1},power:1};
const canUseSkill=()=>true;
const ophi={id:'ophi',alive:true,team:'P',x:4,y:5,mana:100,maxMana:120,
  character:{id:'ophi',skills:['ophi_backstep_shot','ophi_forest_wrath'],
    resourceRules:{mana:true,forestSoul:{label:'森靈之魂',max:30,initial:0}},
    passives:['FOREST_SOUL_RESONANCE'],weapons:{elven_bow:{weaponKind:'BOW',attackType:'SHOT'}}},
  resources:{forestSoul:{value:30,max:30,label:'森靈之魂'}}};
let choices=BattleResolution.counterSkills({defender:ophi,attacker,attackSkill:physical,canUseSkill});
let wrath=choices.find(s=>s.id==='ophi_forest_wrath');
let backstep=choices.find(s=>s.id==='ophi_backstep_shot');
assert(wrath,'Forest Wrath must be available as a counter skill');
assert.equal(wrath.target,'ENEMY');
assert.equal(wrath.targetType,'SINGLE');
assert.equal(wrath._reactionCounter,true);
assert.equal(wrath.forestSoulRelease,true);
const wrathScaled=UnitRuntimeEngine.applyResourceScaling(ophi,wrath);
assert.equal(wrathScaled.target,'ENEMY');
assert.equal(wrathScaled.targetType,'SINGLE');
assert(wrathScaled.power>SkillDatabase.get('ophi_forest_wrath').power);
const wrathSpent=UnitRuntimeEngine.consumeSkill(ophi,wrath);
assert.equal(wrathSpent.resources.forestSoul.cost,30);
assert.equal(ophi.resources.forestSoul.value,0,'counter-cast still consumes the full soul resource once');
assert(backstep,'Backstep Shot must be available against an evadable physical attack');
assert.equal(backstep.evasiveCounter,true);
choices=BattleResolution.counterSkills({defender:ophi,attacker,attackSkill:magic,canUseSkill});
assert.equal(choices.some(s=>s.id==='ophi_backstep_shot'),false,
  'Backstep Shot must not be offered against a pure-magic attack that cannot be actively evaded');

const livia={id:'livia',alive:true,team:'P',x:4,y:5,mana:100,maxMana:120,
  character:{id:'livia',skills:['nether_slash'],resourceRules:{mana:true,duality:{}},
    passives:[],weapons:{black_sword:{weaponKind:'SWORD',attackType:'SLASH'}}},
  resources:{duality:{value:0,max:100,label:'雙極'}}};
choices=BattleResolution.counterSkills({defender:livia,attacker,attackSkill:physical,canUseSkill});
let ultimate=choices.find(s=>s.id==='nether_slash');
assert(ultimate,'Livia blue ultimate must remain a legal single-target counter form');
assert.equal(ultimate.name,'奧義・淨界斬');
assert.equal(ultimate.target,'ENEMY');
assert.equal(ultimate.targetType,'SINGLE');
assert.equal(ultimate.power,2.5);
assert.equal(ultimate.purifiedSlash,true);
const blueCounter=UnitRuntimeEngine.applyResourceScaling(livia,ultimate);
assert.equal(blueCounter.power,2.5,'blue counter power multiplier must apply exactly once');
assert.equal(blueCounter.purifiedSlash,true);

livia.resources.duality.value=100;
choices=BattleResolution.counterSkills({defender:livia,attacker,attackSkill:physical,canUseSkill});
ultimate=choices.find(s=>s.id==='nether_slash');
assert.equal(ultimate.name,'奧義・幽影連斬');
assert.equal(ultimate.hitCount,4);
assert.equal(ultimate.target,'ENEMY');
assert.equal(ultimate.targetType,'SINGLE');
console.log('Reaction skill forms: Ophi Forest Wrath, evade-backstep counter, and Livia ultimate labels passed');

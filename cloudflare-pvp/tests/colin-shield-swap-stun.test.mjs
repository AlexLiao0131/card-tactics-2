import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {EffectEngine} from '../../js/effect-engine.js';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import '../../js/tactical-action-controller.js';

// Small deterministic grid. The test invokes original authoritative engines,
// not duplicated PvP calculations or browser UI state.
globalThis.TERRAINS={PLAIN:{passable:true,moveCost:1},WALL:{passable:false,moveCost:1}};
const world=()=>({tiles:Array.from({length:5*5},(_,i)=>({x:i%5,y:Math.floor(i/5),terrain:'PLAIN',elevation:0}))});
function actor(id,team,x,y){return {id,team,x,y,z:0,hp:310,mana:100,alive:true,
  moved:false,acted:false,waited:false,participatesInTurn:true,effects:[],
  character:{id,name:id,attributes:{str:20,agi:20,int:13,wil:17,vit:18,luk:14},
    combat:{hp:310,atk:98,matk:60,def:92,mdef:80,move:4},
    terrainTraits:[],passives:[],skills:['colin_ally_swap','colin_full_shield_defense','colin_shield_bash'],
    weapons:{colin_hammer:{weaponKind:'HAMMER',attackType:'STRIKE'}}}};}

test('Colin skill IDs resolve from the official database and loadout', async()=>{
 const {LOADOUTS}=await import('../../js/loadout-database.js');
 assert.deepEqual(LOADOUTS.colin_default.skillIds,
  ['colin_ally_swap','colin_full_shield_defense','colin_armor_breaking_strike','colin_shield_bash']);
 assert.equal(SkillDatabase.get('colin_shield_bash').statusEffects[0].type,'STUN');
 assert.equal(SkillDatabase.get('colin_shield_bash').power,1);
});

test('swap uses actual adjacent cells, both terrain profiles, and actual movement status',()=>{
 const map=world(),a=actor('colin','P',2,2),b=actor('ally','P',2,3),units=[a,b];
 assert.equal(TacticalEngine.canSwapAllies(map,units,a,b),true);
 b.x=4;b.y=4;
 assert.equal(TacticalEngine.canSwapAllies(map,units,a,b),false);
 b.x=2;b.y=3;b.team='E';
 assert.equal(TacticalEngine.canSwapAllies(map,units,a,b),false);
 b.team='P';
 map.tiles.find(t=>t.x===2&&t.y===3).terrain='WALL';
 assert.equal(TacticalEngine.canSwapAllies(map,units,a,b),false);
});

test('shared action controller swaps after an ordinary move and preserves ally action flags',()=>{
 const map=world(),a=actor('colin','P',2,2),b=actor('ally','P',2,3),units=[a,b],entries=[];
 a.moved=true;b.acted=true;b.moved=true;b.waited=true;
 const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},actionState:()=>({map,units,environmentState:null}),
   canUseSkill:()=>true,consumeSkill:()=>true,effectiveSkill:(_u,s)=>s,
   checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,
   setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},
   pushLog:(s)=>entries.push(s),render:()=>{},enterTile:(u)=>entries.push('ENTER_'+u.id)};
 const run=globalThis.TacticalActionController.create(ctx);
 assert.equal(run.executeUtilitySkill(a,b,SkillDatabase.get('colin_ally_swap')),true);
 assert.equal(a.x,2);assert.equal(a.y,3);
 assert.equal(b.x,2);assert.equal(b.y,2);
 assert.equal(a.acted,true);assert.equal(a.moved,true);
 assert.equal(b.acted,true);assert.equal(b.moved,true);assert.equal(b.waited,true);
 assert.ok(entries.includes('ENTER_colin'));assert.ok(entries.includes('ENTER_ally'));
});

test('full shield stance immobilizes while active and survives first future-round tick',()=>{
 const map=world(),a=actor('colin','P',2,2),b=actor('ally','P',2,3),units=[a,b];
 const rule=SkillDatabase.get('colin_full_shield_defense').effects[0];
 const applied=EffectEngine.apply({source:a,target:a,effect:rule});
 assert.equal(applied.applied,true);
 assert.equal(TacticalEngine.canSwapAllies(map,units,a,b),false);
 EffectEngine.tick(a,{units});
 assert.equal(TacticalEngine.canSwapAllies(map,units,a,b),false);
 EffectEngine.tick(a,{units});
 assert.equal(TacticalEngine.canSwapAllies(map,units,a,b),true);
});

test('stun survives normal tick, skips exactly one action, then is removed',()=>{
 const a=actor('enemy','E',1,1),units=[a];
 a.acted=true;
 const skill=SkillDatabase.get('colin_shield_bash');
 assert.equal(EffectEngine.apply({source:actor('colin','P',1,2),target:a,effect:skill.statusEffects[0]}).applied,true);
 EffectEngine.tick(a,{units});
 assert.equal(EffectEngine.hasEffect(a,'STUN'),true);
 UnitRuntimeEngine.resetActions(units,'E');
 assert.equal(a.acted,true);assert.equal(a.waited,true);assert.equal(a.moved,true);
 assert.equal(EffectEngine.hasEffect(a,'STUN'),false);
 UnitRuntimeEngine.resetActions(units,'E');
 assert.equal(a.acted,false);assert.equal(a.waited,false);assert.equal(a.moved,false);
});

test('purification before next action prevents stun skip',()=>{
 const a=actor('enemy','E',1,1),units=[a];
 EffectEngine.apply({source:actor('colin','P',1,2),target:a,effect:SkillDatabase.get('colin_shield_bash').statusEffects[0]});
 assert.ok(EffectEngine.removeNegative(a)>0);
 UnitRuntimeEngine.resetActions(units,'E');
 assert.equal(a.acted,false);
});

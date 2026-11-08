import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/terrain-database.js';
import '../../js/character-database.js';
import '../../js/equipment-database.js';
import '../../js/loadout-database.js';
import '../../js/battle-engine.js';
import '../../js/battle-resolution.js';
import '../../js/hydrology-engine.js';
import '../../js/environment-engine.js';
import '../../js/unit-animation-engine.js';
import '../../js/effect-engine.js';
import '../../js/tactical-action-controller.js';
import '../../js/angel-wing-barrier-engine.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {VerticalMobilityEngine} from '../../js/vertical-mobility-engine.js';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {SkillDatabase} from '../../js/skill-database.js';

function setup(){
 const map={width:12,height:12,objects:[],tiles:Array.from({length:144},(_,i)=>({x:i%12,y:Math.floor(i/12),terrain:'PLAIN',elevation:0,waterDepth:0}))};
 const angel=UnitRuntimeEngine.create({id:'angel',team:'P',characterId:'angel_archer_hero',x:5,y:5,map});
 const foe=UnitRuntimeEngine.create({id:'foe',team:'E',characterId:'imperial_swordsman',x:6,y:3,map});
 const ally=UnitRuntimeEngine.create({id:'friend',team:'P',characterId:'imperial_swordsman',x:5,y:3,map});
 assert.ok(angel&&foe&&ally);
 const units=[angel,foe,ally],skill=SkillDatabase.get('angel_holy_arrow_rain');
 let logs=[];
 const controller=globalThis.TacticalActionController.create({
  TEAM:{PLAYER:'P',ENEMY:'E'},
  actionState:()=>({map,units,environmentState:null}),
  canUseSkill:(u,s)=>UnitRuntimeEngine.canUseSkill(u,s),
  consumeSkill:(u,s)=>UnitRuntimeEngine.consumeSkill(u,s),
  effectiveSkill:(u,s)=>UnitRuntimeEngine.applyResourceScaling(u,s),
  unitAt:(x,y)=>units.find(u=>u.alive&&u.x===x&&u.y===y)||null,
  aoeTiles:(center,radius)=>TacticalEngine.aoeTiles(map,center,radius),
  lineTiles:(u,end)=>TacticalEngine.lineTiles(map,u,end),
  random:()=>.02,
  pushLog:(m)=>logs.push(m),logEnvironmentEvent:()=>{},resolveEnvironmentEvents:()=>{},
  applyEnvironmentHazardToUnit:()=>{},clearEngagement:()=>{},
  setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{},
  checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,handleDefeated:()=>{}
 });
 return {map,angel,foe,ally,skill,controller,logs};
}

test('real canonical map attack damages only enemies, spends MP once, ends action',()=>{
 const c=setup(),center=TacticalEngine.tile(c.map,5,3);
 const before=c.foe.hp,friendBefore=c.ally.hp,manaBefore=c.angel.mana;
 const result=c.controller.executeMapSkill(c.angel,center,c.skill);
 assert.equal(result,true);
 assert.ok(c.foe.hp<before,`actual enemy damage ${before} -> ${c.foe.hp}`);
 assert.equal(c.ally.hp,friendBefore,'friendly unit untouched by HOLY arrow rain');
 assert.equal(c.angel.mana,manaBefore-c.skill.manaCost);
 assert.equal(c.angel.acted,true);
 assert.equal(c.angel.waited,true);
});

test('canonical area magic is stopped by friendly-facing Holy Wing Wall, unlike friendly outgoing attacks',()=>{
  const {AngelWingBarrierEngine:W}=globalThis; // real authoritative field owner
  assert.ok(W);
  const c=setup();
  c.angel.team='E';c.angel.x=5;c.angel.y=2;
  c.foe.team='P';c.foe.x=5;c.foe.y=5;
  c.ally.team='P';c.ally.x=5;c.ally.y=6;
  c.map.objects=W.wallTiles({x:5,y:5},'N').map(cell=>({
    id:`wall-${cell.index}`,type:W.TYPE,x:cell.x,y:cell.y,
    ownerUnitId:c.foe.id,ownerTeam:'P',anchorX:5,anchorY:5,facing:'N',
    barrierIndex:cell.index,blocksMovement:true,destructible:false
  }));
  const front={x:5,y:4};
  assert.equal(W.blocksIncoming(c.map,c.angel,c.ally,c.skill),true);
  const hp=c.ally.hp;
  assert.equal(c.controller.executeMapSkill(c.angel,front,c.skill),true);
  assert.equal(c.ally.hp,hp,'P victim behind wall must not be hit by enemy AoE');
  assert.equal(W.blocksIncoming(c.map,c.ally,c.angel,c.skill),false,'friendly outgoing magic is not blocked');
});


test('pure holy rain damage scales only from MATK/MDEF, never ATK, bow affixes or weapon enchant',()=>{
 const c=setup(),a=c.angel.character,d=c.foe.character;
 const roll=(caster)=>globalThis.BattleEngine.calculate(caster,d,c.skill,{forceHit:true,disableCrit:true});
 const ordinary=roll(a);
 const altered={...a,combat:{...a.combat,atk:a.combat.atk+900},
   weapons:{...(a.weapons||{}),bow:{...(a.weapons?.bow||{}),attackType:'SHOT',affixes:['GUARANTEED_HIT','IGNORE_ARMOR_DISADVANTAGE'],power:999}}};
 const raised={...a,combat:{...a.combat,matk:a.combat.matk+20}};
 assert.equal(ordinary.type,'MAGIC');
 assert.equal(ordinary.weapon,undefined,'no bow referenced in the spell damage formula');
 assert.equal(ordinary.offenseStat,'MATK');
 assert.equal(ordinary.defenseStat,'MDEF');
 assert.equal(roll(altered).damage,ordinary.damage,'ATK and enhanced bow must have zero effect');
 assert.ok(roll(raised).damage>ordinary.damage,'increasing MATK increases holy spell damage');
 assert.equal(c.skill.areaDamage.centerMultiplier,undefined);
});

test('balanced holy rain consumes 32 MP and still resolves as one enemy-only cast',()=>{
 const c=setup();
 const before={mp:c.angel.mana,enemy:c.foe.hp,friend:c.ally.hp};
 assert.equal(c.controller.executeMapSkill(c.angel,TacticalEngine.tile(c.map,5,3),c.skill),true);
 assert.equal(before.mp-c.angel.mana,32);
 assert.ok(c.foe.hp<before.enemy);
 assert.equal(c.ally.hp,before.friend);
 assert.equal(c.angel.acted,true);
});

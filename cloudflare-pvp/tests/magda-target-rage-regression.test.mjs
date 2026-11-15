import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RESOURCE_PROFILES} from '../../js/resource-profile-database.js';
import {SkillDatabase} from '../../js/skill-database.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const src=name=>fs.readFileSync(path.join(root,name),'utf8');
const mapOf=(w=6,h=6)=>({tiles:Array.from({length:w*h},(_,i)=>({x:i%w,y:Math.floor(i/w),elevation:0,terrain:'PLAIN'})),objects:[]});
const at=(map,x,y)=>map.tiles.find(t=>t.x===x&&t.y===y);
const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);

function targetFixture(){
  const map=mapOf(),hero={id:'magda',team:'P',alive:true,x:1,y:2,z:0,acted:false,waited:false,
    character:{name:'瑪格妲',collision:{height:2},weapons:{greatsword:{}},resourceRules:{rage:RESOURCE_PROFILES.rage}}},
    target={id:'enemy',team:'E',alive:true,x:3,y:2,z:0,hp:150,character:{name:'敵軍'}},
    friend={id:'friend',team:'P',alive:true,x:1,y:1,z:0,hp:150,character:{name:'友軍'}},
    units=[hero,target,friend],seen=new Set(map.tiles.map(t=>`${t.x},${t.y}`));
  const events=[],logs=[];let spent=0,enterCount=0;
  const unitAt=(x,y)=>units.find(u=>u.alive&&u.x===x&&u.y===y)||null;
  const sandbox={console,TERRAINS:{PLAIN:{passable:true}},AngelWingBarrierEngine:{TYPE:'ANGEL'},
    TacticalEngine:{range:s=>s.range,teamCanSee:(m,us,team,t)=>seen.has(`${t.x},${t.y}`),
      canSee:()=>false,canOccupyTerrain:()=>true,isBlockedByObject:()=>false,
      tile:(m,x,y)=>at(m,x,y),elevation:t=>t.elevation,
      faceToward:()=>{},
      },
    EnvironmentEngine:{EFFECT:{BURNING:'BURNING'},effectAt:()=>[]},
    HydrologyEngine:{},
    EffectEngine:{breakStealth:()=>{},interruptChannel:()=>{},
      applyDamage:(u,d)=>{const hpLoss=Math.min(u.hp,Math.max(0,Math.round(d)));u.hp-=hpLoss;return{hpLoss,absorbed:0}}},
    UnitRuntimeEngine:{beginBloodTransaction:()=>{},endBloodTransaction:()=>{},attackEnhancement:()=>1,
      rollSanityMisfire:()=>false,onRageForcedLanding:()=>{}},
    UnitAnimationEngine:{emitMove:(...args)=>events.push(['move',...args]),
      emitAction:(...args)=>events.push(['action',...args]),emitResolvedHit:()=>{},emitHit:()=>{},emitOutcome:()=>{}},
    VerticalMobilityEngine:{bodyHeight:()=>2,syncUnit:(u,t)=>{u.z=t.elevation}},
    BattleEngine:{calculate:(a,d,s)=>({hit:true,crit:false,damage:30,type:'PHYSICAL'})},
    BattleResolution:{splitActualHpLoss:(res,hpLoss)=>({physical:hpLoss,magic:0})},
    ResourceEngine:{RESOURCE_PROFILES},
    PostEngagementEngine:{forcedMove:()=>({fallDamage:0})},
  };
  sandbox.globalThis=sandbox;
  vm.runInNewContext(src('js/tactical-action-controller.js'),sandbox);
  const ctx={actionState:()=>({map,units,environmentState:null}),
    unitAt,coreAt:()=>null,targetType:s=>s.targetType,
    canUseSkill:()=>true,
    effectiveSkill:(unit,s)=>s,
    consumeSkill:()=>{spent++;return {cost:0,resources:{rage:{cost:20}}}},
    aoeTiles:(c,r)=>map.tiles.filter(t=>dist(c,t)<=r),
    enterTile:()=>{enterCount++},pushLog:(...args)=>logs.push(args),
    resolveEnvironmentEvents:()=>{},applyEnvironmentHazardToUnit:()=>{},
    logPostEffect:()=>{},logEnvironmentEvent:()=>{},checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,
    setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{}};
  const ctrl=sandbox.TacticalActionController.create(ctx);
  return{map,hero,target,friend,units,seen,events,logs,sandbox,ctrl,
    spent:()=>spent,enterCount:()=>enterCount,skill:SkillDatabase.get('magda_leap_quake')};
}

test('點擊敵人：共享 TILE 瞄準涵蓋敵格，實際落到相鄰空格並震擊該敵軍',()=>{
  const f=targetFixture();
  const targetTile=at(f.map,f.target.x,f.target.y);
  assert(f.ctrl.mapTargetTiles(f.hero,f.skill).includes(targetTile));
  const initialHp=f.target.hp;
  assert.equal(f.ctrl.executeMapSkill(f.hero,targetTile,f.skill),true);
  assert.deepEqual([f.hero.x,f.hero.y],[2,2]);
  assert.deepEqual([f.target.x,f.target.y],[3,2]);
  assert.equal(f.target.hp,initialHp-30);
  assert.equal(f.friend.hp,150,'友軍不受跳躍震地物理範圍影響');
  assert.equal(f.spent(),1);
  assert.equal(f.enterCount(),1);
  assert.equal(f.hero.acted,true);
  assert.equal(f.events[0][0],'move');
  assert.equal(f.events[0][2].kind,'LEAP');
  assert.equal(f.events[1][0],'action');
  assert.equal(f.events[1][2].x,2,'範圍震地以落點而非被佔據的敵格為中心');
});

test('直接點合法空地仍可震地，僅一個技能花費',()=>{
  const f=targetFixture(),tile=at(f.map,2,2);
  assert(f.ctrl.mapTargetTiles(f.hero,f.skill).includes(tile));
  assert.equal(f.ctrl.executeMapSkill(f.hero,tile,f.skill),true);
  assert.deepEqual([f.hero.x,f.hero.y],[2,2]);
  assert.equal(f.spent(),1);
});

test('四面被佔滿的敵人不能成為落點瞄準；非法施放不扣憤怒',()=>{
  const f=targetFixture();
  for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])
    f.units.push({id:`block${dx},${dy}`,team:'E',alive:true,
      x:f.target.x+dx,y:f.target.y+dy});
  const tile=at(f.map,3,2);
  assert(!f.ctrl.mapTargetTiles(f.hero,f.skill).includes(tile));
  assert.equal(f.ctrl.executeMapSkill(f.hero,tile,f.skill),false);
  assert.equal(f.spent(),0);
  assert.deepEqual([f.hero.x,f.hero.y],[1,2]);
});

test('已看見敵人但相鄰合法落點未被觀測時不可鎖定或扣怒',()=>{
  const f=targetFixture();
  f.seen.delete('2,2');
  f.seen.delete('3,1');
  f.seen.delete('3,3');
  f.seen.delete('4,2');
  const tile=at(f.map,3,2);
  assert(!f.ctrl.mapTargetTiles(f.hero,f.skill).includes(tile));
  assert.equal(f.ctrl.executeMapSkill(f.hero,tile,f.skill),false);
  assert.equal(f.spent(),0);
});

test('友軍不能被視為直接指定震地目標',()=>{
  const f=targetFixture(),tile=at(f.map,1,1);
  assert(!f.ctrl.mapTargetTiles(f.hero,f.skill).includes(tile));
});

test('高怒：一般技能加成最高30%，斬殺線及 Rage 其他數值不變',()=>{
  const profile=RESOURCE_PROFILES.rage;
  assert.equal(profile.attackPowerBonusMaxRatio,.3);
  assert.equal(profile.executeMaxHpRatio,.5);
  assert.equal(profile.killBonus,15);
  assert.equal(profile.slashBonus,8);
  assert.equal(profile.shockwaveLift,3);
  // Execute the real UnitRuntimeEngine source with minimal injected owners.
  // We only call its official applyResourceScaling; combat/targeting remain unchanged.
  const runtimeSource=src('js/unit-runtime-engine.js').replace(/^import .*;\n/gm,'')
    .replace('export function createUnitRuntimeEngine','function createUnitRuntimeEngine')
    .replace('export const UnitRuntimeEngine','const UnitRuntimeEngine');
  const resource={RESOURCE_MANA:{base:0,intFactor:0,wilFactor:0},
    manaMaxFromAttributes:()=>0,manaMax:()=>0,syncMana:()=>{},changeMana:()=>{},
    resourceRules:u=>u.character.resourceRules||{},value:(u,key)=>u.resources[key]?.value||0,
    resourceLabel:()=>'',sync:()=>{},change:(u,key,delta)=>{u.resources[key].value+=delta;return delta}};
  const sandbox={ResourceEngine:resource,ColinShieldMobilityEngine:{},
    UnitTraitEngine:{transformedSkill:(u,s)=>s},console};sandbox.globalThis=sandbox;
  vm.runInNewContext(runtimeSource,sandbox);
  for(const [rage,mul] of [[0,1],[25,1.075],[50,1.15],[75,1.225],[100,1.3]]){
    const unit={character:{resourceRules:{rage:profile}},resources:{rage:{value:rage,max:100}}};
    const skill={id:'magda_rage_slash',attackType:'SLASH',category:'ATTACK',power:1};
    const result=sandbox.UnitRuntimeEngine.applyResourceScaling(unit,skill);
    assert(Math.abs(result.power-mul)<1e-9,`rage=${rage}: ${result.power}`);
    assert.equal(result.rageSnapshot,rage);
  }
  const nonrage={character:{resourceRules:{}},resources:{}};
  assert.equal(sandbox.UnitRuntimeEngine.applyResourceScaling(nonrage,
    {id:'slash',attackType:'SLASH',power:1}).power,1);
});

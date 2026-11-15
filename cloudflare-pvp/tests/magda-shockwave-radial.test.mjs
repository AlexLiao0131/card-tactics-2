import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {RESOURCE_PROFILES} from '../../js/resource-profile-database.js';
import {SkillDatabase} from '../../js/skill-database.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const src=p=>fs.readFileSync(path.join(root,p),'utf8');
const tile=(m,x,y)=>m.tiles.find(t=>t.x===x&&t.y===y)||null;
const mapOf=()=>({width:15,height:15,tiles:Array.from({length:225},(_,i)=>({x:i%15,y:Math.floor(i/15),terrain:'PLAIN',elevation:0})),objects:[]});
const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);

// Evaluate the production owners; no replacement directional physics or
// gameplay movement engine is created for Magda.
function fixture({armorWeight='LIGHT',wall=null}={}){
  const map=mapOf(),units=[],anim=[],calls=[],effects=[];
  const quake=SkillDatabase.get('magda_leap_quake');
  const actor={id:'magda',team:'P',alive:true,x:6,y:6,z:0,acted:false,waited:false,
    character:{name:'Magda',collision:{height:2},combat:{atk:108},weapons:{greatsword:{}},resourceRules:{rage:RESOURCE_PROFILES.rage}}};
  const enemy={id:'enemy',team:'E',alive:true,x:7,y:6,z:0,hp:1000,
    character:{name:'enemy',displacement:{weightClass:armorWeight},combat:{hp:1000,def:0},armor:{type:'NONE'}}};
  units.push(actor,enemy);
  const stubs={console,
    TERRAINS:{PLAIN:{passable:true}},
    TacticalEngine:{tile,range:s=>s.range,teamCanSee:()=>true,canSee:()=>true,
      canOccupyTerrain:()=>true,isBlockedByObject:()=>false,elevation:t=>t.elevation||0,
      faceToward:()=>{},elevationDelta:(a,b)=>(b.elevation||0)-(a.elevation||0)},
    AngelWingBarrierEngine:{TYPE:'ANGEL'},
    EquipmentDatabase:{get:()=>null},SkillDatabase:{passiveList:()=>[]},
    FallEngine:{tileElevation:()=>0,groundZ:()=>0,syncGroundZ:()=>0,
      fallDamage:()=>0,resolveLanding:({target})=>{target.z=0;return {damaging:false,damage:0}}},
    CollisionEngine:{MAX_CHAIN_DEPTH:4,
      occupantAt:(us,x,y,{excludeId}={})=>us.find(u=>u.alive&&u.id!==excludeId&&u.x===x&&u.y===y)||null,
      surfaceAt:({x,y})=>wall&&wall.x===x&&wall.y===y?{kind:'TERRAIN_FACE',solid:true}:null,
      terrainProfile:()=>({kind:'BOUNDARY'}),impactDamage:()=>0,canTransfer:()=>false},
    TrajectoryEngine:{begin:(m,u,lift)=>({z:lift,state:lift>0?'AIRBORNE':'GROUNDED'}),
      inspectStep:(m,t,x,y)=>({blocked:false,z:t.z}),advance:()=>{},isAirborneState:s=>s==='AIRBORNE'},
    EnvironmentEngine:{EFFECT:{BURNING:'BURNING'},effectAt:()=>[]},HydrologyEngine:{},
    EffectEngine:{isInvulnerable:u=>u.immune===true,breakStealth:()=>{},interruptChannel:()=>{},
      applyDamage:(u,damage)=>{const hpLoss=Math.min(u.hp,Math.max(0,Math.round(damage)));u.hp-=hpLoss;return{hpLoss,absorbed:0}}},
    UnitRuntimeEngine:{beginBloodTransaction:()=>{},endBloodTransaction:()=>{},attackEnhancement:()=>1,
      rollSanityMisfire:()=>false,onRageForcedLanding:()=>{}},
    UnitAnimationEngine:{emitMove:(...a)=>anim.push(a),emitAction:(...a)=>anim.push(a),
      emitResolvedHit:()=>{},emitHit:()=>{},emitOutcome:()=>{}},
    VerticalMobilityEngine:{bodyHeight:()=>2,syncUnit:(u,t)=>{u.z=t.elevation||0}},
    BattleEngine:{calculate:()=>({hit:true,crit:false,damage:30,type:'PHYSICAL'})},
    BattleResolution:{splitActualHpLoss:(_r,n)=>({physical:n,magic:0})},
    ResourceEngine:{RESOURCE_PROFILES},
  };
  stubs.globalThis=stubs;stubs.window=stubs;
  // Production engine modules export their declarations; VM needs only the
  // export keyword removed so that each owner registers on globalThis.
  for(const file of ['js/displacement-engine.js','js/post-engagement-engine.js'])
    vm.runInNewContext(src(file).replace(/^export /gm,''),stubs);
  vm.runInNewContext(src('js/tactical-action-controller.js'),stubs);
  let spent=0;
  const ctx={actionState:()=>({map,units,environmentState:null}),
    unitAt:(x,y)=>units.find(u=>u.alive&&u.x===x&&u.y===y)||null,
    coreAt:()=>null,targetType:s=>s.targetType,
    canUseSkill:()=>true,effectiveSkill:(_u,s)=>s,
    consumeSkill:()=>{spent++;return {cost:0,resources:{rage:{cost:20}}}},
    aoeTiles:(c,r)=>map.tiles.filter(t=>dist(c,t)<=r),
    enterTile:()=>{},pushLog:()=>{},resolveEnvironmentEvents:()=>{},
    applyEnvironmentHazardToUnit:()=>{},logPostEffect:e=>effects.push(e),
    logEnvironmentEvent:()=>{},checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,
    setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{}};
  const ctrl=stubs.TacticalActionController.create(ctx);
  return {map,units,actor,enemy,quake,anim,effects,ctrl,stubs,spent:()=>spent};
}

test('authoritative shockwave has a horizontal impulse alongside upward lift',()=>{
  const p=RESOURCE_PROFILES.rage;
  assert.equal(p.shockwavePushDistance,p.shockwaveLift);
  assert(p.shockwavePushDistance>0);
  assert.match(SkillDatabase.get('magda_leap_quake').description,/擊退.*震飛/);
});

test('targeted quake throws enemy outward instead of rising in place',()=>{
  const f=fixture();
  // Actor at (6,6), directly select enemy (7,6); nearest-side landing (6,6)
  // is the actor, so the legal nearest empty landing is beside the enemy.
  const aim=tile(f.map,f.enemy.x,f.enemy.y);
  assert(f.ctrl.mapTargetTiles(f.actor,f.quake).includes(aim));
  const start={x:f.enemy.x,y:f.enemy.y};
  assert.equal(f.ctrl.executeMapSkill(f.actor,aim,f.quake),true);
  assert.equal(f.spent(),1);
  assert.equal(f.enemy.hp,970);
  assert(f.effects.length>=1);
  const effect=f.effects[0].effect;
  assert.equal(effect.type,'KNOCKBACK');
  assert.equal(effect.distance,RESOURCE_PROFILES.rage.shockwavePushDistance);
  assert.equal(effect.lift,RESOURCE_PROFILES.rage.shockwaveLift);
  assert.notDeepEqual([f.enemy.x,f.enemy.y],[start.x,start.y], 'enemy must move horizontally');
  assert(f.anim.some(x=>x[1]?.kind==='AIRBORNE_FORCE'), 'reuse airborne forced-move animation');
});

test('all cardinal directions throw outward and the existing weight rule shortens travel',()=>{
  const original=RESOURCE_PROFILES.rage.shockwavePushDistance;
  for(const [weight,resistance] of [['LIGHT',0],['MEDIUM',1],['HEAVY',2]]){
    const f=fixture({armorWeight:weight});
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      f.enemy.x=7;f.enemy.y=7;f.enemy.z=0;f.enemy.hp=1000;
      f.actor.x=7-dx;f.actor.y=7-dy;
      const out=f.stubs.PostEngagementEngine.forcedMove({
        map:f.map,units:f.units,source:f.actor,target:f.enemy,
        effect:{type:'KNOCKBACK',distance:original,lift:RESOURCE_PROFILES.rage.shockwaveLift}});
      const traveled=Math.max(0,original-resistance);
      assert.equal(f.enemy.x,7+dx*traveled,`${weight}, dx=${dx}, dy=${dy}: x`);
      assert.equal(f.enemy.y,7+dy*traveled,`${weight}, dx=${dx}, dy=${dy}: y`);
      assert.equal(out.displacement.distance,traveled);
      assert.equal(out.lift,Math.max(0,RESOURCE_PROFILES.rage.shockwaveLift-resistance));
      assert.equal(out.occupancySafe,true);
    }
  }
});

test('wall collision stops outward throw and the original collision owner reports it',()=>{
  const f=fixture({wall:{x:8,y:7}});
  f.enemy.x=7;f.enemy.y=7;f.actor.x=6;f.actor.y=7;
  const out=f.stubs.PostEngagementEngine.forcedMove({
    map:f.map,units:f.units,source:f.actor,target:f.enemy,
    effect:{type:'KNOCKBACK',distance:RESOURCE_PROFILES.rage.shockwavePushDistance,
      lift:RESOURCE_PROFILES.rage.shockwaveLift}});
  assert.deepEqual([f.enemy.x,f.enemy.y],[7,7]);
  assert(out.collisions.some(c=>c.kind==='TERRAIN_FACE'||c.kind==='TERRAIN'),'collision logged');
  assert(out.applied,true);
});

test('immune target does not get pushed or lifted',()=>{
  const f=fixture();f.enemy.immune=true;
  const out=f.stubs.PostEngagementEngine.forcedMove({
    map:f.map,units:f.units,source:f.actor,target:f.enemy,
    effect:{type:'KNOCKBACK',distance:RESOURCE_PROFILES.rage.shockwavePushDistance,
      lift:RESOURCE_PROFILES.rage.shockwaveLift}});
  assert.deepEqual([f.enemy.x,f.enemy.y],[7,6]);
  assert.equal(out.displacement.immune,true);
  assert.equal(out.applied,false);
});

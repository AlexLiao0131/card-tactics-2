import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {UnitRenderer} from '../../js/unit-renderer.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=name=>fs.readFileSync(path.join(root,name),'utf8');
const plain=(x,y,z=0)=>({x,y,elevation:z,terrain:'PLAIN'});
function fixture(){
  const map={tiles:Array.from({length:25},(_,i)=>plain(i%5,Math.floor(i/5)))},
    attacker={id:'magda',character:{name:'瑪格妲',collision:{height:2}},alive:true,
      team:'P',x:0,y:2,z:0,acted:false,waited:false},
    enemy={id:'enemy',alive:true,team:'E',x:3,y:2,z:0},
    units=[attacker,enemy];
  const skill={id:'magda_leap_quake',name:'跳躍震地',range:{min:1,max:3},shape:'W_STEP',
    jumpShockwave:true,moveToTarget:true,targetType:'AOE',areaDamage:{mode:'PHYSICAL_IMPACT',relation:'ENEMY'}};
  const seen=new Set(map.tiles.map(t=>`${t.x},${t.y}`));
  let spent=0;
  const sandbox={console,TERRAINS:{PLAIN:{passable:true}},AngelWingBarrierEngine:{TYPE:'ANGEL'},
    TacticalEngine:{
      range:s=>s.range,
      teamCanSee:(m,us,team,tile)=>seen.has(`${tile.x},${tile.y}`),
      canSee:()=>false,  // Horizontal caster LOS is obstructed by enemy line
      canOccupyTerrain:()=>true,
      isBlockedByObject:()=>false,
      tile:(m,x,y)=>m.tiles.find(t=>t.x===x&&t.y===y)||null,
    },
    UnitRuntimeEngine:{},
    EffectEngine:{},
    EnvironmentEngine:{},
    HydrologyEngine:{},
    ...{},
  };
  sandbox.globalThis=sandbox;
  vm.runInNewContext(source('js/tactical-action-controller.js'),sandbox);
  const ctx={
    actionState:()=>({map,units,environmentState:null}),
    unitAt:(x,y)=>units.find(u=>u.alive&&u.x===x&&u.y===y)||null,
    canUseSkill:()=>true,
    consumeSkill:()=>{spent++;return {cost:20};},
    targetType:s=>s.targetType,
  };
  const controller=sandbox.TacticalActionController.create(ctx);
  return{controller,map,attacker,enemy,skill,units,seen,spent:()=>spent,sandbox};
}

test('瑪格妲可跳過遮擋視線的敵人，選取其身後隊伍已知的空格',()=>{
  const f=fixture(),tiles=f.controller.mapTargetTiles(f.attacker,f.skill);
  assert(tiles.some(t=>t.x===2&&t.y===2));
  assert(tiles.some(t=>t.x===2&&t.y===1));
  assert(!tiles.some(t=>t.x===3&&t.y===2),'occupied enemy tile must not be a legal landing');
});
test('空中跳躍不會揭露未知落點，也不能穿牆落在不可用位置',()=>{
  const f=fixture();f.seen.delete('2,2');
  assert(!f.controller.mapTargetTiles(f.attacker,f.skill).some(t=>t.x===2&&t.y===2));
  f.seen.add('2,2');
  f.sandbox.TacticalEngine.isBlockedByObject=(m,x,y)=>x===2&&y===2;
  assert(!f.controller.mapTargetTiles(f.attacker,f.skill).some(t=>t.x===2&&t.y===2));
});
test('非法落點在消耗憤怒前拒絕，不會移動單位',()=>{
  const f=fixture();f.seen.delete('2,2');
  assert.equal(f.controller.executeMapSkill(f.attacker,plain(2,2),f.skill),false);
  assert.equal(f.spent(),0);assert.equal(f.attacker.x,0);assert.equal(f.attacker.y,2);
});
test('傳統橫向瞄準法術仍然受施法視線限制',()=>{
  const f=fixture(),ordinary={...f.skill,id:'other_skill',jumpShockwave:false};
  assert.equal(f.controller.mapTargetTiles(f.attacker,ordinary).length,0);
});
test('UnitAnimationEngine official LEAP event carries elevated arc without changing game-state grid',async()=>{
  await import('../../js/unit-animation-engine.js');
  const engine=globalThis.UnitAnimationEngine;
  engine.clear();
  const unit={id:'magda',x:2,y:2,z:1,facing:'E'};
  const event=engine.emitMove(unit,{from:{x:0,y:2,z:0},path:[{x:0,y:2,z:0},unit],
    kind:'LEAP',arcHeight:2.5,duration:750});
  assert.equal(event.kind,'LEAP');assert.equal(event.arcHeight,2.5);
  assert.equal(event.path[0].x,0);assert.equal(event.path.at(-1).x,2);
  assert.equal(event.state,'WALK');
  assert.deepEqual([unit.x,unit.y,unit.z],[2,2,1]);
  engine.clear();
});
test('Babylon FIGURE LEAP midair rises above terrain and does not apply ground walk gait',()=>{
  class Vec3{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}copyFrom(v){this.x=v.x;this.y=v.y;this.z=v.z;}}
  globalThis.BABYLON={Vector3:Vec3};
  const renderer=Object.create(UnitRenderer.prototype);
  renderer.positionFor=(entry,p)=>new Vec3(p.x*2,p.z*.8,p.y*2);
  renderer.markerPositionFor=p=>new Vec3(p.x*2,p.z*.8,p.y*2);
  renderer.applyFacing=()=>{};
  renderer.applyFigureWalk=()=>{throw new Error('LEAP must not be rendered as walking')};
  const entry={root:{position:new Vec3(),rotation:{}},facingMarker:{root:{position:new Vec3()}},
    figureParts:{leftLeg:{rotation:{x:0}},rightLeg:{rotation:{x:0}}},kind:'FIGURE',definition:{figure:{twoHanded:true}}};
  const unit={facing:'E'},event={kind:'LEAP',arcHeight:2.5,facing:'E',path:[{x:0,y:0,z:0},{x:2,y:0,z:0}]};
  renderer.applyWalk(entry,unit,event,0,{});assert.equal(entry.root.position.y,0);
  renderer.applyWalk(entry,unit,event,.5,{});
  assert.equal(entry.root.position.x,2);
  assert(Math.abs(entry.root.position.y-2.0)<.00001);
  assert.equal(entry.facingMarker.root.position.y,0);
  renderer.applyWalk(entry,unit,event,1,{});assert(Math.abs(entry.root.position.y)<.00001);
});
test('憤怒紅條、其他角色顏色保留、未知資源不再默認紫色',()=>{
  const hud=source('css/unit-hud.css');
  assert.match(hud,/data-resource="rage"\] \.unit-hud-fill\{background:#c53838\}/);
  assert.match(hud,/\.unit-hud-resource \.unit-hud-fill\{background:#8b98a7\}/);
  for(const kind of ['faith','blood','forestSoul','humidity','duality'])
    assert(hud.includes(`data-resource="${kind}"`),`missing ${kind}`);
  const card=source('css/hero-card.css');
  assert(card.includes('.hero-card__resource[data-resource="rage"],.hero-info-resource[data-resource="rage"] span{color:#c53838}'));
  assert(card.includes('color: #aeb8c4; font-weight: 850;'),'unknown card resources must default to neutral');
  for(const kind of ['faith','blood','sanity','humidity','forestSoul','holyPower'])
    assert(card.includes(`data-resource="${kind}"`),`missing card color ${kind}`);
});

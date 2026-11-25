import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'../../');
const main=readFileSync(resolve(dir,'js/tactical-game.js'),'utf8');
const action=readFileSync(resolve(dir,'js/tactical-action-controller.js'),'utf8');
const babylon=readFileSync(resolve(dir,'js/babylon-renderer.js'),'utf8');
await import('../../js/tactical-action-controller.js');

function setup(){
  const map={id:'test-map',tiles:[]};
  for(let y=0;y<9;y++)for(let x=0;x<9;x++)map.tiles.push({x,y,elevation:0,terrain:'PLAIN'});
  const actor={id:'safiya',team:'P',x:4,y:4,z:0,alive:true,moved:true,acted:false,
    resources:{reputation:{value:0,max:100}},character:{id:'safiya',passives:[],combat:{move:4}}};
  const near={id:'friend',team:'P',x:5,y:4,alive:true};
  const enemy={id:'enemy',team:'E',x:6,y:4,alive:true,hp:100};
  const hidden={id:'hidden',team:'E',x:4,y:6,alive:true,hp:10};
  const units=[actor,near,enemy,hidden];
  globalThis.ResourceEngine={RESOURCE_PROFILES:{reputation:{rangeThresholds:[0,40,80],rangeRadii:[1,2,3]}}};
  globalThis.AngelWingBarrierEngine={TYPE:'ANGEL_WING_BARRIER'};
  globalThis.TacticalEngine={
    tile:(map,x,y)=>map.tiles.find(t=>t.x===x&&t.y===y)||null,
    reachable:()=>new Map(),range:skill=>skill.range,
    teamCanSee:(map,units,team,target)=>target?.id!=='hidden',
    hasLineOfSight:(map,from,tile)=>tile.x!==3,
    canTarget:(map,unit,target,skill)=>
      (skill.target!=='ENEMY'||unit.team!==target.team)&&
      Math.abs(unit.x-target.x)+Math.abs(unit.y-target.y)<=Number(skill.range?.max||0),
    pathTo:(map,units,unit,x,y)=>x===3?[]:[{x,y}],
    canSee:()=>true
  };
  const ctx={actionState:()=>({map,units,environmentState:{}}),
    targetType:skill=>skill.targetType||'SINGLE',
    combatTargets:unit=>units.filter(u=>u.id!==unit.id),
    sanctuaryTiles:()=>map.tiles.filter(t=>t.y===4&&t.x>=4&&t.x<=6),
    unitAt:(x,y)=>units.find(u=>u.x===x&&u.y===y)};
  return{map,actor,near,enemy,hidden,controller:globalThis.TacticalActionController.create(ctx)};
}

const asCells=tiles=>new Set(tiles.map(t=>`${t.x},${t.y}`));

test('薩菲雅技能長按依當下聲望改變實際覆蓋格，零消耗',()=>{
  const {actor,controller}=setup(),skill={id:'safiya_inspiring_dance',target:'SELF',danceAura:{kind:'INSPIRE'}};
  const before=JSON.stringify(actor);
  const low=controller.previewSkillArea(actor,skill);
  assert.equal(low.radius,1);assert.equal(low.tiles.length,5);assert.equal(low.kind,'ALLY');
  assert.equal(JSON.stringify(actor),before,'Preview must be pure');
  actor.resources.reputation.value=60;
  const high=controller.previewSkillArea(actor,skill);
  assert.equal(high.radius,2);assert.equal(high.tiles.length,13);
  actor.resources.reputation.value=100;
  assert.equal(controller.previewSkillArea(actor,skill).radius,3);
});

test('正式歌曲半徑和圣域地形限制不自行猜測',()=>{
  const {actor,controller}=setup();
  const song=controller.previewSkillArea(actor,{id:'ocean',target:'SELF',channel:{type:'SONG_CHANNEL',radius:2}});
  assert.equal(song.tiles.length,13);assert.equal(song.targets.length,0);
  const sanctuary=controller.previewSkillArea(actor,{id:'sanctuary',target:'SELF',sanctuary:true,radius:2});
  assert.deepEqual([...asCells(sanctuary.tiles)].sort(),['4,4','5,4','6,4']);
});

test('死亡之舞紅色合法候選不顯示藏在迷霧的敵人',()=>{
  const {actor,controller}=setup();actor.resources.reputation.value=55;
  const preview=controller.previewSkillArea(actor,{id:'safiya_dance_of_death',target:'SELF',deathDance:{}});
  assert.deepEqual(preview.targets.map(t=>t.id),['enemy']);
});

test('單體技能沿用正式射程和視線，非法或不可見敵人不會標成合法',()=>{
  const {actor,controller}=setup();
  const preview=controller.previewSkillArea(actor,{id:'test-attack',target:'ENEMY',targetType:'SINGLE',range:{min:1,max:2}});
  assert.ok(asCells(preview.tiles).has('6,4'));
  assert.ok(!asCells(preview.tiles).has('3,4'));
  assert.deepEqual(preview.targets.map(t=>t.id),['enemy']);
});

test('一般範圍施法共用既有 mapTargetTiles 並不實際施放',()=>{
  const {actor,controller}=setup();
  const skill={id:'aoe',target:'TILE',targetType:'AOE',range:{min:1,max:3}};
  const preview=controller.previewSkillArea(actor,skill);
  assert.ok(asCells(preview.tiles).has('6,4'));
  assert.ok(!asCells(preview.tiles).has('4,4'));
  assert.equal(preview.targets.length,0);
});

const classBody=babylon.slice(babylon.indexOf('  showSkillHoldPreview(preview){'),babylon.indexOf('  sync(state,presentationEvents=[])'));
assert.ok(classBody.startsWith('  showSkillHoldPreview'));
const RendererHarness=new Function(`return class RendererHarness {${classBody}}`)();
function paintHarness(){
  const x=new RendererHarness();x.history=[];
  x.highlights={sync:frame=>x.history.push(frame)};
  x.syncSubsystem=(name,fn)=>{fn();return true;};
  x.unitHud={sync:()=>{}};x.syncActionAnchor=()=>{};
  const original={map:{id:'test-map',tiles:[{x:1,y:2,reachable:true},{x:2,y:2},{x:3,y:2}]},units:[]};
  x.lastState=original;return{x,original};
}

test('Babylon 高亮按住顯示藍色範圍紅色合法目標，放開完全還原',()=>{
 const {x,original}=paintHarness();
 assert.equal(x.showSkillHoldPreview({mapId:'test-map',kind:'AIM',tiles:[{x:1,y:2},{x:2,y:2}],targets:[{x:2,y:2}]}),true);
 const t=x.history.at(-1).map.tiles;
 assert.equal(t[0].reachable,true);assert.equal(t[0].attackable,false);
 assert.equal(t[1].attackable,true);assert.equal(t[2].reachable,false);
 assert.equal(original.map.tiles[0].reachable,true);
 x.clearSkillHoldPreview();assert.equal(x.history.at(-1),original);
 assert.equal(x.skillHoldPreview,null);
});

test('長按友軍範圍顯示綠色，線上互動重繪仍保持預覽且清除',()=>{
 const {x,original}=paintHarness();
 assert.equal(x.showSkillHoldPreview({mapId:'test-map',kind:'ALLY',tiles:[{x:1,y:2},{x:2,y:2}]}),true);
 assert.equal(x.history.at(-1).map.tiles[0].deployable,true);
 const second={...original,map:{...original.map,tiles:original.map.tiles.map(t=>({...t}))}};
 assert.equal(x.syncInteractionPresentation(second),true);
 assert.equal(x.history.at(-1).map.tiles[0].deployable,true);
 x.clearSkillHoldPreview();assert.equal(x.history.at(-1),second);
});

test('現有共享 skillBar 長按與 PvP 正式投影接入，不會呼叫施放命令',()=>{
 assert.match(main,/const inspectableSkillButtons=BattleCommandMenuUI\.skillRegistry/);
 assert.match(main,/showSkillInspection\(button,skill,record\)/);
 assert.match(main,/previewOfflineSkillRange\(skill\)/);
 assert.match(main,/previewOnlineSkillRange\(skill\)/);
 assert.match(main,/CardTacticsRenderer\?\.clearSkillHoldPreview\?\.\(\)/);
 assert.match(main,/PVP 射程示意（合法目標以伺服器為準）/);
 assert.match(action,/function previewSkillArea\(unit,skill\)/);
 assert.doesNotMatch(main.slice(main.indexOf('  function previewOnlineSkillRange('),main.indexOf('  function dismissSkillInspection(')),/sendCommand|\.request\(/);
});

test('合法多格怪物的目標標記覆蓋完整佔位格而不是只有中心',()=>{
 const {controller,actor,enemy}=setup();
 globalThis.TacticalEngine.occupiedCells=target=>
   target.id==='enemy'?[{x:6,y:4},{x:7,y:4},{x:6,y:5},{x:7,y:5}]:[{x:target.x,y:target.y}];
 const result=controller.previewSkillArea(actor,{id:'single',target:'ENEMY',targetType:'SINGLE',range:{min:1,max:2}});
 assert.equal(result.targets.find(t=>t.id==='enemy').cells.length,4);
});

test('換地圖或取消長按不會保留舊戰場的預覽',()=>{
 const {x,original}=paintHarness();
 x.showSkillHoldPreview({mapId:'test-map',kind:'ALLY',tiles:[{x:1,y:2}]});
 x.lastState={...original,map:{id:'different-map',tiles:original.map.tiles}};
 assert.equal(x.paintSkillHoldPreview(),false);
 assert.equal(x.skillHoldPreview,null);
 x.clearSkillHoldPreview();
 assert.equal(x.history.length,1,'old map must not be redrawn');
});

test('old hold preview never replaces active draggable area frame',()=>{
 const {x,original}=paintHarness();
 assert.equal(x.showSkillHoldPreview({mapId:'test-map',kind:'ALLY',tiles:[{x:1,y:2}]}),true);
 const aimed={...original,presentation:{areaAimActive:true,aimCenter:{x:1,y:2}}};
 assert.equal(x.syncInteractionPresentation(aimed),true);
 assert.equal(x.history.at(-1),aimed);assert.equal(x.skillHoldPreview,null);
 assert.equal(x.showSkillHoldPreview({mapId:'test-map',kind:'ALLY',tiles:[{x:1,y:2}]}),false);
 assert.equal(x.history.at(-1),aimed);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const profile=read('js/resource-profile-database.js');
const battle=read('js/battle-resolution.js');
const tactical=read('js/tactical-action-controller.js');
const skills=read('js/skill-database.js');
const starfall=read('js/card-database.js');

// Exercise the verbatim formal postQueue and armor classification functions.
// These are extracted from the official resolution owner, not reimplemented.
function buildPostQueue(){
  const a=battle.indexOf('  function uppercutHitsHeavyArmor(');
  const b=battle.indexOf('  // A weapon attack',a);
  assert(a>0&&b>a,'official skill post-queue function exists');
  const source=battle.slice(a,b);
  const rage={uppercutLift:4,shockwavePushDistance:2};
  const context={ResourceEngine:{RESOURCE_PROFILES:{rage}},EquipmentDatabase:{get:()=>null}};
  context.globalThis=context;
  return vm.runInNewContext(`(()=>{${source}; return postQueue})()`,context);
}
function entry(armorType){
 const source={id:'magda',x:3,y:3};
 const target={id:'enemy',alive:true,x:4,y:3,character:{armor:{type:armorType}}};
 return{id:1,role:'INITIATOR',actor:source,target,skill:{id:'magda_breaking_cleave',giantUppercut:true},result:{hit:true,damage:10}};
}

test('星隕既有水平位移基準採 2 格、水平無重量抵抗、垂直保留重量抵抗',()=>{
  assert.match(starfall,/starfall_card:\{[^\n]*shockwave:\{[^\n]*distance:2,lift:2[^\n]*resistAxes:\{horizontal:false,vertical:true\}/);
  assert.match(profile,/shockwavePushDistance:2/);
});

test('破陣劈斬：無甲、輕甲、中甲、重甲都使用星隕的水平位移判定＋既有垂直高度',()=>{
  const postQueue=buildPostQueue();
  for (const armor of ['NONE','LIGHT','MEDIUM','HEAVY']){
    const q=postQueue([entry(armor)]);
    assert.equal(q.length,1,armor);
    const e=q[0].effect;
    assert.equal(e.type,'KNOCKBACK');
    assert.equal(e.distance,2,armor);
    assert.equal(e.lift,4,armor);
    assert.equal(e.resistAxes.horizontal,false,armor);
    assert.equal(e.resistAxes.vertical,true,armor);
  }
});

test('破陣劈斬：重甲也會進入擊飛佇列，同時保留原本的破甲效果',()=>{
  const q=buildPostQueue()([entry('HEAVY')]);
  assert.equal(q.length,1);
  assert.equal(q[0].effect.distance,2);
  assert.equal(q[0].effect.lift,4);
  assert.match(battle,/uppercutHitsHeavyArmor\(entry\.target\)/);
  assert.match(battle,/MAGDA_ARMOR_BREAK/);
  assert.match(battle,/name:'巨劍破甲',value:20,duration:2/);
});

test('震地擊：使用同一個星隕式抗性選項和水平位移主參數',()=>{
  assert.match(tactical,/const distance=Number\(rageProfile\?\.shockwavePushDistance\|\|0\)/);
  assert.match(tactical,/const effect=\{type:'KNOCKBACK',distance,lift,\s*resistAxes:\{horizontal:false,vertical:true\}\}/);
  assert.match(tactical,/PostEngagementEngine\.forcedMove\(\{map,units:state\(\)\.units,/);
});

test('破陣與震地的文字解說如實告知重甲可以擊飛並破甲',()=>{
 assert.match(skills,/無甲至重甲都會向後擊退並向上擊飛/);
 assert.match(skills,/重甲另會降低防禦/);
 assert.match(skills,/將命中的敵軍朝遠離落點的方向擊退並震飛/);
});

test('未命中、目標已陣亡與普通攻擊不生成破陣專用的擊飛',()=>{
 const fn=buildPostQueue();
 let e=entry('LIGHT');e.result.hit=false;assert.equal(fn([e]).length,0);
 e=entry('LIGHT');e.target.alive=false;assert.equal(fn([e]).length,0);
 e=entry('LIGHT');e.skill.giantUppercut=false;assert.equal(fn([e]).length,0);
});

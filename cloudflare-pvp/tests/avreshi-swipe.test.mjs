import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {SKILLS} from '../../js/skill-database.js';
import {CHARACTERS} from '../../js/character-database.js';
import {LOADOUTS} from '../../js/loadout-database.js';
import {VfxDatabase} from '../../js/vfx-database.js';

const here=dirname(fileURLToPath(import.meta.url));
const swipe=SKILLS.avreshi_swipe;
const cheetah=CHARACTERS.avreshi.forms.CHEETAH;

test('豹形態可用揮擊；人、海豹、烏鴉不可用；整備登錄一致',()=>{
  assert.ok(swipe);
  assert.equal(swipe.name,'揮擊');
  assert.ok(cheetah.skillIds.includes(swipe.id));
  for(const form of ['HUMAN','SEAL','RAVEN'])assert.ok(!CHARACTERS.avreshi.forms[form].skillIds.includes(swipe.id));
  assert.ok(LOADOUTS.avreshi_default.skillIds.includes(swipe.id));
  assert.equal(new Set(LOADOUTS.avreshi_default.skillIds).size,LOADOUTS.avreshi_default.skillIds.length);
});

test('揮擊按原有爪擊威力、撕碎 MP、撕咬流血結算',()=>{
  assert.equal(swipe.category,'ATTACK');
  assert.equal(swipe.attackType,'SLASH');
  assert.equal(swipe.power,SKILLS.avreshi_claw.power);
  assert.equal(swipe.manaCost,SKILLS.avreshi_shred.manaCost);
  assert.equal(swipe.weapon,'claw');
  assert.deepEqual(swipe.range,{min:0,max:0});
  assert.equal(swipe.target,'TILE');
  assert.equal(swipe.targetType,'AOE');
  assert.equal(swipe.radius,1);
  assert.deepEqual(swipe.areaDamage,{mode:'PHYSICAL_SWEEP',relation:'ENEMY',footprint:'ADJACENT_8',hitRule:'STANDARD'});
  assert.deepEqual(swipe.statusEffects[0],SKILLS.avreshi_bite.statusEffects[0]);
  assert.equal(swipe.support,false);
  assert.equal(swipe.astralGain,undefined);
});

test('八方向範圍固定為自身周圍八格，不包含兩格外',()=>{
  const tiles=[];for(let x=0;x<7;x++)for(let y=0;y<7;y++)tiles.push({x,y});
  const center={x:3,y:3};
  const plusRadiusTwo=tiles.filter(t=>Math.abs(t.x-center.x)+Math.abs(t.y-center.y)<=2);
  const footprint=plusRadiusTwo.filter(t=>Math.max(Math.abs(t.x-center.x),Math.abs(t.y-center.y))<=swipe.radius);
  assert.equal(footprint.length,9);
  assert.equal(footprint.filter(t=>!(t.x===center.x&&t.y===center.y)).length,8);
  assert.ok(footprint.some(t=>t.x===2&&t.y===2));
  assert.ok(footprint.some(t=>t.x===4&&t.y===4));
  assert.ok(!footprint.some(t=>t.x===5||t.y===5));
});

test('PVP 正式地格施法驗證接受揮擊並拒絕非法版本',()=>{
  const raw=readFileSync(resolve(here,'../src/pvp-headless-map-skills.mjs'),'utf8');
  const body=raw.split('export function isCanonicalImmediateMapSkill(skill){')[1]
    ?.split('export function canonicalImmediateMapSkillOptions')[0];
  assert.ok(body,'canonical map validator missing');
  const validate=vm.runInNewContext('function isCanonicalImmediateMapSkill(skill){'+body+'; isCanonicalImmediateMapSkill',{
    AngelWingBarrierEngine:{TYPE:'HOLY_WING_BARRIER',isCanonicalSkill:()=>false},
    isCanonicalSpatialTransitSkill:()=>false,
    isCanonicalLineTransitSkill:()=>false,
    isCanonicalRangerVolleySkill:()=>false,
    EnvironmentEngine:{FORCE:{}},
  });
  assert.equal(validate(swipe),true);
  assert.equal(validate({...swipe,areaDamage:{...swipe.areaDamage,relation:'ALL'}}),false);
  assert.equal(validate({...swipe,areaDamage:{...swipe.areaDamage,footprint:'ANY'}}),false);
  assert.equal(validate({...swipe,statusEffects:[]}),false);
  assert.equal(validate({...swipe,range:{min:1,max:1}}),false);
});

test('共享爪擊 Babylon VFX 已登錄，不新增獨立 VFX 引擎',()=>{
  assert.deepEqual(VfxDatabase.routeSkill(swipe.id),['wild-magic']);
  assert.equal(VfxDatabase.roleFor('wild-magic',swipe.id),'SHRED');
});

test('正式範圍傷害在有效扣血後才施加流血，且不波及隊友或自身',()=>{
  const raw=readFileSync(resolve(here,'../../js/tactical-action-controller.js'),'utf8');
  assert.match(raw,/\['MAGIC_POWER','PHYSICAL_VOLLEY','PHYSICAL_IMPACT','PHYSICAL_SWEEP'\]/);
  assert.match(raw,/footprint==="ADJACENT_8"/);
  assert.match(raw,/if\(relation==="ENEMY"&&occupant\.id===attacker\.id\)return;/);
  assert.match(raw,/if\(relation==="ENEMY"&&occupant\.team===attacker\.team&&!sanityMisfire\)return;/);
  assert.match(raw,/if\(hpLoss>0&&occupant\.hp>0&&Array\.isArray\(skill\.statusEffects\)\)/);
  assert.match(raw,/EffectEngine\.apply\(\{source:attacker,target:occupant,effect\}\)/);
});

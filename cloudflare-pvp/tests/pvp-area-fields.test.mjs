import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {createCanonicalAreaFields,isCanonicalAreaFieldSkill} from '../src/pvp-field-controller.mjs';
import {isSanctuaryProtected} from '../../js/battle-area-field-engine.js';
import {SkillDatabase,SKILLS} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';

function make(){
 const deck=Array(20).fill('imperial_swordsman_card');
 let g=createOpeningGame({decks:[deck,deck],serverSeed:987234});
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
 beginCanonicalPlayerCardPhase(g);
 const slots=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
 const positions=slots.filter(p=>globalThis.TERRAINS[TacticalEngine.tile(g.battlefield.map,p.x,p.y)?.terrain]?.passable);
 assert.ok(positions.length>=2);
 withCanonicalEngines(g,e=>{
   for(const [id,characterId,position] of [['saint','church_saint',positions[0]],['cat','cat_thief_hero',positions[1]]]){
     const unit=e.unitRuntime.create({id,team:'P',characterId,x:position.x,y:position.y,
       map:g.battlefield.map,cores:g.battlefield.cores});
     assert.ok(unit);delete unit._runtimeMap;g.units.push(unit);
   }
 });
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 return g;
}
function hooks(){return {pushLog:()=>{},handleDefeated:()=>{}}}
const cast=(g,id,skillId)=>resolveCanonicalPlayerCommand(g,{type:'CAST_AREA_FIELD',unitId:id,skillId},0);

test('canonical field skill metadata automatically recognizes smoke and sanctuary but no unimplemented mechanic',()=>{
 assert.equal(isCanonicalAreaFieldSkill(SkillDatabase.get('cat_smoke_bomb')),true);
 assert.equal(isCanonicalAreaFieldSkill(SkillDatabase.get('saint_sanctuary')),true);
 const copy={...SkillDatabase.get('cat_smoke_bomb'),id:'qa_dynamic_smoke'};
 const unsupported={...copy,id:'qa_unknown_field',teleport:true,smokeField:null};
 SKILLS[copy.id]=copy;SKILLS[unsupported.id]=unsupported;
 try{
  const g=make();
  g.units[1].grantedSkills.push({skillId:copy.id,remaining:null});
  const options=tacticalDebugProjection(g,0).units.find(u=>u.id==='cat').areaFieldSkills;
  assert.ok(options.some(s=>s.id===copy.id));
  assert.equal(isCanonicalAreaFieldSkill(unsupported),false);
  assert.equal(tacticalDebugProjection(g,1).units.find(u=>u.id==='cat')?.areaFieldSkills,undefined);
 }finally{delete SKILLS[copy.id];delete SKILLS[unsupported.id]}
});

test('smoke is an official persistent terrain field: granting and removing cover at the original radius and expiry',()=>{
 const g=make(),cat=g.units.find(u=>u.id==='cat');
 const initialMana=cat.mana;
 const sent=cast(g,cat.id,'cat_smoke_bomb');
 assert.equal(sent.accepted,true);
 assert.equal(cat.mana,initialMana-SkillDatabase.get('cat_smoke_bomb').manaCost);
 assert.equal(cat.acted,true);
 assert.equal(g.fieldState.smokeFields.length,1);
 assert.ok(Array.isArray(g.fieldState.smokeFields[0].cells));
 assert.ok(g.fieldState.smokeFields[0].cells.includes(`${cat.x},${cat.y}`));
 assert.ok(cat.effects.some(e=>e.id==='SMOKE_COVER'));
 const recovered=structuredClone(g);
 withCanonicalEngines(recovered,e=>{
   const fields=createCanonicalAreaFields(recovered,e,hooks());
   assert.equal(fields.state.smokeFields.length,1);
   recovered.round=2;
   fields.expireSmoke();
   assert.equal(recovered.fieldState.smokeFields.length,1);
   recovered.round=3;
   fields.expireSmoke();
   assert.equal(recovered.fieldState.smokeFields.length,0);
   assert.equal(recovered.units.find(u=>u.id==='cat').effects.some(e=>e.id==='SMOKE_COVER'),false);
 });
});

test('sanctuary HEALING has canonical MP-free full faith cast, heals immediately and persists wards over room restart',()=>{
 const g=make(),saint=g.units.find(u=>u.id==='saint');
 saint.hp-=35;
 withCanonicalEngines(g,e=>e.unitRuntime.changeFaith(saint,100-e.unitRuntime.faithValue(saint)));
 const beforeMana=saint.mana,beforeHp=saint.hp;
 assert.equal(cast(g,'saint','saint_sanctuary').accepted,true);
 assert.equal(saint.mana,beforeMana);
 assert.equal(saint.hp,beforeHp+20);
 assert.equal(g.fieldState.sanctuaries.length,1);
 assert.equal(isSanctuaryProtected(g.fieldState,saint),true);
 const saved=structuredClone(g);
 withCanonicalEngines(saved,e=>{
   const field=createCanonicalAreaFields(saved,e,hooks());
   const u=saved.units.find(u=>u.id==='saint');
   assert.equal(e.effect.applyDamage(u,50,{damageType:'MAGIC'}).hpLoss,0);
   saved.round=2;u.hp-=20;
   field.tickSanctuaries('P');
   assert.equal(u.hp,beforeHp+20);
   assert.equal(field.sanctuaries[0].ticksRemaining,1);
   saved.round=3;field.tickSanctuaries('P');
   assert.equal(field.sanctuaries[0].ticksRemaining,0);
   saved.round=4;field.tickSanctuaries('P');
   assert.equal(field.sanctuaries.length,0);
 });
});

test('sanctuary PUNISHMENT uses canonical faith-zero MP and real holy damage with friend exclusion',()=>{
 const g=make(),saint=g.units[0];
 withCanonicalEngines(g,e=>e.unitRuntime.changeFaith(saint,-e.unitRuntime.faithValue(saint)));
 const enemy=structuredClone(g.units[1]);enemy.id='target_enemy';enemy.team='E';enemy.acted=false;
 const tile=TacticalEngine.tile(g.battlefield.map,saint.x,saint.y);
 enemy.x=saint.x;enemy.y=saint.y;enemy.z=Number(tile.elevation||0);
 g.units.push(enemy);
 const hp=enemy.hp,mana=saint.mana,allyHp=saint.hp;
 const out=cast(g,'saint','saint_sanctuary');
 assert.equal(out.accepted,true);
 assert.equal(saint.mana,mana-SkillDatabase.get('saint_sanctuary').manaCost);
 assert.ok(enemy.hp<hp);
 assert.equal(saint.hp,allyHp);
 assert.equal(g.fieldState.sanctuaries[0].mode,'PUNISHMENT');
});

test('field placement rejects forged payload, other-seat cast and no resources without affecting battle state',()=>{
 const g=make();let before=structuredClone(g);
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_AREA_FIELD',unitId:'cat',skillId:'cat_smoke_bomb',damage:999999},0),{code:'INVALID_AREA_FIELD_COMMAND'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_AREA_FIELD',unitId:'cat',skillId:'cat_smoke_bomb'},1),{code:'NOT_YOUR_TURN'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_AREA_FIELD',unitId:'cat',skillId:'ophi_healing_song'},0),{code:'CANONICAL_FIELD_SKILL_UNAVAILABLE'});
 assert.deepEqual(g,before);
});

test('terrain field flood-fill blocks cliffs, walls and follows existing tactical elevation',()=>{
 const g=make(),map=g.battlefield.map;
 withCanonicalEngines(g,e=>{
   const fields=createCanonicalAreaFields(g,e,hooks());
   const center={x:0,y:0};
   const origin=TacticalEngine.tile(map,center.x,center.y);
   assert.ok(origin);
   const old=origin.terrain;origin.terrain='PLAIN';
   const east=TacticalEngine.tile(map,1,0),south=TacticalEngine.tile(map,0,1);
   assert.ok(east&&south);
   const oldEast={terrain:east.terrain,elevation:east.elevation};
   const oldSouth={terrain:south.terrain,elevation:south.elevation};
   origin.elevation=0;east.elevation=3;east.terrain='PLAIN';south.terrain='WALL';
   const covered=fields.sanctuaryTiles(center,1);
   assert.deepEqual(covered.map(t=>`${t.x},${t.y}`),['0,0']);
   origin.terrain=old;east.terrain=oldEast.terrain;east.elevation=oldEast.elevation;
   south.terrain=oldSouth.terrain;south.elevation=oldSouth.elevation;
 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {isCanonicalSelfChannelSkill} from '../src/pvp-headless-effect-skills.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {SKILLS,SkillDatabase} from '../../js/skill-database.js';

function make(){
 const deck=Array(20).fill('imperial_swordsman_card');
 let g=createOpeningGame({decks:[deck,deck],serverSeed:987234});
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
 beginCanonicalPlayerCardPhase(g);
 const slots=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
 const p0=slots.find(p=>globalThis.TERRAINS[TacticalEngine.tile(g.battlefield.map,p.x,p.y)?.terrain]?.passable);
 const p1=slots.find(p=>!(p.x===p0.x&&p.y===p0.y)&&Math.abs(p.x-p0.x)+Math.abs(p.y-p0.y)<=2 &&
   globalThis.TERRAINS[TacticalEngine.tile(g.battlefield.map,p.x,p.y)?.terrain]?.passable);
 assert.ok(p0&&p1);
 withCanonicalEngines(g,e=>{
  for(const [id,characterId,loc] of [['singer','ophi',p0],['ally','church_saint',p1]]){
   const u=e.unitRuntime.create({id,team:'P',characterId,x:loc.x,y:loc.y,map:g.battlefield.map,cores:g.battlefield.cores});
   assert.ok(u);delete u._runtimeMap;g.units.push(u);
  }
 });
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 return g;
}
const cast=(g,id='ophi_healing_song')=>resolveCanonicalPlayerCommand(g,{type:'CAST_EFFECT_SKILL',unitId:'singer',targetId:'singer',skillId:id},0);
const tick=g=>{
 if(g.phase==='PLAYER_CARD_PHASE')resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 resolveCanonicalPlayerCommand(g,{type:'END_TACTICAL_PHASE'},0);
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},1);
 resolveCanonicalPlayerCommand(g,{type:'END_TACTICAL_PHASE'},1);
};

test('original Ophi healing song is recognized by effect-engine capability, including server action projection',()=>{
 const g=make();
 assert.equal(isCanonicalSelfChannelSkill(SkillDatabase.get('ophi_healing_song')),true);
 const own=tacticalDebugProjection(g,0);
 assert.equal(own.units.find(u=>u.id==='singer').effectSkills.some(s=>s.id==='ophi_healing_song'),true);
 assert.equal(tacticalDebugProjection(g,1).units.find(u=>u.id==='singer')?.effectSkills,undefined);
});

test('official channel costs MP once, persists as real effect and heals each ally over official next round',()=>{
 const g=make();
 const a=g.units.find(u=>u.id==='singer'),b=g.units.find(u=>u.id==='ally');
 a.hp-=35;b.hp-=50;
 const before={hp:a.hp,ally:b.hp,mana:a.mana};
 const accepted=cast(g);
 assert.equal(accepted.accepted,true);
 assert.equal(a.mana,before.mana-SkillDatabase.get('ophi_healing_song').manaCost);
 assert.equal(a.acted,true);
 assert.equal(a.effects.some(e=>e.type==='HEALING_CHANNEL'),true);
 assert.equal(b.hp,before.ally,'channel healing is not instantaneous');
 assert.doesNotThrow(()=>structuredClone(g));
 const recovered=structuredClone(g);
 tick(recovered);
 assert.equal(recovered.units.find(u=>u.id==='singer').hp,before.hp+10);
 assert.equal(recovered.units.find(u=>u.id==='ally').hp,before.ally+10);
 assert.equal(recovered.units.find(u=>u.id==='singer').effects.some(e=>e.type==='HEALING_CHANNEL'),true);
 assert.equal(recovered.round,2);
 assert.equal(recovered.units.find(u=>u.id==='singer').acted,false);
 tick(recovered);
 assert.equal(recovered.units.find(u=>u.id==='singer').hp,before.hp+20);
 tick(recovered);
 assert.equal(recovered.units.find(u=>u.id==='singer').hp,before.hp+30);
 assert.equal(recovered.units.find(u=>u.id==='singer').effects.some(e=>e.type==='HEALING_CHANNEL'),false);
});

test('movement removes official channel effect; waiting does not remove it',()=>{
 const g=make();cast(g);
 let u=g.units[0];
 assert.equal(u.acted,true,'casting already ends the action; ordinary waiting is not a second action');
 assert.equal(u.effects.some(e=>e.type==='HEALING_CHANNEL'),true);
 tick(g);
 u=g.units[0];
 const moves=Array.from(TacticalEngine.reachable(g.battlefield.map,g.units,u).keys())
  .map(k=>k.split(',').map(Number));
 assert.ok(moves.length);
 const pos=moves[0];
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 resolveCanonicalPlayerCommand(g,{type:'MOVE_UNIT',unitId:u.id,x:pos[0],y:pos[1]},0);
 assert.equal(u.effects.some(e=>e.type==='HEALING_CHANNEL'),false);
});

test('future canonical channel rule needs no PvP skill-ID entry; unknown channel fails closed',()=>{
 const template=SkillDatabase.get('ophi_healing_song');
 const skillId='qa_dynamic_song';
 const unknown='qa_unimplemented_channel';
 assert.equal(SKILLS[skillId],undefined);
 SKILLS[skillId]={...template,id:skillId,channel:{...template.channel,id:'QA_DYNAMIC_SONG'}};
 SKILLS[unknown]={...template,id:unknown,channel:{...template.channel,type:'TIME_REWIND_CHANNEL'}};
 try {
  const g=make();
  g.units[0].grantedSkills.push({skillId,sourceUnitId:'test',remaining:null});
  g.units[0].grantedSkills.push({skillId:unknown,sourceUnitId:'test',remaining:null});
  assert.equal(isCanonicalSelfChannelSkill(SKILLS[skillId]),true);
  assert.equal(isCanonicalSelfChannelSkill(SKILLS[unknown]),false);
  assert.equal(cast(g,skillId).accepted,true);
  assert.equal(g.units[0].effects.some(e=>e.id==='QA_DYNAMIC_SONG'),true);
  const other=make();
  other.units[0].grantedSkills.push({skillId:unknown,remaining:null});
  const before=structuredClone(other);
  assert.throws(()=>cast(other,unknown),{code:'FULL_SKILL_ORCHESTRATION_REQUIRED'});
  assert.deepEqual(other,before);
 }finally{delete SKILLS[skillId];delete SKILLS[unknown]}
});

test('enemy and client cannot forge channel target or extra resource variables',()=>{
 const g=make(),before=structuredClone(g);
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_EFFECT_SKILL',unitId:'singer',targetId:'ally',skillId:'ophi_healing_song'},0),{code:'ILLEGAL_EFFECT_TARGET'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_EFFECT_SKILL',unitId:'singer',targetId:'singer',skillId:'ophi_healing_song',amount:999},0),{code:'INVALID_EFFECT_SKILL_COMMAND'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_EFFECT_SKILL',unitId:'singer',targetId:'singer',skillId:'ophi_healing_song'},1),{code:'NOT_YOUR_TURN'});
 assert.deepEqual(g,before);
});

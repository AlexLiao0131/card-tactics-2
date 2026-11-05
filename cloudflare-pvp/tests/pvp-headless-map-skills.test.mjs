import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection,
  experimentalTacticalCore} from '../src/pvp-headless-tactical.mjs';
import {isCanonicalImmediateMapSkill,isCanonicalSpatialTransitSkill,isCanonicalLineTransitSkill,canonicalImmediateMapSkillOptions}
  from '../src/pvp-headless-map-skills.mjs';
import {createAuthoritySession,commitAuthorityCommand} from '../src/battle-authority.mjs';
import {PVP_COMMAND_PROTOCOL} from '../../shared/pvp-command-contract.mjs';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {SkillDatabase,SKILLS} from '../../js/skill-database.js';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';

const deck=Array(20).fill('imperial_swordsman_card');
const ph='PLAYER_TACTICAL_PHASE';
function make({characterId='nereia',enemy=false}={}){
 let g=createOpeningGame({decks:[deck,deck],serverSeed:123});
 for(let seat of [0,1])g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat}).state;
 beginCanonicalPlayerCardPhase(g);
 withCanonicalEngines(g,e=>{
   const u=e.unitRuntime.create({id:'caster',team:'P',characterId,
     x:0,y:5,map:g.battlefield.map,cores:g.battlefield.cores});
   assert.ok(u);delete u._runtimeMap;g.units.push(u);
   if(enemy){const foe=e.unitRuntime.create({id:'enemy',team:'E',characterId:'imperial_swordsman',
     x:2,y:5,map:g.battlefield.map,cores:g.battlefield.cores});
     assert.ok(foe);delete foe._runtimeMap;g.units.push(foe);}
 });
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 assert.equal(g.phase,ph);
 return g;
}
function tiles(game,skillId){
 const actor=game.units[0];
 const c=globalThis.TacticalActionController.create({
   actionState:()=>({map:game.battlefield.map,units:game.units,environmentState:game.environmentState}),
   unitAt:(x,y)=>game.units.find(u=>u.alive&&u.x===x&&u.y===y)||null
 });
 return c.mapTargetTiles(actor,SkillDatabase.get(skillId));
}
const command=(skillId,tile)=>({type:'CAST_MAP_SKILL',unitId:'caster',skillId,x:tile.x,y:tile.y});

test('one official capability contract covers future map spells; unknown / multi-stage mechanics stay blocked',()=>{
 const tsunami=SkillDatabase.get('nereia_tsunami');
 const collapse=SkillDatabase.get('velsa_dimension_collapse');
 assert.equal(isCanonicalImmediateMapSkill(tsunami),true);
 assert.equal(isCanonicalImmediateMapSkill(collapse),true);
 for(const id of ['angel_drop_enemy'])
   assert.equal(isCanonicalImmediateMapSkill(SkillDatabase.get(id)),false,id);
 assert.equal(isCanonicalImmediateMapSkill({...tsunami,id:'unknown',hydrologyFlood:null}),false);
 assert.equal(isCanonicalImmediateMapSkill({...tsunami,id:'unknown',utilityAction:{type:'UNKNOWN'}}),false);
 assert.equal(isCanonicalImmediateMapSkill({...tsunami,id:'unknown',statusEffects:[{type:'BURN'}]}),false);
 assert.equal(isCanonicalImmediateMapSkill({...tsunami,id:'unknown',areaDamage:{mode:'UNIMPLEMENTED'}}),false);
 assert.equal(isCanonicalImmediateMapSkill({...tsunami,id:'unknown',environmentForces:['UNKNOWN_ELEMENT']}),false);
 const fresh={...tsunami,id:'qa_future_flood_spell',name:'new spell by metadata'};
 SKILLS[fresh.id]=fresh;
 try{
  const g=make();g.units[0].grantedSkills.push({skillId:fresh.id,remaining:null});
  const own=tacticalDebugProjection(g,0).units.find(u=>u.id==='caster');
  assert.ok(own.mapSkills.some(s=>s.id===fresh.id));
  const target=tiles(g,fresh.id)[0];
  assert.ok(target);
  const mp=g.units[0].mana;
  assert.equal(resolveCanonicalPlayerCommand(g,command(fresh.id,target),0).accepted,true);
  assert.equal(g.units[0].mana,mp-fresh.manaCost);
 }finally{delete SKILLS[fresh.id];}
});

test('spatial-transit capability uses existing synchronous controller and closes unsafe metadata',()=>{
 const shadow=SkillDatabase.get('shadow_step');
 const wormhole=SkillDatabase.get('velsa_space_fold');
 assert.equal(isCanonicalSpatialTransitSkill(shadow),true);
 assert.equal(isCanonicalSpatialTransitSkill(wormhole),true);
 assert.equal(isCanonicalImmediateMapSkill(shadow),true);
 assert.equal(isCanonicalImmediateMapSkill(wormhole),true);
 const unsafe=[
   {...shadow,moveToTarget:false},
   {...shadow,ignorePath:false},
   {...shadow,areaDamage:{mode:'MAGIC_POWER'}},
   {...shadow,postEffects:[{type:'KNOCKBACK'}]},
   {...shadow,environmentForces:['FIRE']},
   {...wormhole,utilityAction:{type:'WORMHOLE_TRANSIT',persists:true}},
   {...wormhole,utilityAction:{...wormhole.utilityAction,damage:999}},
   {...wormhole,utilityAction:{type:'CARRY_ALLY'}},
   {...wormhole,moveToTarget:true},
   {...wormhole,channel:{duration:2}},
   {...wormhole,effects:{type:'UNKNOWN'}},
   {...wormhole,shape:'LINE'}
 ];
 for(const skill of unsafe)assert.equal(isCanonicalSpatialTransitSkill(skill),false,JSON.stringify(skill));
});

test('W_STEP and wormhole spend original resources and enter the actual destination without replaying movement',()=>{
 for(const skillId of ['shadow_step','velsa_space_fold']){
   const g=make({characterId:skillId==='shadow_step'?'nereia':'velsa'});
   if(skillId==='shadow_step')g.units[0].grantedSkills.push({skillId,remaining:null});
   const actor=g.units[0],skill=SkillDatabase.get(skillId);
   const before={x:actor.x,y:actor.y,mana:actor.mana,
     sanity:actor.resources?.sanity?.value,randomState:g.randomState};
   const legal=tiles(g,skillId).filter(t=>t.x!==actor.x||t.y!==actor.y);
   assert.ok(legal.length>0,`canonical source must expose landing for ${skillId}`);
   const target=legal[0];
   const result=resolveCanonicalPlayerCommand(g,command(skillId,target),0);
   assert.equal(result.accepted,true);
   assert.deepEqual({x:actor.x,y:actor.y},{x:target.x,y:target.y});
   assert.equal(actor.mana,before.mana-(skill.manaCost||0));
   if(skill.resourceCosts?.sanity)
     assert.equal(actor.resources.sanity.value,before.sanity-skill.resourceCosts.sanity);
   assert.equal(actor.acted,true);assert.equal(actor.waited,true);
   assert.equal(g.randomState,before.randomState,'transit does not invent a hit or crit roll');
   assert.throws(()=>resolveCanonicalPlayerCommand(g,command(skillId,target),0),
     {code:'MAP_SKILL_ACTOR_UNAVAILABLE'});
 }
});

test('spatial transit rejects injected destination, cost and illegitimate seating without state change',()=>{
 const g=make({characterId:'velsa'}),t=tiles(g,'velsa_space_fold')[0];
 const initial=structuredClone(g);
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{...command('velsa_space_fold',t),manaCost:0},0),
   {code:'INVALID_MAP_SKILL_COMMAND'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,command('velsa_space_fold',{x:9999,y:9999}),0),
   {code:'ILLEGAL_MAP_SKILL_TARGET'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,command('velsa_space_fold',t),1),
   {code:'NOT_YOUR_TURN'});
 assert.deepEqual(g,initial);
});

test('Nereia tsunami commits real flood, mana and turn via original MapSkill + Hydrology engines',()=>{
 const g=make();
 const legal=tiles(g,'nereia_tsunami');assert.ok(legal.length>0);
 const t=legal[0];const beforeMana=g.units[0].mana,random=g.randomState;
 const out=resolveCanonicalPlayerCommand(g,command('nereia_tsunami',t),0);
 assert.equal(out.accepted,true);assert.equal(g.units[0].mana,beforeMana-SkillDatabase.get('nereia_tsunami').manaCost);
 assert.equal(g.units[0].acted,true);assert.equal(g.units[0].waited,true);
 assert.ok(g.events.some(e=>e.text.includes('注入 Water Volume')));
 assert.equal(g.randomState,random,'a deterministic flood need not invent hit/crit draws');
});

test('Velsa dimension collapse uses canonical mana, sanity, hit and crit RNG; no global Math.random',()=>{
 const start=make({characterId:'velsa',enemy:true});
 const legal=tiles(start,'velsa_dimension_collapse');
 const target=legal.find(t=>Math.abs(t.x-2)+Math.abs(t.y-5)<=2);
 assert.ok(target);
 const initial=structuredClone(start);
 const before=initial.units.map(u=>({hp:u.hp,mana:u.mana,sanity:u.resources?.sanity?.value}));
 const originalRandom=Math.random;
 try{
  Math.random=()=>{throw Error('FORBIDDEN_GLOBAL_RANDOM_IN_AUTHORITATIVE_MAP_ATTACK')};
  const a=structuredClone(initial),b=structuredClone(initial);
  assert.equal(resolveCanonicalPlayerCommand(a,command('velsa_dimension_collapse',target),0).accepted,true);
  assert.equal(resolveCanonicalPlayerCommand(b,command('velsa_dimension_collapse',target),0).accepted,true);
  assert.deepEqual(a,b,'same state and server seed must have identical damage, RNG and events');
  assert.ok(a.units.find(u=>u.id==='enemy').hp<before[1].hp);
  assert.equal(a.units[0].mana,before[0].mana-SkillDatabase.get('velsa_dimension_collapse').manaCost);
  assert.equal(a.units[0].resources.sanity.value,before[0].sanity-15);
 }finally{Math.random=originalRandom}
});

test('map spell rejects client-forged damage, illegal targets, other seat, and multi-step skills without committing',()=>{
 const g=make(),t=tiles(g,'nereia_tsunami')[0];const before=structuredClone(g);
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{...command('nereia_tsunami',t),damage:999999},0),
   {code:'INVALID_MAP_SKILL_COMMAND'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,command('nereia_tsunami',{x:999,y:999}),0),
   {code:'ILLEGAL_MAP_SKILL_TARGET'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,command('nereia_tsunami',t),1),
   {code:'NOT_YOUR_TURN'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,command('shadow_step',t),0),
   {code:'FULL_SKILL_ORCHESTRATION_REQUIRED'});
 assert.deepEqual(g,before);
});

test('authoritative receipt and copy protect one-commit AOE spells against replays',()=>{
 const game=make(),t=tiles(game,'nereia_tsunami')[0];
 const initial=createAuthoritySession({initialState:game,core:experimentalTacticalCore});
 const envelope={protocol:PVP_COMMAND_PROTOCOL,commandId:'canonical-map-skill-0001',
   baseRevision:initial.revision,action:command('nereia_tsunami',t)};
 const {nextSession,duplicate}=commitAuthorityCommand({session:initial,seat:0,envelope,core:experimentalTacticalCore});
 assert.equal(duplicate,false);assert.equal(initial.revision,0);assert.equal(nextSession.revision,1);
 const mp=nextSession.state.units[0].mana;
 const repeat=commitAuthorityCommand({session:nextSession,seat:0,envelope,core:experimentalTacticalCore});
 assert.equal(repeat.duplicate,true);assert.equal(repeat.nextSession.state.units[0].mana,mp);
 assert.throws(()=>commitAuthorityCommand({session:nextSession,seat:0,
   envelope:{...envelope,commandId:'canonical-map-skill-0002'},core:experimentalTacticalCore}),
   {code:'STALE_REVISION'});
 const other=tacticalDebugProjection(nextSession.state,1);
 assert.ok(other.units.every(u=>u.team!=='P'||u.mapSkills===undefined),
   'an enemy cannot inspect our private attack choices');
});

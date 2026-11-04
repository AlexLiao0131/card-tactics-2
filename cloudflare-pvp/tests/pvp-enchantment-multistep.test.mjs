import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection,experimentalTacticalCore} from '../src/pvp-headless-tactical.mjs';
import {canonicalEnchantmentOptions,isCanonicalEnchantmentSkill} from '../src/pvp-headless-enchantment.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {SkillDatabase,SKILLS} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {createAuthoritySession,commitAuthorityCommand} from '../src/battle-authority.mjs';
import {PVP_COMMAND_PROTOCOL} from '../../shared/pvp-command-contract.mjs';

const deck=Array(20).fill('imperial_swordsman_card');
function make(seed=18282){
 let g=createOpeningGame({decks:[deck,deck],serverSeed:seed});
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
 beginCanonicalPlayerCardPhase(g);
 const map=g.battlefield.map;
 const own=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
 const two=own.filter(({x,y})=>{
   const tile=TacticalEngine.tile(map,x,y);
   return tile&&globalThis.TERRAINS[tile.terrain]?.passable&&
     !map.objects.some(o=>o.blocksMovement&&o.x===x&&o.y===y);
 });
 assert.ok(two.length>=2);
 withCanonicalEngines(g,e=>{
  for(const [id,characterId,loc] of [['livia','livia',two[0]],['ally','imperial_swordsman',two[1]]]){
   const u=e.unitRuntime.create({id,team:'P',characterId,x:loc.x,y:loc.y,map,cores:g.battlefield.cores});
   assert.ok(u,characterId);delete u._runtimeMap;g.units.push(u);
  }
 });
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 return g;
}
function option(g,targetId,variantId='ENCHANT_FIRE',weaponSlot=null){
 const list=tacticalDebugProjection(g,0).units.find(u=>u.id==='livia').enchantmentOptions;
 return list.find(o=>o.targetId===targetId&&o.variantId===variantId&&(!weaponSlot||o.weaponSlot===weaponSlot));
}
function cast(g,o){return resolveCanonicalPlayerCommand(g,{type:'CAST_ENCHANTMENT',
  unitId:'livia',targetId:o.targetId,skillId:o.skillId,variantId:o.variantId,weaponSlot:o.weaponSlot},0);}
function authorityCommit(s,seat,action,id){return commitAuthorityCommand({session:s,seat,core:experimentalTacticalCore,
 envelope:{protocol:PVP_COMMAND_PROTOCOL,commandId:`qa_enchant_${id.toString().padStart(8,'0')}`,
   baseRevision:s.revision,action}}).nextSession;}

test('official SkillDatabase variant merge matches original selected-skill behavior and rejects forged variant',()=>{
 const p=SkillDatabase.get('elemental_enchant');
 const f=p.variants.find(v=>v.id==='ENCHANT_FIRE');
 const merged={...p,...f,id:p.id,name:f.name||p.name,baseSkillId:p.id,variantId:f.id,variants:undefined};
 assert.deepEqual(SkillDatabase.resolveVariant(p,'ENCHANT_FIRE'),merged);
 assert.equal(SkillDatabase.resolveVariant(p,'BAD_VARIANT'),null);
 assert.equal(isCanonicalEnchantmentSkill(merged),true);
});

test('server resolves eligible ally equipment with original controller; caster pays official MP and action completes',()=>{
 const g=make();const caster=g.units[0],target=g.units[1];
 const o=option(g,'ally','ENCHANT_FIRE');
 assert.ok(o,JSON.stringify(tacticalDebugProjection(g,0).units[0].enchantmentOptions));
 const before=caster.mana,hand=structuredClone(g.cards[0].zones.hand);
 const result=cast(g,o);
 assert.equal(result.accepted,true);
 assert.equal(caster.mana,before-SkillDatabase.get('elemental_enchant').manaCost);
 assert.equal(caster.acted,true);
 assert.equal(g.pendingEnchantmentFollowup,null);
 const enchant=target.effects.find(e=>e.type==='WEAPON_ENCHANT'&&e.weaponSlot===o.weaponSlot);
 assert.equal(enchant.element,'FIRE');
 assert.equal(enchant.sourceSkillId,'elemental_enchant');
 assert.deepEqual(hand,g.cards[0].zones.hand);
 assert.doesNotThrow(()=>structuredClone(g));
});

test('self enchant creates a persistable follow-up; official cancel ends action without consuming enchant',()=>{
 const g=make();const caster=g.units[0];
 const o=option(g,'livia','ENCHANT_THUNDER');assert.ok(o);
 const output=cast(g,o);
 assert.equal(output.accepted,true);
 assert.equal(caster.acted,false);
 assert.deepEqual(g.pendingEnchantmentFollowup,{unitId:'livia',weaponSlot:o.weaponSlot});
 assert.equal(caster.effects.find(e=>e.type==='WEAPON_ENCHANT'&&e.weaponSlot===o.weaponSlot)?.element,'THUNDER');
 assert.equal(tacticalDebugProjection(g,0).enchantmentFollowup.unitId,'livia');
 assert.equal(tacticalDebugProjection(g,1).enchantmentFollowup,null);
 const restored=structuredClone(g);
 assert.throws(()=>resolveCanonicalPlayerCommand(restored,{type:'MOVE_UNIT',unitId:'ally',x:7,y:7},0),
   {code:'ENCHANTMENT_FOLLOWUP_REQUIRED'});
 assert.throws(()=>resolveCanonicalPlayerCommand(restored,{type:'END_TACTICAL_PHASE'},0),
   {code:'ENCHANTMENT_FOLLOWUP_REQUIRED'});
 assert.equal(resolveCanonicalPlayerCommand(restored,{type:'END_ENCHANT_FOLLOWUP',unitId:'livia'},0).accepted,true);
 const after=restored.units.find(u=>u.id==='livia');
 assert.equal(after.acted,true);
 assert.equal(after.effects.find(e=>e.type==='WEAPON_ENCHANT'&&e.weaponSlot===o.weaponSlot)?.element,'THUNDER');
 assert.equal(restored.pendingEnchantmentFollowup,null);
});

test('illegal recipient, forged weapon, forged skill variant and opponent commands change no state',()=>{
 const g=make();const before=structuredClone(g);const o=option(g,'ally');assert.ok(o);
 for(const a of [
   {...o,targetId:'enemy'},
   {...o,weaponSlot:'imaginary_weapon'},
   {...o,variantId:'ENCHANT_ICE'},
   {...o,skillId:'nether_slash'}]){
  assert.throws(()=>cast(g,a),{code:'ILLEGAL_ENCHANTMENT_SELECTION'});
 }
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_ENCHANTMENT',unitId:'livia',targetId:'ally',skillId:o.skillId,
   variantId:o.variantId,weaponSlot:o.weaponSlot,damage:999},0),{code:'INVALID_ENCHANTMENT_COMMAND'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_ENCHANTMENT',unitId:'livia',targetId:'ally',skillId:o.skillId,
   variantId:o.variantId,weaponSlot:o.weaponSlot},1),{code:'NOT_YOUR_TURN'});
 assert.deepEqual(g,before);
});

test('future enchantment skill ID/variant automatically uses official execution without PvP registry',()=>{
 const p=SkillDatabase.get('elemental_enchant');
 const id='qa_future_enchantment';assert.equal(SKILLS[id],undefined);
 SKILLS[id]={...p,id,variants:[{...p.variants[0],id:'QA_FUTURE_FIRE'}]};
 try {
   const g=make();g.units[0].grantedSkills.push({skillId:id,remaining:null});
   const o=option(g,'ally','QA_FUTURE_FIRE');assert.ok(o);
   assert.equal(cast(g,o).accepted,true);
   assert.equal(g.units[1].effects.find(e=>e.type==='WEAPON_ENCHANT')?.sourceSkillId,id);
 }finally{delete SKILLS[id]}
});

test('authority revision makes one self-enchantment spend idempotent across reconnect',()=>{
 const g=make(),s0=createAuthoritySession({initialState:g,core:experimentalTacticalCore});
 const o=option(g,'livia');assert.ok(o);
 const cmd={type:'CAST_ENCHANTMENT',unitId:'livia',targetId:o.targetId,skillId:o.skillId,
  variantId:o.variantId,weaponSlot:o.weaponSlot};
 const one=authorityCommit(s0,0,cmd,1);
 const replay=commitAuthorityCommand({session:one,seat:0,core:experimentalTacticalCore,
  envelope:{protocol:PVP_COMMAND_PROTOCOL,commandId:'qa_enchant_00000001',baseRevision:s0.revision,action:cmd}});
 assert.equal(replay.duplicate,true);
 assert.equal(one.state.units[0].effects.filter(e=>e.type==='WEAPON_ENCHANT').length,1);
 assert.equal(one.state.units[0].mana,g.units[0].mana-SkillDatabase.get('elemental_enchant').manaCost);
 assert.equal(one.revision,s0.revision+1);
 assert.doesNotThrow(()=>structuredClone(one));
});

function attachEnemyFor(g,attacker,skillId){
 const skill=SkillDatabase.get(skillId),map=g.battlefield.map;
 return withCanonicalEngines(g,e=>{
  for(const tile of map.tiles){
   const terrain=globalThis.TERRAINS[tile.terrain];
   if(!terrain?.passable||map.objects.some(o=>o.blocksMovement&&o.x===tile.x&&o.y===tile.y)||
      g.units.some(u=>u.alive&&u.x===tile.x&&u.y===tile.y))continue;
   const trial={id:'enemy',team:'E',alive:true,character:{},x:tile.x,y:tile.y};
   if(!TacticalEngine.canTarget(map,attacker,trial,skill,g.environmentState))continue;
   const u=e.unitRuntime.create({id:'enemy',team:'E',characterId:'imperial_swordsman',x:tile.x,y:tile.y,
     map,cores:g.battlefield.cores});
   assert.ok(u);delete u._runtimeMap;g.units.push(u);
   return u;
  }
  throw Error('NO_LEGAL_ENCHANTED_ATTACK_TARGET');
 });
}

test('self fire enchant -> official attack/reaction -> consume enchant exactly once with original impact effects',()=>{
 const g=make(8455),actor=g.units[0];
 const enchant=option(g,'livia','ENCHANT_FIRE','kahns_bow');assert.ok(enchant);
 const enemy=attachEnemyFor(g,actor,'bow_shot');
 const startMana=actor.mana,startEnemyHp=enemy.hp;
 cast(g,enchant);
 assert.equal(g.pendingEnchantmentFollowup?.weaponSlot,'kahns_bow');
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'DECLARE_ATTACK',attackerId:actor.id,
   targetId:enemy.id,skillId:'black_slash'},0),{code:'ENCHANTMENT_FOLLOWUP_WEAPON_REQUIRED'});
 const pending=resolveCanonicalPlayerCommand(g,{type:'DECLARE_ATTACK',attackerId:actor.id,
   targetId:enemy.id,skillId:'bow_shot'},0);
 assert.equal(pending.accepted,true);
 assert.equal(g.activeSeat,1);
 assert.equal(g.phase,'PVP_REACTION_PENDING');
 assert.deepEqual(g.pendingEnchantmentFollowup,{unitId:'livia',weaponSlot:'kahns_bow'});
 const result=resolveCanonicalPlayerCommand(g,{type:'REACT_ATTACK',reaction:'ACCEPT'},1);
 assert.equal(result.accepted,true);
 assert.equal(g.activeSeat,0);
 assert.equal(g.pendingEnchantmentFollowup,null);
 assert.equal(actor.acted,true);
 assert.equal(actor.effects.some(e=>e.type==='WEAPON_ENCHANT'&&e.weaponSlot==='kahns_bow'),false);
 assert.ok(actor.mana<=startMana);
 assert.ok(enemy.hp<=startEnemyHp);
 assert.doesNotThrow(()=>structuredClone(g));
});

test('ally fire enchant -> allied unit attack runs the same official weapon consumption/terrain impact',()=>{
 const g=make(5995),livia=g.units[0],ally=g.units[1];
 const selection=option(g,'ally','ENCHANT_FIRE');assert.ok(selection);
 const enemy=attachEnemyFor(g,ally,'slash');
 cast(g,selection);
 assert.equal(livia.acted,true);
 assert.equal(ally.effects.some(e=>e.type==='WEAPON_ENCHANT'),true);
 resolveCanonicalPlayerCommand(g,{type:'DECLARE_ATTACK',attackerId:ally.id,targetId:enemy.id,skillId:'slash'},0);
 resolveCanonicalPlayerCommand(g,{type:'REACT_ATTACK',reaction:'ACCEPT'},1);
 assert.equal(ally.effects.some(e=>e.type==='WEAPON_ENCHANT'&&e.weaponSlot===selection.weaponSlot),false);
 assert.equal(ally.acted,true);
});

test('same seed and action stream deterministically resolve enchanted weapon hit and environment followup',()=>{
 function run(){
  const g=make(4555),actor=g.units[0],o=option(g,'livia','ENCHANT_FIRE','kahns_bow');
  const enemy=attachEnemyFor(g,actor,'bow_shot');
  cast(g,o);
  resolveCanonicalPlayerCommand(g,{type:'DECLARE_ATTACK',attackerId:actor.id,targetId:enemy.id,skillId:'bow_shot'},0);
  resolveCanonicalPlayerCommand(g,{type:'REACT_ATTACK',reaction:'ACCEPT'},1);
  return {random:g.randomState,units:g.units.map(u=>({id:u.id,hp:u.hp,mana:u.mana,effects:u.effects,alive:u.alive})),
   effects:g.environmentState?.effects,events:g.events};
 }
 assert.deepEqual(run(),run());
});

test('official enchanted attack can target terrain without fabricated PvP effects or damage inputs',()=>{
 const g=make(6429),actor=g.units[0];
 const selected=option(g,'livia','ENCHANT_FIRE','kahns_bow');assert.ok(selected);
 cast(g,selected);
 const candidates=g.battlefield.map.tiles.filter(tile=>{
   const d=Math.abs(actor.x-tile.x)+Math.abs(actor.y-tile.y);
   if(d<2||d>4)return false;
   const aimSkill={...SkillDatabase.get('bow_shot'),terrainTargeting:true};
   return TacticalEngine.teamCanSee(g.battlefield.map,g.units,'P',tile,g.environmentState)&&
     TacticalEngine.hasLineOfSight(g.battlefield.map,actor,tile,aimSkill,g.environmentState);
 });
 assert.ok(candidates.length>0);
 const destination=candidates[0];
 const before=g.randomState;
 const result=resolveCanonicalPlayerCommand(g,{type:'ATTACK_ENCHANTED_TERRAIN',unitId:'livia',
   skillId:'bow_shot',x:destination.x,y:destination.y},0);
 assert.equal(result.accepted,true);
 assert.equal(g.pendingEnchantmentFollowup,null);
 assert.equal(actor.acted,true);
 assert.equal(actor.effects.some(e=>e.type==='WEAPON_ENCHANT'),false);
 assert.equal(g.randomState,before,'terrain contact never rolls an extra hidden physical hit');
 assert.ok(g.events.some(e=>e.text.includes('附魔')));
 assert.doesNotThrow(()=>structuredClone(g));
});

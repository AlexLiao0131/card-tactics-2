import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {experimentalTacticalCore} from '../src/pvp-headless-tactical.mjs';
import {createAuthoritySession,commitAuthorityCommand,projectAuthoritySession}
 from '../src/battle-authority.mjs';
import {PVP_COMMAND_PROTOCOL} from '../../shared/pvp-command-contract.mjs';
import {TacticalEngine} from '../../js/tactical-engine.js';

const deck=Array(20).fill('imperial_swordsman_card');
function cmd(action,n){return {protocol:PVP_COMMAND_PROTOCOL,commandId:`pvp_reaction_${String(n).padStart(6,'0')}`,
  baseRevision:undefined,action};}
function commit(session,seat,action,n){const envelope=cmd(action,n);envelope.baseRevision=session.revision;
 return commitAuthorityCommand({session,seat,envelope,core:experimentalTacticalCore});}
function fixture(seed=20261103){
 let game=createOpeningGame({decks:[deck,deck],serverSeed:seed});
 game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
 game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
 let s=createAuthoritySession({initialState:game,core:experimentalTacticalCore});let n=0;
 const accept=(seat,action)=>{s=commit(s,seat,action,++n).nextSession;};
 accept(0,{type:'BEGIN_BATTLE'});
 const p=s.state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
 accept(0,{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:p.x,y:p.y});
 accept(0,{type:'END_CARD_PHASE'});accept(0,{type:'END_TACTICAL_PHASE'});
 const e=s.state.battlefield.deploymentPoints.find(p=>p.owner==='ENEMY').area[0];
 accept(1,{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:e.x,y:e.y});
 accept(1,{type:'END_CARD_PHASE'});
 const [defender,attacker]=s.state.units;
 let found=false;
 for(const tile of s.state.battlefield.map.tiles){
   const adjacent=TacticalEngine.tile(s.state.battlefield.map,tile.x+1,tile.y);
   if(!adjacent||!globalThis.TERRAINS[tile.terrain]?.passable||
      !globalThis.TERRAINS[adjacent.terrain]?.passable)continue;
   defender.x=tile.x;defender.y=tile.y;attacker.x=adjacent.x;attacker.y=adjacent.y;
   const skill=globalThis.SkillDatabase.get('slash');
   if(TacticalEngine.canTarget(s.state.battlefield.map,attacker,defender,skill,s.state.environmentState)){
     found=true;break;
   }
 }
 assert.ok(found,'test arranges a valid close-range attack without modifying rules');
 attacker.moved=false;attacker.acted=false;attacker.waited=false;
 return {session:s,attacker,defender,n:n+1};
}
function declare(f){const a={type:'DECLARE_ATTACK',attackerId:f.attacker.id,
  targetId:f.defender.id,skillId:'slash'};
 return commit(f.session,1,a,f.n);
}
function react(after,action,n){return commit(after,0,{type:'REACT_ATTACK',...action},n);}

test('attack waits for defender; incorrect seat, stale message and forged damage cannot commit',()=>{
 const f=fixture();const before=structuredClone(f.session.state);
 const started=declare(f).nextSession;
 assert.equal(started.state.activeSeat,0);
 assert.equal(started.state.phase,'PVP_REACTION_PENDING');
 assert.deepEqual(f.session.state,before,'authority accepts a clone only');
 assert.equal(started.state.units[0].hp,before.units[0].hp);
 assert.throws(()=>commit(started,1,{type:'REACT_ATTACK',reaction:'ACCEPT'},f.n+1),{code:'NOT_YOUR_TURN'});
 assert.throws(()=>commit(started,0,{type:'DAMAGE',amount:9999},f.n+2),{code:'FULL_TACTICAL_ACTION_NOT_CONNECTED'});
 assert.equal(started.state.phase,'PVP_REACTION_PENDING');
 assert.throws(()=>commit(f.session,0,{type:'REACT_ATTACK',reaction:'EVADE'},f.n+3),{code:'NOT_YOUR_TURN'});
});

test('defender evade commits official BattleResolution once, resumes attacker turn, and supports reconnect',()=>{
 const f=fixture(1720);const pending=declare(f).nextSession;
 const restarted=structuredClone(pending);
 assert.deepEqual(projectAuthoritySession(restarted,0,experimentalTacticalCore).view.pendingAttack,
   projectAuthoritySession(restarted,1,experimentalTacticalCore).view.pendingAttack);
 const result=react(restarted,{reaction:'EVADE'},f.n+1);
 const next=result.nextSession;
 assert.equal(next.revision,pending.revision+1);
 assert.equal(next.state.phase,'ENEMY_TACTICAL_PHASE');
 assert.equal(next.state.activeSeat,1);
 assert.equal(next.state.pendingAttack,null);
 assert.equal(next.state.units[1].acted,true);
 assert.equal(next.state.units[1].moved,true);
 assert.equal(next.state.cards[1].crystals,pending.state.cards[1].crystals);
 const duplicate=commitAuthorityCommand({session:next,seat:0,
   envelope:{protocol:PVP_COMMAND_PROTOCOL,commandId:`pvp_reaction_${String(f.n+1).padStart(6,'0')}`,
    baseRevision:pending.revision,action:{type:'REACT_ATTACK',reaction:'EVADE'}},core:experimentalTacticalCore});
 assert.equal(duplicate.duplicate,true);assert.equal(duplicate.nextSession.revision,next.revision);
});

test('official battle roll is deterministic per room and action sequence, not peer-supplied',()=>{
 function run(){const f=fixture(424242),p=declare(f).nextSession,
 result=react(p,{reaction:'EVADE'},f.n+1).nextSession;
 return {units:result.state.units.map(u=>({id:u.id,hp:u.hp,mana:u.mana,alive:u.alive,acted:u.acted})),
   random:result.state.randomState,events:result.state.events};}
 assert.deepEqual(run(),run());
});

test('defense and counter must be offered by the official defenders, not invented client IDs',()=>{
 const f=fixture(1666),p=declare(f).nextSession;
 assert.throws(()=>react(p,{reaction:'DEFENSE',methodId:'injected-defense'},f.n+1),
   {code:'ILLEGAL_DEFENSE_METHOD'});
 assert.throws(()=>react(p,{reaction:'COUNTER',skillId:'nether_slash'},f.n+2),
   {code:'ILLEGAL_COUNTER_SKILL'});
 assert.throws(()=>react(p,{reaction:'GUARD',guardianId:'other-unit',methodId:'fake-guard'},f.n+3),
   {code:'ILLEGAL_GUARD_METHOD'});
 assert.equal(p.state.pendingAttack.attackerId,f.attacker.id);
 const counter=react(p,{reaction:'COUNTER',skillId:'slash'},f.n+4).nextSession;
 assert.equal(counter.state.phase,'ENEMY_TACTICAL_PHASE');
 assert.equal(counter.state.units[1].acted,true);
 assert.ok(counter.state.events.some(e=>e.type==='BATTLE'));
});

test('accept reaction and invalid attack requests do not alter durable combat draft',()=>{
 const f=fixture(7733),p=declare(f).nextSession;
 assert.throws(()=>commit(f.session,1,{type:'DECLARE_ATTACK',attackerId:f.attacker.id,
   targetId:f.defender.id,skillId:'SHADOW_FAKE'},f.n),{code:'FULL_SKILL_ORCHESTRATION_REQUIRED'});
 assert.throws(()=>react(p,{reaction:'ACCEPT',damage:600},f.n+1),
   {code:'CLIENT_RESULT_FORBIDDEN'});
 const good=react(p,{reaction:'ACCEPT'},f.n+2).nextSession;
 assert.equal(good.state.phase,'ENEMY_TACTICAL_PHASE');
 assert.equal(good.state.activeSeat,1);
 assert.equal(good.state.pendingAttack,null);
});

test('private projected defender choice lists official parry while attacking seat gets no response controls',()=>{
 const f=fixture(1204),p=declare(f).nextSession;
 const defense=projectAuthoritySession(p,0,experimentalTacticalCore).view;
 const offense=projectAuthoritySession(p,1,experimentalTacticalCore).view;
 assert.ok(defense.reactionOptions.defenses.some(x=>x.id==='sword_parry'));
 assert.ok(defense.reactionOptions.counters.some(x=>x.id==='slash'));
 assert.equal(offense.reactionOptions,null);
 const result=react(p,{reaction:'DEFENSE',methodId:'sword_parry'},f.n+1).nextSession;
 assert.equal(result.state.phase,'ENEMY_TACTICAL_PHASE');
 assert.equal(result.state.activeSeat,1);
});

test('guard ally reaction uses official guard candidate and interception without authorizing client damage',async()=>{
 const f=fixture(2302),game=f.session.state;
 const {withCanonicalEngines}=await import('../src/pvp-engine-context.mjs');
 const guard=withCanonicalEngines(game,engine=>engine.unitRuntime.create({
  id:'guard-unit',team:'P',characterId:'imperial_heavy_guard',
  x:game.units[0].x,y:game.units[0].y+1,map:game.battlefield.map,cores:game.battlefield.cores
 }));
 const tile=game.battlefield.map.tiles.find(t=>
   Math.abs(t.x-game.units[0].x)+Math.abs(t.y-game.units[0].y)===1 &&
   !game.units.some(u=>u.x===t.x&&u.y===t.y)&&globalThis.TERRAINS[t.terrain]?.passable &&
   Math.abs(t.elevation-game.battlefield.map.tiles.find(z=>z.x===game.units[0].x&&z.y===game.units[0].y)?.elevation)<=1);
 assert.ok(tile,'neighboring guard tile');
 guard.x=tile.x;guard.y=tile.y;guard.z=tile.elevation;
 delete guard._runtimeMap;
 game.units.push(guard);
 const p=declare(f).nextSession;
 const options=projectAuthoritySession(p,0,experimentalTacticalCore).view.reactionOptions;
 const candidate=options.guardians.find(x=>x.guardianId==='guard-unit');
 assert.ok(candidate,'official guard target');
 assert.ok(candidate.methods.some(m=>m.id==='large_shield_guard'));
 const before=game.units[0].hp;
 const outcome=react(p,{reaction:'GUARD',guardianId:'guard-unit',methodId:'large_shield_guard'},f.n+1);
 assert.equal(outcome.nextSession.state.phase,'ENEMY_TACTICAL_PHASE');
 assert.equal(outcome.nextSession.state.units[0].hp,before);
});

test('seat tactical view hides distant stealthed opponent using official visibility engine',async()=>{
 const f=fixture(3221),game=f.session.state;
 const {withCanonicalEngines}=await import('../src/pvp-engine-context.mjs');
 const enemy=game.units[1],friend=game.units[0];
 const nearCore=(owner)=>game.battlefield.cores.find(c=>c.owner===owner);
 const coreP=nearCore('PLAYER'),coreE=nearCore('ENEMY');
 const left=game.battlefield.map.tiles.find(t=>t.x===coreP.x+1&&t.y===coreP.y),
   right=game.battlefield.map.tiles.find(t=>t.x===coreE.x-1&&t.y===coreE.y);
 assert.ok(left&&right);
 friend.x=left.x;friend.y=left.y;enemy.x=right.x;enemy.y=right.y;
 withCanonicalEngines(game,engine=>engine.effect.applyStealth(friend,{detectionRange:1,source:friend}));
 const seenByEnemy=projectAuthoritySession(f.session,1,experimentalTacticalCore).view;
 const seenBySelf=projectAuthoritySession(f.session,0,experimentalTacticalCore).view;
 assert.ok(seenBySelf.units.some(u=>u.id===friend.id));
 assert.ok(!seenByEnemy.units.some(u=>u.id===friend.id));
 assert.ok(seenByEnemy.units.some(u=>u.id===enemy.id));
});

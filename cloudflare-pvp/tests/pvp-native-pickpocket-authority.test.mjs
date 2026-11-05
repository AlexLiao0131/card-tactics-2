import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {RewardDatabase} from '../../js/reward-database.js';
import {RewardEngine} from '../../js/reward-engine.js';
import {ItemRuntimeEngine} from '../../js/item-runtime-engine.js';
import {ItemInventoryEngine} from '../../js/item-inventory-engine.js';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {isCanonicalPickpocketSkill} from '../src/pvp-headless-pickpocket.mjs';
import {pvpAuthoritativeMatchCore} from '../src/pvp-authoritative-match-core.mjs';
import {createAuthoritySession,commitAuthorityCommand,projectAuthoritySession} from '../src/battle-authority.mjs';
import {PVP_COMMAND_PROTOCOL} from '../../shared/pvp-command-contract.mjs';
import {PvpTacticalUI} from '../../js/pvp-tactical-ui.js';
const skill=SkillDatabase.get('cat_pickpocket');
const deck=Array(20).fill('imperial_archer_card');
const command=(actor,target)=>({type:'CAST_PICKPOCKET',unitId:actor.id,skillId:skill.id,targetId:target.id});
function makeGame(team='P'){
  let game=createOpeningGame({decks:[deck,deck],serverSeed:34117});
  for(const seat of [0,1])game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat}).state;
  beginCanonicalPlayerCardPhase(game);
  resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
  const victimTeam=team==='P'?'E':'P';
  const [actor,target]=withCanonicalEngines(game,e=>['cat_thief_hero','imperial_archer']
    .map((characterId,i)=>{
      const unit=e.unitRuntime.create({id:i?'victim':'thief',team:i?victimTeam:team,
        characterId,x:1,y:1,map:game.battlefield.map,cores:game.battlefield.cores});
      assert.ok(unit);delete unit._runtimeMap;
      unit.moved=false;unit.acted=false;unit.waited=false;
      game.units.push(unit);return unit;
    }));
  const passable=t=>t&&globalThis.TERRAINS?.[t.terrain]?.passable;
  let legal=false;
  for(const tile of game.battlefield.map.tiles){
    if(!passable(tile))continue;
    for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]]){
      const near=TacticalEngine.tile(game.battlefield.map,tile.x+dx,tile.y+dy);
      if(!passable(near))continue;
      actor.x=tile.x;actor.y=tile.y;target.x=near.x;target.y=near.y;
      if(TacticalEngine.canTarget(game.battlefield.map,actor,target,skill,game.environmentState)&&
        TacticalEngine.teamCanSee(game.battlefield.map,game.units,team,target,game.environmentState)){
        legal=true;break;
      }
    }
    if(legal)break;
  }
  assert.ok(legal,'original range, terrain and sight find a legal adjacent victim');
  if(team==='E'){game.phase='ENEMY_TACTICAL_PHASE';game.activeSeat=1;}
  return {game,actor,target,seat:team==='P'?0:1};
}
function addPreparedItem(victim){
  const payload=ItemRuntimeEngine.addItem(victim,'hp_potion_small',
    {owned:false,source:'PVP_PREPARATION'});
  assert.ok(payload);payload.preparationTeam=victim.team;
  return payload;
}
function envelope(session,commandId,action){return {protocol:PVP_COMMAND_PROTOCOL,commandId,
  baseRevision:session.revision,action};}
function commit(session,seat,action,id){return commitAuthorityCommand({session,seat,
  envelope:envelope(session,id,action),core:pvpAuthoritativeMatchCore});}

test('formal STEAL_LOOT capability is structural; unrelated utility, status and payloads fail closed',()=>{
  assert.equal(isCanonicalPickpocketSkill(skill),true);
  for(const changed of [
    {...skill,utilityAction:{type:'STEAL_LOOT',consumeTurn:false}},
    {...skill,utilityAction:{type:'STEAL_LOOT',consumeTurn:true,gold:999}},
    {...skill,effects:[{type:'HEAL',amount:999}]},
    {...skill,range:null},
    {...skill,approach:{type:'TELEPORT'}},
    {...skill,target:'ALLY'}
  ])assert.equal(isCanonicalPickpocketSkill(changed),false);
});
test('original thief utility steals one real battle item and only the victim unclaimed kill gold; never writes browser profile',()=>{
  const {game,actor,target}=makeGame();
  const item=addPreparedItem(target),initialGold=RewardDatabase.killGold(target),mana=actor.mana;
  // A Node Worker has no localStorage. Any accidental profile mutation fails hard.
  const beforeStorage=globalThis.localStorage;
  globalThis.localStorage={getItem(){throw Error('PVP_MUST_NOT_READ_PROFILE')},
    setItem(){throw Error('PVP_MUST_NOT_WRITE_PROFILE')}};
  try{
    const r=resolveCanonicalPlayerCommand(game,command(actor,target),0);
    assert.equal(r.accepted,true);
    assert.equal(actor.mana,mana-skill.manaCost);
    assert.deepEqual([actor.moved,actor.acted,actor.waited],[true,true,true]);
    assert.equal(actor.inventory.some(p=>p.id===item.id),true);
    assert.equal(target.inventory.some(p=>p.id===item.id),false);
    assert.equal(actor.inventory.find(p=>p.id===item.id).preparationTeam,'E');
    assert.deepEqual(target.lootState,{stolen:true,stolenGold:initialGold});
    assert.equal(game.matchRewards.goldByTeam.P,initialGold);
    assert.equal(game.matchRewards.goldByTeam.E,0);
    assert.deepEqual(game.matchRewards.receipts,[{kind:'STEAL_LOOT',team:'P',
      sourceId:actor.id,targetId:target.id,gold:initialGold,itemId:item.itemId}]);
    assert.doesNotThrow(()=>structuredClone(game));
    assert.equal(RewardEngine.stealable(actor,target),null);
    const payout=withCanonicalEngines(game,()=>RewardEngine.resolveDefeat(target,actor));
    assert.equal(payout.ok,false,'the stolen kill gold cannot be paid again on defeat');
    assert.equal(game.matchRewards.goldByTeam.P,initialGold);
  }finally{globalThis.localStorage=beforeStorage;}
});
test('seat E has the same theft rights; reverse direction never grants gold to the wrong seat',()=>{
  const {game,actor,target}=makeGame('E');
  const amount=RewardDatabase.killGold(target),before=actor.mana;
  const r=resolveCanonicalPlayerCommand(game,command(actor,target),1);
  assert.equal(r.accepted,true);
  assert.equal(actor.mana,before-skill.manaCost);
  assert.equal(game.matchRewards.goldByTeam.E,amount);
  assert.equal(game.matchRewards.goldByTeam.P,0);
  assert.equal(game.matchRewards.receipts[0].team,'E');
});
test('seat-private target options never reveal enemy inventory, gold balances or the rival skill menu',()=>{
  const {game,actor,target}=makeGame();addPreparedItem(target);
  assert.equal(target.lootState,undefined,'read-only projection must not write victim loot state');
  const mine=tacticalDebugProjection(game,0).units.find(u=>u.id===actor.id);
  assert.equal(target.lootState,undefined,'listing targets must not commit theft state');
  assert.ok(mine.pickpocketOptions.some(x=>x.targetId===target.id&&x.skillId===skill.id));
  const rival=tacticalDebugProjection(game,1).units.find(u=>u.id===actor.id);
  assert.equal(rival?.pickpocketOptions,undefined);
  const session=createAuthoritySession({initialState:game,core:pvpAuthoritativeMatchCore});
  const private0=projectAuthoritySession(session,0,pvpAuthoritativeMatchCore).view;
  const private1=projectAuthoritySession(session,1,pvpAuthoritativeMatchCore).view;
  assert.equal(private0.own.matchGold,0);assert.equal(private1.own.matchGold,0);
  assert.equal('matchRewards' in private0,false);
  assert.equal('receipts' in private0.own,false);
  assert.equal('matchRewards' in private1,false);
});
test('command IDs and revised authoritative state block duplicate theft, opposite-seat forgery and fake loot values',()=>{
  const {game,actor,target}=makeGame();addPreparedItem(target);
  let session=createAuthoritySession({initialState:game,core:pvpAuthoritativeMatchCore});
  const snapshot=structuredClone(session),action=command(actor,target);
  for(const forged of [{...action,gold:999},{...action,itemId:'hp_potion_small'},
    {...action,damage:1000},{...action,range:999},{...action,targetId:actor.id}]){
    assert.throws(()=>commit(session,0,forged,'forged_'+String(forged.targetId).padStart(12,'a')));
    assert.deepEqual(session,snapshot,'invalid command never touches the Durable Object session');
  }
  assert.throws(()=>commit(session,1,action,'wrong_seat_0001'),{code:'NOT_YOUR_TURN'});
  const firstEnvelope=envelope(session,'thief_action_001',action);
  const first=commitAuthorityCommand({session,seat:0,envelope:firstEnvelope,core:pvpAuthoritativeMatchCore});
  assert.equal(first.duplicate,false);session=first.nextSession;
  const duplicate=commitAuthorityCommand({session,seat:0,envelope:firstEnvelope,core:pvpAuthoritativeMatchCore});
  assert.equal(duplicate.duplicate,true);
  assert.deepEqual(duplicate.nextSession,session);
  const amount=session.state.matchRewards.goldByTeam.P;
  // Reset only the actor action flags in the test; original one-victim state persists.
  const a=session.state.units.find(u=>u.id===actor.id);
  a.acted=false;a.waited=false;a.moved=false;
  assert.throws(()=>commit(session,0,action,'thief_action_002'),{code:'ILLEGAL_PICKPOCKET_TARGET'});
  assert.equal(session.state.matchRewards.goldByTeam.P,amount);
});
test('illegal range and insufficient MP reject before spending or awarding loot',()=>{
  const {game,actor,target}=makeGame();
  const beforeMana=actor.mana;
  actor.mana=0;
  assert.throws(()=>resolveCanonicalPlayerCommand(game,command(actor,target),0));
  assert.equal(actor.mana,0);
  assert.equal(game.matchRewards,undefined);
  actor.mana=beforeMana;
  target.x=999;target.y=999;
  assert.throws(()=>resolveCanonicalPlayerCommand(game,command(actor,target),0),{code:'ILLEGAL_PICKPOCKET_TARGET'});
  assert.equal(game.matchRewards,undefined);
});
test('preparation item consumed by thief is reconciled only to the actual original owner, after item changes hands',()=>{
  const {game,actor,target}=makeGame();
  const item=addPreparedItem(target);
  resolveCanonicalPlayerCommand(game,command(actor,target),0);
  actor.hp=Math.max(1,actor.hp-50);
  const used=ItemRuntimeEngine.use(actor,item.id);
  assert.equal(used.ok,true);
  assert.equal(used.payload.preparationTeam,'E');
  assert.equal(actor.itemConsumptionsByTeam.E.hp_potion_small,1);
  const session=createAuthoritySession({initialState:game,core:pvpAuthoritativeMatchCore});
  const p=projectAuthoritySession(session,0,pvpAuthoritativeMatchCore).view;
  const e=projectAuthoritySession(session,1,pvpAuthoritativeMatchCore).view;
  assert.equal(p.own.itemConsumptions.hp_potion_small??0,0);
  assert.equal(e.own.itemConsumptions.hp_potion_small,1);
  assert.equal(p.own.matchGold,RewardDatabase.killGold(target));
  assert.equal(e.own.matchGold,0);
});
test('original native battle skillBar submits only skill, actor and authoritative victim IDs',()=>{
  const ui=Object.create(PvpTacticalUI.prototype),found=[],sent=[];
  ui.menuBack=()=>{};ui.add=(name,callback)=>found.push({name,callback});
  ui.request=cmd=>{sent.push(cmd);return true};ui.cancelTarget=()=>{};ui.update=()=>{};
  ui.renderSpecial({id:'thief',pickpocketOptions:[{skillId:skill.id,skillName:skill.name,
    targetId:'victim',targetName:'帝國弓手'}]});
  const choice=found.find(x=>x.name.includes('妙手空空'));
  assert.ok(choice);choice.callback();
  assert.deepEqual(sent,[{type:'CAST_PICKPOCKET',unitId:'thief',
    skillId:skill.id,targetId:'victim'}]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame} from '../src/pvp-match-core.mjs';
import {pvpAuthoritativeMatchCore} from '../src/pvp-authoritative-match-core.mjs';
import {createAuthoritySession,commitAuthorityCommand,projectAuthoritySession} from '../src/battle-authority.mjs';
import {PVP_COMMAND_PROTOCOL} from '../../shared/pvp-command-contract.mjs';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {SkillDatabase} from '../../js/skill-database.js';
const deck=Array(20).fill('imperial_archer_card');
function create(){return createAuthoritySession({initialState:createOpeningGame({decks:[deck,deck],serverSeed:99348}),core:pvpAuthoritativeMatchCore});}
function action(s,seat,a){const id='roadtest_action_'+String(s.revision+1).padStart(8,'0');const committed=commitAuthorityCommand({session:s,seat,core:pvpAuthoritativeMatchCore,envelope:{protocol:PVP_COMMAND_PROTOCOL,commandId:id,baseRevision:s.revision,action:a}});return committed.nextSession;}
function canShoot(state,actor,core,skill){const target={kind:'CORE',id:`CORE:${core.owner}`,x:core.x,y:core.y,team:core.owner==='PLAYER'?'P':'E',alive:true,core};return TacticalEngine.canTarget(state.battlefield.map,actor,target,skill,state.environmentState);}
function bestForwardStep(state,unit,core){
  const reachable=TacticalEngine.reachable(state.battlefield.map,state.units,unit);
  let best=null;
  for(const k of reachable.keys()){
    const [x,y]=k.split(',').map(Number);
    const tile=TacticalEngine.tile(state.battlefield.map,x,y);
    if(!tile||x===unit.x&&y===unit.y)continue;
    const dist=Math.abs(core.x-x)+Math.abs(core.y-y);
    const penalty=Math.abs(y-core.y)*0.01;
    if(!best||dist+penalty<best.score)best={x,y,score:dist+penalty};
  }
  return best&&best.score<Math.abs(unit.x-core.x)+Math.abs(unit.y-core.y)?best:null;
}
test('two real seats: 20-card opening, formal deployment, multi-round path/attack, receipt replay, and Core win',t=>{
  let s=create();
  s=action(s,0,{type:'KEEP_OPENING_HAND'});
  s=action(s,1,{type:'KEEP_OPENING_HAND'});
  assert.equal(s.state.phase,'BATTLEFIELD_READY');
  const preBegin=structuredClone(s);
  s=action(s,0,{type:'BEGIN_BATTLE'});
  const repeatedBegin=commitAuthorityCommand({session:s,seat:0,core:pvpAuthoritativeMatchCore,envelope:{protocol:PVP_COMMAND_PROTOCOL,commandId:'roadtest_action_'+String(preBegin.revision+1).padStart(8,'0'),baseRevision:preBegin.revision,action:{type:'BEGIN_BATTLE'}}});
  assert.equal(repeatedBegin.duplicate,true);
  assert.deepEqual(repeatedBegin.nextSession,s,'retransmitted room command never changes revision or world');
  assert.throws(()=>action(s,1,{type:'END_CARD_PHASE'}),{code:'NOT_YOUR_TURN'});
  for(let seat=0;seat<2;seat++){
    assert.equal(s.state.cards[seat].zones.hand.length,seat===0?5:s.state.cards[seat].zones.hand.length);
    assert.equal(s.state.cards[seat].zones.deck.length+s.state.cards[seat].zones.hand.length+s.state.cards[seat].zones.discard.length+s.state.cards[seat].zones.graveyard.length,20,'formal deck remains 20 cards');
    const privateView=projectAuthoritySession(s,seat,pvpAuthoritativeMatchCore).view;
    assert.equal(privateView.own.hand.length,s.state.cards[seat].zones.hand.length);
    assert.equal(privateView.opponent.handCount,s.state.cards[1-seat].zones.hand.length);
    assert.equal('hand' in privateView.opponent,false);
    const point=s.state.battlefield.deploymentPoints.find(p=>p.owner===(seat===0?'PLAYER':'ENEMY'));
    if(seat===1){s=action(s,0,{type:'END_CARD_PHASE'});s=action(s,0,{type:'END_TACTICAL_PHASE'});}
    s=action(s,seat,{type:'DEPLOY_CARD',cardId:'imperial_archer_card',...point.area[0]});
  }
  const shooterId=s.state.units.find(u=>u.team==='P').id;
  assert.equal(s.state.units.filter(u=>u.team==='P').length,1);
  assert.equal(s.state.units.filter(u=>u.team==='E').length,1);
  s=action(s,1,{type:'END_CARD_PHASE'});
  s=action(s,1,{type:'END_TACTICAL_PHASE'});
  const skill=SkillDatabase.get('imperial_bow_shot');
  let shots=0,moves=0;
  const rounds=70;
  for(let i=0;i<rounds&&s.state.phase!=='MATCH_ENDED';i++){
    assert.equal(s.state.phase,'PLAYER_CARD_PHASE');
    s=action(s,0,{type:'END_CARD_PHASE'});
    const shooter=s.state.units.find(u=>u.id===shooterId),core=s.state.battlefield.cores.find(c=>c.owner==='ENEMY');
    assert.ok(shooter?.alive,'test-side archer must survive real environment effects');
    if(!canShoot(s.state,shooter,core,skill)){
      const step=bestForwardStep(s.state,shooter,core);
      assert.ok(step,'official reachable path to enemy Core exists');
      s=action(s,0,{type:'MOVE_UNIT',unitId:shooterId,x:step.x,y:step.y});moves++;
    }
    const next=s.state.units.find(u=>u.id===shooterId);
    if(next.alive&&!next.acted&&canShoot(s.state,next,core,skill)){
      s=action(s,0,{type:'ATTACK_CORE',unitId:shooterId,skillId:skill.id,coreOwner:'ENEMY'});shots++;
    }
    if(s.state.phase==='MATCH_ENDED')break;
    s=action(s,0,{type:'END_TACTICAL_PHASE'});
    s=action(s,1,{type:'END_CARD_PHASE'});
    s=action(s,1,{type:'END_TACTICAL_PHASE'});
    assert.doesNotThrow(()=>structuredClone(s));
  }
  assert.equal(s.state.phase,'MATCH_ENDED',`after ${s.state.round} rounds, ${shots} shots, ${moves} moves`);
  assert.equal(s.state.matchResult,'VICTORY');
  assert.equal(s.state.battlefield.cores.find(c=>c.owner==='ENEMY').hp,0);
  assert.ok(shots>0&&moves>0);
  t.diagnostic(`real canonical match complete: ${s.state.round} rounds, ${shots} legal Core attacks, ${moves} real map path moves, final revision ${s.revision}`);
});

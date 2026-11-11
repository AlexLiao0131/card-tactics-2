import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBattleEngagementPlayback} from '../../js/battle-engagement-playback.js';

function fixture(){
 const callbacks=[],history=[],activeAnimations=new Set(),effects=new Set();
 let modalOpen=true,gameplayCommits=0,resourceSpent=0,damage=0,autoAdvanced=false;
 const gate=createBattleEngagementPlayback({
   afterFrame:callback=>callbacks.push(callback),
   hasPendingVisuals:participants=>[...activeAnimations,...effects].some(id=>participants.has(id))
 });
 const turn={
   participants:['templar','target','support'],
   close:()=>{modalOpen=false;history.push('modal-closed')},
   commit:()=>{
     assert.equal(modalOpen,false,'UI must be gone before damage or movement');
     gameplayCommits++;resourceSpent+=16;damage+=35;
     history.push('battle-committed');activeAnimations.add('templar');effects.add('support');
   },
   complete:()=>{autoAdvanced=true;history.push('next-turn')}
 };
 return {callbacks,history,activeAnimations,effects,gate,turn,
   get state(){return{modalOpen,gameplayCommits,resourceSpent,damage,autoAdvanced}},
   nextFrame(){const callback=callbacks.shift();assert.ok(callback,'no scheduled scene frame');callback()}
 };
}

test('closes support overlay before gameplay movement/damage/resources',()=>{
 const x=fixture();assert.equal(x.gate.begin(x.turn),true);
 assert.equal(x.state.modalOpen,false);assert.equal(x.state.gameplayCommits,0);
 x.nextFrame();assert.equal(x.state.gameplayCommits,1);
 assert.deepEqual(x.history,['modal-closed','battle-committed']);
});

test('rendered postcommit animations gate turn advance, not arbitrary time',()=>{
 const x=fixture();x.gate.begin(x.turn);x.nextFrame();
 x.nextFrame();assert.equal(x.state.autoAdvanced,false);
 x.activeAnimations.delete('templar');x.nextFrame();assert.equal(x.state.autoAdvanced,false);
 x.effects.delete('support');x.nextFrame();assert.equal(x.state.autoAdvanced,true);
});

test('double clicking confirmation commits exactly once',()=>{
 const x=fixture();assert.equal(x.gate.begin(x.turn),true);
 assert.equal(x.gate.begin(x.turn),false);
 x.nextFrame();x.activeAnimations.clear();x.effects.clear();x.nextFrame();
 assert.equal(x.state.gameplayCommits,1);assert.equal(x.state.resourceSpent,16);
});

test('reset cancels pending confirmation without any delayed gameplay',()=>{
 const x=fixture();x.gate.begin(x.turn);x.gate.cancel();x.nextFrame();
 assert.equal(x.state.gameplayCommits,0);assert.equal(x.state.autoAdvanced,false);
});

test('reset cancels a committed pending animation without advancing a stale turn',()=>{
 const x=fixture();x.gate.begin(x.turn);x.nextFrame();x.gate.cancel();x.nextFrame();
 assert.equal(x.state.gameplayCommits,1);assert.equal(x.state.autoAdvanced,false);
});

test('no visual events: completion is released after one postcommit render',()=>{
 const callbacks=[];const events=[];
 const gate=createBattleEngagementPlayback({afterFrame:cb=>callbacks.push(cb),hasPendingVisuals:()=>false});
 gate.begin({participants:['actor'],close:()=>events.push('closed'),commit:()=>events.push('committed'),complete:()=>events.push('completed')});
 callbacks.shift()();assert.deepEqual(events,['closed','committed']);
 callbacks.shift()();assert.deepEqual(events,['closed','committed','completed']);
});

test('failed resolution is not treated as successful combat or auto-end',()=>{
 const callbacks=[];const events=[];
 const gate=createBattleEngagementPlayback({afterFrame:cb=>callbacks.push(cb),hasPendingVisuals:()=>true});
 gate.begin({close:()=>events.push('closed'),commit:()=>false,complete:ok=>events.push(ok?'success':'cancelled')});
 callbacks.shift()();assert.deepEqual(events,['closed','cancelled']);assert.equal(gate.isActive(),false);
});

test('throw during commit releases playback lock for recovery',()=>{
 const callbacks=[];let message=null;
 const gate=createBattleEngagementPlayback({afterFrame:cb=>callbacks.push(cb),hasPendingVisuals:()=>false});
 gate.begin({close:()=>{},commit:()=>{throw Error('failed authority')},complete:()=>{},failed:error=>message=error.message});
 callbacks.shift()();assert.equal(message,'failed authority');assert.equal(gate.isActive(),false);
});

test('production UI delegates confirm to the frame playback gate, not immediate resolve',()=>{
 const source=readFileSync(new URL('../../js/tactical-game.js',import.meta.url),'utf8');
 assert.match(source,/if\(id==="CONFIRM_ENGAGEMENT"\)\{beginConfirmedEngagement\(\)/);
 assert.match(source,/mode="engagement-playback";render\(\)/);
 assert.match(source,/if\(engagementPlayback\?\.isActive\(\)\)\{[\s\S]*?skillBar\.style\.display="none"/);
 assert.match(source,/actionController\.confirmEngagement\(\);return true/);
 assert.match(source,/maybeAutoEndPlayerTurn:\(\)=>engagementPlayback\?\.isActive\(\)\?false/);
});

test('PvP engagement route remains authoritative and untouched',()=>{
 const source=readFileSync(new URL('../../js/tactical-game.js',import.meta.url),'utf8');
 assert.match(source,/if\(document\.body\.dataset\.battleMode==='PVP'\)return/);
 const gate=readFileSync(new URL('../../js/battle-engagement-playback.js',import.meta.url),'utf8');
 assert.doesNotMatch(gate,/BattleResolution\.resolve|EffectEngine\.apply|manaCost/);
});

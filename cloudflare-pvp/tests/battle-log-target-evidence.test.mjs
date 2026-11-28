import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import '../src/pvp-match-core.mjs';
import '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {BattleLog} from '../../js/battle-log.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {EnvironmentEngine} from '../../js/environment-engine.js';
import {SkillDatabase} from '../../js/skill-database.js';
import {createBattleAreaFieldState} from '../../js/battle-area-field-engine.js';
const makeMap=()=>({id:'visibility-diagnostics',width:12,height:3,objects:[],tiles:Array.from({length:36},(_,i)=>({x:i%12,y:Math.floor(i/12),terrain:'PLAIN',elevation:0}))});
function worldTest(run){const map=makeMap(),world={randomState:5,map,units:[],cores:[],stage:{mode:'VERSUS',intelMode:'DYNAMIC_INTEL'},environmentState:EnvironmentEngine.create({weather:'CLEAR',timeOfDay:'NIGHT',moonlight:'FULL'}),fieldState:createBattleAreaFieldState()};return withCanonicalEngines(world,e=>{
 const spawn=(id,characterId,team,x,y)=>{const u=e.unitRuntime.create({id,characterId,team,x,y,map});assert.ok(u);world.units.push(u);return u};
 const viewer=spawn('pc1','church_saint','P',0,1),enemy=spawn('ec1','church_saint','E',10,1);return run({world,map,viewer,enemy,spawn});
 });}
test('real night visibility hides deployment names, including two identical heroes on opposing teams',()=>worldTest(({world,viewer,enemy})=>{
 assert.equal(TacticalEngine.teamCanIdentifyUnit(world,'P',enemy),false);
 assert.equal(BattleLog.mayPublish(world,'P',{units:[enemy]}),false);
 assert.equal(BattleLog.mayPublish(world,'P',{units:[viewer]}),true);
 assert.equal(BattleLog.mayPublish(world,'P',{units:[viewer,enemy]}),false);
 assert.equal(BattleLog.mayPublish(world,'P',null),false);
 assert.equal(BattleLog.mayPublish(world,'P',{viewerTeam:'E'}),false);
 assert.equal(BattleLog.mayPublish(world,'P',{public:true}),true);
 assert.equal(BattleLog.mayPublish(world,'P',{cells:[{x:10,y:1}]}),false);
}));
test('an unauthorized historical event is never appended or revealed when the enemy becomes visible or dies',()=>worldTest(({world,viewer,enemy})=>{
 const log=BattleLog.create();const publish=(text,scope)=>{if(BattleLog.mayPublish(world,'P',scope))BattleLog.add(log,'BATTLE',text);};
 publish('hidden deployment secret',{units:[enemy]});enemy.x=2;
 assert.equal(TacticalEngine.teamCanIdentifyUnit(world,'P',enemy),true);
 publish('visible attack',{units:[viewer,enemy]});enemy.x=10;enemy.alive=false;
 publish('hidden casualty secret',{units:[enemy]});
 assert.deepEqual(log.entries.map(e=>e.text),['visible attack']);
}));
test('real lock trace has identical legal result, and explains range, night vision, terrain and diver restrictions',()=>worldTest(({world,map,viewer,enemy})=>{
 const skill=SkillDatabase.get('saint_judgement');assert.ok(skill);const cases=[];
 function check(s=skill){const seen=[];const plain=TacticalEngine.canTarget(map,viewer,enemy,s,world.environmentState);const traced=TacticalEngine.canTarget(map,viewer,enemy,s,world.environmentState,(reason,details)=>seen.push({reason,details}));assert.equal(traced,plain);cases.push({plain,seen});return seen;}
 assert.ok(check().some(e=>e.reason==='OUT_OF_RANGE'));
 assert.ok(check({...skill,range:{min:1,max:12}}).some(e=>e.reason==='VISION_DISTANCE'));
 enemy.x=1;assert.equal(check().length,0);
 enemy.x=3;map.tiles.find(t=>t.x===2&&t.y===1).elevation=10;assert.ok(check().some(e=>e.reason==='VISION_LINE_BLOCKED'));
 enemy.x=1;enemy.verticalState={mode:'DIVING'};assert.ok(check().some(e=>e.reason==='DIVER_HIDDEN'));
 assert.equal(cases.length,5);
}));
const source=readFileSync(new URL('../../js/diagnostics.js',import.meta.url),'utf8');
function diag(enabled=true){const data=new Map([['ct:diagnostics',enabled?'1':'0']]),win={addEventListener(){}},document={readyState:'loading',visibilityState:'visible',addEventListener(){},querySelectorAll(){return[]}};vm.runInNewContext(source,{window:win,document,performance:{now:()=>100},navigator:{userAgent:'test'},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},requestAnimationFrame(){},setInterval(){},setTimeout(){}});const api=win.CardTacticsDiagnostics;return {api,data,report:()=>JSON.parse(api.report().split('\n').slice(1).join('\n'))};}
test('settings retains battle, targeting and perception evidence independently of climate event churn',()=>{
 const {api,report}=diag();api.recordBattleLog({type:'BATTLE',text:'Hidden enemy damage',scope:'UNCLASSIFIED',unitIds:['ec1'],round:5});api.recordTargeting({kind:'BATTLE_TILE_CLICK',reason:'OUT_OF_RANGE'});api.recordPerception({kind:'RESTORED',round:5});api.recordBattlePresentation([{type:'UNIT_ANIMATION',sequence:2,state:'WALK',unitId:'ec1',path:[{x:1,y:1,z:0},{x:2,y:1,z:0}]}],{round:5});
 for(let i=0;i<400;i++)api.push('HYDROLOGY_EVENT',{i});
 const r=report();assert.equal(r.battleHistory[0].text,'Hidden enemy damage');assert.equal(r.targetingHistory[0].reason,'OUT_OF_RANGE');assert.equal(r.perceptionHistory[0].kind,'RESTORED');assert.equal(r.battlePresentationHistory[0].path.to.x,2);
 assert.equal(r.recentEvents.length,320);api.clear();assert.equal(report().battleHistory.length,0);assert.equal(report().targetingHistory.length,0);assert.equal(report().perceptionHistory.length,0);assert.equal(report().battlePresentationHistory.length,0);
});
test('disabled diagnostics collect none of the new records; online log only collects authorized entries once',()=>{
 const off=diag(false);off.api.recordBattleLog({type:'BATTLE',text:'x'});off.api.recordTargeting({kind:'x'});off.api.recordPerception({kind:'x'});off.api.recordBattlePresentation([{type:'UNIT_ANIMATION',unitId:'x'}],{});assert.equal(off.report().battleHistory.length,0);assert.equal(off.report().targetingHistory.length,0);assert.equal(off.report().perceptionHistory.length,0);assert.equal(off.report().battlePresentationHistory.length,0);
 const {api,report}=diag(),logs=[{type:'BATTLE',text:'visible'},{type:'SYSTEM',text:'phase'}];api.recordOnlineBattleLog(logs,{round:1});api.recordOnlineBattleLog(logs,{round:1});api.recordOnlineBattleLog([...logs,{type:'DETAIL',text:'new'}],{round:1});assert.equal(report().battleHistory.length,3);
});

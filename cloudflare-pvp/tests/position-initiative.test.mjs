import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the unmodified official exported function bodies with minimal battle
// fixtures. Do not implement alternative speed or facing rules inside the test.
const load=(file,globalName,scope)=>{
  const source=fs.readFileSync(new URL(file,import.meta.url),'utf8')
    .replace(/^import\s+.*?;\s*$/gm,'')
    .replace(/\bexport (function|const)\b/g,'$1');
  const sandbox={...scope};
  sandbox.globalThis=sandbox;
  vm.runInNewContext(source+`\nglobalThis.__tested=${globalName};`,sandbox,{filename:file});
  return sandbox.__tested;
};
const FACE={arc:'FRONT'};
const tactical={relativeArc:()=>FACE.arc,canTarget:()=>true};
const battle={actionSpeed:(character,skill)=>Number(character.attributes.agi)*4+Number(skill?.speed||0)};
const skillDb={passiveList:ids=>(ids||[]).includes('TEST_FIRST')?
  [{duelRules:{weaponKind:'SWORD',targetType:'SINGLE',initiative:'FIRST'}}]:[]};
const scope={TacticalEngine:tactical,BattleEngine:battle,SkillDatabase:skillDb,
  BATTLE_RULES:{combatParams:{agiSpeedStep:4}},CombatContactRules:{canActiveEvade:()=>false},
  WeaponMaterialEngine:{defenseMatchup:()=>({chance:null})}};
const createResolution=load('../../js/battle-resolution.js','createBattleResolution',scope);
const chooseReaction=load('../../js/battle-reaction-decision-engine.js','chooseAutonomousBattleReaction',scope);
const resolution=createResolution();
const unit=(id,agi,x,team,first=false)=>({id,alive:true,x,y:0,team,
  character:{attributes:{agi},passives:first?['TEST_FIRST']:[],weapons:{sword:{weaponKind:'SWORD'}}}});
const strike=(speed=0)=>({id:'strike',speed,weapon:'sword',targetType:'SINGLE',target:'ENEMY',attackType:'SLASH'});
const setup=(attackerAgi=10,defenderAgi=20,skillSpeed=0,duelFirst=false)=>{
  const attacker=unit('attacker',attackerAgi,0,'P');
  const defender=unit('defender',defenderAgi,1,'E',duelFirst);
  const attackSkill=strike(skillSpeed),counterSkill=strike();
  const c={initiator:attacker,originalTarget:defender,target:defender,skill:attackSkill,units:[attacker,defender],
    interception:null,actions:[
      {id:'primary',role:'INITIATOR',actor:attacker,target:defender,skill:attackSkill},
      {id:'counter',role:'COUNTER',actor:defender,target:attacker,skill:counterSkill}
    ]};
  return{attacker,defender,attackSkill,counterSkill,c};
};
const order=c=>resolution.buildQueue(c).map(x=>x.role);

test('front: high AGI counter retains official first strike',()=>{
  FACE.arc='FRONT';const {c}=setup();
  assert.deepEqual(order(c),['COUNTER','INITIATOR']);
});
test('side: only positive defender AGI advantage is halved',()=>{
  FACE.arc='SIDE';const {attacker,defender,c}=setup();
  assert.equal(resolution.positionInitiative(attacker,defender).counterSpeedPenalty,20);
  assert.deepEqual(resolution.buildQueue(c).map(x=>x.spd),[60,40]);
});
test('side: faster attacking skill can overturn AGI disadvantage; front cannot',()=>{
  const {c}=setup(10,20,25);
  FACE.arc='FRONT';assert.deepEqual(order(c),['COUNTER','INITIATOR']);
  FACE.arc='SIDE';assert.deepEqual(order(c),['INITIATOR','COUNTER']);
});
test('side: an already slower defender gets no extra penalty',()=>{
  FACE.arc='SIDE';const {attacker,defender,c}=setup(20,10);
  assert.equal(resolution.positionInitiative(attacker,defender).counterSpeedPenalty,0);
  assert.deepEqual(order(c),['INITIATOR','COUNTER']);
});
test('back: primary attack first, but legal counter remains in queue',()=>{
  FACE.arc='BACK';const {c}=setup();
  assert.deepEqual(order(c),['INITIATOR','COUNTER']);
  assert.equal(resolution.buildQueue(c).length,2);
});
test('authored FIRST duel overrides ordinary back position priority',()=>{
  FACE.arc='BACK';const {c}=setup(10,20,0,true);
  assert.deepEqual(order(c),['COUNTER','INITIATOR']);
});
test('guardian interception does not inherit original target flank',()=>{
  FACE.arc='BACK';const {c}=setup();c.interception={type:'GUARD_ALLY'};
  assert.deepEqual(order(c),['COUNTER','INITIATOR']);
});
test('allied support action gets no side counter penalty',()=>{
  FACE.arc='SIDE';const {c}=setup();
  const supporter=unit('support',20,2,'P');
  c.actions.push({id:'support',role:'SUPPORT',actor:supporter,target:c.originalTarget,skill:strike()});
  const q=resolution.buildQueue(c);
  assert.equal(q.find(x=>x.role==='SUPPORT').spd,80);
  assert.equal(q.find(x=>x.role==='COUNTER').spd,60);
});
test('autonomous choice reads the same flank penalty as official queue',()=>{
  const {attacker,defender,attackSkill,counterSkill}=setup(10,20,25);
  const defense={id:'guard',vs:{SLASH:{damageMultiplier:0.5}}};
  const api={
    prepareSingleTargetReaction:()=>({counterSkills:[counterSkill],defenseMethods:[defense]}),
    createReaction:(type,details)=>({type,...details}),
    actionSpeed:resolution.actionSpeed,
    positionInitiative:resolution.positionInitiative,buildQueue:resolution.buildQueue,
    guardCandidates:()=>[],createGuardInterception:()=>null
  };
  const input={map:{},units:[attacker,defender],attacker,defender,skill:attackSkill,
    resolution:api,canUseSkill:()=>true};
  FACE.arc='FRONT';assert.equal(chooseReaction(input).kind,'COUNTER');
  FACE.arc='SIDE';assert.equal(chooseReaction(input).kind,'DEFENSE');
  FACE.arc='BACK';assert.equal(chooseReaction(input).kind,'DEFENSE');
});
test('front default and sideways equal AGI preserve previous stable order',()=>{
  const {c}=setup(15,15);
  FACE.arc='FRONT';assert.deepEqual(order(c),['INITIATOR','COUNTER']);
  FACE.arc='SIDE';assert.deepEqual(order(c),['INITIATOR','COUNTER']);
});

test('autonomous choice retains an authored duel-first counter from behind',()=>{
  const {attacker,defender,attackSkill,counterSkill}=setup(10,20,0,true);
  const defense={id:'guard',vs:{SLASH:{damageMultiplier:0.5}}};
  const api={prepareSingleTargetReaction:()=>({counterSkills:[counterSkill],defenseMethods:[defense]}),
    createReaction:(type,details)=>({type,...details}),actionSpeed:resolution.actionSpeed,
    positionInitiative:resolution.positionInitiative,buildQueue:resolution.buildQueue,
    guardCandidates:()=>[],createGuardInterception:()=>null};
  FACE.arc='BACK';
  const result=chooseReaction({map:{},units:[attacker,defender],attacker,defender,
    skill:attackSkill,resolution:api,canUseSkill:()=>true});
  assert.equal(result.kind,'COUNTER');
});

test('area attacks do not inherit rear-ambush priority',()=>{
  FACE.arc='BACK';const {c}=setup();c.skill={...c.skill,targetType:'AREA'};
  assert.deepEqual(order(c),['COUNTER','INITIATOR']);
});

test('legacy Ganfan test harness without arc/params keeps front queue and does not throw',()=>{
  const legacy={...scope,TacticalEngine:{faceToward:()=>{},ensureFacing:()=> 'E'}};
  delete legacy.BATTLE_RULES;
  const factory=load('../../js/battle-resolution.js','createBattleResolution',legacy);
  const duel=factory();
  const {c}=setup();
  assert.deepEqual(duel.buildQueue(c).map(a=>a.role),['COUNTER','INITIATOR']);
});

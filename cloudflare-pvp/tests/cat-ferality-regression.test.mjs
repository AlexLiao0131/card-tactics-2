import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=name=>readFileSync(new URL('../../js/'+name,import.meta.url),'utf8');
const context=(extras={})=>{const c={...extras};c.globalThis=c;return c;};
const load=(name,sandbox)=>{
  const script=src(name).replace(/^import\s.+;\s*$/gm,'')
    .replace(/^export\s+const /gm,'const ').replace(/^export\s+function /gm,'function ')
    .replace(/^export\s*\{.+\};\s*$/gm,'');
  return vm.runInNewContext(script,sandbox,{filename:name});
};
function fixture(){
  const profiles=context({});vm.runInNewContext(src('resource-profile-database.js').replace('export const RESOURCE_PROFILES=', 'globalThis.RESOURCE_PROFILES='),profiles);
  const RESOURCE_PROFILES=profiles.RESOURCE_PROFILES;
  // Use ResourceEngine's existing scalar contract, not a second Ferality
  // store. The small in-memory adapter models only calls made by this fixture.
  const rules=u=>Object.fromEntries(Object.entries(u.character?.resourceRules||{})
    .filter(([k,v])=>k!=='mana'&&v&&typeof v==='object')
    .map(([k,v])=>[k,{...RESOURCE_PROFILES[k],...v}]));
  const resource={
    RESOURCE_PROFILES,RESOURCE_MANA:{base:40,intFactor:2,wilFactor:2},
    resourceRules:rules,resourceLabel:(k,p)=>p.label||k,
    syncOne(u,k,p){const spec=p||rules(u)[k];if(!spec)return null;u.resources??={};
      const v=u.resources[k]??={value:spec.initial??0,max:spec.max??100,label:spec.label};
      return v;},
    sync(u){u.resources??={};Object.keys(rules(u)).forEach(k=>resource.syncOne(u,k));return u.resources;},
    value(u,k){return this.syncOne(u,k)?.value??null;},
    set(u,k,n){const v=this.syncOne(u,k),before=v?.value??0;
      if(!v)return 0;v.value=Math.max(0,Math.min(v.max,Number(n)));return v.value-before;},
    change(u,k,n){return this.set(u,k,(this.value(u,k)||0)+Number(n));},
    snapshot(u){this.sync(u);return Object.fromEntries(Object.entries(u.resources).map(([k,v])=>[k,{...v}]));},
    manaMaxFromAttributes:()=>100,manaMax:()=>100,
    syncMana(u){u.maxMana=100;u.mana??=100;return {mana:u.mana,maxMana:100};},
    changeMana(u,n){this.syncMana(u);const before=u.mana;u.mana=Math.max(0,Math.min(100,u.mana+n));return u.mana-before;},
    materialKey:()=>null,hasMaterial:()=>false,materialCount:()=>0
  };
  const trait={resourceKey:()=>null,status:()=>null,initialize:()=>null,transformedSkill:(u,s)=>s,
    afterCommittedSkill:()=>{},isUncontrolled:u=>u.controlOverride?.type==='BERSERK'};
  const skills={feral:{id:'cat_feral_feast',name:'獵食狂舞',power:.72,hitCount:4,
    attackType:'SLASH',category:'ATTACK',range:{min:1,max:1},target:'ENEMY',weapon:'daggers',
    resourceCosts:{ferality:100},requirements:{feralityFull:true},feralUltimate:true},
    dual:{id:'cat_dual_slash',power:1,attackType:'SLASH',range:{min:1,max:1},category:'ATTACK',target:'ENEMY',weapon:'daggers'},
    back:{id:'cat_backstab',power:1,attackType:'PIERCE',range:{min:1,max:1},category:'ATTACK',target:'ENEMY',weapon:'daggers'},
    ranged:{id:'cat_poison_knife',power:1,attackType:'PIERCE',attackClass:'RANGED',range:{min:2,max:4},category:'ATTACK',target:'ENEMY',weapon:'throwing_knife'}};
  const actor={id:'cat',alive:true,team:'P',x:0,y:0,character:{id:'cat_thief_hero',name:'米菈',
    resourceRules:{mana:true,ferality:{}},skills:Object.values(skills).map(x=>x.id),
    weapons:{daggers:{weaponKind:'DAGGER'},throwing_knife:{weaponKind:'THROWING_KNIFE'}},
    attributes:{str:20,agi:20,int:9,wil:11,vit:12,luk:20},combat:{hp:200,atk:50,def:20,mdef:20},passives:[]},
    mana:100,maxMana:100,resources:{},hp:200,acted:false,waited:false};
  const db={get:id=>Object.values(skills).find(s=>s.id===id),passiveList:()=>[],list:ids=>ids.map(id=>db.get(id)).filter(Boolean)};
  const sandbox=context({ResourceEngine:resource,ColinShieldMobilityEngine:{shieldOccupied:()=>false},
    UnitTraitEngine:trait,SkillDatabase:db,EffectEngine:{syncModifiers:()=>{},breakStealth:()=>{}},
    BATTLE_RULES:{combatParams:{agiSpeedStep:0}},BattleEngine:{actionSpeed:()=>0}});
  load('unit-runtime-engine.js',sandbox);
  return {u:actor,r:sandbox.UnitRuntimeEngine,db,skills,sandbox,resource,profiles:RESOURCE_PROFILES};
}

test('profile and loadout: only Catkin owns the new 0-100 amber resource and ultimate',()=>{
  const {u,r,profiles}=fixture();
  assert.equal(profiles.ferality.max,100);assert.equal(profiles.ferality.initial,0);
  assert.equal(profiles.ferality.color,'#D97726');
  assert.equal(r.feralityValue(u),0);
  assert.match(src('loadout-database.js'),/cat_dual_slash","cat_backstab","cat_feral_feast/);
  assert.match(src('character-database.js'),/cat_thief_hero:\{[^\n]*resourceRules:\{mana:true,ferality:\{\}\}/);
});
test('real hit-based beast credits: two contacts, backstab, evade, kill, no DOT, no miss',()=>{
  const {u,r,skills}=fixture(),target={team:'E',kind:'UNIT'};
  assert.equal(r.onFeralityContact(u,skills.dual,target,{hpLoss:12}),8);
  assert.equal(r.onFeralityContact(u,skills.dual,target,{hpLoss:12}),8);
  assert.equal(r.onFeralityContact(u,skills.dual,target,{hpLoss:0}),0);
  assert.equal(r.onFeralityContact(u,skills.back,target,{hpLoss:15,backstab:false}),0);
  assert.equal(r.onFeralityContact(u,skills.back,target,{hpLoss:15,backstab:true}),20);
  assert.equal(r.onFeralityEvade(u),6);
  assert.equal(r.onFeralityKill(u,target),15);
  assert.equal(r.feralityValue(u),57);
});
test('balanced melee scaling updates at 50 / 80 / 100 and never buffs throwing knives',()=>{
  const {u,r,skills,resource}=fixture();
  for(const [n,expected] of [[0,0],[49,0],[50,.05],[79,.05],[80,.1],[99,.1],[100,.15]]){
    resource.set(u,'ferality',n);
    assert.ok(Math.abs(r.feralityBonus(u,skills.dual)-expected)<1e-9,`at ${n}`);
    assert.equal(r.feralityBonus(u,skills.ranged),0);
  }
  resource.set(u,'ferality',100);
  const scaled=r.applyResourceScaling(u,skills.dual);
  assert.equal(Number(scaled.power.toFixed(2)),1.15);
});
test('ultimate locked until full; pays 100 exactly once; feral control is committed only after battle',()=>{
  const {u,r,skills,resource}=fixture();
  resource.set(u,'ferality',99);assert.equal(r.canUseSkill(u,skills.feral),false);
  resource.set(u,'ferality',100);assert.equal(r.canUseSkill(u,skills.feral),true);
  const applied=r.applyResourceScaling(u,skills.feral);
  assert.equal(Number(applied.power.toFixed(3)),.828);
  const payment=r.consumeSkill(u,applied);
  assert.equal(payment.resources.ferality.cost,100);
  assert.equal(r.feralityValue(u),0);assert.equal(u.team,'P');
  assert.equal(r.canUseSkill(u,skills.feral),false);
  // A final killing blow can award +15 before the ultimate finishes.
  r.onFeralityKill(u,{team:'E'});assert.equal(r.feralityValue(u),15);
  assert.equal(r.startFeralRampage(u),true);
  assert.equal(r.feralityValue(u),0);assert.equal(u.team,'N');
  assert.equal(u.controlOverride?.type,'BERSERK');
  assert.equal(u.controlOverride?.behavior,'PREDATOR');
  assert.equal(u.participatesInTurn,false);
  assert.equal(r.startFeralRampage(u),false,'one spell cannot cause two rampages');
});
test('cat remains uncontrolled until the actual neutral action finishes; restores exactly next round',()=>{
  const {u,r,skills,resource}=fixture();
  resource.set(u,'ferality',100);r.consumeSkill(u,skills.feral);r.startFeralRampage(u);
  assert.deepEqual([...r.onFeralityRoundStart({units:[u],round:2})],[]);
  u.controlOverride.actionDoneRound=2;
  assert.deepEqual([...r.onFeralityRoundStart({units:[u],round:2})],[]);
  assert.deepEqual([...r.onFeralityRoundStart({units:[u],round:3})],[u.id]);
  assert.equal(u.team,'P');assert.equal(u.participatesInTurn,true);
  assert.equal(u.controlOverride,undefined);assert.equal(r.feralityValue(u),0);
});
test('predator uses existing neutral legality and prioritizes real bleeding prey regardless of faction',()=>{
  const {u,r,skills,sandbox,db,resource}=fixture();
  resource.set(u,'ferality',100);r.consumeSkill(u,skills.feral);r.startFeralRampage(u);
  const ally={id:'ally',alive:true,team:'P',x:1,y:0,hp:75,effects:[{id:'BLEEDING'}]};
  const enemy={id:'enemy',alive:true,team:'E',x:0,y:1,hp:3,effects:[]};
  sandbox.MonsterDatabase={get:()=>null,forCharacter:()=>null};
  sandbox.TacticalEngine={canTarget:()=>true,actorCanTrackTarget:()=>true,distanceBetween:(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)};
  load('neutral-actor-engine.js',sandbox);
  const choice=sandbox.NeutralActorEngine.chooseAttack({map:{},units:[u,ally,enemy],unit:u,runtime:r,random:()=>.99});
  assert.equal(choice.target.id,'ally','bleeding ally is a valid prey even if a low-HP enemy exists');
  assert.equal(sandbox.NeutralActorEngine.availableActors([u],2).length,1);
  sandbox.NeutralActorEngine.markActed(u,2);
  assert.equal(sandbox.NeutralActorEngine.availableActors([u],2).length,0);
});
test('feral controls reuse canonical round coordinator, not a separate timer',()=>{
  const source=src('battle-round-rule-engine.js');
  assert.match(source,/UnitRuntimeEngine\.onFeralityRoundStart\(world\)/);
  assert.match(source,/BattlefieldFieldEngine\.onRoundStart\(world\)/);
});
test('fang HUD has ten individual teeth, matching 0-100, red only on berserk',()=>{
  const code=src('unit-hud-overlay.js');
  const helper=code.slice(code.indexOf('function feralityFangs('),code.indexOf('export class UnitHudOverlay{'));
  const el=(name)=>({name,attrs:{},style:{cssText:'',filter:'',opacity:''},children:[],
    setAttribute(k,v){this.attrs[k]=String(v)},appendChild(c){this.children.push(c)}});
  const sandbox=context({document:{createElementNS:(ns,name)=>el(name)}});
  vm.runInNewContext(helper+'\n;globalThis.testFangs=feralityFangs;',sandbox);
  for(const [value,lit] of [[0,0],[49,4],[50,5],[80,8],[100,10]]){
    const svg=sandbox.testFangs(value,100,false),paths=svg.children;
    assert.equal(paths.length,11);
    assert.equal(paths.filter(p=>p.attrs.fill==='#E8A341').length,lit);
  }
  const feral=sandbox.testFangs(0,100,true);
  assert.match(feral.attrs['aria-label'],/野性暴走/);
  assert.match(src('unit-hud-overlay.js'),/id==="ferality"/);
});

test('formal BattleResolution: 4 independent hits pay once and transfer to neutral only after last contact',()=>{
  const {u,r,skills,sandbox,resource}=fixture();
  resource.set(u,'ferality',100);
  const target={id:'enemy',team:'E',alive:true,hp:500,x:1,y:0,
    character:{id:'enemy',name:'獵物',combat:{hp:500,atk:40,def:20,mdef:20},weapons:{},passives:[]}};
  const map={tiles:Array.from({length:16},(_,i)=>({x:i%4,y:Math.floor(i/4),terrain:'PLAIN',elevation:0}))};
  const contacts=[],actions=[];
  sandbox.TacticalEngine={ensureFacing:a=>(a.facing??='N'),faceToward:()=>{},
    relativeArc:()=> 'BACK',distanceBetween:(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y),
    tile:(m,x,y)=>m.tiles.find(t=>t.x===x&&t.y===y)||null,
    canTarget:()=>true,
    resolve:(m,a,t,s)=>({result:{hit:true,damage:40,crit:false,physicalCrit:false,magicCrit:false,
      graze:false,type:'SLASH',el:'NONE',hc:100,cc:0,accuracy:0,evasion:0},terrain:{acc:0,eva:0}})};
  sandbox.EquipmentDatabase={defenseProfiles:()=>[]};
  sandbox.BattleEngine={actionSpeed:()=>0,critChance:()=>0};
  sandbox.WeaponMaterialEngine={defenseMatchup:()=>({chance:null,pressure:0,materialAdvantage:0})};
  sandbox.chooseAutonomousBattleReaction=()=>null;
  sandbox.CombatContactRules={isPureMagic:()=>false,canActiveEvade:()=>false,canGanfanDefend:()=>false};
  sandbox.EffectEngine={consumeWeaponEnchantment:()=>null,breakStealth:()=>{},interruptChannel:()=>{},
    applyDamage:(v,d)=>{const hpLoss=Math.max(0,Math.min(v.hp,Math.round(d)));v.hp-=hpLoss;
      return {hpLoss,absorbed:0}},hasEffect:()=>false,
    markVengeance:()=>{},consumeVengeance:()=>{},syncModifiers:()=>{}};
  sandbox.PostEngagementEngine={process:()=>({queue:[],results:[]})};
  sandbox.UnitAnimationEngine={emitAction:(a,b,skill,details)=>{actions.push([a.team,skill.id]);return {sequence:10,skillId:skill.id};},
    emitResolvedHit:(v,data)=>{contacts.push([v.hp,data.damage,u.team]);return {type:'UNIT_FLOAT_TEXT',sequence:11}},
    emitHit:()=>{},emitOutcome:()=>{},emitMove:()=>{},emitPresentation:()=>{}};
  load('battle-resolution.js',sandbox);
  const result=sandbox.BattleResolution.resolve({map,units:[u,target],initiator:u,target,
    skill:r.applyResourceScaling(u,skills.feral),actions:[]},{
      canUseSkill:(actor,skill)=>r.canUseSkill(actor,skill),
      consumeSkill:(actor,skill)=>r.consumeSkill(actor,skill),
      onDefeated:()=>{},onAction:()=>{}});
  assert.equal(result.results.length,4);
  assert.equal(contacts.length,4);
  assert.equal(actions.length,1,'multi-contact remains one original attack animation');
  assert.deepEqual(contacts.map(x=>x[1]),[40,40,40,40]);
  assert.ok(contacts.every(x=>x[2]==='P'),'do not switch teams in the middle of the four strikes');
  assert.equal(target.hp,340);
  assert.equal(u.team,'N');assert.equal(r.feralityValue(u),0);
  assert.equal(u.controlOverride?.behavior,'PREDATOR');
});

test('local, Gemini and Worker reach the same shared round and neutral authority',()=>{
  const pvpRoot=new URL('../src/',import.meta.url);
  const online=readFileSync(new URL('pvp-headless-tactical.mjs',pvpRoot),'utf8');
  const onlineEngagement=readFileSync(new URL('pvp-headless-engagement.mjs',pvpRoot),'utf8');
  const onlineTurns=readFileSync(new URL('pvp-headless-turns.mjs',pvpRoot),'utf8');
  assert.match(online,/BattleRoundRuleEngine\.onRoundStart\(/);
  assert.match(online,/NeutralActorEngine\.availableActors\(game\.units,game\.round\)/);
  assert.match(onlineEngagement,/engine\.battleResolution\.resolve\(/);
  assert.match(onlineTurns,/controlOverride\?\.type==='BERSERK'/);
  assert.match(src('tactical-game.js'),/BattleRoundRuleEngine\?\.onRoundStart\?/);
  assert.match(src('tactical-game.js'),/NeutralActorEngine/);
});

test('Babylon uses four canonical weapon beats and resource-driven feral pose without new meshes',()=>{
  const visual=src('unit-renderer.js');
  assert.match(visual,/event\?\.skillId==='cat_feral_feast'/);
  assert.match(visual,/Math\.floor\(clamp01\(progress\)\*4\)/);
  assert.match(visual,/unit\.characterId==='cat_thief_hero'\?unit\.resources\?\.ferality/);
  assert.match(visual,/feral\.berserk\?1/);
  assert.doesNotMatch(visual.slice(visual.indexOf("event?.skillId==='cat_feral_feast'"),visual.indexOf("event?.skillId==='cat_feral_feast'")+1400),/new BABYLON\.Mesh|MeshBuilder/);
});

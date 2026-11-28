import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../src/pvp-match-core.mjs';
import '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {createBattleAreaFieldState} from '../../js/battle-area-field-engine.js';
import {officialEngagementForecast} from '../../js/battle-engagement-forecast.js';
import {EquipmentDatabase,attackWeaponFor} from '../../js/equipment-database.js';
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {UnitRenderer} from '../../js/unit-renderer.js';

const map=()=>({id:'blood-regression',width:6,height:6,objects:[],tiles:Array.from({length:36},(_,i)=>({x:i%6,y:Math.floor(i/6),terrain:'PLAIN',elevation:0}))});
function inWorld(fn){const m=map(),state={randomState:5,fieldState:createBattleAreaFieldState(),units:[]};return withCanonicalEngines(state,e=>{
 const spawn=(id,characterId,team,x,y)=>{const u=e.unitRuntime.create({id,characterId,team,x,y,map:m});assert.ok(u,characterId);state.units.push(u);return u;};
 return fn({e,m,state,spawn});
});}

test('reported blessed_slash memory: read, forecast against vampire, and committed copied attack never add fake equipment',()=>inWorld(({e,m,state,spawn})=>{
 const vampire=spawn('v','seraphina','P',2,2),source=spawn('elf','elf_guard','E',2,3),enemy=spawn('ai','imperial_swordsman','E',3,2);
 const raw=SkillDatabase.get('blessed_slash');assert.ok(e.effect.copyableSkills(source,vampire).some(s=>s.id===raw.id));
 const prior=structuredClone(vampire.character.weapons),profiles=EquipmentDatabase.defenseProfiles(vampire.character);
 const grant=e.effect.rememberBloodSkill(vampire,raw.id,source);assert.ok(grant);
 for(let i=0;i<4;i++)e.unitRuntime.changeBlood(vampire,1000);assert.equal(vampire._bloodAwakened,true);
 const copied=e.unitRuntime.skillForUnit(vampire,raw);
 assert.equal(attackWeaponFor(vampire,copied).weaponKind,'SWORD');
 assert.equal(attackWeaponFor(vampire,copied).attackType,'SLASH');
 assert.equal(attackWeaponFor(vampire,copied).weaponDefense,undefined);
 assert.deepEqual(vampire.character.weapons,prior);assert.deepEqual(EquipmentDatabase.defenseProfiles(vampire.character),profiles);
 const aiSkill=SkillDatabase.get(enemy.character.skills[0]);
 assert.ok(officialEngagementForecast({map:m,attacker:enemy,defender:vampire,skill:aiSkill}).defenseMethods.length);
 const f=officialEngagementForecast({map:m,attacker:vampire,defender:enemy,skill:copied});assert.ok(f.normalDamage>0);assert.equal(f.attackType,'SLASH');
 assert.deepEqual(vampire.character.weapons,prior);
 const hp=enemy.hp;const result=e.battleResolution.resolve({map:m,units:state.units,initiator:vampire,target:enemy,skill:{...copied,forceHit:true},actions:[]},{canUseSkill:e.unitRuntime.canUseSkill,consumeSkill:e.unitRuntime.consumeSkill});
 assert.ok(result.results.length);assert.ok(enemy.hp<hp);assert.deepEqual(vampire.character.weapons,prior);
 assert.deepEqual(EquipmentDatabase.defenseProfiles(vampire.character),profiles);
}));

test('all copyable source loadouts preserve real attack delivery and never grant defense or mutate weapons',()=>inWorld(({e,spawn})=>{
 const vampire=spawn('v','seraphina','P',1,1),prior=structuredClone(vampire.character.weapons);
 const cases=Object.values(globalThis.CARDS).filter(c=>c.type==='CHARACTER'&&globalThis.CardDatabase.canPersist(c)&&c.characterId!=='seraphina');let checked=0;
 for(const card of cases){const source=e.unitRuntime.create({id:`source:${card.id}`,team:'E',characterId:card.characterId,loadoutId:card.loadoutId,x:2,y:2,map:map()});if(!source)continue;
   vampire.grantedSkills=[];
   for(const raw of e.effect.copyableSkills(source,vampire)){
     vampire.grantedSkills=[];const grant=e.effect.rememberBloodSkill(vampire,raw.id,source);assert.ok(grant);
     for(const form of [raw,...(raw.variants||[]).map(v=>SkillDatabase.resolveVariant(raw,v.id))].filter(Boolean)){
       const s=e.unitRuntime.skillForUnit(vampire,form),sourceWeapon=source.character.weapons?.[s.weapon],w=attackWeaponFor(vampire,s);
       if(sourceWeapon&&!prior[s.weapon]){assert.equal(w.weaponKind,sourceWeapon.weaponKind||null,`${card.id}:${s.id}`);assert.equal(w.attackType,sourceWeapon.attackType||null);assert.equal(w.weaponDefense,undefined);checked++;}
       assert.deepEqual(vampire.character.weapons,prior);assert.doesNotThrow(()=>EquipmentDatabase.defenseProfiles(vampire.character));
     }
   }
 }assert.ok(checked>30,`only ${checked} projected weapon forms checked`);
}));

test('memory grant survives serializable Worker state after source removal',()=>inWorld(({e,spawn})=>{
 const v=spawn('v','seraphina','P',1,1),s=spawn('archer','elf_ranger','E',2,1),raw=SkillDatabase.get('blessed_slash');
 e.effect.rememberBloodSkill(v,raw.id,s);v.grantedSkills=JSON.parse(JSON.stringify(v.grantedSkills));e.unitRuntime.syncLiveRoster([v]);
 const copied=e.unitRuntime.skillForUnit(v,raw);assert.equal(attackWeaponFor(v,copied).weaponKind,'SWORD');assert.equal(v.character.weapons.blessed_sword,undefined);
}));

test('enemy ring uses viewer relation, reuses mesh and material, never casts shadow or reveals neutral',()=>{
 const old=globalThis.BABYLON;let builds=0;
 class C{constructor(r,g,b){Object.assign(this,{r,g,b})}static Black(){return new C(0,0,0)}}
 const renderer=Object.create(UnitRenderer.prototype);renderer.scene={};renderer.mat=(name,color)=>({name,color});
 globalThis.BABYLON={Color3:C,MeshBuilder:{CreateTorus(name,options){builds++;return{name,options,position:{},scaling:{setAll(n){this.value=n}},setEnabled(v){this.enabled=v}}}}};
 try{
  const entry={facingMarker:{root:{}}},u={id:'x',team:'ENEMY',friendlyToViewer:false};renderer.syncEnemyRing(entry,u);
  const ring=entry.enemyRing;assert.ok(ring.enabled);assert.equal(ring.parent,entry.facingMarker.root);assert.equal(ring.isPickable,false);assert.equal(ring.metadata.castShadow,false);
  renderer.syncEnemyRing(entry,{...u,selected:true});assert.equal(entry.enemyRing,ring);assert.equal(builds,1);assert.ok(ring.scaling.value>1);
  renderer.syncEnemyRing(entry,{...u,friendlyToViewer:true});assert.equal(ring.enabled,false);
  renderer.syncEnemyRing(entry,{...u,team:'PLAYER',friendlyToViewer:false});assert.equal(ring.enabled,true);
  renderer.syncEnemyRing(entry,{...u,team:'NEUTRAL'});assert.equal(ring.enabled,false);
  const second={facingMarker:{root:{}}};renderer.syncEnemyRing(second,{...u,id:'y'});assert.equal(second.enemyRing.material,ring.material);assert.equal(builds,2);
  renderer.syncEnemyRing(second,{...u,id:'y',alive:false});assert.equal(second.enemyRing.enabled,false);
 }finally{globalThis.BABYLON=old;}
});

function aiHarness({failForecast=false,failMove=false}={}){
 const actor=(id,team,x,y)=>({id,team,x,y,alive:true,moved:false,acted:false,waited:false,hp:100,character:{name:id,combat:{hp:100,move:3}}});
 const e1=actor('e1','E',0,0),e2=actor('e2','E',0,1),p=actor('p','P',2,0);
 const world={map:map(),units:[e1,e2,p],stage:{ruleset:'VERSUS'},round:14,phase:'P',matchResult:null,enemyCardState:null};
 const timers=new Map(),logs=[],records=[],moves=[];let serial=0,finished=0;
 const source=fs.readFileSync(new URL('../../js/tactical-enemy-controller.js',import.meta.url),'utf8');
 const browser={EncounterEngine:{TEAM_NEUTRAL:'N'}};
 vm.runInNewContext(source,{window:browser,globalThis:{CardTacticsDiagnostics:{isEnabled:()=>false,push:(type,data)=>records.push({type,data})}},
   TacticalEngine:{actorCanTrackTarget:()=>true,canTarget:()=>true,tile:(m,x,y)=>({x,y,terrain:'PLAIN'}),reachable:()=>new Map([['1,0',1]]),pathTo:(m,u,a,x,y)=>[{x,y}]},
   DeploymentEngine:{points:()=>[]},setTimeout:fn=>{timers.set(++serial,fn);return serial},clearTimeout:id=>timers.delete(id)});
 const ctx={TEAM:{ENEMY:'E',PLAYER:'P'},PHASE:{ENEMY:'E'},state:()=>world,map:()=>world.map,actionState:()=>world,geminiEnabled:()=>false,
   aiExecuteSkill:()=>false,aiForecast:()=>{throw new Error('INVALID_WEAPON_DEFENSE_BASELINE:fixture')},
   combatTargets:a=>a===e1?[p]:[],skillList:a=>a===e1&&failForecast?[{id:'slash',name:'slash',target:'ENEMY',weapon:'sword',power:1}]:[],
   targetType:()=> 'SINGLE',canUseSkill:()=>true,canUnitCapture:()=>false,turnActors:t=>world.units.filter(u=>u.team===t),living:t=>world.units.filter(u=>u.team===t),
   resetActions(){},setPhase:v=>world.phase=v,clearSelection(){},clearEnemyReaction(){},pushLog:v=>logs.push(v),setEnemyView(){},render(){},emitState(){},checkMatchEnd:()=>false,pendingEnemyAttack:()=>null,coreForOwner:()=>null,
   beginPlayerTurn(){finished++;world.phase='P';},traverseUnitPath(a,[t]){moves.push(a.id);if(failMove&&a===e1)throw new Error('fixture step exception');a.x=t.x;a.y=t.y;return{completed:true};}};
 const controller=browser.TacticalEnemyController.create(ctx);
 return {e1,e2,world,logs,records,moves,async run(){controller.runPhase();for(let i=0;i<80&&timers.size;i++){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();for(let j=0;j<8;j++)await Promise.resolve();}return{finished,pending:timers.size};}};
}
test('a rejected read-only forecast never attacks with an invented score, and next actor and round proceed',async()=>{
 const h=aiHarness({failForecast:true}),r=await h.run();assert.equal(r.finished,1);assert.equal(r.pending,0);assert.equal(h.world.phase,'P');assert.ok(h.moves.includes('e2'));assert.ok(h.records.some(e=>e.type==='ENEMY_FORECAST_REJECTED'&&e.data.unitId==='e1'));
});
test('a throwing tactical step retires only that actor, reports the error, and never repeats the committed chain',async()=>{
 const h=aiHarness({failMove:true}),r=await h.run();assert.equal(r.finished,1);assert.equal(r.pending,0);assert.equal(h.e1.acted,true);assert.equal(h.moves.filter(id=>id==='e1').length,1);assert.ok(h.moves.includes('e2'));assert.ok(h.records.some(e=>e.type==='ENEMY_STEP_FAILED'&&e.data.unitId==='e1'));
});

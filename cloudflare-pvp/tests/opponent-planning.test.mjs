import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../src/pvp-canonical-setup.mjs';
import {MapObjectRenderer} from '../../js/map-object-renderer.js';
const {DeckEngine,CardDatabase,LoadoutDatabase,SkillDatabase,TacticalEngine}=globalThis;
const source=fs.readFileSync(new URL('../../js/tactical-enemy-controller.js',import.meta.url),'utf8');
test('official pool yields valid mixed-faction 20-card decks with affordable opening cards',()=>{
 for(let i=0;i<4;i++){
  let seed=i+1;const random=()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/2**32;
  const deck=DeckEngine.buildOpponentDeck({random,startingCrystals:4});
  assert.ok(DeckEngine.validate(deck).valid);
  assert.ok(new Set(deck.map(id=>CardDatabase.get(id).faction)).size>1);
  assert.ok(deck.filter(id=>CardDatabase.isCharacter(CardDatabase.get(id))&&CardDatabase.get(id).cost<=4).length>=10);
 }
});
test('compact Gemini profiles retain all legal card and actual skill IDs without player descriptions',()=>{
 const pool=DeckEngine.opponentCardPool(),profiles=pool.map(c=>DeckEngine.opponentCardProfile(c));
 assert.deepEqual(profiles.map(p=>p.id),pool.map(c=>c.id));
 for(const c of pool.filter(CardDatabase.isCharacter)){
  const char=LoadoutDatabase.resolveCharacter(c.characterId,c.loadoutId||null),p=profiles.find(p=>p.id===c.id);
  assert.deepEqual(p.skills.map(s=>s.id),(char.skillIds||char.skills||[]).filter(id=>SkillDatabase.get(id)));
  assert.ok(p.skills.every(s=>!('description' in s)&&!('mechanic' in s)));
 }
 const bytes=Buffer.byteLength(JSON.stringify(profiles));console.log('POOL',pool.length,'PROFILE_BYTES',bytes);
 assert.ok(bytes<46*1024);
});
test('obstacle detour picks a legal current-turn prefix without changing facing',()=>{
 const map={width:5,height:5,tiles:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),terrain:i%5===2&&Math.floor(i/5)<4?'WALL':'PLAIN',elevation:0})),objects:[]};
 const unit={id:'a',team:'E',alive:true,x:1,y:1,facing:'E',character:{combat:{move:2},terrainTraits:[],passives:[]},effects:[]};
 const legal=TacticalEngine.reachable(map,[unit],unit),dest=TacticalEngine.strategicDestination(map,[unit],unit,[{x:4,y:1}],legal,{goalRadius:1});
 assert.ok(dest);assert.ok(legal.has(`${dest.x},${dest.y}`));assert.ok(dest.y>unit.y);assert.equal(unit.facing,'E');
});
function harness({heal=false,gemini=false}={}){
 let serial=0,finished=0,plans=0,decisions=0;const timers=new Map(),moves=[],casts=[];
 const mk=(id,team,x,y,hp=100)=>({id,team,x,y,hp,mana:100,maxMana:100,alive:true,character:{name:id,archetype:'UNIT',combat:{hp:100,move:2}},effects:[]});
 const actor=mk('e1','E',4,2),ally=mk('e2','E',5,2,heal?20:100),foe=mk('p','P',5,3),core={x:0,y:2,hp:600};
 const world={map:{width:8,height:6,tiles:[]},units:heal?[actor,ally,foe]:[actor,foe],stage:{ruleset:'CORE_CAPTURE'},phase:'P',round:4,enemyCardState:null,environmentState:{}};
 const skill={id:'heal',name:'Heal',category:'MAGIC',target:'ALLY',targetType:'SINGLE',range:{min:1,max:3},effects:[{type:'HEAL',amount:50}]};
 const tactical={tile:(_m,x,y)=>({x,y,terrain:'PLAIN'}),reachable:(_m,_u,a)=>new Map([[`${a.x},${a.y}`,0],[`${a.x-1},${a.y}`,1]]),pathTo:(_m,_u,a,x,y)=>a.x===x&&a.y===y?[]:[{x,y}],actorCanTrackTarget:()=>true,canTarget:(_m,a,t,s)=>s.target==='ALLY'&&a!==t&&a.team===t.team};
 const browser={EncounterEngine:{TEAM_NEUTRAL:'N'}};
 vm.runInNewContext(source,{window:browser,globalThis:{CardTacticsDiagnostics:{isEnabled:()=>false}},TacticalEngine:tactical,DeploymentEngine:{points:()=>[{id:'MID',owner:'ENEMY',captureTiles:[{x:4,y:2}]}]},performance:{now:()=>0},setTimeout:f=>{timers.set(++serial,f);return serial;},clearTimeout:id=>timers.delete(id)});
 const ctx={TEAM:{ENEMY:'E',PLAYER:'P'},PHASE:{ENEMY:'E'},state:()=>world,map:()=>world.map,actionState:()=>({environmentState:world.environmentState}),coreForOwner:o=>o==='PLAYER'?core:null,
 geminiEnabled:()=>gemini,geminiPlan:async()=>{plans++;return null;},geminiDecide:async()=>{decisions++;return null;},skillList:a=>heal&&a===actor?[skill]:[],combatTargets:()=>[],canUseSkill:()=>true,targetType:s=>s.targetType,aiExecuteSkill:a=>{casts.push(a.skill.id);a.target.hp+=50;a.attacker.acted=true;return true;},
 canUnitCapture:()=>false,turnActors:t=>world.units.filter(u=>u.team===t),living:t=>world.units.filter(u=>u.team===t),resetActions:()=>{},setPhase:p=>world.phase=p,clearSelection:()=>{},clearEnemyReaction:()=>{},pushLog:()=>{},setEnemyView:()=>{},render:()=>{},emitState:()=>{},checkMatchEnd:()=>false,pendingEnemyAttack:()=>null,beginPlayerTurn:()=>{finished++;world.phase='P';},traverseUnitPath:(a,[t])=>{moves.push(a.id);a.x=t.x;a.y=t.y;return{completed:true};}};
 const controller=browser.TacticalEnemyController.create(ctx);
 return{actor,ally,core,moves,casts,run:async()=>{controller.runPhase();for(let i=0;i<12;i++)await Promise.resolve();for(let i=0;i<100&&timers.size;i++){const [id,f]=timers.entries().next().value;timers.delete(id);f();for(let n=0;n<12;n++)await Promise.resolve();}return{finished,plans,decisions};}};
}
test('held midpoint does not keep the last assault unit from approaching Core',async()=>{const h=harness();const r=await h.run();assert.equal(r.finished,1);assert.ok(h.actor.x<4);assert.ok(h.moves.includes('e1'));});
test('autonomous AI chooses a legal ally heal and completes the turn',async()=>{const h=harness({heal:true});const r=await h.run();assert.equal(r.finished,1);assert.deepEqual(h.casts,['heal']);assert.equal(h.ally.hp,70);});
test('failed Gemini team plan falls back locally without per-unit requests',async()=>{const h=harness({gemini:true});const r=await h.run();assert.equal(r.finished,1);assert.equal(r.plans,1);assert.equal(r.decisions,0);assert.ok(h.actor.x<4);});
test('wind upload uses geometry direct API with unchanged bounds',()=>{
 globalThis.BABYLON={VertexBuffer:{PositionKind:'position'}};
 let direct=0,fallback=0;const batch={mesh:{geometry:{updateVerticesDataDirectly:()=>direct++},getVertexBuffer:()=>({isUpdatable:()=>true}),updateVerticesData:()=>fallback++},positions:new Float32Array(3),windBoundsStrength:1};
 const mesh={metadata:{leafSway:{weights:[1],rest:[0,0,0],positions:[0,0,0],phase:0}},visibility:1};
 const member={offset:0,worldMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
 const renderer={vegetationTime:0,vegetationFrameTime:0,vegetationWind:{strength:1,x:1,y:0},vegetationSways:[mesh],batchedSwayMembers:new Map([[mesh,{batch,member}]]),windBatchMetrics:{directPositionUploads:0,fallbackPositionUploads:0,positionUploads:0,deferredSourceVertexWrites:0},ensureWindBatchBounds:()=>{}};
 MapObjectRenderer.prototype.updateVegetationWind.call(renderer,.04);assert.equal(direct,1);assert.equal(fallback,0);
 batch.windBoundsDirty=true;MapObjectRenderer.prototype.updateVegetationWind.call(renderer,.04);assert.equal(fallback,1);
});

test('autonomous effect commit uses real bishop healing, mana cost and action flags',async()=>{
 await import('../../js/tactical-action-controller.js');
 const map={width:3,height:2,tiles:Array.from({length:6},(_,i)=>({x:i%3,y:Math.floor(i/3),terrain:'PLAIN',elevation:0})),objects:[]};
 const runtime=globalThis.UnitRuntimeEngine;
 const a=runtime.create({id:'test-bishop',team:'E',characterId:'church_bishop',loadoutId:'church_bishop_default',x:0,y:0,map});
 const b=runtime.create({id:'test-ally',team:'E',characterId:'imperial_swordsman',loadoutId:'imperial_swordsman_default',x:1,y:0,map});
 const skill=SkillDatabase.get('church_bishop_heal');b.hp=1;const before=a.mana;
 const world={map,units:[a,b],environmentState:null};
 const ctrl=globalThis.TacticalActionController.create({actionState:()=>world,canUseSkill:runtime.canUseSkill,consumeSkill:(u,s)=>runtime.consumeSkill(u,s,world),effectiveSkill:(u,s)=>s,random:()=>.99,setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},checkMatchEnd:()=>false,render:()=>{},pushLog:()=>{}});
 assert.equal(ctrl.executeAutonomousSkill({attacker:a,target:b,skill}),true);assert.ok(b.hp>1);assert.equal(a.mana,before-skill.manaCost);assert.ok(a.acted&&a.moved&&a.waited);assert.equal(ctrl.executeAutonomousSkill({attacker:a,target:b,skill}),false);
});

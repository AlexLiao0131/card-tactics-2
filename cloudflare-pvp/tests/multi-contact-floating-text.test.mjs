import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const read=name=>readFileSync(fileURLToPath(new URL('../../js/'+name,import.meta.url)),'utf8');

// Invoke the real BattleResolution once. Each contact is a real separate
// physical HP loss, while its animation and skill cost stay a single action.
function resolveCombo({id,actorId='cat',hits=2,enemyHp=500,missAt=-1,danceSequence=false}={}){
  const events=[],spent=[],results=[];let seq=0,contact=0;
  const skill={id,name:id,weapon:'daggers',power:1,range:{min:1,max:3},target:'ENEMY',
    attackType:'SLASH',hitCount:hits,...(danceSequence?{danceSequence:true}:{})};
  const actor={id:'actor',team:'P',x:1,y:2,z:0,alive:true,hp:400,
    character:{id:actorId,name:actorId,weapons:{daggers:{weaponKind:'DAGGER',attackType:'SLASH'}},
      passives:[],combat:{hp:400,atk:70,def:20,mdef:20}}};
  const target={id:'enemy',team:'E',x:actorId==='livia'?3:2,y:2,z:0,alive:true,hp:enemyHp,
    character:{id:'enemy',name:'Enemy',weapons:{},passives:[],combat:{hp:enemyHp,atk:20,def:10,mdef:10}}};
  const map={tiles:Array.from({length:36},(_,i)=>({x:i%6,y:Math.floor(i/6),terrain:'PLAIN',elevation:0}))};
  const tactical={ensureFacing:u=>u.facing||'N',faceToward:()=>{},tile:(m,x,y)=>m.tiles.find(t=>t.x===x&&t.y===y)||null,
    canTarget:(m,a,t,s)=>a.alive&&t.alive&&a.team!==t.team&&Math.abs(a.x-t.x)+Math.abs(a.y-t.y)>=s.range.min&&Math.abs(a.x-t.x)+Math.abs(a.y-t.y)<=s.range.max,
    canOccupyTerrain:()=>true,isBlockedByObject:()=>false,attackDelivery:()=>"MELEE",
    relativeArc:(target,tile)=>tile.x>target.x?'BACK':tile.y!==target.y?'SIDE':'FRONT',
    pathTo:(m,units,unit,x,y)=>[{x,y,z:0}],canActiveMove:()=>true,
    resolve:()=>{const hit=contact++!==missAt;return{result:{hit,damage:hit?25:0,crit:false,
      physicalCrit:false,magicCrit:false,graze:false,type:'SLASH',el:'NONE',hc:100,cc:0,accuracy:0,evasion:0},
      terrain:{acc:0,eva:0}}}};
  const animation={
    emitAction:(unit,def,sk,detail)=>{const e={type:'UNIT_ANIMATION',sequence:++seq,unitId:unit.id,
      targetId:def.id,skillId:sk.id,state:'ATTACK',...detail};events.push(e);return e},
    emitResolvedHit:(unit,{damage,skillId})=>{
      if(!damage)return[];
      const e={type:'UNIT_FLOAT_TEXT',sequence:++seq,unitId:unit.id,skillId,
        kind:'PHYSICAL_DAMAGE',value:damage,x:unit.x,y:unit.y,renderZ:0};events.push(e);return[e];
    },
    emitOutcome:(unit,kind)=>{const e={type:'UNIT_FLOAT_TEXT',sequence:++seq,unitId:unit.id,kind,
      value:kind};events.push(e);return e},
    emitHit:()=>{},emitMove:()=>{},emitPresentation:()=>{}
  };
  const sandbox={SkillDatabase:{get:()=>skill,passiveList:()=>[]},EquipmentDatabase:{defenseProfiles:()=>[]},
    BattleEngine:{actionSpeed:()=>0},TacticalEngine:tactical,
    ColinShieldMobilityEngine:{shieldOccupied:()=>false},WeaponMaterialEngine:{},
    chooseAutonomousBattleReaction:()=>null,CombatContactRules:{isPureMagic:()=>false,canGanfanDefend:()=>false},
    UnitRuntimeEngine:{applyResourceScaling:(u,s)=>s,rollSanityMisfire:()=>false,beginBloodTransaction:()=>{},
      endBloodTransaction:()=>{},criticalManaRefund:()=>0,attackEnhancement:()=>1},
    EffectEngine:{consumeWeaponEnchantment:()=>null,interruptChannel:()=>{},breakStealth:()=>{},
      applyDamage:(u,d)=>{const loss=Math.min(u.hp,Math.max(0,d));u.hp-=loss;return{hpLoss:loss,absorbed:0}},
      markVengeance:()=>{},consumeVengeance:()=>{}},
    PostEngagementEngine:{process:({queue})=>({queue,results:[]})},
    UnitAnimationEngine:animation};
  sandbox.globalThis=sandbox;
  const code=read('battle-resolution.js').replace(/^import .+;$/gm,'').replace(/^export (function|const) /gm,'$1 ');
  vm.runInNewContext(code,sandbox,{filename:'battle-resolution.js'});
  sandbox.createBattleResolution({random:()=>0}).resolve({map,units:[actor,target],initiator:actor,
    target,skill,actions:[]},{canUseSkill:()=>true,consumeSkill:(_,s)=>{spent.push(s.id);return{cost:0,resources:{}}},
      onAction:e=>results.push(e),onDefeated:()=>{},onBackstep:()=>{}});
  return{events,spent,results,target};
}
for(const [id,hits,actorId] of [['cat_dual_slash',2,'cat'],['ophi_triple_shot',3,'ophi'],['nether_slash',4,'livia']]){
  test(`${id}: ${hits} independent hit floats reference one official action and consume resources once`,()=>{
    const r=resolveCombo({id,hits,actorId});
    assert.equal(r.results.length,hits);
    assert.deepEqual(r.spent,[id]);
    const actions=r.events.filter(e=>e.type==='UNIT_ANIMATION');
    const floats=r.events.filter(e=>e.type==='UNIT_FLOAT_TEXT');
    assert.equal(actions.length,1,'must not duplicate Babylon effects');
    assert.equal(floats.length,hits);
    assert.equal(r.target.hp,500-25*hits);
    assert.deepEqual(floats.map(e=>e.contactIndex),Array.from({length:hits},(_,i)=>i));
    assert.ok(floats.every(e=>e.actionSequence===actions[0].sequence&&e.contactCount===hits));
  });
}
test('safiya sword dance: independent followups point to three distinct action receipts',()=>{
  const r=resolveCombo({id:'safiya_sword_dance',actorId:'safiya',hits:1,danceSequence:true});
  const attacks=r.events.filter(e=>e.type==='UNIT_ANIMATION');
  const floats=r.events.filter(e=>e.type==='UNIT_FLOAT_TEXT');
  assert.equal(r.results.length,3);
  assert.equal(attacks.length,3);
  assert.equal(floats.length,3);
  assert.deepEqual(r.spent,['safiya_sword_dance']);
  assert.deepEqual(floats.map(e=>e.actionSequence),attacks.map(e=>e.sequence));
  assert.deepEqual(floats.map(e=>e.contactIndex),[0,0,0]);
});
test('MISS remains attached to the second contact, no fake damage float',()=>{
  const r=resolveCombo({id:'cat_dual_slash',hits:2,missAt:1});
  assert.equal(r.target.hp,475);
  const floats=r.events.filter(e=>e.type==='UNIT_FLOAT_TEXT');
  assert.deepEqual(floats.map(e=>e.value),[25,'MISS']);
  assert.deepEqual(floats.map(e=>e.contactIndex),[0,1]);
});
test('killing blow stops the sequence; no phantom final contacts',()=>{
  const r=resolveCombo({id:'nether_slash',hits:4,actorId:'livia',enemyHp:30});
  assert.equal(r.results.length,2);
  assert.equal(r.events.filter(e=>e.type==='UNIT_FLOAT_TEXT').length,2);
  assert.equal(r.target.hp,0);
});

// HUD playback fixture: use exactly one real UNIT_ANIMATION for a multi-hit
// ability, not the synthetic three-action assumption in the old dance test.
function hudFixture(){
  let now=1000;
  const visual={units:{activeAnimations:new Map(),animationQueues:new Map(),entries:new Map()},
    visualPending(action){const check=e=>e?.sequence===action.sequence&&String(e.unitId)===String(action.unitId);
      return [...this.units.activeAnimations.values()].some(x=>check(x.event))||
      [...this.units.animationQueues.values()].some(q=>q.some(check));}};
  const node=tag=>({tag,hidden:false,style:{},children:[],isConnected:true,
    appendChild(ch){this.children.push(ch);ch.isConnected=true;return ch},
    remove(){this.removed=true},setAttribute(){},getBoundingClientRect(){return{left:0,top:0,width:1000,height:700}}});
  const document={getElementById:id=>id==='battleScreen'?node('div'):null,createElement:node};
  const BABYLON={Vector3:class{constructor(x,y,z){Object.assign(this,{x,y,z})}static Project(v){return{x:v.x+100,y:v.y+100,z:.5}}},Matrix:{Identity(){return {}}}};
  const code=read('unit-hud-overlay.js').replace(/^import .*;\s*$/gm,'').replace('export class UnitHudOverlay','class UnitHudOverlay')+'\n;globalThis.__hud=UnitHudOverlay;';
  const context={BABYLON,performance:{now:()=>now},document,TILE_SIZE:1,ELEVATION_HEIGHT:1,UNIT_VISUAL_HEIGHT:2,
    visualManagerFor:()=>visual};context.globalThis=context;
  vm.runInNewContext(code,context,{filename:'unit-hud-overlay.js'});
  const hud=new context.__hud({getTransformMatrix:()=>({})},
    {getRenderWidth:()=>1000,getRenderHeight:()=>700},
    {getBoundingClientRect:()=>({left:0,top:0,width:1000,height:700})},{viewport:{toGlobal:()=>({})}});
  hud.units=[{id:'enemy',x:2,y:2}];
  return {hud,visual,advance:ms=>{now+=ms}};
}
for(const hits of [2,3,4])test(`${hits}-contact animation reveals each damage float in order`,()=>{
  const {hud,visual,advance}=hudFixture();
  const action={type:'UNIT_ANIMATION',sequence:10,unitId:'actor',targetId:'enemy',skillId:'combo',state:'ATTACK'};
  const floats=Array.from({length:hits},(_,i)=>({type:'UNIT_FLOAT_TEXT',sequence:11+i,unitId:'enemy',
    skillId:'combo',kind:'PHYSICAL_DAMAGE',value:11+i,actionSequence:10,contactIndex:i,contactCount:hits,
    x:2,y:2,renderZ:0}));
  visual.units.animationQueues.set('actor',[action]);
  hud.presentEvents([action,...floats]);
  assert.ok(hud.floats.every(x=>x.node.hidden));
  visual.units.animationQueues.clear();
  visual.units.activeAnimations.set('actor',{event:action,startedAt:1000,duration:400});
  hud.updateFrame();
  assert.ok(hud.floats.every(x=>x.node.hidden),'first beat must not appear before its contact');
  for(let i=0;i<hits;i++){
    advance(i===0?400/(hits*2)+1:400/hits);
    hud.updateFrame();
    for(let j=0;j<hits;j++)assert.equal(hud.floats[j].node.hidden,j>i,
      `contact ${j+1} must ${j>i?'remain hidden':'be visible'} when index ${i} is playing`);
  }
  const starts=hud.floats.map(x=>x.start);
  assert.equal(new Set(starts).size,hits);
  assert.deepEqual(Array.from(hud.floats,x=>x.node.textContent),Array.from({length:hits},(_,i)=>`-${11+i}`));
  advance(2000);hud.updateFrame();assert.equal(hud.floats.length,0);
});
test('same skill on distinct actions binds each result to its exact source action',()=>{
  const {hud,visual}=hudFixture();
  const a=[10,12,14].map((sequence,i)=>({type:'UNIT_ANIMATION',sequence,unitId:'actor',targetId:'enemy',state:'ATTACK',skillId:'safiya_sword_dance',danceStep:i+1}));
  const results=a.map((action,i)=>({type:'UNIT_FLOAT_TEXT',sequence:action.sequence+1,unitId:'enemy',
    skillId:'safiya_sword_dance',kind:'PHYSICAL_DAMAGE',value:15+i,actionSequence:action.sequence,
    contactIndex:0,contactCount:1,x:2,y:2}));
  hud.presentEvents([...a,...results]);
  for(let i=0;i<3;i++)assert.equal(hud.floats[i].pendingAction.sequence,a[i].sequence);
  visual.units.animationQueues.set('actor',a.slice());
  visual.units.activeAnimations.set('actor',{event:a[0],startedAt:1000,duration:320});
  hud.updateFrame();assert.equal(hud.floats[0].node.hidden,false);
  assert.equal(hud.floats[1].node.hidden,true);
});

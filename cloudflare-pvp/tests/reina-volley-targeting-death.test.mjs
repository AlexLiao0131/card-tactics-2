import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=name=>readFileSync(new URL('../../js/'+name,import.meta.url),'utf8');

function pickerFixture(){
  class Vec {constructor(){this.x=0;this.y=0;this.z=0}set(x,y,z){Object.assign(this,{x,y,z})}}
  const meshes=[];
  const BABYLON={MeshBuilder:{CreateBox:(name,options)=>{
    const mesh={name,options,position:new Vec(),scaling:new Vec(),disposed:false,
      dispose(){this.disposed=true}};
    meshes.push(mesh);return mesh;
  }}};
  const context={BABYLON,TILE_SIZE:2,ELEVATION_HEIGHT:1,Math,Number,String,Map,Set};
  const code=src('grid-picker.js').replace(/^import .+;\s*$/gm,'').replace('export class GridPicker','class GridPicker')+'\n;globalThis.__Picker=GridPicker';
  context.globalThis=context;vm.runInNewContext(code,context);
  const picker=new context.__Picker({pointerX:50,pointerY:20,pick(x,y,predicate){
    const front=meshes.find(m=>!m.disposed&&m.metadata?.kind==='unit-hit'&&predicate(m));
    const back=meshes.find(m=>!m.disposed&&m.metadata?.kind==='tile-hit'&&m.metadata.x===4&&predicate(m));
    return {hit:!!(front||back),pickedMesh:front||back};
  }},{});
  return {picker,meshes};
}

test('3D character is selectable above the ground even if the ray hits a different ground tile',()=>{
  const {picker}=pickerFixture();
  const map={tiles:[{x:3,y:1,elevation:0},{x:4,y:1,elevation:0}]};
  picker.sync({map,units:[{id:'enemy',x:3,y:1,renderZ:0,footprint:{width:1,height:1}}]});
  assert.deepEqual(JSON.parse(JSON.stringify(picker.pickCurrent())),{x:3,y:1});
  const hit=picker.unitHits.get('enemy');
  assert.equal(hit.isPickable,true);
  assert.equal(hit.metadata.kind,'unit-hit');
  assert.ok(hit.position.y>0);
  picker.sync({map,units:[]});
  assert.equal(hit.disposed,true,'removed/dead or viewer-hidden unit cannot be selected');
  assert.equal(picker.unitHits.size,0);
});

test('PvP visibility never creates a pick proxy for a hidden enemy',()=>{
  const {picker}=pickerFixture();const map={tiles:[{x:4,y:1,elevation:0}]};
  picker.sync({map,units:[{id:'visible-player',x:4,y:1}]});
  assert.equal(picker.unitHits.has('hidden-opponent'),false);
  assert.equal(picker.unitHits.size,1);
});

function canonicalFixture({hp=5,autoDead=false}={}){
  const commander={id:'reina',team:'P',x:1,y:1,z:0,alive:true,moved:false,acted:false,waited:false,
    character:{id:'reina',name:'蕾娜',passives:['RANGER_COMMANDER'],combat:{atk:60},weapons:{bow:{weaponKind:'BOW',element:'NONE'}}}};
  const target={id:'enemy',team:'E',x:3,y:1,hp,alive:true,character:{id:'enemy',name:'對手',combat:{hp}}};
  const map={tiles:Array.from({length:36},(_,i)=>({x:i%6,y:Math.floor(i/6),terrain:'PLAIN'}))};
  const units=[commander,target],skill={id:'reina_command_shot',name:'集團齊射',category:'SPECIAL',target:'TILE',targetType:'AOE',
    rangerVolley:true,radius:2,range:{min:2,max:5},weapon:'bow',attackType:'SHOT',power:1.1};
  const history={consume:0,death:0,rolls:0,mode:'map-target',renders:0,actions:[]};let selectedSkill=skill;
  const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},
    actionState:()=>({map,units,environmentState:{},selected:commander,selectedSkill}),
    canUseSkill:()=>true,consumeSkill:()=>{history.consume++;return true},effectiveSkill:(_,s)=>s,
    aoeTiles:(c,r)=>map.tiles.filter(t=>Math.abs(t.x-c.x)+Math.abs(t.y-c.y)<=r),
    unitAt:(x,y)=>units.find(u=>u.alive&&u.x===x&&u.y===y)||null,
    setSelectedSkill:x=>{selectedSkill=x},setSelectedSkillVariant:()=>{},setMode:v=>history.mode=v,
    checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,render:()=>history.renders++,
    pushLog:()=>{},random:()=>.6,
    handleDefeated:(victim)=>{history.death++;victim.alive=false;history.actions.push('DEATH');}};
  const box={globalThis:null,SkillDatabase:{passiveList:()=>[{commandRadius:3}]},
    TacticalEngine:{range:s=>s.range,teamCanSee:()=>true,canSee:()=>true,faceToward:()=>{},
      resolve:()=>{history.rolls++;return{result:{hit:true,damage:10}}}},
    EffectEngine:{breakStealth:()=>{},interruptChannel:()=>{},consumeWeaponEnchantment:()=>null,
      applyDamage:(u,n)=>{const loss=Math.min(u.hp,n);u.hp-=loss;if(autoDead&&u.hp===0)u.alive=false;return{hpLoss:loss}}},
    BattleResolution:{previewInherentBonus:()=>0},UnitRuntimeEngine:{},
    AngelWingBarrierEngine:{TYPE:'HOLY_WING_BARRIER'},
    UnitAnimationEngine:{emitAction:()=>history.actions.push('ACTION'),emitResolvedHit:()=>history.actions.push('DAMAGE')},
    TERRAINS:{PLAIN:{passable:true}}};box.globalThis=box;
  vm.runInNewContext(src('tactical-action-controller.js').replace(/^import .+;\s*$/gm,''),box,{filename:'tactical-action-controller.js'});
  const controller=box.TacticalActionController.create(ctx);
  return {commander,target,skill,controller,history,map,units};
}

test('shared controller finalizes ordinary lethal volley exactly once',()=>{
  const t=canonicalFixture();const center=t.map.tiles.find(x=>x.x===3&&x.y===1);
  assert.equal(t.controller.executeMapSkill(t.commander,center,t.skill),true);
  assert.equal(t.target.hp,0);assert.equal(t.target.alive,false);
  assert.equal(t.history.death,1);assert.equal(t.history.rolls,1);assert.equal(t.history.consume,1);
  assert.equal(t.controller.executeMapSkill(t.commander,center,t.skill),false,'stale second click cannot spend MP');
  assert.equal(t.history.death,1);assert.equal(t.history.consume,1);
});

test('shared controller finalizes lethal volley even if damage hook already marks alive=false',()=>{
  const t=canonicalFixture({autoDead:true}),center=t.map.tiles.find(x=>x.x===3&&x.y===1);
  assert.equal(t.controller.executeMapSkill(t.commander,center,t.skill),true);
  assert.equal(t.history.death,1,'death lifecycle hook is not skipped by preemptive alive=false');
  assert.equal(t.target.hp,0);
});

test('canonical cancel leaves resources, target HP, and state untouched',()=>{
  const t=canonicalFixture({hp:100});
  assert.equal(t.controller.backFromTargeting(),true);
  assert.equal(t.history.mode,'special-menu');
  assert.equal(t.history.consume,0);assert.equal(t.history.rolls,0);assert.equal(t.target.hp,100);
});

function runActualVolleyMenu(aim,{legal=true,usable=true}={}){
  const source=src('tactical-game.js');
  const start=source.indexOf('      if(mode==="map-target"&&selectedSkill.rangerVolley===true){');
  const end=source.indexOf('      if(mode==="map-target"&&selectedSkill.fanShot){',start);
  assert.ok(start>0&&end>start,'canonical UI must expose separated selection / confirmation');
  const actions=[],calls={cast:0,back:0,renders:0};
  const ctx={mode:'map-target',selectedSkill:{id:'reina_command_shot',rangerVolley:true},
    selected:{id:'reina',acted:false,waited:false},pendingVolleyAim:aim,Math,Number,
    canUseSkill:()=>usable,mapTargetTiles:()=>legal?[{x:3,y:1}]:[],
    render:()=>calls.renders++,executeMapSkill:()=>calls.cast++,backFromTargeting:()=>calls.back++,
    addActionButton:(label,onClick,disabled=false)=>actions.push({label,onClick,disabled})};
  vm.runInNewContext('function run(){\n'+source.slice(start,end)+'\n};run()',ctx);
  return {actions,calls,getAim:()=>ctx.pendingVolleyAim};
}

test('pressing Cancel never casts or consumes after choosing an aim',()=>{
  const u=runActualVolleyMenu({x:3,y:1});
  const cancel=u.actions.find(x=>x.label==='取消施放');assert.ok(cancel);
  cancel.onClick();assert.equal(u.calls.cast,0);assert.equal(u.calls.back,1);assert.equal(u.getAim(),null);
});

test('a map tap only selects; confirmation commits once and clears aim',()=>{
  const u=runActualVolleyMenu({x:3,y:1});assert.equal(u.calls.cast,0);
  const confirm=u.actions.find(x=>x.label.startsWith('確認集團齊射'));assert.ok(confirm);
  confirm.onClick();assert.equal(u.calls.cast,1);assert.equal(u.getAim(),null);
});

test('invalid / unavailable targets fail without spending resources',()=>{
  for(const options of [{legal:false},{usable:false}]){
    const u=runActualVolleyMenu({x:3,y:1},options);
    u.actions.find(x=>x.label.startsWith('確認集團齊射')).onClick();
    assert.equal(u.calls.cast,0);assert.equal(u.getAim(),null);
  }
});

test('map-target click assigns selected volley center but never directly casts',()=>{
  const s=src('tactical-game.js');
  assert.match(s,/else if\(selectedSkill\.rangerVolley===true\)\{pendingVolleyAim=tile;render\(\);\}/);
  assert.doesNotMatch(s,/if\(selectedSkill\.rangerVolley===true\)executeMapSkill\(/);
});


test('two visible targets and two contributing bow users resolve once per target, with one commander cost',()=>{
  const t=canonicalFixture({hp:100});
  const archer={id:'ally-bow',team:'P',x:1,y:2,alive:true,acted:false,moved:false,waited:false,
    character:{name:'友軍弓手',passives:[],combat:{atk:20},weapons:{bow:{weaponKind:'BOW',element:'NONE'}}}};
  const other={id:'enemy2',team:'E',x:3,y:2,hp:100,alive:true,character:{id:'enemy2',name:'敵二',combat:{hp:100}}};
  t.units.push(archer,other);
  const center=t.map.tiles.find(v=>v.x===3&&v.y===1);
  assert.equal(t.controller.executeMapSkill(t.commander,center,t.skill),true);
  assert.equal(t.history.rolls,2);
  assert.equal(t.history.consume,1);
  assert.equal(t.target.hp,90);assert.equal(other.hp,90);
  assert.deepEqual([archer.moved,archer.acted,archer.waited],[true,true,true]);
  assert.deepEqual([t.commander.moved,t.commander.acted,t.commander.waited],[true,true,true]);
});

test('only visible, living units get a collider; all others vanish on next sync',()=>{
  const {picker}=pickerFixture();const map={tiles:[{x:1,y:1,elevation:0}]};
  picker.sync({map,units:[{id:'visible',x:1,y:1},{id:'dead',x:1,y:1,alive:false}]});
  assert.equal(picker.unitHits.has('visible'),true);
  assert.equal(picker.unitHits.has('dead'),false);
  picker.sync({map,units:[]});assert.equal(picker.unitHits.size,0);
});

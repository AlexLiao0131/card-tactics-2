import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../js/tactical-action-controller.js',import.meta.url),'utf8');
// Exercise the original canonical controller, not an alternative game engine.
const authored=source.replace(/^import \{AreaSpellMechanics\} from "\.\/area-spell-mechanics\.js";\r?\n/,'');
const commander={id:'reina',team:'P',x:1,y:1,z:0,alive:true,moved:true,acted:false,waited:false,
 character:{id:'reina',name:'蕾娜',passives:['RANGER_COMMANDER'],combat:{atk:60},weapons:{bow:{weaponKind:'BOW',element:'NONE'}}}};
const ally={id:'archer',team:'P',x:1,y:2,z:0,alive:true,moved:false,acted:false,waited:false,
 character:{id:'ranger',name:'友軍弓兵',combat:{atk:35},weapons:{bow:{weaponKind:'BOW',element:'NONE'}}}};
const enemies=[{id:'enemy1',team:'E',x:3,y:1,hp:100,alive:true,character:{name:'敵軍甲'}},
 {id:'enemy2',team:'E',x:3,y:2,hp:100,alive:true,character:{name:'敵軍乙'}}];
const skill={id:'reina_command_shot',name:'集團齊射',category:'SPECIAL',target:'TILE',targetType:'AOE',
 rangerVolley:true,radius:2,range:{min:2,max:5},weapon:'bow',attackType:'SHOT',power:1.1};
const map={tiles:Array.from({length:64},(_,index)=>({x:index%8,y:Math.floor(index/8),terrain:'PLAIN'}))};
const units=[commander,ally,...enemies], logs=[],presentation=[];
let consume=0,render=0,auto=0,clear=0,mode='map-target',battleCommit=0;
const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},
 actionState:()=>({map,units,environmentState:{},selected:commander,selectedSkill:skill}),
 canUseSkill:()=>true,consumeSkill:()=>{consume++;return true;},effectiveSkill:(_,s)=>s,
 aoeTiles:(c,r)=>map.tiles.filter(t=>Math.abs(t.x-c.x)+Math.abs(t.y-c.y)<=r),
 unitAt:(x,y)=>units.find(u=>u.alive&&u.x===x&&u.y===y)||null,
 setSelectedSkill:()=>{clear++},setSelectedSkillVariant:()=>{},setMode:v=>{mode=v},
 checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>{auto++;return false},
 render:()=>{render++},pushLog:v=>logs.push(v),random:()=>.6};
const context=vm.createContext({globalThis:null,SkillDatabase:{passiveList:()=>[{commandRadius:3}]},
 TacticalEngine:{range:s=>s.range,teamCanSee:()=>true,canSee:()=>true,
 faceToward:()=>{},resolve:()=>{battleCommit++;return{result:{hit:true,damage:10}}}},
 EffectEngine:{breakStealth:()=>{},interruptChannel:()=>{},consumeWeaponEnchantment:()=>null,
 applyDamage:(target,amount)=>{const loss=Math.min(target.hp,amount);target.hp-=loss;return{hpLoss:loss}}},
 BattleResolution:{previewInherentComponent:()=>({amount:0,element:null})},UnitRuntimeEngine:{},
 AngelWingBarrierEngine:{TYPE:'HOLY_WING_BARRIER'},
 UnitAnimationEngine:{emitAction:(...a)=>presentation.push(a),emitResolvedHit:()=>{}},
 TERRAINS:{PLAIN:{passable:true}}});context.globalThis=context;
vm.runInContext(authored,context,{filename:'tactical-action-controller.js'});
const controller=context.TacticalActionController.create(ctx);
const center=map.tiles.find(t=>t.x===3&&t.y===1);
// Original ordinary movement may be pending when a volley is committed.
controller.beginPendingMove(commander);
assert.equal(controller.executeMapSkill(commander,center,skill),true);
assert.deepEqual(enemies.map(e=>e.hp),[90,90], 'both legal enemies receive one AOE roll each');
assert.equal(battleCommit,2,'only one damage roll per enemy, not one per archer');
assert.equal(consume,1,'one commander skill cost');
for(const u of [commander,ally]) assert.deepEqual([u.moved,u.acted,u.waited],[true,true,true],`${u.id} committed`);
assert.equal(controller.pendingMove(),null,'commander movement is finalized by canonical finish');
assert.equal(mode,'inspect');
assert.equal(auto,1,'auto-end checked once');
assert.equal(presentation.length,1,'one projectile action, not two separate target selections');
assert.equal(controller.executeMapSkill(commander,center,skill),false,'second map selection rejected');
assert.equal(controller.prepareAttack(commander,enemies[0],{id:'reina_blessed_bow',category:'ATTACK',target:'ENEMY'}),false,
 'stale ordinary attack rejected even when resource-check callback allows it');
assert.equal(controller.executeEngagement(commander,enemies[0],{id:'reina_blessed_bow'},[]),false,
 'stale engagement confirmation rejected');
assert.equal(controller.executeEffectSkill(commander,commander,{id:'reina_supply',effects:[]}),false,
 'stale direct skill rejected');
assert.equal(consume,1);
assert.equal(battleCommit,2);
assert.equal(clear>0,true);
console.log('REINA_VOLLEY_SINGLE_COMMIT_OK');

import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattleResolution} from '../../js/battle-resolution.js';
import {SKILLS,SkillDatabase} from '../../js/skill-database.js';
import {EQUIPMENT,EquipmentDatabase} from '../../js/equipment-database.js';
import {VfxDatabase} from '../../js/vfx-database.js';

function fight({roll=0,counter=true,counterSkill=null,positions=[{x:1,y:1},{x:2,y:1}],
  liviaHp=450,enemyHp=450,forceCounterFaster=false,primarySkill=SKILLS.ganfan,autonomous=false}={}){
  const [p,e]=positions;
  const heroChar={id:'livia',name:'莉維亞',weapons:{black_sword:EQUIPMENT.black_sword},armor:EQUIPMENT.livia_light_armor,equipment:[],skills:['black_slash','ganfan'],passives:[],combat:{hp:450,atk:94,matk:90,def:55,mdef:90}};
  const enemyChar={id:'imperial_swordsman',name:'測試對手',weapons:{sword:EQUIPMENT.imperial_sword,bow:EQUIPMENT.imperial_bow},armor:EQUIPMENT.imperial_medium_armor,equipment:[],skills:['slash'],passives:[],combat:{hp:450,atk:90,matk:20,def:60,mdef:40}};
  const l={id:'p1',character:heroChar,x:p.x,y:p.y,hp:liviaHp,mana:120,alive:true,team:'P',moved:false,acted:false};
  const eUnit={id:'e1',character:enemyChar,x:e.x,y:e.y,hp:enemyHp,mana:120,alive:true,team:'E',moved:false,acted:false};
  const originalGlobals=Object.fromEntries(['TacticalEngine','BattleEngine','SkillDatabase','EquipmentDatabase','UnitRuntimeEngine','EffectEngine','PostEngagementEngine','UnitAnimationEngine'].map(k=>[k,globalThis[k]]));
  const receipts=[],animation=[],commits=[],pfx=[];
  globalThis.SkillDatabase=SkillDatabase;
  globalThis.EquipmentDatabase=EquipmentDatabase;
  globalThis.TacticalEngine={
    ensureFacing:u=>u.facing||'E',faceToward:()=>{},
    tile:(map,x,y)=>(map.tiles||[]).find(t=>t.x===x&&t.y===y)||null,
    canTarget:(map,a,b,s)=>!!a?.alive&&!!b?.alive&&a.team!==b.team&&Math.abs(a.x-b.x)+Math.abs(a.y-b.y)>=(s.range?.min||1)&&Math.abs(a.x-b.x)+Math.abs(a.y-b.y)<=(s.range?.max||1),
    attackDelivery:(u,s)=>s.attackType==='SHOT'||s.attackType==='MAGIC'?'RANGED':'MELEE',
    resolve:(map,a,b,s)=>({result:{hit:true,damage:Math.round((s.power??1)*40),crit:false,physicalCrit:false,magicCrit:false,graze:false,type:s.attackType,el:'NONE',hc:100,cc:0,accuracy:0,evasion:0},terrain:{acc:0,eva:0}}),
  };
  globalThis.BattleEngine={actionSpeed:(c,s)=>forceCounterFaster?(s.id==='ganfan'?0:100):0};
  globalThis.UnitRuntimeEngine={applyResourceScaling:(u,s)=>s,rollSanityMisfire:()=>false,beginBloodTransaction:()=>{},endBloodTransaction:()=>{},criticalManaRefund:()=>0,attackEnhancement:()=>1};
  globalThis.EffectEngine={consumeWeaponEnchantment:()=>null,interruptChannel:()=>{},breakStealth:()=>{},applyDamage:(u,d)=>{const value=Math.min(u.hp,Math.max(0,d));u.hp-=value;return{hpLoss:value,absorbed:0}},markVengeance:()=>{},consumeVengeance:()=>{}};
  globalThis.PostEngagementEngine={process:({queue})=>({queue,results:[]})};
  globalThis.UnitAnimationEngine={emitAction:(actor,target,skill,x)=>{animation.push({actor:actor.id,skillId:skill.id,role:x?.role});return{};},emitResolvedHit:()=>{},emitHit:()=>{},emitOutcome:()=>{},emitPresentation:(type,data)=>{pfx.push({type,...data});}};
  const resolution=createBattleResolution({random:()=>roll});
  const map={width:5,height:5,objects:[],tiles:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),terrain:"PLAIN",elevation:0}))};
  const skill=counterSkill||SKILLS.slash;
  const hooks={canUseSkill:()=>true,consumeSkill:(u,s)=>{commits.push({id:u.id,skill:s.id});return{cost:0,resources:{}}},onAction:x=>receipts.push(x),onDefeated:()=>{}};
  try{
    const output=resolution.resolve({map,units:[l,eUnit],initiator:l,target:eUnit,skill:primarySkill,actions:[],
      autonomousReaction:autonomous,reaction:!autonomous&&counter?resolution.createReaction('COUNTER',{skill}):null},hooks);
    return{l,e:eUnit,output,receipts,commits,animation,pfx,defenseChoices:resolution.defenseMethods(l)};
  }finally{for(const [name,value] of Object.entries(originalGlobals))if(value===undefined)delete globalThis[name];else globalThis[name]=value;}
}

test('黑劍授權雁反，技能選單走正式裝備結構',()=>{
 assert.deepEqual(EQUIPMENT.black_sword.grantedSkillIds,['ganfan']);
 const ids=EquipmentDatabase.grantedSkillIds({weapons:{black_sword:EQUIPMENT.black_sword}});
 assert.deepEqual(ids,['ganfan']);
 assert.equal(SKILLS.ganfan.weapon,'black_sword');
 assert.equal(SKILLS.ganfan.power,SKILLS.black_slash.power);
 assert.equal(SKILLS.ganfan.ganfan.followupPower,1.6);
});

test('黑劍招架共用武器防禦基準、支援戰錘攻擊',()=>{
 const profile=EquipmentDatabase.defenseProfiles({weapons:{black_sword:EQUIPMENT.black_sword}}).find(x=>x.id==='livia_black_sword_parry');
 assert.equal(profile.method,'PARRY');assert.equal(profile.vs.SLASH.chance,80);assert.equal(profile.vs.PIERCE.chance,75);
 assert.equal(profile.vs.STRIKE.chance,45);assert.equal(profile.vs.MAGIC.chance,0);
});

test('合法近戰反擊、招架成功：主攻先打、消反擊、返斬威力提高，零第二次資源消耗',()=>{
 const f=fight({roll:0,forceCounterFaster:true});
 assert.deepEqual(f.receipts.map(x=>x.role),['INITIATOR','GANFAN_PARRY','GANFAN_FOLLOWUP']);
 assert.deepEqual(f.receipts.map(x=>x.result.damage),[40,0,64]);
 assert.equal(f.l.hp,450);assert.equal(f.e.hp,450-40-64);
 assert.deepEqual(f.commits.map(x=>x.skill),['ganfan','slash']);
 assert.equal(f.pfx.filter(e=>e.type==='LIVIA_GANFAN_PARRY').length,1);
 assert.deepEqual(f.animation.filter(x=>x.skillId==='ganfan').map(x=>x.role),['INITIATOR','GANFAN_FOLLOWUP']);
});

test('招架失敗，正常承受近戰反擊且沒有返斬',()=>{
 const f=fight({roll:0.999});
 assert.deepEqual(f.receipts.map(x=>x.role),['INITIATOR','COUNTER']);
 assert.equal(f.l.hp,410);assert.equal(f.e.hp,410);
});

test('不選反擊只能正常打一次',()=>{
 const f=fight({counter:false});
 assert.deepEqual(f.receipts.map(x=>x.role),['INITIATOR']);
 assert.equal(f.e.hp,410);assert.equal(f.pfx.length,0);
});

test('普通黑劍斬擊對手反擊不觸發雁反',()=>{
 const f=fight({primarySkill:SKILLS.black_slash});
 assert.deepEqual(f.receipts.map(x=>x.role),['INITIATOR','COUNTER']);
});

test('反擊者被第一斬擊敗，不能再觸發任何招架或返斬',()=>{
 const f=fight({enemyHp:30});
 assert.deepEqual(f.receipts.map(x=>x.role),['INITIATOR']);
 assert.equal(f.e.alive,false);
});

test('遠程反擊不能被雁反招架',()=>{
 const f=fight({counterSkill:{...SKILLS.slash,id:'counter-ranged',attackType:'SHOT',range:{min:1,max:2},weapon:'bow'}});
 assert.deepEqual(f.receipts.map(x=>x.role),['INITIATOR','COUNTER']);
 assert.equal(f.pfx.length,0);
});

test('非相鄰的空間反擊不受雁反處理',()=>{
 const f=fight({positions:[{x:1,y:1},{x:3,y:1}],counterSkill:{...SKILLS.nether_slash,range:{min:1,max:3}}});
 assert.deepEqual(f.receipts.map(x=>x.role),['INITIATOR','COUNTER']);
});

test('成功招架時不會套用原反擊技能的擊退等後續效果',()=>{
 const f=fight({counterSkill:{...SKILLS.slash,id:'smash-counter',attackType:'STRIKE',postEffects:[{type:'KNOCKBACK',distance:2}]}});
 assert.deepEqual(f.receipts.map(x=>x.role),['INITIATOR','GANFAN_PARRY','GANFAN_FOLLOWUP']);
 assert.equal(f.output.postEngagement.queue.length,0);
});

test('雁反不能當一般反擊技能再引出反擊連鎖',()=>{
 const f=fight();
 const resolution=createBattleResolution();
 assert.equal(f.output.queue.filter(x=>x.role==='GANFAN_FOLLOWUP').length,1);
 assert.equal(f.output.queue.filter(x=>x.role==='COUNTER').length,1);
 assert.equal(SkillDatabase.get('ganfan').ganfanFollowup,undefined);
});

test('正式 Babylon VFX 登錄技能與成功招架事件',()=>{
 assert.equal(VfxDatabase.roleFor('swordsmanship','ganfan'),'GANFAN');
 assert.ok(VfxDatabase.routeSkill('ganfan').includes('swordsmanship'));
 assert.ok(VfxDatabase.hasEvent('swordsmanship','LIVIA_GANFAN_PARRY'));
});


test('普通防禦沒有自動取得雁反專屬黑劍招架選項',()=>{
 const f=fight({counter:false});
 assert.ok(f.defenseChoices.every(p=>p.id!=='livia_black_sword_parry'));
});

test('單機對AI施放雁反，能使用既有自主反應進行合法近戰反擊',()=>{
 const f=fight({autonomous:true,forceCounterFaster:true,roll:0});
 assert.deepEqual(f.receipts.map(r=>r.role),['INITIATOR','GANFAN_PARRY','GANFAN_FOLLOWUP']);
});

test('PvP人工接受攻擊時（未標示自主反應），不會自行產生反擊',()=>{
 const f=fight({counter:false,autonomous:false});
 assert.deepEqual(f.receipts.map(r=>r.role),['INITIATOR']);
});

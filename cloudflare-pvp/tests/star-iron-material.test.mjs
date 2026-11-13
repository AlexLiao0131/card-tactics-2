import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const here=fileURLToPath(new URL('../js/',import.meta.url));
const root=mkdtempSync(join(tmpdir(),'card-tactics-star-iron-'));
const sources=['equipment-database.js','weapon-material-engine.js','battle-resolution.js',
  'battle-engagement-forecast.js','battle-reaction-decision-engine.js'];
try{
  writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
  for(const f of sources)copyFileSync(join(here,f),join(root,f));
  writeFileSync(join(root,'colin-shield-mobility-engine.js'),
    'export const ColinShieldMobilityEngine={shieldOccupied:()=>false};\n');
  writeFileSync(join(root,'tactical-engine.js'),`export const TacticalEngine={
    tile:()=>({terrain:'PLAIN'}),faceToward:()=>{},ensureFacing:()=> 'N',
    canTarget:()=>true,canTraverseElevation:()=>true,
    resolve:(_map,_attacker,_target,skill)=>({result:{hit:skill.forceMiss!==true,
      damage:100,type:skill.attackType==='INHERIT'?'SLASH':skill.attackType,
      el:'NONE',hc:85,cc:5,crit:false,guaranteedHit:false}})
  };globalThis.TacticalEngine=TacticalEngine;`);
  writeFileSync(join(root,'skill-database.js'),`export const SkillDatabase={passiveList:()=>[],
    passiveDefenseProfiles:()=>[],list:()=>[]};globalThis.SkillDatabase=SkillDatabase;`);
  const imp=async f=>import(pathToFileURL(join(root,f)).href);
  await imp('tactical-engine.js');await imp('skill-database.js');
  const {EQUIPMENT,EquipmentDatabase}=await imp('equipment-database.js');
  const {WeaponMaterialEngine}=await imp('weapon-material-engine.js');
  const {createBattleResolution}=await imp('battle-resolution.js');
  const {officialEngagementForecast}=await imp('battle-engagement-forecast.js');
  const {chooseAutonomousBattleReaction}=await imp('battle-reaction-decision-engine.js');
  globalThis.BattleEngine={actionSpeed:()=>10,critChance:()=>0,attackClass:()=>"MELEE",elementalEnchantmentDamage:()=>40};
  globalThis.EffectEngine={applyDamage(target,amount){
    const actual=Math.min(Number(amount),target.hp);target.hp-=actual;
    return{hpLoss:actual,absorbed:0};}};
  function actor(id,x,weapon,slot='weapon',extras={}){
    return {id,team:id.startsWith('enemy')?'E':'P',x,y:0,hp:1000,alive:true,
      character:{name:id,weapons:{[slot]:weapon},armor:{type:'NONE',types:['NONE'],element:'NONE'},
        combat:{hp:1000},skills:[],passives:[],...extras}};
  }
  const star=EQUIPMENT.star_iron_sword;
  const standard=EQUIPMENT.imperial_sword;
  const starSkill={id:'leon_slash',weapon:'weapon',attackType:'SLASH',power:1,target:'ENEMY'};
  const map={tiles:[{x:0,y:0},{x:1,y:0}]};
  const materialMethod=EquipmentDatabase.defenseProfiles({weapons:{weapon:standard}})[0];
  const contest=WeaponMaterialEngine.defenseMatchup({attacker:actor('a',0,star),
    defender:actor('enemy',1,standard),skill:starSkill,method:materialMethod,attackType:'SLASH'});
  assert.equal(contest.pressure,10,'Star iron edge derives from existing 80 - 70 base');
  assert.equal(contest.chance,60);
  const noMaterial=WeaponMaterialEngine.defenseMatchup({attacker:actor('a',0,standard),
    defender:actor('enemy',1,standard),skill:starSkill,method:materialMethod,attackType:'SLASH'});
  assert.equal(noMaterial.chance,70);
  const spearMethod=EquipmentDatabase.defenseProfiles({weapons:{weapon:EQUIPMENT.imperial_spear}})[0];
  assert.equal(WeaponMaterialEngine.defenseMatchup({attacker:actor('a',0,star),
    defender:actor('enemy',1,EQUIPMENT.imperial_spear),skill:starSkill,
    method:spearMethod,attackType:'SLASH'}).chance,45,
    'Star iron contests ordinary metal spear deflection, not just other swords');
  const apply=(weapon,defWeapon,methodId,skill={...starSkill},rng=.65,attackerExtra={})=>{
    const a=actor('attacker',0,weapon,'weapon',attackerExtra),d=actor('enemy',1,defWeapon);
    const engine=createBattleResolution({random:()=>rng});
    const out=engine.resolve({map,units:[a,d],initiator:a,target:d,skill,
      reaction:engine.createReaction('DEFENSE',{methodId})});
    return{a,d,hit:out.results[0]};
  };
  const pressureHit=apply(star,standard,'sword_parry');
  assert.equal(pressureHit.hit?.resolved?.defense?.chance,60);
  assert.equal(pressureHit.hit?.result?.damage,100,'65 roll defeats pressure-adjusted 60');
  const noPressure=apply(standard,standard,'sword_parry');
  assert.equal(noPressure.hit?.resolved?.defense?.chance,70);
  assert.equal(noPressure.hit?.result?.damage,0,'65 roll remains within ordinary 70% parry');
  const miss=apply(star,standard,'sword_parry',{...starSkill,forceMiss:true});
  assert.equal(miss.hit.resolved.defense.triggered,false,'No material contact on MISS');
  assert.equal(miss.hit.result.damage,0);
  const artifactHit=apply(star,EQUIPMENT.elf_blessed_guard,'artifact_parry').hit;
  assert.equal(artifactHit.resolved.defense.chance,90);
  assert.equal(artifactHit.resolved.defense.materialPressure,0);
  const guardTarget=actor('enemy',1,standard);
  guardTarget.character.guard=EQUIPMENT.elf_blessed_guard;
  const method=EquipmentDatabase.defenseProfiles(guardTarget.character).find(p=>p.id==='artifact_parry');
  assert.equal(WeaponMaterialEngine.defenseMatchup({attacker:actor('a',0,star),
    defender:guardTarget,skill:starSkill,method,attackType:'SLASH'}).pressure,0);
  assert.equal(WeaponMaterialEngine.defenseMatchup({attacker:actor('a',0,star),
    defender:actor('enemy',1,star),skill:starSkill,
    method:EquipmentDatabase.defenseProfiles({weapons:{weapon:star}})[0],attackType:'SLASH'}).pressure,0);
  assert.equal(WeaponMaterialEngine.defenseMatchup({attacker:actor('a',0,star),
    defender:actor('enemy',1,standard),skill:{...starSkill,attackClass:'RANGED'},
    method:materialMethod,attackType:'SLASH'}).pressure,0);
  const starProfiles=EquipmentDatabase.defenseProfiles({weapons:{weapon:star}});
  assert.equal(starProfiles.length,2);
  assert.equal(starProfiles[0].vs.STRIKE.chance,5,'Original full 5% strike parry preserved');
  assert.equal(starProfiles[1].method,'DEFLECT');
  assert.equal(starProfiles[1].vs.STRIKE.damageMultiplier,.8);
  assert.equal(starProfiles[1].physicalOnly,true);
  assert.equal(Object.hasOwn(starProfiles[1].vs.STRIKE,'chance'),false);
  const hammer=EQUIPMENT.imperial_hammer;
  const strike={id:'hammer_strike',weapon:'weapon',attackType:'STRIKE',target:'ENEMY',power:1};
  const struck=apply(hammer,star,'star_iron_strike_deflect',strike,.99);
  assert.equal(struck.hit.resolved.defense.success,true);
  assert.equal(struck.hit.resolved.defense.chance,null,'Guaranteed partial deflect, not a new invented success rate');
  assert.equal(struck.hit.result.damage,80,'20% physical protection uses existing .80 mitigation');
  const enchantedHammer={...hammer,inherentMagic:{element:'HOLY',power:.4}};
  const struckMagic=apply(enchantedHammer,star,'star_iron_strike_deflect',strike,.99);
  assert.equal(struckMagic.hit.result.physicalHpDamage,80);
  assert.equal(struckMagic.hit.result.magicHpDamage,40,'Deflect does not cancel enchantment magic');
  const forecast=officialEngagementForecast({map,attacker:actor('attacker',0,enchantedHammer),
    defender:actor('enemy',1,star),skill:strike,
    resolution:createBattleResolution({random:()=>.99})});
  const deflectPreview=forecast.defenseMethods.find(p=>p.id==='star_iron_strike_deflect');
  assert.equal(deflectPreview.successRate,100);
  assert.equal(deflectPreview.damageIfBlocked,120,'Forecast matches physical-only combat 80 + magic 40');
  const starVersusSteel=officialEngagementForecast({map,attacker:actor('attacker',0,star),
    defender:actor('enemy',1,standard),skill:starSkill,
    resolution:createBattleResolution({random:()=>.65})});
  assert.equal(starVersusSteel.defenseMethods.find(p=>p.id==='sword_parry').successRate,60);
  const decider=createBattleResolution({random:()=>.99});
  const decision=chooseAutonomousBattleReaction({map,units:[actor('attacker',0,hammer),actor('enemy',1,star)],
    attacker:actor('attacker',0,hammer),defender:actor('enemy',1,star),skill:strike,
    resolution:decider,canUseSkill:()=>true});
  assert.equal(decision.reaction.methodId,'star_iron_strike_deflect',
    'AI prefers reliable partial mitigation over 5% all-or-nothing parry');
  assert.equal(EquipmentDatabase.defenseProfiles({weapons:{weapon:EQUIPMENT.black_sword}}).length,0,
    'Black sword was not granted unapproved defense');
  assert.equal(EQUIPMENT.church_saint_greatsword.inherentMagic.unblockable,true,
    'Holy sword magical strike untouched');
  console.log('PASS: star-iron material contest, real defense, magic isolation, forecast, AI, artifact and black sword');
}finally{rmSync(root,{recursive:true,force:true});}

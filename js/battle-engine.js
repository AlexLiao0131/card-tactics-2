export const BATTLE_RULES={mult:{[-2]:.70,[-1]:.85,0:1,1:1.15,2:1.30},physical:{SLASH:{NONE:1,LIGHT:1,MEDIUM:0,HEAVY:-1,SHIELD:-1},PIERCE:{NONE:1,LIGHT:0,MEDIUM:1,HEAVY:1,SHIELD:-1},STRIKE:{NONE:0,LIGHT:0,MEDIUM:1,HEAVY:1,SHIELD:1},SHOT:{NONE:1,LIGHT:1,MEDIUM:0,HEAVY:-1,SHIELD:-2},MAGIC:{NONE:0,LIGHT:0,MEDIUM:0,HEAVY:0,SHIELD:0}},elemental:{FIRE:{NATURE:1,WATER:-1},NATURE:{THUNDER:1,FIRE:-1},THUNDER:{WATER:1,NATURE:-1},WATER:{FIRE:1,THUNDER:-1},LIGHT:{DARK:1},HOLY:{DARK:1},DARK:{LIGHT:1,HOLY:-1},NONE:{}},combatParams:{baseHit:85,agiHitStep:2,minHit:15,maxHit:99,baseCrit:5,lukCritStep:.5,agiSpeedStep:4}};
export const BattleEngine=(()=>{
  const R=BATTLE_RULES,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),match=(t,a,b)=>t[a]?.[b]??0,aff=(o,a)=>o?.affixes?.includes(a)??false;
  function getSkill(c,id){if(!c.skills.includes(id))return null;return SkillDatabase.get(id)}
  function armorTypes(d){return Array.isArray(d?.armor?.types)&&d.armor.types.length?d.armor.types:[d?.armor?.type??"NONE"]}
  function physicalMatch(type,d){return armorTypes(d).map(x=>match(R.physical,type,x)).reduce((a,b)=>a+b,0)}
  function hasDefenderAffix(d,n){if(aff(d?.guard,n)||aff(d?.armor,n))return true;return Array.isArray(d?.equipment)&&d.equipment.some(x=>aff(x,n))}
  function sumMod(c,k){let n=Number(c?.modifiers?.[k]??0);if(Array.isArray(c?.equipment))for(const e of c.equipment)n+=Number(e?.modifiers?.[k]??0);return n}
  function skillMod(s,k){return Number(s?.modifiers?.[k]??0)}
  function accuracy(c,s){return sumMod(c,"accuracy")+skillMod(s,"accuracy")}
  function evasion(c){return sumMod(c,"evasion")}
  function hitChance(a,d,s){const q=R.combatParams;return clamp(q.baseHit+(a.attributes.agi-d.attributes.agi)*q.agiHitStep+accuracy(a,s)-evasion(d),q.minHit,q.maxHit)}
  function critChance(a,s){const q=R.combatParams;return clamp(q.baseCrit+a.attributes.luk*q.lukCritStep+sumMod(a,"crit")+skillMod(s,"crit"),0,100)}
  function actionSpeed(a,s){return a.attributes.agi*R.combatParams.agiSpeedStep+sumMod(a,"speed")+Number(s?.speed??0)+skillMod(s,"speed")}
  function hasTrait(c,trait){return c?.race===trait||(c?.traits||[]).includes(trait)}
  function traitMultiplier(d,s){let m=1;for(const [trait,value] of Object.entries(s?.traitMultipliers||{}))if(hasTrait(d,trait))m*=Number(value||1);return m}
  function calculate(a,d,s,opt={}){
    const w=a.weapons[s.weapon],type=s.attackType==="INHERIT"?w?.attackType:s.attackType,el=s.element==="INHERIT"?w?.element:s.element,basePt=physicalMatch(type,d),et=match(R.elemental,el,d.armor.element),aid=aff(w,"PHYSICAL_DEFENSE_IGNORE"),aia=aff(w,"IGNORE_ARMOR_DISADVANTAGE"),parry=hasDefenderAffix(d,"ARTIFACT_PARRY")&&(aid||aia);let ignore=aid&&!parry,armorDisadvIgnored=aia&&!parry,pt=basePt;if(armorDisadvIgnored&&pt<0)pt=0;const tierRaw=pt+et,tier=clamp(tierRaw,-2,2),m=R.mult[tier],magic=type==="MAGIC",offenseStat=String(s?.offenseStat||(magic?"MATK":"ATK")).toUpperCase(),defenseStat=String(s?.defenseStat||(magic?"MDEF":"DEF")).toUpperCase(),off=Number(a.combat[offenseStat.toLowerCase()]??(magic?a.combat.matk:a.combat.atk)),defBase=Number(d.combat[defenseStat.toLowerCase()]??(magic?d.combat.mdef:d.combat.def)),def=defenseStat==="DEF"&&ignore?0:defBase,raw=Math.max(1,off*s.power-def*.5),hc=hitChance(a,d,s),cc=critChance(a,s),spd=actionSpeed(a,s),traitM=traitMultiplier(d,s);
    const guaranteed=aff(w,"GUARANTEED_HIT")||aff(s,"GUARANTEED_HIT"),hitRoll=opt.forceMiss||opt.forceHit||guaranteed?null:Math.random()*100;
    let hit=opt.forceMiss?false:opt.forceHit?true:(guaranteed?true:hitRoll<hc);
    const critRoll=hit&&!opt.forceCrit&&!opt.disableCrit?Math.random()*100:null,crit=hit&&(opt.forceCrit?true:(!opt.disableCrit&&critRoll<cc)),damageTakenM=Number(d?.modifiers?.damageTakenMultiplier??1),damage=hit?Math.round(raw*m*traitM*damageTakenM*(crit?1.5:1)):0;
    return{weapon:w,type,el,basePt,pt,et,tierRaw,tier,m,ignore,armorDisadvIgnored,artifactParry:parry,offenseStat,defenseStat,off,def,raw,hc,cc,spd,traitMultiplier:traitM,damageTakenMultiplier:damageTakenM,accuracy:accuracy(a,s),evasion:evasion(d),hitRoll,critRoll,guaranteedHit:guaranteed,hit,crit,damage,hpAfter:Math.max(0,d.combat.hp-damage)}
  }
  return{getSkill,calculate,armorTypes,physicalMatch,hitChance,critChance,actionSpeed,accuracy,evasion,traitMultiplier}
})();
globalThis.BATTLE_RULES=BATTLE_RULES;
globalThis.BattleEngine=BattleEngine;

export const BattleResolution=(()=>{
  const ACTIVE_EVADE_PENALTY=20,GRAZE_DAMAGE_MULTIPLIER=.5;
  const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const isSingleTarget=s=>(s?.targetType||"SINGLE")==="SINGLE";
  function passiveDefenseProfiles(c){return SkillDatabase.passiveDefenseProfiles?SkillDatabase.passiveDefenseProfiles(c?.passives):[]}
  function defenseMethods(d){return[...EquipmentDatabase.defenseProfiles(d?.character),...passiveDefenseProfiles(d?.character)]}
  function guardProfiles(u){return defenseMethods(u).filter(p=>p.canGuardAlly===true)}
  function guardCandidates({map,units,target}){if(!target?.alive)return[];const tt=TacticalEngine.tile(map,target.x,target.y);return(units||[]).filter(g=>{if(!g.alive||g.id===target.id||g.team!==target.team||distance(g,target)!==1)return false;const gt=TacticalEngine.tile(map,g.x,g.y);return !!gt&&!!tt&&TacticalEngine.canTraverseElevation(gt,tt,g)}).map(guardian=>({guardian,profiles:guardProfiles(guardian)})).filter(x=>x.profiles.length)}
  function createGuardInterception(guardian,methodId){if(!guardian?.alive)throw new Error("Guard Ally requires a living guardian.");const p=guardProfiles(guardian).find(x=>x.id===methodId);if(!p)throw new Error(`Invalid Guard Ally method: ${methodId}`);return{type:"GUARD_ALLY",guardian,methodId:p.id}}
  function supportSkills({ally,target,canUseSkill}){return SkillDatabase.list(ally.character.skills).filter(s=>{if(s.support!==true||s.target!=="ENEMY"||!isSingleTarget(s))return false;if(canUseSkill&&!canUseSkill(ally,s))return false;const r=s.range||{min:1,max:1},d=distance(ally,target);return d>=r.min&&d<=r.max})}
  function supportCandidates({units,initiator,target,canUseSkill}){const out=[];for(const ally of units){if(!ally.alive||ally.id===initiator.id||ally.team!==initiator.team||ally.waited===true)continue;if(Math.abs(ally.x-initiator.x)>1||Math.abs(ally.y-initiator.y)>1)continue;const skills=supportSkills({ally,target,canUseSkill});if(skills.length)out.push({ally,skills})}return out}
  function createSupportAction(ally,target,skill,index=0){return{id:`support-${ally.id}-${index}`,role:"SUPPORT",actor:ally,target,skill}}
  function counterSkills({defender,attacker,canUseSkill}){if(!defender?.alive||!attacker?.alive)return[];return SkillDatabase.list(defender.character.skills).filter(s=>{if(s.target!=="ENEMY"||!isSingleTarget(s))return false;if(canUseSkill&&!canUseSkill(defender,s))return false;const r=s.range||{min:1,max:1},d=distance(defender,attacker);return d>=r.min&&d<=r.max})}
  function createCounterAction(defender,attacker,skill){return{id:`counter-${defender.id}`,role:"COUNTER",actor:defender,target:attacker,skill}}
  function createReaction(type,options={}){if(!["COUNTER","DEFENSE","EVADE"].includes(type))throw new Error(`Unknown reaction type: ${type}`);return{type,...options}}
  function prepareSingleTargetReaction({defender,attacker,canUseSkill}){return{defender,attacker,counterSkills:counterSkills({defender,attacker,canUseSkill}),defenseMethods:defenseMethods(defender),choices:["COUNTER","DEFENSE","EVADE"]}}
  function createContext({map,units=[],initiator,target,skill,actions=[],reaction=null,interception=null}){
    [initiator,target,...actions.map(a=>a.actor)].forEach(u=>TacticalEngine.ensureFacing(u));
    const originalTarget=target,guardian=interception?.type==="GUARD_ALLY"&&interception.guardian?.alive?interception.guardian:null,effectiveTarget=guardian||originalTarget;
    TacticalEngine.faceToward(initiator,originalTarget);
    if(guardian)TacticalEngine.faceToward(guardian,initiator);
    const primary={id:"primary",role:"INITIATOR",actor:initiator,target:effectiveTarget,skill},participants=[],seen=new Set();
    [initiator,originalTarget,effectiveTarget,...actions.map(a=>a.actor)].forEach(u=>{if(u&&!seen.has(u.id)){seen.add(u.id);participants.push(u)}});
    return{map,units,initiator,target:effectiveTarget,originalTarget,guardian,interception:guardian?interception:null,skill,reaction,participants,actions:[primary,...actions]}
  }
  const actionSpeed=a=>BattleEngine.actionSpeed(a.actor.character,a.skill);
  function buildQueue(c){return c.actions.filter(a=>a.actor?.alive&&a.target?.alive&&a.skill).map((a,index)=>({...a,index,spd:actionSpeed(a)})).sort((a,b)=>b.spd-a.spd||a.index-b.index)}
  function attackType(a,s){const w=a?.character?.weapons?.[s?.weapon];return s?.attackType==="INHERIT"?w?.attackType:s?.attackType}
  const attackWeapon=(a,s)=>a?.character?.weapons?.[s?.weapon]||null,hasAffix=(i,id)=>i?.affixes?.includes(id)===true;
  function defenseProfileById(d,id){return id?defenseMethods(d).find(p=>p.id===id)||null:null}
  function isPrimaryIncomingAction(c,a){return a.role==="INITIATOR"&&a.actor?.id===c.initiator?.id&&a.target?.id===c.target?.id}
  function resolveEvade(map,a,t,s){const z=TacticalEngine.resolve(map,a,t,s,{forceHit:true}),b=z.result,o=b.hc,f=Math.max(0,o-ACTIVE_EVADE_PENALTY),roll=Math.random()*100;let outcome="MISS",m=0;if(roll<f){outcome="HIT";m=1}else if(roll<o){outcome="GRAZE";m=GRAZE_DAMAGE_MULTIPLIER}return{...z,result:{...b,hit:outcome!=="MISS",graze:outcome==="GRAZE",evadeOutcome:outcome,evadeRoll:roll,originalHitChance:o,activeHitChance:f,damage:Math.round(b.damage*m)}}}
  function resolveDefense(map,a,t,s,r){const p=defenseProfileById(t,r?.methodId);if(!p)return{...TacticalEngine.resolve(map,a,t,s),defense:{method:null,valid:false,reason:"DEFENSE_METHOD_NOT_FOUND"}};const type=attackType(a,s),rule=p.vs?.[type];if(!rule)return{...TacticalEngine.resolve(map,a,t,s),defense:{method:p,valid:false,reason:"ATTACK_TYPE_NOT_SUPPORTED",attackType:type}};const z=TacticalEngine.resolve(map,a,t,s),b=z.result;if(!b.hit)return{...z,defense:{method:p,valid:true,attackType:type,triggered:false,reason:"ATTACK_MISSED"}};if(p.method==="GUARD"&&hasAffix(attackWeapon(a,s),"PHYSICAL_DEFENSE_IGNORE")&&p.artifact!==true)return{...z,defense:{method:p,valid:true,attackType:type,triggered:false,bypassed:true,reason:"PHYSICAL_DEFENSE_IGNORE"}};let success=true,roll=null;if(Number.isFinite(Number(rule.chance))){roll=Math.random()*100;success=roll<Number(rule.chance)}let m=1;if(success)m=p.method==="PARRY"?0:(Number.isFinite(Number(rule.damageMultiplier))?Number(rule.damageMultiplier):1);return{...z,result:{...b,damage:Math.round(b.damage*m)},defense:{method:p,valid:true,attackType:type,triggered:true,success,roll,chance:Number.isFinite(Number(rule.chance))?Number(rule.chance):null,damageMultiplier:m}}}
  function resolveAction(c,a){
    TacticalEngine.ensureFacing(a.actor);TacticalEngine.ensureFacing(a.target);
    if(a.role!=="INITIATOR")TacticalEngine.faceToward(a.actor,a.target);
    if(!isPrimaryIncomingAction(c,a))return TacticalEngine.resolve(c.map,a.actor,a.target,a.skill);
    if(c.interception?.type==="GUARD_ALLY")return resolveDefense(c.map,a.actor,a.target,a.skill,{type:"DEFENSE",methodId:c.interception.methodId});
    if(c.reaction?.type==="EVADE")return resolveEvade(c.map,a.actor,a.target,a.skill);
    if(c.reaction?.type==="DEFENSE")return resolveDefense(c.map,a.actor,a.target,a.skill,c.reaction);
    return TacticalEngine.resolve(c.map,a.actor,a.target,a.skill)
  }
  function postQueue(results){const q=[];for(const entry of results){if(!entry.result?.hit)continue;for(const effect of entry.skill?.postEffects||[])q.push({actionId:entry.id,role:entry.role,source:entry.actor,target:entry.target,skill:entry.skill,effect})}return q}
  function execute(c,hooks={}){const queue=buildQueue(c),results=[];for(const a of queue){if(!a.actor.alive||!a.target.alive)continue;if(hooks.canUseSkill&&!hooks.canUseSkill(a.actor,a.skill))continue;const resolved=resolveAction(c,a),result=resolved.result;hooks.consumeSkill?.(a.actor,a.skill);a.target.hp=Math.max(0,a.target.hp-result.damage);if(a.target.hp===0){a.target.alive=false;hooks.onDefeated?.(a.target,a.actor,a.skill)}const e={...a,resolved,result,hpAfter:a.target.hp};results.push(e);hooks.onAction?.(e)}const pq=postQueue(results);const post=window.PostEngagementEngine?PostEngagementEngine.process({map:c.map,units:c.units,queue:pq},{onEffect:hooks.onPostEffect,onDefeated:hooks.onDefeated}):{queue:pq,results:[]};return{context:c,queue,results,postEngagement:post}}
  function resolve(options,hooks={}){const actions=[...(options.actions||[])];if(options.reaction?.type==="COUNTER"&&options.reaction.skill)actions.push(createCounterAction(options.target,options.initiator,options.reaction.skill));return execute(createContext({...options,actions}),hooks)}
  return{createContext,buildQueue,execute,resolve,actionSpeed,isSingleTarget,supportSkills,supportCandidates,createSupportAction,counterSkills,createCounterAction,createReaction,defenseMethods,guardProfiles,guardCandidates,createGuardInterception,prepareSingleTargetReaction}
})();
globalThis.BattleResolution=BattleResolution;

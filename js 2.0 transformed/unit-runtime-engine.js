export const UnitRuntimeEngine=(()=>{
  const MANA_BASE=40,MANA_INT_FACTOR=2,MANA_WIL_FACTOR=2;
  function maxManaFromAttributes(attributes={}){
    return Math.max(0,Math.round(MANA_BASE+Number(attributes.int||0)*MANA_INT_FACTOR+Number(attributes.wil||0)*MANA_WIL_FACTOR));
  }
  function maxMana(unit){return maxManaFromAttributes(unit?.character?.attributes||{})}
  function syncMana(unit,{initialize=false}={}){
    if(!unit)return{mana:0,maxMana:0};
    const nextMax=maxMana(unit);
    if(initialize||!Number.isFinite(Number(unit.mana)))unit.mana=nextMax;
    else unit.mana=Math.min(Math.max(0,Number(unit.mana||0)),nextMax);
    unit.maxMana=nextMax;
    return{mana:unit.mana,maxMana:unit.maxMana};
  }
  function restoreMana(unit,amount){
    syncMana(unit);
    const before=unit.mana;
    unit.mana=Math.min(unit.maxMana,before+Math.max(0,Math.round(Number(amount||0))));
    return unit.mana-before;
  }
  function manaCost(skill){return Math.max(0,Math.round(Number(skill?.manaCost||0)))}
  function createSkillResources(character){
    const resources={};
    SkillDatabase.list(character?.skills||[]).forEach(skill=>{
      const resource=skill.resource||{type:"UNLIMITED"};
      if(resource.type==="USES")resources[skill.id]={type:"USES",remaining:Number(resource.max||0),max:Number(resource.max||0)};
      else resources[skill.id]={type:resource.type||"UNLIMITED"};
    });
    return resources;
  }
  function create({id,team,characterId,x,y,map}){
    const sourceCharacter=CHARACTERS[characterId];
    if(!sourceCharacter)return null;
    const character=JSON.parse(JSON.stringify(sourceCharacter));
    const unit={id,team,character,x,y,z:Number(TacticalEngine.elevation(TacticalEngine.tile(map,x,y))||0),
      hp:character.combat.hp,alive:true,moved:false,acted:false,waited:false,
      skillResources:createSkillResources(character),effects:[],grantedSkills:[]};
    syncMana(unit,{initialize:true});
    return unit;
  }
  function living(units,team){return (units||[]).filter(u=>u.alive&&u.team===team)}
  function resetActions(units,team){living(units,team).forEach(u=>{u.moved=false;u.acted=false;u.waited=false;syncMana(u);})}
  function allFinished(units,team){const alive=living(units,team);return alive.length>0&&alive.every(u=>u.acted)}
  function resourceFor(unit,skill){const id=skill?.baseSkillId||skill?.id;return unit?.skillResources?.[id]||unit?.skillResources?.[skill?.id]||{type:"UNLIMITED"}}
  function canUseSkill(unit,skill){if(skill?.approach&&unit?.moved)return false;syncMana(unit);if(unit.mana<manaCost(skill))return false;const r=resourceFor(unit,skill);return r.type!=="USES"||r.remaining>0}
  function consumeSkill(unit,skill){if(!canUseSkill(unit,skill))return null;unit.mana-=manaCost(skill);const r=resourceFor(unit,skill);if(r.type==="USES"&&r.remaining>0)r.remaining--;return r}
  function resourceLabel(unit,skill){syncMana(unit);const r=resourceFor(unit,skill),uses=r.type==="USES"?`${r.remaining}/${r.max}`:"∞",cost=manaCost(skill);return cost>0?`${uses}｜MP ${cost}`:uses}
  function targetType(skill){return skill?.targetType||"SINGLE"}
  return Object.freeze({MANA_BASE,MANA_INT_FACTOR,MANA_WIL_FACTOR,maxManaFromAttributes,maxMana,syncMana,restoreMana,manaCost,createSkillResources,create,living,resetActions,allFinished,resourceFor,canUseSkill,consumeSkill,resourceLabel,targetType});
})();
globalThis.UnitRuntimeEngine=UnitRuntimeEngine;

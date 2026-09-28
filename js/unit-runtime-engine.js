export const UnitRuntimeEngine=(()=>{
  const MANA_BASE=40,MANA_INT_FACTOR=2,MANA_WIL_FACTOR=2;
  function maxManaFromAttributes(attributes={}){
    return Math.max(0,Math.round(MANA_BASE+Number(attributes.int||0)*MANA_INT_FACTOR+Number(attributes.wil||0)*MANA_WIL_FACTOR));
  }
  function maxMana(unit){return unit?.character?.resourceRules?.mana===false?0:maxManaFromAttributes(unit?.character?.attributes||{})}
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
  function createFromCharacter({id,team,character,x,y,map}){
    if(!character)return null;
    const runtimeCharacter=JSON.parse(JSON.stringify(character));
    const unit={id,team,character:runtimeCharacter,x,y,z:Number(TacticalEngine.elevation(TacticalEngine.tile(map,x,y))||0),
      hp:runtimeCharacter.combat.hp,alive:true,moved:false,acted:false,waited:false,
      unitRole:runtimeCharacter.unitRole||"UNIT",
      participatesInTurn:runtimeCharacter.participatesInTurn!==false,
      occupiesTile:runtimeCharacter.occupiesTile!==false,
      canAttack:runtimeCharacter.canAttack!==false,
      canCapture:runtimeCharacter.canCapture!==false,
      countsForObjectives:runtimeCharacter.countsForObjectives!==false,
      companionId:runtimeCharacter.companionId||null,
      ownerCharacterId:runtimeCharacter.ownerCharacterId||null,
      skillResources:createSkillResources(runtimeCharacter),effects:[],grantedSkills:[],_runtimeMap:map};
    for(const passive of SkillDatabase.passiveList(runtimeCharacter?.passives||[])){
      for(const effect of passive.openingEffects||[])unit.effects.push(JSON.parse(JSON.stringify(effect)));
    }
    globalThis.VerticalMobilityEngine?.initialize?.(unit,map);
    syncMana(unit,{initialize:true});
    return unit;
  }
  function create({id,team,characterId,x,y,map}){
    const sourceCharacter=CHARACTERS[characterId];
    if(!sourceCharacter)return null;
    return createFromCharacter({id,team,character:sourceCharacter,x,y,map});
  }
  function reconcileCompanions(units){
    if(!globalThis.CompanionDatabase?.reconcileUnits)return[];
    return CompanionDatabase.reconcileUnits(units||[]);
  }
  function living(units,team){reconcileCompanions(units);return (units||[]).filter(u=>u.alive&&u.team===team)}
  function turnActors(units,team){return living(units,team).filter(u=>u.participatesInTurn!==false)}
  function resetActions(units,team){reconcileCompanions(units);turnActors(units,team).forEach(u=>{u.moved=false;u.acted=false;u.waited=false;syncMana(u);})}
  function allFinished(units,team){reconcileCompanions(units);const actors=turnActors(units,team);return actors.length>0&&actors.every(u=>u.acted)}
  function resourceFor(unit,skill){const id=skill?.baseSkillId||skill?.id;return unit?.skillResources?.[id]||unit?.skillResources?.[skill?.id]||{type:"UNLIMITED"}}
  function canUseSkill(unit,skill){
    if(skill?.approach&&unit?.moved)return false;
    const req=skill?.requirements||{};
    if(req.carrying===true&&!unit?.carryingUnitId)return false;
    if(req.notCarrying===true&&!!unit?.carryingUnitId)return false;
    if(req.notMoved===true&&!!unit?.moved)return false;
    if(req.water===true){const tile=globalThis.CardTacticsRuntime?.getBattleMap?.()?.tiles?.find(t=>t.x===unit?.x&&t.y===unit?.y);if(!tile||Number(globalThis.HydrologyEngine?.waterDepth?.(tile)||0)<=0)return false;}
    syncMana(unit);if(unit.mana<manaCost(skill))return false;const r=resourceFor(unit,skill);return r.type!=="USES"||r.remaining>0
  }
  function consumeSkill(unit,skill){if(!canUseSkill(unit,skill))return null;unit.mana-=manaCost(skill);const r=resourceFor(unit,skill);if(r.type==="USES"&&r.remaining>0)r.remaining--;return r}
  function resourceLabel(unit,skill){syncMana(unit);const r=resourceFor(unit,skill),uses=r.type==="USES"?`${r.remaining}/${r.max}`:"∞",cost=manaCost(skill);return cost>0?`${uses}｜MP ${cost}`:uses}
  function targetType(skill){return skill?.targetType||"SINGLE"}
  return Object.freeze({MANA_BASE,MANA_INT_FACTOR,MANA_WIL_FACTOR,maxManaFromAttributes,maxMana,syncMana,restoreMana,manaCost,createSkillResources,createFromCharacter,create,reconcileCompanions,living,turnActors,resetActions,allFinished,resourceFor,canUseSkill,consumeSkill,resourceLabel,targetType});
})();
globalThis.UnitRuntimeEngine=UnitRuntimeEngine;

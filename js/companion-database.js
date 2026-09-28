export const COMPANIONS={
  ophi_eagle:{
    id:"ophi_eagle",
    name:"奧菲的老鷹",
    ownerCharacterId:"ophi",
    kind:"SCOUT",
    movement:"FLYING",
    occupiesCardSlot:false,
    occupiesTile:false,
    participatesInTurn:false,
    canAttack:false,
    canCapture:false,
    countsForObjectives:false,
    sharedVision:true,
    targetingMode:"SCOUT_SHARED_VISION",
    requiresOwnerCompanionRule:"sharedVision",
    providesTargetingFor:["ophi_eagle_arc_shot"],
    runtime:{
      visualId:"ophi_eagle",
      race:"ANIMAL",
      archetype:"COMPANION_SCOUT",
      attributes:{str:6,agi:20,int:4,wil:10,vit:8,luk:16},
      combat:{hp:90,atk:0,matk:0,def:28,mdef:45,move:7},
      armorId:"natural_hide",
      weaponIds:{},
      skills:[],
      terrainTraits:["FLYING"],
      verticalMobility:{defaultMode:"FLYING",modes:["FLYING"],canFly:true,flightAltitude:2,maxFlightAltitude:4},
      displacement:{weightClass:"LIGHT"},
      collision:{height:.7},
      visionRange:5,
      resourceRules:{mana:false}
    }
  }
};

export const CompanionDatabase=(()=>{
  function get(id){return COMPANIONS[id]||null}
  function list(ids=[]){return(ids||[]).map(get).filter(Boolean)}
  function forOwner(characterId){return Object.values(COMPANIONS).filter(c=>c.ownerCharacterId===characterId)}
  function ownerHasCompanionRule(owner,rule){
    if(!rule)return true;
    const character=owner?.character||owner;
    return SkillDatabase.passiveList(character?.passives||[]).some(passive=>passive?.companionRules?.[rule]===true);
  }
  function runtimeCharacter(companion,owner){
    if(!companion?.runtime)return null;
    const raw={
      id:`companion:${companion.id}`,
      name:companion.name,
      visualId:companion.runtime.visualId||companion.id,
      faction:owner?.character?.faction||owner?.faction||"COMPANION",
      ...JSON.parse(JSON.stringify(companion.runtime)),
      canAttack:companion.canAttack!==false,
      companionId:companion.id
    };
    return globalThis.EquipmentDatabase?.resolveCharacter?EquipmentDatabase.resolveCharacter(raw):raw;
  }
  function spawnTile(owner,map,units,character){
    if(!owner?.alive||!map?.tiles)return null;
    const occupied=new Set((units||[]).filter(unit=>unit?.alive&&unit.occupiesTile!==false).map(unit=>`${unit.x},${unit.y}`));
    const probe={team:owner.team,character,x:owner.x,y:owner.y,z:owner.z,alive:true};
    return map.tiles
      .map(tile=>({tile,d:Math.abs(tile.x-owner.x)+Math.abs(tile.y-owner.y)}))
      .filter(entry=>entry.d>=1&&entry.d<=3)
      .sort((a,b)=>a.d-b.d||a.tile.y-b.tile.y||a.tile.x-b.tile.x)
      .map(entry=>entry.tile)
      .find(tile=>!occupied.has(`${tile.x},${tile.y}`)&&TacticalEngine.canOccupyTerrain(probe,tile)&&!TacticalEngine.isBlockedByObject(map,tile.x,tile.y,probe))||null;
  }
  function spawnForOwner({owner,map,units}={}){
    if(!owner?.alive||!owner?.character)return[];
    owner.companionRuntime??={};
    const spawned=[];
    for(const companion of list(owner.character.companionIds||[])){
      if(owner.companionRuntime[companion.id])continue;
      const character=runtimeCharacter(companion,owner),tile=spawnTile(owner,map,units,character);
      if(!character||!tile||!globalThis.UnitRuntimeEngine?.createFromCharacter)continue;
      const unit=UnitRuntimeEngine.createFromCharacter({id:`${owner.id}::${companion.id}`,team:owner.team,character,x:tile.x,y:tile.y,map});
      if(!unit)continue;
      unit.unitRole="COMPANION";
      unit.participatesInTurn=companion.participatesInTurn===true;
      unit.occupiesTile=companion.occupiesTile!==false;
      unit.companionId=companion.id;
      unit.ownerUnitId=owner.id;
      unit.countsForObjectives=companion.countsForObjectives===true;
      unit.canCapture=companion.canCapture===true;
      unit.canAttack=companion.canAttack===true;
      unit.deployedRound=owner.deployedRound;
      unit.moved=!!owner.moved;unit.acted=!!owner.acted;unit.waited=!!owner.waited;
      owner.companionRuntime[companion.id]=unit;
      (units||[]).push(unit);spawned.push(unit);
    }
    return spawned;
  }
  function targetingUnit(owner,skillId,companionId=null){
    const character=owner?.character||owner;if(!character)return null;
    for(const companion of list(character.companionIds||[])){
      if(companionId&&companion.id!==companionId)continue;
      if(companion.sharedVision!==true||!(companion.providesTargetingFor||[]).includes(skillId))continue;
      if(!ownerHasCompanionRule(owner,companion.requiresOwnerCompanionRule))continue;
      const runtime=owner?.companionRuntime?.[companion.id];
      if(runtime?.alive)return runtime;
    }
    return null;
  }
  function providesTargeting(owner,skillId,companionId=null){return !!targetingUnit(owner,skillId,companionId)}
  return Object.freeze({get,list,forOwner,ownerHasCompanionRule,runtimeCharacter,spawnForOwner,targetingUnit,providesTargeting});
})();

globalThis.COMPANIONS=COMPANIONS;
globalThis.CompanionDatabase=CompanionDatabase;

export const VerticalMobilityEngine=(()=>{
  const MODE=Object.freeze({
    GROUND:"GROUND",
    WADING:"WADING",
    SWIMMING:"SWIMMING",
    DIVING:"DIVING",
    FLYING:"FLYING",
    BURROWED:"BURROWED",
    WATER_WALK:"WATER_WALK",
    ICE:"ICE",
    SINKING:"SINKING"
  });

  const LAYER=Object.freeze({
    SURFACE:"SURFACE",
    WATER_SURFACE:"WATER_SURFACE",
    UNDERWATER:"UNDERWATER",
    AIR:"AIR",
    UNDERGROUND:"UNDERGROUND"
  });

  const WATER_MODES=new Set([MODE.WADING,MODE.SWIMMING,MODE.DIVING,MODE.SINKING]);
  const VALID_MODES=new Set(Object.values(MODE));
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
  const traitsOf=unit=>new Set(unit?.character?.terrainTraits||[]);
  const profileOf=unit=>unit?.character?.verticalMobility||{};
  const groundZ=tile=>Number(tile?.elevation||0);
  const waterDepth=tile=>Math.max(0,Number(globalThis.HydrologyEngine?.waterDepth?.(tile)??tile?.waterDepth??0));
  const waterSurfaceZ=tile=>{
    const surface=globalThis.HydrologyEngine?.waterSurfaceZ?.(tile);
    return surface==null?(waterDepth(tile)>0?groundZ(tile)+waterDepth(tile):null):Number(surface);
  };
  const surfaceZ=tile=>{
    const water=waterSurfaceZ(tile);
    if(water!=null&&globalThis.ClimateEngine?.isSolidIce?.(tile))return water;
    return water==null?groundZ(tile):Math.max(groundZ(tile),water);
  };

  function capabilities(unit){
    const traits=traitsOf(unit),profile=profileOf(unit),explicit=new Set(profile.modes||profile.allowedModes||[]);
    const modes=new Set([MODE.GROUND,MODE.WADING,MODE.SWIMMING]);
    for(const mode of explicit)if(VALID_MODES.has(mode))modes.add(mode);
    if(traits.has("AQUATIC"))modes.add(MODE.SWIMMING);
    if(traits.has("DIVING")||profile.canDive)modes.add(MODE.DIVING);
    if(traits.has("FLYING")||profile.canFly)modes.add(MODE.FLYING);
    if(traits.has("BURROWING")||profile.canBurrow)modes.add(MODE.BURROWED);
    if(traits.has("WATER_WALK"))modes.add(MODE.WATER_WALK);
    return Object.freeze({
      modes:Object.freeze([...modes]),
      aquaticOnly:traits.has("AQUATIC")&&!traits.has("AMPHIBIOUS"),
      amphibious:traits.has("AMPHIBIOUS"),
      canFly:modes.has(MODE.FLYING),
      canDive:modes.has(MODE.DIVING),
      canBurrow:modes.has(MODE.BURROWED)
    });
  }

  function defaultMode(unit,tile){
    const traits=traitsOf(unit),profile=profileOf(unit),caps=capabilities(unit);
    const requested=String(profile.defaultMode||"").toUpperCase();
    if(VALID_MODES.has(requested)&&caps.modes.includes(requested))return requested;
    if(traits.has("FLYING")&&caps.canFly)return MODE.FLYING;
    if(traits.has("AQUATIC")&&waterDepth(tile)>0)return MODE.SWIMMING;
    return MODE.GROUND;
  }

  function requestedMode(unit,tile){
    const requested=String(unit?.verticalState?.requestedMode||unit?.verticalState?.mode||defaultMode(unit,tile)).toUpperCase();
    return VALID_MODES.has(requested)?requested:MODE.GROUND;
  }

  function waterStateMode(unit,tile){
    if(waterDepth(tile)<=0)return MODE.GROUND;
    const state=String(unit?.waterInteraction?.state||"").toUpperCase();
    if(state==="WATER_WALK")return MODE.WATER_WALK;
    if(state==="ICE")return MODE.ICE;
    if(state==="AQUATIC")return MODE.SWIMMING;
    if(state==="WADING")return MODE.WADING;
    if(state==="SWIMMING")return MODE.SWIMMING;
    if(state==="SINKING")return MODE.SINKING;
    const traits=traitsOf(unit);
    if(traits.has("WATER_WALK"))return MODE.WATER_WALK;
    if(traits.has("AQUATIC"))return MODE.SWIMMING;
    return waterDepth(tile)<2?MODE.WADING:MODE.SWIMMING;
  }

  function effectiveMode(unit,tile,{mode=null}={}){
    const caps=capabilities(unit),requested=String(mode||requestedMode(unit,tile)).toUpperCase();
    if(requested===MODE.FLYING&&caps.canFly)return MODE.FLYING;
    if(requested===MODE.BURROWED&&caps.canBurrow)return MODE.BURROWED;
    if(requested===MODE.DIVING&&caps.canDive&&waterDepth(tile)>0)return MODE.DIVING;
    if(requested===MODE.WATER_WALK&&traitsOf(unit).has("WATER_WALK")&&waterDepth(tile)>0)return MODE.WATER_WALK;
    return waterStateMode(unit,tile);
  }

  function layerForMode(mode){
    if(mode===MODE.FLYING)return LAYER.AIR;
    if(mode===MODE.BURROWED)return LAYER.UNDERGROUND;
    if(mode===MODE.DIVING||mode===MODE.SINKING)return LAYER.UNDERWATER;
    if(mode===MODE.WADING||mode===MODE.SWIMMING)return LAYER.WATER_SURFACE;
    return LAYER.SURFACE;
  }

  function describe(unit,tile,{mode=null,altitude=null,depth=null}={}){
    const profile=profileOf(unit),ground=groundZ(tile),waterDepthValue=waterDepth(tile),waterSurface=waterSurfaceZ(tile),surface=surfaceZ(tile);
    const effective=effectiveMode(unit,tile,{mode});
    const requestedAltitude=altitude??unit?.verticalState?.altitude??profile.flightAltitude??2;
    const maxAltitude=Math.max(0,Number(profile.maxFlightAltitude??requestedAltitude??2));
    const flightAltitude=clamp(requestedAltitude,0,maxAltitude||Number(requestedAltitude||0));
    const requestedDepth=depth??unit?.verticalState?.depth??profile.diveDepth??1.5;
    const maxDive=Math.max(0,Math.min(waterDepthValue,Number(profile.maxDiveDepth??waterDepthValue)));
    const diveDepth=clamp(requestedDepth,0,maxDive);
    const surfaceImmersion=Math.max(0,Number(profile.surfaceImmersion??(traitsOf(unit).has("AQUATIC")?1:.65)));
    const burrowDepth=Math.max(0,Number(unit?.verticalState?.depth??profile.burrowDepth??unit?.character?.collision?.height??2));

    let physicalZ=ground;
    if(effective===MODE.WATER_WALK||effective===MODE.ICE)physicalZ=surface;
    else if(effective===MODE.SWIMMING)physicalZ=Math.max(ground,(waterSurface??ground)-Math.min(waterDepthValue,surfaceImmersion));
    else if(effective===MODE.DIVING)physicalZ=Math.max(ground,(waterSurface??ground)-diveDepth);
    else if(effective===MODE.SINKING)physicalZ=ground;
    else if(effective===MODE.FLYING)physicalZ=surface+flightAltitude;
    else if(effective===MODE.BURROWED)physicalZ=ground-burrowDepth;
    else if(effective===MODE.WADING)physicalZ=ground;

    const immersionDepth=waterSurface==null?0:Math.max(0,waterSurface-physicalZ);
    return Object.freeze({
      mode:effective,
      requestedMode:requestedMode(unit,tile),
      groundZ:ground,
      surfaceZ:surface,
      waterSurfaceZ:waterSurface,
      waterDepth:waterDepthValue,
      altitude:effective===MODE.FLYING?flightAltitude:0,
      depth:effective===MODE.DIVING?diveDepth:effective===MODE.BURROWED?burrowDepth:0,
      immersionDepth,
      physicalZ,
      renderZ:physicalZ,
      layer:layerForMode(effective)
    });
  }

  function verticalSpan(unit,tile){
    const state=describe(unit,tile);
    const height=Math.max(.25,Number(unit?.character?.collision?.height??2));
    return Object.freeze({
      bottom:state.physicalZ,
      top:state.physicalZ+height,
      height,
      center:state.physicalZ+height*.5,
      layer:state.layer,
      mode:state.mode,
      groundZ:state.groundZ,
      waterSurfaceZ:state.waterSurfaceZ
    });
  }

  function syncUnit(unit,tile,options={}){
    if(!unit||!tile)return null;
    const next=describe(unit,tile,options);
    const previous=unit.verticalState||{};
    unit.z=next.physicalZ;
    unit.verticalState={
      requestedMode:options.mode||previous.requestedMode||next.requestedMode,
      mode:next.mode,
      layer:next.layer,
      altitude:next.altitude,
      depth:next.depth,
      immersionDepth:next.immersionDepth,
      groundZ:next.groundZ,
      surfaceZ:next.surfaceZ,
      waterSurfaceZ:next.waterSurfaceZ,
      waterDepth:next.waterDepth,
      physicalZ:next.physicalZ
    };
    return unit.verticalState;
  }

  function initialize(unit,map){
    const tile=map?.tiles?.find(t=>t.x===unit?.x&&t.y===unit?.y)||null;
    if(!tile)return null;
    unit.verticalState={requestedMode:defaultMode(unit,tile)};
    return syncUnit(unit,tile);
  }

  function setMode(unit,tile,mode,{altitude,depth}={}){
    if(!unit||!tile)return{ok:false,reason:"INVALID_TARGET"};
    const normalized=String(mode||"").toUpperCase(),caps=capabilities(unit);
    if(!VALID_MODES.has(normalized))return{ok:false,reason:"UNKNOWN_MODE"};
    if((normalized===MODE.FLYING&&!caps.canFly)||(normalized===MODE.DIVING&&!caps.canDive)||(normalized===MODE.BURROWED&&!caps.canBurrow))return{ok:false,reason:"MODE_NOT_AVAILABLE"};
    if(normalized===MODE.DIVING&&waterDepth(tile)<=0)return{ok:false,reason:"NO_WATER"};
    unit.verticalState={...(unit.verticalState||{}),requestedMode:normalized,...(altitude==null?{}:{altitude:Number(altitude)}),...(depth==null?{}:{depth:Number(depth)})};
    return{ok:true,state:syncUnit(unit,tile,{mode:normalized,altitude,depth})};
  }

  function isMode(unit,...modes){return modes.includes(String(unit?.verticalState?.mode||""));}
  function isAirborne(unit){return isMode(unit,MODE.FLYING);}
  function isBurrowed(unit){return isMode(unit,MODE.BURROWED);}
  function isSubmerged(unit){return isMode(unit,MODE.DIVING,MODE.SINKING)||Number(unit?.verticalState?.immersionDepth||0)>0;}
  function ignoresWaterInteraction(unit){return isAirborne(unit)||isBurrowed(unit);}
  function ignoresCurrent(unit){return isAirborne(unit)||isBurrowed(unit)||isMode(unit,MODE.WATER_WALK,MODE.ICE);}
  function contactsWater(unit){return isMode(unit,MODE.WADING,MODE.SWIMMING,MODE.DIVING,MODE.SINKING)||String(unit?.waterInteraction?.state||"")==="AQUATIC";}
  function contactsGround(unit){return !isAirborne(unit)&&!isBurrowed(unit)&&!isMode(unit,MODE.SWIMMING,MODE.DIVING)&&!isMode(unit,MODE.WATER_WALK);}
  function ignoresFall(unit){return isAirborne(unit)||isBurrowed(unit);}
  function ignoresElevation(unit){return isAirborne(unit)||isBurrowed(unit);}
  function movementIgnoresTerrainCost(unit){return isAirborne(unit)||isBurrowed(unit)||traitsOf(unit).has("AQUATIC");}

  function canOccupyTerrain(unit,tile){
    if(!tile)return false;
    const caps=capabilities(unit),mode=effectiveMode(unit,tile);
    if(mode===MODE.FLYING)return true;
    if(mode===MODE.BURROWED){
      const blocked=new Set(profileOf(unit).burrowBlockedTerrains||["WATER","WALL"]);
      return !blocked.has(tile.terrain);
    }
    if(caps.aquaticOnly)return waterDepth(tile)>0;
    return globalThis.TERRAINS?.[tile.terrain]?.passable!==false;
  }

  function objectBlocks(unit,tile,object){
    if(!object||object.destroyed||object.blocksMovement!==true)return false;
    const state=describe(unit,tile);
    if(state.mode===MODE.FLYING){
      const height=Number(object.collisionHeight??99);
      return state.physicalZ<=groundZ(tile)+height;
    }
    if(state.mode===MODE.BURROWED){
      if(object.blocksBurrowing===true)return true;
      const type=String(object.type||object.material||"").toUpperCase();
      return type.includes("ROCK")||type.includes("STONE")||type.includes("WALL");
    }
    return true;
  }

  function traversalZ(unit,tile){return describe(unit,tile).physicalZ;}
  function eyeZ(unit,tile){
    const state=describe(unit,tile),height=Math.max(.5,Number(unit?.character?.collision?.height??2));
    return state.physicalZ+height*.5;
  }

  return Object.freeze({
    MODE,LAYER,capabilities,defaultMode,effectiveMode,layerForMode,describe,verticalSpan,syncUnit,initialize,setMode,
    isAirborne,isBurrowed,isSubmerged,ignoresWaterInteraction,ignoresCurrent,contactsWater,contactsGround,
    ignoresFall,ignoresElevation,movementIgnoresTerrainCost,canOccupyTerrain,objectBlocks,traversalZ,eyeZ,
    groundZ,waterDepth,waterSurfaceZ,surfaceZ
  });
})();
globalThis.VerticalMobilityEngine=VerticalMobilityEngine;

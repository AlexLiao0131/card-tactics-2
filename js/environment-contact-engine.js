export const EnvironmentContactEngine=(()=>{
  const PROFILE=Object.freeze({
    SURFACE:"SURFACE",
    SURFACE_FLOW:"SURFACE_FLOW",
    WATER_VOLUME:"WATER_VOLUME",
    AIR_COLUMN:"AIR_COLUMN",
    GROUND_SHOCK:"GROUND_SHOCK",
    ALL:"ALL"
  });

  const LAYER=Object.freeze({
    SURFACE:"SURFACE",
    WATER_SURFACE:"WATER_SURFACE",
    UNDERWATER:"UNDERWATER",
    AIR:"AIR",
    UNDERGROUND:"UNDERGROUND"
  });

  const EPSILON=.0001;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
  const groundZ=tile=>Number(globalThis.VerticalMobilityEngine?.groundZ?.(tile)??tile?.elevation??0);
  const waterSurfaceZ=tile=>{
    const value=globalThis.VerticalMobilityEngine?.waterSurfaceZ?.(tile)??globalThis.HydrologyEngine?.waterSurfaceZ?.(tile);
    return value==null?null:Number(value);
  };
  const surfaceZ=tile=>Number(globalThis.VerticalMobilityEngine?.surfaceZ?.(tile)??waterSurfaceZ(tile)??groundZ(tile));

  function layerOf(unit,tile){
    const state=globalThis.VerticalMobilityEngine?.describe?.(unit,tile);
    const layer=String(state?.layer||unit?.verticalState?.layer||"").toUpperCase();
    if(Object.values(LAYER).includes(layer))return layer;
    const mode=String(state?.mode||unit?.verticalState?.mode||"GROUND").toUpperCase();
    if(mode==="FLYING")return LAYER.AIR;
    if(mode==="BURROWED")return LAYER.UNDERGROUND;
    if(mode==="DIVING"||mode==="SINKING")return LAYER.UNDERWATER;
    if(mode==="WADING"||mode==="SWIMMING")return LAYER.WATER_SURFACE;
    return LAYER.SURFACE;
  }

  function unitVolume(unit,tile){
    const span=globalThis.VerticalMobilityEngine?.verticalSpan?.(unit,tile);
    if(span)return span;
    const bottom=Number(unit?.z??groundZ(tile));
    const height=Math.max(.25,Number(unit?.character?.collision?.height??2));
    return{bottom,top:bottom+height,height,layer:layerOf(unit,tile)};
  }

  function allowedLayers(profile){
    switch(profile){
      case PROFILE.SURFACE:return new Set([LAYER.SURFACE]);
      case PROFILE.SURFACE_FLOW:return new Set([LAYER.SURFACE,LAYER.WATER_SURFACE]);
      case PROFILE.WATER_VOLUME:return new Set([LAYER.WATER_SURFACE,LAYER.UNDERWATER]);
      case PROFILE.AIR_COLUMN:return new Set([LAYER.SURFACE,LAYER.WATER_SURFACE,LAYER.AIR]);
      case PROFILE.GROUND_SHOCK:return new Set([LAYER.SURFACE,LAYER.UNDERGROUND]);
      case PROFILE.ALL:return new Set(Object.values(LAYER));
      default:return new Set([LAYER.SURFACE]);
    }
  }

  function flowHeight(source={}){
    const explicit=Number(source.verticalHeight??source.flowHeight);
    if(Number.isFinite(explicit)&&explicit>0)return explicit;
    const mass=Math.max(0,Number(source.mass||0));
    return clamp(.75+mass*.35,.75,2.25);
  }

  function volumeFor(tile,profile,source={}){
    if(!tile)return null;
    const ground=groundZ(tile),water=waterSurfaceZ(tile),surface=surfaceZ(tile);
    switch(profile){
      case PROFILE.SURFACE:{
        const height=Math.max(.2,Number(source.verticalHeight??source.height??1.2));
        return{minZ:ground,maxZ:ground+height,profile};
      }
      case PROFILE.SURFACE_FLOW:
        return{minZ:ground,maxZ:ground+flowHeight(source),profile};
      case PROFILE.WATER_VOLUME:
        return water==null||water<=ground+EPSILON?null:{minZ:ground,maxZ:water,profile};
      case PROFILE.AIR_COLUMN:{
        const height=Math.max(2,Number(source.verticalHeight??source.height??(Number(source.lift||0)+3)??6));
        return{minZ:ground,maxZ:Math.max(surface,ground)+height,profile};
      }
      case PROFILE.GROUND_SHOCK:{
        const above=Math.max(.25,Number(source.aboveGround??.75));
        const below=Math.max(.25,Number(source.belowGround??2));
        return{minZ:ground-below,maxZ:ground+above,profile};
      }
      case PROFILE.ALL:
        return{minZ:-Infinity,maxZ:Infinity,profile};
      default:return null;
    }
  }

  function overlaps(a,b){return !!a&&!!b&&Number(a.top)>Number(b.minZ)+EPSILON&&Number(a.bottom)<Number(b.maxZ)-EPSILON;}

  function contacts(unit,tile,profile,source={}){
    if(!unit?.alive||!tile)return false;
    const normalized=String(profile||PROFILE.SURFACE).toUpperCase();
    const body=unitVolume(unit,tile),layer=layerOf(unit,tile);
    if(!allowedLayers(normalized).has(layer))return false;
    const volume=volumeFor(tile,normalized,source);
    return overlaps(body,volume);
  }

  function profileForEffect(effect={}){
    if(effect.contactProfile&&PROFILE[effect.contactProfile])return PROFILE[effect.contactProfile];
    switch(String(effect.type||"").toUpperCase()){
      case "BURNING":return PROFILE.SURFACE;
      case "BOILING":
      case "ELECTRIFIED":
      case "CURRENT":return PROFILE.WATER_VOLUME;
      case "TORNADO":
      case "FIRE_TORNADO":return PROFILE.AIR_COLUMN;
      case "FRAGMENTS":return PROFILE.SURFACE;
      default:return null;
    }
  }

  function profileForEvent(event={}){
    if(event.contactProfile&&PROFILE[event.contactProfile])return PROFILE[event.contactProfile];
    switch(String(event.type||"").toUpperCase()){
      case "MASS_FLOW":
      case "AVALANCHE":return PROFILE.SURFACE_FLOW;
      case "ELECTRIC_CONDUCTION":
      case "WATER_BOILING":
      case "WATER_EVAPORATION":
      case "RIVER_SURGE":return PROFILE.WATER_VOLUME;
      case "TORNADO_CREATED":
      case "FIRE_TORNADO_CREATED":return PROFILE.AIR_COLUMN;
      default:return null;
    }
  }

  function effectContacts(unit,tile,effect){const profile=profileForEffect(effect);return profile?contacts(unit,tile,profile,effect):true;}
  function eventContacts(unit,tile,event){const profile=profileForEvent(event);return profile?contacts(unit,tile,profile,event):true;}

  return Object.freeze({
    PROFILE,LAYER,layerOf,unitVolume,volumeFor,contacts,
    profileForEffect,profileForEvent,effectContacts,eventContacts
  });
})();
globalThis.EnvironmentContactEngine=EnvironmentContactEngine;

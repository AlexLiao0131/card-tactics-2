export const ClimateEngine=(()=>{
  "use strict";

  const WEATHER=Object.freeze({SNOW:"SNOW",BLIZZARD:"BLIZZARD",SCORCHING_SUN:"SCORCHING_SUN",TYPHOON:"TYPHOON"});
  const SAFE_ICE=Object.freeze({LIGHT:.45,MEDIUM:.7,HEAVY:1,IMMOVABLE:1.2});
  const CFG=Object.freeze({
    SCORCHING_SUN:{temperature:28,snowRate:0,flow:.95,melt:1.15,evaporation:2.75,extraDrying:1.5},
    CLEAR:{temperature:7,snowRate:0,flow:1,melt:.25},
    FOG:{temperature:5,snowRate:0,flow:1,melt:.12},
    RAIN:{temperature:6,snowRate:0,flow:1.35,melt:.55},
    HEAVY_RAIN:{temperature:7,snowRate:0,flow:2,melt:.8},
    THUNDERSTORM:{temperature:8,snowRate:0,flow:2.2,melt:.9},
    TYPHOON:{temperature:9,snowRate:0,flow:2.65,melt:1.0},
    SNOW:{temperature:-3,snowRate:.35,flow:.85,melt:0},
    BLIZZARD:{temperature:-8,snowRate:.75,flow:.65,melt:0}
  });
  const key=(x,y)=>`${x},${y}`;
  const tileAt=(map,x,y)=>map?.tiles?.find(t=>t.x===x&&t.y===y)||null;
  const clean=n=>Math.max(0,Math.round(Number(n||0)*1000)/1000);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
  const weightClass=unit=>window.DisplacementEngine?.weightClass?.(unit)||"LIGHT";
  const isFrozen=tile=>Number(tile?.iceThickness||0)>=.25&&Number(tile?.waterDepth||0)>0;
  const isSolidIce=tile=>Number(tile?.iceThickness||0)>=.45&&Number(tile?.waterDepth||0)>0;
  const snowDepth=tile=>Math.max(0,Number(tile?.snowDepth||0));
  const iceThickness=tile=>Math.max(0,Number(tile?.iceThickness||0));
  // Snow depth is geometric cover, not liquid water. SWE is a conserved water-volume
  // store; legacy maps without it retain their historical 1:1 snow-depth volume.
  const snowWaterEquivalent=tile=>Math.max(0,Number(tile?.snowWaterEquivalent??tile?.snowDepth??0));
  const volumeRound=n=>Math.max(0,Math.round(Number(n||0)*1e6)/1e6);
  // Consume exactly the water-equivalent share of the snow removed, whether
  // thawed by weather or fire. Never use the removed visual thickness as water.
  function meltSnow(tile,removedDepth){
    const before=snowDepth(tile),stored=snowWaterEquivalent(tile);
    const removed=Math.min(before,Math.max(0,Number(removedDepth||0)));
    if(removed<=0)return{depth:0,water:0};
    const remaining=volumeRound(stored*(before-removed)/before);
    tile.snowDepth=clean(before-removed);
    tile.snowWaterEquivalent=tile.snowDepth>0?remaining:0;
    return{depth:removed,water:volumeRound(stored-tile.snowWaterEquivalent)};
  }
  // The climate's HEAT channel describes a sustained hot-weather condition,
  // not a lamp that remains above the battlefield after sunset. Radiation is
  // derived from the ONE existing day/night clock; it owns no separate timer.
  // Clouds and atmospheric mist attenuate incoming sunlight for every caller.
  function solarExposure(state){
    if(state?.timeOfDay==="NIGHT")return 0;
    if(precipitationType(state)!=="NONE")return .25;
    if(fogIntensity(state)>0)return .55;
    return 1;
  }
  function solarHeat(state){return Math.max(0,Number(state?.climate?.heat?.intensity||0))*solarExposure(state);}
  // Air and stored ground heat can remain after sunset. Unlike solar radiation,
  // this is a temperature calculation and can still drive slow evaporation or
  // melting at night. Clouds limit overnight cooling.
  function diurnalCooling(state){
    if(state?.timeOfDay!=="NIGHT")return 0;
    if(precipitationType(state)!=="NONE")return 2;
    if(fogIntensity(state)>0)return 3;
    return 6;
  }
  function evaporationExposure(state,map=null){
    const daylight=state?.timeOfDay==="NIGHT"?.38:1.20;
    const heat=solarHeat(state);
    const airTemperature=temperatureAt(state,{elevation:0});
    const residualWarmth=Math.max(0,airTemperature-10)*.008;
    const cloud=precipitationType(state)!=="NONE"?.45:fogIntensity(state)>0?.60:1;
    const wind=Math.min(1.25,1+windStrength(state)*.025);
    const turn=Math.max(0,Number(state?.climate?.turn||0));
    // Smooth small fluctuations; do not re-roll evaporation independently for
    // each tile or make evaporation change wildly between adjacent turns.
    const phase=(Number(map?.seed||0)>>>0)*.00000013;
    const variation=.95+.05*Math.sin(turn*.65+phase);
    return Math.max(.04,daylight*(1+heat*1.75+residualWarmth)*cloud*wind*variation);
  }
  function precipitationType(state){
    const type=state?.climate?.precipitation?.type;
    if(type)return type;
    if(state?.weather===WEATHER.SNOW||state?.weather===WEATHER.BLIZZARD)return"SNOW";
    if(state?.weather==="HEAVY_RAIN"||state?.weather==="THUNDERSTORM"||state?.weather==="TYPHOON")return"HEAVY_RAIN";
    if(state?.weather==="RAIN")return"RAIN";
    return"NONE";
  }
  function windStrength(state){
    // Read the same meteorological wind as all water, weather and scene clients.
    // Climate.wind remains the prevailing wind; temporary storm pressure is
    // derived by EnvironmentEngine from the active atmospheric channels.
    return Math.max(0,Number(globalThis.EnvironmentEngine?.windAt?.(state)?.strength??state?.climate?.wind?.strength??state?.wind?.strength??0));
  }
  function thunderIntensity(state){return Math.max(0,Number(state?.climate?.thunder?.intensity??((state?.weather==="THUNDERSTORM"||state?.weather==="TYPHOON")?1:0)));}
  function fogIntensity(state){return Math.max(0,Number(state?.climate?.fog?.intensity??(state?.weather==="FOG"?1:0)));}
  const isSnowWeather=state=>precipitationType(state)==="SNOW";
  const isBlizzard=state=>isSnowWeather(state)&&windStrength(state)>=1.75;
  function config(state){
    const precipitation=precipitationType(state);
    if(precipitation==="SNOW")return isBlizzard(state)?CFG.BLIZZARD:CFG.SNOW;
    if(precipitation==="HEAVY_RAIN"){if(thunderIntensity(state)>0&&windStrength(state)>=5.5)return CFG.TYPHOON;return thunderIntensity(state)>0?CFG.THUNDERSTORM:CFG.HEAVY_RAIN;}
    if(precipitation==="RAIN")return CFG.RAIN;
    if(fogIntensity(state)>0)return CFG.FOG;
    if(Number(state?.climate?.heat?.intensity||0)>0){
      // Only the solar share of hot weather amplifies snowmelt and bare-soil
      // drying. Ambient warmth remains in temperatureAt after sunset.
      const irradiance=solarHeat(state);
      return{...CFG.SCORCHING_SUN,
        melt:CFG.CLEAR.melt+(CFG.SCORCHING_SUN.melt-CFG.CLEAR.melt)*irradiance,
        extraDrying:1+(CFG.SCORCHING_SUN.extraDrying-1)*irradiance};
    }
    return CFG.CLEAR;
  }
  function temperatureAt(state,tile){
    const explicit=state?.climate?.temperature??state?.temperature;
    const base=explicit!=null&&Number.isFinite(Number(explicit))?Number(explicit):config(state).temperature;
    return base-diurnalCooling(state)-Math.max(0,Number(tile?.elevation||0))*.9;
  }
  function ensureState(state){if(!state)return;state.climate??={turn:0};state.climate.turn=Math.max(0,Number(state.climate.turn||0));state.effects??=new Map();}
  function visualEffect(state,tile,type,present,extra={}){
    if(!state?.effects||!tile)return;const k=key(tile.x,tile.y),list=state.effects.get(k)||[],idx=list.findIndex(e=>e.type===type);
    if(present){const effect={type,duration:null,visualOnly:true,...extra,x:tile.x,y:tile.y};if(idx>=0)list[idx]=effect;else list.push(effect);state.effects.set(k,list);}
    else if(idx>=0){list.splice(idx,1);if(list.length)state.effects.set(k,list);else state.effects.delete(k);}
  }
  // Climate modifies current speed and source recharge; it never invents Q.
  // Hydrology owns the formal river discharge once its route is initialized.
  function riverDischarge(tile){
    if(tile?.hydrologyOutflowRate!=null)return Math.max(0,Number(tile.hydrologyOutflowRate||0));
    return Math.max(0,Number(tile?.discharge??tile?.baseDischarge??0));
  }
  function hasActualCurrent(tile){
    return Number(tile?.waterDepth||0)>.0001&&
      (riverDischarge(tile)>.0001||Object.values(tile?.hydrologyEdgeOutflows||{}).some(edge=>Number(edge?.rate||0)>.0001));
  }
  function syncTileVisuals(state,tile){
    visualEffect(state,tile,"SNOW",snowDepth(tile)>=.15,{depth:snowDepth(tile)});
    visualEffect(state,tile,"ICE",isFrozen(tile),{thickness:iceThickness(tile)});
    visualEffect(state,tile,"CURRENT",!!tile?.river&&hasActualCurrent(tile)&&Number(tile.flowSpeed||0)>=.85&&!isSolidIce(tile),{speed:Number(tile.flowSpeed||0),flowX:Number(tile.flowX||0),flowY:Number(tile.flowY||0)});
  }
  function initializeMap(map,state){ensureState(state);for(const tile of map?.tiles||[]){tile.snowWaterEquivalent=volumeRound(snowWaterEquivalent(tile));tile.snowDepth=clean(tile.snowDepth);tile.iceThickness=clean(Math.min(iceThickness(tile),Math.max(0,Number(tile.waterDepth||0))));if(tile.river){tile.baseFlowSpeed=Number(tile.baseFlowSpeed||.62);tile.flowSpeed=Number(tile.flowSpeed||tile.baseFlowSpeed);tile.baseDischarge=Number(tile.baseDischarge||tile.discharge||1);tile.discharge=riverDischarge(tile);}syncTileVisuals(state,tile);}return map;}

  function legacyWeather(state){return window.EnvironmentEngine?.legacyWeather?.(state)||state?.weather||"CLEAR";}
  function updateRiverFlow(map,state,events=[]){
    const mult=config(state).flow;let count=0,maxSpeed=0;
    for(const tile of map?.tiles||[]){if(!tile.river)continue;const depth=Math.max(.1,Number(tile.waterDepth||0)),depthFactor=1+Math.max(0,depth-1)*.25;tile.flowSpeed=clean(Number(tile.baseFlowSpeed||.62)*mult*depthFactor);
      // For an initialized hydrology river, the routed Q is authoritative.
      // Changing weather must not replace it with a cosmetic baseDischarge.
      if(tile.hydrologyOutflowRate!=null)tile.discharge=clean(riverDischarge(tile));
      else tile.discharge=clean(Math.max(.2,Number(tile.baseDischarge||1))*mult*depthFactor);
      maxSpeed=Math.max(maxSpeed,tile.flowSpeed);count++;syncTileVisuals(state,tile);}
    if(count&&mult>=1.8)events.push({type:"RIVER_SURGE",tiles:count,maxSpeed,weather:legacyWeather(state)});
  }

  function addMeltWater(map,tile,amount,events,source){
    if(amount<=0)return 0;
    const retainedD=HydrologyEngine.addWater(tile,amount,events);
    events.push({type:"SNOWMELT_WATER",x:tile.x,y:tile.y,amount,source});
    return retainedD;
  }

  function advance(map,state){
    const events=[];if(!map||!state)return events;ensureState(state);state.climate.turn=Number(state.climate.turn||0)+1;const cfg=config(state),blizzard=isBlizzard(state);
    updateRiverFlow(map,state,events);
    let changedWater=false,snowChanged=0,iceChanged=0,totalMelt=0,snowfallWater=0,maxSnow=0,maxIce=0;const hydroEvents=[];
    for(const tile of map.tiles||[]){
      const temp=temperatureAt(state,tile),beforeSnow=snowDepth(tile),beforeIce=iceThickness(tile);
      if(isSnowWeather(state)){
        const altitudeBonus=Math.max(0,Number(tile.elevation||0))*.035;
        if(Number(tile.waterDepth||0)>0&&temp<=0)
          tile.iceThickness=clean(Math.min(Number(tile.waterDepth),beforeIce+(blizzard ? .42 : .22)));
        const canSettle=Number(tile.waterDepth||0)<=0||isSolidIce(tile);
        if(canSettle){
          const added=cfg.snowRate+altitudeBonus;
          tile.snowDepth=clean(beforeSnow+added);
          // Shared existing rain-volume unit is the water reference. The
          // authored snowRate controls visual accumulation only; its ratio
          // to ordinary snowfall carries storm and altitude intensification.
          const water=volumeRound(Number(HydrologyEngine.RAIN_FILL_PER_EVENT)*(added/CFG.SNOW.snowRate));
          tile.snowWaterEquivalent=volumeRound(snowWaterEquivalent(tile)+water);
          snowfallWater+=water;
        }
      }else if(temp>0){
        if(beforeSnow>0){
          const melted=meltSnow(tile,Math.min(beforeSnow,cfg.melt+Math.max(0,temp)*.015));
          if(melted.water>0){
            const retainedD=HydrologyEngine.addWater(tile,melted.water,hydroEvents);
            changedWater=changedWater||retainedD>HydrologyEngine.EPSILON;
            totalMelt+=melted.water;
          }
        }
        if(beforeIce>0){
          const meltIce=Math.min(beforeIce,cfg.melt*.55+Math.max(0,temp)*.01);
          // waterDepth is the TOTAL column (ice is an immobile subset), so
          // thaw frees mobile water without adding any new water volume.
          tile.iceThickness=clean(beforeIce-meltIce);
        }
      }
      if(Math.abs(snowDepth(tile)-beforeSnow)>.0001)snowChanged++;
      if(Math.abs(iceThickness(tile)-beforeIce)>.0001)iceChanged++;
      maxSnow=Math.max(maxSnow,snowDepth(tile));maxIce=Math.max(maxIce,iceThickness(tile));syncTileVisuals(state,tile);
    }
    if(snowfallWater>0)events.push({type:"SNOW_PRECIPITATION_WATER_INPUT",volume:volumeRound(snowfallWater),source:"SNOW",weather:legacyWeather(state)});
    if(changedWater){HydrologyEngine.redistribute(map,{source:"SNOW_MELT",events:hydroEvents});events.push(...hydroEvents);events.push({type:"CLIMATE_WATER_CHANGED",source:"SNOW_MELT",meltVolume:clean(totalMelt),changedTiles:snowChanged});}

    if(precipitationType(state)==="NONE"&&window.HydrologyEngine?.evaporateUnfedWater){
      const evaporation=HydrologyEngine.evaporateUnfedWater(map,{
        amount:Number(HydrologyEngine.EVAPORATION_PER_CLEAR_TURN||.06)*evaporationExposure(state,map),
        source:"CLIMATE_EVAPORATION"
      });
      events.push(...evaporation);
    }

    const weather=legacyWeather(state);
    if(snowChanged)events.push({type:isSnowWeather(state)?"SNOWFALL":"SNOW_THAW",changedTiles:snowChanged,maxSnow:clean(maxSnow),meltVolume:clean(totalMelt),weather});
    if(iceChanged)events.push({type:isSnowWeather(state)?"FREEZE_PULSE":"ICE_THAW",changedTiles:iceChanged,maxIce:clean(maxIce),weather});
    return events;
  }

  function iceThreshold(unit){return Number(SAFE_ICE[weightClass(unit)]??SAFE_ICE.LIGHT);}
  function iceSupports(unit,tile){return isFrozen(tile)&&iceThickness(tile)>=iceThreshold(unit);}
  function resolveIceStep(unit,tile){
    if(!unit||!tile||!isFrozen(tile))return{frozen:false,supported:false,broke:false};
    const threshold=iceThreshold(unit),thickness=iceThickness(tile),supported=thickness>=threshold;
    if(supported)return{frozen:true,supported:true,broke:false,thickness,threshold,weight:weightClass(unit)};
    // Fracture releases this frozen fraction to the same water column.
    tile.iceThickness=0;return{frozen:true,supported:false,broke:true,thickness,threshold,weight:weightClass(unit)};
  }

  function currentForce(tile,state=null){
    if(!tile?.river||!hasActualCurrent(tile)||isSolidIce(tile))return null;
    const speed=Number(tile.flowSpeed||tile.baseFlowSpeed||0);if(speed<.85)return null;
    const distance=speed>=2.5?3:speed>=1.7?2:1;return{distance,speed,discharge:riverDischarge(tile),flowX:Number(tile.flowX||0),flowY:Number(tile.flowY||0)};
  }

  function applyHeat(map,state,x,y,{heavy=false}={}){
    const events=[],tile=tileAt(map,x,y);if(!tile)return events;const snow=snowDepth(tile),ice=iceThickness(tile);let changedWater=false;
    const snowMelt=Math.min(snow,heavy?2:1);if(snowMelt>0){
      const melted=meltSnow(tile,snowMelt);
      changedWater=addMeltWater(map,tile,melted.water,events,heavy?"HEAVY_FIRE":"FIRE")>HydrologyEngine.EPSILON;
      events.push({type:"SNOW_MELT",x,y,from:snow,to:tile.snowDepth,waterEquivalent:melted.water,heat:heavy?2:1});
    }
    const iceMelt=Math.min(ice,heavy?1.2:.55);if(iceMelt>0){tile.iceThickness=clean(ice-iceMelt);events.push({type:"ICE_MELT",x,y,amount:iceMelt,remaining:tile.iceThickness,heat:heavy?2:1});}
    if(changedWater)HydrologyEngine.redistribute(map,{source:"HEAT_MELT",events});syncTileVisuals(state,tile);return events;
  }

  function triggerAvalanche(map,x,y,{strength=1,source="SHOCK",state=null}={}){
    if(!map||!window.MassFlowEngine)return[];let start=tileAt(map,x,y);
    if(!start||snowDepth(start)<.6){
      const near=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const t=tileAt(map,x+dx,y+dy);if(t&&snowDepth(t)>=.6)near.push(t);}near.sort((a,b)=>Number(b.elevation||0)-Number(a.elevation||0)||snowDepth(b)-snowDepth(a));start=near[0]||null;
    }
    if(!start||snowDepth(start)<.6)return[];
    const releaseRatio=clamp(.55+Math.max(0,Number(strength||1))*.16,.55,1),released=Math.min(snowDepth(start),Math.max(.6,snowDepth(start)*releaseRatio));
    const flow=MassFlowEngine.trace(map,start,"SNOW",released,{maxSteps:Math.min(12,Number(map.width||0)+Number(map.height||0))});
    if(!flow||flow.path.length<2)return[];
    const events=[];MassFlowEngine.apply(map,flow,{events,source});
    for(const p of flow.path){const t=tileAt(map,p.x,p.y);if(t&&state)syncTileVisuals(state,t);}
    const damage=Math.round((18+flow.mass*18)*Math.max(.75,Math.min(1.5,Number(strength||1)))),forceDistance=Math.max(1,Math.min(3,Math.round(flow.mass/1.4)));
    events.push(MassFlowEngine.event(flow,{type:"AVALANCHE",source,damage,forceDistance,extra:{strength:Number(strength||1)}}));
    return events;
  }

  return Object.freeze({WEATHER,SAFE_ICE,CFG,config,solarExposure,solarHeat,evaporationExposure,initializeMap,advance,temperatureAt,isSnowWeather,isBlizzard,snowDepth,snowWaterEquivalent,meltSnow,iceThickness,isFrozen,isSolidIce,iceThreshold,iceSupports,resolveIceStep,currentForce,applyHeat,triggerAvalanche,syncTileVisuals});
})();
globalThis.ClimateEngine=ClimateEngine;

export const ClimateEngine=(()=>{
  "use strict";

  const WEATHER=Object.freeze({SNOW:"SNOW",BLIZZARD:"BLIZZARD"});
  const SAFE_ICE=Object.freeze({LIGHT:.45,MEDIUM:.7,HEAVY:1,IMMOVABLE:1.2});
  const CFG=Object.freeze({
    CLEAR:{temperature:7,snowRate:0,flow:1,melt:.25},
    FOG:{temperature:5,snowRate:0,flow:1,melt:.12},
    RAIN:{temperature:6,snowRate:0,flow:1.35,melt:.55},
    HEAVY_RAIN:{temperature:7,snowRate:0,flow:2,melt:.8},
    THUNDERSTORM:{temperature:8,snowRate:0,flow:2.2,melt:.9},
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
  const isSnowWeather=state=>state?.weather===WEATHER.SNOW||state?.weather===WEATHER.BLIZZARD;

  function config(state){return CFG[state?.weather]||CFG.CLEAR;}
  function temperatureAt(state,tile){return Number(state?.temperature??config(state).temperature)-Math.max(0,Number(tile?.elevation||0))*.9;}
  function ensureState(state){if(!state)return;state.climate??={turn:0};state.effects??=new Map();}
  function visualEffect(state,tile,type,present,extra={}){
    if(!state?.effects||!tile)return;const k=key(tile.x,tile.y),list=state.effects.get(k)||[],idx=list.findIndex(e=>e.type===type);
    if(present){const effect={type,duration:null,visualOnly:true,...extra,x:tile.x,y:tile.y};if(idx>=0)list[idx]=effect;else list.push(effect);state.effects.set(k,list);}
    else if(idx>=0){list.splice(idx,1);if(list.length)state.effects.set(k,list);else state.effects.delete(k);}
  }
  function syncTileVisuals(state,tile){
    visualEffect(state,tile,"SNOW",snowDepth(tile)>=.15,{depth:snowDepth(tile)});
    visualEffect(state,tile,"ICE",isFrozen(tile),{thickness:iceThickness(tile)});
    visualEffect(state,tile,"CURRENT",!!tile?.river&&Number(tile.flowSpeed||0)>=.85&&!isSolidIce(tile),{speed:Number(tile.flowSpeed||0),flowX:Number(tile.flowX||0),flowY:Number(tile.flowY||0)});
  }
  function initializeMap(map,state){ensureState(state);for(const tile of map?.tiles||[]){tile.snowDepth=clean(tile.snowDepth);tile.iceThickness=clean(tile.iceThickness);if(tile.river){tile.baseFlowSpeed=Number(tile.baseFlowSpeed||.62);tile.flowSpeed=Number(tile.flowSpeed||tile.baseFlowSpeed);tile.baseDischarge=Number(tile.baseDischarge||tile.discharge||1);tile.discharge=Number(tile.discharge||tile.baseDischarge);}syncTileVisuals(state,tile);}return map;}

  function updateRiverFlow(map,state,events=[]){
    const mult=config(state).flow;let count=0,maxSpeed=0;
    for(const tile of map?.tiles||[]){if(!tile.river)continue;const depth=Math.max(.1,Number(tile.waterDepth||0)),depthFactor=1+Math.max(0,depth-1)*.25;tile.flowSpeed=clean(Number(tile.baseFlowSpeed||.62)*mult*depthFactor);tile.discharge=clean(Math.max(.2,Number(tile.baseDischarge||1))*mult*depthFactor);maxSpeed=Math.max(maxSpeed,tile.flowSpeed);count++;syncTileVisuals(state,tile);}
    if(count&&mult>=1.8)events.push({type:"RIVER_SURGE",tiles:count,maxSpeed,weather:state?.weather});
  }

  function addMeltWater(map,tile,amount,events,source){
    if(amount<=0)return;window.HydrologyEngine?.addWater?.(tile,amount,events);events.push({type:"SNOWMELT_WATER",x:tile.x,y:tile.y,amount,source});
  }

  function advance(map,state){
    const events=[];if(!map||!state)return events;ensureState(state);state.climate.turn=Number(state.climate.turn||0)+1;const cfg=config(state);
    updateRiverFlow(map,state,events);
    let changedWater=false,snowChanged=0,iceChanged=0,totalMelt=0,maxSnow=0,maxIce=0;const hydroEvents=[];
    for(const tile of map.tiles||[]){
      const temp=temperatureAt(state,tile),beforeSnow=snowDepth(tile),beforeIce=iceThickness(tile);
      if(isSnowWeather(state)){
        const altitudeBonus=Math.max(0,Number(tile.elevation||0))*.035;
        if(Number(tile.waterDepth||0)>0&&temp<=0)tile.iceThickness=clean(beforeIce+(state.weather===WEATHER.BLIZZARD?.42:.22));
        const canSettle=Number(tile.waterDepth||0)<=0||isSolidIce(tile);if(canSettle)tile.snowDepth=clean(beforeSnow+cfg.snowRate+altitudeBonus);
      }else if(temp>0){
        if(beforeSnow>0){const melt=Math.min(beforeSnow,cfg.melt+Math.max(0,temp)*.015);tile.snowDepth=clean(beforeSnow-melt);if(melt>0){window.HydrologyEngine?.addWater?.(tile,melt,hydroEvents);changedWater=true;totalMelt+=melt;}}
        if(beforeIce>0){const meltIce=Math.min(beforeIce,cfg.melt*.55+Math.max(0,temp)*.01);tile.iceThickness=clean(beforeIce-meltIce);}
      }
      if(Math.abs(snowDepth(tile)-beforeSnow)>.0001)snowChanged++;
      if(Math.abs(iceThickness(tile)-beforeIce)>.0001)iceChanged++;
      maxSnow=Math.max(maxSnow,snowDepth(tile));maxIce=Math.max(maxIce,iceThickness(tile));syncTileVisuals(state,tile);
    }
    if(changedWater){HydrologyEngine.redistribute(map,{source:"SNOW_MELT",events:hydroEvents});events.push(...hydroEvents);events.push({type:"CLIMATE_WATER_CHANGED",source:"SNOW_MELT",meltVolume:clean(totalMelt),changedTiles:snowChanged});}
    if(snowChanged)events.push({type:isSnowWeather(state)?"SNOWFALL":"SNOW_THAW",changedTiles:snowChanged,maxSnow:clean(maxSnow),meltVolume:clean(totalMelt),weather:state.weather});
    if(iceChanged)events.push({type:isSnowWeather(state)?"FREEZE_PULSE":"ICE_THAW",changedTiles:iceChanged,maxIce:clean(maxIce),weather:state.weather});
    return events;
  }

  function iceThreshold(unit){return Number(SAFE_ICE[weightClass(unit)]??SAFE_ICE.LIGHT);}
  function iceSupports(unit,tile){return isFrozen(tile)&&iceThickness(tile)>=iceThreshold(unit);}
  function resolveIceStep(unit,tile){
    if(!unit||!tile||!isFrozen(tile))return{frozen:false,supported:false,broke:false};
    const threshold=iceThreshold(unit),thickness=iceThickness(tile),supported=thickness>=threshold;
    if(supported)return{frozen:true,supported:true,broke:false,thickness,threshold,weight:weightClass(unit)};
    tile.iceThickness=0;return{frozen:true,supported:false,broke:true,thickness,threshold,weight:weightClass(unit)};
  }

  function currentForce(tile,state=null){
    if(!tile?.river||isSolidIce(tile))return null;const speed=Number(tile.flowSpeed||tile.baseFlowSpeed||0);if(speed<.85)return null;
    const distance=speed>=2.5?3:speed>=1.7?2:1;return{distance,speed,discharge:Number(tile.discharge||1),flowX:Number(tile.flowX||0),flowY:Number(tile.flowY||1)};
  }

  function applyHeat(map,state,x,y,{heavy=false}={}){
    const events=[],tile=tileAt(map,x,y);if(!tile)return events;const snow=snowDepth(tile),ice=iceThickness(tile);let changedWater=false;
    const snowMelt=Math.min(snow,heavy?2:1);if(snowMelt>0){tile.snowDepth=clean(snow-snowMelt);addMeltWater(map,tile,snowMelt,events,heavy?"HEAVY_FIRE":"FIRE");changedWater=true;events.push({type:"SNOW_MELT",x,y,from:snow,to:tile.snowDepth,heat:heavy?2:1});}
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

  return Object.freeze({WEATHER,SAFE_ICE,CFG,initializeMap,advance,temperatureAt,isSnowWeather,snowDepth,iceThickness,isFrozen,isSolidIce,iceThreshold,iceSupports,resolveIceStep,currentForce,applyHeat,triggerAvalanche,syncTileVisuals});
})();
globalThis.ClimateEngine=ClimateEngine;

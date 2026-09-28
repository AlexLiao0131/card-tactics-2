export const EnvironmentEngine=(()=>{
  const ELEMENT={NONE:"NONE",GRASS:"GRASS",WATER:"WATER",STONE:"STONE"};
  const FORCE={FIRE:"FIRE",HEAVY_FIRE:"HEAVY_FIRE",EXPLOSION:"EXPLOSION",WIND:"WIND",THUNDER:"THUNDER",IMPACT:"IMPACT",AVALANCHE_TRIGGER:"AVALANCHE_TRIGGER"};
  const EFFECT={BURNING:"BURNING",BOILING:"BOILING",STEAM:"STEAM",SMOKE:"SMOKE",FRAGMENTS:"FRAGMENTS",TORNADO:"TORNADO",FIRE_TORNADO:"FIRE_TORNADO",ELECTRIFIED:"ELECTRIFIED",SNOW:"SNOW",ICE:"ICE",CURRENT:"CURRENT",TRAP:"TRAP"};
  const WEATHER={CLEAR:"CLEAR",FOG:"FOG",RAIN:"RAIN",HEAVY_RAIN:"HEAVY_RAIN",THUNDERSTORM:"THUNDERSTORM",SNOW:"SNOW",BLIZZARD:"BLIZZARD"};
  const PRECIPITATION=Object.freeze({NONE:"NONE",RAIN:"RAIN",HEAVY_RAIN:"HEAVY_RAIN",SNOW:"SNOW"});
  const CLIMATE_CHANNEL=Object.freeze({PRECIPITATION:"PRECIPITATION",FOG:"FOG",THUNDER:"THUNDER",TEMPERATURE:"TEMPERATURE",WIND:"WIND"});
  const WEATHER_RULES={THUNDERSTORM:{lightningChance:0.35,lightningDamage:60,metalWeight:2,waterWeight:2,treeWeight:2}};
  const WEATHER_TURNS=Object.freeze({FOG:2,RAIN:3,HEAVY_RAIN:2,THUNDERSTORM:2,SNOW:3,BLIZZARD:2});
  const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
  const METAL_EQUIPMENT_IDS=new Set(["black_sword","imperial_sword","standard_sword","blessed_sword","imperial_spear","imperial_hammer","imperial_medium_armor","imperial_heavy_shield_armor","water_medium_armor","imperial_heavy_armor","imperial_heavy_plate","imperial_large_shield","nereia_royal_trident","beast_dual_daggers","beast_poison_throwing_knife"]);
  const HAZARD={BURNING_DAMAGE:20,BOILING_DAMAGE:30,FIRE_TORNADO_DAMAGE:45,ELECTRIC_DAMAGE:35};
  const HYDROLOGY=Object.freeze({WATERLINE:HydrologyEngine.WATERLINE,RAIN_FILL_PER_EVENT:HydrologyEngine.RAIN_FILL_PER_EVENT,HEAVY_RAIN_FILL_PER_EVENT:HydrologyEngine.HEAVY_RAIN_FILL_PER_EVENT,STORM_RAIN_FILL_PER_EVENT:HydrologyEngine.STORM_RAIN_FILL_PER_EVENT});
  function key(x,y){return `${x},${y}`;}
  function tileAt(map,x,y){return map?.tiles?.find(t=>t.x===x&&t.y===y)||null;}
  function objectAt(map,x,y){return window.EnvironmentObjectEngine?.activeObjectsAt?.(map,x,y)?.[0]||(map?.objects||[]).find(o=>!o.destroyed&&o.x===x&&o.y===y)||null;}
  const elevation=tile=>HydrologyEngine.elevation(tile);
  const waterDepth=tile=>HydrologyEngine.waterDepth(tile);
  function environmentAt(map,x,y){const object=objectAt(map,x,y);if(object?.environment)return object.environment;const tile=tileAt(map,x,y);return TERRAINS[tile?.terrain]?.environment||ELEMENT.NONE;}
  function normalizeWind(value={}){
    let x=Number(value?.x??value?.windX??1),y=Number(value?.y??value?.windY??0),strength=Math.max(0,Math.min(3,Number(value?.strength??value?.windStrength??.8)));
    if(!Number.isFinite(x))x=1;if(!Number.isFinite(y))y=0;if(!Number.isFinite(strength))strength=.8;
    x=Math.sign(x);y=Math.sign(y);if(x===0&&y===0&&strength>0)x=1;
    return{x,y,strength};
  }
  function turns(value,fallback=null){if(value==null)return fallback;return Math.max(0,Number(value||0));}
  function climateFromWeather(weather="CLEAR",duration=null){
    const w=WEATHER[weather]?weather:WEATHER.CLEAR,d=duration==null?WEATHER_TURNS[w]??null:Math.max(0,Number(duration||0));
    const climate={
      precipitation:{type:PRECIPITATION.NONE,intensity:0,turnsRemaining:null},
      fog:{intensity:0,turnsRemaining:null},
      thunder:{intensity:0,turnsRemaining:null},
      temperature:null,
      wind:null
    };
    if(w===WEATHER.FOG)climate.fog={intensity:1,turnsRemaining:d};
    else if(w===WEATHER.RAIN)climate.precipitation={type:PRECIPITATION.RAIN,intensity:1,turnsRemaining:d};
    else if(w===WEATHER.HEAVY_RAIN)climate.precipitation={type:PRECIPITATION.HEAVY_RAIN,intensity:1.5,turnsRemaining:d};
    else if(w===WEATHER.THUNDERSTORM){climate.precipitation={type:PRECIPITATION.HEAVY_RAIN,intensity:1.5,turnsRemaining:d};climate.thunder={intensity:1,turnsRemaining:d};climate.wind={x:1,y:0,strength:1.85};}
    else if(w===WEATHER.SNOW)climate.precipitation={type:PRECIPITATION.SNOW,intensity:1,turnsRemaining:d};
    else if(w===WEATHER.BLIZZARD){climate.precipitation={type:PRECIPITATION.SNOW,intensity:1.6,turnsRemaining:d};climate.wind={x:1,y:0,strength:2.1};}
    return climate;
  }
  function normalizeLayer(layer,{type=PRECIPITATION.NONE,intensity=0,turnsRemaining=null}={}){
    if(typeof layer==="string")return{type:layer,intensity:layer===PRECIPITATION.NONE?0:1,turnsRemaining};
    return{type:layer?.type??type,intensity:Math.max(0,Number((layer?.intensity??intensity)||0)),turnsRemaining:turns(layer?.turnsRemaining,turnsRemaining)};
  }
  function ensureClimate(state){
    if(!state)return null;
    const legacy=climateFromWeather(state.weather||WEATHER.CLEAR,state.weatherTurnsRemaining);
    const source=state.climate&&typeof state.climate==="object"?state.climate:{};
    const hasChannels=source.precipitation||source.fog||source.thunder||source.temperature!=null||source.wind;
    if(!hasChannels){
      source.precipitation={...legacy.precipitation};source.fog={...legacy.fog};source.thunder={...legacy.thunder};source.temperature=null;source.wind=legacy.wind?{...legacy.wind}:null;
    }else{
      source.precipitation=normalizeLayer(source.precipitation,{...legacy.precipitation});
      source.fog={intensity:Math.max(0,Number(source.fog?.intensity??0)),turnsRemaining:turns(source.fog?.turnsRemaining,null)};
      source.thunder={intensity:Math.max(0,Number(source.thunder?.intensity??0)),turnsRemaining:turns(source.thunder?.turnsRemaining,null)};
      if(source.temperature!=null&&!Number.isFinite(Number(source.temperature)))source.temperature=null;
    }
    source.turn=Math.max(0,Number(source.turn||0));
    state.climate=source;
    const sourceWind=source.wind||state.wind||legacy.wind||{};
    source.wind=normalizeWind(sourceWind);
    state.wind={...source.wind};
    syncLegacyWeather(state);
    return source;
  }
  function windAt(state){const climate=ensureClimate(state);climate.wind=normalizeWind(climate?.wind||state?.wind||{});state.wind={...climate.wind};return state.wind;}
  function setWind(state,value){if(!state)return null;const climate=ensureClimate(state);climate.wind=normalizeWind(value);state.wind={...climate.wind};syncLegacyWeather(state);return state.wind;}
  function precipitationAt(state){return ensureClimate(state)?.precipitation||{type:PRECIPITATION.NONE,intensity:0,turnsRemaining:null};}
  function fogAt(state){return ensureClimate(state)?.fog||{intensity:0,turnsRemaining:null};}
  function thunderAt(state){return ensureClimate(state)?.thunder||{intensity:0,turnsRemaining:null};}
  function isFog(state){return Number(fogAt(state).intensity||0)>0;}
  function hasThunder(state){return Number(thunderAt(state).intensity||0)>0;}
  function isRain(state){const type=precipitationAt(state).type;return type===PRECIPITATION.RAIN||type===PRECIPITATION.HEAVY_RAIN;}
  function isSnow(state){return precipitationAt(state).type===PRECIPITATION.SNOW;}
  function isBlizzard(state){return isSnow(state)&&Number(windAt(state).strength||0)>=1.75;}
  function legacyWeather(state){
    if(!state)return WEATHER.CLEAR;
    const precipitation=precipitationAt(state),wind=windAt(state);
    if(precipitation.type===PRECIPITATION.SNOW&&Number(wind.strength||0)>=1.75)return WEATHER.BLIZZARD;
    if(hasThunder(state))return WEATHER.THUNDERSTORM;
    if(precipitation.type===PRECIPITATION.HEAVY_RAIN)return WEATHER.HEAVY_RAIN;
    if(precipitation.type===PRECIPITATION.RAIN)return WEATHER.RAIN;
    if(precipitation.type===PRECIPITATION.SNOW)return WEATHER.SNOW;
    if(isFog(state))return WEATHER.FOG;
    return WEATHER.CLEAR;
  }
  function compatibilityRemaining(state){
    const climate=state?.climate;if(!climate)return null;
    const values=[climate.precipitation?.turnsRemaining,climate.fog?.turnsRemaining,climate.thunder?.turnsRemaining].filter(v=>v!=null).map(Number).filter(Number.isFinite);
    return values.length?Math.max(...values):null;
  }
  function syncLegacyWeather(state){
    if(!state)return;
    const w=legacyWeatherRaw(state);state.weather=w;state.weatherTurnsRemaining=compatibilityRemaining(state);
  }
  function legacyWeatherRaw(state){
    const climate=state?.climate||{},precipitation=climate.precipitation||{},wind=climate.wind||state?.wind||{};
    if(precipitation.type===PRECIPITATION.SNOW&&Number(wind.strength||0)>=1.75)return WEATHER.BLIZZARD;
    if(Number(climate.thunder?.intensity||0)>0)return WEATHER.THUNDERSTORM;
    if(precipitation.type===PRECIPITATION.HEAVY_RAIN)return WEATHER.HEAVY_RAIN;
    if(precipitation.type===PRECIPITATION.RAIN)return WEATHER.RAIN;
    if(precipitation.type===PRECIPITATION.SNOW)return WEATHER.SNOW;
    if(Number(climate.fog?.intensity||0)>0)return WEATHER.FOG;
    return WEATHER.CLEAR;
  }
  function climateSnapshot(state){
    const climate=ensureClimate(state),precipitation=climate.precipitation||{},fog=climate.fog||{},thunder=climate.thunder||{};
    return{
      precipitation:{type:precipitation.type||PRECIPITATION.NONE,intensity:Number(precipitation.intensity||0),turnsRemaining:precipitation.turnsRemaining??null},
      fog:{intensity:Number(fog.intensity||0),turnsRemaining:fog.turnsRemaining??null},
      thunder:{intensity:Number(thunder.intensity||0),turnsRemaining:thunder.turnsRemaining??null},
      temperature:climate.temperature==null?null:Number(climate.temperature),
      wind:{...windAt(state)},
      legacyWeather:legacyWeatherRaw(state)
    };
  }
  function setClimateChannel(state,channel,value,{duration=null,intensity=null}={}){
    if(!state)return null;const climate=ensureClimate(state),name=String(channel||"").toUpperCase();
    if(name===CLIMATE_CHANNEL.PRECIPITATION){
      const input=typeof value==="object"?value:{type:value};const type=PRECIPITATION[input?.type]?input.type:PRECIPITATION.NONE;
      climate.precipitation={type,intensity:type===PRECIPITATION.NONE?0:Math.max(0,Number(input?.intensity??intensity??1)),turnsRemaining:type===PRECIPITATION.NONE?null:turns(input?.turnsRemaining,duration)};
    }else if(name===CLIMATE_CHANNEL.FOG){
      const input=typeof value==="object"?value:{intensity:value===false||value==="NONE"?0:Number(value)||1};const fogIntensity=Math.max(0,Number(input?.intensity??intensity??1));
      climate.fog={intensity:fogIntensity,turnsRemaining:fogIntensity<=0?null:turns(input?.turnsRemaining,duration)};
    }else if(name===CLIMATE_CHANNEL.THUNDER){
      const input=typeof value==="object"?value:{intensity:value===false||value==="NONE"?0:Number(value)||1};const thunderIntensity=Math.max(0,Number(input?.intensity??intensity??1));
      climate.thunder={intensity:thunderIntensity,turnsRemaining:thunderIntensity<=0?null:turns(input?.turnsRemaining,duration)};
    }else if(name===CLIMATE_CHANNEL.TEMPERATURE){
      climate.temperature=value==null||!Number.isFinite(Number(value))?null:Number(value);
    }else if(name===CLIMATE_CHANNEL.WIND){
      climate.wind=normalizeWind(value||{});state.wind={...climate.wind};
    }
    syncLegacyWeather(state);return climateSnapshot(state);
  }
  function applyClimatePreset(state,weather,{duration=null}={}){
    if(!state)return[];const climate=ensureClimate(state),resolved=WEATHER[weather]?weather:WEATHER.CLEAR,d=duration==null?WEATHER_TURNS[resolved]??null:Math.max(0,Number(duration||0)),touched=[];
    if(resolved===WEATHER.CLEAR){
      climate.precipitation={type:PRECIPITATION.NONE,intensity:0,turnsRemaining:null};climate.fog={intensity:0,turnsRemaining:null};climate.thunder={intensity:0,turnsRemaining:null};touched.push(CLIMATE_CHANNEL.PRECIPITATION,CLIMATE_CHANNEL.FOG,CLIMATE_CHANNEL.THUNDER);
    }else if(resolved===WEATHER.FOG){setClimateChannel(state,CLIMATE_CHANNEL.FOG,{intensity:1,turnsRemaining:d});touched.push(CLIMATE_CHANNEL.FOG);}
    else if(resolved===WEATHER.RAIN){setClimateChannel(state,CLIMATE_CHANNEL.PRECIPITATION,{type:PRECIPITATION.RAIN,intensity:1,turnsRemaining:d});touched.push(CLIMATE_CHANNEL.PRECIPITATION);}
    else if(resolved===WEATHER.HEAVY_RAIN){setClimateChannel(state,CLIMATE_CHANNEL.PRECIPITATION,{type:PRECIPITATION.HEAVY_RAIN,intensity:1.5,turnsRemaining:d});touched.push(CLIMATE_CHANNEL.PRECIPITATION);}
    else if(resolved===WEATHER.THUNDERSTORM){setClimateChannel(state,CLIMATE_CHANNEL.PRECIPITATION,{type:PRECIPITATION.HEAVY_RAIN,intensity:1.5,turnsRemaining:d});setClimateChannel(state,CLIMATE_CHANNEL.THUNDER,{intensity:1,turnsRemaining:d});if(Number(windAt(state).strength||0)<1.85)setWind(state,{...windAt(state),strength:1.85});touched.push(CLIMATE_CHANNEL.PRECIPITATION,CLIMATE_CHANNEL.THUNDER);}
    else if(resolved===WEATHER.SNOW){setClimateChannel(state,CLIMATE_CHANNEL.PRECIPITATION,{type:PRECIPITATION.SNOW,intensity:1,turnsRemaining:d});touched.push(CLIMATE_CHANNEL.PRECIPITATION);}
    else if(resolved===WEATHER.BLIZZARD){setClimateChannel(state,CLIMATE_CHANNEL.PRECIPITATION,{type:PRECIPITATION.SNOW,intensity:1.6,turnsRemaining:d});if(Number(windAt(state).strength||0)<2.1)setWind(state,{...windAt(state),strength:2.1});touched.push(CLIMATE_CHANNEL.PRECIPITATION);}
    syncLegacyWeather(state);return touched;
  }
  function create({timeOfDay="DAY",weather="CLEAR",weatherTurns=null,climate=null,wind=null,windX=null,windY=null,windStrength=null,temperature=null}={}){
    const legacy=climateFromWeather(weather,weatherTurns),baseClimate=climate&&typeof climate==="object"?JSON.parse(JSON.stringify(climate)):legacy;
    const resolvedWind=normalizeWind(wind||baseClimate.wind||{x:windX,y:windY,strength:windStrength});
    const state={timeOfDay,weather:WEATHER.CLEAR,weatherTurnsRemaining:null,wind:resolvedWind,effects:new Map(),destroyedObjects:new Set(),climate:{turn:0,...baseClimate,wind:resolvedWind}};
    if(temperature!=null&&Number.isFinite(Number(temperature)))state.climate.temperature=Number(temperature);
    ensureClimate(state);return state;
  }
  function setTimeOfDay(state,timeOfDay){state.timeOfDay=timeOfDay==="NIGHT"?"NIGHT":"DAY";}
  const fillCapacity=tile=>HydrologyEngine.fillCapacity(tile);
  const addWater=(tile,amount,events=[])=>HydrologyEngine.addWater(tile,amount,events);
  const removeWater=(tile,amount,events=[])=>HydrologyEngine.removeWater(tile,amount,events);
  const deformTerrain=(map,x,y,options={})=>HydrologyEngine.deformTerrain(map,x,y,options);

  function rainAmount(state){const precipitation=precipitationAt(state);if(hasThunder(state)&&precipitation.type===PRECIPITATION.HEAVY_RAIN)return Number(HydrologyEngine.STORM_RAIN_FILL_PER_EVENT??0.16);if(precipitation.type===PRECIPITATION.HEAVY_RAIN)return Number(HydrologyEngine.HEAVY_RAIN_FILL_PER_EVENT??0.12);return Number(HydrologyEngine.RAIN_FILL_PER_EVENT??0.06);}
  function applyRainToTerrain(map,state){const precipitation=precipitationAt(state),heavy=precipitation.type===PRECIPITATION.HEAVY_RAIN;return HydrologyEngine.applyRain(map,{heavy,amount:rainAmount(state),source:legacyWeatherRaw(state)});}
  function weatherPulse(map,state,events=[]){
    if(isRain(state))events.push(...applyRainToTerrain(map,state));
    else if(!isSnow(state))events.push(...HydrologyEngine.drySoil(map,{source:"CLEAR_WEATHER"}));
    if(window.ClimateEngine)events.push(...ClimateEngine.advance(map,state));
    if(window.EnvironmentResolver)events.push(...EnvironmentResolver.resolve(map,state,{source:"ENVIRONMENT_TICK"}));
    return events;
  }
  function climateChannels(){return[CLIMATE_CHANNEL.PRECIPITATION,CLIMATE_CHANNEL.FOG,CLIMATE_CHANNEL.THUNDER];}
  function layerFor(state,channel){const climate=ensureClimate(state);if(channel===CLIMATE_CHANNEL.PRECIPITATION)return climate.precipitation;if(channel===CLIMATE_CHANNEL.FOG)return climate.fog;if(channel===CLIMATE_CHANNEL.THUNDER)return climate.thunder;return null;}
  function expireClimate(state,events=[]){
    for(const channel of climateChannels()){
      const layer=layerFor(state,channel);if(!layer||layer.turnsRemaining!==0)continue;
      if(channel===CLIMATE_CHANNEL.PRECIPITATION){const ended=layer.type;layer.type=PRECIPITATION.NONE;layer.intensity=0;layer.turnsRemaining=null;events.push({type:"CLIMATE_ENDED",channel,climate:ended});}
      else{const endedIntensity=Number(layer.intensity||0);layer.intensity=0;layer.turnsRemaining=null;if(endedIntensity>0)events.push({type:"CLIMATE_ENDED",channel});}
    }
    syncLegacyWeather(state);return events;
  }
  function decrementClimate(state,only=null){
    const allowed=only?new Set(only):null;
    for(const channel of climateChannels()){
      if(allowed&&!allowed.has(channel))continue;const layer=layerFor(state,channel);if(layer?.turnsRemaining!=null&&layer.turnsRemaining>0)layer.turnsRemaining=Math.max(0,Number(layer.turnsRemaining)-1);
    }
    syncLegacyWeather(state);
  }
  function recordDestroyedObjects(state,events){if(!state?.destroyedObjects)return;for(const event of events||[])if(event?.type==="ENV_OBJECT_DESTROYED"&&event.objectId)state.destroyedObjects.add(event.objectId);}
  function addSmoke(state,x,y,{intensity=.8,duration=3,source="FIRE"}={}){
    if(!state?.effects)return null;const current=effectAt(state,x,y).find(effect=>effect.type===EFFECT.SMOKE),nextIntensity=Math.max(0,Math.min(2.5,Number(current?.intensity||0)+Math.max(0,Number(intensity||0))));
    if(nextIntensity<.12)return current||null;
    return addEffect(state,x,y,{type:EFFECT.SMOKE,duration:Math.max(Number(current?.duration||0),Number(duration||3)),intensity:nextIntensity,visionBlock:nextIntensity>=.45,source});
  }
  function advanceSmoke(map,state,events=[]){
    if(!map||!state?.effects)return events;const wind=windAt(state),existing=[],fires=[];
    for(const[k,list]of state.effects.entries()){
      const[x,y]=k.split(",").map(Number);
      for(const effect of list){if(effect.type===EFFECT.SMOKE)existing.push({x,y,effect:{...effect}});}
      const fire=list.find(effect=>effect.type===EFFECT.FIRE_TORNADO)||list.find(effect=>effect.type===EFFECT.BURNING);if(fire)fires.push({x,y,fire});
    }
    for(const {x,y} of existing)removeEffect(state,x,y,EFFECT.SMOKE);
    const precipitation=precipitationAt(state),rainFactor=isSnow(state) ? .68 : precipitation.type===PRECIPITATION.HEAVY_RAIN ? .35 : precipitation.type===PRECIPITATION.RAIN ? .55 : 1;
    const dx=Math.sign(Number(wind.x||0)),dy=Math.sign(Number(wind.y||0)),driftSteps=wind.strength<.25?0:(wind.strength>=1.75?2:1);
    let drifted=0,emitted=0;
    for(const entry of existing){
      const intensity=Number(entry.effect.intensity||.6)*.58*rainFactor;if(intensity<.14)continue;
      const x=entry.x+dx*driftSteps,y=entry.y+dy*driftSteps;if(!tileAt(map,x,y))continue;
      addSmoke(state,x,y,{intensity,duration:2,source:"DRIFT"});drifted++;
    }
    for(const {x,y,fire} of fires){
      const heavy=fire.type===EFFECT.FIRE_TORNADO||fire.fireIntensity==="HEAVY",base=(heavy?1.35:.9)*rainFactor;if(base<.12)continue;
      addSmoke(state,x,y,{intensity:base,duration:3,source:fire.type});emitted++;
      if(dx===0&&dy===0)continue;
      const plume=Math.max(1,Math.min(5,Math.round(1+Number(wind.strength||0)*1.7)));
      for(let step=1;step<=plume;step++){const tx=x+dx*step,ty=y+dy*step;if(!tileAt(map,tx,ty))break;const intensity=base*Math.pow(.72,step);if(intensity<.16)break;addSmoke(state,tx,ty,{intensity,duration:3,source:"FIRE_PLUME"});}
    }
    if(emitted||drifted)events.push({type:"SMOKE_UPDATED",emitted,drifted,wind:{...wind}});
    return events;
  }
  function flammableAt(map,x,y){const tile=tileAt(map,x,y);if(!tile||HydrologyEngine.isWater(tile))return false;if(window.EnvironmentObjectEngine?.flammableAt?.(map,x,y))return true;const object=objectAt(map,x,y);if(object&&(object.flammable===true||object.environment===ELEMENT.GRASS))return true;return TERRAINS[tile.terrain]?.environment===ELEMENT.GRASS;}
  function spreadFire(map,state){
    if(!map||!state||isRain(state)||isSnow(state))return[];
    const pending=new Map();
    for(const [k,list] of state.effects.entries()){
      if(!list.some(effect=>effect.type===EFFECT.BURNING||effect.type===EFFECT.FIRE_TORNADO))continue;
      const [x,y]=k.split(",").map(Number);
      for(const [dx,dy] of DIRS){const nx=x+dx,ny=y+dy,nk=key(nx,ny);if(pending.has(nk)||isBurning(state,nx,ny)||!flammableAt(map,nx,ny))continue;pending.set(nk,{x:nx,y:ny});}
    }
    const events=[];
    for(const {x,y} of pending.values()){addEffect(state,x,y,{type:EFFECT.BURNING,duration:3,lightRadius:2,damage:HAZARD.BURNING_DAMAGE,damageType:"FIRE",fireIntensity:"NORMAL"});addSmoke(state,x,y,{intensity:.9,duration:3,source:"FIRE_SPREAD"});events.push({type:"IGNITE",x,y,effect:EFFECT.BURNING,source:"FIRE_SPREAD"});}
    return events;
  }
  function advanceHydrology(map,state){
    if(!map||!state)return[];const events=[];ensureClimate(state);expireClimate(state,events);weatherPulse(map,state,events);decrementClimate(state);
    events.push(...spreadFire(map,state));window.EnvironmentObjectEngine?.tickBurning?.(map,state,events);advanceSmoke(map,state,events);recordDestroyedObjects(state,events);return events;
  }
  function setWeather(state,weather,map=null,{duration=null,applyPulse=true}={}){
    if(!state)return[];const resolved=WEATHER[weather]?weather:WEATHER.CLEAR,touched=applyClimatePreset(state,resolved,{duration}),events=[];
    if(isRain(state)||isSnow(state)){
      for(const [k,list] of [...state.effects.entries()]){
        if(!list.some(e=>e.type===EFFECT.BURNING))continue;
        const [x,y]=k.split(",").map(Number);removeEffect(state,x,y,EFFECT.BURNING);events.push({type:isRain(state)?"RAIN_EXTINGUISHED_FIRE":"SNOW_EXTINGUISHED_FIRE",x,y});
      }
    }
    if(map&&applyPulse){if(touched.includes(CLIMATE_CHANNEL.PRECIPITATION))weatherPulse(map,state,events);decrementClimate(state,touched);}
    events.push({type:"WEATHER_SET",weather:resolved,duration:resolved===WEATHER.CLEAR?0:Number(duration??WEATHER_TURNS[resolved]??1),remaining:Number(state.weatherTurnsRemaining??0),climate:climateSnapshot(state)});
    for(const channel of touched)events.push({type:"CLIMATE_SET",channel,climate:climateSnapshot(state)});
    return events;
  }

  function hasMetalEquipment(unit){return EquipmentDatabase.equippedItems(unit?.character).some(item=>item?.material==="METAL"||item?.conductive===true||METAL_EQUIPMENT_IDS.has(item?.id));}
  function lightningRisk(map,unit){if(!unit?.alive)return{weight:0,reasons:[]};const rules=WEATHER_RULES.THUNDERSTORM;let weight=1;const reasons=[];if(hasMetalEquipment(unit)){weight*=rules.metalWeight;reasons.push("METAL");}const material=environmentAt(map,unit.x,unit.y);if(material===ELEMENT.WATER){weight*=rules.waterWeight;reasons.push("WATER");}if(material===ELEMENT.GRASS){weight*=rules.treeWeight;reasons.push("TREE");}return{weight,reasons};}
  function rollWeatherEvent({map,state,units=[],random=Math.random}){if(!state||!hasThunder(state))return[];const rules=WEATHER_RULES.THUNDERSTORM,intensity=Math.max(.1,Number(thunderAt(state).intensity||1)),chance=Math.min(.8,rules.lightningChance*intensity);if(random()>=chance)return[];const candidates=units.filter(u=>u?.alive).map(unit=>({unit,...lightningRisk(map,unit)})).filter(x=>x.weight>0);if(!candidates.length)return[];let roll=random()*candidates.reduce((n,x)=>n+x.weight,0),chosen=candidates[candidates.length-1];for(const candidate of candidates){roll-=candidate.weight;if(roll<=0){chosen=candidate;break;}}return[{type:"LIGHTNING_STRIKE",unit:chosen.unit,x:chosen.unit.x,y:chosen.unit.y,damage:rules.lightningDamage,riskReasons:chosen.reasons,weight:chosen.weight}];}
  function effectAt(state,x,y){return state?.effects?.get(key(x,y))||[];}
  function addEffect(state,x,y,effect){const k=key(x,y),list=state.effects.get(k)||[],same=list.find(e=>e.type===effect.type);if(same)Object.assign(same,effect);else list.push({...effect,x,y});state.effects.set(k,list);return same||list[list.length-1];}
  function removeEffect(state,x,y,type){const k=key(x,y),next=(state.effects.get(k)||[]).filter(e=>e.type!==type);if(next.length)state.effects.set(k,next);else state.effects.delete(k);}
  function destroyStoneObject(map,state,object){if(!object?.destructible)return false;object.destroyed=true;state.destroyedObjects.add(object.id);const tile=tileAt(map,object.x,object.y);if(tile&&object.breaksIntoTerrain)tile.terrain=object.breaksIntoTerrain;return true;}
  function isBurning(state,x,y){return effectAt(state,x,y).some(e=>e.type===EFFECT.BURNING||e.type===EFFECT.FIRE_TORNADO);}
  function isBoiling(state,x,y){return effectAt(state,x,y).some(e=>e.type===EFFECT.BOILING);}
  function isConductive(map,state,x,y){return HydrologyEngine.isWater(tileAt(map,x,y));}
  function conductiveRegion(map,state,x,y){return HydrologyEngine.connectedWaterBody(map,x,y);}

  function addSteam(state,x,y,events,{duration=2,reason="HEAT"}={}){const existed=effectAt(state,x,y).some(e=>e.type===EFFECT.STEAM);addEffect(state,x,y,{type:EFFECT.STEAM,duration,visionBlock:true});if(!existed)events.push({type:"STEAM_CREATED",x,y,effect:EFFECT.STEAM,reason});}
  function heatWater(map,state,x,y,events=[]){
    const tile=tileAt(map,x,y);if(!HydrologyEngine.isWater(tile))return false;
    const existing=effectAt(state,x,y).find(e=>e.type===EFFECT.BOILING),heat=Number(existing?.heat||0)+1;
    addEffect(state,x,y,{type:EFFECT.BOILING,duration:2,heat,damage:HAZARD.BOILING_DAMAGE,damageType:"FIRE"});addSteam(state,x,y,events,{duration:existing?2:1,reason:existing?"BOILING":"BOILING_START"});
    if(!existing){events.push({type:"WATER_BOILING",x,y,effect:EFFECT.BOILING,heat,waterDepth:waterDepth(tile)});return true;}
    const removed=removeWater(tile,1,events);events.push({type:"WATER_EVAPORATION",x,y,amount:removed,heat,waterDepth:waterDepth(tile)});HydrologyEngine.redistribute(map,{source:"EVAPORATION",events});
    if(!HydrologyEngine.isWater(tile)){removeEffect(state,x,y,EFFECT.BOILING);events.push({type:"WATER_BOILED_DRY",x,y});}return true;
  }
  function conductThunder(map,state,x,y,events=[],{damagedUnitIds=[]}={}){const region=conductiveRegion(map,state,x,y),hitRegistry=[...new Set(damagedUnitIds.map(String))];for(const tile of region)addEffect(state,tile.x,tile.y,{type:EFFECT.ELECTRIFIED,duration:1,damage:HAZARD.ELECTRIC_DAMAGE,damageType:"THUNDER",damagedUnitIds:hitRegistry,origin:{x,y}});if(region.length)events.push({type:"ELECTRIC_CONDUCTION",x,y,effect:EFFECT.ELECTRIFIED,origin:{x,y},regionSize:region.length,tiles:region.map(tile=>({x:tile.x,y:tile.y}))});return region;}

  function apply({map,state,x,y,forces=[]}){
    const forceSet=new Set(forces),events=[],raining=isRain(state),burningBefore=isBurning(state,x,y),steamBefore=effectAt(state,x,y).some(e=>e.type===EFFECT.STEAM),smokeBefore=effectAt(state,x,y).some(e=>e.type===EFFECT.SMOKE),stoneObjectBefore=objectAt(map,x,y);
    if((forceSet.has(FORCE.FIRE)||forceSet.has(FORCE.HEAVY_FIRE))&&window.ClimateEngine)events.push(...ClimateEngine.applyHeat(map,state,x,y,{heavy:forceSet.has(FORCE.HEAVY_FIRE)}));
    if(forceSet.has(FORCE.IMPACT))events.push(...deformTerrain(map,x,y,{deltaElevation:-1,source:"IMPACT"}));
    if(window.EnvironmentObjectEngine){const objectForces=[...forceSet].filter(force=>force!==FORCE.FIRE||!raining);EnvironmentObjectEngine.applyForces(map,x,y,objectForces,{events});}
    const environment=environmentAt(map,x,y);
    if(forceSet.has(FORCE.WIND)&&steamBefore){removeEffect(state,x,y,EFFECT.STEAM);events.push({type:"STEAM_DISPERSED",x,y});}
    if(forceSet.has(FORCE.WIND)&&smokeBefore){removeEffect(state,x,y,EFFECT.SMOKE);events.push({type:"SMOKE_DISPERSED",x,y});}
    if(forceSet.has(FORCE.WIND)&&burningBefore){addEffect(state,x,y,{type:EFFECT.FIRE_TORNADO,duration:2,lightRadius:3,damage:HAZARD.FIRE_TORNADO_DAMAGE,damageType:"FIRE",visionBlock:false});events.push({type:"FIRE_TORNADO_CREATED",x,y,effect:EFFECT.FIRE_TORNADO});}
    if(raining&&forceSet.has(FORCE.FIRE)){if(effectAt(state,x,y).some(e=>e.type===EFFECT.BURNING)){removeEffect(state,x,y,EFFECT.BURNING);events.push({type:"FIRE_EXTINGUISHED",x,y});}events.push({type:"RAIN_SUPPRESSED_FIRE",x,y});}
    else if(!raining&&environment===ELEMENT.GRASS&&forceSet.has(FORCE.FIRE)){addEffect(state,x,y,{type:EFFECT.BURNING,duration:3,lightRadius:2,damage:HAZARD.BURNING_DAMAGE,damageType:"FIRE",fireIntensity:"NORMAL"});addSmoke(state,x,y,{intensity:.9,duration:3,source:"IGNITE"});events.push({type:"IGNITE",x,y,effect:EFFECT.BURNING});}
    if(raining&&(forceSet.has(FORCE.HEAVY_FIRE)||forceSet.has(FORCE.EXPLOSION))){removeEffect(state,x,y,EFFECT.BURNING);addSteam(state,x,y,events,{duration:2,reason:forceSet.has(FORCE.HEAVY_FIRE)?"HEAVY_FIRE_IN_RAIN":"EXPLOSION_IN_RAIN"});}
    else if(!raining&&environment===ELEMENT.GRASS&&forceSet.has(FORCE.HEAVY_FIRE)){addEffect(state,x,y,{type:EFFECT.BURNING,duration:3,lightRadius:2,damage:HAZARD.BURNING_DAMAGE,damageType:"FIRE",fireIntensity:"HEAVY"});addSmoke(state,x,y,{intensity:1.35,duration:3,source:"HEAVY_IGNITE"});events.push({type:"IGNITE",x,y,effect:EFFECT.BURNING});}
    if(environment===ELEMENT.WATER){if(forceSet.has(FORCE.HEAVY_FIRE)){removeEffect(state,x,y,EFFECT.BURNING);const waterTile=tileAt(map,x,y);if(window.ClimateEngine?.isFrozen?.(waterTile))events.push({type:"ICE_HEATED",x,y,iceThickness:ClimateEngine.iceThickness(waterTile)});else heatWater(map,state,x,y,events);}else if(forceSet.has(FORCE.FIRE)){removeEffect(state,x,y,EFFECT.BURNING);events.push({type:"FIRE_EXTINGUISHED",x,y});}}
    if(forceSet.has(FORCE.THUNDER)&&isConductive(map,state,x,y))conductThunder(map,state,x,y,events);
    const terrainEnvironment=TERRAINS[tileAt(map,x,y)?.terrain]?.environment||ELEMENT.NONE;
    if((environment===ELEMENT.STONE||terrainEnvironment===ELEMENT.STONE||stoneObjectBefore?.environment===ELEMENT.STONE)&&forceSet.has(FORCE.EXPLOSION)){
      addEffect(state,x,y,{type:EFFECT.FRAGMENTS,duration:1,damageType:"PHYSICAL",radius:1});let destroyed=false;
      if(window.EnvironmentObjectEngine)destroyed=events.some(e=>e.type==="ENV_OBJECT_DESTROYED"&&e.objectId===stoneObjectBefore?.id);else destroyed=destroyStoneObject(map,state,stoneObjectBefore);
      events.push({type:"STONE_FRAGMENT",x,y,effect:EFFECT.FRAGMENTS,destroyed,objectId:stoneObjectBefore?.id||null});
    }
    if(forceSet.has(FORCE.AVALANCHE_TRIGGER)&&window.ClimateEngine?.triggerAvalanche)events.push(...ClimateEngine.triggerAvalanche(map,x,y,{strength:1.6,source:"AVALANCHE_TRIGGER",state}));
    if(window.EnvironmentResolver){const disturbance=forceSet.has(FORCE.EXPLOSION)?1.25:forceSet.has(FORCE.IMPACT)?1:0;if(disturbance>0){events.push(...EnvironmentResolver.disturb(map,x,y,disturbance,{source:forceSet.has(FORCE.EXPLOSION)?"EXPLOSION":"IMPACT"}));events.push(...EnvironmentResolver.resolve(map,state,{source:"DISTURBANCE"}));}}
    recordDestroyedObjects(state,events);return events;
  }

  function createTornado(state,x,y,{duration=2,pushDistance=2,lift=3,damage=20,fireDamage=45,resistAxes={horizontal:false,vertical:true}}={}){const burning=isBurning(state,x,y);if(burning){addEffect(state,x,y,{type:EFFECT.FIRE_TORNADO,duration,pushDistance,lift,resistAxes:{...resistAxes},lightRadius:3,damage:fireDamage,damageType:"FIRE",visionBlock:false});return{type:"FIRE_TORNADO_CREATED",x,y,effect:EFFECT.FIRE_TORNADO};}addEffect(state,x,y,{type:EFFECT.TORNADO,duration,pushDistance,lift,resistAxes:{...resistAxes},damage,damageType:"PHYSICAL",visionBlock:false});return{type:"TORNADO_CREATED",x,y,effect:EFFECT.TORNADO};}
  function createTrap(state,x,y,{duration=4,damage=25,sourceTeam=null,sourceUnitId=null,name="陷阱"}={}){if(!state?.effects)return null;return addEffect(state,x,y,{type:EFFECT.TRAP,duration,damage:Math.max(0,Number(damage||0)),damageType:"PHYSICAL",sourceTeam,sourceUnitId,name,contactProfile:"SURFACE"});}
  function triggerTrap(state,x,y,unit){const trap=effectAt(state,x,y).find(effect=>effect.type===EFFECT.TRAP);if(!trap||!unit?.alive||trap.sourceTeam===unit.team)return null;removeEffect(state,x,y,EFFECT.TRAP);return{type:"TRAP_TRIGGERED",x,y,trap:{...trap},unitId:unit.id,damage:Math.max(0,Number(trap.damage||0))};}
  function pathInteraction({state,x,y,kind="UNIT"}={}){const effects=effectAt(state,x,y),tornado=effects.find(e=>e.type===EFFECT.FIRE_TORNADO)||effects.find(e=>e.type===EFFECT.TORNADO);if(!tornado||kind==="SPACE")return{interrupted:false,effects:[]};if(kind==="PROJECTILE")return{interrupted:false,effects:[{type:"WIND_FIELD",effect:tornado}]};return{interrupted:true,effects:[{type:"FORCED_MOVE",effect:tornado,distance:Number(tornado.pushDistance||2),lift:Number(tornado.lift||0),resistAxes:tornado.resistAxes||{horizontal:false,vertical:true},damage:Number(tornado.damage||0)}]};}
  function tick(state){for(const [k,list] of [...state.effects.entries()]){const next=[];for(const effect of list){if(effect.duration==null){next.push(effect);continue;}const updated={...effect,duration:effect.duration-1};if(updated.duration>0)next.push(updated);}if(next.length)state.effects.set(k,next);else state.effects.delete(k);}}
  function lightSources(state){const out=[];for(const list of state.effects.values())for(const effect of list)if(effect.lightRadius>0)out.push({x:effect.x,y:effect.y,radius:effect.lightRadius,source:effect.type});return out;}
  function isLit(state,x,y){if(state.timeOfDay!=="NIGHT")return true;return lightSources(state).some(light=>Math.abs(light.x-x)+Math.abs(light.y-y)<=light.radius);}
  function visionModifier(state,x,y){const effects=effectAt(state,x,y);if(effects.some(e=>e.type===EFFECT.STEAM))return{blocked:true,reason:"STEAM"};const smoke=effects.find(e=>e.type===EFFECT.SMOKE);if(smoke){const intensity=Math.max(0,Number(smoke.intensity||0));if(intensity>=.45)return{blocked:true,dark:true,reason:"SMOKE",intensity};return{blocked:false,dark:true,reason:"SMOKE",intensity};}if(isBlizzard(state))return{blocked:false,dark:true,reason:"BLIZZARD"};if(isFog(state))return{blocked:false,dark:true,reason:"FOG",intensity:Number(fogAt(state).intensity||1)};if(state.timeOfDay==="NIGHT"&&!isLit(state,x,y))return{blocked:false,dark:true,reason:"NIGHT"};return{blocked:false,dark:false,reason:null};}
  function visionRange(state){let range=Infinity;if(isBlizzard(state))range=Math.min(range,3);if(isFog(state))range=Math.min(range,Number(fogAt(state).intensity||1)>=1.5?3:4);return range;}

  return{ELEMENT,FORCE,EFFECT,HAZARD,WEATHER,PRECIPITATION,CLIMATE_CHANNEL,WEATHER_RULES,WEATHER_TURNS,HYDROLOGY,create,setTimeOfDay,setWeather,setClimateChannel,applyClimatePreset,climateFromWeather,climateSnapshot,legacyWeather,normalizeWind,windAt,setWind,precipitationAt,fogAt,thunderAt,isFog,hasThunder,isRain,isSnow,isBlizzard,advanceHydrology,advanceSmoke,spreadFire,lightningRisk,rollWeatherEvent,environmentAt,effectAt,isBurning,isBoiling,isConductive,conductiveRegion,conductThunder,elevation,waterDepth,fillCapacity,addWater,removeWater,deformTerrain,apply,createTornado,createTrap,triggerTrap,pathInteraction,tick,lightSources,isLit,visionModifier,visionRange};
})();
globalThis.EnvironmentEngine=EnvironmentEngine;

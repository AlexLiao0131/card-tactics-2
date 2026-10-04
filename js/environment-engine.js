export const EnvironmentEngine=(()=>{
  const ELEMENT={NONE:"NONE",GRASS:"GRASS",WATER:"WATER",STONE:"STONE"};
  const FORCE={FIRE:"FIRE",HEAVY_FIRE:"HEAVY_FIRE",EXPLOSION:"EXPLOSION",WIND:"WIND",THUNDER:"THUNDER",IMPACT:"IMPACT",AVALANCHE_TRIGGER:"AVALANCHE_TRIGGER"};
  const EFFECT={BURNING:"BURNING",BOILING:"BOILING",STEAM:"STEAM",SMOKE:"SMOKE",FRAGMENTS:"FRAGMENTS",TORNADO:"TORNADO",FIRE_TORNADO:"FIRE_TORNADO",ELECTRIFIED:"ELECTRIFIED",SNOW:"SNOW",ICE:"ICE",CURRENT:"CURRENT",TRAP:"TRAP"};
  const WEATHER={CLEAR:"CLEAR",FOG:"FOG",RAIN:"RAIN",HEAVY_RAIN:"HEAVY_RAIN",THUNDERSTORM:"THUNDERSTORM",TYPHOON:"TYPHOON",SNOW:"SNOW",BLIZZARD:"BLIZZARD",SCORCHING_SUN:"SCORCHING_SUN"};
  const PRECIPITATION=Object.freeze({NONE:"NONE",RAIN:"RAIN",HEAVY_RAIN:"HEAVY_RAIN",SNOW:"SNOW"});
  const CLIMATE_CHANNEL=Object.freeze({PRECIPITATION:"PRECIPITATION",FOG:"FOG",THUNDER:"THUNDER",HEAT:"HEAT",TEMPERATURE:"TEMPERATURE",WIND:"WIND"});
  const WEATHER_RULES={THUNDERSTORM:{lightningChance:.35,lightningDamage:60,metalWeight:2,waterWeight:2,treeWeight:2},TYPHOON:{lightningChance:.46,lightningDamage:70,metalWeight:2,waterWeight:2.25,treeWeight:2}};
  const WEATHER_TURNS=Object.freeze({FOG:2,RAIN:3,HEAVY_RAIN:2,THUNDERSTORM:2,TYPHOON:2,SNOW:3,BLIZZARD:2,SCORCHING_SUN:3});
  const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
  const WIND_DIRECTION=Object.freeze({CALM:"CALM",N:"N",NE:"NE",E:"E",SE:"SE",S:"S",SW:"SW",W:"W",NW:"NW"});
  const WIND_VECTORS=Object.freeze({N:{x:0,y:-1},NE:{x:1,y:-1},E:{x:1,y:0},SE:{x:1,y:1},S:{x:0,y:1},SW:{x:-1,y:1},W:{x:-1,y:0},NW:{x:-1,y:-1},CALM:{x:0,y:0}});
  const WIND_LABEL=Object.freeze({CALM:"無風",N:"北向",NE:"東北向",E:"東向",SE:"東南向",S:"南向",SW:"西南向",W:"西向",NW:"西北向"});
  const WIND_SCALE=Object.freeze({MIN:0,MAX:8,TYPHOON:5.5,TORNADO:7.5});
  const WIND_LEVELS=Object.freeze([Object.freeze({level:0,label:"靜風"}),Object.freeze({level:1,label:"微風"}),Object.freeze({level:2,label:"和風"}),Object.freeze({level:3,label:"強風"}),Object.freeze({level:4,label:"烈風"}),Object.freeze({level:5,label:"暴風"}),Object.freeze({level:6,label:"颱風級"}),Object.freeze({level:7,label:"極端風暴"}),Object.freeze({level:8,label:"龍捲風級"})]);
  const METAL_EQUIPMENT_IDS=new Set(["black_sword","imperial_sword","standard_sword","blessed_sword","imperial_spear","imperial_hammer","imperial_medium_armor","imperial_heavy_shield_armor","water_medium_armor","imperial_heavy_armor","imperial_heavy_plate","imperial_large_shield","nereia_royal_trident","beast_dual_daggers","beast_poison_throwing_knife"]);
  const HAZARD={BURNING_DAMAGE:20,BOILING_DAMAGE:30,FIRE_TORNADO_DAMAGE:45,ELECTRIC_DAMAGE:35};
  // Water conducts thunder, but a strike is not an infinite-area switch. Energy
  // decays on every cardinal step through actual water and shallow water loses
  // additional energy. Rain and mud remain non-conductive unless they contain
  // real Hydrology water.
  const ELECTRIC_CONDUCTION=Object.freeze({BASE_POWER:1,MAX_DISTANCE:4,MIN_POWER:.22,STEP_LOSS:.19,SHALLOW_EXTRA_LOSS:.07});
  const HYDROLOGY=Object.freeze({WATERLINE:HydrologyEngine.WATERLINE,RAIN_FILL_PER_EVENT:HydrologyEngine.RAIN_FILL_PER_EVENT,HEAVY_RAIN_FILL_PER_EVENT:HydrologyEngine.HEAVY_RAIN_FILL_PER_EVENT,STORM_RAIN_FILL_PER_EVENT:HydrologyEngine.STORM_RAIN_FILL_PER_EVENT});
  function key(x,y){return `${x},${y}`;}
  function tileAt(map,x,y){return map?.tiles?.find(t=>t.x===x&&t.y===y)||null;}
  function objectAt(map,x,y){return window.EnvironmentObjectEngine?.activeObjectsAt?.(map,x,y)?.[0]||(map?.objects||[]).find(o=>!o.destroyed&&o.x===x&&o.y===y)||null;}
  const elevation=tile=>HydrologyEngine.elevation(tile);
  const waterDepth=tile=>HydrologyEngine.waterDepth(tile);
  function environmentAt(map,x,y){const object=objectAt(map,x,y);if(object?.environment)return object.environment;const tile=tileAt(map,x,y);return TERRAINS[tile?.terrain]?.environment||ELEMENT.NONE;}
  function windDirection(value={}){const strength=Math.max(0,Number(value?.strength||0));if(strength<=.001)return WIND_DIRECTION.CALM;const x=Math.sign(Number(value?.x||0)),y=Math.sign(Number(value?.y||0));return x===0&&y<0?WIND_DIRECTION.N:x>0&&y<0?WIND_DIRECTION.NE:x>0&&y===0?WIND_DIRECTION.E:x>0&&y>0?WIND_DIRECTION.SE:x===0&&y>0?WIND_DIRECTION.S:x<0&&y>0?WIND_DIRECTION.SW:x<0&&y===0?WIND_DIRECTION.W:x<0&&y<0?WIND_DIRECTION.NW:WIND_DIRECTION.CALM;}
  function windVector(direction="CALM"){return{...(WIND_VECTORS[String(direction||"CALM").toUpperCase()]||WIND_VECTORS.CALM)}}
  function windTier(value=0){const strength=Math.max(WIND_SCALE.MIN,Math.min(WIND_SCALE.MAX,Number(typeof value==="object"?value?.strength:value)||0)),level=Math.max(0,Math.min(8,Math.round(strength)));return{...WIND_LEVELS[level],strength};}
  // Presentation consumes the same 0-8 wind scale as the simulation. Individual
  // renderers may bound geometry displacement for mesh safety, but the weather
  // strength itself is never compressed (typhoon 5.8 stays 5.8, tornado 7.5 stays 7.5).
  function windVisualStrength(value=0){return Math.max(WIND_SCALE.MIN,Math.min(WIND_SCALE.MAX,Number(typeof value==="object"?value?.strength:value)||0));}
  function windLabel(value={}){const direction=typeof value==="string"?String(value).toUpperCase():windDirection(value);if(direction===WIND_DIRECTION.CALM)return WIND_LABEL.CALM;const strength=Math.max(0,Number(value?.strength||0)),tier=windTier(strength);return `${WIND_LABEL[direction]||direction}${strength>0?` ${strength.toFixed(2)}（${tier.label}）`:""}`;}
  function normalizeWind(value={}){
    const requestedDirection=String(value?.direction||"").toUpperCase(),vector=WIND_VECTORS[requestedDirection];
    let x=Number(value?.x??value?.windX??vector?.x??0),y=Number(value?.y??value?.windY??vector?.y??0),strength=Math.max(WIND_SCALE.MIN,Math.min(WIND_SCALE.MAX,Number(value?.strength??value?.windStrength??0)));
    if(!Number.isFinite(x))x=0;if(!Number.isFinite(y))y=0;if(!Number.isFinite(strength))strength=0;
    if(requestedDirection===WIND_DIRECTION.CALM||strength<=.001)return{x:0,y:0,strength:0,direction:WIND_DIRECTION.CALM,calm:true};
    x=Math.sign(x);y=Math.sign(y);if(x===0&&y===0)x=1;const normalized={x,y,strength};return{...normalized,direction:windDirection(normalized),calm:false};
  }
  function turns(value,fallback=null){if(value==null)return fallback;return Math.max(0,Number(value||0));}
  function climateFromWeather(weather="CLEAR",duration=null){
    const w=WEATHER[weather]?weather:WEATHER.CLEAR,d=duration==null?WEATHER_TURNS[w]??null:Math.max(0,Number(duration||0));
    const climate={
      precipitation:{type:PRECIPITATION.NONE,intensity:0,turnsRemaining:null},
      fog:{intensity:0,turnsRemaining:null},
      thunder:{intensity:0,turnsRemaining:null},
      heat:{intensity:0,turnsRemaining:null},
      temperature:null,
      wind:null
    };
    if(w===WEATHER.FOG)climate.fog={intensity:1,turnsRemaining:d};
    else if(w===WEATHER.RAIN)climate.precipitation={type:PRECIPITATION.RAIN,intensity:1,turnsRemaining:d};
    else if(w===WEATHER.HEAVY_RAIN)climate.precipitation={type:PRECIPITATION.HEAVY_RAIN,intensity:1.5,turnsRemaining:d};
    else if(w===WEATHER.THUNDERSTORM){climate.precipitation={type:PRECIPITATION.HEAVY_RAIN,intensity:1.5,turnsRemaining:d};climate.thunder={intensity:1,turnsRemaining:d};climate.wind={x:1,y:0,strength:1.85};}
    else if(w===WEATHER.TYPHOON){climate.precipitation={type:PRECIPITATION.HEAVY_RAIN,intensity:1.8,turnsRemaining:d};climate.thunder={intensity:1.25,turnsRemaining:d};climate.wind={x:1,y:0,strength:5.8};}
    else if(w===WEATHER.SNOW)climate.precipitation={type:PRECIPITATION.SNOW,intensity:1,turnsRemaining:d};
    else if(w===WEATHER.BLIZZARD){climate.precipitation={type:PRECIPITATION.SNOW,intensity:1.6,turnsRemaining:d};climate.wind={x:1,y:0,strength:2.1};}
    if(w===WEATHER.SCORCHING_SUN)climate.heat={intensity:1,turnsRemaining:d};
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
    const hasChannels=source.precipitation||source.fog||source.thunder||source.heat||source.temperature!=null||source.wind;
    if(!hasChannels){
      source.precipitation={...legacy.precipitation};source.fog={...legacy.fog};source.thunder={...legacy.thunder};source.heat={...legacy.heat};source.temperature=null;source.wind=legacy.wind?{...legacy.wind}:null;
    }else{
      source.precipitation=normalizeLayer(source.precipitation,{...legacy.precipitation});
      source.fog={intensity:Math.max(0,Number(source.fog?.intensity??0)),turnsRemaining:turns(source.fog?.turnsRemaining,null)};
      source.thunder={intensity:Math.max(0,Number(source.thunder?.intensity??0)),turnsRemaining:turns(source.thunder?.turnsRemaining,null)};
      if(source.temperature!=null&&!Number.isFinite(Number(source.temperature)))source.temperature=null;
    }
    source.heat={intensity:Math.max(0,Number(source.heat?.intensity??0)),turnsRemaining:turns(source.heat?.turnsRemaining,null)};
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
  function ensureWindStrength(state,strength){const current=windAt(state),minimum=Math.max(WIND_SCALE.MIN,Math.min(WIND_SCALE.MAX,Number(strength||0)));if(Number(current.strength||0)>=minimum)return current;return setWind(state,{x:Number(current.x||0)||1,y:Number(current.y||0),strength:minimum});}
  function localWindAt(state,x,y){const ambient=windAt(state),tornado=effectAt(state,x,y).find(effect=>effect.type===EFFECT.FIRE_TORNADO||effect.type===EFFECT.TORNADO);if(!tornado)return{...ambient,source:"AMBIENT",rotating:false,tier:windTier(ambient)};const strength=Math.max(Number(ambient.strength||0),Number(tornado.windStrength||tornado.baseWindStrength||WIND_SCALE.TORNADO));return{...ambient,strength:Math.min(WIND_SCALE.MAX,strength),source:"TORNADO",rotating:true,tier:windTier(strength)};}
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
    if(precipitation.type===PRECIPITATION.HEAVY_RAIN&&hasThunder(state)&&Number(wind.strength||0)>=WIND_SCALE.TYPHOON)return WEATHER.TYPHOON;
    if(hasThunder(state))return WEATHER.THUNDERSTORM;
    if(precipitation.type===PRECIPITATION.HEAVY_RAIN)return WEATHER.HEAVY_RAIN;
    if(precipitation.type===PRECIPITATION.RAIN)return WEATHER.RAIN;
    if(precipitation.type===PRECIPITATION.SNOW)return WEATHER.SNOW;
    if(isFog(state))return WEATHER.FOG;
    if(Number(state.climate?.heat?.intensity||0)>0)return WEATHER.SCORCHING_SUN;
    return WEATHER.CLEAR;
  }
  function compatibilityRemaining(state){
    const climate=state?.climate;if(!climate)return null;
    const values=[climate.precipitation?.turnsRemaining,climate.fog?.turnsRemaining,climate.thunder?.turnsRemaining,climate.heat?.turnsRemaining].filter(v=>v!=null).map(Number).filter(Number.isFinite);
    return values.length?Math.max(...values):null;
  }
  function syncLegacyWeather(state){
    if(!state)return;
    const w=legacyWeatherRaw(state);state.weather=w;state.weatherTurnsRemaining=compatibilityRemaining(state);
  }
  function legacyWeatherRaw(state){
    const climate=state?.climate||{},precipitation=climate.precipitation||{},wind=climate.wind||state?.wind||{};
    if(precipitation.type===PRECIPITATION.SNOW&&Number(wind.strength||0)>=1.75)return WEATHER.BLIZZARD;
    if(precipitation.type===PRECIPITATION.HEAVY_RAIN&&Number(climate.thunder?.intensity||0)>0&&Number(wind.strength||0)>=WIND_SCALE.TYPHOON)return WEATHER.TYPHOON;
    if(Number(climate.thunder?.intensity||0)>0)return WEATHER.THUNDERSTORM;
    if(precipitation.type===PRECIPITATION.HEAVY_RAIN)return WEATHER.HEAVY_RAIN;
    if(precipitation.type===PRECIPITATION.RAIN)return WEATHER.RAIN;
    if(precipitation.type===PRECIPITATION.SNOW)return WEATHER.SNOW;
    if(Number(climate.fog?.intensity||0)>0)return WEATHER.FOG;
    if(Number(climate.heat?.intensity||0)>0)return WEATHER.SCORCHING_SUN;
    return WEATHER.CLEAR;
  }
  function climateSnapshot(state){
    const climate=ensureClimate(state),precipitation=climate.precipitation||{},fog=climate.fog||{},thunder=climate.thunder||{};
    return{
      precipitation:{type:precipitation.type||PRECIPITATION.NONE,intensity:Number(precipitation.intensity||0),turnsRemaining:precipitation.turnsRemaining??null},
      fog:{intensity:Number(fog.intensity||0),turnsRemaining:fog.turnsRemaining??null},
      thunder:{intensity:Number(thunder.intensity||0),turnsRemaining:thunder.turnsRemaining??null},
      heat:{intensity:Number(climate.heat?.intensity||0),turnsRemaining:climate.heat?.turnsRemaining??null},
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
    }else if(name===CLIMATE_CHANNEL.HEAT){
      const input=typeof value==="object"&&value?value:{intensity:Number(value)||0};
      const heatIntensity=Math.max(0,Number(input.intensity??intensity??1));
      climate.heat={intensity:heatIntensity,turnsRemaining:heatIntensity>0?turns(input.turnsRemaining,duration):null};
    }else if(name===CLIMATE_CHANNEL.TEMPERATURE){
      climate.temperature=value==null||!Number.isFinite(Number(value))?null:Number(value);
    }else if(name===CLIMATE_CHANNEL.WIND){
      climate.wind=normalizeWind(value||{});state.wind={...climate.wind};
    }
    // Wet/obscured skies and heat are mutually exclusive; wind remains independent.
    if((name===CLIMATE_CHANNEL.PRECIPITATION&&climate.precipitation.type!==PRECIPITATION.NONE)||
       (name===CLIMATE_CHANNEL.FOG&&climate.fog.intensity>0)||
       (name===CLIMATE_CHANNEL.THUNDER&&climate.thunder.intensity>0))climate.heat={intensity:0,turnsRemaining:null};
    if(name===CLIMATE_CHANNEL.HEAT&&climate.heat.intensity>0){
      climate.precipitation={type:PRECIPITATION.NONE,intensity:0,turnsRemaining:null};
      climate.fog={intensity:0,turnsRemaining:null};climate.thunder={intensity:0,turnsRemaining:null};
      climate.temperature=null;
    }
    syncLegacyWeather(state);return climateSnapshot(state);
  }
  function applyClimatePreset(state,weather,{duration=null}={}){
    if(!state)return[];const climate=ensureClimate(state),resolved=WEATHER[weather]?weather:WEATHER.CLEAR,d=duration==null?WEATHER_TURNS[resolved]??null:Math.max(0,Number(duration||0)),touched=[];
    climate.heat={intensity:0,turnsRemaining:null};
    if(resolved===WEATHER.SCORCHING_SUN){setClimateChannel(state,CLIMATE_CHANNEL.HEAT,{intensity:1,turnsRemaining:d});touched.push(CLIMATE_CHANNEL.HEAT);}
    else if(resolved===WEATHER.CLEAR){
      climate.precipitation={type:PRECIPITATION.NONE,intensity:0,turnsRemaining:null};climate.fog={intensity:0,turnsRemaining:null};climate.thunder={intensity:0,turnsRemaining:null};touched.push(CLIMATE_CHANNEL.PRECIPITATION,CLIMATE_CHANNEL.FOG,CLIMATE_CHANNEL.THUNDER);
    }else if(resolved===WEATHER.FOG){setClimateChannel(state,CLIMATE_CHANNEL.FOG,{intensity:1,turnsRemaining:d});touched.push(CLIMATE_CHANNEL.FOG);}
    else if(resolved===WEATHER.RAIN){setClimateChannel(state,CLIMATE_CHANNEL.PRECIPITATION,{type:PRECIPITATION.RAIN,intensity:1,turnsRemaining:d});touched.push(CLIMATE_CHANNEL.PRECIPITATION);}
    else if(resolved===WEATHER.HEAVY_RAIN){setClimateChannel(state,CLIMATE_CHANNEL.PRECIPITATION,{type:PRECIPITATION.HEAVY_RAIN,intensity:1.5,turnsRemaining:d});touched.push(CLIMATE_CHANNEL.PRECIPITATION);}
    else if(resolved===WEATHER.THUNDERSTORM){setClimateChannel(state,CLIMATE_CHANNEL.PRECIPITATION,{type:PRECIPITATION.HEAVY_RAIN,intensity:1.5,turnsRemaining:d});setClimateChannel(state,CLIMATE_CHANNEL.THUNDER,{intensity:1,turnsRemaining:d});ensureWindStrength(state,1.85);touched.push(CLIMATE_CHANNEL.PRECIPITATION,CLIMATE_CHANNEL.THUNDER);}
    else if(resolved===WEATHER.TYPHOON){setClimateChannel(state,CLIMATE_CHANNEL.PRECIPITATION,{type:PRECIPITATION.HEAVY_RAIN,intensity:1.8,turnsRemaining:d});setClimateChannel(state,CLIMATE_CHANNEL.THUNDER,{intensity:1.25,turnsRemaining:d});ensureWindStrength(state,5.8);touched.push(CLIMATE_CHANNEL.PRECIPITATION,CLIMATE_CHANNEL.THUNDER);}
    else if(resolved===WEATHER.SNOW){setClimateChannel(state,CLIMATE_CHANNEL.PRECIPITATION,{type:PRECIPITATION.SNOW,intensity:1,turnsRemaining:d});touched.push(CLIMATE_CHANNEL.PRECIPITATION);}
    else if(resolved===WEATHER.BLIZZARD){setClimateChannel(state,CLIMATE_CHANNEL.PRECIPITATION,{type:PRECIPITATION.SNOW,intensity:1.6,turnsRemaining:d});ensureWindStrength(state,2.1);touched.push(CLIMATE_CHANNEL.PRECIPITATION);}
    syncLegacyWeather(state);return touched;
  }
  function create({timeOfDay="DAY",weather="CLEAR",weatherTurns=null,climate=null,wind=null,windX=null,windY=null,windStrength=null,temperature=null}={}){
    const legacy=climateFromWeather(weather,weatherTurns),baseClimate=climate&&typeof climate==="object"?JSON.parse(JSON.stringify(climate)):legacy;
    const resolvedWind=normalizeWind(wind||baseClimate.wind||{x:windX,y:windY,strength:windStrength});
    const state={timeOfDay,weather:WEATHER.CLEAR,weatherTurnsRemaining:null,wind:resolvedWind,effects:new Map(),destroyedObjects:new Set(),tornadoSerial:0,climate:{turn:0,...baseClimate,wind:resolvedWind}};
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
    else if(!isSnow(state))events.push(...HydrologyEngine.drySoil(map,{amount:HydrologyEngine.DRYING_PER_CLEAR_TURN*Number(window.ClimateEngine?.config?.(state)?.extraDrying||1),source:legacyWeatherRaw(state)}));
    if(window.ClimateEngine)events.push(...ClimateEngine.advance(map,state));
    advanceFireDryness(map,state,events);
    if(window.EnvironmentObjectEngine?.resolveWind){const ambientWind=windAt(state),source=legacyWeatherRaw(state)===WEATHER.TYPHOON?"TYPHOON_WIND":"AMBIENT_WIND";EnvironmentObjectEngine.resolveWind(map,state,ambientWind,{events,source});}
    if(window.EnvironmentResolver)events.push(...EnvironmentResolver.resolve(map,state,{source:"ENVIRONMENT_TICK"}));
    return events;
  }
  function climateChannels(){return[CLIMATE_CHANNEL.PRECIPITATION,CLIMATE_CHANNEL.FOG,CLIMATE_CHANNEL.THUNDER,CLIMATE_CHANNEL.HEAT];}
  function layerFor(state,channel){const climate=ensureClimate(state);if(channel===CLIMATE_CHANNEL.PRECIPITATION)return climate.precipitation;if(channel===CLIMATE_CHANNEL.FOG)return climate.fog;if(channel===CLIMATE_CHANNEL.THUNDER)return climate.thunder;if(channel===CLIMATE_CHANNEL.HEAT)return climate.heat;return null;}
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
  // Environmental fuel state, shared by all weather. A reproducible roll depends
  // on map seed, tile and climate pulse, never on render order or Math.random().
  function fireRoll(map,state,tile){
    let h=2166136261;
    for(const c of `${map.seed??map.id??"MAP"}:${state.climate.turn}:${tile.x},${tile.y}:FIRE`){h=Math.imul(h^c.charCodeAt(0),16777619);}
    h=Math.imul(h^(h>>>16),0x45d9f3b);h=Math.imul(h^(h>>>16),0x45d9f3b);
    return ((h^(h>>>16))>>>0)/4294967296;
  }
  function advanceFireDryness(map,state,events=[]){
    const raining=isRain(state),snowing=isSnow(state),wind=windAt(state);
    for(const tile of map?.tiles||[]){
      const before=Math.max(0,Math.min(1,Number(tile.fireDryness||0)));
      const wet=waterDepth(tile)>0||Number(tile.snowDepth||0)>0||Number(tile.iceThickness||0)>0;
      const moisture=HydrologyEngine.soilMoisture(tile)/Math.max(.01,HydrologyEngine.soilCapacity(tile));
      const temperature=window.ClimateEngine?.temperatureAt?.(state,tile)??7;
      const drying=.06+Math.max(0,temperature-10)*.014;
      tile.fireDryness=wet?0:raining||snowing?Math.max(0,before-.65):
        Math.max(0,Math.min(1,before+(moisture>.25?-.15*moisture:drying*(1-moisture))));
      if(wet||raining||snowing||moisture>.15||temperature<24||tile.fireDryness<.75||isBurning(state,tile.x,tile.y)||!flammableAt(map,tile.x,tile.y))continue;
      const chance=Math.min(.12,(.025+(tile.fireDryness-.75)*.22)*(1+wind.strength*.12));
      if(fireRoll(map,state,tile)>=chance)continue;
      addEffect(state,tile.x,tile.y,{type:EFFECT.BURNING,duration:3,lightRadius:2,damage:HAZARD.BURNING_DAMAGE,damageType:"FIRE",fireIntensity:"NORMAL"});
      addSmoke(state,tile.x,tile.y,{intensity:.9,duration:3,source:"NATURAL_FIRE"});
      events.push({type:"IGNITE",x:tile.x,y:tile.y,effect:EFFECT.BURNING,source:"NATURAL_FIRE"});
    }
    return events;
  }
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
  function tornadoGroups(map,state){
    if(!map||!state?.effects)return[];
    const cells=[];
    for(const[k,list]of state.effects.entries()){
      const effect=list.find(item=>item.type===EFFECT.FIRE_TORNADO)||list.find(item=>item.type===EFFECT.TORNADO);
      if(!effect)continue;const[x,y]=k.split(",").map(Number);if(tileAt(map,x,y))cells.push({x,y,effect:{...effect}});
    }
    const byKey=new Map(cells.map(cell=>[key(cell.x,cell.y),cell])),seen=new Set(),groups=[];
    for(const cell of cells){
      const start=key(cell.x,cell.y);if(seen.has(start))continue;
      const queue=[cell],group=[];seen.add(start);
      while(queue.length){
        const current=queue.shift();group.push(current);
        for(const[dx,dy]of DIRS){const nk=key(current.x+dx,current.y+dy),next=byKey.get(nk);if(!next||seen.has(nk))continue;seen.add(nk);queue.push(next);}
      }
      groups.push(group);
    }
    return groups;
  }
  function nextTornadoClusterId(state){
    state.tornadoSerial=Math.max(0,Number(state.tornadoSerial||0))+1;
    return`tornado-${state.tornadoSerial}`;
  }
  function tornadoClusterIds(group){return[...new Set((group||[]).map(entry=>entry.effect?.clusterId).filter(Boolean).map(String))].sort();}
  function tornadoClusterId(state,group){return tornadoClusterIds(group)[0]||nextTornadoClusterId(state);}
  function tornadoClusterStats(group,carriedOverride=null){
    const effects=(group||[]).map(entry=>entry.effect||{}),size=Math.max(1,group?.length||1);
    const maxBase=(field,fallback)=>Math.max(fallback,...effects.map(effect=>Math.max(0,Number(effect[`base${field}`]??effect[field.charAt(0).toLowerCase()+field.slice(1)]??fallback))));
    const basePushDistance=maxBase("PushDistance",2),baseLift=maxBase("Lift",3),baseWindStrength=maxBase("WindStrength",WIND_SCALE.TORNADO);
    const baseDamage=Math.max(20,...effects.map(effect=>Math.max(0,Number(effect.baseDamage??(effect.type===EFFECT.FIRE_TORNADO?20:effect.damage??20)))));
    const baseFireDamage=Math.max(HAZARD.FIRE_TORNADO_DAMAGE,...effects.map(effect=>Math.max(0,Number(effect.baseFireDamage??(effect.type===EFFECT.FIRE_TORNADO?effect.damage:HAZARD.FIRE_TORNADO_DAMAGE)??HAZARD.FIRE_TORNADO_DAMAGE))));
    const strength=Math.min(3.25,1+(size-1)*.45),tier=Math.min(3,Math.ceil((size-1)/2)),windStrength=Math.min(WIND_SCALE.MAX,baseWindStrength+Math.max(0,size-1)*.10);
    const carriedLogIds=[...new Set((carriedOverride||effects.flatMap(effect=>Array.isArray(effect.carriedLogIds)?effect.carriedLogIds:[])).map(String))];
    const pushDistance=Math.max(1,Math.round(basePushDistance+tier)),lift=Math.max(0,Math.round(baseLift+tier));
    const damage=Math.max(0,Math.round(baseDamage*(1+Math.min(.75,(size-1)*.22))));
    const fireDamage=Math.max(HAZARD.FIRE_TORNADO_DAMAGE,Math.round(baseFireDamage*(1+Math.min(.65,(size-1)*.18))));
    const debrisDamage=Math.min(42,carriedLogIds.length*10+Math.max(0,carriedLogIds.length-1)*3);
    return{size,strength,windStrength,baseWindStrength,basePushDistance,baseLift,baseDamage,baseFireDamage,pushDistance,lift,damage,fireDamage,carriedLogIds,carriedLogs:carriedLogIds.length,debrisDamage};
  }
  function tornadoSweepCells(map,group,dx,dy,steps){
    const seen=new Set(),out=[];
    const push=(x,y)=>{const tile=tileAt(map,x,y),k=key(x,y);if(!tile||seen.has(k))return;seen.add(k);out.push({x,y});};
    for(const entry of group)push(entry.x,entry.y);
    for(let step=1;step<=steps;step++)for(const entry of group)push(entry.x+dx*step,entry.y+dy*step);
    return out;
  }
  function tornadoNearbyCells(map,cells){
    const seen=new Set(),out=[];
    for(const point of cells||[])for(const[dx,dy]of [[0,0],...DIRS]){const x=point.x+dx,y=point.y+dy,k=key(x,y);if(seen.has(k)||!tileAt(map,x,y))continue;seen.add(k);out.push({x,y});}
    return out;
  }
  function rebindTornadoCargo(map,group,clusterId,events=[]){
    const engine=window.EnvironmentObjectEngine;if(!engine)return[];
    const ids=new Set((group||[]).flatMap(entry=>Array.isArray(entry.effect?.carriedLogIds)?entry.effect.carriedLogIds.map(String):[]));
    for(const previousId of tornadoClusterIds(group))for(const object of engine.carriedObjects?.(map,previousId)||[]){
      if(String(engine.normalizeType?.(object.type)||object.type||"").toUpperCase()!=="LOG")continue;
      engine.carryObject?.(map,object,clusterId,{events,reason:previousId===clusterId?"TORNADO_CARRY":"TORNADO_MERGE"});ids.add(String(object.id));
    }
    for(const id of [...ids]){
      const object=(map?.objects||[]).find(item=>!item?.destroyed&&String(item.id)===id);if(!object)continue;
      if(String(engine.normalizeType?.(object.type)||object.type||"").toUpperCase()!=="LOG")continue;
      engine.carryObject?.(map,object,clusterId,{events,reason:"TORNADO_CARRY"});
    }
    return[...ids];
  }
  function resolveTornadoWindObjects(map,state,cells,clusterId,carriedLogIds,events,windStrength){
    const engine=window.EnvironmentObjectEngine;if(!engine?.activeObjectsAt||!engine?.resolveWindAt)return carriedLogIds;
    const ids=new Set((carriedLogIds||[]).map(String)),strength=Math.max(WIND_SCALE.TORNADO,Number(windStrength||0));
    for(const point of cells||[]){
      engine.resolveWindAt(map,state,point.x,point.y,{x:0,y:0,strength},{events,source:"TORNADO_WIND"});
      for(const object of [...engine.activeObjectsAt(map,point.x,point.y)]){
        const type=String(engine.normalizeType?.(object.type)||object.type||"").toUpperCase();if(type!=="LOG")continue;
        if(strength<Math.max(0,Number(object.windCarryThreshold??engine.profile?.(type)?.windCarryThreshold??99)))continue;
        engine.carryObject?.(map,object,clusterId,{events,reason:"TORNADO_CARRY"});ids.add(String(object.id));
      }
    }
    return[...ids];
  }

  function releaseTornadoCargo(map,clusterId,carriedLogIds,cells,events,reason){
    const engine=window.EnvironmentObjectEngine;if(!engine?.releaseObject)return 0;
    const dropCells=(cells||[]).filter(point=>tileAt(map,point.x,point.y));if(!dropCells.length)return 0;
    const ids=[...new Set([...(carriedLogIds||[]).map(String),...(engine.carriedObjects?.(map,clusterId)||[]).map(object=>String(object.id))])];let released=0;
    for(let i=0;i<ids.length;i++){
      const object=(map?.objects||[]).find(item=>!item?.destroyed&&String(item.id)===ids[i]);if(!object)continue;
      const point=dropCells[i%dropCells.length];if(engine.releaseObject(map,object,point.x,point.y,{events,reason}))released++;
    }
    return released;
  }
  function extinguishByWaterTornado(map,state,cells,events){
    let count=0;
    for(const point of tornadoNearbyCells(map,cells)){
      if(!effectAt(state,point.x,point.y).some(effect=>effect.type===EFFECT.BURNING))continue;
      removeEffect(state,point.x,point.y,EFFECT.BURNING);count++;events.push({type:"TORNADO_EXTINGUISHED_FIRE",x:point.x,y:point.y});
    }
    return count;
  }
  function stokeByFireTornado(map,state,cells,events){
    let count=0;
    for(const point of tornadoNearbyCells(map,cells)){
      const burning=effectAt(state,point.x,point.y).find(effect=>effect.type===EFFECT.BURNING);if(!burning)continue;
      const before=String(burning.fireIntensity||"NORMAL").toUpperCase();
      burning.fireIntensity="HEAVY";burning.duration=Math.max(4,Number(burning.duration||0));burning.lightRadius=Math.max(3,Number(burning.lightRadius||0));burning.damage=Math.max(Number(burning.damage||0),Math.round(HAZARD.BURNING_DAMAGE*1.35));
      addSmoke(state,point.x,point.y,{intensity:1.35,duration:3,source:"FIRE_TORNADO_STOKE"});
      if(before!=="HEAVY"){count++;events.push({type:"FIRE_TORNADO_STOKED",x:point.x,y:point.y});}
    }
    return count;
  }
  function advanceTornadoes(map,state,events=[]){
    if(!map||!state?.effects)return events;
    const groups=tornadoGroups(map,state);if(!groups.length)return events;
    const wind=windAt(state),dx=Math.sign(Number(wind.x||0)),dy=Math.sign(Number(wind.y||0)),moveSteps=Number(wind.strength||0)<.25?0:(Number(wind.strength||0)>=2?2:1);
    const runtime=groups.map(group=>({group,clusterId:tornadoClusterId(state,group)}));
    for(const {group} of runtime)for(const entry of group){removeEffect(state,entry.x,entry.y,EFFECT.TORNADO);removeEffect(state,entry.x,entry.y,EFFECT.FIRE_TORNADO);}
    for(const {group,clusterId} of runtime){
      let carriedLogIds=rebindTornadoCargo(map,group,clusterId,events);const beforeStats=tornadoClusterStats(group,carriedLogIds),sweep=tornadoSweepCells(map,group,dx,dy,moveSteps);
      carriedLogIds=resolveTornadoWindObjects(map,state,sweep,clusterId,carriedLogIds,events,beforeStats.windStrength);
      const destination=group.map(entry=>({x:entry.x+dx*moveSteps,y:entry.y+dy*moveSteps,effect:entry.effect})).filter(entry=>tileAt(map,entry.x,entry.y));
      if(!destination.length){
        const drop=sweep.length?[sweep[sweep.length-1]]:group.map(entry=>({x:entry.x,y:entry.y}));releaseTornadoCargo(map,clusterId,carriedLogIds,drop,events,"TORNADO_LEFT_MAP");
        events.push({type:"TORNADO_DISSIPATED",clusterId,clusterSize:beforeStats.size,reason:"LEFT_MAP"});continue;
      }
      const hadWater=group.some(entry=>String(entry.effect.element||"").toUpperCase()==="WATER"),hadFire=group.some(entry=>entry.effect.type===EFFECT.FIRE_TORNADO||String(entry.effect.element||"").toUpperCase()==="FIRE");
      const waterTouched=hadWater||sweep.some(point=>HydrologyEngine.isWater(tileAt(map,point.x,point.y)));
      const fireTouched=!waterTouched&&(hadFire||sweep.some(point=>effectAt(state,point.x,point.y).some(effect=>effect.type===EFFECT.BURNING)));
      const element=waterTouched?"WATER":fireTouched?"FIRE":"AIR",type=element==="FIRE"?EFFECT.FIRE_TORNADO:EFFECT.TORNADO;
      if(element==="WATER")extinguishByWaterTornado(map,state,sweep,events);else if(element==="FIRE")stokeByFireTornado(map,state,sweep,events);
      const stats=tornadoClusterStats(destination.map(entry=>({x:entry.x,y:entry.y,effect:entry.effect})),carriedLogIds),duration=Math.max(1,...group.map(entry=>Number(entry.effect.duration||1))),resolvedDamage=element==="FIRE"?stats.fireDamage:stats.damage;
      for(const entry of destination){
        const effect={type,duration,element,clusterId,clusterSize:stats.size,clusterStrength:stats.strength,windStrength:stats.windStrength,baseWindStrength:stats.baseWindStrength,basePushDistance:stats.basePushDistance,baseLift:stats.baseLift,baseDamage:stats.baseDamage,baseFireDamage:stats.baseFireDamage,pushDistance:stats.pushDistance,lift:stats.lift,damage:resolvedDamage,damageType:element==="FIRE"?"FIRE":element==="WATER"?"WATER":"PHYSICAL",resistAxes:{...(entry.effect.resistAxes||{horizontal:false,vertical:true})},visionBlock:false,carriedLogIds:[...carriedLogIds],carriedLogs:carriedLogIds.length,debrisDamage:stats.debrisDamage};
        if(element==="FIRE")effect.lightRadius=3;addEffect(state,entry.x,entry.y,effect);
      }
      if(element==="WATER"&&!hadWater)events.push({type:"WATER_TORNADO_FORMED",clusterId,x:destination[0].x,y:destination[0].y,clusterSize:stats.size});
      if(element==="FIRE"&&!hadFire)events.push({type:"FIRE_TORNADO_CREATED",clusterId,x:destination[0].x,y:destination[0].y,effect:EFFECT.FIRE_TORNADO,source:"TORNADO_CONTACT_FIRE"});
      events.push({type:"TORNADO_ADVANCED",clusterId,path:sweep,from:group.map(entry=>({x:entry.x,y:entry.y})),to:destination.map(entry=>({x:entry.x,y:entry.y})),dx,dy,moved:moveSteps,wind:{...wind},windStrength:stats.windStrength,element,clusterSize:stats.size,clusterStrength:stats.strength,pushDistance:stats.pushDistance,lift:stats.lift,damage:resolvedDamage,damageType:element==="FIRE"?"FIRE":element==="WATER"?"WATER":"PHYSICAL",carriedLogs:carriedLogIds.length,debrisDamage:stats.debrisDamage,contactProfile:"AIR_COLUMN",height:stats.lift+3});
      if(duration<=1)releaseTornadoCargo(map,clusterId,carriedLogIds,destination,events,"TORNADO_EXPIRED");
    }
    if(window.EnvironmentResolver&&events.some(event=>String(event?.reason||event?.source||"").includes("TORNADO_WIND")))events.push(...EnvironmentResolver.resolve(map,state,{source:"TORNADO_WIND"}));
    recordDestroyedObjects(state,events);return events;
  }
  function advanceEnvironmentTurn(map,state){
    if(!map||!state)return[];const events=[];ensureClimate(state);expireClimate(state,events);weatherPulse(map,state,events);decrementClimate(state);
    advanceTornadoes(map,state,events);windDrivenWaterEvents(map,state,events);events.push(...spreadFire(map,state));window.EnvironmentObjectEngine?.tickBurning?.(map,state,events);advanceSmoke(map,state,events);recordDestroyedObjects(state,events);return events;
  }
  function setWeather(state,weather,map=null,{duration=null,applyPulse=true}={}){
    if(!state)return[];const resolved=WEATHER[weather]?weather:WEATHER.CLEAR,touched=applyClimatePreset(state,resolved,{duration}),events=[];
    if(isRain(state)||isSnow(state)){
      for(const [k,list] of [...state.effects.entries()]){
        if(!list.some(e=>e.type===EFFECT.BURNING))continue;
        const [x,y]=k.split(",").map(Number);removeEffect(state,x,y,EFFECT.BURNING);events.push({type:isRain(state)?"RAIN_EXTINGUISHED_FIRE":"SNOW_EXTINGUISHED_FIRE",x,y});
      }
    }
    if(map&&applyPulse){if(touched.includes(CLIMATE_CHANNEL.PRECIPITATION)||touched.includes(CLIMATE_CHANNEL.HEAT))weatherPulse(map,state,events);decrementClimate(state,touched);}
    events.push({type:"WEATHER_SET",weather:resolved,duration:resolved===WEATHER.CLEAR?0:Number(duration??WEATHER_TURNS[resolved]??1),remaining:Number(state.weatherTurnsRemaining??0),climate:climateSnapshot(state)});
    for(const channel of touched)events.push({type:"CLIMATE_SET",channel,climate:climateSnapshot(state)});
    return events;
  }

  function waterComponents(map){
    const water=(map?.tiles||[]).filter(tile=>HydrologyEngine.isWater(tile)),byKey=new Map(water.map(tile=>[key(tile.x,tile.y),tile])),seen=new Set(),out=[];
    for(const tile of water){
      const start=key(tile.x,tile.y);if(seen.has(start))continue;
      const queue=[tile],group=[];seen.add(start);
      while(queue.length){
        const current=queue.shift();group.push(current);
        for(const[dx,dy]of DIRS){const nk=key(current.x+dx,current.y+dy),next=byKey.get(nk);if(!next||seen.has(nk))continue;seen.add(nk);queue.push(next);}
      }
      out.push(group);
    }
    return out;
  }
  function waterWindProfile(map,state,group){
    if(!group?.length||legacyWeatherRaw(state)!==WEATHER.TYPHOON)return null;
    const wind=windAt(state),length=Math.hypot(Number(wind.x||0),Number(wind.y||0));
    if(length<=.001||Number(wind.strength||0)<WIND_SCALE.TYPHOON)return null;
    const ux=Number(wind.x||0)/length,uy=Number(wind.y||0)/length,px=-uy,py=ux;
    const along=group.map(tile=>Number(tile.x)*ux+Number(tile.y)*uy),across=group.map(tile=>Number(tile.x)*px+Number(tile.y)*py);
    const fetch=Math.max(...along)-Math.min(...along)+1,crossSpan=Math.max(...across)-Math.min(...across)+1;
    const avgDepth=group.reduce((sum,tile)=>sum+waterDepth(tile),0)/group.length,avgFlow=group.reduce((sum,tile)=>sum+Math.max(0,Number(tile.flowSpeed||0)),0)/group.length;
    const windForce=Number(wind.strength||0)*(1+Math.min(fetch,10)*.12)*(.90+Math.min(avgDepth,1.5)*.22)+Math.min(avgFlow,3.2)*.35;
    const qualified=group.length>=8&&fetch>=4&&crossSpan>=2&&avgDepth>=.30&&windForce>=8.30;
    return{qualified,wind:{...wind},ux,uy,fetch,crossSpan,avgDepth,avgFlow,windForce};
  }
  function windDrivenWaterEvents(map,state,events=[]){
    if(!map||!state||legacyWeatherRaw(state)!==WEATHER.TYPHOON)return events;
    const candidates=waterComponents(map).map(group=>({group,profile:waterWindProfile(map,state,group)})).filter(entry=>entry.profile?.qualified).sort((a,b)=>b.profile.windForce-a.profile.windForce).slice(0,2);
    for(const {group,profile} of candidates){
      const force=profile.windForce,submergeTurns=force>=11?2:1,damage=Math.round(10+force*2),waveHeight=Math.max(.38,Math.min(.82,.38+(force-8.3)*.09)),durationMs=Math.round(Math.max(1200,Math.min(2600,900+profile.fetch*140)));
      const cells=group.map(tile=>({x:Number(tile.x),y:Number(tile.y)})).sort((a,b)=>(a.x*profile.ux+a.y*profile.uy)-(b.x*profile.ux+b.y*profile.uy));
      events.push({type:"ROGUE_WAVE",weather:WEATHER.TYPHOON,cells,dx:Math.sign(profile.ux),dy:Math.sign(profile.uy),windForce:Number(force.toFixed(2)),windStrength:Number(profile.wind.strength||0),fetch:Number(profile.fetch.toFixed(2)),crossSpan:Number(profile.crossSpan.toFixed(2)),averageDepth:Number(profile.avgDepth.toFixed(2)),averageFlow:Number(profile.avgFlow.toFixed(2)),submergeForce:Number(force.toFixed(2)),submergeTurns,damage,waveHeight:Number(waveHeight.toFixed(3)),durationMs,derivedFromWind:true,contactProfile:"WAVE_VOLUME"});
    }
    return events;
  }
  function hasMetalEquipment(unit){return EquipmentDatabase.equippedItems(unit?.character).some(item=>item?.material==="METAL"||item?.conductive===true||METAL_EQUIPMENT_IDS.has(item?.id));}
  function lightningRisk(map,unit,rules=WEATHER_RULES.THUNDERSTORM){if(!unit?.alive)return{weight:0,reasons:[]};let weight=1;const reasons=[];if(hasMetalEquipment(unit)){weight*=rules.metalWeight;reasons.push("METAL");}const material=environmentAt(map,unit.x,unit.y);if(material===ELEMENT.WATER){weight*=rules.waterWeight;reasons.push("WATER");}if(material===ELEMENT.GRASS){weight*=rules.treeWeight;reasons.push("TREE");}return{weight,reasons};}
  function rollWeatherEvent({map,state,units=[],random=Math.random}){if(!state||!hasThunder(state))return[];const rules=legacyWeatherRaw(state)===WEATHER.TYPHOON?WEATHER_RULES.TYPHOON:WEATHER_RULES.THUNDERSTORM,intensity=Math.max(.1,Number(thunderAt(state).intensity||1)),chance=Math.min(.85,rules.lightningChance*intensity);if(random()>=chance)return[];const candidates=units.filter(u=>u?.alive).map(unit=>({unit,...lightningRisk(map,unit,rules)})).filter(x=>x.weight>0);if(!candidates.length)return[];let roll=random()*candidates.reduce((n,x)=>n+x.weight,0),chosen=candidates[candidates.length-1];for(const candidate of candidates){roll-=candidate.weight;if(roll<=0){chosen=candidate;break;}}return[{type:"LIGHTNING_STRIKE",unit:chosen.unit,x:chosen.unit.x,y:chosen.unit.y,damage:rules.lightningDamage,riskReasons:chosen.reasons,weight:chosen.weight}];}
  function effectAt(state,x,y){return state?.effects?.get(key(x,y))||[];}
  function addEffect(state,x,y,effect){const k=key(x,y),list=state.effects.get(k)||[],same=list.find(e=>e.type===effect.type);if(same)Object.assign(same,effect);else list.push({...effect,x,y});state.effects.set(k,list);return same||list[list.length-1];}
  function removeEffect(state,x,y,type){const k=key(x,y),next=(state.effects.get(k)||[]).filter(e=>e.type!==type);if(next.length)state.effects.set(k,next);else state.effects.delete(k);}
  function destroyStoneObject(map,state,object){if(!object?.destructible)return false;object.destroyed=true;state.destroyedObjects.add(object.id);const tile=tileAt(map,object.x,object.y);if(tile&&object.breaksIntoTerrain)tile.terrain=object.breaksIntoTerrain;return true;}
  function isBurning(state,x,y){return effectAt(state,x,y).some(e=>e.type===EFFECT.BURNING||e.type===EFFECT.FIRE_TORNADO);}
  function isBoiling(state,x,y){return effectAt(state,x,y).some(e=>e.type===EFFECT.BOILING);}
  function isConductive(map,state,x,y){return HydrologyEngine.isWater(tileAt(map,x,y));}
  function conductivePropagation(map,state,x,y,{power=ELECTRIC_CONDUCTION.BASE_POWER,maxDistance=ELECTRIC_CONDUCTION.MAX_DISTANCE}={}){
    const origin=tileAt(map,x,y);if(!HydrologyEngine.isWater(origin))return[];
    const startPower=Math.max(0,Number(power||0));if(startPower<ELECTRIC_CONDUCTION.MIN_POWER)return[];
    const limit=Math.max(0,Math.floor(Number(maxDistance||0))),queue=[{tile:origin,distance:0,power:startPower}],best=new Map([[key(x,y),startPower]]),out=[];
    while(queue.length){
      const current=queue.shift();out.push(current);if(current.distance>=limit)continue;
      for(const[dx,dy]of DIRS){
        const next=tileAt(map,current.tile.x+dx,current.tile.y+dy);if(!next||!HydrologyEngine.isWater(next))continue;
        const depth=waterDepth(next),shallowLoss=depth<.25?ELECTRIC_CONDUCTION.SHALLOW_EXTRA_LOSS:depth<.55?ELECTRIC_CONDUCTION.SHALLOW_EXTRA_LOSS*.5:0;
        const nextPower=Math.max(0,current.power-ELECTRIC_CONDUCTION.STEP_LOSS-shallowLoss),nextDistance=current.distance+1,nk=key(next.x,next.y);
        if(nextPower<ELECTRIC_CONDUCTION.MIN_POWER||nextDistance>limit||nextPower<=Number(best.get(nk)||0)+1e-6)continue;
        best.set(nk,nextPower);queue.push({tile:next,distance:nextDistance,power:nextPower});
      }
    }
    return out.sort((a,b)=>a.distance-b.distance||a.tile.y-b.tile.y||a.tile.x-b.tile.x);
  }
  function conductiveRegion(map,state,x,y,options={}){return conductivePropagation(map,state,x,y,options).map(entry=>entry.tile);}

  function addSteam(state,x,y,events,{duration=2,reason="HEAT"}={}){const existed=effectAt(state,x,y).some(e=>e.type===EFFECT.STEAM);addEffect(state,x,y,{type:EFFECT.STEAM,duration,visionBlock:true});if(!existed)events.push({type:"STEAM_CREATED",x,y,effect:EFFECT.STEAM,reason});}
  function heatWater(map,state,x,y,events=[]){
    const tile=tileAt(map,x,y);if(!HydrologyEngine.isWater(tile))return false;
    const existing=effectAt(state,x,y).find(e=>e.type===EFFECT.BOILING),heat=Number(existing?.heat||0)+1;
    addEffect(state,x,y,{type:EFFECT.BOILING,duration:2,heat,damage:HAZARD.BOILING_DAMAGE,damageType:"FIRE"});addSteam(state,x,y,events,{duration:existing?2:1,reason:existing?"BOILING":"BOILING_START"});
    if(!existing){events.push({type:"WATER_BOILING",x,y,effect:EFFECT.BOILING,heat,waterDepth:waterDepth(tile)});return true;}
    const removed=removeWater(tile,1,events);events.push({type:"WATER_EVAPORATION",x,y,amount:removed,heat,waterDepth:waterDepth(tile)});HydrologyEngine.redistribute(map,{source:"EVAPORATION",events});
    if(!HydrologyEngine.isWater(tile)){removeEffect(state,x,y,EFFECT.BOILING);events.push({type:"WATER_BOILED_DRY",x,y});}return true;
  }
  function conductThunder(map,state,x,y,events=[],{damagedUnitIds=[],power=ELECTRIC_CONDUCTION.BASE_POWER,maxDistance=ELECTRIC_CONDUCTION.MAX_DISTANCE}={}){
    const propagation=conductivePropagation(map,state,x,y,{power,maxDistance}),hitRegistry=[...new Set(damagedUnitIds.map(String))];
    for(const entry of propagation){
      const damage=Math.max(8,Math.round(HAZARD.ELECTRIC_DAMAGE*entry.power)),tile=entry.tile;
      addEffect(state,tile.x,tile.y,{type:EFFECT.ELECTRIFIED,duration:1,damage,damageType:"THUNDER",damagedUnitIds:hitRegistry,origin:{x,y},conductionPower:entry.power,conductionDistance:entry.distance});
    }
    if(propagation.length)events.push({type:"ELECTRIC_CONDUCTION",x,y,effect:EFFECT.ELECTRIFIED,origin:{x,y},regionSize:propagation.length,maxDistance:Math.max(...propagation.map(entry=>entry.distance)),tiles:propagation.map(entry=>({x:entry.tile.x,y:entry.tile.y,distance:entry.distance,power:Number(entry.power.toFixed(3)),damage:Math.max(8,Math.round(HAZARD.ELECTRIC_DAMAGE*entry.power))}))});
    return propagation.map(entry=>entry.tile);
  }

  function apply({map,state,x,y,forces=[]}){
    const forceSet=new Set(forces),events=[],raining=isRain(state),burningBefore=isBurning(state,x,y),steamBefore=effectAt(state,x,y).some(e=>e.type===EFFECT.STEAM),smokeBefore=effectAt(state,x,y).some(e=>e.type===EFFECT.SMOKE),stoneObjectBefore=objectAt(map,x,y);
    if((forceSet.has(FORCE.FIRE)||forceSet.has(FORCE.HEAVY_FIRE))&&window.ClimateEngine)events.push(...ClimateEngine.applyHeat(map,state,x,y,{heavy:forceSet.has(FORCE.HEAVY_FIRE)}));
    if(forceSet.has(FORCE.IMPACT))events.push(...deformTerrain(map,x,y,{deltaElevation:-1,source:"IMPACT"}));
    if(window.EnvironmentObjectEngine){const objectForces=[...forceSet].filter(force=>force!==FORCE.FIRE||!raining);EnvironmentObjectEngine.applyForces(map,x,y,objectForces,{events});}
    const environment=environmentAt(map,x,y);
    if(forceSet.has(FORCE.WIND)&&steamBefore){removeEffect(state,x,y,EFFECT.STEAM);events.push({type:"STEAM_DISPERSED",x,y});}
    if(forceSet.has(FORCE.WIND)&&smokeBefore){removeEffect(state,x,y,EFFECT.SMOKE);events.push({type:"SMOKE_DISPERSED",x,y});}
    if(forceSet.has(FORCE.WIND)&&burningBefore)events.push(createTornado(state,x,y,{map,duration:2}));
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

  function createTornado(state,x,y,{map=null,duration=2,pushDistance=2,lift=3,damage=20,fireDamage=45,resistAxes={horizontal:false,vertical:true}}={}){
    const clusterId=nextTornadoClusterId(state),water=!!map&&HydrologyEngine.isWater(tileAt(map,x,y)),burning=!water&&isBurning(state,x,y),base={duration,clusterId,basePushDistance:pushDistance,baseLift:lift,baseDamage:damage,baseFireDamage:fireDamage,baseWindStrength:WIND_SCALE.TORNADO,windStrength:WIND_SCALE.TORNADO,pushDistance,lift,resistAxes:{...resistAxes},clusterSize:1,clusterStrength:1,carriedLogIds:[],carriedLogs:0,debrisDamage:0,visionBlock:false};
    if(water){addEffect(state,x,y,{...base,type:EFFECT.TORNADO,element:"WATER",damage,damageType:"WATER"});return{type:"WATER_TORNADO_FORMED",clusterId,x,y,effect:EFFECT.TORNADO,clusterSize:1};}
    if(burning){addEffect(state,x,y,{...base,type:EFFECT.FIRE_TORNADO,element:"FIRE",lightRadius:3,damage:fireDamage,damageType:"FIRE"});return{type:"FIRE_TORNADO_CREATED",clusterId,x,y,effect:EFFECT.FIRE_TORNADO};}
    addEffect(state,x,y,{...base,type:EFFECT.TORNADO,element:"AIR",damage,damageType:"PHYSICAL"});return{type:"TORNADO_CREATED",clusterId,x,y,effect:EFFECT.TORNADO};
  }
  function createTrap(state,x,y,{duration=4,damage=25,sourceTeam=null,sourceUnitId=null,name="陷阱"}={}){if(!state?.effects)return null;return addEffect(state,x,y,{type:EFFECT.TRAP,duration,damage:Math.max(0,Number(damage||0)),damageType:"PHYSICAL",sourceTeam,sourceUnitId,name,contactProfile:"SURFACE"});}
  function triggerTrap(state,x,y,unit){const trap=effectAt(state,x,y).find(effect=>effect.type===EFFECT.TRAP);if(!trap||!unit?.alive||trap.sourceTeam===unit.team)return null;removeEffect(state,x,y,EFFECT.TRAP);return{type:"TRAP_TRIGGERED",x,y,trap:{...trap},unitId:unit.id,damage:Math.max(0,Number(trap.damage||0))};}
  function pathInteraction({state,x,y,kind="UNIT"}={}){
    const effects=effectAt(state,x,y),tornado=effects.find(e=>e.type===EFFECT.FIRE_TORNADO)||effects.find(e=>e.type===EFFECT.TORNADO);if(!tornado||kind==="SPACE")return{interrupted:false,effects:[]};if(kind==="PROJECTILE")return{interrupted:false,effects:[{type:"WIND_FIELD",effect:tornado}]};
    const debrisDamage=Math.max(0,Number(tornado.debrisDamage||0));
    return{interrupted:true,effects:[{type:"FORCED_MOVE",effect:tornado,distance:Number(tornado.pushDistance||2),lift:Number(tornado.lift||0),resistAxes:tornado.resistAxes||{horizontal:false,vertical:true},damage:Number(tornado.damage||0)+debrisDamage,debrisDamage,element:String(tornado.element||"AIR").toUpperCase()}]};
  }
  function tick(state){for(const [k,list] of [...state.effects.entries()]){const next=[];for(const effect of list){if(effect.duration==null){next.push(effect);continue;}const updated={...effect,duration:effect.duration-1};if(updated.duration>0)next.push(updated);}if(next.length)state.effects.set(k,next);else state.effects.delete(k);}}
  function lightSources(state){const out=[];for(const list of state.effects.values())for(const effect of list)if(effect.lightRadius>0)out.push({x:effect.x,y:effect.y,radius:effect.lightRadius,source:effect.type});return out;}
  function illuminationBonus(state,x,y){
    let bonus=0;
    for(const light of lightSources(state)){
      const distance=Math.abs(light.x-x)+Math.abs(light.y-y);
      if(distance<=light.radius)bonus=Math.max(bonus,Math.min(2,light.radius-distance+1));
    }
    return bonus;
  }
  function isLit(state,x,y){if(state.timeOfDay!=="NIGHT")return true;return lightSources(state).some(light=>Math.abs(light.x-x)+Math.abs(light.y-y)<=light.radius);}
  function visionModifier(state,x,y){const effects=effectAt(state,x,y);if(effects.some(e=>e.type===EFFECT.STEAM))return{blocked:true,reason:"STEAM"};const smoke=effects.find(e=>e.type===EFFECT.SMOKE);if(smoke){const intensity=Math.max(0,Number(smoke.intensity||0));if(intensity>=.45)return{blocked:true,dark:true,reason:"SMOKE",intensity};return{blocked:false,dark:true,reason:"SMOKE",intensity};}if(isBlizzard(state))return{blocked:false,dark:true,reason:"BLIZZARD"};if(isFog(state))return{blocked:false,dark:true,reason:"FOG",intensity:Number(fogAt(state).intensity||1)};if(state.timeOfDay==="NIGHT"&&!isLit(state,x,y))return{blocked:false,dark:true,reason:"NIGHT"};return{blocked:false,dark:false,reason:null};}
  function visionRange(state){let range=Infinity;if(isBlizzard(state))range=Math.min(range,3);if(isFog(state))range=Math.min(range,Number(fogAt(state).intensity||1)>=1.5?3:4);return range;}

  return{ELEMENT,FORCE,EFFECT,HAZARD,ELECTRIC_CONDUCTION,WEATHER,PRECIPITATION,CLIMATE_CHANNEL,WIND_DIRECTION,WIND_VECTORS,WIND_LABEL,WIND_SCALE,WIND_LEVELS,WEATHER_RULES,WEATHER_TURNS,HYDROLOGY,create,setTimeOfDay,setWeather,setClimateChannel,applyClimatePreset,climateFromWeather,climateSnapshot,legacyWeather,normalizeWind,windDirection,windVector,windTier,windVisualStrength,windLabel,windAt,localWindAt,setWind,precipitationAt,fogAt,thunderAt,isFog,hasThunder,isRain,isSnow,isBlizzard,advanceEnvironmentTurn,advanceTornadoes,advanceSmoke,spreadFire,waterComponents,waterWindProfile,windDrivenWaterEvents,lightningRisk,rollWeatherEvent,environmentAt,effectAt,isBurning,isBoiling,isConductive,conductivePropagation,conductiveRegion,conductThunder,elevation,waterDepth,fillCapacity,addWater,removeWater,deformTerrain,apply,createTornado,createTrap,triggerTrap,pathInteraction,tick,lightSources,illuminationBonus,isLit,visionModifier,visionRange};
})();
globalThis.EnvironmentEngine=EnvironmentEngine;

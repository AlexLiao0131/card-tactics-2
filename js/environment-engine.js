export const EnvironmentEngine=(()=>{
  const ELEMENT={NONE:"NONE",GRASS:"GRASS",WATER:"WATER",STONE:"STONE"};
  const FORCE={FIRE:"FIRE",HEAVY_FIRE:"HEAVY_FIRE",EXPLOSION:"EXPLOSION",WIND:"WIND",THUNDER:"THUNDER",IMPACT:"IMPACT",AVALANCHE_TRIGGER:"AVALANCHE_TRIGGER"};
  const EFFECT={BURNING:"BURNING",BOILING:"BOILING",STEAM:"STEAM",SMOKE:"SMOKE",FRAGMENTS:"FRAGMENTS",TORNADO:"TORNADO",FIRE_TORNADO:"FIRE_TORNADO",ELECTRIFIED:"ELECTRIFIED",SNOW:"SNOW",ICE:"ICE",CURRENT:"CURRENT"};
  const WEATHER={CLEAR:"CLEAR",FOG:"FOG",RAIN:"RAIN",HEAVY_RAIN:"HEAVY_RAIN",THUNDERSTORM:"THUNDERSTORM",SNOW:"SNOW",BLIZZARD:"BLIZZARD"};
  const WEATHER_RULES={THUNDERSTORM:{lightningChance:0.35,lightningDamage:60,metalWeight:2,waterWeight:2,treeWeight:2}};
  const WEATHER_TURNS=Object.freeze({FOG:2,RAIN:3,HEAVY_RAIN:2,THUNDERSTORM:2,SNOW:3,BLIZZARD:2});
  const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
  const METAL_EQUIPMENT_IDS=new Set(["black_sword","imperial_sword","standard_sword","blessed_sword","imperial_spear","imperial_hammer","imperial_medium_armor","imperial_heavy_shield_armor","water_medium_armor","imperial_heavy_armor","imperial_heavy_plate","imperial_large_shield"]);
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
  function windAt(state){state.wind=normalizeWind(state?.wind||{});return state.wind;}
  function setWind(state,value){if(!state)return null;state.wind=normalizeWind(value);return state.wind;}
  function create({timeOfDay="DAY",weather="CLEAR",weatherTurns=null,wind=null,windX=null,windY=null,windStrength=null}={}){
    const resolvedWind=normalizeWind(wind||{x:windX,y:windY,strength:windStrength});
    return{timeOfDay,weather:weather||WEATHER.CLEAR,weatherTurnsRemaining:weatherTurns==null?null:Math.max(0,Number(weatherTurns||0)),wind:resolvedWind,effects:new Map(),destroyedObjects:new Set(),climate:{turn:0}};
  }
  function setTimeOfDay(state,timeOfDay){state.timeOfDay=timeOfDay==="NIGHT"?"NIGHT":"DAY";}
  const fillCapacity=tile=>HydrologyEngine.fillCapacity(tile);
  const addWater=(tile,amount,events=[])=>HydrologyEngine.addWater(tile,amount,events);
  const removeWater=(tile,amount,events=[])=>HydrologyEngine.removeWater(tile,amount,events);
  const deformTerrain=(map,x,y,options={})=>HydrologyEngine.deformTerrain(map,x,y,options);

  function isRain(state){return state?.weather===WEATHER.RAIN||state?.weather===WEATHER.HEAVY_RAIN||state?.weather===WEATHER.THUNDERSTORM;}
  function isSnow(state){return state?.weather===WEATHER.SNOW||state?.weather===WEATHER.BLIZZARD;}
  function rainAmount(weather){if(weather===WEATHER.THUNDERSTORM)return Number(HydrologyEngine.STORM_RAIN_FILL_PER_EVENT??0.16);if(weather===WEATHER.HEAVY_RAIN)return Number(HydrologyEngine.HEAVY_RAIN_FILL_PER_EVENT??0.12);return Number(HydrologyEngine.RAIN_FILL_PER_EVENT??0.06);}
  function applyRainToTerrain(map,state){const weather=state?.weather||WEATHER.RAIN,heavy=weather!==WEATHER.RAIN;return HydrologyEngine.applyRain(map,{heavy,amount:rainAmount(weather),source:weather});}
  function weatherPulse(map,state,events=[]){
    if(isRain(state))events.push(...applyRainToTerrain(map,state));
    else if(!isSnow(state))events.push(...HydrologyEngine.drySoil(map,{source:"CLEAR_WEATHER"}));
    if(window.ClimateEngine)events.push(...ClimateEngine.advance(map,state));
    if(window.EnvironmentResolver)events.push(...EnvironmentResolver.resolve(map,state,{source:"ENVIRONMENT_TICK"}));
    return events;
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
    const rainFactor=state.weather===WEATHER.THUNDERSTORM||state.weather===WEATHER.HEAVY_RAIN?.35:state.weather===WEATHER.RAIN?.55:isSnow(state)?.68:1;
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
    if(!map||!state)return[];const events=[];
    if(state.weather!==WEATHER.CLEAR&&state.weatherTurnsRemaining===0){const ended=state.weather;state.weather=WEATHER.CLEAR;state.weatherTurnsRemaining=null;events.push({type:"WEATHER_ENDED",weather:ended});}
    weatherPulse(map,state,events);
    if(state.weather!==WEATHER.CLEAR&&state.weatherTurnsRemaining!=null)state.weatherTurnsRemaining=Math.max(0,Number(state.weatherTurnsRemaining||0)-1);
    events.push(...spreadFire(map,state));
    window.EnvironmentObjectEngine?.tickBurning?.(map,state,events);
    advanceSmoke(map,state,events);
    recordDestroyedObjects(state,events);
    return events;
  }
  function setWeather(state,weather,map=null,{duration=null,applyPulse=true}={}){
    if(!state)return[];const resolved=WEATHER[weather]?weather:WEATHER.CLEAR;state.weather=resolved;state.weatherTurnsRemaining=resolved===WEATHER.CLEAR?null:Math.max(1,Number(duration??WEATHER_TURNS[resolved]??1));const events=[];
    if(isRain(state)||isSnow(state)){
      for(const [k,list] of [...state.effects.entries()]){
        if(!list.some(e=>e.type===EFFECT.BURNING))continue;
        const [x,y]=k.split(",").map(Number);removeEffect(state,x,y,EFFECT.BURNING);events.push({type:isRain(state)?"RAIN_EXTINGUISHED_FIRE":"SNOW_EXTINGUISHED_FIRE",x,y});
      }
    }
    if(map&&applyPulse){weatherPulse(map,state,events);state.weatherTurnsRemaining=Math.max(0,Number(state.weatherTurnsRemaining||0)-1);}
    events.push({type:"WEATHER_SET",weather:resolved,duration:resolved===WEATHER.CLEAR?0:Number(duration??WEATHER_TURNS[resolved]??1),remaining:Number(state.weatherTurnsRemaining??0)});
    return events;
  }

  function hasMetalEquipment(unit){return EquipmentDatabase.equippedItems(unit?.character).some(item=>item?.material==="METAL"||item?.conductive===true||METAL_EQUIPMENT_IDS.has(item?.id));}
  function lightningRisk(map,unit){if(!unit?.alive)return{weight:0,reasons:[]};const rules=WEATHER_RULES.THUNDERSTORM;let weight=1;const reasons=[];if(hasMetalEquipment(unit)){weight*=rules.metalWeight;reasons.push("METAL");}const material=environmentAt(map,unit.x,unit.y);if(material===ELEMENT.WATER){weight*=rules.waterWeight;reasons.push("WATER");}if(material===ELEMENT.GRASS){weight*=rules.treeWeight;reasons.push("TREE");}return{weight,reasons};}
  function rollWeatherEvent({map,state,units=[],random=Math.random}){if(!state||state.weather!==WEATHER.THUNDERSTORM)return[];const rules=WEATHER_RULES.THUNDERSTORM;if(random()>=rules.lightningChance)return[];const candidates=units.filter(u=>u?.alive).map(unit=>({unit,...lightningRisk(map,unit)})).filter(x=>x.weight>0);if(!candidates.length)return[];let roll=random()*candidates.reduce((n,x)=>n+x.weight,0),chosen=candidates[candidates.length-1];for(const candidate of candidates){roll-=candidate.weight;if(roll<=0){chosen=candidate;break;}}return[{type:"LIGHTNING_STRIKE",unit:chosen.unit,x:chosen.unit.x,y:chosen.unit.y,damage:rules.lightningDamage,riskReasons:chosen.reasons,weight:chosen.weight}];}
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
    if(window.EnvironmentObjectEngine){
      const objectForces=[...forceSet].filter(force=>force!==FORCE.FIRE||!raining);
      EnvironmentObjectEngine.applyForces(map,x,y,objectForces,{events});
    }
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
      addEffect(state,x,y,{type:EFFECT.FRAGMENTS,duration:1,damageType:"PHYSICAL",radius:1});
      let destroyed=false;
      if(window.EnvironmentObjectEngine){destroyed=events.some(e=>e.type==="ENV_OBJECT_DESTROYED"&&e.objectId===stoneObjectBefore?.id);}
      else destroyed=destroyStoneObject(map,state,stoneObjectBefore);
      events.push({type:"STONE_FRAGMENT",x,y,effect:EFFECT.FRAGMENTS,destroyed,objectId:stoneObjectBefore?.id||null});
    }
    if(window.EnvironmentResolver){
      const disturbance=forceSet.has(FORCE.AVALANCHE_TRIGGER)?1.6:forceSet.has(FORCE.EXPLOSION)?1.25:forceSet.has(FORCE.IMPACT)?1:0;
      if(disturbance>0){
        events.push(...EnvironmentResolver.disturb(map,x,y,disturbance,{source:forceSet.has(FORCE.EXPLOSION)?"EXPLOSION":forceSet.has(FORCE.IMPACT)?"IMPACT":"ENVIRONMENT_FORCE"}));
        events.push(...EnvironmentResolver.resolve(map,state,{source:"DISTURBANCE"}));
      }
    }
    recordDestroyedObjects(state,events);
    return events;
  }

  function createTornado(state,x,y,{duration=2,pushDistance=2,lift=3,damage=20,fireDamage=45,resistAxes={horizontal:false,vertical:true}}={}){const burning=isBurning(state,x,y);if(burning){addEffect(state,x,y,{type:EFFECT.FIRE_TORNADO,duration,pushDistance,lift,resistAxes:{...resistAxes},lightRadius:3,damage:fireDamage,damageType:"FIRE",visionBlock:false});return{type:"FIRE_TORNADO_CREATED",x,y,effect:EFFECT.FIRE_TORNADO};}addEffect(state,x,y,{type:EFFECT.TORNADO,duration,pushDistance,lift,resistAxes:{...resistAxes},damage,damageType:"PHYSICAL",visionBlock:false});return{type:"TORNADO_CREATED",x,y,effect:EFFECT.TORNADO};}
  function pathInteraction({state,x,y,kind="UNIT"}={}){const effects=effectAt(state,x,y),tornado=effects.find(e=>e.type===EFFECT.FIRE_TORNADO)||effects.find(e=>e.type===EFFECT.TORNADO);if(!tornado||kind==="SPACE")return{interrupted:false,effects:[]};if(kind==="PROJECTILE")return{interrupted:false,effects:[{type:"WIND_FIELD",effect:tornado}]};return{interrupted:true,effects:[{type:"FORCED_MOVE",effect:tornado,distance:Number(tornado.pushDistance||2),lift:Number(tornado.lift||0),resistAxes:tornado.resistAxes||{horizontal:false,vertical:true},damage:Number(tornado.damage||0)}]};}
  function tick(state){for(const [k,list] of [...state.effects.entries()]){const next=[];for(const effect of list){if(effect.duration==null){next.push(effect);continue;}const updated={...effect,duration:effect.duration-1};if(updated.duration>0)next.push(updated);}if(next.length)state.effects.set(k,next);else state.effects.delete(k);}}
  function lightSources(state){const out=[];for(const list of state.effects.values())for(const effect of list)if(effect.lightRadius>0)out.push({x:effect.x,y:effect.y,radius:effect.lightRadius,source:effect.type});return out;}
  function isLit(state,x,y){if(state.timeOfDay!=="NIGHT")return true;return lightSources(state).some(light=>Math.abs(light.x-x)+Math.abs(light.y-y)<=light.radius);}
  function visionModifier(state,x,y){const effects=effectAt(state,x,y);if(effects.some(e=>e.type===EFFECT.STEAM))return{blocked:true,reason:"STEAM"};const smoke=effects.find(e=>e.type===EFFECT.SMOKE);if(smoke){const intensity=Math.max(0,Number(smoke.intensity||0));if(intensity>=.45)return{blocked:true,dark:true,reason:"SMOKE",intensity};return{blocked:false,dark:true,reason:"SMOKE",intensity};}if(state?.weather===WEATHER.BLIZZARD)return{blocked:false,dark:true,reason:"BLIZZARD"};if(state?.weather===WEATHER.FOG)return{blocked:false,dark:true,reason:"FOG"};if(state.timeOfDay==="NIGHT"&&!isLit(state,x,y))return{blocked:false,dark:true,reason:"NIGHT"};return{blocked:false,dark:false,reason:null};}
  function visionRange(state){if(state?.weather===WEATHER.BLIZZARD)return 3;if(state?.weather===WEATHER.FOG)return 4;return Infinity;}

  return{ELEMENT,FORCE,EFFECT,HAZARD,WEATHER,WEATHER_RULES,WEATHER_TURNS,HYDROLOGY,create,setTimeOfDay,setWeather,normalizeWind,windAt,setWind,isRain,isSnow,advanceHydrology,advanceSmoke,spreadFire,lightningRisk,rollWeatherEvent,environmentAt,effectAt,isBurning,isBoiling,isConductive,conductiveRegion,conductThunder,elevation,waterDepth,fillCapacity,addWater,removeWater,deformTerrain,apply,createTornado,pathInteraction,tick,lightSources,isLit,visionModifier,visionRange};
})();
globalThis.EnvironmentEngine=EnvironmentEngine;

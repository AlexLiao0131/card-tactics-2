export const WaterInteractionEngine=(()=>{
"use strict";
const STATE=Object.freeze({DRY:"DRY",ICE:"ICE",WATER_WALK:"WATER_WALK",AQUATIC:"AQUATIC",WADING:"WADING",SWIMMING:"SWIMMING",SINKING:"SINKING"});
const FATIGUE_LIMIT=6;
const FATIGUE_GAIN=Object.freeze({LIGHT:.5,MEDIUM:1,HEAVY:2,IMMOVABLE:3});
const FATIGUE_RECOVERY_PER_TICK=2;
const ENTRY_DAMAGE=Object.freeze({LIGHT:10,MEDIUM:15,HEAVY:20,IMMOVABLE:30});
const TICK_DAMAGE=Object.freeze({LIGHT:20,MEDIUM:25,HEAVY:30,IMMOVABLE:40});
function traits(unit){return new Set(unit?.character?.terrainTraits||[])}
function weightClass(unit){return window.DisplacementEngine?.weightClass?.(unit)||"LIGHT"}
function currentFatigue(unit){return Math.max(0,Number(unit?.waterInteraction?.fatigue||0))}
function baseState(unit,tile,fatigue=currentFatigue(unit)){
  const depth=Math.max(0,Number(window.HydrologyEngine?.waterDepth?.(tile)||0)),set=traits(unit),weight=weightClass(unit);
  if(window.VerticalMobilityEngine?.ignoresWaterInteraction?.(unit))return{state:STATE.DRY,depth,weight,safe:true,fatigue};
  if(depth<=0)return{state:STATE.DRY,depth,weight,safe:true,fatigue};
  if(set.has("AQUATIC"))return{state:STATE.AQUATIC,depth,weight,safe:true,fatigue};
  if(set.has("WATER_WALK"))return{state:STATE.WATER_WALK,depth,weight,safe:true,fatigue};
  if(window.ClimateEngine?.isFrozen?.(tile)&&ClimateEngine.iceSupports(unit,tile))return{state:STATE.ICE,depth,weight,safe:true,iceThickness:ClimateEngine.iceThickness(tile),fatigue};
  if(depth<2)return{state:STATE.WADING,depth,weight,safe:true,fatigue};
  if(fatigue>=FATIGUE_LIMIT)return{state:STATE.SINKING,depth,weight,safe:false,fatigue};
  return{state:STATE.SWIMMING,depth,weight,safe:true,fatigue};
}
function assess(unit,tile){return baseState(unit,tile)}
function resolve(unit,tile,{trigger="CHECK"}={}){
  const previous=unit?.waterInteraction||{state:STATE.DRY,depth:0,weight:weightClass(unit),fatigue:0},set=traits(unit);let ice=null;
  if(tile&&!window.VerticalMobilityEngine?.ignoresWaterInteraction?.(unit)&&window.ClimateEngine?.isFrozen?.(tile)&&!set.has("AQUATIC")&&!set.has("WATER_WALK")&&!ClimateEngine.iceSupports(unit,tile))ice=ClimateEngine.resolveIceStep(unit,tile);

  const preliminary=baseState(unit,tile,currentFatigue(unit));
  let fatigue=currentFatigue(unit);

  if(trigger==="TICK"){
    if(preliminary.state===STATE.SWIMMING||preliminary.state===STATE.SINKING){
      fatigue=Math.min(FATIGUE_LIMIT,fatigue+Number(FATIGUE_GAIN[preliminary.weight]??FATIGUE_GAIN.LIGHT));
    }else{
      fatigue=Math.max(0,fatigue-FATIGUE_RECOVERY_PER_TICK);
    }
  }

  const next=baseState(unit,tile,fatigue);
  const changed=previous.state!==next.state||
    Math.abs(Number(previous.depth||0)-Number(next.depth||0))>0.0001||
    previous.weight!==next.weight||
    Math.abs(Number(previous.fatigue||0)-Number(next.fatigue||0))>0.0001;

  let damage=0;
  if(next.state===STATE.SINKING){
    if(trigger==="TICK")damage=Number(TICK_DAMAGE[next.weight]??TICK_DAMAGE.LIGHT);
    else if(trigger==="ENTER"||trigger==="CHANGE"){
      const newlySinking=previous.state!==STATE.SINKING;
      if(newlySinking||ice?.broke)damage=Number(ENTRY_DAMAGE[next.weight]??ENTRY_DAMAGE.LIGHT);
    }
  }

  if(unit){
    unit.waterInteraction={...next};
    window.VerticalMobilityEngine?.syncUnit?.(unit,tile);
  }
  return{
    ...next,
    fatigueLimit:FATIGUE_LIMIT,
    fatigueGain:Number(FATIGUE_GAIN[next.weight]??FATIGUE_GAIN.LIGHT),
    previousState:previous.state,
    previousDepth:Number(previous.depth||0),
    previousFatigue:Number(previous.fatigue||0),
    changed,damage,trigger,ice
  };
}
return Object.freeze({STATE,FATIGUE_LIMIT,FATIGUE_GAIN,FATIGUE_RECOVERY_PER_TICK,ENTRY_DAMAGE,TICK_DAMAGE,assess,resolve});
})();

(()=>{
"use strict";
function create(ctx){
 if(!ctx?.state||!ctx?.pushLog||!ctx?.handleDefeated||!ctx?.stageEvent)throw new Error("BattleEnvironmentController requires state/log/lifecycle callbacks.");
 const state=()=>ctx.state();

 function resolveCollisionRuntime(collision,{mover,source}={}){
  if(!collision)return;const s=state(),surface=collision.surface||{},moverName=mover?.character?.name||"單位";
  if(surface.kind==="SHIELD")ctx.pushLog(`${moverName} 撞上 ${surface.unit?.character?.name||"防禦者"} 的防禦面｜撞擊傷害 ${collision.damage||0}｜HP ${mover?.hp??"-"}。`,"BATTLE");
  else if(surface.kind==="UNIT")ctx.pushLog(`${moverName} 撞上 ${surface.unit?.character?.name||"單位"}｜撞擊傷害 ${collision.damage||0}${collision.transferred?"｜力量傳遞，觸發連鎖擊飛":"｜位移被阻擋"}。`,"BATTLE");
  else if(surface.kind==="OBJECT"){const object=surface.object;ctx.pushLog(`${moverName} 撞上 ${object?.name||object?.id||"物件"}｜撞擊傷害 ${collision.damage||0}${collision.objectDamage?`｜物件耐久 -${collision.objectDamage}`:""}${collision.objectDestroyed?"｜物件破壞":""}。`,"BATTLE");if(collision.objectDestroyed&&s.environmentState){s.environmentState.destroyedObjects?.add?.(object.id);const tile=TacticalEngine.tile(s.map,object.x,object.y);if(tile&&object.breaksIntoTerrain)tile.terrain=object.breaksIntoTerrain;}}
  else ctx.pushLog(`${moverName} 撞上地形／邊界｜撞擊傷害 ${collision.damage||0}｜HP ${mover?.hp??"-"}。`,"BATTLE");
  if(mover&&!mover.alive)ctx.handleDefeated(mover,source,{type:"COLLISION",surface:surface.kind});
 }
 function teamLabel(team){if(team===ctx.TEAM?.PLAYER||team==="P")return"PLAYER";if(team===ctx.TEAM?.ENEMY||team==="E")return"ENEMY";return"NEUTRAL";}

 function applyWaterInteraction(unit,{trigger="CHECK",reason="水域"}={}){
  const s=state();if(!unit?.alive||!window.WaterInteractionEngine)return{damage:0,state:null};const tile=TacticalEngine.tile(s.map,unit.x,unit.y),result=WaterInteractionEngine.resolve(unit,tile,{trigger});
  if(result.ice?.broke)ctx.pushLog(`${unit.character.name} 踩裂冰面｜冰厚 ${Number(result.ice.thickness||0).toFixed(2)} < ${result.ice.weight} 所需 ${Number(result.ice.threshold||0).toFixed(2)}。`,"BATTLE");
  if(result.changed){
    if(result.state===WaterInteractionEngine.STATE.ICE)ctx.pushLog(`${unit.character.name} 踏上結冰水面｜冰厚 ${Number(result.iceThickness||0).toFixed(2)}。`,"DETAIL");
    else if(result.state===WaterInteractionEngine.STATE.SWIMMING)ctx.pushLog(`${unit.character.name} ${reason}｜游泳疲勞 ${Number(result.fatigue).toFixed(1)}/${result.fatigueLimit}｜重量 ${result.weight}。`,"DETAIL");
    else if(result.state===WaterInteractionEngine.STATE.SINKING)ctx.pushLog(`${unit.character.name} ${reason}｜游泳疲勞 ${Number(result.fatigue).toFixed(1)}/${result.fatigueLimit}｜體力耗盡，開始沉沒。`,"BATTLE");
    else if(result.previousState===WaterInteractionEngine.STATE.SINKING)ctx.pushLog(`${unit.character.name} ${reason}｜脫離沉沒狀態。`,"DETAIL");
  }
  if(result.damage>0&&unit.alive){unit.hp=Math.max(0,unit.hp-result.damage);const label=trigger==="TICK"?"溺水／沉沒持續傷害":"沉沒衝擊傷害";ctx.pushLog(`${unit.character.name}｜${label} ${Math.round(result.damage)}｜HP ${unit.hp}。`,"BATTLE");if(unit.hp<=0){unit.alive=false;ctx.pushLog(`${unit.character.name} 因沉沒／溺水戰敗。`,"BATTLE");ctx.handleDefeated(unit,null,{type:"WATER_HAZARD",state:result.state,depth:result.depth,weight:result.weight,fatigue:result.fatigue,trigger});}}
  return result;
 }
 function applyElectricHazard(unit,effects,reason){if(window.VerticalMobilityEngine&&!VerticalMobilityEngine.contactsWater(unit))return 0;const electric=effects.find(effect=>effect.type===EnvironmentEngine.EFFECT.ELECTRIFIED);if(!electric||!unit?.alive)return 0;const hitIds=Array.isArray(electric.damagedUnitIds)?electric.damagedUnitIds:(electric.damagedUnitIds=[]);if(hitIds.includes(String(unit.id)))return 0;hitIds.push(String(unit.id));const damage=Math.max(0,Number(electric.damage||EnvironmentEngine.HAZARD?.ELECTRIC_DAMAGE||0));if(damage<=0)return 0;unit.hp=Math.max(0,unit.hp-damage);ctx.pushLog(`${unit.character.name} ${reason}｜水體雷電傳導 ${damage} 傷害｜HP ${unit.hp}。`,"BATTLE");if(unit.hp<=0&&unit.alive){unit.alive=false;ctx.pushLog(`${unit.character.name} 被水體雷電傳導擊倒。`,"BATTLE");ctx.handleDefeated(unit,null,{type:"ELECTRIFIED",source:"ENVIRONMENT",origin:electric.origin||null});}return damage;}
 function applyBoilingHazard(unit,effects,reason){if(!unit?.alive)return 0;if(window.VerticalMobilityEngine&&!VerticalMobilityEngine.contactsWater(unit))return 0;const s=state(),tile=TacticalEngine.tile(s.map,unit.x,unit.y);if(!HydrologyEngine.isWater(tile))return 0;const boiling=effects.find(effect=>effect.type===EnvironmentEngine.EFFECT.BOILING);if(!boiling)return 0;const damage=Math.max(0,Number(boiling.damage||EnvironmentEngine.HAZARD?.BOILING_DAMAGE||0));if(damage<=0)return 0;unit.hp=Math.max(0,unit.hp-damage);ctx.pushLog(`${unit.character.name} ${reason}｜沸騰水域 ${damage} 火焰傷害｜HP ${unit.hp}。`,"BATTLE");if(unit.hp<=0&&unit.alive){unit.alive=false;ctx.pushLog(`${unit.character.name} 被沸騰水域煮倒。`,"BATTLE");ctx.handleDefeated(unit,null,{type:"BOILING",source:"ENVIRONMENT",heat:boiling.heat||1});}return damage;}
 function applyFireHazard(unit,effects,reason){if(window.VerticalMobilityEngine&&(VerticalMobilityEngine.isAirborne(unit)||VerticalMobilityEngine.isBurrowed(unit)))return 0;const burning=effects.find(effect=>effect.type===EnvironmentEngine.EFFECT.BURNING);if(!burning||!unit?.alive)return 0;const damage=Math.max(0,Number(burning.damage||EnvironmentEngine.HAZARD?.BURNING_DAMAGE||0));if(damage<=0)return 0;unit.hp=Math.max(0,unit.hp-damage);ctx.pushLog(`${unit.character.name} ${reason}｜燃燒傷害 ${damage}｜HP ${unit.hp}。`,"BATTLE");if(unit.hp<=0&&unit.alive){unit.alive=false;ctx.pushLog(`${unit.character.name} 被環境火焰擊倒。`,"BATTLE");ctx.handleDefeated(unit,null,{type:"BURNING",source:"ENVIRONMENT"});}return damage;}
 function applyEnvironmentHazardToUnit(unit,{reason="環境",waterTrigger="CHANGE",includeElectric=true,includeBoiling=true,includeFire=true}={}){const s=state();if(!unit?.alive)return 0;let total=0;const water=applyWaterInteraction(unit,{trigger:waterTrigger,reason});total+=Number(water?.damage||0);if(!unit.alive||!s.environmentState)return total;const effects=EnvironmentEngine.effectAt(s.environmentState,unit.x,unit.y);if(includeElectric&&unit.alive)total+=applyElectricHazard(unit,effects,reason);if(includeBoiling&&unit.alive)total+=applyBoilingHazard(unit,effects,reason);if(includeFire&&unit.alive)total+=applyFireHazard(unit,effects,reason);return total;}

 function applyForcedMovement(source,target,distance,{name="強制位移",lift=0,damage=0,damageType="PHYSICAL",resistAxes=null}={}){
  const s=state();if(damage>0&&target?.alive)ctx.damageUnitFlat(target,damage,name);if(!target?.alive)return{applied:false,defeated:true,steps:[],falls:[],fallDamage:0};
  const result=PostEngagementEngine.forcedMove({map:s.map,units:s.units,source,target,effect:{type:"KNOCKBACK",distance,lift,force:{horizontal:distance,vertical:lift},...(resistAxes?{resistAxes}:{})},onCollision:resolveCollisionRuntime});
  if(result.applied){if(result.airborne){const d=result.displacement;ctx.pushLog(`${target.character.name} 被${name}捲起至 Z${result.travelZ}，位移 ${result.steps.length} 格${d?`｜重量 ${d.weightClass}｜力 ${d.baseLift}→有效升空 ${d.lift}`:""}。`,"BATTLE");}else ctx.pushLog(`${target.character.name} 被${name}推離 ${result.steps.length} 格。`,"BATTLE");if(result.landing)ctx.pushLog(`${target.character.name} 落地 Z${result.landing.fromZ}→H${result.landing.toZ}${result.fallDamage?`｜墜落傷害 ${result.fallDamage}｜HP ${target.hp}`:"｜無墜落傷害"}。`,result.fallDamage?"BATTLE":"DETAIL");if(target.alive)enterTile(target);}
  if(result.defeated)ctx.handleDefeated(target,source,{type:"ENVIRONMENT_FORCE",name,damageType});return result;
 }
 function applyCurrentToUnit(unit,{reason="水流"}={}){
  if(window.VerticalMobilityEngine?.ignoresCurrent?.(unit))return false;
  const s=state();if(!unit?.alive||unit._currentResolving||!window.ClimateEngine)return false;const tile=TacticalEngine.tile(s.map,unit.x,unit.y),current=ClimateEngine.currentForce(tile,s.environmentState);if(!current)return false;
  unit._currentResolving=true;try{const source={x:unit.x-current.flowX,y:unit.y-current.flowY};ctx.pushLog(`${unit.character.name} 遭${reason}沖刷｜流速 ${current.speed.toFixed(2)}｜位移力 ${current.distance}。`,"BATTLE");applyForcedMovement(source,unit,current.distance,{name:"暴漲溪流",damage:Math.max(0,Math.round((current.speed-1)*8)),damageType:"WATER"});return true;}finally{delete unit._currentResolving;}
 }
 function enterTile(unit){const s=state();if(!unit?.alive)return;ctx.stageEvent({type:"ENTER_TILE",unitId:unit.id,characterId:unit.character.id,x:unit.x,y:unit.y,z:Number(unit.z??(TacticalEngine.elevation(TacticalEngine.tile(s.map,unit.x,unit.y))||0)),team:teamLabel(unit.team)});applyEnvironmentHazardToUnit(unit,{reason:"踏入環境區",waterTrigger:"ENTER"});if(unit.alive&&!unit._currentResolving)applyCurrentToUnit(unit,{reason:"溪流"});}
 function traverseUnitPath(unit,path,{kind="UNIT"}={}){
  const s=state();let previous={x:unit.x,y:unit.y};
  for(const tile of path||[]){
    const incoming={dx:Math.sign(tile.x-previous.x),dy:Math.sign(tile.y-previous.y)};
    unit.x=tile.x;unit.y=tile.y;unit.z=Number(tile.elevation||0);enterTile(unit);
    if(!unit.alive)return{completed:false,reason:"DEFEATED"};
    if(unit.x!==tile.x||unit.y!==tile.y)return{completed:false,reason:"CURRENT"};
    const interaction=EnvironmentEngine.pathInteraction({state:s.environmentState,x:tile.x,y:tile.y,kind}),forced=interaction.effects?.find(e=>e.type==="FORCED_MOVE");
    if(forced){applyForcedMovement({x:tile.x,y:tile.y},unit,forced.distance,{name:forced.effect?.type==="FIRE_TORNADO"?"火龍捲":"龍捲風",lift:Number(forced.lift??forced.effect?.lift??0),damage:Number(forced.damage??forced.effect?.damage??0),damageType:forced.effect?.damageType||"PHYSICAL",resistAxes:forced.resistAxes||forced.effect?.resistAxes});return{completed:false,reason:"ENVIRONMENT_FORCE"};}
    const friction=Number(window.EnvironmentResolver?.surfaceFriction?.(s.environmentState,tile)??1);
    const momentum=Math.max(0,1-friction);
    if(kind==="UNIT"&&momentum>=.5&&(incoming.dx||incoming.dy)&&!window.VerticalMobilityEngine?.isAirborne?.(unit)&&!window.VerticalMobilityEngine?.isBurrowed?.(unit)){
      const distance=Math.max(1,Math.min(2,Math.ceil(momentum*2))),source={x:unit.x-incoming.dx,y:unit.y-incoming.dy};
      ctx.pushLog(`${unit.character.name} 在低摩擦地表失去制動｜摩擦 ${friction.toFixed(2)}｜慣性位移 ${distance}。`,"DETAIL");
      applyForcedMovement(source,unit,distance,{name:"滑行",damage:0,damageType:"PHYSICAL"});
      return{completed:false,reason:"SURFACE_MOMENTUM"};
    }
    previous={x:tile.x,y:tile.y};
  }
  return{completed:true};
}

 function resolveMassFlow(event){
  const s=state(),path=event.path||[],initial=(s.units||[]).filter(u=>u?.alive&&path.some(p=>p.x===u.x&&p.y===u.y));let count=0;
  const material=event.material||"SNOW",name=material==="SOIL"?"土石流":(material==="ROCK"||material==="DEBRIS")?"山崩／落石":"雪崩";
  for(const unit of initial){
    if(!unit.alive||window.VerticalMobilityEngine?.isAirborne?.(unit)||window.VerticalMobilityEngine?.isBurrowed?.(unit))continue;
    const index=Math.max(0,path.findIndex(p=>p.x===unit.x&&p.y===unit.y)),here=path[index],next=path[Math.min(path.length-1,index+1)],
      dx=Math.sign((next?.x??here.x)-here.x),dy=Math.sign((next?.y??here.y)-here.y),source={x:unit.x-dx,y:unit.y-dy};
    applyForcedMovement(source,unit,Number(event.forceDistance||1),{name,damage:Number(event.damage||0),damageType:"PHYSICAL"});count++;
  }
  return count;
 }
 function applyEnvironmentHazards({reason="持續環境傷害"}={}){
  const s=state(),weatherEvents=EnvironmentEngine.advanceHydrology?.(s.map,s.environmentState)||[];
  weatherEvents.forEach(logEnvironmentEvent);resolveEnvironmentEvents(weatherEvents,{reason:"天候／環境變化"});
  for(const unit of (s.units||[]).filter(unit=>unit?.alive))applyEnvironmentHazardToUnit(unit,{reason,waterTrigger:"TICK"});
  for(const unit of (s.units||[]).filter(unit=>unit?.alive))applyCurrentToUnit(unit,{reason:"暴漲水流"});
 }
 function resolveEnvironmentEvents(events,{reason="環境連鎖"}={}){
  const list=events||[],s=state();if(!list.length)return 0;let affected=0;
  const hasElectric=list.some(event=>event.type==="ELECTRIC_CONDUCTION"),hydrologyChanged=list.some(event=>["ELEVATION_CHANGED","WATER_FLOW","WATER_ACCUMULATED","WATER_REDUCED","BASIN_FILLED","BASIN_DRAINED","HYDROLOGY_REBALANCED","FLOOD_AREA_RESOLVED","WATER_EVAPORATION","WATER_DRAINED_OFF_MAP","SNOWMELT_WATER","ICE_MELT","ICE_THINNED","WATER_FROZEN","CLIMATE_WATER_CHANGED","FREEZE_PULSE","ICE_THAW"].includes(event.type));
  const boilingTiles=new Set(list.filter(event=>event.type==="WATER_BOILING"||event.type==="WATER_EVAPORATION").map(event=>`${event.x},${event.y}`));
  if(hydrologyChanged)for(const unit of (s.units||[]).filter(unit=>unit?.alive)){const damage=applyEnvironmentHazardToUnit(unit,{reason:"水位／冰面／地形變化",waterTrigger:"CHANGE",includeElectric:false,includeBoiling:false,includeFire:false});if(damage>0)affected++;}
  if(hasElectric)for(const unit of (s.units||[]).filter(unit=>unit?.alive)){const damage=applyEnvironmentHazardToUnit(unit,{reason,waterTrigger:"CHECK",includeElectric:true,includeBoiling:false,includeFire:false});if(damage>0)affected++;}
  if(boilingTiles.size)for(const unit of (s.units||[]).filter(unit=>unit?.alive&&boilingTiles.has(`${unit.x},${unit.y}`))){const damage=applyEnvironmentHazardToUnit(unit,{reason:"水體受高熱影響",waterTrigger:"CHECK",includeElectric:false,includeBoiling:true,includeFire:false});if(damage>0)affected++;}
  for(const flow of list.filter(event=>event.type==="MASS_FLOW"))affected+=resolveMassFlow(flow);
  for(const avalanche of list.filter(event=>event.type==="AVALANCHE"))affected+=resolveMassFlow({...avalanche,material:"SNOW"});
  if(list.some(event=>event.type==="RIVER_SURGE")){for(const unit of (s.units||[]).filter(unit=>unit?.alive)){const tile=TacticalEngine.tile(s.map,unit.x,unit.y);if(tile?.river&&applyCurrentToUnit(unit,{reason:"暴漲溪流"}))affected++;}}
  return affected;
 }
 function resolveWeatherEvents(){const s=state();if(!s.environmentState)return;for(const event of EnvironmentEngine.rollWeatherEvent({map:s.map,state:s.environmentState,units:s.units})){if(event.type!=="LIGHTNING_STRIKE")continue;const unit=event.unit;if(!unit?.alive)continue;const names=(event.riskReasons||[]).map(r=>r==="METAL"?"金屬裝備":r==="WATER"?"水域":"樹木／森林");unit.hp=Math.max(0,unit.hp-Number(event.damage||0));ctx.pushLog(`⚡ 落雷擊中 ${unit.character.name}｜${event.damage} 傷害｜HP ${unit.hp}${names.length?`｜高風險：${names.join("＋")}`:""}。`,"BATTLE");if(unit.hp<=0&&unit.alive){unit.alive=false;ctx.handleDefeated(unit,null,{type:"LIGHTNING"});}if(EnvironmentEngine.isConductive(s.map,s.environmentState,event.x,event.y)){const conduction=[];EnvironmentEngine.conductThunder(s.map,s.environmentState,event.x,event.y,conduction,{damagedUnitIds:[unit.id]});conduction.forEach(logEnvironmentEvent);resolveEnvironmentEvents(conduction,{reason:"雷雨落雷引發水體傳導"});}}}
 function logEnvironmentEvent(event){
  if(event.type==="IGNITE")ctx.pushLog(`(${event.x},${event.y}) 燃燒起來，成為火光來源。`,"SYSTEM");
  else if(event.type==="FIRE_EXTINGUISHED")ctx.pushLog(`(${event.x},${event.y}) 的火焰被水熄滅。`,"SYSTEM");
  else if(event.type==="RAIN_EXTINGUISHED_FIRE")ctx.pushLog(`豪雨熄滅 (${event.x},${event.y}) 的普通火焰。`,"SYSTEM");
  else if(event.type==="SNOW_EXTINGUISHED_FIRE")ctx.pushLog(`降雪熄滅 (${event.x},${event.y}) 的普通火焰。`,"SYSTEM");
  else if(event.type==="RAIN_SUPPRESSED_FIRE")ctx.pushLog(`豪雨壓制 (${event.x},${event.y}) 的小火，無法形成燃燒地形。`,"SYSTEM");
  else if(event.type==="MUD_CREATED")ctx.pushLog(`降雨／積水使 (${event.x},${event.y}) 的平地先轉為泥濘。`,"DETAIL");
  else if(event.type==="MUD_DRY")ctx.pushLog(`(${event.x},${event.y}) 的泥濘乾燥，恢復為平地。`,"DETAIL");
  else if(event.type==="WATER_BOILING")ctx.pushLog(`♨ (${event.x},${event.y}) 水域開始沸騰｜水中單位會受到高熱傷害。`,"SYSTEM");
  else if(event.type==="WATER_EVAPORATION")ctx.pushLog(`高熱持續作用於 (${event.x},${event.y})｜蒸發水量 ${Number(event.amount||0).toFixed(2)}。`,"SYSTEM");
  else if(event.type==="WATER_BOILED_DRY")ctx.pushLog(`(${event.x},${event.y}) 的水已被持續高熱煮乾。`,"SYSTEM");
  else if(event.type==="STEAM_CREATED")ctx.pushLog(`高熱與水分作用，(${event.x},${event.y}) 產生蒸氣迷霧。`,"SYSTEM");
  else if(event.type==="STEAM_DISPERSED")ctx.pushLog(`風力吹散 (${event.x},${event.y}) 的蒸氣迷霧。`,"SYSTEM");
  else if(event.type==="HYDROLOGY_REBALANCED"&&event.changedTiles>0)ctx.pushLog(`水體重新分配｜${event.changedTiles} 格水位改變｜Water Volume ${Number(event.afterVolume||0).toFixed(2)}。`,"DETAIL");
  else if(event.type==="STONE_FRAGMENT")ctx.pushLog(`爆炸擊中石質物件，(${event.x},${event.y}) 產生破片${event.destroyed?"並炸開道路":""}。`,"SYSTEM");
  else if(event.type==="TORNADO_CREATED")ctx.pushLog(`(${event.x},${event.y}) 形成龍捲風場。`,"DETAIL");
  else if(event.type==="FIRE_TORNADO_CREATED")ctx.pushLog(`(${event.x},${event.y}) 的燃燒區被風捲起，形成火龍捲。`,"SYSTEM");
  else if(event.type==="ELECTRIC_CONDUCTION")ctx.pushLog(`⚡ 雷元素由 (${event.x},${event.y}) 傳遍相連水體｜${event.regionSize||1} 格帶電。`,"SYSTEM");
  else if(event.type==="RIVER_SURGE")ctx.pushLog(`🌊 ${event.weather==="THUNDERSTORM"?"雷雨":"豪雨"}使溪流暴漲｜最高流速 ${Number(event.maxSpeed||0).toFixed(2)}。`,"SYSTEM");
  else if(event.type==="SNOWFALL")ctx.pushLog(`❄️ ${event.weather==="BLIZZARD"?"暴風雪":"降雪"}累積｜${event.changedTiles||0} 格積雪增加｜最大雪深 ${Number(event.maxSnow||0).toFixed(2)}。`,"DETAIL");
  else if(event.type==="FREEZE_PULSE")ctx.pushLog(`🧊 低溫使 ${event.changedTiles||0} 格水面結冰／增厚｜最大冰厚 ${Number(event.maxIce||0).toFixed(2)}。`,"DETAIL");
  else if(event.type==="SNOW_THAW")ctx.pushLog(`融雪｜${event.changedTiles||0} 格積雪減少｜回流水量 ${Number(event.meltVolume||0).toFixed(2)}。`,"DETAIL");
  else if(event.type==="ICE_THAW")ctx.pushLog(`解凍｜${event.changedTiles||0} 格冰面變薄。`,"DETAIL");
  else if(event.type==="MASS_FLOW"){const label=event.material==="SOIL"?"⛰️ 土石流":(event.material==="ROCK"||event.material==="DEBRIS")?"🪨 山崩／落石":"❄️ 雪崩";ctx.pushLog(`${label}由 (${event.x},${event.y}) 發生｜路徑 ${event.path?.length||0} 格｜質量 ${Number(event.mass||0).toFixed(2)}｜衝擊 ${event.damage||0}。`,"SYSTEM");}
  else if(event.type==="SOIL_FROZEN")ctx.pushLog(`🧊 (${event.x},${event.y}) 含水土壤凍結｜形成凍土。`,"DETAIL");
  else if(event.type==="SOIL_THAWED")ctx.pushLog(`(${event.x},${event.y}) 凍土解凍｜原有土壤水分保留。`,"DETAIL");
  else if(event.type==="AVALANCHE")ctx.pushLog(`❄️ 雪崩由 (${event.x},${event.y}) 崩落｜路徑 ${event.path?.length||0} 格｜衝擊 ${event.damage||0}。`,"SYSTEM");
 }
 return Object.freeze({resolveCollisionRuntime,applyForcedMovement,traverseUnitPath,applyWaterInteraction,applyEnvironmentHazardToUnit,applyEnvironmentHazards,resolveEnvironmentEvents,applyCurrentToUnit,enterTile,resolveWeatherEvents,logEnvironmentEvent});
}
window.BattleEnvironmentController=Object.freeze({create});
})();
globalThis.WaterInteractionEngine=WaterInteractionEngine;

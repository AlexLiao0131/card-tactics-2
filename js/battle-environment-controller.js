import {TerrainMaterial} from "./terrain-database.js";
export const WaterInteractionEngine=(()=>{
"use strict";
const STATE=Object.freeze({DRY:"DRY",ICE:"ICE",WATER_WALK:"WATER_WALK",AQUATIC:"AQUATIC",WADING:"WADING",SWIMMING:"SWIMMING",SINKING:"SINKING"});
const FATIGUE_LIMIT=6;
const FATIGUE_GAIN=Object.freeze({LIGHT:.5,MEDIUM:1,HEAVY:2,IMMOVABLE:3});
const FATIGUE_RECOVERY_PER_TICK=2;
const ENTRY_DAMAGE=Object.freeze({LIGHT:10,MEDIUM:15,HEAVY:20,IMMOVABLE:30});
const TICK_DAMAGE=Object.freeze({LIGHT:20,MEDIUM:25,HEAVY:30,IMMOVABLE:40});
function traits(unit){return new Set(unit?.character?.terrainTraits||[])}
function weightClass(unit){return globalThis.DisplacementEngine?.weightClass?.(unit)||"LIGHT"}
function currentFatigue(unit){return Math.max(0,Number(unit?.waterInteraction?.fatigue||0))}
function activeWaterRules(unit){
  const out={breathing:false,waterWalk:false,preventSinking:false};
  for(const effect of globalThis.EffectEngine?.state?.(unit)||[]){const r=effect?.waterRules;if(!r)continue;out.breathing=out.breathing||r.breathing===true;out.waterWalk=out.waterWalk||r.waterWalk===true;out.preventSinking=out.preventSinking||r.preventSinking===true;}
  return out;
}
function baseState(unit,tile,fatigue=currentFatigue(unit)){
  const depth=Math.max(0,Number(globalThis.HydrologyEngine?.waterDepth?.(tile)||0)),set=traits(unit),weight=weightClass(unit),rules=activeWaterRules(unit),forcedTurns=Math.max(0,Number(unit?.waterInteraction?.forcedSubmergeTurns||0));
  if(globalThis.VerticalMobilityEngine?.ignoresWaterInteraction?.(unit))return{state:STATE.DRY,depth,weight,safe:true,fatigue};
  if(depth<=0)return{state:STATE.DRY,depth,weight,safe:true,fatigue};
  if(set.has("AQUATIC"))return{state:STATE.AQUATIC,depth,weight,safe:true,fatigue};
  // A breaking rogue wave can engulf a surface swimmer/wader/water-walker and
  // temporarily force them below the surface. Explicit anti-sinking effects still win.
  if(forcedTurns>0&&!rules.preventSinking)return{state:STATE.SINKING,depth,weight,safe:false,fatigue:Math.max(fatigue,FATIGUE_LIMIT),forcedSubmerge:true,forcedSubmergeTurns:forcedTurns};
  if(set.has("WATER_WALK")||rules.waterWalk)return{state:STATE.WATER_WALK,depth,weight,safe:true,fatigue,source:rules.waterWalk?"EFFECT":null};
  if(globalThis.ClimateEngine?.isFrozen?.(tile)&&ClimateEngine.iceSupports(unit,tile))return{state:STATE.ICE,depth,weight,safe:true,iceThickness:ClimateEngine.iceThickness(tile),fatigue};
  if(depth<2)return{state:STATE.WADING,depth,weight,safe:true,fatigue};
  // Underwater breathing prevents oxygen exhaustion; it does not block wave-forced submersion.
  if(fatigue>=FATIGUE_LIMIT&&!rules.preventSinking&&!rules.breathing)return{state:STATE.SINKING,depth,weight,safe:false,fatigue};
  return{state:STATE.SWIMMING,depth,weight,safe:true,fatigue};
}
function assess(unit,tile){return baseState(unit,tile)}
function forceSubmerge(unit,tile,{turns=1,impactDamage=0}={}){
  if(!unit?.alive||!tile)return{applied:false,reason:"INVALID_TARGET",damage:0};
  const depth=Math.max(0,Number(globalThis.HydrologyEngine?.waterDepth?.(tile)||0)),set=traits(unit),rules=activeWaterRules(unit);
  if(depth<=0)return{applied:false,reason:"NO_WATER",damage:0};
  if(globalThis.VerticalMobilityEngine?.ignoresWaterInteraction?.(unit))return{applied:false,reason:"NO_WATER_CONTACT",damage:0};
  const impact=Math.max(0,Math.round(Number(impactDamage||0)));
  if(set.has("AQUATIC"))return{applied:false,reason:"AQUATIC",damage:impact,state:STATE.AQUATIC};
  if(rules.preventSinking)return{applied:false,reason:"PREVENT_SINKING",damage:impact,state:unit?.waterInteraction?.state||STATE.WATER_WALK};
  const previous=unit.waterInteraction||{};
  unit.waterInteraction={...previous,fatigue:Math.max(FATIGUE_LIMIT,Number(previous.fatigue||0)),forcedSubmergeTurns:Math.max(1,Math.floor(Number(turns||1)))};
  const resolved=resolve(unit,tile,{trigger:"WAVE"});
  return{...resolved,applied:resolved.state===STATE.SINKING,damage:Math.max(Number(resolved.damage||0),Math.max(0,Math.round(Number(impactDamage||0))))};
}
function resolve(unit,tile,{trigger="CHECK"}={}){
  const previous=unit?.waterInteraction||{state:STATE.DRY,depth:0,weight:weightClass(unit),fatigue:0},set=traits(unit),rules=activeWaterRules(unit);let ice=null;
  if(tile&&!globalThis.VerticalMobilityEngine?.ignoresWaterInteraction?.(unit)&&globalThis.ClimateEngine?.isFrozen?.(tile)&&!set.has("AQUATIC")&&!set.has("WATER_WALK")&&!rules.waterWalk&&!ClimateEngine.iceSupports(unit,tile))ice=ClimateEngine.resolveIceStep(unit,tile);
  const preliminary=baseState(unit,tile,currentFatigue(unit));
  let fatigue=currentFatigue(unit);
  if(trigger==="TICK"){
    if(preliminary.state===STATE.SWIMMING||preliminary.state===STATE.SINKING){fatigue=Math.min(FATIGUE_LIMIT,fatigue+Number(FATIGUE_GAIN[preliminary.weight]??FATIGUE_GAIN.LIGHT));}
    else fatigue=Math.max(0,fatigue-FATIGUE_RECOVERY_PER_TICK);
  }
  const next=baseState(unit,tile,fatigue);
  const changed=previous.state!==next.state||Math.abs(Number(previous.depth||0)-Number(next.depth||0))>0.0001||previous.weight!==next.weight||Math.abs(Number(previous.fatigue||0)-Number(next.fatigue||0))>0.0001;
  let damage=0;
  if(next.state===STATE.SINKING){
    if(trigger==="TICK"&&!rules.breathing)damage=Number(TICK_DAMAGE[next.weight]??TICK_DAMAGE.LIGHT);
    else if(trigger==="ENTER"||trigger==="CHANGE"){const newlySinking=previous.state!==STATE.SINKING;if(newlySinking||ice?.broke)damage=Number(ENTRY_DAMAGE[next.weight]??ENTRY_DAMAGE.LIGHT);}
  }
  if(unit){
    const forcedBefore=Math.max(0,Number(unit?.waterInteraction?.forcedSubmergeTurns||0)),forcedAfter=trigger==="TICK"?Math.max(0,forcedBefore-1):forcedBefore;
    unit.waterInteraction={...next,forcedSubmerge:forcedAfter>0,forcedSubmergeTurns:forcedAfter};
    globalThis.VerticalMobilityEngine?.syncUnit?.(unit,tile);
  }
  return{...next,fatigueLimit:FATIGUE_LIMIT,fatigueGain:Number(FATIGUE_GAIN[next.weight]??FATIGUE_GAIN.LIGHT),previousState:previous.state,previousDepth:Number(previous.depth||0),previousFatigue:Number(previous.fatigue||0),changed,damage,trigger,ice,breathing:rules.breathing};
}
return Object.freeze({STATE,FATIGUE_LIMIT,FATIGUE_GAIN,FATIGUE_RECOVERY_PER_TICK,ENTRY_DAMAGE,TICK_DAMAGE,assess,resolve,forceSubmerge,activeWaterRules});
})();

(()=>{
"use strict";
// Source IDs and the once-per-battle ledger live on the authoritative battlefield map.
// Extraction NEVER damages an object, changes a tile, or changes the water column.
const ALCHEMY_SOURCE=Object.freeze({BUSH:'HERB',TREE:'WOOD',DEAD_TREE:'WOOD',STUMP:'WOOD',LOG:'WOOD',BOULDER:'MINERAL'});
const ALCHEMY_BASE_AFFINITY=Object.freeze({HERB:'NATURE',WOOD:'NATURE',MINERAL:'STONE',CRYSTAL_SAND:'WATER'});
const ALCHEMY_DIRECTIONS=Object.freeze([[0,0],[1,0],[-1,0],[0,1],[0,-1]]);
// Only canonical divine shields are holy. Generic SHIELD, water shield, and
// ordinary defensive buffs must never create a fictional HOLY affinity.
const ALCHEMY_HOLY_SHIELDS=new Set(['HOLY_SHIELD','SAINT_OVERHEAL_SHIELD',
  'ALCH_ARMOR_HOLY','ALCH_POWER_HOLY']);
const ALCHEMY_AFFINITY_NAMES=Object.freeze({NONE:'普通',NATURE:'自然',WATER:'水',
  ICE:'冰',FIRE:'火',THUNDER:'雷',HOLY:'神聖',DARK:'闇',STONE:'岩'});
function alchemyRoll(map,sourceId){
  let h=2166136261>>>0;
  for(const ch of `${map?.seed??map?.id??'FIELD'}:ALCHEMY:${sourceId}:QUALITY`){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return h/4294967296;
}
function harvestCandidates(map,x,y){
  if(!Array.isArray(map?.tiles)||!Number.isSafeInteger(x)||!Number.isSafeInteger(y))return[];
  // A per-query index reads live terrain. No stale world cache survives a
  // terrain-restructuring spell or a river changing course.
  const by=new Map(map.tiles.map(t=>[`${t.x},${t.y}`,t]));
  const at=(tx,ty)=>by.get(`${tx},${ty}`);
  const origin=at(x,y);
  if(!origin)return[];
  const out=[],seen=new Set();
  const eligibleBed=t=>t?.river===true||t?.hydrologyNaturalChannelPool===true;
  const bankDeposit=t=>{
    if(!t||eligibleBed(t)||t.terrain==='WALL'||t.captureZone||t.core)return false;
    // Real authored river-channel bank, not arbitrary standing rainwater.
    // Each bank tile is a separate, naturally deposited sample source.
    return ALCHEMY_DIRECTIONS.slice(1).some(([dx,dy])=>{
      const bed=at(t.x+dx,t.y+dy);
      return bed?.river===true&&bed.terrain!=='WALL'&&
        Math.abs(Number(t.elevation||0)-Number(bed.elevation||0))<=1.0001;
    });
  };
  const add=(id,kind,t,sourceType)=>{
    if(seen.has(id))return;
    seen.add(id);out.push({id,kind,x:t.x,y:t.y,sourceType});
  };
  for(const [dx,dy] of ALCHEMY_DIRECTIONS){
    const sx=x+dx,sy=y+dy,neighbor=at(sx,sy);
    if(!neighbor)continue;
    // Exposed native bedrock is a real geological source, not an extra rock
    // object. A unit may sample the face from the foot of a cliff even when
    // that upper tile is too high to traverse. Object/plant collection still
    // obeys the ordinary <=1 elevation rule below.
    const adjacent=dx!==0||dy!==0;
    const heightDelta=Number(neighbor.elevation||0)-Number(origin.elevation||0);
    // Riverbed sediment is already a distinct one-time CRYSTAL_SAND source;
    // never double-dip a single river cell as both sand and bedrock.
    const rockStratum=!eligibleBed(neighbor)&&(TerrainMaterial.isRock(neighbor)||adjacent&&heightDelta>1.0001&&TerrainMaterial.exposedCliffFace(map,neighbor));
    const naturalRock=rockStratum&&neighbor.alchemyTransmuted!==true&&
      neighbor.captureZone!==true&&!neighbor.core&&neighbor.terrain!=='WALL';
    if(naturalRock&&(!adjacent||heightDelta>=-1.0001)){
      // One bedrock ID for both plateau and exposed cliff face: walking from
      // the foot to the top can NEVER harvest the same rock twice.
      add(`BEDROCK:${sx},${sy}`,'MINERAL',neighbor,
        adjacent&&heightDelta>1.0001?'CLIFF_FACE':'BEDROCK');
    }
    // Solid objects beyond a cliff or wall are not in reach. Rock-face
    // sampling above is the sole exception, and never traverses the cliff.
    if(adjacent&&(neighbor.terrain==='WALL'||Math.abs(heightDelta)>1.0001))continue;
    for(const o of globalThis.EnvironmentObjectEngine?.activeObjectsAt?.(map,sx,sy)||[]){
      if(!o||o.destroyed||o.carriedBy||!o.id)continue;
      const kind=ALCHEMY_SOURCE[String(o.type||'').toUpperCase()];
      if(!kind)continue;
      // Every actually reachable adjoining source can be sampled. Forest trees
      // and bushes are NON-BLOCKING in EnvironmentObjectEngine: checking for
      // blocksMovement===true here silently discarded almost all resources.
      // The wall/cliff gate above still disallows harvesting across obstacles.
      if(!adjacent&&o.blocksMovement===true)continue;
      add(`OBJECT:${o.id}`,kind,neighbor,'OBJECT');
    }
    // Actual channel beds AND authored natural channel pools contain sediment.
    // The latter are geological river pockets even though river===false.
    if(eligibleBed(neighbor))add(`RIVERBED:${sx},${sy}`,'CRYSTAL_SAND',neighbor,'RIVERBED');
    // Shore-side alluvium is an independent physical bank deposit. It is not
    // a fabricated object or a new map spawn, and is available only next to
    // an authored river with a legal, non-cliff physical bank connection.
    if(bankDeposit(neighbor))add(`RIVERBANK:${sx},${sy}`,'CRYSTAL_SAND',neighbor,'RIVERBANK');
  }
  return out;
}
function alchemyAffinity(map,environmentState,source,units=[]){
  const tile=map?.tiles?.find(t=>t.x===source.x&&t.y===source.y),
    effects=globalThis.EnvironmentEngine?.effectAt?.(environmentState,source.x,source.y)||[];
  const recognized=[];
  for(let i=0;i<effects.length;i++){
    const effect=effects[i],type=String(effect?.type||'').toUpperCase();
    const affinity=type==='BURNING'||type==='FIRE_TORNADO'?'FIRE':type==='ELECTRIFIED'?'THUNDER':null;
    if(affinity)recognized.push({affinity,order:Number(effect?.elementEventSequence??i)});
  }
  const mark=map?.alchemyElementEvents?.[`${source.x},${source.y}`];
  // Only an active matching effect can validate a historical event mark.
  const marked=recognized.find(record=>record.affinity===mark?.affinity);
  if(marked)return mark.affinity;
  if(recognized.length)return recognized.sort((a,b)=>b.order-a.order||a.affinity.localeCompare(b.affinity))[0].affinity;
  // Unit shields exist in EffectEngine's authoritative unit effects, not in
  // EnvironmentEngine's tile effects. Only an ACTIVE real holy shield in
  // contact with the source can impart divine affinity to a rare extraction.
  // No cast-time reward and no new 30% roll is created by the shield.
  if((units||[]).some(u=>u?.alive&&
    Math.abs(Number(u.x)-source.x)+Math.abs(Number(u.y)-source.y)<=1&&
    (u.effects||[]).some(e=>{
      const id=String(e?.id||'').toUpperCase();
      if(!ALCHEMY_HOLY_SHIELDS.has(id)||e.classification==='NEGATIVE'||
        (e.remaining!=null&&Number(e.remaining)<=0))return false;
      return id==='HOLY_SHIELD'||
        (e.type==='SHIELD'&&Number(e.shieldHp||0)>0);
    })))return'HOLY';
  if(Number(tile?.iceThickness||0)>0||Number(tile?.snowDepth||0)>0)return'ICE';
  if(Number(tile?.waterDepth||0)>0)return'WATER';
  return ALCHEMY_BASE_AFFINITY[source.kind]||'NATURE';
}
function collectAlchemyOnStep({map,environmentState,unit,units=[],x,y,kind='UNIT',round=null}={}){
  if(!map||!unit?.alive||unit.character?.alchemyHarvest!==true||kind!=='UNIT'||
     unit.x!==x||unit.y!==y||!globalThis.ResourceEngine?.changeMaterial||
     globalThis.VerticalMobilityEngine?.isAirborne?.(unit)||
     globalThis.VerticalMobilityEngine?.isBurrowed?.(unit))return[];
  // The reversible journal follows the actual authoritative tactical round.
  // A staged move can span several one-step commands without losing its ledger.
  if(Number.isSafeInteger(round)&&round>=1&&unit._alchemyHarvestUndoRound!==round){
    unit._alchemyHarvestUndo=[];
    unit._alchemyHarvestUndoRound=round;
  }
  const ledger=map.alchemyHarvestedSources??={},events=[];
  for(const source of harvestCandidates(map,x,y)){
    if(Object.hasOwn(ledger,source.id))continue;
    const quality=alchemyRoll(map,source.id)<.30,
      potentialAffinity=alchemyAffinity(map,environmentState,source,units),
      affinity=quality?potentialAffinity:'NONE',
      normal={kind:source.kind,quality:'NORMAL',affinity:'NONE',amount:1},
      rare={kind:source.kind,quality:'HIGH',affinity,amount:1};
    if(!ResourceEngine.changeMaterial(unit,normal))continue;
    if(quality&&!ResourceEngine.changeMaterial(unit,rare)){
      ResourceEngine.changeMaterial(unit,{...normal,amount:-1});continue;
    }
    ledger[source.id]={unitId:unit.id,kind:source.kind,quality:quality?'HIGH':'NORMAL',affinity};
    const entry={sourceId:source.id,sourceType:source.sourceType,kind:source.kind,quality:quality?'HIGH':'NORMAL',affinity,potentialAffinity};
    if(Array.isArray(unit._alchemyHarvestUndo))unit._alchemyHarvestUndo.push(entry);
    events.push({type:'ALCHEMY_MATERIAL_COLLECTED',unitId:unit.id,x:source.x,y:source.y,...entry});
  }
  return events;
}
function rollbackAlchemyHarvest(unit,map){
  const items=unit?._alchemyHarvestUndo;
  if(!Array.isArray(items)||!map)return 0;
  const ledger=map.alchemyHarvestedSources||{};let reverted=0;
  for(let i=items.length-1;i>=0;i--){
    const item=items[i];
    if(ledger[item.sourceId]?.unitId!==unit.id)continue;
    const normal={kind:item.kind,quality:'NORMAL',affinity:'NONE',amount:-1};
    if(!ResourceEngine.changeMaterial(unit,normal))continue;
    if(item.quality==='HIGH')ResourceEngine.changeMaterial(unit,{kind:item.kind,quality:'HIGH',affinity:item.affinity,amount:-1});
    delete ledger[item.sourceId];reverted++;
  }
  delete unit._alchemyHarvestUndo;
  delete unit._alchemyHarvestUndoRound;
  return reverted;
}
function commitAlchemyHarvest(unit){
  if(!unit)return;
  delete unit._alchemyHarvestUndo;
  delete unit._alchemyHarvestUndoRound;
}
function create(ctx){
 if(!ctx?.state||!ctx?.pushLog||!ctx?.handleDefeated||!ctx?.stageEvent)throw new Error("BattleEnvironmentController requires state/log/lifecycle callbacks.");
 const state=()=>ctx.state();
 function tileFor(unit){const s=state();return TacticalEngine.tile(s.map,unit?.x,unit?.y)}
 function effectContacts(unit,tile,effect){return !globalThis.EnvironmentContactEngine||EnvironmentContactEngine.effectContacts(unit,tile,effect)}
 function eventContacts(unit,tile,event){return !globalThis.EnvironmentContactEngine||EnvironmentContactEngine.eventContacts(unit,tile,event)}
 function profileContacts(unit,tile,profile,source={}){return !globalThis.EnvironmentContactEngine||EnvironmentContactEngine.contacts(unit,tile,profile,source)}
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
  const s=state();if(!unit?.alive||!globalThis.WaterInteractionEngine)return{damage:0,state:null};const tile=TacticalEngine.tile(s.map,unit.x,unit.y),result=WaterInteractionEngine.resolve(unit,tile,{trigger});
  if(result.ice?.broke)ctx.pushLog(`${unit.character.name} 踩裂冰面｜冰厚 ${Number(result.ice.thickness||0).toFixed(2)} < ${result.ice.weight} 所需 ${Number(result.ice.threshold||0).toFixed(2)}。`,"BATTLE",{units:[unit]});
  if(result.changed){
    if(result.state===WaterInteractionEngine.STATE.ICE)ctx.pushLog(`${unit.character.name} 踏上結冰水面｜冰厚 ${Number(result.iceThickness||0).toFixed(2)}。`,"DETAIL",{units:[unit]});
    else if(result.state===WaterInteractionEngine.STATE.WATER_WALK&&result.source==="EFFECT")ctx.pushLog(`${unit.character.name} ${reason}｜舟艇／水上裝備生效，不進入游泳與下沉判定。`,"DETAIL",{units:[unit]});
    else if(result.state===WaterInteractionEngine.STATE.SWIMMING)ctx.pushLog(`${unit.character.name} ${reason}｜游泳疲勞 ${Number(result.fatigue).toFixed(1)}/${result.fatigueLimit}｜重量 ${result.weight}。`,"DETAIL",{units:[unit]});
    else if(result.state===WaterInteractionEngine.STATE.SINKING)ctx.pushLog(`${unit.character.name} ${reason}｜游泳疲勞 ${Number(result.fatigue).toFixed(1)}/${result.fatigueLimit}｜體力耗盡，開始沉沒。`,"BATTLE",{units:[unit]});
    else if(result.previousState===WaterInteractionEngine.STATE.SINKING)ctx.pushLog(`${unit.character.name} ${reason}｜脫離沉沒狀態。`,"DETAIL",{units:[unit]});
  }
  if(result.damage>0&&unit.alive){globalThis.EffectEngine?.applyDamage?.(unit,result.damage,{kind:"INTERNAL"});const label=trigger==="TICK"?"溺水／沉沒持續傷害":"沉沒衝擊傷害";ctx.pushLog(`${unit.character.name}｜${label} ${Math.round(result.damage)}｜HP ${unit.hp}。`,"BATTLE");if(unit.hp<=0){unit.alive=false;ctx.pushLog(`${unit.character.name} 因沉沒／溺水戰敗。`,"BATTLE");ctx.handleDefeated(unit,null,{type:"WATER_HAZARD",state:result.state,depth:result.depth,weight:result.weight,fatigue:result.fatigue,trigger});}}
  return result;
 }
 function applyElectricHazard(unit,effects,reason){
  const electric=effects.find(effect=>effect.type===EnvironmentEngine.EFFECT.ELECTRIFIED);if(!electric||!unit?.alive)return 0;const tile=tileFor(unit);if(!effectContacts(unit,tile,electric))return 0;const hitIds=Array.isArray(electric.damagedUnitIds)?electric.damagedUnitIds:(electric.damagedUnitIds=[]);if(hitIds.includes(String(unit.id)))return 0;hitIds.push(String(unit.id));const damage=Math.max(0,Number(electric.damage||EnvironmentEngine.HAZARD?.ELECTRIC_DAMAGE||0));if(damage<=0)return 0;
  const protection=globalThis.ItemRuntimeEngine?.resolveTrigger?.(unit,"ELECTRIC_DAMAGE",{damage,reason,electric});if(protection?.preventDamage){ctx.pushLog(`${unit.character.name}｜${protection.item?.name||"防雷道具"} 自動觸發，防止 ${damage} 雷電傷害。`,"SYSTEM",{units:[unit]});return 0;}
  const dealt=globalThis.EffectEngine?.applyDamage?.(unit,damage,{kind:"EXTERNAL",damageType:"THUNDER"})?.hpLoss??damage;ctx.pushLog(`${unit.character.name} ${reason}｜水體雷電傳導 ${dealt} 傷害｜HP ${unit.hp}。`,"BATTLE");if(unit.hp<=0&&unit.alive){unit.alive=false;ctx.pushLog(`${unit.character.name} 被水體雷電傳導擊倒。`,"BATTLE");ctx.handleDefeated(unit,null,{type:"ELECTRIFIED",source:"ENVIRONMENT",origin:electric.origin||null});}return dealt;
 }
 function applyBoilingHazard(unit,effects,reason){if(!unit?.alive)return 0;const s=state(),tile=TacticalEngine.tile(s.map,unit.x,unit.y);if(!HydrologyEngine.isWater(tile))return 0;const boiling=effects.find(effect=>effect.type===EnvironmentEngine.EFFECT.BOILING);if(!boiling||!effectContacts(unit,tile,boiling))return 0;const damage=Math.max(0,Number(boiling.damage||EnvironmentEngine.HAZARD?.BOILING_DAMAGE||0));if(damage<=0)return 0;const dealt=globalThis.EffectEngine?.applyDamage?.(unit,damage,{kind:"EXTERNAL"})?.hpLoss??damage;ctx.pushLog(`${unit.character.name} ${reason}｜沸騰水域 ${dealt} 火焰傷害｜HP ${unit.hp}。`,"BATTLE");if(unit.hp<=0&&unit.alive){unit.alive=false;ctx.pushLog(`${unit.character.name} 被沸騰水域煮倒。`,"BATTLE");ctx.handleDefeated(unit,null,{type:"BOILING",source:"ENVIRONMENT",heat:boiling.heat||1});}return dealt;}
 function applyFireHazard(unit,effects,reason){const burning=effects.find(effect=>effect.type===EnvironmentEngine.EFFECT.BURNING);if(!burning||!unit?.alive)return 0;const tile=tileFor(unit);if(!effectContacts(unit,tile,burning))return 0;const damage=Math.max(0,Number(burning.damage||EnvironmentEngine.HAZARD?.BURNING_DAMAGE||0));if(damage<=0)return 0;const dealt=globalThis.EffectEngine?.applyDamage?.(unit,damage,{kind:"EXTERNAL",damageType:"FIRE"})?.hpLoss??damage;ctx.pushLog(`${unit.character.name} ${reason}｜燃燒傷害 ${dealt}｜HP ${unit.hp}。`,"BATTLE");if(unit.hp<=0&&unit.alive){unit.alive=false;ctx.pushLog(`${unit.character.name} 被環境火焰擊倒。`,"BATTLE");ctx.handleDefeated(unit,null,{type:"BURNING",source:"ENVIRONMENT"});}return dealt;}
 // Reactions are applied through the same EffectEngine BURN status and the
 // EnvironmentEngine fire-heat budget, whether the contact came from weather,
 // true water depth, or a skill. Only the Hydrology layer owns surface water.
 function applyWaterToBurn(unit,volume,source,events=[],pulseKey=null){
   if(!unit?.alive||!globalThis.EffectEngine?.hasEffect?.(unit,"BURN"))return 0;
   const result=EffectEngine.exchangeWaterBurn(unit,volume,{source,pulseKey});
   if(result.evaporatedWater>0){
     EnvironmentEngine.addSteam(state().environmentState,unit.x,unit.y,events,{reason:"UNIT_BURN_WATER_EXCHANGE"});
     events.push({type:"UNIT_BURN_WATER_EXCHANGE",unitId:unit.id,x:unit.x,y:unit.y,source,
       contactWater:result.incomingWater,evaporatedWater:result.evaporatedWater,
       remainingWater:result.remainingWater,extinguished:result.extinguished});
   }
   if(result.extinguished)ctx.pushLog(`${unit.character?.name||unit.id} 的燃燒狀態因水接觸解除。`,"SYSTEM");
   return result.evaporatedWater;
 }
 function settleUnitWetEvents(events,reason){
   if(!events?.length)return;
   const changed=events.some(event=>event.type==="WATER_REDUCED");
   if(changed)HydrologyEngine.redistribute(state().map,{source:"UNIT_BURN_WATER_EVAPORATION",events});
   events.forEach(logEnvironmentEvent);
   // A wet-state change uses the existing battle/environment event authority;
   // pulse stamps prevent its recheck from consuming a second water parcel.
   if(changed)resolveEnvironmentEvents(events,{reason});
 }
 function wetContactAt(unit){
   const s=state(),tile=TacticalEngine.tile(s.map,unit.x,unit.y),contact=globalThis.EnvironmentContactEngine;
   if(!tile||!contact||!unit?.alive)return{rain:false,water:false,tile};
   const layer=contact.layerOf(unit,tile);
   const rain=EnvironmentEngine.isRain(s.environmentState)&&
     s.environmentState.climate?.lastPrecipitationPulseTurn===s.environmentState.climate?.turn&&
     layer!==contact.LAYER.UNDERGROUND;
   // WAVE_VOLUME includes grounded feet and wading/swimming bodies, but not
   // aerial/underground units separated from the actual water surface.
   const water=HydrologyEngine.isWater(tile)&&contact.contacts(unit,tile,contact.PROFILE.WAVE_VOLUME);
   return{rain,water,tile};
 }
 function resolveWetContact(unit,{reason="環境",events=null}={}){
   if(!unit?.alive||!globalThis.EffectEngine?.hasEffect?.(unit,"BURN"))return false;
   const s=state(),{rain,water,tile}=wetContactAt(unit),results=events||[],turn=Number(s.environmentState?.climate?.turn||0);
   if(rain)applyWaterToBurn(unit,EnvironmentEngine.rainAmount(s.environmentState),"PRECIPITATION",results,turn);
   let changed=false;
   if(water&&tile&&globalThis.EffectEngine?.hasEffect?.(unit,"BURN")){
     const consumed=applyWaterToBurn(unit,HydrologyEngine.waterDepth(tile),"WATER_VOLUME",results,`${turn}:${tile.x},${tile.y}`);
     if(consumed>0){HydrologyEngine.removeWater(tile,consumed,results);changed=true;}
   }
   if(!events)settleUnitWetEvents(results,"燃燒單位遇水造成水位變化");
   return changed;
 }
 function resolveWaterSkillHit(entry){
   if(!entry?.result?.hit||entry.skill?.waterContact!=="RAIN_EVENT")return;
   const s=state(),target=entry.target;
   if(!target||!s.map||!s.environmentState)return;
   const volume=HydrologyEngine.RAIN_FILL_PER_EVENT;
   const events=EnvironmentEngine.waterImpact(s.map,s.environmentState,target.x,target.y,{
     volume,source:entry.skill.id,intercept:(incoming,allEvents)=>{
       if(!target.alive)return incoming;
       const evaporated=applyWaterToBurn(target,incoming,entry.skill.id,allEvents);
       return incoming-evaporated;
     }
   });
   events.forEach(logEnvironmentEvent);
   resolveEnvironmentEvents(events,{reason:`${entry.skill.name} 水流接觸`});
 }
 function applyEnvironmentHazardToUnit(unit,{reason="環境",waterTrigger="CHANGE",includeElectric=true,includeBoiling=true,includeFire=true,waterReactionEvents=null}={}){const s=state();if(!unit?.alive)return 0;let total=0;const water=applyWaterInteraction(unit,{trigger:waterTrigger,reason});total+=Number(water?.damage||0);if(!unit.alive||!s.environmentState)return total;resolveWetContact(unit,{reason,events:waterReactionEvents});const effects=EnvironmentEngine.effectAt(s.environmentState,unit.x,unit.y);if(includeElectric&&unit.alive)total+=applyElectricHazard(unit,effects,reason);if(includeBoiling&&unit.alive)total+=applyBoilingHazard(unit,effects,reason);if(includeFire&&unit.alive)total+=applyFireHazard(unit,effects,reason);return total;}
 function applyForcedMovement(source,target,distance,{name="強制位移",lift=0,damage=0,damageType="PHYSICAL",resistAxes=null,type="KNOCKBACK"}={}){
  const s=state();if(damage>0&&target?.alive)ctx.damageUnitFlat(target,damage,name);if(!target?.alive)return{applied:false,defeated:true,steps:[],falls:[],fallDamage:0};
  const movementType=String(type||"KNOCKBACK").toUpperCase()==="PULL"?"PULL":"KNOCKBACK",result=PostEngagementEngine.forcedMove({map:s.map,units:s.units,source,target,effect:{type:movementType,distance,lift,force:{horizontal:distance,vertical:lift},...(resistAxes?{resistAxes}:{})},onCollision:resolveCollisionRuntime});
  if(result.applied){if(result.airborne){const d=result.displacement;ctx.pushLog(`${target.character.name} 被${name}捲起至 Z${result.travelZ}，位移 ${result.steps.length} 格${d?`｜重量 ${d.weightClass}｜力 ${d.baseLift}→有效升空 ${d.lift}`:""}。`,"BATTLE");}else ctx.pushLog(`${target.character.name} 被${name}${movementType==="PULL"?"拉向中心":"推離"} ${result.steps.length} 格。`,"BATTLE");if(result.landing)ctx.pushLog(`${target.character.name} 落地 Z${result.landing.fromZ}→H${result.landing.toZ}${result.fallDamage?`｜墜落傷害 ${result.fallDamage}｜HP ${target.hp}`:"｜無墜落傷害"}。`,result.fallDamage?"BATTLE":"DETAIL");if(target.alive)enterTile(target);}
  if(result.defeated)ctx.handleDefeated(target,source,{type:"ENVIRONMENT_FORCE",name,damageType});return result;
 }
 function applyCurrentToUnit(unit,{reason="水流"}={}){
  if(globalThis.VerticalMobilityEngine?.ignoresCurrent?.(unit))return false;
  const s=state();if(!unit?.alive||unit._currentResolving||!globalThis.ClimateEngine)return false;const tile=TacticalEngine.tile(s.map,unit.x,unit.y);if(!profileContacts(unit,tile,globalThis.EnvironmentContactEngine?.PROFILE?.WATER_VOLUME||"WATER_VOLUME",{type:"CURRENT"}))return false;const current=ClimateEngine.currentForce(tile,s.environmentState);if(!current)return false;
  unit._currentResolving=true;try{const source={x:unit.x-current.flowX,y:unit.y-current.flowY};ctx.pushLog(`${unit.character.name} 遭${reason}沖刷｜流速 ${current.speed.toFixed(2)}｜位移力 ${current.distance}。`,"BATTLE",{units:[unit]});applyForcedMovement(source,unit,current.distance,{name:"暴漲溪流",damage:Math.max(0,Math.round((current.speed-1)*8)),damageType:"WATER"});return true;}finally{delete unit._currentResolving;}
 }
 function enterTile(unit){const s=state();if(!unit?.alive)return;
  const vortex=EnvironmentEngine.effectAt(s.environmentState,unit.x,unit.y).find(effect=>
    effect.type===EnvironmentEngine.EFFECT.WHIRLPOOL&&
    (effect.onlyEnemies!==true||effect.sourceTeam!==unit.team));
  if(!vortex)globalThis.EffectEngine?.removeEffectById?.(unit,"WHIRLPOOL_TRAPPED");ctx.stageEvent({type:"ENTER_TILE",unitId:unit.id,characterId:unit.character.id,x:unit.x,y:unit.y,z:Number(unit.z??(TacticalEngine.elevation(TacticalEngine.tile(s.map,unit.x,unit.y))||0)),team:teamLabel(unit.team)});const spotted=globalThis.EffectEngine?.resolveProximityReveal?.(unit,s.units)||[];spotted.filter(({observer})=>observer.team===ctx.TEAM?.PLAYER).forEach(({observer,target})=>ctx.pushLog(`${observer.character.name} 近身察覺 ${target.character.name}，但目標仍處於潛行。`,"DETAIL"));const tile=TacticalEngine.tile(s.map,unit.x,unit.y),trap=globalThis.EnvironmentEngine?.effectAt?.(s.environmentState,unit.x,unit.y)?.find?.(effect=>effect.type===EnvironmentEngine.EFFECT.TRAP);if(trap&&profileContacts(unit,tile,globalThis.EnvironmentContactEngine?.PROFILE?.SURFACE||"SURFACE",trap)){const triggered=EnvironmentEngine.triggerTrap?.(s.environmentState,unit.x,unit.y,unit);if(triggered){ctx.pushLog(`${unit.character.name} 觸發「${triggered.trap?.name||"陷阱"}」。`,"BATTLE");ctx.damageUnitFlat(unit,triggered.damage,triggered.trap?.name||"陷阱");if(!unit.alive)return;}}applyEnvironmentHazardToUnit(unit,{reason:"踏入環境區",waterTrigger:"ENTER"});if(unit.alive&&!unit._currentResolving)applyCurrentToUnit(unit,{reason:"溪流"});}
 function publishAlchemyHarvest(unit,x,y,kind){
   const s=state(),name={HERB:'草本',WOOD:'木質',MINERAL:'礦質',CRYSTAL_SAND:'河床晶砂'},
     sourceName={OBJECT:'環境物件',BEDROCK:'天然岩盤',CLIFF_FACE:'崖壁',RIVERBED:'河床',RIVERBANK:'河岸沉積'};
   for(const found of collectAlchemyOnStep({map:s.map,environmentState:s.environmentState,unit,x,y,kind,round:s.round})){
     const label=`${name[found.kind]||found.kind} +1${found.quality==='HIGH'?`、高品質${name[found.kind]||found.kind}・${ALCHEMY_AFFINITY_NAMES[found.affinity]||found.affinity} +1`:''}`;
     ctx.pushLog(`${unit.character.name} 採集（${sourceName[found.sourceType]||'合法來源'}）｜${label}。`,'BATTLE',{units:[unit]});
     globalThis.UnitAnimationEngine?.emitPresentation?.(found.type,found);
     globalThis.UnitAnimationEngine?.emitPresentation?.('UNIT_FLOAT_TEXT',{
       unitId:unit.id,x:unit.x,y:unit.y,renderZ:Number(unit.z||0),
       kind:'STATUS',value:`採集 ${label}`});
   }
 }
 function traverseUnitPath(unit,path,{kind="UNIT"}={}){
  const s=state();
  if((path||[]).length&&globalThis.BurialEngine?.canMove&&!BurialEngine.canMove(unit)){ctx.pushLog(`${unit.character.name} 被堆積物困住，無法移動。`,"BATTLE",{units:[unit]});return{completed:false,reason:"BURIED"};}
  if((path||[]).length&&globalThis.BurialEngine?.state?.(unit)){ctx.pushLog(`${unit.character.name} 從堆積物中掙脫並開始移動。`,"DETAIL",{units:[unit]});BurialEngine.clear(unit);}
  // Starting a legal movement can sample the starting tile and its legal
  // neighbors too. This is a committed movement event, never a map preview.
  if(kind==='UNIT'&&(path||[]).length)publishAlchemyHarvest(unit,unit.x,unit.y,kind);
  let previous={x:unit.x,y:unit.y};
  for(const tile of path||[]){
    const incoming={dx:Math.sign(tile.x-previous.x),dy:Math.sign(tile.y-previous.y)};
    unit.x=tile.x;unit.y=tile.y;unit.z=Number(tile.elevation||0);enterTile(unit);
    if(!unit.alive)return{completed:false,reason:"DEFEATED"};
    if(unit.x!==tile.x||unit.y!==tile.y)return{completed:false,reason:"CURRENT"};
    publishAlchemyHarvest(unit,tile.x,tile.y,kind);
    const interaction=EnvironmentEngine.pathInteraction({state:s.environmentState,x:tile.x,y:tile.y,kind}),forced=interaction.effects?.find(e=>e.type==="FORCED_MOVE");
    if(forced&&effectContacts(unit,tile,forced.effect)){const element=String(forced.element||forced.effect?.element||"AIR").toUpperCase(),name=forced.effect?.type===EnvironmentEngine.EFFECT.FIRE_TORNADO||element==="FIRE"?"火龍捲":element==="WATER"?"水龍捲":"龍捲風";if(Number(forced.debrisDamage||0)>0)ctx.pushLog(`${unit.character.name} 同時遭龍捲風內的樹幹撞擊｜額外 ${Number(forced.debrisDamage||0)} 傷害。`,"BATTLE",{units:[unit]});applyForcedMovement({x:tile.x,y:tile.y},unit,forced.distance,{name,lift:Number(forced.lift??forced.effect?.lift??0),damage:Number(forced.damage??forced.effect?.damage??0),damageType:forced.effect?.damageType||"PHYSICAL",resistAxes:forced.resistAxes||forced.effect?.resistAxes});return{completed:false,reason:"ENVIRONMENT_FORCE"};}
    const friction=Number(globalThis.EnvironmentResolver?.surfaceFriction?.(s.environmentState,tile)??1);
    const momentum=Math.max(0,1-friction);
    if(kind==="UNIT"&&momentum>=.5&&(incoming.dx||incoming.dy)&&!globalThis.VerticalMobilityEngine?.isAirborne?.(unit)&&!globalThis.VerticalMobilityEngine?.isBurrowed?.(unit)){
      const distance=Math.max(1,Math.min(2,Math.ceil(momentum*2))),source={x:unit.x-incoming.dx,y:unit.y-incoming.dy};
      ctx.pushLog(`${unit.character.name} 在低摩擦地表失去制動｜摩擦 ${friction.toFixed(2)}｜慣性位移 ${distance}。`,"DETAIL",{units:[unit]});
      applyForcedMovement(source,unit,distance,{name:"滑行",damage:0,damageType:"PHYSICAL"});
      return{completed:false,reason:"SURFACE_MOMENTUM"};
    }
    previous={x:tile.x,y:tile.y};
  }
  return{completed:true};
 }
 function resolveMassFlow(event){
  const s=state(),path=event.path||[],cells=event.cells||path,initial=(s.units||[]).filter(u=>u?.alive&&cells.some(p=>p.x===u.x&&p.y===u.y));let count=0;
  // Preserve authoritative path before movement/damage animations enter the same event queue.
  const presentation=path.length>=2?globalThis.UnitAnimationEngine?.emitPresentation?.("MASS_FLOW",{...event,path:path.map(p=>({...p})),cells:cells.map(p=>({...p})),contacts:[]}):null;
  const material=event.material||"SNOW",name=material==="SOIL"?"土石流":(material==="ROCK"||material==="DEBRIS")?"山崩／落石":"雪崩";
  for(const unit of initial){
    if(!unit.alive)continue;
    const tile=TacticalEngine.tile(s.map,unit.x,unit.y);if(!eventContacts(unit,tile,event))continue;
    const index=path.findIndex(p=>p.x===unit.x&&p.y===unit.y),distance=index<0?0:Math.min(Math.max(0,Math.round(Number(event.forceDistance||1))),path.length-index-1);
    if(index<0)continue; // lateral deposits are handled by BurialEngine, not full channel impact
    if(presentation)presentation.contacts.push({unitId:unit.id,x:unit.x,y:unit.y});
    let struck=false;
    for(let step=0;step<distance&&unit.alive;step++){
      const from=path[index+step],to=path[index+step+1];
      if(unit.x!==from.x||unit.y!==from.y)break;
      const dx=Math.sign(to.x-from.x),dy=Math.sign(to.y-from.y);
      if(!dx&&!dy)break;
      const result=applyForcedMovement({x:unit.x-dx,y:unit.y-dy},unit,1,
        {name,damage:struck?0:Number(event.damage||0),damageType:"PHYSICAL",resistAxes:{horizontal:false,vertical:true}});
      struck=true;
      if(!result?.steps?.length||unit.x!==to.x||unit.y!==to.y)break;
    }
    if(!struck)ctx.damageUnitFlat(unit,Math.max(0,Number(event.damage||0)),name);
    count++;
  }
  return count;
 }
 function resolveTornadoAdvance(event){
  const s=state(),path=event.path||[],pathKeys=new Set(path.map(point=>`${point.x},${point.y}`)),initial=(s.units||[]).filter(unit=>unit?.alive&&pathKeys.has(`${unit.x},${unit.y}`));let count=0;
  const element=String(event.element||"AIR").toUpperCase(),name=element==="FIRE"?"火龍捲":element==="WATER"?"水龍捲":"龍捲風",dx=Math.sign(Number(event.dx||0)),dy=Math.sign(Number(event.dy||0)),debrisDamage=Math.max(0,Number(event.debrisDamage||0));
  for(const unit of initial){
   if(!unit.alive)continue;const tile=TacticalEngine.tile(s.map,unit.x,unit.y);if(!profileContacts(unit,tile,globalThis.EnvironmentContactEngine?.PROFILE?.AIR_COLUMN||"AIR_COLUMN",event))continue;
   if(debrisDamage>0)ctx.pushLog(`${unit.character.name} 被${name}內捲起的樹幹撞擊｜額外 ${debrisDamage} 傷害。`,"BATTLE",{units:[unit]});
   const source={x:unit.x-(dx||0),y:unit.y-(dy||0)};applyForcedMovement(source,unit,Number(event.pushDistance||2),{name,lift:Number(event.lift||0),damage:Number(event.damage||0)+debrisDamage,damageType:event.damageType||"PHYSICAL",resistAxes:{horizontal:false,vertical:true}});count++;
  }
  return count;
 }
 function resolveRogueWave(event){
  const s=state(),cells=event.cells||[],cellKeys=new Set(cells.map(point=>`${point.x},${point.y}`));if(!cellKeys.size)return 0;
  globalThis.UnitAnimationEngine?.emitPresentation?.("ROGUE_WAVE",{...event});
  const initial=(s.units||[]).filter(unit=>unit?.alive&&cellKeys.has(`${unit.x},${unit.y}`));let count=0;
  for(const unit of initial){
    if(!unit.alive||globalThis.VerticalMobilityEngine?.ignoresWaterInteraction?.(unit))continue;
    const tile=TacticalEngine.tile(s.map,unit.x,unit.y),profile=globalThis.EnvironmentContactEngine?.PROFILE?.WAVE_VOLUME||"WAVE_VOLUME";
    if(!profileContacts(unit,tile,profile,event))continue;
    const dx=Math.sign(Number(event.dx||0)),dy=Math.sign(Number(event.dy||0));
    if(!dx&&!dy)continue;
    const before={x:unit.x,y:unit.y};
    // The authoritative collision/weight/forced-move pipeline performs motion.
    applyForcedMovement({x:unit.x-dx,y:unit.y-dy},unit,Math.max(1,Number(event.pushDistance||1)),
      {name:"瘋狗浪",damage:Number(event.damage||0),damageType:"WATER",resistAxes:{horizontal:false,vertical:true}});
    if(!unit.alive){count++;continue;}
    const destination=TacticalEngine.tile(s.map,unit.x,unit.y),depth=Number(HydrologyEngine.waterDepth(destination)||0);
    // Only a genuinely different, submerged landing location can drown; contact
    // and impact damage never imply that a unit was pulled underwater.
    if((unit.x!==before.x||unit.y!==before.y)&&depth>=Number(globalThis.VerticalMobilityEngine?.bodyHeight?.(unit)||2)){
      const result=globalThis.WaterInteractionEngine?.forceSubmerge?.(unit,destination,{turns:Math.max(1,Number(event.submergeTurns||1)),impactDamage:0});
      if(result?.damage>0&&unit.alive)ctx.damageUnitFlat(unit,result.damage,"瘋狗浪捲入深水");
      if(result?.applied)ctx.pushLog(`${unit.character.name} 被瘋狗浪推入深水｜水深 ${depth.toFixed(2)}｜進入沉沒狀態。`,"BATTLE",{units:[unit]});
    }else ctx.pushLog(`${unit.character.name} 被瘋狗浪沖刷，但未被捲入深水。`,"DETAIL",{units:[unit]});
    count++;
  }
  return count;
 }
 function resolveTsunamiWave(event){
  const s=state(),fronts=event.fronts||[];
  if(!fronts.length)return 0;
  // The water renderer consumes the same documented ROGUE_WAVE presentation
  // primitive, but this gameplay event retains its separate enemy/ally rules.
  globalThis.UnitAnimationEngine?.emitPresentation?.("ROGUE_WAVE",{
    cells:event.cells||[],dx:event.dx,dy:event.dy,
    waveHeight:Number(event.waveHeight||.8),durationMs:Number(event.durationMs||1600),
    source:"TSUNAMI",sourceUnitId:event.sourceUnitId
  });
  const hitIds=new Set();let affected=0;
  const source=(s.units||[]).find(u=>u.id===event.sourceUnitId)||null;
  for(const row of fronts){
    const keys=new Set(row.map(tile=>`${tile.x},${tile.y}`));
    const contacted=(s.units||[]).filter(unit=>unit?.alive&&
      !hitIds.has(unit.id)&&keys.has(`${unit.x},${unit.y}`));
    for(const unit of contacted){
      hitIds.add(unit.id);
      if(unit.team===event.sourceTeam){
        const amount=Math.max(0,Math.round(Number(event.shieldHp||0)));
        if(amount>0&&globalThis.EffectEngine){
          const shield=EffectEngine.apply({source,target:unit,effect:{
            type:"SHIELD",id:"NEREIA_TSUNAMI_WATER_SHIELD",name:"水盾",classification:"POSITIVE",
            duration:2,amount
          }});
          if(shield?.applied)ctx.pushLog(`${unit.character.name} 被海嘯浪潮掃過｜獲得水盾 ${amount} HP，持續 2 回合。`,"BATTLE",{units:[unit]});
        }
      }else{
        const sourcePoint={x:unit.x-Number(event.dx||0),y:unit.y-Number(event.dy||0)};
        // The authoritative displacement engine subtracts target resistance.
        // Deliver one wave-driven grid step only when the existing weight/
        // collision rules permit it; do not teleport or bypass the resolver.
        const resistance=globalThis.DisplacementEngine?.resistance?.(unit);
        const push=Number(event.pushDistance||1)+Math.max(0,Number(resistance?.value||0));
        applyForcedMovement(sourcePoint,unit,push,{
          name:"海嘯",damage:0,damageType:"WATER",resistAxes:{horizontal:true,vertical:true}
        });
      }
      affected++;
    }
  }
  return affected;
 }
 function resolveWhirlpool(event){
  const s=state(),cells=event.cells||[],cellKeys=new Set(cells.map(point=>`${point.x},${point.y}`));if(!cellKeys.size)return 0;
  globalThis.UnitAnimationEngine?.emitPresentation?.("WHIRLPOOL_PULSE",{...event});
  const center={x:Number(event.centerX),y:Number(event.centerY)},initial=(s.units||[]).filter(unit=>unit?.alive&&cellKeys.has(`${unit.x},${unit.y}`));let count=0;
  for(const unit of initial){
    if(!unit.alive||globalThis.VerticalMobilityEngine?.ignoresWaterInteraction?.(unit))continue;
    if(event.onlyEnemies===true&&unit.team===event.sourceTeam)continue;
    let tile=TacticalEngine.tile(s.map,unit.x,unit.y),profile=globalThis.EnvironmentContactEngine?.PROFILE?.WAVE_VOLUME||"WAVE_VOLUME";if(!profileContacts(unit,tile,profile,event))continue;
    const distance=Math.abs(unit.x-center.x)+Math.abs(unit.y-center.y),pull=Math.max(0,Math.min(Number(event.pullDistance||1),Math.ceil(distance)));
    if(pull>0&&distance>0)applyForcedMovement(center,unit,pull,{name:"漩渦",damage:0,damageType:"WATER",type:"PULL",resistAxes:{horizontal:true,vertical:true}});
    if(!unit.alive){count++;continue;}
    tile=TacticalEngine.tile(s.map,unit.x,unit.y);const atCore=unit.x===center.x&&unit.y===center.y,nearCore=Math.abs(unit.x-center.x)+Math.abs(unit.y-center.y)<=1;
    if((atCore||nearCore)&&profileContacts(unit,tile,profile,event)&&
       HydrologyEngine.waterDepth(tile)>=Number(globalThis.VerticalMobilityEngine?.bodyHeight?.(unit)||2)){
      const result=globalThis.WaterInteractionEngine?.forceSubmerge?.(unit,tile,{turns:Math.max(1,Number(event.submergeTurns||1)),impactDamage:0});
      if(result?.applied)ctx.pushLog(`${unit.character.name} 被漩渦拖入水下｜進入沉沒狀態。`,"BATTLE",{units:[unit]});
      else if(result?.reason==="AQUATIC")ctx.pushLog(`${unit.character.name} 被捲入漩渦核心，但水生體質能維持水下姿態。`,"DETAIL",{units:[unit]});
    }
    // A pulse binds only units actually still in the vortex's water cells.
    const landed=EnvironmentEngine.effectAt(s.environmentState,unit.x,unit.y).find(effect=>
      effect.type===EnvironmentEngine.EFFECT.WHIRLPOOL&&
      (effect.onlyEnemies!==true||unit.team!==effect.sourceTeam));
    if(landed)globalThis.EffectEngine?.addEffect?.(unit,{type:"BUFF",id:"WHIRLPOOL_TRAPPED",name:"漩渦束縛",classification:"NEGATIVE",duration:1,movementRules:{immobilized:true}},null);
    count++;
  }
  return count;
 }
 function applyEnvironmentHazards({reason="持續環境傷害"}={}){const s=state(),environmentEvents=EnvironmentEngine.advanceEnvironmentTurn?.(s.map,s.environmentState)||[];globalThis.EffectEngine?.syncConditionalPassives?.(s.units,s.environmentState);environmentEvents.forEach(logEnvironmentEvent);resolveEnvironmentEvents(environmentEvents,{reason:"天候／環境變化"});
   // Expired or escaped vortices cannot keep a movement lock alive.
   for(const unit of (s.units||[]).filter(unit=>unit?.alive&&globalThis.EffectEngine?.hasEffect?.(unit,"WHIRLPOOL_TRAPPED"))){
     const active=EnvironmentEngine.effectAt(s.environmentState,unit.x,unit.y).find(effect=>
       effect.type===EnvironmentEngine.EFFECT.WHIRLPOOL&&
       (effect.onlyEnemies!==true||effect.sourceTeam!==unit.team));
     if(!active)EffectEngine.removeEffectById(unit,"WHIRLPOOL_TRAPPED");
   }
   const wetEvents=[];
   for(const unit of (s.units||[]).filter(unit=>unit?.alive))applyEnvironmentHazardToUnit(unit,{reason,waterTrigger:"TICK",waterReactionEvents:wetEvents});
   settleUnitWetEvents(wetEvents,"角色燃燒與積水交換");
   for(const unit of (s.units||[]).filter(unit=>unit?.alive))applyCurrentToUnit(unit,{reason:"暴漲水流"});
   // One humidity update per environmental step; real hydrology depth + climate.
   for(const unit of (s.units||[]).filter(unit=>unit?.alive)){
     const tile=TacticalEngine.tile(s.map,unit.x,unit.y);
     globalThis.UnitRuntimeEngine?.advanceHumidity?.(unit,tile,s.environmentState);
   }
 }
 function resolveEnvironmentEvents(events,{reason="環境連鎖"}={}){
  const list=events||[],s=state();if(!list.length)return 0;let affected=0;
  const hasElectric=list.some(event=>event.type==="ELECTRIC_CONDUCTION"),hydrologyChanged=list.some(event=>["ELEVATION_CHANGED","WATER_FLOW","WATER_ACCUMULATED","WATER_REDUCED","BASIN_FILLED","BASIN_DRAINED","HYDROLOGY_REBALANCED","FLOOD_AREA_RESOLVED","WATER_EVAPORATION","WATER_DRAINED_OFF_MAP","SNOWMELT_WATER","ICE_MELT","ICE_THINNED","WATER_FROZEN","CLIMATE_WATER_CHANGED","FREEZE_PULSE","ICE_THAW","WATER_TORNADO_FORMED","TORNADO_WATER_ENTRAINED","TORNADO_WATER_DEPOSITED"].includes(event.type));
  const boilingTiles=new Set(list.filter(event=>event.type==="WATER_BOILING"||event.type==="WATER_EVAPORATION").map(event=>`${event.x},${event.y}`));
  // Each contact emits one blast event. Overlapping cells in a single
  // contact pulse share one pressure front (maximum exposure per unit).
  const steamDamageByUnit=new Map();
  for(const blast of list.filter(event=>event.type==="STEAM_BLAST")){
    const damage=Math.max(0,Number(blast.damage||0)),contactKeys=new Set((blast.cells||[]).map(cell=>`${cell.x},${cell.y}`));
    if(damage<=0||!contactKeys.size)continue;
    for(const unit of (s.units||[]).filter(u=>u?.alive&&contactKeys.has(`${u.x},${u.y}`))){
      const tile=TacticalEngine.tile(s.map,unit.x,unit.y);
      if(!profileContacts(unit,tile,globalThis.EnvironmentContactEngine?.PROFILE?.AIR_COLUMN||"AIR_COLUMN",blast))continue;
      const current=steamDamageByUnit.get(unit.id);
      if(!current||damage>current.damage)steamDamageByUnit.set(unit.id,{unit,damage});
    }
  }
  for(const {unit,damage} of steamDamageByUnit.values()){
    if(unit.alive){ctx.damageUnitFlat(unit,damage,"蒸氣爆發");affected++;}
  }
  if(hydrologyChanged){
    const wetEvents=[];
    for(const unit of (s.units||[]).filter(unit=>unit?.alive)){
      const damage=applyEnvironmentHazardToUnit(unit,{reason:"水位／冰面／地形變化",waterTrigger:"CHANGE",includeElectric:false,includeBoiling:false,includeFire:false,waterReactionEvents:wetEvents});
      if(damage>0)affected++;
    }
    settleUnitWetEvents(wetEvents,"水位變化引發角色燃燒與水接觸");
  }
  if(hasElectric)for(const unit of (s.units||[]).filter(unit=>unit?.alive)){const damage=applyEnvironmentHazardToUnit(unit,{reason,waterTrigger:"CHECK",includeElectric:true,includeBoiling:false,includeFire:false});if(damage>0)affected++;}
  if(boilingTiles.size)for(const unit of (s.units||[]).filter(unit=>unit?.alive&&boilingTiles.has(`${unit.x},${unit.y}`))){const damage=applyEnvironmentHazardToUnit(unit,{reason:"水體受高熱影響",waterTrigger:"CHECK",includeElectric:false,includeBoiling:true,includeFire:false});if(damage>0)affected++;}
  for(const tornado of list.filter(event=>event.type==="TORNADO_ADVANCED"))affected+=resolveTornadoAdvance(tornado);
  for(const wave of list.filter(event=>event.type==="ROGUE_WAVE"))affected+=resolveRogueWave(wave);
  for(const wave of list.filter(event=>event.type==="TSUNAMI_WAVE"))affected+=resolveTsunamiWave(wave);
  for(const vortex of list.filter(event=>event.type==="WHIRLPOOL_PULSE"))affected+=resolveWhirlpool(vortex);
  for(const warning of list.filter(event=>event.type==="MASS_FLOW_WARNING"))globalThis.UnitAnimationEngine?.emitPresentation?.("MASS_FLOW_WARNING",{...warning,path:(warning.path||[]).map(p=>({...p}))});
  for(const flow of list.filter(event=>event.type==="MASS_FLOW"))affected+=resolveMassFlow(flow);for(const avalanche of list.filter(event=>event.type==="AVALANCHE"))affected+=resolveMassFlow({...avalanche,material:"SNOW"});
  const burialEvents=globalThis.BurialEngine?.applyEnvironmentEvents?.(s.units,s.map,list)||[];for(const burial of burialEvents){logEnvironmentEvent(burial);affected++;}
  for(const unit of (s.units||[]).filter(unit=>unit?.alive&&globalThis.BurialEngine?.state?.(unit)))BurialEngine.syncRenderPose(unit,s.map);
  if(list.some(event=>event.type==="RIVER_SURGE")){for(const unit of (s.units||[]).filter(unit=>unit?.alive)){const tile=TacticalEngine.tile(s.map,unit.x,unit.y);if(tile?.river&&applyCurrentToUnit(unit,{reason:"暴漲溪流"}))affected++;}}return affected;
 }
 function resolveWeatherEvents(){
  const s=state();if(!s.environmentState)return;
  for(const event of EnvironmentEngine.rollWeatherEvent({map:s.map,state:s.environmentState,units:s.units,random:ctx.random})){
    if(event.type!=="LIGHTNING_STRIKE")continue;const unit=event.unit;if(!unit?.alive)continue;
    globalThis.UnitAnimationEngine?.emitPresentation?.("LIGHTNING_STRIKE",{x:event.x,y:event.y,unitId:unit.id,damage:Number(event.damage||0)});
    const names=(event.riskReasons||[]).map(r=>r==="METAL"?"金屬裝備":r==="WATER"?"水域":"樹木／森林"),damage=Number(event.damage||0);
    const protection=globalThis.ItemRuntimeEngine?.resolveTrigger?.(unit,"LIGHTNING_DAMAGE",{damage,event});
    if(protection?.preventDamage)ctx.pushLog(`⚡ ${unit.character.name} 的 ${protection.item?.name||"防雷道具"} 自動觸發，防止 ${damage} 落雷傷害。`,"SYSTEM",{units:[unit]});
    else{const dealt=globalThis.EffectEngine?.applyDamage?.(unit,damage,{kind:"EXTERNAL",damageType:"THUNDER"})?.hpLoss??damage;ctx.pushLog(`⚡ 落雷擊中 ${unit.character.name}｜${dealt} 傷害｜HP ${unit.hp}${names.length?`｜高風險：${names.join("＋")}`:""}。`,"BATTLE",{units:[unit]});if(unit.hp<=0&&unit.alive){unit.alive=false;ctx.handleDefeated(unit,null,{type:"LIGHTNING"});}}
    if(EnvironmentEngine.isConductive(s.map,s.environmentState,event.x,event.y)){const conduction=[];EnvironmentEngine.conductThunder(s.map,s.environmentState,event.x,event.y,conduction,{damagedUnitIds:[unit.id]});conduction.forEach(logEnvironmentEvent);resolveEnvironmentEvents(conduction,{reason:"雷雨落雷引發水體傳導"});}
  }
 }
 function mudSourceLabel(event){const source=String(event?.source||"").toUpperCase();if(source.includes("SNOW")||source.includes("ICE")||source.includes("MELT"))return"融雪／積水";if(source.includes("RAIN")||source.includes("THUNDERSTORM")||source.includes("TYPHOON")||source.includes("TYPHOON"))return"降雨";if(source.includes("FLOOD"))return"洪水／積水";if(source.includes("MASS_FLOW"))return"土石流後積水";if(source.includes("ACCUMULATION")||source.includes("DRAIN")||source.includes("FLOW"))return"積水";return"土壤飽和／積水";}
 function logEnvironmentEvent(event){
  // Keep only real, ordered elemental events. The mark is useful while the
  // corresponding environment effect remains active; it is not permanent loot.
  const world=state(),map=world?.map,valid=Number.isSafeInteger(event?.x)&&Number.isSafeInteger(event?.y);
  const kind=event?.type==='IGNITE'?'FIRE':
    ['ELECTRIC_CONDUCTION','LIGHTNING_STRIKE','ELECTRIFIED','WATER_ELECTRIFIED'].includes(event?.type)?'THUNDER':null;
  // Without an active alchemist, environmental events must remain unchanged;
  // a later deployment can still read the currently active real effects.
  if(valid&&kind&&map&&world.units?.some(u=>u.alive&&u.character?.alchemyHarvest===true)){
    map.alchemyElementEventSequence=(map.alchemyElementEventSequence||0)+1;
    map.alchemyElementEvents??={};
    map.alchemyElementEvents[`${event.x},${event.y}`]={affinity:kind,sequence:map.alchemyElementEventSequence};
  }
  if(event.type==="IGNITE")ctx.pushLog(`(${event.x},${event.y}) 燃燒起來，成為火光來源。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="FIRE_EXTINGUISHED")ctx.pushLog(`(${event.x},${event.y}) 的火焰被水熄滅。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="UNIT_BURN_WATER_EXCHANGE")ctx.pushLog(`角色燃燒與水接觸｜${event.unitId}｜蒸發 ${Number(event.evaporatedWater||0).toFixed(3)} 水量${event.extinguished?"｜燃燒已熄滅":""}。`,"DETAIL");
  else if(event.type==="FIRE_WATER_EXCHANGE")ctx.pushLog(`火水接觸 (${event.x},${event.y})｜蒸發 ${Number(event.evaporatedWater||0).toFixed(3)} 水量｜殘餘熱量 ${Number(event.thermalAfter||0).toFixed(3)}。`,"DETAIL");
  else if(event.type==="FIRE_WEAKENED")ctx.pushLog(`(${event.x},${event.y}) 的重火降為普通火勢。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="STEAM_BLAST")ctx.pushLog(`♨ 蒸氣爆發 (${event.x},${event.y})｜高溫接觸格 ${event.cells?.length||0}｜瞬間傷害 ${event.damage}。`,"BATTLE");
  else if(event.type==="RAIN_EXTINGUISHED_FIRE")ctx.pushLog(`豪雨熄滅 (${event.x},${event.y}) 的普通火焰。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="SNOW_EXTINGUISHED_FIRE")ctx.pushLog(`降雪熄滅 (${event.x},${event.y}) 的普通火焰。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="RAIN_SUPPRESSED_FIRE")ctx.pushLog(`豪雨壓制 (${event.x},${event.y}) 的小火，無法形成燃燒地形。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="MUD_CREATED")ctx.pushLog(`${mudSourceLabel(event)}使 (${event.x},${event.y}) 的平地轉為泥濘。`,"DETAIL",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="MUD_DRY")ctx.pushLog(`(${event.x},${event.y}) 的泥濘乾燥，恢復為平地。`,"DETAIL",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="WATER_BOILING")ctx.pushLog(`♨ (${event.x},${event.y}) 水域開始沸騰｜水中單位會受到高熱傷害。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="WATER_EVAPORATION")ctx.pushLog(`高熱持續作用於 (${event.x},${event.y})｜蒸發水量 ${Number(event.amount||0).toFixed(2)}。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="WATER_BOILED_DRY")ctx.pushLog(`(${event.x},${event.y}) 的水已被持續高熱煮乾。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="STEAM_CREATED")ctx.pushLog(`高熱與水分作用，(${event.x},${event.y}) 產生蒸氣迷霧。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="STEAM_DISPERSED")ctx.pushLog(`風力吹散 (${event.x},${event.y}) 的蒸氣迷霧。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="HYDROLOGY_REBALANCED"&&event.changedTiles>0)ctx.pushLog(`水體重新分配｜${event.changedTiles} 格水位改變｜Water Volume ${Number(event.afterVolume||0).toFixed(2)}。`,"DETAIL");
  else if(event.type==="STONE_FRAGMENT")ctx.pushLog(`爆炸擊中石質物件，(${event.x},${event.y}) 產生破片${event.destroyed?"並炸開道路":""}。`,"SYSTEM");
  else if(event.type==="TORNADO_CREATED")ctx.pushLog(`(${event.x},${event.y}) 形成龍捲風場。`,"DETAIL");
  else if(event.type==="FIRE_TORNADO_CREATED")ctx.pushLog(`(${event.x},${event.y}) 的燃燒區被風捲起，形成火龍捲。`,"SYSTEM");
  else if(event.type==="WATER_TORNADO_FORMED")ctx.pushLog(`🌊 龍捲風捲入實際水量 ${Number(event.entrainedWaterVolume||0).toFixed(3)}｜規模 ${event.clusterSize||1} 格。`,"SYSTEM");
  else if(event.type==="TORNADO_WATER_ENTRAINED")ctx.pushLog(`水龍捲從 (${event.x},${event.y}) 捲起 ${Number(event.volume||0).toFixed(3)} 水量。`,"DETAIL");
  else if(event.type==="TORNADO_WATER_FIRE_CONTACT")ctx.pushLog(`水龍捲接觸 (${event.x},${event.y}) 火場｜汽化 ${Number(event.evaporated||0).toFixed(3)}。`,"DETAIL");
  else if(event.type==="TORNADO_WATER_DEPOSITED")ctx.pushLog(`水龍捲將 ${Number(event.volume||0).toFixed(3)} 未汽化水量交還地格 (${event.x},${event.y})。`,"DETAIL");
  else if(event.type==="TORNADO_ADVANCED")ctx.pushLog(`${event.element==="FIRE"?"🔥 火龍捲":event.element==="WATER"?"🌊 水龍捲":"🌪️ 龍捲風"}${Number(event.moved||0)>0?`沿風向移動 ${event.moved} 格`:"原地盤旋"}｜融合規模 ${event.clusterSize||1}｜局部風力 ${Number(event.windStrength||0).toFixed(1)}｜升力 ${event.lift||0}${event.carriedLogs?`｜捲帶樹幹 ${event.carriedLogs}`:""}。`,"DETAIL");
  else if(event.type==="TREE_UPROOTED"&&String(event.reason||"").includes("WIND")){const tornado=String(event.reason||"").includes("TORNADO_WIND"),typhoon=String(event.reason||"").includes("TYPHOON_WIND");ctx.pushLog(`${tornado?"🌪️ 龍捲風":typhoon?"🌀 颱風":"💨 強風"}將 (${event.x},${event.y}) 的${event.from==="DEAD_TREE"?"枯木":"樹木"}連根拔起｜根系支撐 -${Number(event.rootStrengthLost||0).toFixed(2)}。`,"SYSTEM");}
  else if(event.type==="TREE_FELLED"&&String(event.reason||"").includes("WIND")){const tornado=String(event.reason||"").includes("TORNADO_WIND"),typhoon=String(event.reason||"").includes("TYPHOON_WIND");ctx.pushLog(`${tornado?"🌪️ 龍捲風":typhoon?"🌀 颱風":"💨 強風"}折倒 (${event.x},${event.y}) 的${event.from==="DEAD_TREE"?"枯木":"樹木"}，留下樹樁與倒木。`,"SYSTEM");}
  else if((event.type==="VEGETATION_UPROOTED"||event.type==="VEGETATION_BROKEN")&&String(event.reason||"").includes("WIND")){const label=event.objectType==="BUSH"?"灌木":event.objectType==="STUMP"?"樹樁":"植被";ctx.pushLog(`💨 (${event.x},${event.y}) 的${label}${event.type==="VEGETATION_UPROOTED"?"被拔除":"被吹毀"}｜根系支撐 -${Number(event.rootStrengthLost||0).toFixed(2)}。`,"DETAIL");}
  else if(event.type==="FIRE_TORNADO_STOKED")ctx.pushLog(`🔥 火龍捲使 (${event.x},${event.y}) 的火勢轉為猛烈燃燒。`,"DETAIL");
  else if(event.type==="TORNADO_DISSIPATED")ctx.pushLog(`龍捲風移出戰場並消散。`,"DETAIL");
  else if(event.type==="ELECTRIC_CONDUCTION")ctx.pushLog(`⚡ 雷元素由 (${event.x},${event.y}) 傳遍相連水體｜${event.regionSize||1} 格帶電。`,"SYSTEM");
  else if(event.type==="RIVER_SURGE")ctx.pushLog(`🌊 ${event.weather==="TYPHOON"?"颱風":event.weather==="THUNDERSTORM"?"雷雨":"豪雨"}使溪流暴漲｜最高流速 ${Number(event.maxSpeed||0).toFixed(2)}。`,"SYSTEM",{public:true});
  else if(event.type==="ROGUE_WAVE")ctx.pushLog(`🌊 颱風風場與水域條件形成瘋狗浪｜風力 ${Number(event.windStrength||0).toFixed(1)}｜迎風距離 ${Number(event.fetch||0).toFixed(1)}｜浪高 ${Number(event.waveHeight||0).toFixed(2)}｜會將接觸單位捲入水下。`,"SYSTEM");
  else if(event.type==="WHIRLPOOL_CREATED")ctx.pushLog(`🌀 水域形成漩渦｜半徑 ${Number(event.radius||0).toFixed(1)}｜強度 ${Number(event.strength||0).toFixed(1)}。`,"SYSTEM");
  else if(event.type==="WHIRLPOOL_PULSE")ctx.pushLog(`🌀 漩渦持續牽引周圍水域｜拉力 ${Number(event.pullDistance||0)}。`,"DETAIL");
  else if(event.type==="WHIRLPOOL_FAILED")ctx.pushLog(`漩渦無法形成：目標必須是實際水域。`,"SYSTEM");
  else if(event.type==="SNOWFALL")ctx.pushLog(`❄️ ${event.weather==="BLIZZARD"?"暴風雪":"降雪"}累積｜${event.changedTiles||0} 格積雪增加｜最大雪深 ${Number(event.maxSnow||0).toFixed(2)}。`,"DETAIL",{public:true});
  else if(event.type==="FREEZE_PULSE")ctx.pushLog(`🧊 低溫使 ${event.changedTiles||0} 格水面結冰／增厚｜最大冰厚 ${Number(event.maxIce||0).toFixed(2)}。`,"SYSTEM",{public:true});
  else if(event.type==="SNOW_THAW")ctx.pushLog(`融雪｜${event.changedTiles||0} 格積雪減少｜回流水量 ${Number(event.meltVolume||0).toFixed(2)}。`,"DETAIL",{public:true});
  else if(event.type==="ICE_THAW")ctx.pushLog(`解凍｜${event.changedTiles||0} 格冰面變薄。`,"DETAIL",{public:true});
  else if(event.type==="MASS_FLOW_WARNING"){const label=event.material==="SNOW"?"雪崩":event.material==="SOIL"?"土石流":"山崩";ctx.pushLog(`⚠️ (${event.x},${event.y}) 坡面出現${label}失穩徵兆｜若條件持續，下一個環境回合可能崩落。`,"SYSTEM",{cells:[{x:event.x,y:event.y}]});}
  else if(event.type==="SEDIMENT_SETTLED")ctx.pushLog(`(${event.x},${event.y}) 泥沙沉積｜河床抬升 ${Number(event.amount||0).toFixed(4)}。`,"DETAIL",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="WATER_TURBIDITY_CHANGED")ctx.pushLog(`(${event.x},${event.y}) 水體受到${event.material==="SOIL"?"泥砂":"碎石"}混入，水色變混濁。`,"DETAIL",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="UNIT_BURIED"){const stage=event.fullyBuried?"完全滅頂":event.immobilized?"陷入堆積物":"部分掩埋";ctx.pushLog(`${event.name} 被${stage}｜埋深 ${Number(event.depth||0).toFixed(2)} / 身高 ${Number(event.bodyHeight||0).toFixed(2)}。`,event.immobilized?"BATTLE":"DETAIL");}
  else if(event.type==="MASS_FLOW_TERRAIN_CHANGED")ctx.pushLog(`地貌變化｜${event.material==="SOIL"?"土石流":(event.material==="ROCK"||event.material==="DEBRIS")?"山崩／落石":"質量流"}影響 ${event.tiles||0} 格｜高程改變 ${event.elevationChanges||0} 格｜地形類型改變 ${event.terrainChanges||0} 格｜侵蝕 ${Number(event.totalErosion||0).toFixed(3)}｜堆積 ${Number(event.totalDeposit||0).toFixed(3)}｜懸浮 ${Number(event.totalSuspended||0).toFixed(3)}｜最大降幅 ${Math.max(0,...(event.cells||event.path||[]).map(p=>Number(p.elevationBefore||0)-Number(p.elevationAfter||0))).toFixed(3)}｜最大抬升 ${Math.max(0,...(event.cells||event.path||[]).map(p=>Number(p.elevationAfter||0)-Number(p.elevationBefore||0))).toFixed(3)}。`,"DETAIL");
  else if(event.type==="MASS_FLOW"){const label=event.material==="SOIL"?"⛰️ 土石流":(event.material==="ROCK"||event.material==="DEBRIS")?"🪨 山崩／落石":"❄️ 雪崩";const cells=event.cells||event.path||[],snow=event.material==="SNOW",lower=Math.max(0,...cells.map(p=>snow?Number(p.snowDepthBefore||0)-Number(p.snowDepthAfter||0):Number(p.elevationBefore||0)-Number(p.elevationAfter||0))),rise=Math.max(0,...cells.map(p=>snow?Number(p.snowDepthAfter||0)-Number(p.snowDepthBefore||0):Number(p.elevationAfter||0)-Number(p.elevationBefore||0)));ctx.pushLog(`${label}由 (${event.x},${event.y}) 發生｜路徑 ${event.path?.length||0} 格｜影響 ${cells.length} 格｜質量 ${Number(event.mass||0).toFixed(3)}｜最大${snow?"雪深減少":"高程下降"} ${lower.toFixed(3)}｜最大${snow?"雪深增加":"高程抬升"} ${rise.toFixed(3)}｜衝擊 ${event.damage||0}。`,"SYSTEM");}
  else if(event.type==="SOIL_FROZEN")ctx.pushLog(`🧊 (${event.x},${event.y}) 含水土壤凍結｜形成凍土。`,"DETAIL",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="SOIL_THAWED")ctx.pushLog(`(${event.x},${event.y}) 凍土解凍｜原有土壤水分保留。`,"DETAIL",{cells:[{x:event.x,y:event.y}]});
  else if(event.type==="AVALANCHE"){const cells=event.cells||event.path||[],lower=Math.max(0,...cells.map(p=>Number(p.snowDepthBefore||0)-Number(p.snowDepthAfter||0))),rise=Math.max(0,...cells.map(p=>Number(p.snowDepthAfter||0)-Number(p.snowDepthBefore||0)));ctx.pushLog(`❄️ 雪崩由 (${event.x},${event.y}) 崩落｜路徑 ${event.path?.length||0} 格｜影響 ${cells.length} 格｜最大雪深減少 ${lower.toFixed(3)}｜最大雪深增加 ${rise.toFixed(3)}｜衝擊 ${event.damage||0}。`,"SYSTEM");}
 }
 return Object.freeze({resolveCollisionRuntime,applyForcedMovement,traverseUnitPath,applyWaterInteraction,applyEnvironmentHazardToUnit,applyEnvironmentHazards,resolveEnvironmentEvents,resolveWaterSkillHit,resolveRogueWave,resolveTsunamiWave,resolveWhirlpool,applyCurrentToUnit,enterTile,resolveWeatherEvents,logEnvironmentEvent});
}
globalThis.BattleEnvironmentController=Object.freeze({create,collectAlchemyOnStep,rollbackAlchemyHarvest,commitAlchemyHarvest,harvestCandidates,alchemyAffinity});
})();
globalThis.WaterInteractionEngine=WaterInteractionEngine;

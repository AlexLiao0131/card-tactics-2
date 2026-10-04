export const EnvironmentObjectEngine=(()=>{
  "use strict";

  const TYPE=Object.freeze({
    TREE:"TREE",
    DEAD_TREE:"DEAD_TREE",
    STUMP:"STUMP",
    LOG:"LOG",
    BOULDER:"BOULDER",
    BUSH:"BUSH"
  });

  const ALIASES=Object.freeze({ROCK:TYPE.BOULDER});
  const PROFILES=Object.freeze({
    [TYPE.TREE]:Object.freeze({
      name:"樹木",environment:"GRASS",destructible:true,maxDurability:72,blocksMovement:false,
      collisionHeight:2.4,hardness:2,collisionResponse:"BREAK",impactMultiplier:1,
      flammable:true,burnDamage:24,mass:2.1,rootStrength:.16,erosionResistance:.16,
      flowResistance:.42,flowBreakThreshold:1.45,carryThreshold:99,floatOnWater:false,
      windBreakThreshold:6.15,windUprootThreshold:6.70,windResistanceVariance:.70,windWetSoilPenalty:.75,windFrozenSoilBonus:.40
    }),
    [TYPE.DEAD_TREE]:Object.freeze({
      name:"枯木",environment:"GRASS",destructible:true,maxDurability:42,blocksMovement:false,
      collisionHeight:2.15,hardness:1.4,collisionResponse:"BREAK",impactMultiplier:.9,
      flammable:true,burnDamage:32,mass:1.7,rootStrength:.09,erosionResistance:.09,
      flowResistance:.25,flowBreakThreshold:.9,carryThreshold:99,floatOnWater:false,
      windBreakThreshold:4.50,windUprootThreshold:5.25,windResistanceVariance:.50,windWetSoilPenalty:.75,windFrozenSoilBonus:.30
    }),
    [TYPE.STUMP]:Object.freeze({
      name:"樹樁",environment:"GRASS",destructible:true,maxDurability:34,blocksMovement:false,
      collisionHeight:.45,hardness:2,collisionResponse:"BREAK",impactMultiplier:.7,
      flammable:true,burnDamage:18,mass:.8,rootStrength:.05,erosionResistance:.06,
      flowResistance:.12,flowBreakThreshold:1.3,carryThreshold:99,floatOnWater:false,
      windBreakThreshold:99,windUprootThreshold:7.20,windResistanceVariance:.30,windWetSoilPenalty:.70,windFrozenSoilBonus:.25
    }),
    [TYPE.LOG]:Object.freeze({
      name:"倒木",environment:"GRASS",destructible:true,maxDurability:46,blocksMovement:true,
      collisionHeight:.55,hardness:1.5,collisionResponse:"TRANSFER",impactMultiplier:.9,
      flammable:true,burnDamage:28,mass:1.25,rootStrength:0,erosionResistance:.01,
      flowResistance:.18,flowBreakThreshold:.7,carryThreshold:.75,floatOnWater:true,
      windBreakThreshold:99,windUprootThreshold:99,windCarryThreshold:7.00
    }),
    [TYPE.BOULDER]:Object.freeze({
      name:"巨石",environment:"STONE",destructible:true,maxDurability:90,blocksMovement:true,
      collisionHeight:1.15,hardness:4,collisionResponse:"BREAK",impactMultiplier:1.2,
      flammable:false,burnDamage:0,mass:4.5,rootStrength:0,erosionResistance:.24,
      flowResistance:.62,flowBreakThreshold:2.8,carryThreshold:3.25,floatOnWater:false,
      windBreakThreshold:99,windUprootThreshold:99,windCarryThreshold:99
    }),
    [TYPE.BUSH]:Object.freeze({
      name:"灌木",environment:"GRASS",destructible:true,maxDurability:24,blocksMovement:false,
      collisionHeight:.75,hardness:.6,collisionResponse:"BREAK",impactMultiplier:.55,
      flammable:true,burnDamage:26,mass:.3,rootStrength:.04,erosionResistance:.035,
      flowResistance:.07,flowBreakThreshold:.38,carryThreshold:.45,floatOnWater:false,
      windBreakThreshold:5.00,windUprootThreshold:5.60,windResistanceVariance:.40,windWetSoilPenalty:.60,windFrozenSoilBonus:.25
    })
  });

  const clean=value=>Math.max(0,Math.round(Number(value||0)*1000)/1000);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
  const key=(x,y)=>`${x},${y}`;

  function normalizeType(type){
    const raw=String(type||"").toUpperCase();
    return ALIASES[raw]||raw;
  }
  function profile(type){return PROFILES[normalizeType(type)]||null;}
  function isEnvironmentObject(object){return !!profile(object?.type||object?.canonicalType);}

  function hydrate(object){
    if(!object||String(object.type||"").toUpperCase()==="CORE")return object;
    const canonical=normalizeType(object.type),base=profile(canonical);
    if(!base)return object;
    object.type=canonical;
    object.canonicalType=canonical;
    object.environmentObject=true;
    for(const[k,v]of Object.entries(base))if(object[k]==null)object[k]=v;
    if(object.destructible&&object.durability==null)object.durability=Number(object.maxDurability||1);
    if(object.maxDurability==null&&object.durability!=null)object.maxDurability=Number(object.durability||1);
    return object;
  }

  function sortObjects(map){
    if(!map?.objects)return;
    map.objects.sort((a,b)=>{
      const ac=a?.destroyed?1:0,bc=b?.destroyed?1:0;if(ac!==bc)return ac-bc;
      const ab=a?.blocksMovement===true?0:1,bb=b?.blocksMovement===true?0:1;if(ab!==bb)return ab-bb;
      return String(a?.id||"").localeCompare(String(b?.id||""));
    });
  }

  function activeObjectsAt(map,x,y){
    return (map?.objects||[]).filter(o=>!o?.destroyed&&!o?.carriedBy&&o.x===x&&o.y===y).map(hydrate);
  }

  function deterministic01(value){
    const text=String(value||"");let h=2166136261>>>0;
    for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
    return h/4294967295;
  }

  function nextId(map,prefix,x,y){
    const used=new Set((map?.objects||[]).map(o=>String(o.id)));
    let id=`${prefix}_${x}_${y}`,n=1;while(used.has(id))id=`${prefix}_${x}_${y}_${n++}`;return id;
  }

  function spawn(map,{type,x,y,id=null,...overrides}={}){
    const canonical=normalizeType(type),base=profile(canonical);if(!map||!base)return null;
    map.objects??=[];
    const object=hydrate({id:id||nextId(map,canonical.toLowerCase(),x,y),type:canonical,x:Number(x),y:Number(y),...overrides});
    map.objects.push(object);sortObjects(map);return object;
  }

  function seedTerrainObjects(map,{seed=null}={}){
    if(!map?.tiles)return map;map.objects??=[];
    const resolvedSeed=seed??map.seed??map.id;
    for(const tile of map.tiles){
      const here=activeObjectsAt(map,tile.x,tile.y);
      const occupiedBySolid=here.some(o=>o.blocksMovement===true||String(o.type||"").toUpperCase()==="CORE");
      const dry=Number(tile.waterDepth||0)<=0&&!tile.river;

      if(tile.terrain==="FOREST"){
        if(!here.some(o=>[TYPE.TREE,TYPE.DEAD_TREE,TYPE.STUMP].includes(normalizeType(o.type)))){
          spawn(map,{id:`forest_tree_${tile.x}_${tile.y}`,type:TYPE.TREE,x:tile.x,y:tile.y});
        }
        const bushRoll=deterministic01(`${resolvedSeed}:forest-bush:${tile.x},${tile.y}`);
        if(bushRoll<.32&&!activeObjectsAt(map,tile.x,tile.y).some(o=>normalizeType(o.type)===TYPE.BUSH)){
          spawn(map,{id:`forest_bush_${tile.x}_${tile.y}`,type:TYPE.BUSH,x:tile.x,y:tile.y});
        }
        continue;
      }

      if(!dry||tile.captureZone||occupiedBySolid)continue;
      const bushChance=tile.terrain==="PLAIN"?.08:tile.terrain==="SAND"?.04:0;
      if(bushChance<=0)continue;
      const bushRoll=deterministic01(`${resolvedSeed}:open-bush:${tile.terrain}:${tile.x},${tile.y}`);
      if(bushRoll<bushChance&&!activeObjectsAt(map,tile.x,tile.y).some(o=>normalizeType(o.type)===TYPE.BUSH)){
        spawn(map,{id:`open_bush_${tile.x}_${tile.y}`,type:TYPE.BUSH,x:tile.x,y:tile.y});
      }
    }
    sortObjects(map);return map;
  }

  function initializeMap(map,{seed=null}={}){
    if(!map)return map;map.objects??=[];
    map.objects.forEach(hydrate);
    seedTerrainObjects(map,{seed});
    sortObjects(map);
    return map;
  }

  function sumAt(map,tile,field,cap=Infinity){
    if(!tile)return 0;
    return Math.min(cap,activeObjectsAt(map,tile.x,tile.y).reduce((sum,o)=>sum+Math.max(0,Number(o[field]??profile(o.type)?.[field]??0)),0));
  }
  const rootStrengthAt=(map,tile)=>sumAt(map,tile,"rootStrength",.32);
  const erosionResistanceAt=(map,tile)=>sumAt(map,tile,"erosionResistance",.60);
  const flowResistanceAt=(map,tile)=>sumAt(map,tile,"flowResistance",1.25);
  const flammableAt=(map,x,y)=>activeObjectsAt(map,x,y).some(o=>o.flammable===true);

  function setType(object,nextType){
    const keep={id:object.id,x:object.x,y:object.y,destroyed:false};
    for(const key of Object.keys(object))delete object[key];
    Object.assign(object,keep,{type:normalizeType(nextType)});hydrate(object);return object;
  }

  function transform(map,object,nextType,{events=[],reason="TRANSFORM"}={}){
    if(!object||object.destroyed)return null;const from=normalizeType(object.type);
    setType(object,nextType);
    events.push({type:"ENV_OBJECT_TRANSFORMED",objectId:object.id,x:object.x,y:object.y,from,to:object.type,reason});
    sortObjects(map);return object;
  }

  function destroy(map,object,{events=[],reason="DESTROYED",debris=0}={}){
    if(!object||object.destroyed)return false;object.destroyed=true;
    const tile=globalThis.HydrologyEngine?.tileAt?.(map,object.x,object.y)||map?.tiles?.find(t=>t.x===object.x&&t.y===object.y);
    if(tile&&debris>0)tile.debrisMass=clean(Number(tile.debrisMass||0)+debris);
    if(tile&&object.breaksIntoTerrain){const from=tile.terrain;tile.terrain=object.breaksIntoTerrain;if(from!==tile.terrain)events.push({type:"TERRAIN_CHANGED",x:tile.x,y:tile.y,from,to:tile.terrain,source:reason,objectId:object.id});}
    events.push({type:"ENV_OBJECT_DESTROYED",objectId:object.id,objectType:normalizeType(object.type),x:object.x,y:object.y,reason,debris:clean(debris)});
    sortObjects(map);return true;
  }

  function fellTree(map,object,{events=[],reason="FELLED",carryLog=false,target=null}={}){
    const from=normalizeType(object.type);if(from!==TYPE.TREE&&from!==TYPE.DEAD_TREE)return null;
    transform(map,object,TYPE.STUMP,{events,reason});
    const log=spawn(map,{type:TYPE.LOG,x:object.x,y:object.y,id:nextId(map,"log",object.x,object.y)});
    events.push({type:"TREE_FELLED",objectId:object.id,logId:log?.id||null,x:object.x,y:object.y,from,reason});
    if(log&&carryLog&&target)moveObject(map,log,target.x,target.y,{events,reason:`${reason}_CARRIED`});
    return log;
  }

  function uprootTree(map,object,{events=[],reason="UPROOTED",carryLog=false,target=null}={}){
    const from=normalizeType(object?.type);if(from!==TYPE.TREE&&from!==TYPE.DEAD_TREE)return null;
    const x=Number(object.x),y=Number(object.y),objectId=String(object.id),rootStrengthLost=Math.max(0,Number(object.rootStrength||profile(from)?.rootStrength||0));
    destroy(map,object,{events,reason});
    const log=spawn(map,{type:TYPE.LOG,x,y,id:nextId(map,"log",x,y)});
    events.push({type:"TREE_UPROOTED",objectId,logId:log?.id||null,x,y,from,reason,rootStrengthLost:clean(rootStrengthLost)});
    if(log&&carryLog&&target)moveObject(map,log,target.x,target.y,{events,reason:`${reason}_CARRIED`});
    return log;
  }

  function tileAt(map,x,y){return globalThis.HydrologyEngine?.tileAt?.(map,x,y)||map?.tiles?.find(tile=>tile.x===x&&tile.y===y)||null;}
  function soilMoistureRatio(tile){
    if(!tile)return 0;const hydro=globalThis.HydrologyEngine,capacity=Math.max(.001,Number(hydro?.soilCapacity?.(tile)??hydro?.SOIL_SATURATION_CAPACITY??.45));
    return clamp(Number(hydro?.soilMoisture?.(tile)??tile?.soilMoisture??0)/capacity,0,1);
  }
  function windResistance(map,state,object){
    hydrate(object);const tile=tileAt(map,object.x,object.y),base=profile(object.type)||{},variance=Math.max(0,Number(object.windResistanceVariance??base.windResistanceVariance??0));
    const variation=(deterministic01(`wind-resistance:${object.id}:${object.x},${object.y}`)-.5)*variance;
    const wetness=soilMoistureRatio(tile),frozen=!!globalThis.EnvironmentResolver?.frozenSoil?.(state,tile);
    const breakThreshold=Math.max(0,Number(object.windBreakThreshold??base.windBreakThreshold??99)+variation);
    const uprootThreshold=Math.max(0,Number(object.windUprootThreshold??base.windUprootThreshold??99)+variation*.7-wetness*Math.max(0,Number(object.windWetSoilPenalty??base.windWetSoilPenalty??0))+(frozen?Math.max(0,Number(object.windFrozenSoilBonus??base.windFrozenSoilBonus??0)):0));
    return{breakThreshold:clean(breakThreshold),uprootThreshold:clean(uprootThreshold),wetness:clean(wetness),frozen,variation:clean(variation)};
  }
  function resolveWindAt(map,state,x,y,wind,{events=[],source="WIND"}={}){
    const strength=clamp(Number(wind?.strength||0),0,8),result={affected:0,felled:0,uprooted:0,logs:[],rootStrengthLost:0};if(strength<=0)return result;
    for(const object of [...activeObjectsAt(map,x,y)]){
      const type=normalizeType(object.type),resistance=windResistance(map,state,object);
      if(type===TYPE.TREE||type===TYPE.DEAD_TREE){
        if(strength>=resistance.uprootThreshold){const beforeRoot=Math.max(0,Number(object.rootStrength||0)),log=uprootTree(map,object,{events,reason:`${source}_UPROOT`});if(log)result.logs.push(log);result.affected++;result.uprooted++;result.rootStrengthLost+=beforeRoot;events.push({type:"WIND_VEGETATION_FAILURE",failure:"UPROOT",objectType:type,x,y,strength,resistance,source});continue;}
        if(strength>=resistance.breakThreshold){const beforeRoot=Math.max(0,Number(object.rootStrength||0)),log=fellTree(map,object,{events,reason:`${source}_BREAK`});if(log)result.logs.push(log);result.affected++;result.felled++;result.rootStrengthLost+=Math.max(0,beforeRoot-Number(profile(TYPE.STUMP)?.rootStrength||0));events.push({type:"WIND_VEGETATION_FAILURE",failure:"BREAK",objectType:type,x,y,strength,resistance,source});}
        continue;
      }
      if(type===TYPE.BUSH){
        if(strength>=resistance.uprootThreshold){const root=Math.max(0,Number(object.rootStrength||0));destroy(map,object,{events,reason:`${source}_UPROOT`});result.affected++;result.uprooted++;result.rootStrengthLost+=root;events.push({type:"VEGETATION_UPROOTED",objectId:object.id,objectType:type,x,y,reason:`${source}_UPROOT`,strength,rootStrengthLost:clean(root)});}
        else if(strength>=resistance.breakThreshold){const root=Math.max(0,Number(object.rootStrength||0));destroy(map,object,{events,reason:`${source}_BREAK`});result.affected++;result.felled++;result.rootStrengthLost+=root;events.push({type:"VEGETATION_BROKEN",objectId:object.id,objectType:type,x,y,reason:`${source}_BREAK`,strength,rootStrengthLost:clean(root)});}
        continue;
      }
      if(type===TYPE.STUMP&&strength>=resistance.uprootThreshold){const root=Math.max(0,Number(object.rootStrength||0));destroy(map,object,{events,reason:`${source}_UPROOT_STUMP`});result.affected++;result.uprooted++;result.rootStrengthLost+=root;events.push({type:"VEGETATION_UPROOTED",objectId:object.id,objectType:type,x,y,reason:`${source}_UPROOT_STUMP`,strength,rootStrengthLost:clean(root)});}
    }
    result.rootStrengthLost=clean(result.rootStrengthLost);return result;
  }
  function resolveWind(map,state,wind,{events=[],source="WIND"}={}){
    const summary={affected:0,felled:0,uprooted:0,logs:[],rootStrengthLost:0};if(!map?.tiles)return summary;
    for(const tile of map.tiles){const result=resolveWindAt(map,state,tile.x,tile.y,wind,{events,source});summary.affected+=result.affected;summary.felled+=result.felled;summary.uprooted+=result.uprooted;summary.logs.push(...result.logs);summary.rootStrengthLost+=result.rootStrengthLost;}
    summary.rootStrengthLost=clean(summary.rootStrengthLost);return summary;
  }

  function moveObject(map,object,x,y,{events=[],reason="MOVED"}={}){
    if(!object||object.destroyed)return false;const from={x:object.x,y:object.y};object.x=Number(x);object.y=Number(y);
    events.push({type:"ENV_OBJECT_MOVED",objectId:object.id,objectType:normalizeType(object.type),from,to:{x:object.x,y:object.y},reason});
    sortObjects(map);return true;
  }

  function carriedObjects(map,carrierId=null){
    const id=carrierId==null?null:String(carrierId);
    return (map?.objects||[]).filter(object=>!object?.destroyed&&object?.carriedBy&&(id==null||String(object.carriedBy)===id)).map(hydrate);
  }

  function carryObject(map,object,carrierId,{events=[],reason="CARRIED"}={}){
    if(!map||!object||object.destroyed||!carrierId)return null;hydrate(object);
    const previous=object.carriedBy?String(object.carriedBy):null,next=String(carrierId);if(previous===next)return object;if(previous==null){object.carriedBlocksMovement=object.blocksMovement===true;object.blocksMovement=false;}object.carriedBy=next;
    events.push({type:"ENV_OBJECT_CARRIED",objectId:object.id,objectType:normalizeType(object.type),carrierId:object.carriedBy,previousCarrierId:previous,x:object.x,y:object.y,reason});
    sortObjects(map);return object;
  }

  function releaseObject(map,object,x,y,{events=[],reason="RELEASED"}={}){
    if(!map||!object||object.destroyed)return null;hydrate(object);
    const carrierId=object.carriedBy?String(object.carriedBy):null;object.x=Number(x);object.y=Number(y);delete object.carriedBy;if(object.carriedBlocksMovement!=null){object.blocksMovement=object.carriedBlocksMovement===true;delete object.carriedBlocksMovement;}
    events.push({type:"ENV_OBJECT_RELEASED",objectId:object.id,objectType:normalizeType(object.type),carrierId,x:object.x,y:object.y,reason});
    sortObjects(map);return object;
  }

  function applyDamage(map,object,amount,{events=[],reason="DAMAGE",fire=false}={}){
    if(!object||object.destroyed||object.destructible===false)return{destroyed:false,damage:0};
    hydrate(object);const damage=Math.max(0,Math.round(Number(amount||0)));if(damage<=0)return{destroyed:false,damage:0};
    object.durability=Math.max(0,Number(object.durability??object.maxDurability??1)-damage);
    events.push({type:"ENV_OBJECT_DAMAGED",objectId:object.id,objectType:normalizeType(object.type),x:object.x,y:object.y,damage,durability:object.durability,reason});
    if(object.durability>0)return{destroyed:false,damage};
    const type=normalizeType(object.type);
    if(fire){
      if(type===TYPE.TREE){transform(map,object,TYPE.DEAD_TREE,{events,reason:"BURNED"});return{destroyed:true,damage,transformed:true};}
      if(type===TYPE.DEAD_TREE){transform(map,object,TYPE.STUMP,{events,reason:"BURNED_DOWN"});return{destroyed:true,damage,transformed:true};}
      if(type===TYPE.STUMP||type===TYPE.LOG||type===TYPE.BUSH){destroy(map,object,{events,reason:"BURNED_AWAY"});return{destroyed:true,damage};}
    }
    if(type===TYPE.TREE||type===TYPE.DEAD_TREE){fellTree(map,object,{events,reason});return{destroyed:true,damage,transformed:true};}
    if(type===TYPE.BOULDER){destroy(map,object,{events,reason,debris:.55});return{destroyed:true,damage};}
    destroy(map,object,{events,reason});return{destroyed:true,damage};
  }

  function burnAt(map,x,y,{intensity="NORMAL",events=[]}={}){
    const heavy=String(intensity).toUpperCase()==="HEAVY";let affected=0;
    for(const object of [...activeObjectsAt(map,x,y)]){
      if(!object.flammable)continue;
      const base=Math.max(1,Number(object.burnDamage||20)),damage=heavy?Math.round(base*1.7):Math.round(base);
      applyDamage(map,object,damage,{events,reason:heavy?"HEAVY_FIRE":"FIRE",fire:true});affected++;
    }
    return affected;
  }

  function applyForces(map,x,y,forces,{events=[]}={}){
    const set=new Set((forces||[]).map(v=>String(v).toUpperCase()));let affected=0;
    if(set.has("HEAVY_FIRE"))affected+=burnAt(map,x,y,{intensity:"HEAVY",events});
    else if(set.has("FIRE"))affected+=burnAt(map,x,y,{intensity:"NORMAL",events});
    const shock=set.has("EXPLOSION")?110:set.has("IMPACT")?48:0;
    if(shock>0){for(const object of [...activeObjectsAt(map,x,y)]){applyDamage(map,object,shock,{events,reason:set.has("EXPLOSION")?"EXPLOSION":"IMPACT"});affected++;}}
    return affected;
  }

  function tickBurning(map,state,events=[]){
    if(!map||!state?.effects)return 0;let affected=0;
    for(const[k,list]of state.effects.entries()){
      const fire=list.find(e=>e.type==="FIRE_TORNADO")||list.find(e=>e.type==="BURNING");if(!fire)continue;
      const[x,y]=k.split(",").map(Number);affected+=burnAt(map,x,y,{intensity:fire.type==="FIRE_TORNADO"||fire.fireIntensity==="HEAVY"?"HEAVY":"NORMAL",events});
    }
    return affected;
  }

  function resolveMassFlow(map,flow,{events=[],source="MASS_FLOW"}={}){
    if(!map||!flow?.path?.length)return{affected:0,moved:0,destroyed:0};
    let affected=0,moved=0,destroyed=0;
    for(let i=0;i<flow.path.length;i++){
      const node=flow.path[i],drop=Math.max(0,Number(node.drop||0)),material=String(flow.material||"SOIL").toUpperCase();
      const materialForce=material==="ROCK"||material==="DEBRIS"?1.25:material==="SNOW"?.72:1;
      const force=Math.max(0,Number(flow.mass||0)*materialForce+drop*.65);
      const destination=flow.path[Math.min(flow.path.length-1,i+Math.max(1,Math.ceil(force*.7)))];
      for(const object of [...activeObjectsAt(map,node.x,node.y)]){
        const type=normalizeType(object.type),threshold=Math.max(.01,Number(object.flowBreakThreshold??99)),carry=Math.max(.01,Number(object.carryThreshold??99));
        if(force<threshold)continue;affected++;
        if(type===TYPE.LOG&&force>=carry){if(moveObject(map,object,destination.x,destination.y,{events,reason:`${source}_CARRY`}))moved++;continue;}
        if(type===TYPE.BOULDER&&force>=carry){const target=flow.path[Math.min(flow.path.length-1,i+1)];if(target&&(target.x!==object.x||target.y!==object.y)){moveObject(map,object,target.x,target.y,{events,reason:`${source}_BOULDER_ROLL`});moved++;}continue;}
        if(type===TYPE.TREE||type===TYPE.DEAD_TREE){const uproot=force>=threshold+.45,log=uproot?uprootTree(map,object,{events,reason:`${source}_UPROOT`,carryLog:force>=1.2,target:destination}):fellTree(map,object,{events,reason:`${source}_BREAK`,carryLog:force>=1.2,target:destination});if(log){destroyed++;if(log.x===destination.x&&log.y===destination.y)moved++;}continue;}
        const result=applyDamage(map,object,Math.round(force*70),{events,reason:`${source}_IMPACT`});if(result.destroyed)destroyed++;
      }
    }
    return{affected,moved,destroyed};
  }

  return Object.freeze({
    TYPE,PROFILES,normalizeType,profile,isEnvironmentObject,hydrate,initializeMap,seedTerrainObjects,
    activeObjectsAt,spawn,transform,destroy,fellTree,uprootTree,moveObject,carriedObjects,carryObject,releaseObject,applyDamage,burnAt,applyForces,tickBurning,
    rootStrengthAt,erosionResistanceAt,flowResistanceAt,flammableAt,windResistance,resolveWindAt,resolveWind,resolveMassFlow,sortObjects
  });
})();
globalThis.EnvironmentObjectEngine=EnvironmentObjectEngine;

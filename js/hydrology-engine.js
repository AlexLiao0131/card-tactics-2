export const HydrologyEngine=(()=>{
  "use strict";

  const WATERLINE=0;
  const RAIN_FILL_PER_EVENT=.06,HEAVY_RAIN_FILL_PER_EVENT=.12,STORM_RAIN_FILL_PER_EVENT=.16,NATURAL_WATER_DEPTH=1;
  const SOIL_SATURATION_CAPACITY=.45,SAND_SOIL_CAPACITY=.22,DRYING_PER_CLEAR_TURN=.10,SAND_DRYING_PER_CLEAR_TURN=.16,EVAPORATION_PER_CLEAR_TURN=.06;
  const EPSILON=.0001,FLOW_EPSILON=.0005,MAX_FLOW_ITERATIONS=256,MAX_DRAIN_CYCLES=64;
  const DIRS=[[1,0],[-1,0],[0,1],[0,-1]],FLOW_DIRS=[[1,0],[0,1]],key=(x,y)=>`${x},${y}`;

  const elevation=t=>Number(t?.elevation||0);
  const waterDepth=t=>Math.max(0,Number(t?.waterDepth||0));
  const waterSurfaceZ=t=>waterDepth(t)>EPSILON?elevation(t)+waterDepth(t):null;
  const isWater=t=>!!t&&waterDepth(t)>EPSILON;
  const canHoldWater=t=>!!t&&t.terrain!=="WALL";
  const clean=value=>Math.max(0,Math.round(Number(value||0)*10000)/10000);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
  const terrainHasSoil=terrain=>terrain==="PLAIN"||terrain==="MUD"||terrain==="FOREST"||terrain==="SAND";
  const baseTerrain=t=>t?.terrain==="WATER"?(t?.dryTerrain||"PLAIN"):t?.terrain;
  const soilCapacity=t=>baseTerrain(t)==="SAND"?SAND_SOIL_CAPACITY:SOIL_SATURATION_CAPACITY;
  const soilMoisture=t=>clamp(t?.soilMoisture??(t?.terrain==="MUD"?SOIL_SATURATION_CAPACITY:0),0,soilCapacity(t));
  const hasSoil=t=>!!t&&(terrainHasSoil(t.terrain)||(t.terrain==="WATER"&&terrainHasSoil(t.dryTerrain)));
  const turbidity=t=>clamp(t?.waterTurbidity||0,0,1);

  function tileAt(map,x,y){return map?.tiles?.find(t=>t.x===x&&t.y===y)||null}
  function surfaceWaterVolume(map){return(map?.tiles||[]).reduce((sum,t)=>sum+waterDepth(t),0)}
  function soilWaterVolume(map){return(map?.tiles||[]).reduce((sum,t)=>sum+(hasSoil(t)?soilMoisture(t):0),0)}
  function totalWater(map){return surfaceWaterVolume(map)+soilWaterVolume(map)}

  function sourceFedWaterKeys(map){
    const tiles=map?.tiles||[],by=new Map(tiles.map(t=>[key(t.x,t.y),t])),seen=new Set(),q=[];
    // Only real hydrology sources seed a permanent water network.
    // `river:true` describes channel topology; it is not itself an infinite source.
    for(const tile of tiles)if(tile?.hydrologySource===true)q.push(tile);
    while(q.length){
      const t=q.shift(),k=key(t.x,t.y);if(seen.has(k))continue;
      const source=t?.hydrologySource===true;
      if(!source&&!isWater(t))continue;
      seen.add(k);
      for(const[dx,dy]of DIRS){
        const n=by.get(key(t.x+dx,t.y+dy));if(!n||seen.has(key(n.x,n.y)))continue;
        if(isWater(n)||n.hydrologySource===true)q.push(n);
      }
    }
    return seen;
  }

  function riverComponents(map){
    const rivers=(map?.tiles||[]).filter(tile=>tile?.river===true);
    const by=new Map(rivers.map(tile=>[key(tile.x,tile.y),tile])),remaining=new Set(by.keys()),out=[];
    while(remaining.size){
      const first=remaining.values().next().value;
      remaining.delete(first);
      const q=[by.get(first)],component=[];
      while(q.length){
        const tile=q.shift();
        if(!tile)continue;
        component.push(tile);
        for(const[dx,dy]of DIRS){
          const k=key(tile.x+dx,tile.y+dy);
          if(!remaining.has(k))continue;
          remaining.delete(k);
          q.push(by.get(k));
        }
      }
      if(component.length)out.push(component);
    }
    return out;
  }

  function riverPrincipalVector(component){
    let sx=0,sy=0;
    for(const tile of component){
      sx+=Number(tile?.flowX||0);
      sy+=Number(tile?.flowY||0);
    }
    const length=Math.hypot(sx,sy);
    if(length>EPSILON)return{x:sx/length,y:sy/length};

    const xs=component.map(tile=>Number(tile.x||0)),ys=component.map(tile=>Number(tile.y||0));
    const spanX=Math.max(...xs)-Math.min(...xs),spanY=Math.max(...ys)-Math.min(...ys);
    return spanY>=spanX?{x:0,y:1}:{x:1,y:0};
  }

  function riverNeighbors(tile,by){
    const out=[];
    for(const[dx,dy]of DIRS){
      const neighbor=by.get(key(tile.x+dx,tile.y+dy));
      if(neighbor)out.push(neighbor);
    }
    return out;
  }

  function normalizeRiverComponent(component){
    if(!component.length)return null;
    const by=new Map(component.map(tile=>[key(tile.x,tile.y),tile]));
    const vector=riverPrincipalVector(component);
    const project=tile=>Number(tile.x||0)*vector.x+Number(tile.y||0)*vector.y;
    const leaves=component.filter(tile=>riverNeighbors(tile,by).length<=1);

    let drains=component.filter(tile=>tile?.hydrologyDrain===true);
    if(!drains.length){
      const pool=leaves.length?leaves:component;
      const maxProjection=Math.max(...pool.map(project));
      drains=pool.filter(tile=>Math.abs(project(tile)-maxProjection)<=EPSILON);
    }

    const drainKeys=new Set(drains.map(tile=>key(tile.x,tile.y)));
    let sources=component.filter(tile=>tile?.hydrologySource===true&&!drainKeys.has(key(tile.x,tile.y)));
    if(!sources.length){
      // Every upstream dead-end is a tributary/source. This makes branches physically
      // valid instead of creating an unexplained local water-surface hump.
      sources=leaves.filter(tile=>!drainKeys.has(key(tile.x,tile.y)));
      if(!sources.length){
        const minProjection=Math.min(...component.map(project));
        sources=component.filter(tile=>Math.abs(project(tile)-minProjection)<=EPSILON&&!drainKeys.has(key(tile.x,tile.y)));
      }
    }

    // Rebuild inferred source/drain markers deterministically.
    for(const tile of component){
      tile.hydrologySource=false;
      tile.hydrologyDrain=false;
    }
    for(const tile of sources)tile.hydrologySource=true;
    for(const tile of drains)tile.hydrologyDrain=true;

    // Graph distance to the nearest outlet defines downstream topology.
    const distance=new Map(),q=[];
    for(const tile of drains){
      const k=key(tile.x,tile.y);
      if(distance.has(k))continue;
      distance.set(k,0);
      q.push(tile);
    }
    while(q.length){
      const tile=q.shift(),d=distance.get(key(tile.x,tile.y))||0;
      for(const neighbor of riverNeighbors(tile,by)){
        const k=key(neighbor.x,neighbor.y);
        if(distance.has(k))continue;
        distance.set(k,d+1);
        q.push(neighbor);
      }
    }

    const maxDistance=Math.max(1,...distance.values());
    // Gentle river grade: enough to establish one-way flow, but not an artificial
    // waterfall every tile. The whole river rises only ~0.2–0.45 elevation units.
    const totalRise=clamp(maxDistance*.025,.20,.45);
    const step=totalRise/maxDistance;

    const currentOutletSurfaces=drains
      .map(tile=>waterSurfaceZ(tile))
      .filter(value=>value!=null&&Number.isFinite(value));
    const outletSurface=currentOutletSurfaces.length?Math.min(...currentOutletSurfaces):WATERLINE;

    for(const tile of component){
      const d=Number(distance.get(key(tile.x,tile.y))||0);
      const surface=clean(outletSurface+d*step);

      // A ford is shallow because its river bed rises toward the water surface.
      // The water surface itself never gets lifted above the upstream/downstream profile.
      const depth=tile.ford===true?.35:Math.max(.75,Math.min(2,waterDepth(tile)||NATURAL_WATER_DEPTH));
      tile.waterDepth=clean(depth);
      tile.elevation=clean(surface-depth);
      tile.waterSurfaceZ=surface;
      tile.terrain="WATER";
      tile.dryTerrain??="PLAIN";
      tile.soilMoisture=soilCapacity(tile);
      tile.river=true;

      if(tile.hydrologyDrain===true){
        tile.flowX=0;tile.flowY=0;
      }else{
        const here=d;
        const downstream=riverNeighbors(tile,by)
          .filter(n=>Number(distance.get(key(n.x,n.y)))<here)
          .sort((a,b)=>
            Number(distance.get(key(a.x,a.y)))-Number(distance.get(key(b.x,b.y)))||
            project(b)-project(a)
          )[0]||null;
        tile.flowX=downstream?Math.sign(downstream.x-tile.x):0;
        tile.flowY=downstream?Math.sign(downstream.y-tile.y):0;
      }

      const baseSpeed=tile.ford===true?.45:.62;
      tile.baseFlowSpeed=baseSpeed;
      tile.flowSpeed=baseSpeed;
      tile.baseDischarge=tile.ford===true?.8:1;
      tile.discharge=tile.baseDischarge;
    }

    return{
      tiles:component.length,
      sources:sources.map(tile=>({x:tile.x,y:tile.y})),
      drains:drains.map(tile=>({x:tile.x,y:tile.y})),
      maxDistance,
      outletSurface,
      sourceRise:totalRise
    };
  }

  function normalizeRiverNetwork(map){
    if(!map?.tiles?.length||map?.hydrology?.preserveRiverProfile===true)return[];
    return riverComponents(map).map(normalizeRiverComponent).filter(Boolean);
  }

  const baselineDepth=t=>Math.max(0,Number(t?.hydrologyBaseWaterDepth||0));
  function captureSourceBaselines(map){
    const fed=sourceFedWaterKeys(map);
    for(const tile of map?.tiles||[])tile.hydrologyBaseWaterDepth=fed.has(key(tile.x,tile.y))?clean(waterDepth(tile)):0;
    return fed;
  }
  function protectedDepth(tile,fed){return fed?.has(key(tile.x,tile.y))?Math.min(waterDepth(tile),baselineDepth(tile)):0}

  function initializeMap(map){
    for(const tile of map?.tiles||[]){
      tile.waterTurbidity=clean(clamp(tile.waterTurbidity||0,0,1));
      if(tile.terrain==="MUD"){tile.soilMoisture=SOIL_SATURATION_CAPACITY;continue;}
      if(tile.terrain==="SAND")tile.soilMoisture=clean(Math.min(SAND_SOIL_CAPACITY,Number(tile.soilMoisture||0)));
      if(tile.terrain!=="WATER")continue;
      if(!Number.isFinite(Number(tile.waterDepth))||Number(tile.waterDepth)<=0){
        tile.waterDepth=NATURAL_WATER_DEPTH;
        tile.elevation=Number(tile.elevation||0)-NATURAL_WATER_DEPTH;
      }
      tile.waterDepth=clean(tile.waterDepth);
      tile.waterSurfaceZ=elevation(tile)+waterDepth(tile);
      tile.dryTerrain??="PLAIN";
      if(terrainHasSoil(tile.dryTerrain))tile.soilMoisture=soilCapacity(tile);
    }
    map.hydrologyRiverProfiles=normalizeRiverNetwork(map);
    captureSourceBaselines(map);
    return map;
  }

  function connectedWaterBody(map,x,y){
    const start=tileAt(map,x,y);if(!isWater(start))return[];
    const by=new Map((map?.tiles||[]).map(t=>[key(t.x,t.y),t])),seen=new Set(),q=[start],out=[];
    while(q.length){const t=q.shift(),k=key(t.x,t.y);if(seen.has(k))continue;seen.add(k);if(!isWater(t))continue;out.push(t);for(const[dx,dy]of DIRS){const n=by.get(key(t.x+dx,t.y+dy));if(n&&!seen.has(key(n.x,n.y))&&isWater(n))q.push(n);}}
    return out;
  }

  function fillCapacity(tile){return Math.max(0,WATERLINE-elevation(tile))}

  function markMud(tile,events=[],source="SATURATION"){
    if(!tile||tile.terrain!=="PLAIN")return false;
    tile.terrain="MUD";
    events.push({type:"MUD_CREATED",x:tile.x,y:tile.y,source,soilMoisture:soilMoisture(tile)});
    return true;
  }

  function saturateSoil(tile,amount,events=[],source="RAIN"){
    if(!tile||!hasSoil(tile)||amount<=EPSILON)return Math.max(0,Number(amount||0));
    const before=soilMoisture(tile),capacity=Math.max(0,soilCapacity(tile)-before),absorbed=Math.min(capacity,Math.max(0,Number(amount||0)));
    if(absorbed>EPSILON){
      tile.soilMoisture=clean(before+absorbed);if(tile.terrain==="PLAIN")markMud(tile,events,source);
      events.push({type:"SOIL_MOISTURE_CHANGED",x:tile.x,y:tile.y,from:before,to:tile.soilMoisture,absorbed,source});
    }
    return Math.max(0,Number(amount||0)-absorbed);
  }

  function sync(tile,events=[]){
    if(!tile)return;
    const d=waterDepth(tile);tile.waterDepth=d<=EPSILON?0:clean(d);
    tile.waterSurfaceZ=tile.waterDepth>0?elevation(tile)+tile.waterDepth:null;
    if(tile.waterDepth<=0)tile.waterTurbidity=0;
    if(tile.waterDepth>0&&tile.terrain!=="WATER"){
      const base=tile.terrain;tile.dryTerrain=base;
      if(terrainHasSoil(base))tile.soilMoisture=base==="SAND"?SAND_SOIL_CAPACITY:SOIL_SATURATION_CAPACITY;
      tile.terrain="WATER";
      events.push({type:"BASIN_FILLED",x:tile.x,y:tile.y,elevation:elevation(tile),waterDepth:tile.waterDepth,waterSurfaceZ:tile.waterSurfaceZ,dryTerrain:tile.dryTerrain});
    }else if(tile.waterDepth<=0&&tile.terrain==="WATER"&&tile.dryTerrain){
      const base=tile.dryTerrain;
      if(base==="PLAIN"||base==="MUD"){tile.terrain="MUD";tile.soilMoisture=SOIL_SATURATION_CAPACITY;}
      else{tile.terrain=base;if(base==="SAND")tile.soilMoisture=clean(Math.min(SAND_SOIL_CAPACITY,Number(tile.soilMoisture||0)));}
      delete tile.dryTerrain;
      events.push({type:"BASIN_DRAINED",x:tile.x,y:tile.y,elevation:elevation(tile),waterDepth:0,terrain:tile.terrain});
    }
  }

  function setWaterDepth(tile,nextDepth,events=[],source="HYDROLOGY"){
    if(!tile)return 0;const before=waterDepth(tile),next=clean(nextDepth);tile.waterDepth=next;
    if(Math.abs(next-before)>EPSILON)events.push({type:next>before?"WATER_ACCUMULATED":"WATER_REDUCED",x:tile.x,y:tile.y,elevation:elevation(tile),fromDepth:before,waterDepth:next,waterSurfaceZ:next>0?elevation(tile)+next:null,source});
    sync(tile,events);return next-before;
  }

  function pairEquilibrium(a,b,minA=0,minB=0){
    if(!canHoldWater(a)||!canHoldWater(b))return 0;
    const va=waterDepth(a),vb=waterDepth(b),total=va+vb;if(total<=EPSILON)return 0;
    const sediment=turbidity(a)*va+turbidity(b)*vb;
    minA=Math.min(va,Math.max(0,Number(minA||0)));minB=Math.min(vb,Math.max(0,Number(minB||0)));
    const ga=elevation(a),gb=elevation(b);let nextA=0,nextB=0;
    if(ga<=gb){const rise=gb-ga;if(total<=rise){nextA=total;nextB=0;}else{const level=(total+ga+gb)/2;nextA=level-ga;nextB=level-gb;}}
    else{const rise=ga-gb;if(total<=rise){nextA=0;nextB=total;}else{const level=(total+ga+gb)/2;nextA=level-ga;nextB=level-gb;}}
    nextA=Math.max(0,nextA,minA);nextB=Math.max(0,nextB,minB);
    let over=nextA+nextB-total;
    if(over>EPSILON){
      const reducibleA=Math.max(0,nextA-minA),reducibleB=Math.max(0,nextB-minB);
      if(reducibleA>=reducibleB){const take=Math.min(over,reducibleA);nextA-=take;over-=take;if(over>EPSILON)nextB-=Math.min(over,reducibleB);}
      else{const take=Math.min(over,reducibleB);nextB-=take;over-=take;if(over>EPSILON)nextA-=Math.min(over,reducibleA);}
    }
    const delta=Math.max(Math.abs(nextA-va),Math.abs(nextB-vb));a.waterDepth=nextA;b.waterDepth=nextB;
    const concentration=total>EPSILON?clamp(sediment/total,0,1):0;
    if(nextA>EPSILON)a.waterTurbidity=clean(concentration);else a.waterTurbidity=0;
    if(nextB>EPSILON)b.waterTurbidity=clean(concentration);else b.waterTurbidity=0;
    return delta;
  }

  function absorbStandingWater(map,events=[],source="INFILTRATION",fed=sourceFedWaterKeys(map)){
    let absorbed=0;
    for(const tile of map?.tiles||[]){
      if(waterDepth(tile)<=EPSILON||!hasSoil(tile))continue;
      const floor=protectedDepth(tile,fed),before=waterDepth(tile),available=Math.max(0,before-floor);if(available<=EPSILON)continue;
      const excess=saturateSoil(tile,available,events,source),used=available-excess;
      if(used>EPSILON){tile.waterDepth=floor+excess;absorbed+=used;events.push({type:"WATER_INFILTRATED",x:tile.x,y:tile.y,amount:used,waterDepth:tile.waterDepth,source});}
    }
    return absorbed;
  }

  function applyOutlets(map,events=[],source="DRAINAGE",fed=sourceFedWaterKeys(map)){
    let drained=0;const openBoundary=map?.hydrology?.openBoundary===true||map?.generated===true;
    for(const tile of map?.tiles||[]){
      const outlet=tile.hydrologyDrain===true||tile.drain===true||(openBoundary&&(tile.x===0||tile.y===0||tile.x===Number(map.width||0)-1||tile.y===Number(map.height||0)-1));
      if(!outlet||waterDepth(tile)<=EPSILON)continue;
      const floor=protectedDepth(tile,fed),amount=Math.max(0,waterDepth(tile)-floor);if(amount<=EPSILON)continue;
      tile.waterDepth=clean(floor);drained+=amount;
      events.push({type:"WATER_DRAINED_OFF_MAP",x:tile.x,y:tile.y,amount,source,protectedDepth:floor});
    }
    return drained;
  }

  function redistribute(map,{source="FLOW",events=[]}={}){
    if(!map?.tiles?.length)return events;
    const beforeDepth=new Map(map.tiles.map(tile=>[key(tile.x,tile.y),waterDepth(tile)])),beforeVolume=totalWater(map),by=new Map(map.tiles.map(tile=>[key(tile.x,tile.y),tile]));
    const fed=sourceFedWaterKeys(map);
    let iterations=0,maxDelta=0,totalDrained=0,totalAbsorbed=0;

    // One hydraulic convergence loop. Every iteration performs the real order:
    // flow -> infiltration -> outlet drainage -> flow again. Therefore lowering a
    // boundary cell immediately creates a new gradient and upstream melt/rain water
    // keeps moving during this same environment tick instead of remaining as a pillar.
    for(;iterations<MAX_FLOW_ITERATIONS;iterations++){
      maxDelta=0;
      for(const tile of map.tiles){
        if(!canHoldWater(tile))continue;
        for(const[dx,dy]of FLOW_DIRS){
          const other=by.get(key(tile.x+dx,tile.y+dy));if(!other)continue;
          maxDelta=Math.max(maxDelta,pairEquilibrium(tile,other,fed.has(key(tile.x,tile.y))?baselineDepth(tile):0,fed.has(key(other.x,other.y))?baselineDepth(other):0));
        }
      }
      const absorbed=absorbStandingWater(map,events,source,fed),drained=applyOutlets(map,events,source,fed);
      totalAbsorbed+=absorbed;totalDrained+=drained;
      if(maxDelta<FLOW_EPSILON&&absorbed<EPSILON&&drained<EPSILON)break;
    }

    let changed=0;
    for(const tile of map.tiles){
      tile.waterDepth=waterDepth(tile)<=EPSILON?0:clean(tile.waterDepth);
      const old=Number(beforeDepth.get(key(tile.x,tile.y))||0),now=waterDepth(tile);
      if(Math.abs(now-old)>FLOW_EPSILON){changed++;events.push({type:"WATER_FLOW",x:tile.x,y:tile.y,fromDepth:old,waterDepth:now,waterSurfaceZ:now>0?elevation(tile)+now:null,source});}
      sync(tile,events);
    }
    const afterVolume=totalWater(map);
    if(changed||totalDrained>EPSILON){events.push({type:"HYDROLOGY_REBALANCED",source,changedTiles:changed,iterations:iterations+1,beforeVolume,afterVolume,surfaceWater:surfaceWaterVolume(map),soilWater:soilWaterVolume(map),drained:clean(totalDrained),absorbed:clean(totalAbsorbed),maxDelta});}
    return events;
  }

  function evaporateUnfedWater(map,{amount=EVAPORATION_PER_CLEAR_TURN,source="CLIMATE_EVAPORATION"}={}){
    const events=[];if(!map?.tiles?.length)return events;const fed=sourceFedWaterKeys(map),rate=Math.max(0,Number(amount||0));let evaporated=0,changedTiles=0;
    for(const tile of map.tiles){const before=waterDepth(tile);if(before<=EPSILON)continue;const floor=protectedDepth(tile,fed),removable=Math.max(0,before-floor);if(removable<=EPSILON)continue;const removed=Math.min(removable,rate);if(removed<=EPSILON)continue;tile.waterDepth=clean(before-removed);evaporated+=removed;changedTiles++;events.push({type:"WATER_REDUCED",x:tile.x,y:tile.y,elevation:elevation(tile),fromDepth:before,waterDepth:tile.waterDepth,waterSurfaceZ:tile.waterDepth>0?elevation(tile)+tile.waterDepth:null,source});sync(tile,events);}
    if(changedTiles){redistribute(map,{source,events});events.push({type:"SURFACE_WATER_EVAPORATED",source,changedTiles,amount:clean(evaporated)});}return events;
  }

  function addWater(tile,amount,events=[]){if(!tile)return 0;const incoming=Math.max(0,Number(amount||0)),excess=saturateSoil(tile,incoming,events,"ACCUMULATION"),before=waterDepth(tile),next=before+excess;return Math.max(0,setWaterDepth(tile,next,events,"ACCUMULATION"));}
  function removeWater(tile,amount,events=[]){if(!tile)return 0;const before=waterDepth(tile),next=Math.max(0,before-Math.max(0,Number(amount||0)));setWaterDepth(tile,next,events,"DRAINAGE");return before-next;}

  function floodArea(map,tiles,{surfaceRise=1,source="FLOOD"}={}){
    const events=[],area=(tiles||[]).filter(tile=>tile&&canHoldWater(tile));if(!area.length)return events;
    const existingSurfaces=area.map(waterSurfaceZ).filter(value=>value!=null&&Number.isFinite(value)),baseSurface=existingSurfaces.length?Math.max(...existingSurfaces):Math.min(...area.map(elevation)),targetSurface=baseSurface+Math.max(0,Number(surfaceRise||0));let injectedVolume=0;
    const ordered=[...area].sort((a,b)=>elevation(a)-elevation(b)||a.y-b.y||a.x-b.x);
    for(const tile of ordered){if(elevation(tile)>=targetSurface)continue;const before=waterDepth(tile),required=Math.max(before,targetSurface-elevation(tile));tile.waterDepth=required;injectedVolume+=Math.max(0,required-before);}
    redistribute(map,{source,events});events.push({type:"FLOOD_AREA_RESOLVED",source,targetSurface,injectedVolume,tiles:(map?.tiles||[]).map(tile=>({x:tile.x,y:tile.y,elevation:elevation(tile),waterDepth:waterDepth(tile),waterSurfaceZ:waterSurfaceZ(tile),soilMoisture:soilMoisture(tile)}))});return events;
  }

  function deformTerrain(map,x,y,{deltaElevation=0,setElevation=null,source="TERRAIN_DEFORMATION"}={}){
    const tile=tileAt(map,x,y);if(!tile)return[];const before=elevation(tile),after=setElevation==null?before+Number(deltaElevation||0):Number(setElevation);if(!Number.isFinite(after)||after===before)return[];
    const beforeDepth=waterDepth(tile);tile.elevation=after;tile.waterDepth=beforeDepth;const events=[{type:"ELEVATION_CHANGED",x,y,from:before,to:after,waterDepth:beforeDepth,source}];redistribute(map,{source,events});return events;
  }

  function applyRain(map,{heavy=false,amount=null,source=null}={}){
    const resolvedAmount=Math.max(0,Number(amount??(heavy?HEAVY_RAIN_FILL_PER_EVENT:RAIN_FILL_PER_EVENT))),events=[];amount=resolvedAmount;const rainSource=source||(heavy?"HEAVY_RAIN":"RAIN");
    for(const tile of map?.tiles||[]){
      if(!canHoldWater(tile))continue;
      if(isWater(tile)){const before=waterDepth(tile);tile.waterDepth=before+amount;events.push({type:"WATER_ACCUMULATED",x:tile.x,y:tile.y,elevation:elevation(tile),fromDepth:before,waterDepth:tile.waterDepth,waterSurfaceZ:elevation(tile)+tile.waterDepth,source:rainSource});continue;}
      const excess=hasSoil(tile)?saturateSoil(tile,amount,events,rainSource):amount;
      if(excess>EPSILON){const before=waterDepth(tile);tile.waterDepth=before+excess;events.push({type:"SURFACE_RUNOFF",x:tile.x,y:tile.y,amount:excess,source:rainSource});}
    }
    redistribute(map,{source:rainSource,events});return events;
  }

  function drySoil(map,{amount=DRYING_PER_CLEAR_TURN,source="DRYING"}={}){
    const events=[];
    for(const tile of map?.tiles||[]){if(waterDepth(tile)>EPSILON||!hasSoil(tile))continue;const before=soilMoisture(tile);if(before<=EPSILON)continue;const dryAmount=baseTerrain(tile)==="SAND"?Math.max(Number(amount||0),SAND_DRYING_PER_CLEAR_TURN):Math.max(0,Number(amount||0)),next=clean(Math.max(0,before-dryAmount));tile.soilMoisture=next;if(Math.abs(next-before)>EPSILON)events.push({type:"SOIL_MOISTURE_CHANGED",x:tile.x,y:tile.y,from:before,to:next,source});if(tile.terrain==="MUD"&&next<=EPSILON){tile.terrain="PLAIN";delete tile.soilMoisture;events.push({type:"MUD_DRY",x:tile.x,y:tile.y,source});}}
    return events;
  }

  return Object.freeze({
    WATERLINE,RAIN_FILL_PER_EVENT,HEAVY_RAIN_FILL_PER_EVENT,STORM_RAIN_FILL_PER_EVENT,NATURAL_WATER_DEPTH,
    SOIL_SATURATION_CAPACITY,SAND_SOIL_CAPACITY,DRYING_PER_CLEAR_TURN,SAND_DRYING_PER_CLEAR_TURN,EVAPORATION_PER_CLEAR_TURN,
    EPSILON,FLOW_EPSILON,MAX_FLOW_ITERATIONS,MAX_DRAIN_CYCLES,
    initializeMap,normalizeRiverNetwork,tileAt,elevation,waterDepth,waterSurfaceZ,isWater,connectedWaterBody,sourceFedWaterKeys,captureSourceBaselines,fillCapacity,
    soilCapacity,soilMoisture,surfaceWaterVolume,soilWaterVolume,totalWater,
    setWaterDepth,addWater,removeWater,redistribute,evaporateUnfedWater,floodArea,deformTerrain,applyRain,drySoil
  });
})();
globalThis.HydrologyEngine=HydrologyEngine;

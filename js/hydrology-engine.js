export const HydrologyEngine=(()=>{
  "use strict";

  const WATERLINE=0;
  const RAIN_FILL_PER_EVENT=.06,HEAVY_RAIN_FILL_PER_EVENT=.12,STORM_RAIN_FILL_PER_EVENT=.16,NATURAL_WATER_DEPTH=1;
  const SOIL_SATURATION_CAPACITY=.45,SAND_SOIL_CAPACITY=.22,DRYING_PER_CLEAR_TURN=.10,SAND_DRYING_PER_CLEAR_TURN=.16,EVAPORATION_PER_CLEAR_TURN=.06;
  const EPSILON=.0001,FLOW_EPSILON=.0005,MAX_FLOW_ITERATIONS=256,MAX_DRAIN_CYCLES=64,FLOW_RELAXATION=.5;
  // discharge is a river flow rate. This scale converts one discharge unit
  // into tile-volume per environment turn for budget/diagnostic accounting.
  const DISCHARGE_VOLUME_PER_TURN=.06,DEFAULT_SOURCE_DISCHARGE=1,MAX_BASE_FLOW_SPEED=3.2;
  const INITIAL_SOURCE_SETTLE_MAX_TURNS=64,INITIAL_SOURCE_SETTLE_STABLE_TURNS=3,INITIAL_SOURCE_SETTLE_STEP_TURNS=4;
  const MIN_CHANNEL_CAPACITY_FACTOR=1.15,MAX_CHANNEL_CAPACITY_FACTOR=3.5;
  const DIRS=[[1,0],[-1,0],[0,1],[0,-1]],FLOW_DIRS=[[1,0],[0,1]],key=(x,y)=>`${x},${y}`;
  const edgeDirectionId=(dx,dy)=>dx===1&&dy===0?"E":dx===-1&&dy===0?"W":dx===0&&dy===1?"S":dx===0&&dy===-1?"N":null;
  const compareTileOrder=(a,b)=>Number(a?.y||0)-Number(b?.y||0)||Number(a?.x||0)-Number(b?.x||0);

  const elevation=t=>Number(t?.elevation||0);
  const waterDepth=t=>Math.max(0,Number(t?.waterDepth||0));
  const waterSurfaceZ=t=>waterDepth(t)>EPSILON?elevation(t)+waterDepth(t):null;
  const isWater=t=>!!t&&waterDepth(t)>EPSILON;
  const canHoldWater=t=>!!t&&t.terrain!=="WALL";
  const clean=value=>Math.max(0,Math.round(Number(value||0)*10000)/10000);
  const roundSigned=value=>Math.round(Number(value||0)*10000)/10000;
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
    const sourceWasDisabled=component.some(tile=>tile?.hydrologySourceDisabled===true);
    if(!sources.length&&!sourceWasDisabled){
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
      const surface=roundSigned(outletSurface+d*step);

      // A ford is shallow because its river bed rises toward the water surface.
      // The water surface itself never gets lifted above the upstream/downstream profile.
      const depth=tile.ford===true?.35:Math.max(.75,Math.min(2,waterDepth(tile)||NATURAL_WATER_DEPTH));
      tile.waterDepth=clean(depth);
      tile.elevation=roundSigned(surface-depth);
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

    }

    // ----- Discharge conservation ------------------------------------------------
    // Each source contributes a real inflow rate. Rates are accumulated downstream;
    // therefore a confluence carries the sum of its tributaries.
    const sourceRates=new Map();
    for(const source of sources){
      const explicit=Number(
        source.hydrologySourceInflow ??
        source.sourceInflow ??
        source.baseDischarge ??
        source.discharge ??
        DEFAULT_SOURCE_DISCHARGE
      );
      const rate=Math.max(.05,Number.isFinite(explicit)?explicit:DEFAULT_SOURCE_DISCHARGE);
      sourceRates.set(key(source.x,source.y),rate);
      source.hydrologySourceInflow=clean(rate);
    }

    const accumulated=new Map(component.map(tile=>[key(tile.x,tile.y),0]));
    const ordered=[...component].sort((a,b)=>
      Number(distance.get(key(b.x,b.y))||0)-Number(distance.get(key(a.x,a.y))||0)||
      a.y-b.y||a.x-b.x
    );

    for(const tile of ordered){
      const k=key(tile.x,tile.y);
      let rate=Number(accumulated.get(k)||0)+Number(sourceRates.get(k)||0);
      rate=Math.max(0,rate);

      tile.baseDischarge=clean(rate);
      tile.discharge=tile.baseDischarge;
      tile.hydrologyInflowRate=tile.baseDischarge;

      if(tile.hydrologyDrain===true){
        tile.hydrologyOutflowRate=tile.baseDischarge;
      }else{
        const here=Number(distance.get(k)||0);
        const downstream=riverNeighbors(tile,by)
          .filter(n=>Number(distance.get(key(n.x,n.y)))<here)
          .sort((a,b)=>
            Number(distance.get(key(a.x,a.y)))-Number(distance.get(key(b.x,b.y)))||
            project(b)-project(a)
          )[0]||null;

        tile.hydrologyOutflowRate=tile.baseDischarge;
        if(downstream){
          const dk=key(downstream.x,downstream.y);
          accumulated.set(dk,Number(accumulated.get(dk)||0)+tile.baseDischarge);
          tile.flowX=Math.sign(downstream.x-tile.x);
          tile.flowY=Math.sign(downstream.y-tile.y);
        }
      }

      // Q = A * v (width is one tile here). A shallower ford keeps the same Q,
      // so its velocity increases instead of losing 20% of its water.
      const hydraulicDepth=Math.max(.20,waterDepth(tile));
      const baseSpeed=.62*(tile.baseDischarge||0)/hydraulicDepth;
      tile.baseFlowSpeed=clean(clamp(baseSpeed,.18,MAX_BASE_FLOW_SPEED));
      tile.flowSpeed=tile.baseFlowSpeed;
    }

    const sourceBaseInflow=clean([...sourceRates.values()].reduce((sum,value)=>sum+value,0));
    const outletBaseOutflow=clean(drains.reduce((sum,tile)=>sum+Number(tile.baseDischarge||0),0));

    return{
      tiles:component.length,
      sources:sources.map(tile=>({x:tile.x,y:tile.y,inflow:Number(tile.hydrologySourceInflow||0)})),
      drains:drains.map(tile=>({x:tile.x,y:tile.y,outflow:Number(tile.baseDischarge||0)})),
      maxDistance,
      outletSurface,
      sourceRise:totalRise,
      sourceBaseInflow,
      outletBaseOutflow,
      conservationDelta:clean(sourceBaseInflow-outletBaseOutflow)
    };
  }

  function normalizeRiverNetwork(map){
    if(!map?.tiles?.length||map?.hydrology?.preserveRiverProfile===true)return[];
    return riverComponents(map).map(normalizeRiverComponent).filter(Boolean);
  }

  function isBoundaryTile(map,tile){
    if(!map||!tile)return false;
    return tile.x===0||tile.y===0||tile.x===Number(map.width||0)-1||tile.y===Number(map.height||0)-1;
  }

  function outletProfile(map,tile,by=null){
    if(!map||!tile)return null;
    const tiles=map.tiles||[];
    const lookup=by||new Map(tiles.map(entry=>[key(entry.x,entry.y),entry]));
    const boundary=isBoundaryTile(map,tile);
    const explicit=tile.hydrologyDrain===true||tile.drain===true;
    if(!boundary&&!explicit)return null;

    const width=Math.max(1,Number(map.width||0)),height=Math.max(1,Number(map.height||0));
    const exits=[];
    if(tile.x===0)exits.push({dx:-1,dy:0,tx:0,ty:1});
    if(tile.x===width-1)exits.push({dx:1,dy:0,tx:0,ty:1});
    if(tile.y===0)exits.push({dx:0,dy:-1,tx:1,ty:0});
    if(tile.y===height-1)exits.push({dx:0,dy:1,tx:1,ty:0});

    const naturalBase=Number(tile.hydrologyChannelBaseElevation??tile.elevation??0);
    const riverNeighborsList=DIRS
      .map(([dx,dy])=>lookup.get(key(tile.x+dx,tile.y+dy)))
      .filter(neighbor=>neighbor?.river===true&&neighbor!==tile);
    const inward=[];
    for(const exit of exits){
      const neighbor=lookup.get(key(tile.x-exit.dx,tile.y-exit.dy));
      if(neighbor)inward.push(neighbor);
    }
    const approachTiles=riverNeighborsList.length?riverNeighborsList:inward;
    const approachBase=approachTiles.length
      ?approachTiles.reduce((sum,neighbor)=>sum+Number(neighbor.hydrologyChannelBaseElevation??neighbor.elevation??0),0)/approachTiles.length
      :naturalBase;
    const approachSlope=roundSigned(approachBase-naturalBase);

    const tangentKeys=new Set([key(tile.x,tile.y)]);
    for(const exit of exits){
      for(const sign of [-1,1]){
        const tx=tile.x+exit.tx*sign,ty=tile.y+exit.ty*sign;
        const neighbor=lookup.get(key(tx,ty));
        if(!neighbor||!isBoundaryTile(map,neighbor)||neighbor.terrain==="WALL")continue;
        const neighborBase=Number(neighbor.hydrologyChannelBaseElevation??neighbor.elevation??0);
        if(neighborBase<=naturalBase+.5)tangentKeys.add(key(tx,ty));
      }
    }
    const openWidth=Math.max(1,tangentKeys.size);
    const widthFactor=clamp(openWidth/3,.25,1);
    const downhillFactor=clamp(.45+Math.max(0,approachSlope)*.55,.25,1);
    const adverseFactor=1/(1+Math.max(0,-approachSlope)*1.5);
    const blockers=DIRS.reduce((count,[dx,dy])=>{
      const neighbor=lookup.get(key(tile.x+dx,tile.y+dy));
      if(!neighbor)return count;
      const neighborBase=Number(neighbor.hydrologyChannelBaseElevation??neighbor.elevation??0);
      return count+(neighbor.terrain==="WALL"||neighborBase>naturalBase+1?1:0);
    },0);
    const obstructionFactor=clamp(1-blockers*.18,.35,1);
    const efficiency=clamp(widthFactor*downhillFactor*adverseFactor*obstructionFactor,.06,1);
    const surface=waterSurfaceZ(tile)??naturalBase;
    const head=Math.max(0,Number(surface)-Number(tile.elevation||0));

    return{
      boundary,
      explicit,
      exitFaces:Math.max(1,exits.length),
      openWidth,
      naturalBase:roundSigned(naturalBase),
      approachBase:roundSigned(approachBase),
      approachSlope,
      efficiency:roundSigned(efficiency),
      head:clean(head)
    };
  }

  function refreshOutletHydraulics(map){
    const tiles=map?.tiles||[],by=new Map(tiles.map(tile=>[key(tile.x,tile.y),tile]));
    for(const tile of tiles){
      if(!(tile?.hydrologyDrain===true||tile?.drain===true||isBoundaryTile(map,tile)))continue;
      const profile=outletProfile(map,tile,by);if(!profile)continue;
      tile.outletEfficiency=profile.efficiency;
      tile.outletApproachSlope=profile.approachSlope;
      tile.outletOpenWidth=profile.openWidth;
      tile.outletExitFaces=profile.exitFaces;
      if(tile.river===true&&tile.hydrologyDrain===true){
        const baseQ=Math.max(.05,Number(tile.baseDischarge||DEFAULT_SOURCE_DISCHARGE));
        const rawCapacity=Math.max(baseQ,Number(tile.channelCapacity||baseQ));
        const extraCapacity=Math.max(0,rawCapacity-baseQ);
        const bankElevation=Number(tile.channelBankElevation);
        const stageHead=Number.isFinite(bankElevation)&&waterSurfaceZ(tile)!=null
          ?Math.max(0,Number(waterSurfaceZ(tile))-bankElevation)
          :0;
        const headBoost=clamp(1+stageHead,1,1.5);
        const usableExtra=extraCapacity*clamp(profile.efficiency*headBoost,0,1);
        tile.outletEffectiveCapacity=clean(baseQ+usableExtra);
      }
    }
    return tiles.filter(tile=>tile?.hydrologyDrain===true||tile?.drain===true||isBoundaryTile(map,tile));
  }

  function boundaryDrainBudget(map,tile,fed,by,volumeScale=DISCHARGE_VOLUME_PER_TURN){
    const profile=outletProfile(map,tile,by);if(!profile)return 0;
    const floor=protectedDepth(tile,fed);
    const head=Math.max(0,waterDepth(tile)-floor);
    if(head<=EPSILON)return 0;
    if(tile.drain===true&&Number.isFinite(Number(tile.drainCapacity))){
      return clean(Math.max(0,Number(tile.drainCapacity))*Math.max(0,Number(volumeScale||0)));
    }
    // Broad-crested outlet approximation. Terrain controls width and efficiency;
    // the available hydraulic head controls how much can leave this turn.
    const rate=profile.openWidth*Math.pow(head,1.5)*profile.efficiency;
    return clean(rate*Math.max(0,Number(volumeScale||0)));
  }

  function outletDrainBudgets(map,fed=sourceFedWaterKeys(map),volumeScale=DISCHARGE_VOLUME_PER_TURN){
    const budgets=new Map(),by=new Map((map?.tiles||[]).map(tile=>[key(tile.x,tile.y),tile]));
    const openBoundary=map?.hydrology?.openBoundary===true||map?.generated===true;
    for(const tile of map?.tiles||[]){
      if(tile?.river===true&&tile?.hydrologyDrain===true){
        // Convert the abstract routed river discharge back into real water volume
        // leaving the map. The protected channel baseline stays in place; only
        // source/flood water above that baseline can leave.
        const throughRate=Math.max(0,Number(tile.hydrologyOutflowRate??tile.discharge??tile.baseDischarge??0));
        budgets.set(key(tile.x,tile.y),clean(throughRate*Math.max(0,Number(volumeScale||0))));
        continue;
      }
      const eligible=tile?.drain===true||(openBoundary&&tile?.river!==true&&isBoundaryTile(map,tile));
      if(!eligible||waterDepth(tile)<=EPSILON)continue;
      budgets.set(key(tile.x,tile.y),boundaryDrainBudget(map,tile,fed,by,volumeScale));
    }
    return budgets;
  }

  function refreshRiverChannelCapacity(map){
    const tiles=map?.tiles||[],by=new Map(tiles.map(tile=>[key(tile.x,tile.y),tile]));
    for(const tile of tiles){
      if(tile?.river!==true)continue;

      const baseDepth=Math.max(.20,Number(tile.hydrologyBaseWaterDepth||0)||waterDepth(tile)||NATURAL_WATER_DEPTH);
      const baselineSurface=elevation(tile)+baseDepth;
      const banks=[];

      for(const[dx,dy]of DIRS){
        const neighbor=by.get(key(tile.x+dx,tile.y+dy));
        if(!neighbor||neighbor.river===true)continue;
        // Bank elevation is terrain geometry, not current flood-water surface.
        banks.push(elevation(neighbor));
      }

      const bankElevation=banks.length?Math.min(...banks):baselineSurface+.5;
      const bankHeadroom=Math.max(0,bankElevation-baselineSurface);
      const bankfullDepth=Math.max(baseDepth,baseDepth+bankHeadroom);

      // Fixed-width channel approximation of Manning-like behavior:
      // Q grows faster than linearly with usable water depth.
      const depthRatio=Math.max(1,bankfullDepth/baseDepth);
      const capacityFactor=clamp(
        Math.pow(depthRatio,5/3),
        MIN_CHANNEL_CAPACITY_FACTOR,
        MAX_CHANNEL_CAPACITY_FACTOR
      );
      const baseQ=Math.max(.05,Number(tile.baseDischarge||DEFAULT_SOURCE_DISCHARGE));

      tile.channelBankElevation=roundSigned(bankElevation);
      tile.channelBankfullDepth=clean(bankfullDepth);
      tile.channelCapacity=clean(baseQ*capacityFactor);
    }
    return tiles.filter(tile=>tile?.river===true);
  }

  function sourceDemandRate(tile){
    const observed=Math.max(0,Number(tile?.discharge??tile?.baseDischarge??tile?.hydrologySourceInflow??DEFAULT_SOURCE_DISCHARGE));
    const lastOut=Number(tile?.hydrologyOutflowRate);
    let requested=Number(tile?.hydrologyRequestedSourceInflow);

    // ClimateEngine writes a new discharge onto river tiles when weather changes.
    // If the source's observed discharge differs from the last routed outflow, treat
    // that as a new external source-inflow demand. Otherwise preserve the previous
    // request so capacity limiting does not erase the storm inflow on the next pass.
    if(!Number.isFinite(requested) || !Number.isFinite(lastOut) || Math.abs(observed-lastOut)>FLOW_EPSILON){
      requested=observed;
    }

    tile.hydrologyRequestedSourceInflow=clean(requested);
    return tile.hydrologyRequestedSourceInflow;
  }

  function riverFlowBudget(map,{volumeScale=DISCHARGE_VOLUME_PER_TURN}={}){
    const rivers=(map?.tiles||[]).filter(tile=>tile?.river===true);
    const sources=rivers.filter(tile=>tile?.hydrologySource===true);
    const drains=rivers.filter(tile=>tile?.hydrologyDrain===true);
    const scale=Math.max(0,Number(volumeScale||0));

    const sourceInflowRate=clean(sources.reduce((sum,tile)=>
      sum+Math.max(0,Number(tile.hydrologyRequestedSourceInflow??tile.hydrologySourceInflow??tile.baseDischarge??0)),0));
    const outletOutflowRate=clean(drains.reduce((sum,tile)=>
      sum+Math.max(0,Number(tile.hydrologyOutflowRate??tile.discharge??0)),0));
    const outletCapacityRate=clean(drains.reduce((sum,tile)=>
      sum+Math.max(0,Number(tile.outletEffectiveCapacity??tile.channelCapacity??0)),0));
    const overloadRate=clean(rivers.reduce((sum,tile)=>
      sum+Math.max(0,Number(tile.hydrologyOverflowRate||0)),0));
    const retainedRate=Math.max(0,Math.round((sourceInflowRate-outletOutflowRate)*10000)/10000);

    return{
      sourceInflowRate,
      outletOutflowRate,
      outletCapacityRate,
      overloadRate,
      retainedRate,
      netRate:Math.round((sourceInflowRate-outletOutflowRate)*10000)/10000,
      sourceInflowVolume:clean(sourceInflowRate*scale),
      outletOutflowVolume:clean(outletOutflowRate*scale),
      retainedVolume:clean(retainedRate*scale),
      netVolume:Math.round((sourceInflowRate-outletOutflowRate)*scale*10000)/10000,
      sourceCount:sources.length,
      outletCount:drains.length
    };
  }

  function reconcileRiverDischarge(map,{events=[],applyOverflow=false,volumeScale=DISCHARGE_VOLUME_PER_TURN,source="RIVER_FLOW"}={}){
    refreshRiverChannelCapacity(map);
    refreshOutletHydraulics(map);
    const components=riverComponents(map),reports=[];
    const scale=Math.max(0,Number(volumeScale||0));

    for(const component of components){
      const by=new Map(component.map(tile=>[key(tile.x,tile.y),tile]));
      const drains=component.filter(tile=>tile?.hydrologyDrain===true);
      if(!drains.length)continue;

      const distance=new Map(),q=[];
      for(const drain of drains){
        const k=key(drain.x,drain.y);
        if(distance.has(k))continue;
        distance.set(k,0);q.push(drain);
      }
      while(q.length){
        const tile=q.shift(),d=Number(distance.get(key(tile.x,tile.y))||0);
        for(const neighbor of riverNeighbors(tile,by)){
          const k=key(neighbor.x,neighbor.y);
          if(distance.has(k))continue;
          distance.set(k,d+1);q.push(neighbor);
        }
      }

      const sourceRates=new Map();
      for(const tile of component){
        if(tile?.hydrologySource!==true)continue;
        sourceRates.set(key(tile.x,tile.y),sourceDemandRate(tile));
      }

      const incoming=new Map(component.map(tile=>[key(tile.x,tile.y),0]));
      const ordered=[...component].sort((a,b)=>
        Number(distance.get(key(b.x,b.y))||0)-Number(distance.get(key(a.x,a.y))||0)||
        a.y-b.y||a.x-b.x
      );

      let retainedRate=0,retainedVolume=0;
      for(const tile of ordered){
        const k=key(tile.x,tile.y);
        const inflowRate=clean(Number(incoming.get(k)||0)+Number(sourceRates.get(k)||0));
        const rawCapacity=Math.max(.01,Number(tile.channelCapacity||inflowRate||.01));
        const capacity=tile.hydrologyDrain===true
          ?Math.max(.01,Number(tile.outletEffectiveCapacity||rawCapacity))
          :rawCapacity;
        const outflowRate=clean(Math.min(inflowRate,capacity));
        const overflowRate=clean(Math.max(0,inflowRate-outflowRate));

        tile.hydrologyInflowRate=inflowRate;
        tile.hydrologyOutflowRate=outflowRate;
        tile.hydrologyOverflowRate=overflowRate;
        tile.discharge=outflowRate;

        if(overflowRate>EPSILON){
          retainedRate+=overflowRate;
          const retained=clean(overflowRate*scale);
          retainedVolume+=retained;

          if(applyOverflow&&retained>EPSILON){
            const before=waterDepth(tile);
            setWaterDepth(tile,before+retained,events,"RIVER_CHANNEL_OVERLOAD");
            events.push({
              type:"RIVER_CHANNEL_OVERLOAD",
              x:tile.x,y:tile.y,
              source,
              inflowRate,
              channelCapacity:capacity,
              rawChannelCapacity:rawCapacity,
              outletEfficiency:Number(tile.outletEfficiency||0),
              outletApproachSlope:Number(tile.outletApproachSlope||0),
              outletOpenWidth:Number(tile.outletOpenWidth||0),
              outflowRate,
              overflowRate,
              retainedVolume:retained,
              bankElevation:Number(tile.channelBankElevation),
              bankfullDepth:Number(tile.channelBankfullDepth),
              waterDepth:waterDepth(tile),
              waterSurfaceZ:waterSurfaceZ(tile)
            });
          }
        }

        if(tile.hydrologyDrain===true)continue;

        const here=Number(distance.get(k)||0);
        const downstream=riverNeighbors(tile,by)
          .filter(n=>Number(distance.get(key(n.x,n.y)))<here)
          .sort((a,b)=>
            Number(distance.get(key(a.x,a.y)))-Number(distance.get(key(b.x,b.y)))||
            a.y-b.y||a.x-b.x
          )[0]||null;
        if(!downstream)continue;

        tile.flowX=Math.sign(downstream.x-tile.x);
        tile.flowY=Math.sign(downstream.y-tile.y);
        const dk=key(downstream.x,downstream.y);
        incoming.set(dk,Number(incoming.get(dk)||0)+outflowRate);

        // Q = A * v. Channel constrictions keep the actual carried discharge but
        // increase velocity as hydraulic depth gets smaller.
        const baseQ=Math.max(.05,Number(tile.baseDischarge||DEFAULT_SOURCE_DISCHARGE));
        const flowFactor=Math.max(.1,outflowRate/baseQ);
        const hydraulicDepth=Math.max(.20,waterDepth(tile));
        const referenceDepth=Math.max(.20,Number(tile.hydrologyBaseWaterDepth||0)||hydraulicDepth);
        const depthFactor=referenceDepth/hydraulicDepth;
        tile.flowSpeed=clean(clamp(
          Number(tile.baseFlowSpeed||.62)*flowFactor*depthFactor,
          .05,
          MAX_BASE_FLOW_SPEED
        ));
      }

      const sourceRate=clean([...sourceRates.values()].reduce((sum,value)=>sum+value,0));
      const outletRate=clean(drains.reduce((sum,tile)=>sum+Number(tile.hydrologyOutflowRate||0),0));
      const outletCapacity=clean(drains.reduce((sum,tile)=>sum+Number(tile.channelCapacity||0),0));

      reports.push({
        tiles:component.length,
        sourceRate,
        outletRate,
        outletCapacity,
        retainedRate:clean(retainedRate),
        retainedVolume:clean(retainedVolume),
        overloaded:retainedRate>EPSILON
      });
    }

    map.hydrologyFlowBudget=riverFlowBudget(map,{volumeScale:scale});
    return reports;
  }


  function sourceRecessionActive(map){
    return riverComponents(map).some(component=>
      component.some(tile=>waterDepth(tile)>EPSILON)&&
      !component.some(tile=>tile?.hydrologySource===true)
    );
  }

  function deactivateSource(map,x,y,{events=[],reason="SOURCE_DISABLED",objectId=null}={}){
    const tile=tileAt(map,x,y);
    if(!tile||tile.hydrologySource!==true)return false;
    tile.hydrologySource=false;
    tile.hydrologySourceDisabled=true;
    tile.hydrologySourceInflow=0;
    tile.hydrologyRequestedSourceInflow=0;

    const component=riverComponents(map).find(group=>group.includes(tile))||[];
    if(component.length&&!component.some(entry=>entry?.hydrologySource===true)){
      for(const entry of component)entry.hydrologyBaseWaterDepth=0;
    }

    const ref=(map?.generatedRiverProfile?.sources||[]).find(source=>Number(source.x)===Number(x)&&Number(source.y)===Number(y));
    if(ref)ref.active=false;
    reconcileRiverDischarge(map,{events,applyOverflow:false,source:reason});
    clearEdgeFlows(map);
    events.push({type:"HYDROLOGY_SOURCE_DISABLED",x:Number(x),y:Number(y),reason,objectId});
    return true;
  }

  function advanceSourceRecession(map,{events=[],source="SOURCE_RECESSION"}={}){
    if(!sourceRecessionActive(map))return events;
    redistribute(map,{source,events,riverPulse:false});
    if(!sourceRecessionActive(map))events.push({type:"RIVER_SOURCE_RECESSION_ENDED",source});
    return events;
  }

  const baselineDepth=t=>Math.max(0,Number(t?.hydrologyBaseWaterDepth||0));
  function captureSourceBaselines(map){
    const fed=sourceFedWaterKeys(map);
    // Baselines protect the authored river channel, not every wet tile connected to
    // a source. A spring-fed pond/basin must remain free to equalize with adjacent
    // lower terrain; otherwise its initial water becomes an immovable stencil.
    for(const tile of map?.tiles||[])tile.hydrologyBaseWaterDepth=(tile?.river===true&&fed.has(key(tile.x,tile.y)))?clean(waterDepth(tile)):0;
    return fed;
  }
  function protectedDepth(tile,fed){return fed?.has(key(tile.x,tile.y))?Math.min(waterDepth(tile),baselineDepth(tile)):0}

  function activeSourceTiles(map){
    return(map?.tiles||[]).filter(tile=>tile?.hydrologySource===true&&tile?.hydrologySourceDisabled!==true&&canHoldWater(tile));
  }

  function advanceSources(map,{events=[],source="SOURCE_INFLOW",volumeScale=DISCHARGE_VOLUME_PER_TURN,redistributeAfter=true}={}){
    if(!map?.tiles?.length)return events;
    const scale=Math.max(0,Number(volumeScale||0));
    let injectedVolume=0,sourceCount=0;
    for(const tile of activeSourceTiles(map)){
      const rate=Math.max(0,sourceDemandRate(tile));
      const volume=clean(rate*scale);
      if(volume<=EPSILON)continue;
      const before=waterDepth(tile);
      setWaterDepth(tile,before+volume,events,source);
      injectedVolume=clean(injectedVolume+volume);sourceCount++;
      events.push({type:"HYDROLOGY_SOURCE_INFLOW",x:tile.x,y:tile.y,source,rate,volume,waterDepth:waterDepth(tile),waterSurfaceZ:waterSurfaceZ(tile)});
    }
    if(injectedVolume>EPSILON&&redistributeAfter)redistribute(map,{source,events,riverPulse:false,volumeScale:scale});
    if(injectedVolume>EPSILON)events.push({type:"HYDROLOGY_SOURCES_ADVANCED",source,sourceCount,injectedVolume});
    return events;
  }

  function settleInitialSources(map,{maxTurns=INITIAL_SOURCE_SETTLE_MAX_TURNS,stableTurns=INITIAL_SOURCE_SETTLE_STABLE_TURNS,stepTurns=INITIAL_SOURCE_SETTLE_STEP_TURNS}={}){
    const beforeVolume=totalWater(map),capTurns=Math.max(1,Math.floor(Number(maxTurns||0))),needStable=Math.max(1,Math.floor(Number(stableTurns||0))),step=Math.max(1,Math.floor(Number(stepTurns||0)));
    if(!activeSourceTiles(map).length)return{turns:0,steps:0,stable:true,beforeVolume,afterVolume:beforeVolume};
    let previous=beforeVolume,stable=0,turns=0,steps=0;
    while(turns<capTurns){
      const span=Math.min(step,capTurns-turns),scale=DISCHARGE_VOLUME_PER_TURN*span;
      advanceSources(map,{events:[],source:"SOURCE_INITIAL_SETTLE",volumeScale:scale,redistributeAfter:true});
      turns+=span;steps++;
      const now=totalWater(map),delta=Math.abs(now-previous);
      stable=delta<=FLOW_EPSILON?stable+1:0;previous=now;
      if(stable>=needStable)break;
    }
    return{turns,steps,stable:stable>=needStable,beforeVolume,afterVolume:totalWater(map)};
  }

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
    refreshRiverChannelCapacity(map);
    refreshOutletHydraulics(map);
    reconcileRiverDischarge(map);
    captureSourceBaselines(map);
    // Generated spring/source maps represent an already-running watershed at battle
    // start. Let the real Hydrology flow settle it instead of stamping extra WATER
    // tiles in the generator. This fills connected low basins and keeps the same
    // source -> volume -> flow path used during later environment turns.
    map.hydrologyInitialSourceSettle=settleInitialSources(map);
    captureSourceBaselines(map);
    refreshRiverChannelCapacity(map);
    refreshOutletHydraulics(map);
    reconcileRiverDischarge(map);
    map.hydrologyFlowBudget=riverFlowBudget(map);
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

  function pairTargetDepths(a,b,va=waterDepth(a),vb=waterDepth(b),minA=0,minB=0){
    if(!canHoldWater(a)||!canHoldWater(b))return{nextA:va,nextB:vb};
    const total=va+vb;if(total<=EPSILON)return{nextA:va,nextB:vb};
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
    return{nextA:Math.max(0,nextA),nextB:Math.max(0,nextB)};
  }

  function pairEquilibrium(a,b,minA=0,minB=0){
    if(!canHoldWater(a)||!canHoldWater(b))return 0;
    const va=waterDepth(a),vb=waterDepth(b),total=va+vb;if(total<=EPSILON)return 0;
    const sediment=turbidity(a)*va+turbidity(b)*vb;
    const{nextA,nextB}=pairTargetDepths(a,b,va,vb,minA,minB);
    const delta=Math.max(Math.abs(nextA-va),Math.abs(nextB-vb));a.waterDepth=nextA;b.waterDepth=nextB;
    const concentration=total>EPSILON?clamp(sediment/total,0,1):0;
    if(nextA>EPSILON)a.waterTurbidity=clean(concentration);else a.waterTurbidity=0;
    if(nextB>EPSILON)b.waterTurbidity=clean(concentration);else b.waterTurbidity=0;
    return delta;
  }

  function canonicalEdge(from,to){
    const forward=compareTileOrder(from,to)<=0,first=forward?from:to,second=forward?to:from;
    return{key:`${key(first.x,first.y)}|${key(second.x,second.y)}`,first,second,sign:forward?1:-1};
  }

  function accumulateEdgeTransfer(edgeNet,from,to,amount,fromSurface,toSurface){
    const volume=Math.max(0,Number(amount||0));if(volume<=EPSILON||!from||!to)return;
    const edge=canonicalEdge(from,to);
    let entry=edgeNet.get(edge.key);
    if(!entry){entry={first:edge.first,second:edge.second,net:0,gross:0,maxHead:0,maxFromSurface:-Infinity,minToSurface:Infinity};edgeNet.set(edge.key,entry);}
    entry.net+=edge.sign*volume;entry.gross+=volume;
    const head=Math.max(0,Number(fromSurface)-Number(toSurface));
    entry.maxHead=Math.max(entry.maxHead,head);entry.maxFromSurface=Math.max(entry.maxFromSurface,Number(fromSurface));entry.minToSurface=Math.min(entry.minToSurface,Number(toSurface));
  }

  // One synchronous/Jacobi-style flow pass. Every edge proposes against the same
  // snapshot, then all proposals are applied together. This removes the old scan
  // order bias where a protected spring could dump its entire new volume through
  // the first neighbour visited and leave equally-low sides dry.
  function flowIteration(map,by,fed,edgeNet){
    const snapshots=new Map();
    for(const tile of map.tiles)snapshots.set(key(tile.x,tile.y),{depth:waterDepth(tile),turbidity:turbidity(tile)});
    const proposals=[],outgoing=new Map();
    for(const tile of map.tiles){
      if(!canHoldWater(tile))continue;
      const aSnap=snapshots.get(key(tile.x,tile.y));
      for(const[dx,dy]of FLOW_DIRS){
        const other=by.get(key(tile.x+dx,tile.y+dy));if(!other||!canHoldWater(other))continue;
        const bSnap=snapshots.get(key(other.x,other.y));
        const minA=fed.has(key(tile.x,tile.y))?baselineDepth(tile):0,minB=fed.has(key(other.x,other.y))?baselineDepth(other):0;
        const target=pairTargetDepths(tile,other,aSnap.depth,bSnap.depth,minA,minB);
        const signed=(target.nextB-bSnap.depth)*FLOW_RELAXATION;
        if(Math.abs(signed)<=EPSILON)continue;
        const from=signed>0?tile:other,to=signed>0?other:tile,amount=Math.abs(signed);
        const fromSnap=signed>0?aSnap:bSnap,toSnap=signed>0?bSnap:aSnap;
        const fromSurface=elevation(from)+fromSnap.depth,toSurface=elevation(to)+(toSnap.depth>EPSILON?toSnap.depth:0);
        proposals.push({from,to,amount,fromSurface,toSurface});
        const fk=key(from.x,from.y);outgoing.set(fk,Number(outgoing.get(fk)||0)+amount);
      }
    }
    if(!proposals.length)return 0;

    const depthDelta=new Map(),sedimentDelta=new Map();
    let maxDelta=0;
    for(const proposal of proposals){
      const fk=key(proposal.from.x,proposal.from.y),tk=key(proposal.to.x,proposal.to.y);
      const snap=snapshots.get(fk),floor=fed.has(fk)?baselineDepth(proposal.from):0,available=Math.max(0,snap.depth-floor),requested=Math.max(EPSILON,Number(outgoing.get(fk)||0));
      const scale=Math.min(1,available/requested),amount=proposal.amount*scale;if(amount<=EPSILON)continue;
      depthDelta.set(fk,Number(depthDelta.get(fk)||0)-amount);depthDelta.set(tk,Number(depthDelta.get(tk)||0)+amount);
      const sediment=amount*Number(snap.turbidity||0);sedimentDelta.set(fk,Number(sedimentDelta.get(fk)||0)-sediment);sedimentDelta.set(tk,Number(sedimentDelta.get(tk)||0)+sediment);
      accumulateEdgeTransfer(edgeNet,proposal.from,proposal.to,amount,proposal.fromSurface,proposal.toSurface);
    }

    for(const tile of map.tiles){
      const k=key(tile.x,tile.y),snap=snapshots.get(k),delta=Number(depthDelta.get(k)||0);if(Math.abs(delta)<=EPSILON)continue;
      const floor=fed.has(k)?baselineDepth(tile):0,next=Math.max(floor,snap.depth+delta);
      const sedimentMass=Math.max(0,snap.depth*snap.turbidity+Number(sedimentDelta.get(k)||0));
      tile.waterDepth=next;tile.waterTurbidity=next>EPSILON?clean(clamp(sedimentMass/next,0,1)):0;
      maxDelta=Math.max(maxDelta,Math.abs(next-snap.depth));
    }
    return maxDelta;
  }

  function clearEdgeFlows(map){
    for(const tile of map?.tiles||[])delete tile.hydrologyEdgeOutflows;
    if(map)map.hydrologyEdgeFlowSummary={source:null,edges:0,totalVolume:0,totalRate:0};
  }

  function commitEdgeFlows(map,edgeNet,{source="FLOW",volumeScale=DISCHARGE_VOLUME_PER_TURN}={}){
    if(!map?.tiles?.length)return[];
    const previousSourceFlows=[];
    for(const tile of map.tiles)for(const[dir,record]of Object.entries(tile?.hydrologyEdgeOutflows||{})){
      if(/SOURCE|SPRING/.test(String(record?.source||"")))previousSourceFlows.push({tile,dir,record:{...record}});
    }
    clearEdgeFlows(map);
    const scale=Math.max(EPSILON,Number(volumeScale||DISCHARGE_VOLUME_PER_TURN)),out=[];
    for(const entry of edgeNet.values()){
      const signed=Number(entry.net||0);if(Math.abs(signed)<=EPSILON)continue;
      const from=signed>0?entry.first:entry.second,to=signed>0?entry.second:entry.first,volume=clean(Math.abs(signed));
      if(volume<=EPSILON)continue;
      const dx=Math.sign(Number(to.x)-Number(from.x)),dy=Math.sign(Number(to.y)-Number(from.y)),dir=edgeDirectionId(dx,dy);if(!dir)continue;
      const fromSurface=waterDepth(from)>EPSILON?elevation(from)+waterDepth(from):Number.isFinite(entry.maxFromSurface)?entry.maxFromSurface:elevation(from);
      const toSurface=waterDepth(to)>EPSILON?elevation(to)+waterDepth(to):elevation(to);
      const bedDrop=elevation(from)-elevation(to),naturalFrom=Number(from.hydrologyChannelBaseElevation??elevation(from)),naturalTo=Number(to.hydrologyChannelBaseElevation??elevation(to)),naturalDrop=naturalFrom-naturalTo;
      const record={
        toX:Number(to.x),toY:Number(to.y),dirX:dx,dirY:dy,source,volume,rate:clean(volume/scale),
        surfaceDrop:clean(Math.max(0,entry.maxHead,fromSurface-toSurface)),fromSurface:roundSigned(fromSurface),toSurface:roundSigned(toSurface),
        bedDrop:roundSigned(bedDrop),naturalDrop:roundSigned(naturalDrop),cliffDrop:roundSigned(Math.max(bedDrop,naturalDrop)),grossVolume:clean(entry.gross)
      };
      (from.hydrologyEdgeOutflows??={})[dir]=record;out.push({fromX:from.x,fromY:from.y,...record});
    }

    // Authored river cascades remain a topology contract even when their protected
    // baseline makes the local equalizer report no net volume in this pass. They are
    // inserted only when no measured edge flow already owns that side.
    const by=new Map(map.tiles.map(tile=>[key(tile.x,tile.y),tile]));
    for(const from of map.tiles){
      const tx=Number(from.hydrologyCascadeToX),ty=Number(from.hydrologyCascadeToY);if(!Number.isFinite(tx)||!Number.isFinite(ty)||waterDepth(from)<=EPSILON)continue;
      const to=by.get(key(tx,ty));if(!to)continue;const dx=Math.sign(tx-from.x),dy=Math.sign(ty-from.y),dir=edgeDirectionId(dx,dy);if(!dir||(from.hydrologyEdgeOutflows||{})[dir])continue;
      const fromSurface=elevation(from)+waterDepth(from),toSurface=waterDepth(to)>EPSILON?elevation(to)+waterDepth(to):elevation(to),rate=Math.max(0,Number(from.hydrologyOutflowRate??from.discharge??0));
      const record={toX:tx,toY:ty,dirX:dx,dirY:dy,source:"AUTHORED_CASCADE",volume:clean(rate*scale),rate:clean(rate),surfaceDrop:clean(Math.max(0,fromSurface-toSurface,Number(from.hydrologyCascadeDrop||0))),fromSurface:roundSigned(fromSurface),toSurface:roundSigned(toSurface),bedDrop:roundSigned(elevation(from)-elevation(to)),naturalDrop:roundSigned(Number(from.hydrologyChannelBaseElevation??elevation(from))-Number(to.hydrologyChannelBaseElevation??elevation(to))),cliffDrop:roundSigned(Math.max(elevation(from)-elevation(to),Number(from.hydrologyCascadeDrop||0))),grossVolume:clean(rate*scale),authored:true};
      (from.hydrologyEdgeOutflows??={})[dir]=record;out.push({fromX:from.x,fromY:from.y,...record});
    }
    // Climate/drying/contact passes may rebalance an already-settled source network
    // immediately after the real source injection pass. Do not erase its measured
    // multi-edge flux just because that secondary pass had no new source volume.
    // The next source pass refreshes it; destroying the source clears it explicitly.
    if(activeSourceTiles(map).length&&previousSourceFlows.length&&!/SOURCE_DISABLED|SOURCE_RECESSION/.test(String(source||""))){
      const by=new Map(map.tiles.map(tile=>[key(tile.x,tile.y),tile]));
      for(const prior of previousSourceFlows){
        const from=prior.tile,record=prior.record;if(waterDepth(from)<=EPSILON||(from.hydrologyEdgeOutflows||{})[prior.dir])continue;
        const to=by.get(key(record.toX,record.toY));if(!to)continue;
        const refreshed={...record,fromSurface:roundSigned(elevation(from)+waterDepth(from)),toSurface:roundSigned(waterDepth(to)>EPSILON?elevation(to)+waterDepth(to):elevation(to))};
        refreshed.surfaceDrop=clean(Math.max(Number(record.surfaceDrop||0),Number(refreshed.fromSurface)-Number(refreshed.toSurface)));
        (from.hydrologyEdgeOutflows??={})[prior.dir]=refreshed;out.push({fromX:from.x,fromY:from.y,...refreshed});
      }
    }
    map.hydrologyEdgeFlowSummary={source,edges:out.length,totalVolume:clean(out.reduce((sum,item)=>sum+Number(item.volume||0),0)),totalRate:clean(out.reduce((sum,item)=>sum+Number(item.rate||0),0))};
    return out;
  }

  function authoredCascade(from,to){
    return !!from&&!!to&&
      Number(from.hydrologyCascadeToX)===Number(to.x)&&
      Number(from.hydrologyCascadeToY)===Number(to.y)&&
      Number(from.hydrologyCascadeDrop||0)>EPSILON;
  }

  function storedEdgeFlow(from,to){
    if(!from||!to)return null;
    const dir=edgeDirectionId(Math.sign(Number(to.x)-Number(from.x)),Math.sign(Number(to.y)-Number(from.y)));
    const record=dir?from?.hydrologyEdgeOutflows?.[dir]:null;
    if(!record||Number(record.toX)!==Number(to.x)||Number(record.toY)!==Number(to.y))return null;
    return record;
  }

  // Canonical per-edge query. Unlike flowX/flowY, which is only a principal river
  // direction, hydrologyEdgeOutflows can represent N/E/S/W simultaneously and is
  // written by the actual volume solver. Presentation consumes this record; it does
  // not infer waterfalls from coordinates or water levels on its own.
  function edgeFlowState(a,b,{minCascadeDrop=.18,minCliffDrop=1.0001}={}){
    if(!a||!b)return null;
    const dx=Number(b.x)-Number(a.x),dy=Number(b.y)-Number(a.y);
    if(Math.abs(dx)+Math.abs(dy)!==1||!canHoldWater(a)||!canHoldWater(b))return null;

    let from=null,to=null,record=null,authored=false;
    const ab=storedEdgeFlow(a,b),ba=storedEdgeFlow(b,a);
    if(ab&&ba){if(Number(ab.rate||0)>=Number(ba.rate||0)){from=a;to=b;record=ab;}else{from=b;to=a;record=ba;}}
    else if(ab){from=a;to=b;record=ab;}
    else if(ba){from=b;to=a;record=ba;}
    else if(authoredCascade(a,b)){from=a;to=b;authored=true;}
    else if(authoredCascade(b,a)){from=b;to=a;authored=true;}
    else return{flowing:false,cascade:false,a,b,authored:false,reason:"NO_EDGE_FLUX"};

    const fromDepth=waterDepth(from),toDepth=waterDepth(to);
    const fromSurface=Number(record?.fromSurface??(fromDepth>EPSILON?waterSurfaceZ(from):elevation(from)));
    const toSurface=Number(record?.toSurface??(toDepth>EPSILON?waterSurfaceZ(to):elevation(to)));
    const surfaceDrop=Math.max(0,Number(record?.surfaceDrop??(fromSurface-toSurface)));
    const bedDrop=Number(record?.bedDrop??(elevation(from)-elevation(to)));
    const naturalFrom=Number(from.hydrologyChannelBaseElevation??elevation(from));
    const naturalTo=Number(to.hydrologyChannelBaseElevation??elevation(to));
    const naturalDrop=Number(record?.naturalDrop??(naturalFrom-naturalTo));
    const cliffDrop=Math.max(Number(record?.cliffDrop??0),bedDrop,naturalDrop);
    const cascade=fromDepth>EPSILON&&
      surfaceDrop>=Math.max(0,Number(minCascadeDrop||0))&&
      (authored||record?.authored===true||cliffDrop>Math.max(0,Number(minCliffDrop||0)));
    const resolvedRate=Math.max(0,Number(record?.rate??from.hydrologyOutflowRate??from.discharge??0));
    // Generic hydraulic power proxy used by presentation and future erosion:
    // discharge rate multiplied by available head. No terrain/type special case.
    const hydraulicPower=clean(resolvedRate*Math.max(0,surfaceDrop));
    return{
      flowing:authored||Number(record?.volume||0)>EPSILON||resolvedRate>EPSILON,
      cascade,authored:authored||record?.authored===true,from,to,
      dirX:Math.sign(Number(to.x)-Number(from.x)),dirY:Math.sign(Number(to.y)-Number(from.y)),
      surfaceDrop:clean(surfaceDrop),bedDrop:roundSigned(bedDrop),naturalDrop:roundSigned(naturalDrop),cliffDrop:roundSigned(cliffDrop),
      volume:clean(record?.volume||0),rate:clean(resolvedRate),hydraulicPower,
      fromSurface:roundSigned(fromSurface),toSurface:roundSigned(toSurface),
      reason:record?"MEASURED_EDGE_FLUX":"AUTHORED_CASCADE"
    };
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

  function releaseStoredRiverWater(map,events=[],source="RIVER_RECESSION",volumeScale=DISCHARGE_VOLUME_PER_TURN){
    const reports=[];
    for(const component of riverComponents(map)){
      const by=new Map(component.map(tile=>[key(tile.x,tile.y),tile]));
      const drains=component.filter(tile=>tile?.hydrologyDrain===true);
      if(!drains.length)continue;

      const distance=new Map(),q=[];
      for(const drain of drains){
        const k=key(drain.x,drain.y);
        if(distance.has(k))continue;
        distance.set(k,0);q.push(drain);
      }
      while(q.length){
        const tile=q.shift(),d=Number(distance.get(key(tile.x,tile.y))||0);
        for(const neighbor of riverNeighbors(tile,by)){
          const k=key(neighbor.x,neighbor.y);
          if(distance.has(k))continue;
          distance.set(k,d+1);q.push(neighbor);
        }
      }

      const carried=new Map(component.map(tile=>[key(tile.x,tile.y),0]));
      const ordered=[...component].sort((a,b)=>
        Number(distance.get(key(b.x,b.y))||0)-Number(distance.get(key(a.x,a.y))||0)||
        a.y-b.y||a.x-b.x
      );

      let drained=0,moved=0;
      for(const tile of ordered){
        const k=key(tile.x,tile.y);
        const incoming=Math.max(0,Number(carried.get(k)||0));
        const floor=baselineDepth(tile);
        const localExtra=Math.max(0,waterDepth(tile)-floor);
        const available=incoming+localExtra;

        if(available<=EPSILON)continue;

        const routeCapacity=tile.hydrologyDrain===true
          ?Number(tile.outletEffectiveCapacity??tile.channelCapacity??0)
          :Number(tile.channelCapacity||0);
        const spareRate=Math.max(0,routeCapacity-Number(tile.hydrologyOutflowRate||0));
        const spareVolume=clean(spareRate*Math.max(0,Number(volumeScale||0)));
        const pass=Math.min(available,spareVolume);
        const retained=Math.max(0,available-pass);

        // Incoming stored floodwater joins this channel reach. Whatever cannot pass
        // its spare capacity remains here as elevated river stage.
        tile.waterDepth=clean(floor+retained);
        sync(tile,events);

        if(pass<=EPSILON)continue;
        moved+=pass;

        if(tile.hydrologyDrain===true){
          drained+=pass;
          events.push({
            type:"RIVER_FLOOD_WATER_DRAINED",
            x:tile.x,y:tile.y,
            source,
            amount:clean(pass),
            spareCapacityRate:clean(spareRate),
            channelCapacity:Number(tile.channelCapacity||0),
            outletEffectiveCapacity:Number(tile.outletEffectiveCapacity??tile.channelCapacity??0),
            outletEfficiency:Number(tile.outletEfficiency||0),
            throughFlow:Number(tile.hydrologyOutflowRate||0)
          });
          continue;
        }

        const here=Number(distance.get(k)||0);
        const downstream=riverNeighbors(tile,by)
          .filter(n=>Number(distance.get(key(n.x,n.y)))<here)
          .sort((a,b)=>
            Number(distance.get(key(a.x,a.y)))-Number(distance.get(key(b.x,b.y)))||
            a.y-b.y||a.x-b.x
          )[0]||null;

        if(!downstream){
          // No valid downstream route: keep the water in this reach.
          tile.waterDepth=clean(waterDepth(tile)+pass);
          sync(tile,events);
          moved-=pass;
          continue;
        }

        const dk=key(downstream.x,downstream.y);
        carried.set(dk,Number(carried.get(dk)||0)+pass);
      }

      if(drained>EPSILON||moved>EPSILON){
        reports.push({tiles:component.length,moved:clean(moved),drained:clean(drained)});
      }
    }

    if(reports.length){
      events.push({
        type:"RIVER_FLOOD_RECESSION",
        source,
        moved:clean(reports.reduce((sum,r)=>sum+r.moved,0)),
        drained:clean(reports.reduce((sum,r)=>sum+r.drained,0)),
        components:reports
      });
    }
    return reports;
  }

  function riverDrainBudgets(map,volumeScale=DISCHARGE_VOLUME_PER_TURN){
    const budgets=new Map();
    for(const tile of map?.tiles||[]){
      if(tile?.river!==true||tile?.hydrologyDrain!==true)continue;
      const spareRate=Math.max(0,Number(tile.outletEffectiveCapacity??tile.channelCapacity??0)-Number(tile.hydrologyOutflowRate||0));
      budgets.set(key(tile.x,tile.y),clean(spareRate*Math.max(0,Number(volumeScale||0))));
    }
    return budgets;
  }

  function applyOutlets(map,events=[],source="DRAINAGE",fed=sourceFedWaterKeys(map),outletBudgets=null,volumeScale=DISCHARGE_VOLUME_PER_TURN){
    let drained=0;
    const openBoundary=map?.hydrology?.openBoundary===true||map?.generated===true;
    const by=new Map((map?.tiles||[]).map(tile=>[key(tile.x,tile.y),tile]));
    const budgets=outletBudgets||new Map();

    for(const tile of map?.tiles||[]){
      const explicitDrain=tile.hydrologyDrain===true||tile.drain===true;
      const boundaryDrain=tile.river!==true&&openBoundary&&isBoundaryTile(map,tile);
      const outlet=explicitDrain||boundaryDrain;
      if(!outlet||waterDepth(tile)<=EPSILON)continue;

      const floor=protectedDepth(tile,fed);
      const available=Math.max(0,waterDepth(tile)-floor);
      if(available<=EPSILON)continue;

      const k=key(tile.x,tile.y);
      if(!budgets.has(k))budgets.set(k,boundaryDrainBudget(map,tile,fed,by,volumeScale));
      const remaining=Math.max(0,Number(budgets.get(k)||0));
      if(remaining<=EPSILON)continue;

      const amount=clean(Math.min(available,remaining));
      if(amount<=EPSILON)continue;
      budgets.set(k,clean(Math.max(0,remaining-amount)));
      tile.waterDepth=clean(waterDepth(tile)-amount);
      drained+=amount;
      const profile=outletProfile(map,tile,by);
      if(profile){
        tile.outletEfficiency=profile.efficiency;
        tile.outletApproachSlope=profile.approachSlope;
        tile.outletOpenWidth=profile.openWidth;
      }
      events.push({
        type:tile.river===true&&tile.hydrologyDrain===true?"RIVER_THROUGHFLOW_DRAINED":"WATER_DRAINED_OFF_MAP",
        x:tile.x,y:tile.y,
        amount,
        source,
        protectedDepth:floor,
        capacityLimited:true,
        outletEfficiency:Number(profile?.efficiency||0),
        outletApproachSlope:Number(profile?.approachSlope||0),
        outletOpenWidth:Number(profile?.openWidth||0),
        remainingOutletBudget:Number(budgets.get(k)||0)
      });
    }
    return drained;
  }

  function redistribute(map,{source="FLOW",events=[],riverPulse=false,volumeScale=DISCHARGE_VOLUME_PER_TURN}={}){
    if(!map?.tiles?.length)return events;

    const riverReports=reconcileRiverDischarge(map,{
      events,
      applyOverflow:riverPulse,
      volumeScale:Math.max(0,Number(volumeScale||0)),
      source
    });

    const overloadedKeys=new Set();
    if(riverPulse){
      for(const tile of map.tiles){
        if(tile?.river===true&&Number(tile.hydrologyOverflowRate||0)>EPSILON){
          overloadedKeys.add(key(tile.x,tile.y));
        }
      }
    }

    const beforeDepth=new Map(map.tiles.map(tile=>[key(tile.x,tile.y),waterDepth(tile)]));
    const beforeVolume=totalWater(map);
    const by=new Map(map.tiles.map(tile=>[key(tile.x,tile.y),tile]));
    const fed=sourceFedWaterKeys(map);
    const outletBudgets=outletDrainBudgets(map,fed,volumeScale);
    const edgeNet=new Map();
    const initialOutletDrain=applyOutlets(map,events,source,fed,outletBudgets,volumeScale);
    const recession=releaseStoredRiverWater(map,events,source,volumeScale);
    let iterations=0,maxDelta=0,totalDrained=clean(initialOutletDrain+recession.reduce((sum,r)=>sum+r.drained,0)),totalAbsorbed=0;

    // flow -> infiltration -> capacity-limited outlet drainage -> flow again
    for(;iterations<MAX_FLOW_ITERATIONS;iterations++){
      maxDelta=flowIteration(map,by,fed,edgeNet);

      const absorbed=absorbStandingWater(map,events,source,fed);
      const drained=applyOutlets(map,events,source,fed,outletBudgets,volumeScale);
      totalAbsorbed+=absorbed;
      totalDrained+=drained;

      if(maxDelta<FLOW_EPSILON&&absorbed<EPSILON&&drained<EPSILON)break;
    }

    let changed=0;
    const overbank=[];
    for(const tile of map.tiles){
      tile.waterDepth=waterDepth(tile)<=EPSILON?0:clean(tile.waterDepth);
      const old=Number(beforeDepth.get(key(tile.x,tile.y))||0),now=waterDepth(tile);

      if(Math.abs(now-old)>FLOW_EPSILON){
        changed++;
        events.push({
          type:"WATER_FLOW",
          x:tile.x,y:tile.y,
          fromDepth:old,
          waterDepth:now,
          waterSurfaceZ:now>0?elevation(tile)+now:null,
          source
        });
      }

      if(riverPulse&&tile.river!==true&&now>old+FLOW_EPSILON){
        const adjacentOverload=DIRS.some(([dx,dy])=>overloadedKeys.has(key(tile.x+dx,tile.y+dy)));
        if(adjacentOverload)overbank.push({x:tile.x,y:tile.y,fromDepth:old,waterDepth:now});
      }

      sync(tile,events);
    }

    commitEdgeFlows(map,edgeNet,{source,volumeScale});

    if(overbank.length){
      events.push({
        type:"RIVER_OVERBANK_FLOOD",
        source,
        floodedTiles:overbank.length,
        tiles:overbank
      });
    }

    const afterVolume=totalWater(map);
    if(changed||totalDrained>EPSILON||riverReports.some(report=>report.overloaded)){
      events.push({
        type:"HYDROLOGY_REBALANCED",
        source,
        changedTiles:changed,
        iterations:iterations+1,
        beforeVolume,
        afterVolume,
        surfaceWater:surfaceWaterVolume(map),
        soilWater:soilWaterVolume(map),
        drained:clean(totalDrained),
        absorbed:clean(totalAbsorbed),
        maxDelta,
        riverOverloaded:riverReports.some(report=>report.overloaded)
      });
    }

    reconcileRiverDischarge(map,{events,applyOverflow:false,source});
    const flowBudget=riverFlowBudget(map);
    map.hydrologyFlowBudget=flowBudget;
    if(flowBudget.sourceCount||flowBudget.outletCount){
      events.push({type:"RIVER_FLOW_BUDGET",source,...flowBudget});
    }
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
    redistribute(map,{source:rainSource,events,riverPulse:true});return events;
  }

  function drySoil(map,{amount=DRYING_PER_CLEAR_TURN,source="DRYING"}={}){
    const events=[];
    for(const tile of map?.tiles||[]){if(waterDepth(tile)>EPSILON||!hasSoil(tile))continue;const before=soilMoisture(tile);if(before<=EPSILON)continue;const dryAmount=baseTerrain(tile)==="SAND"?Math.max(Number(amount||0),SAND_DRYING_PER_CLEAR_TURN):Math.max(0,Number(amount||0)),next=clean(Math.max(0,before-dryAmount));tile.soilMoisture=next;if(Math.abs(next-before)>EPSILON)events.push({type:"SOIL_MOISTURE_CHANGED",x:tile.x,y:tile.y,from:before,to:next,source});if(tile.terrain==="MUD"&&next<=EPSILON){tile.terrain="PLAIN";delete tile.soilMoisture;events.push({type:"MUD_DRY",x:tile.x,y:tile.y,source});}}
    if((map?.tiles||[]).some(tile=>tile?.river===true))redistribute(map,{source,events,riverPulse:false});
    return events;
  }

  return Object.freeze({
    WATERLINE,RAIN_FILL_PER_EVENT,HEAVY_RAIN_FILL_PER_EVENT,STORM_RAIN_FILL_PER_EVENT,NATURAL_WATER_DEPTH,
    SOIL_SATURATION_CAPACITY,SAND_SOIL_CAPACITY,DRYING_PER_CLEAR_TURN,SAND_DRYING_PER_CLEAR_TURN,EVAPORATION_PER_CLEAR_TURN,
    EPSILON,FLOW_EPSILON,MAX_FLOW_ITERATIONS,MAX_DRAIN_CYCLES,FLOW_RELAXATION,DISCHARGE_VOLUME_PER_TURN,DEFAULT_SOURCE_DISCHARGE,MIN_CHANNEL_CAPACITY_FACTOR,MAX_CHANNEL_CAPACITY_FACTOR,
    initializeMap,normalizeRiverNetwork,refreshRiverChannelCapacity,refreshOutletHydraulics,outletProfile,outletDrainBudgets,reconcileRiverDischarge,releaseStoredRiverWater,riverFlowBudget,activeSourceTiles,advanceSources,settleInitialSources,sourceRecessionActive,deactivateSource,advanceSourceRecession,edgeFlowState,clearEdgeFlows,tileAt,elevation,waterDepth,waterSurfaceZ,isWater,connectedWaterBody,sourceFedWaterKeys,captureSourceBaselines,fillCapacity,
    soilCapacity,soilMoisture,surfaceWaterVolume,soilWaterVolume,totalWater,
    setWaterDepth,addWater,removeWater,redistribute,evaporateUnfedWater,floodArea,deformTerrain,applyRain,drySoil
  });
})();
globalThis.HydrologyEngine=HydrologyEngine;

export const HydrologyEngine=(()=>{
  "use strict";

  const WATERLINE=0;
  const RAIN_FILL_PER_EVENT=.06,HEAVY_RAIN_FILL_PER_EVENT=.12,STORM_RAIN_FILL_PER_EVENT=.16,NATURAL_WATER_DEPTH=1;
  const SOIL_SATURATION_CAPACITY=.45,SAND_SOIL_CAPACITY=.22,DRYING_PER_CLEAR_TURN=.10,SAND_DRYING_PER_CLEAR_TURN=.16,EVAPORATION_PER_CLEAR_TURN=.06;
  // Surface-water infiltration is a physical flux per environment turn, not an
  // unlimited "fill soil to capacity" operation every numerical solver iteration.
  // The previous implementation could run this absorption hundreds of times inside
  // one redistribute() call, so a perennial spring pulse was consumed by a chain of
  // dry tiles before any visible surface stream could survive.
  const PLAIN_INFILTRATION_PER_TURN=.018,FOREST_INFILTRATION_PER_TURN=.022,MUD_INFILTRATION_PER_TURN=.008,SAND_INFILTRATION_PER_TURN=.034;
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
  const infiltrationRate=t=>{
    switch(baseTerrain(t)){
      case "SAND":return SAND_INFILTRATION_PER_TURN;
      case "FOREST":return FOREST_INFILTRATION_PER_TURN;
      case "MUD":return MUD_INFILTRATION_PER_TURN;
      case "PLAIN":return PLAIN_INFILTRATION_PER_TURN;
      default:return 0;
    }
  };
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
    const sources=component.filter(tile=>tile?.hydrologySource===true&&!drainKeys.has(key(tile.x,tile.y)));

    // Sources are explicit physical inputs (OFF_MAP_SOURCE / SPRING_SOURCE).
    // River geometry is never allowed to promote an upstream leaf into a source.
    // Rebuild source/drain markers deterministically from those formal inputs.
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
        const currentDirX=Math.sign(Number(tile.flowX||0)),currentDirY=Math.sign(Number(tile.flowY||0));
        const candidateNext=tile.hydrologyDrain===true?null:
          by.get(key(tile.x+currentDirX,tile.y+currentDirY));
        const canTransport=tile.hydrologyDrain===true ||
          (candidateNext?.river===true&&riverRouteHasHead(tile,candidateNext));
        const outflowRate=canTransport?clean(Math.min(inflowRate,capacity)):0;
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
    reconcilePersistentEdgeDischarge(map,{source,volumeScale:scale});
    return reports;
  }


  function sourceRecessionActive(map){
    return riverComponents(map).some(component=>
      component.some(tile=>waterDepth(tile)>EPSILON)&&
      !component.some(tile=>tile?.hydrologySource===true)
    );
  }

  function deactivateSource(map,x,y,{events=[],reason="SOURCE_DISABLED",objectId=null}={}){
    const priorPersistent=snapshotPersistentEdgeDischarge(map);
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
    reconcilePersistentEdgeDischarge(map,{source:reason,priorPersistent});
    clearSolverEdgeFlows(map);
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
    for(const tile of map?.tiles||[])tile.hydrologyBaseWaterDepth=
      (tile?.river===true&&tile.hydrologyTransportInitialized!==true&&fed.has(key(tile.x,tile.y)))
        ?clean(waterDepth(tile)):0;
    return fed;
  }
  function protectedDepth(tile,fed){return fed?.has(key(tile.x,tile.y))?Math.min(waterDepth(tile),baselineDepth(tile)):0}

  function activeSourceTiles(map){
    return(map?.tiles||[]).filter(tile=>tile?.hydrologySource===true&&tile?.hydrologySourceDisabled!==true&&canHoldWater(tile));
  }

  function riverKineticHead(tile){
    // A through-flow carries a limited kinetic head on a near-level reach.
    // This is a physical routing condition, not an instruction to draw a
    // corridor; cliffs and genuine uphill dams still require stored water.
    const speed=clamp(Number(tile?.flowSpeed??tile?.baseFlowSpeed??0),0,MAX_BASE_FLOW_SPEED);
    return Math.min(.25,Math.max(.04,speed*speed/9.81));
  }
  function riverRouteHasHead(from,to){
    if(!from||!to)return false;
    if(from.hydrologyTransportInitialized!==true)return true;
    return elevation(from)+waterDepth(from)+riverKineticHead(from)+EPSILON
      >=elevation(to)+waterDepth(to);
  }

  function advanceSources(map,{events=[],source="SOURCE_INFLOW",volumeScale=DISCHARGE_VOLUME_PER_TURN,redistributeAfter=true}={}){
    if(!map?.tiles?.length)return events;
    const scale=Math.max(0,Number(volumeScale||0));
    let injectedVolume=0,sourceCount=0,storedVolume=0,drainedVolume=0;
    for(const tile of activeSourceTiles(map)){
      const rate=Math.max(0,sourceDemandRate(tile));
      const volume=clean(rate*scale);
      if(volume<=EPSILON)continue;
      injectedVolume=clean(injectedVolume+volume);sourceCount++;
      // A pre-eroded channel must actually carry and retain water. Source Q
      // is not enough: stamping its full pulse directly at the off-map drain
      // leaves every intervening reach dry. Insert the conserved volume into
      // the actual riverbed D store and let the existing head/flow/outlet
      // solver route it. No duplicate water state or invented baseline depth.
      setWaterDepth(tile,waterDepth(tile)+volume,events,source);
      storedVolume=clean(storedVolume+volume);
      events.push({type:"HYDROLOGY_SOURCE_INFLOW",x:tile.x,y:tile.y,source,rate,volume,
        waterDepth:waterDepth(tile),waterSurfaceZ:waterSurfaceZ(tile)});
    }
    if(storedVolume>EPSILON&&redistributeAfter)redistribute(map,{source,events,riverPulse:false,volumeScale:scale});
    if(injectedVolume>EPSILON)events.push({type:"HYDROLOGY_SOURCES_ADVANCED",source,sourceCount,
      injectedVolume,drainedVolume,storedVolume});
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
      if(tile.terrain==="MUD"){tile.soilMoisture=clean(tile.soilMoisture==null?SOIL_SATURATION_CAPACITY:soilMoisture(tile));continue;}
      if(tile.terrain==="SAND")tile.soilMoisture=clean(Math.min(SAND_SOIL_CAPACITY,Number(tile.soilMoisture||0)));
      if(tile.terrain!=="WATER")continue;
      if(!Number.isFinite(Number(tile.waterDepth))||Number(tile.waterDepth)<=0){
        tile.waterDepth=NATURAL_WATER_DEPTH;
        tile.elevation=Number(tile.elevation||0)-NATURAL_WATER_DEPTH;
      }
      tile.waterDepth=clean(tile.waterDepth);
      tile.waterSurfaceZ=elevation(tile)+waterDepth(tile);
      tile.dryTerrain??="PLAIN";
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
    if(!tile||baseTerrain(tile)!=="PLAIN")return false;
    // Mud is a change to the underlying ground, even when surface water covers it.
    if(tile.terrain==="WATER")tile.dryTerrain="MUD";
    else tile.terrain="MUD";
    events.push({type:"MUD_CREATED",x:tile.x,y:tile.y,source,soilMoisture:soilMoisture(tile)});
    return true;
  }

  function saturateSoil(tile,amount,events=[],source="RAIN"){
    if(!tile||!hasSoil(tile)||amount<=EPSILON)return Math.max(0,Number(amount||0));
    const before=soilMoisture(tile),capacity=Math.max(0,soilCapacity(tile)-before),absorbed=Math.min(capacity,Math.max(0,Number(amount||0)));
    if(absorbed>EPSILON){
      tile.soilMoisture=clean(before+absorbed);
      // The existing soil capacity, not first contact or a new guessed threshold,
      // defines saturation-driven mud formation. Unsaturated soil stays wet ground.
      if(tile.soilMoisture>=soilCapacity(tile)-EPSILON)markMud(tile,events,source);
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
      const base=tile.terrain,moisture=terrainHasSoil(base)?soilMoisture(tile):0;tile.dryTerrain=base;
      // Surface coverage and soil saturation are different stores. Converting a
      // visually wet tile to WATER must not manufacture subsurface water; only the
      // infiltration flux is allowed to increase soilMoisture.
      if(terrainHasSoil(base))tile.soilMoisture=clean(moisture);
      tile.terrain="WATER";
      events.push({type:"BASIN_FILLED",x:tile.x,y:tile.y,elevation:elevation(tile),waterDepth:tile.waterDepth,waterSurfaceZ:tile.waterSurfaceZ,dryTerrain:tile.dryTerrain});
    }else if(tile.waterDepth<=0&&tile.terrain==="WATER"&&tile.dryTerrain){
      const base=tile.dryTerrain,moisture=terrainHasSoil(base)?soilMoisture(tile):0;
      if(base==="PLAIN"||base==="MUD"){tile.terrain=base;tile.soilMoisture=clean(moisture);}
      else{tile.terrain=base;if(base==="SAND")tile.soilMoisture=clean(Math.min(SAND_SOIL_CAPACITY,moisture));}
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
        // Authored rivers move physical D along their existing directed Q network
        // once per hydrology step. Numerical lake equilibration must not move it
        // through an entire river in 256 solver iterations in the same turn.
        if(map.hydrology?.generatedRiverProfile===true&&tile.river===true&&other.river===true)continue;
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

  function clearSolverEdgeFlows(map){
    for(const tile of map?.tiles||[])delete tile.hydrologyEdgeOutflows;
    if(map)map.hydrologyEdgeFlowSummary={source:null,edges:0,totalVolume:0,totalRate:0};
  }

  function clearPersistentEdgeDischarge(map){
    for(const tile of map?.tiles||[])delete tile.hydrologyEdgeDischarge;
    if(map)map.hydrologyPersistentDischargeSummary={source:null,edges:0,totalRate:0};
  }

  function clearEdgeFlows(map){
    clearSolverEdgeFlows(map);
    clearPersistentEdgeDischarge(map);
  }

  function routingSurface(tile){
    if(!tile)return-Infinity;
    return waterDepth(tile)>EPSILON?Number(waterSurfaceZ(tile)):elevation(tile);
  }

  function persistentHintKey(tile,dir){return`${key(tile.x,tile.y)}:${dir}`}

  function snapshotPersistentEdgeDischarge(map){
    const snapshot=new Map();
    for(const tile of map?.tiles||[]){
      for(const[dir,record]of Object.entries(tile?.hydrologyEdgeDischarge||{})){
        const rate=Math.max(0,Number(record?.rate||0));
        if(rate<=EPSILON)continue;
        snapshot.set(persistentHintKey(tile,dir),{
          toX:Number(record.toX),toY:Number(record.toY),rate,
          routeKind:String(record.routeKind||"PERSISTENT")
        });
      }
    }
    return snapshot;
  }

  function writePersistentEdge(from,to,rate,{source="FLOW",routeKind="ROUTED",volumeScale=DISCHARGE_VOLUME_PER_TURN}={}){
    if(!from||!to||rate<=EPSILON)return null;
    const dx=Math.sign(Number(to.x)-Number(from.x)),dy=Math.sign(Number(to.y)-Number(from.y)),dir=edgeDirectionId(dx,dy);
    if(!dir||Math.abs(Number(to.x)-Number(from.x))+Math.abs(Number(to.y)-Number(from.y))!==1)return null;
    const fromSurface=routingSurface(from),toSurface=routingSurface(to);
    const bedDrop=elevation(from)-elevation(to);
    const naturalFrom=Number(from.hydrologyChannelBaseElevation??elevation(from));
    const naturalTo=Number(to.hydrologyChannelBaseElevation??elevation(to));
    const naturalDrop=naturalFrom-naturalTo;
    const record={
      toX:Number(to.x),toY:Number(to.y),dirX:dx,dirY:dy,
      source,routeKind,persistent:true,
      rate:clean(rate),
      transportVolume:clean(rate*Math.max(0,Number(volumeScale||0))),
      fromSurface:roundSigned(fromSurface),toSurface:roundSigned(toSurface),
      surfaceDrop:clean(Math.max(0,fromSurface-toSurface)),
      bedDrop:roundSigned(bedDrop),naturalDrop:roundSigned(naturalDrop),
      cliffDrop:roundSigned(Math.max(bedDrop,naturalDrop,Number(from.hydrologyCascadeDrop||0))),
      authored:authoredCascade(from,to)
    };
    (from.hydrologyEdgeDischarge??={})[dir]=record;
    return record;
  }

  function reconcilePersistentEdgeDischarge(map,{source="FLOW",priorPersistent=null,volumeScale=DISCHARGE_VOLUME_PER_TURN}={}){
    if(!map?.tiles?.length)return[];
    const prior=priorPersistent instanceof Map?priorPersistent:snapshotPersistentEdgeDischarge(map);
    clearPersistentEdgeDischarge(map);

    const by=new Map(map.tiles.map(tile=>[key(tile.x,tile.y),tile]));
    const graph=new Map();

    const addCandidate=(from,list,seen,to,{kind="GRADIENT",hint=0}={})=>{
      if(!to||!canHoldWater(to)||to===from)return;
      const dx=Math.sign(Number(to.x)-Number(from.x)),dy=Math.sign(Number(to.y)-Number(from.y)),dir=edgeDirectionId(dx,dy);
      if(!dir||Math.abs(Number(to.x)-Number(from.x))+Math.abs(Number(to.y)-Number(from.y))!==1)return;
      const id=key(to.x,to.y);if(seen.has(id))return;
      const head=routingSurface(from)-routingSurface(to);
      const hinted=kind!=="GRADIENT";
      // Equal-surface reaches may still carry a steady discharge. They are allowed
      // only when topology/solver history already establishes direction; discovery
      // without a hint remains strictly downhill.
      if((!hinted&&head<=FLOW_EPSILON)||
         (hinted&&head<-FLOW_EPSILON&&
          !(kind==="RIVER"&&from.hydrologyTransportInitialized===true&&riverRouteHasHead(from,to))))return;
      seen.add(id);
      list.push({to,dir,kind,hint:Math.max(0,Number(hint||0)),head:Math.max(0,head)});
    };

    for(const tile of map.tiles){
      if(!canHoldWater(tile))continue;
      const list=[],seen=new Set();

      // A river reach already owns a formal downstream topology and a channel
      // discharge solved by reconcileRiverDischarge(). Keep that as the primary
      // route even after local storage equalization reaches zero delta.
      const fx=Math.sign(Number(tile.flowX||0)),fy=Math.sign(Number(tile.flowY||0));
      if(tile.river===true&&Math.abs(fx)+Math.abs(fy)===1){
        addCandidate(tile,list,seen,by.get(key(tile.x+fx,tile.y+fy)),{
          kind:"RIVER",
          hint:Math.max(0,Number(tile.hydrologyOutflowRate??tile.discharge??0))
        });
      }

      // Solver transfers establish real branch topology for non-river sheets,
      // basins, floodwater and newly-created source paths.
      for(const record of Object.values(tile?.hydrologyEdgeOutflows||{})){
        const solverRate=Math.max(0,Number(record?.rate||0));
        if(solverRate<=EPSILON)continue;
        addCandidate(tile,list,seen,by.get(key(record.toX,record.toY)),{kind:"SOLVER",hint:solverRate});
      }

      // Preserve an established continuous branch across subsequent equilibrium
      // passes, provided the current hydraulic surface has not reversed uphill.
      for(const dir of["N","E","S","W"]){
        const hint=prior.get(persistentHintKey(tile,dir));if(!hint)continue;
        addCandidate(tile,list,seen,by.get(key(hint.toX,hint.toY)),{kind:"PERSISTENT",hint:hint.rate});
      }

      const cx=Number(tile.hydrologyCascadeToX),cy=Number(tile.hydrologyCascadeToY);
      if(Number.isFinite(cx)&&Number.isFinite(cy)){
        addCandidate(tile,list,seen,by.get(key(cx,cy)),{
          kind:"AUTHORED",
          hint:Math.max(0,Number(tile.hydrologyOutflowRate??tile.discharge??0))
        });
      }

      // Principal flow direction is a topology hint for authored/generated water
      // networks, not a substitute flow magnitude.
      if(Math.abs(fx)+Math.abs(fy)===1){
        addCandidate(tile,list,seen,by.get(key(tile.x+fx,tile.y+fy)),{kind:"PRINCIPAL"});
      }

      // Only an un-routed tile may discover a fresh path from hydraulic gradient.
      if(!list.length&&(waterDepth(tile)>EPSILON||tile.hydrologySource===true)){
        for(const[dx,dy]of DIRS)addCandidate(tile,list,seen,by.get(key(tile.x+dx,tile.y+dy)),{kind:"GRADIENT"});
      }
      if(list.length)graph.set(key(tile.x,tile.y),list);
    }

    const openBoundary=map?.hydrology?.openBoundary===true||map?.generated===true;
    const outletKeys=new Set((map.tiles||[]).filter(tile=>
      tile?.hydrologyDrain===true||tile?.drain===true||(openBoundary&&isBoundaryTile(map,tile))
    ).map(tile=>key(tile.x,tile.y)));
    const reverse=new Map();
    for(const[fromKey,candidates]of graph){
      for(const candidate of candidates){
        const toKey=key(candidate.to.x,candidate.to.y);
        if(!reverse.has(toKey))reverse.set(toKey,new Set());
        reverse.get(toKey).add(fromKey);
      }
    }
    const canReachOutlet=new Set(),outletQueue=[...outletKeys];
    while(outletQueue.length){
      const k=outletQueue.shift();if(canReachOutlet.has(k))continue;
      canReachOutlet.add(k);
      for(const previous of reverse.get(k)||[])if(!canReachOutlet.has(previous))outletQueue.push(previous);
    }

    // An authored source-fed river must be able to send Q INTO a closed
    // geological depression. Requiring an open outlet before routing any Q
    // stranded inflow upstream and prevented the depression from ever filling.
    // The edge network is still a DAG from the source and only downhill/head-
    // valid edges exist; a terminal sink stores the arriving volume in D.
    const storeAtRealSink=map.hydrology?.generatedRiverProfile===true;
    const allSources=activeSourceTiles(map),sources=allSources.filter(tile=>storeAtRealSink||canReachOutlet.has(key(tile.x,tile.y))),seedRates=new Map(),seedTiles=[];
    for(const tile of sources){
      const rate=Math.max(0,sourceDemandRate(tile));
      if(rate<=EPSILON)continue;
      const k=key(tile.x,tile.y);seedRates.set(k,clean(Number(seedRates.get(k)||0)+rate));seedTiles.push(tile);
    }

    // With no live source, retained water is allowed to finish draining through
    // the previously established discharge graph. Only graph roots are seeded and
    // the rate is capped by water physically stored there for this turn.
    if(!seedTiles.length&&prior.size){
      const incoming=new Map(),outgoing=new Map();
      for(const [edgeKey,hint] of prior){
        const fromKey=edgeKey.slice(0,edgeKey.lastIndexOf(':'));
        const toKey=key(hint.toX,hint.toY);
        outgoing.set(fromKey,Number(outgoing.get(fromKey)||0)+Math.max(0,Number(hint.rate||0)));
        incoming.set(toKey,Number(incoming.get(toKey)||0)+Math.max(0,Number(hint.rate||0)));
      }
      const scale=Math.max(EPSILON,Number(volumeScale||DISCHARGE_VOLUME_PER_TURN));
      for(const [fromKey,rate] of outgoing){
        if(Number(incoming.get(fromKey)||0)>EPSILON)continue;
        const tile=by.get(fromKey);if(!tile||waterDepth(tile)<=EPSILON||!canReachOutlet.has(fromKey))continue;
        const residual=Math.min(Math.max(0,rate),waterDepth(tile)/scale);
        if(residual<=EPSILON)continue;
        seedRates.set(fromKey,clean(residual));seedTiles.push(tile);
      }
    }

    const distance=new Map(),queue=[];
    for(const tile of seedTiles){
      const k=key(tile.x,tile.y);
      if(distance.has(k))continue;
      distance.set(k,0);queue.push(tile);
    }
    while(queue.length){
      const tile=queue.shift(),d=Number(distance.get(key(tile.x,tile.y))||0);
      for(const candidate of graph.get(key(tile.x,tile.y))||[]){
        const tk=key(candidate.to.x,candidate.to.y);
        if((!storeAtRealSink&&!canReachOutlet.has(tk))||distance.has(tk))continue;
        distance.set(tk,d+1);queue.push(candidate.to);
      }
    }

    const throughput=new Map(seedRates);

    const ordered=[...map.tiles]
      .filter(tile=>distance.has(key(tile.x,tile.y)))
      .sort((a,b)=>Number(distance.get(key(a.x,a.y)))-Number(distance.get(key(b.x,b.y))||0)||compareTileOrder(a,b));

    const routes=[];
    for(const tile of ordered){
      const k=key(tile.x,tile.y);
      let available=Math.max(0,Number(throughput.get(k)||0));
      if(available<=EPSILON)continue;

      if(tile.river===true&&sources.length){
        const formal=Math.max(0,Number(tile.hydrologyOutflowRate??tile.discharge??0));
        available=Math.min(available,formal);
      }
      if(available<=EPSILON)continue;

      const here=Number(distance.get(k)||0);
      const candidates=(graph.get(k)||[]).filter(candidate=>{
        const tk=key(candidate.to.x,candidate.to.y);
        return (storeAtRealSink||canReachOutlet.has(tk))&&Number(distance.get(tk))>here;
      });
      if(!candidates.length)continue;

      let weightTotal=0;
      for(const candidate of candidates){
        candidate.weight=candidate.hint>EPSILON
          ?candidate.hint
          :candidate.kind==="RIVER"||candidate.kind==="AUTHORED"||candidate.kind==="PRINCIPAL"
            ?1
            :Math.pow(Math.max(FLOW_EPSILON,candidate.head),1.5);
        weightTotal+=candidate.weight;
      }
      if(weightTotal<=EPSILON)continue;

      for(const candidate of candidates){
        const rate=clean(available*candidate.weight/weightTotal);
        if(rate<=EPSILON)continue;
        const record=writePersistentEdge(tile,candidate.to,rate,{source,routeKind:candidate.kind,volumeScale});
        if(!record)continue;
        routes.push({fromX:tile.x,fromY:tile.y,...record});
        const tk=key(candidate.to.x,candidate.to.y);
        throughput.set(tk,clean(Number(throughput.get(tk)||0)+rate));
      }
    }

    map.hydrologyPersistentDischargeSummary={
      source,
      edges:routes.length,
      totalRate:clean(routes.reduce((sum,route)=>sum+Number(route.rate||0),0)),
      sourceRate:clean([...seedRates.values()].reduce((sum,rate)=>sum+Number(rate||0),0)),
      liveSourceCount:allSources.length,
      routedSourceCount:sources.length,
      recession:!sources.length&&seedTiles.length>0
    };
    return routes;
  }

  function commitEdgeFlows(map,edgeNet,{source="FLOW",volumeScale=DISCHARGE_VOLUME_PER_TURN}={}){
    if(!map?.tiles?.length)return[];
    const priorPersistent=snapshotPersistentEdgeDischarge(map);
    clearSolverEdgeFlows(map);
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
    map.hydrologyEdgeFlowSummary={
      source,edges:out.length,
      totalVolume:clean(out.reduce((sum,item)=>sum+Number(item.volume||0),0)),
      totalRate:clean(out.reduce((sum,item)=>sum+Number(item.rate||0),0))
    };
    reconcilePersistentEdgeDischarge(map,{source,priorPersistent,volumeScale:scale});
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

  function storedPersistentDischarge(from,to){
    if(!from||!to)return null;
    const dir=edgeDirectionId(Math.sign(Number(to.x)-Number(from.x)),Math.sign(Number(to.y)-Number(from.y)));
    const record=dir?from?.hydrologyEdgeDischarge?.[dir]:null;
    if(!record||Number(record.toX)!==Number(to.x)||Number(record.toY)!==Number(to.y))return null;
    return record;
  }

  // Canonical per-edge query. Storage equalization and continuous transport are
  // deliberately separate: hydrologyEdgeOutflows is the current solver transfer,
  // hydrologyEdgeDischarge is the sustained source-fed discharge.
  function edgeFlowState(a,b,{minCascadeDrop=.18,minCliffDrop=1.0001}={}){
    if(!a||!b)return null;
    const dx=Number(b.x)-Number(a.x),dy=Number(b.y)-Number(a.y);
    if(Math.abs(dx)+Math.abs(dy)!==1||!canHoldWater(a)||!canHoldWater(b))return null;

    const persistentAB=storedPersistentDischarge(a,b),persistentBA=storedPersistentDischarge(b,a);
    const solverAB=storedEdgeFlow(a,b),solverBA=storedEdgeFlow(b,a);

    let from=null,to=null,persistent=null,solver=null,authored=false;
    if(persistentAB||persistentBA){
      const aRate=Math.max(0,Number(persistentAB?.rate||0)),bRate=Math.max(0,Number(persistentBA?.rate||0));
      if(aRate>=bRate){from=a;to=b;persistent=persistentAB;solver=solverAB;}
      else{from=b;to=a;persistent=persistentBA;solver=solverBA;}
    }else if(solverAB||solverBA){
      const aRate=Math.max(0,Number(solverAB?.rate||0)),bRate=Math.max(0,Number(solverBA?.rate||0));
      if(aRate>=bRate){from=a;to=b;solver=solverAB;}
      else{from=b;to=a;solver=solverBA;}
    }else if(authoredCascade(a,b)){from=a;to=b;authored=true;}
    else if(authoredCascade(b,a)){from=b;to=a;authored=true;}
    else return{flowing:false,cascade:false,a,b,authored:false,reason:"NO_EDGE_FLUX"};

    authored=authored||authoredCascade(from,to)||persistent?.authored===true||solver?.authored===true;
    const fromDepth=waterDepth(from),toDepth=waterDepth(to);
    // Edge records capture the hydraulic head at the instant water crossed the edge.
    // Use that transport surface when storage has already drained from a steep slope;
    // otherwise a real through-flow would disappear visually just because it stores
    // almost no standing water on the intermediate tile.
    const recordedFrom=Number(persistent?.fromSurface??solver?.fromSurface);
    const recordedTo=Number(persistent?.toSurface??solver?.toSurface);
    const fromSurface=Number.isFinite(recordedFrom)?recordedFrom:(fromDepth>EPSILON?Number(waterSurfaceZ(from)):elevation(from));
    const toSurface=Number.isFinite(recordedTo)?recordedTo:(toDepth>EPSILON?Number(waterSurfaceZ(to)):elevation(to));
    const surfaceDrop=Math.max(0,fromSurface-toSurface);
    const bedDrop=elevation(from)-elevation(to);
    const naturalFrom=Number(from.hydrologyChannelBaseElevation??elevation(from));
    const naturalTo=Number(to.hydrologyChannelBaseElevation??elevation(to));
    const naturalDrop=naturalFrom-naturalTo;
    const cliffDrop=Math.max(Number(persistent?.cliffDrop||0),Number(solver?.cliffDrop||0),bedDrop,naturalDrop,authored?Number(from.hydrologyCascadeDrop||0):0);
    const persistentRate=Math.max(0,Number(persistent?.rate||0));
    const solverRate=Math.max(0,Number(solver?.rate||0));
    const solverVolume=Math.max(0,Number(solver?.volume||0));
    const resolvedRate=persistentRate>EPSILON?persistentRate:solverRate;
    const transportVolume=persistentRate>EPSILON
      ?Math.max(0,Number(persistent?.transportVolume||persistentRate*DISCHARGE_VOLUME_PER_TURN))
      :solverVolume;
    // The solver's edgeNet is a history of transfers within its last time
    // step, not proof that a dry, source-free edge still carries water now.
    // Perennial source Q is independent of storage (D may be zero); transient
    // solver flow must retain real water at at least one end of the edge.
    const flowing=persistentRate>EPSILON
      ?transportVolume>EPSILON||fromDepth>EPSILON||toDepth>EPSILON
      :(solverRate>EPSILON||solverVolume>EPSILON)&&fromDepth>EPSILON;
    const cascade=flowing&&
      surfaceDrop>=Math.max(0,Number(minCascadeDrop||0))&&
      (authored||cliffDrop>Math.max(0,Number(minCliffDrop||0)));
    // A non-cliff downhill transport edge is surface runoff. It is deliberately
    // separate from standing waterDepth so a thin moving film does not become a
    // gameplay-depth tile (drowning/buoyancy remain owned by actual storage).
    const sheetFlow=flowing&&!cascade&&surfaceDrop>FLOW_EPSILON&&bedDrop>FLOW_EPSILON;
    const hydraulicPower=clean(resolvedRate*Math.max(0,surfaceDrop));

    return{
      flowing,cascade,sheetFlow,authored,from,to,
      dirX:Math.sign(Number(to.x)-Number(from.x)),dirY:Math.sign(Number(to.y)-Number(from.y)),
      surfaceDrop:clean(surfaceDrop),bedDrop:roundSigned(bedDrop),naturalDrop:roundSigned(naturalDrop),cliffDrop:roundSigned(cliffDrop),
      volume:clean(solverVolume),transportVolume:clean(transportVolume),
      rate:clean(resolvedRate),edgeDischarge:clean(persistentRate),solverRate:clean(solverRate),persistentRate:clean(persistentRate),hydraulicPower,
      fromSurface:roundSigned(fromSurface),toSurface:roundSigned(toSurface),
      reason:persistentRate>EPSILON?"PERSISTENT_EDGE_DISCHARGE":solver?"MEASURED_EDGE_FLUX":authored?"AUTHORED_CASCADE":"NO_EDGE_FLUX"
    };
  }

  function createInfiltrationBudget(map,volumeScale=DISCHARGE_VOLUME_PER_TURN){
    const elapsedTurns=Math.max(0,Number(volumeScale||0))/Math.max(EPSILON,DISCHARGE_VOLUME_PER_TURN),budget=new Map();
    for(const tile of map?.tiles||[]){
      if(!hasSoil(tile))continue;
      const remaining=Math.max(0,soilCapacity(tile)-soilMoisture(tile));
      const allowance=Math.min(remaining,Math.max(0,infiltrationRate(tile))*elapsedTurns);
      if(allowance>EPSILON)budget.set(key(tile.x,tile.y),clean(allowance));
    }
    return budget;
  }

  function absorbStandingWater(map,events=[],source="INFILTRATION",fed=sourceFedWaterKeys(map),budget=null){
    let absorbed=0;
    for(const tile of map?.tiles||[]){
      if(waterDepth(tile)<=EPSILON||!hasSoil(tile))continue;
      const floor=protectedDepth(tile,fed),before=waterDepth(tile),available=Math.max(0,before-floor);if(available<=EPSILON)continue;
      const k=key(tile.x,tile.y),remainingBudget=budget instanceof Map?Math.max(0,Number(budget.get(k)||0)):Infinity;
      if(remainingBudget<=EPSILON)continue;
      const requested=Math.min(available,remainingBudget),excess=saturateSoil(tile,requested,events,source),used=requested-excess;
      if(used>EPSILON){
        tile.waterDepth=clean(Math.max(floor,before-used));absorbed+=used;
        if(budget instanceof Map)budget.set(k,clean(Math.max(0,remainingBudget-used)));
        events.push({type:"WATER_INFILTRATED",x:tile.x,y:tile.y,amount:clean(used),waterDepth:tile.waterDepth,remainingInfiltrationBudget:budget instanceof Map?Number(budget.get(k)||0):null,source});
      }
    }
    return clean(absorbed);
  }

  // Generated channels have a finite residence time. Route only the D that
  // physically exists at the START of this hydrology step, once per directed
  // edge. Source water cannot teleport across the entire river to the outlet.
  // Existing Q edges supply direction/capacity; D is the ONLY volume store.
  function releaseGeneratedRiverStorage(map,events,source,volumeScale){
    const by=new Map((map?.tiles||[]).map(tile=>[key(tile.x,tile.y),tile]));
    const delta=new Map();
    let moved=0,edges=0;
    for(const tile of map.tiles||[]){
      if(tile?.river!==true||tile.hydrologyDrain===true)continue;
      const dx=Math.sign(Number(tile.flowX||0)),dy=Math.sign(Number(tile.flowY||0));
      if(Math.abs(dx)+Math.abs(dy)!==1)continue;
      const next=by.get(key(tile.x+dx,tile.y+dy));
      if(next?.river!==true||!riverRouteHasHead(tile,next))continue;
      const currentDepth=waterDepth(tile);
      const available=Math.max(0,currentDepth-baselineDepth(tile));
      if(available<=EPSILON)continue;
      // Stored water can still drain after a spring is stopped. It has real
      // hydrostatic head and a real outlet; zero external source Q does not
      // lock a filled pool forever.
      const surfaceHead=Math.max(0,elevation(tile)+currentDepth-elevation(next)-waterDepth(next));
      const gravityRate=surfaceHead>EPSILON
        ?Math.min(Math.max(0,Number(tile.channelCapacity||0)),Math.sqrt(2*9.81*surfaceHead)*.45):0;
      const rate=Math.max(0,Number(tile.hydrologyOutflowRate||0),gravityRate);
      if(rate<=EPSILON)continue;
      const capacityVolume=rate*Math.max(0,Number(volumeScale||0));
      // A fraction of moving water stays in each channel reach for this turn.
      // This is actual conserved D, not a protected/prefilled minimum depth.
      const residenceFactor=tile.ford===true?.88:.64;
      const sent=clean(Math.min(available*residenceFactor,capacityVolume));
      if(sent<=EPSILON)continue;
      const sourceKey=key(tile.x,tile.y),destKey=key(next.x,next.y);
      delta.set(sourceKey,(delta.get(sourceKey)||0)-sent);
      delta.set(destKey,(delta.get(destKey)||0)+sent);
      moved+=sent;edges++;
    }
    for(const [k,change] of delta){
      const tile=by.get(k);
      if(tile)setWaterDepth(tile,waterDepth(tile)+change,events,source);
    }
    if(edges)events.push({type:"RIVER_STORED_FLOW",source,edges,moved:clean(moved),drained:0});
    return edges?[{tiles:edges,moved:clean(moved),drained:0}]:[];
  }

  function releaseStoredRiverWater(map,events=[],source="RIVER_RECESSION",volumeScale=DISCHARGE_VOLUME_PER_TURN){
    if(map?.hydrology?.generatedRiverProfile===true)
      return releaseGeneratedRiverStorage(map,events,source,volumeScale);
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
          // A capacity spare is NOT hydraulic head. Generated river pools
          // retain stored D until the water actually reaches a spill rim.
          .filter(n=>tile.hydrologyTransportInitialized!==true||
            elevation(tile)+waterDepth(tile)+incoming+riverKineticHead(tile)+EPSILON>=elevation(n)+waterDepth(n))
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
    // One infiltration budget per physical hydrology step. The flow solver may
    // iterate many times to converge, but those iterations do not advance time.
    const infiltrationBudget=createInfiltrationBudget(map,volumeScale);
    const edgeNet=new Map();
    const initialOutletDrain=applyOutlets(map,events,source,fed,outletBudgets,volumeScale);
    const recession=releaseStoredRiverWater(map,events,source,volumeScale);
    let iterations=0,maxDelta=0,totalDrained=clean(initialOutletDrain+recession.reduce((sum,r)=>sum+r.drained,0)),totalAbsorbed=0;

    // flow -> infiltration -> capacity-limited outlet drainage -> flow again
    for(;iterations<MAX_FLOW_ITERATIONS;iterations++){
      maxDelta=flowIteration(map,by,fed,edgeNet);

      const absorbed=absorbStandingWater(map,events,source,fed,infiltrationBudget);
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
    for(const tile of map?.tiles||[]){if(waterDepth(tile)>EPSILON||!hasSoil(tile))continue;const before=soilMoisture(tile);if(before<=EPSILON)continue;const dryAmount=baseTerrain(tile)==="SAND"?Math.max(Number(amount||0),SAND_DRYING_PER_CLEAR_TURN):Math.max(0,Number(amount||0)),next=clean(Math.max(0,before-dryAmount));tile.soilMoisture=next;if(Math.abs(next-before)>EPSILON)events.push({type:"SOIL_MOISTURE_CHANGED",x:tile.x,y:tile.y,from:before,to:next,source});if(tile.terrain==="MUD"&&next<=EPSILON&&!Number(tile.massFlowResidue||0)){tile.terrain="PLAIN";delete tile.soilMoisture;events.push({type:"MUD_DRY",x:tile.x,y:tile.y,source});}}
    if((map?.tiles||[]).some(tile=>tile?.river===true))redistribute(map,{source,events,riverPulse:false});
    return events;
  }

  return Object.freeze({
    WATERLINE,RAIN_FILL_PER_EVENT,HEAVY_RAIN_FILL_PER_EVENT,STORM_RAIN_FILL_PER_EVENT,NATURAL_WATER_DEPTH,
    SOIL_SATURATION_CAPACITY,SAND_SOIL_CAPACITY,DRYING_PER_CLEAR_TURN,SAND_DRYING_PER_CLEAR_TURN,EVAPORATION_PER_CLEAR_TURN,
    PLAIN_INFILTRATION_PER_TURN,FOREST_INFILTRATION_PER_TURN,MUD_INFILTRATION_PER_TURN,SAND_INFILTRATION_PER_TURN,
    EPSILON,FLOW_EPSILON,MAX_FLOW_ITERATIONS,MAX_DRAIN_CYCLES,FLOW_RELAXATION,DISCHARGE_VOLUME_PER_TURN,DEFAULT_SOURCE_DISCHARGE,MIN_CHANNEL_CAPACITY_FACTOR,MAX_CHANNEL_CAPACITY_FACTOR,
    initializeMap,normalizeRiverNetwork,refreshRiverChannelCapacity,refreshOutletHydraulics,outletProfile,outletDrainBudgets,reconcileRiverDischarge,releaseStoredRiverWater,riverFlowBudget,activeSourceTiles,advanceSources,settleInitialSources,sourceRecessionActive,deactivateSource,advanceSourceRecession,edgeFlowState,reconcilePersistentEdgeDischarge,clearEdgeFlows,tileAt,elevation,waterDepth,waterSurfaceZ,isWater,connectedWaterBody,sourceFedWaterKeys,captureSourceBaselines,fillCapacity,
    soilCapacity,soilMoisture,infiltrationRate,surfaceWaterVolume,soilWaterVolume,totalWater,
    setWaterDepth,addWater,removeWater,redistribute,evaporateUnfedWater,floodArea,deformTerrain,applyRain,drySoil
  });
})();
globalThis.HydrologyEngine=HydrologyEngine;

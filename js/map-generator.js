export const MapGenerator=(()=>{
  "use strict";

  const SIZE_PRESETS=Object.freeze({
    SMALL:Object.freeze({id:"SMALL",label:"小型",width:14,height:10,minElevation:-2,maxElevation:4,forestClusters:3,rocks:4}),
    MEDIUM:Object.freeze({id:"MEDIUM",label:"中型",width:20,height:14,minElevation:-3,maxElevation:5,forestClusters:5,rocks:6}),
    LARGE:Object.freeze({id:"LARGE",label:"大型",width:26,height:18,minElevation:-4,maxElevation:6,forestClusters:7,rocks:8}),
    XLARGE:Object.freeze({id:"XLARGE",label:"超大型",width:32,height:22,minElevation:-4,maxElevation:7,forestClusters:10,rocks:11})
  });

  const DIRS=[[1,0],[-1,0],[0,1],[0,-1]],key=(x,y)=>`${x},${y}`;
  const RIVER_GENTLE_STEP=.025;
  const RIVER_CASCADE_BED_DROP=1.0001;
  const HIGH_SPRING_SOURCE_CHANCE=.40;
  const HIGH_SPRING_MIN_ELEVATION=1;
  // Source strength is selected once from the map seed, not re-rolled every
  // environment turn. This supplies REAL Hydrology Q (not a visual-only width).
  // The two source types have distinct catchment sizes; low, normal and high
  // yield regimes preserve shallow creeks while allowing genuinely strong rivers.
  const SOURCE_YIELD_REGIMES=Object.freeze({
    // The old yields were different on paper, but the typical Q was almost
    // indistinguishable after a 1.0-rated downstream channel bottleneck. Keep
    // genuine small creeks; let the other watersheds have meaningful discharge.
    OFF_MAP_SOURCE:Object.freeze([[.60,1.30,.23],[1.80,3.60,.48],[4.50,7.50,.29]]),
    SPRING_SOURCE:Object.freeze([[.45,1.00,.34],[1.30,2.60,.48],[3.00,4.80,.18]])
  });
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const inBounds=(w,h,x,y)=>x>=0&&y>=0&&x<w&&y<h;
  const tileAt=(map,x,y)=>map.tiles.find(t=>t.x===x&&t.y===y)||null;

  function hashSeed(seed){let h=2166136261>>>0;for(const ch of String(seed??"CARD_TACTICS")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h||0x6d2b79f5;}
  function createRandom(seed){let a=hashSeed(seed)>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
  function randomSeed(){if(globalThis.crypto?.getRandomValues){const a=new Uint32Array(1);globalThis.crypto.getRandomValues(a);return a[0]>>>0;}return((Date.now()>>>0)^Math.floor(Math.random()*0xffffffff))>>>0;}
  // Independent seeded stream: choosing a source strength cannot change terrain,
  // rocks, forest generation, or spring placement for the same map seed.
  function generatedSourceYield(map,tile,kind){
    const regimes=SOURCE_YIELD_REGIMES[kind];
    if(!regimes||!tile)return 0;
    const random=createRandom(`${Number(map?.seed)>>>0}:SOURCE_YIELD:${kind}:${tile.x},${tile.y}`);
    const choice=random();
    let cumulative=0;
    for(const [low,high,weight] of regimes){
      cumulative+=weight;
      if(choice<cumulative)return Math.round((low+(high-low)*random())*10000)/10000;
    }
    const last=regimes[regimes.length-1];
    return Math.round((last[0]+(last[1]-last[0])*random())*10000)/10000;
  }
  function preset(size){return SIZE_PRESETS[String(size||"MEDIUM").toUpperCase()]||SIZE_PRESETS.MEDIUM;}

  function smooth(field,w,h,passes=4){
    let cur=field;
    for(let p=0;p<passes;p++){
      const next=Array.from({length:h},()=>Array(w).fill(0));
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        let total=cur[y][x]*2,weight=2;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(!inBounds(w,h,nx,ny))continue;
          const ww=(dx===0||dy===0)?1:.55;total+=cur[ny][nx]*ww;weight+=ww;
        }
        next[y][x]=total/weight;
      }
      cur=next;
    }
    return cur;
  }

  function elevationField(w,h,cfg,rand){
    let f=Array.from({length:h},()=>Array.from({length:w},()=>rand()*2-1));
    f=smooth(f,w,h,5);
    const features=Math.max(6,Math.round(w*h/70));
    for(let n=0;n<features;n++){
      const cx=rand()*(w-1),cy=rand()*(h-1),radius=2.5+rand()*Math.max(2,Math.min(w,h)*.25);
      const amp=(rand()<.38?-1:1)*(1.5+rand()*3.8);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const d=Math.hypot(x-cx,y-cy);if(d>radius)continue;
        const q=1-d/radius,s=q*q*(3-2*q);f[y][x]+=amp*s;
      }
    }
    return f.map(row=>row.map(v=>clamp(Math.round(v*2.15+.65),cfg.minElevation,cfg.maxElevation)));
  }

  function setDry(tile,elevation=0,terrain=null){
    if(!tile)return;tile.elevation=Number(elevation||0);tile.terrain=terrain||(tile.elevation>=2?"HIGH_GROUND":"PLAIN");tile.waterDepth=0;tile.waterSurfaceZ=null;
    delete tile.dryTerrain;delete tile.soilMoisture;delete tile.river;delete tile.ford;delete tile.flowX;delete tile.flowY;delete tile.baseFlowSpeed;delete tile.flowSpeed;delete tile.discharge;delete tile.baseDischarge;
    delete tile.hydrologySource;delete tile.hydrologyDrain;delete tile.hydrologyChannelBaseElevation;delete tile.hydrologyCascadeToX;delete tile.hydrologyCascadeToY;delete tile.hydrologyCascadeDrop;delete tile.hydrologyAuthoredSource;delete tile.hydrologySourceInflow;delete tile.hydrologyRequestedSourceInflow;delete tile.hydrologySourceDisabled;delete tile.sourceKind;delete tile.sourceObjectId;
  }
  function setWater(tile,{bed=-1,depth=1,river=false,ford=false,flowX=0,flowY=1,flowSpeed=.6,discharge=1}={}){
    if(!tile)return;
    if(river){
      // Authored river tiles are a Q path, not a pre-filled standing lake.
      // bed+depth was the former free surface: retain the exact gameplay
      // crossing elevation as the stream grade, without inventing D=1.
      tile.elevation=Number(bed)+Number(depth);
      tile.terrain=tile.dryTerrain||"PLAIN";tile.waterDepth=0;tile.waterSurfaceZ=null;
      tile.dryTerrain=tile.terrain;
      tile.hydrologyTransportInitialized=true;
      tile.river=true;tile.ford=!!ford;tile.flowX=Number(flowX||0);tile.flowY=Number(flowY||0);
      tile.baseFlowSpeed=Number(flowSpeed||.6);tile.flowSpeed=tile.baseFlowSpeed;
      tile.baseDischarge=Number(discharge||1);tile.discharge=tile.baseDischarge;
    }else{
      tile.elevation=Number(bed);tile.terrain="WATER";
      tile.waterDepth=Math.max(.1,Number(depth));tile.waterSurfaceZ=tile.elevation+tile.waterDepth;
      tile.dryTerrain="PLAIN";
    }
  }

  function applyTerrain(map,field){
    for(const tile of map.tiles){
      const e=field[tile.y][tile.x];
      if(e<0)setWater(tile,{bed:e,depth:Math.abs(e)});else setDry(tile,e,e>=2?"HIGH_GROUND":"PLAIN");
    }
  }

  function routeYs(map){return [Math.round(map.height*.23),Math.round(map.height*.5),Math.round(map.height*.77)].map(y=>clamp(y,2,map.height-3));}

  function carveBaseZones(map,protectedKeys){
    const mid=Math.floor(map.height/2),half=Math.max(2,Math.floor(map.height*.16)),depth=map.width>=26?3:2;
    const playerCore={x:0,y:mid},enemyCore={x:map.width-1,y:mid};
    for(let y=mid-half;y<=mid+half;y++)for(let i=0;i<depth;i++){
      for(const x of [i,map.width-1-i]){const t=tileAt(map,x,y);if(t){setDry(t,0,"PLAIN");protectedKeys.add(key(x,y));}}
    }
    return{mid,half,depth,playerCore,enemyCore};
  }

  function carveStrategicRoute(map,targetY,index,protectedKeys,rand){
    const startX=1,endX=map.width-2,path=[];let y=targetY,previousElevation=0;
    function carve(x,yy){
      const tile=tileAt(map,x,yy);if(!tile)return;
      const desired=clamp(Number(tile.elevation||0),previousElevation-1,previousElevation+1),passHeight=clamp(desired,0,1);
      setDry(tile,passHeight,"PLAIN");tile.routeId=`route_${index}`;protectedKeys.add(key(x,yy));path.push({x, y:yy});previousElevation=passHeight;
    }
    for(let x=startX;x<=endX;x++){
      let nextY=y;
      if(map.height>=14&&x>2&&x<endX-2&&rand()<.18){const toward=Math.sign(targetY-y),drift=rand()<.65?toward:(rand()<.5?-1:1);nextY=clamp(y+drift,targetY-2,targetY+2);}
      carve(x,y);
      if(nextY!==y){carve(x,nextY);y=nextY;}
      if(map.width>=26){
        const sideY=clamp(y+(index===1?1:(index===0?1:-1)),1,map.height-2),side=tileAt(map,x,sideY);
        if(side&&rand()<.72){setDry(side,clamp(previousElevation+(rand()<.5?0:1),0,1),"PLAIN");side.routeId=`route_${index}`;protectedKeys.add(key(x,sideY));}
      }
    }
    return path;
  }

  function connectRoutesToBases(map,routes,baseInfo,protectedKeys){
    routes.forEach((route,index)=>{
      const targets=[{x:1,y:route[0]?.y??baseInfo.mid},{x:map.width-2,y:route[route.length-1]?.y??baseInfo.mid}];
      for(const target of targets){
        let y=baseInfo.mid;
        while(true){
          const t=tileAt(map,target.x,y);if(t){setDry(t,0,"PLAIN");t.routeId=`route_${index}`;protectedKeys.add(key(t.x,t.y));}
          if(y===target.y)break;y+=Math.sign(target.y-y);
        }
      }
    });
  }

  function routeYAtX(route,x){
    let best=route[0],d=Infinity;for(const p of route){const q=Math.abs(p.x-x);if(q<d){best=p;d=q;}}return best?.y??0;
  }

  function finalizeGeneratedRiverProfile(map){
    const rivers=(map.tiles||[]).filter(tile=>tile?.river===true);
    if(!rivers.length)return{sources:[],drains:[],cascades:[]};
    const by=new Map(rivers.map(tile=>[key(tile.x,tile.y),tile]));
    const neighbors=tile=>DIRS.map(([dx,dy])=>by.get(key(tile.x+dx,tile.y+dy))).filter(Boolean);
    const leaves=rivers.filter(tile=>neighbors(tile).length<=1);

    // Generated rivers are authored top-to-bottom. Keep the downstream boundary as
    // the outlet and let every other dead-end become a tributary/source.
    // Generated rivers are authored downstream toward increasing Y. Route/ford
    // connectors can create branches or loops, so leaf-only outlet detection can
    // accidentally promote the upstream spring to the drain. Always anchor the
    // outlet at the furthest downstream river row.
    const maxY=Math.max(...rivers.map(tile=>Number(tile.y||0)));
    const drains=rivers.filter(tile=>Number(tile.y||0)===maxY);
    const drainKeys=new Set(drains.map(tile=>key(tile.x,tile.y)));
    // Only the authored upstream basin seeds the generated river. Ford connector
    // branches are gameplay crossings, not magical tributary springs.
    // Sources are formal authored hydrology inputs. Never promote a river leaf or
    // projection edge into a magical source merely because it is upstream.
    const sources=rivers.filter(tile=>tile?.hydrologyAuthoredSource===true&&!drainKeys.has(key(tile.x,tile.y)));

    for(const tile of rivers){tile.hydrologySource=false;tile.hydrologyDrain=false;}
    for(const tile of sources)tile.hydrologySource=true;
    for(const tile of drains)tile.hydrologyDrain=true;

    // Distance from an outlet gives a deterministic downstream tree while still
    // allowing tributaries and confluences.
    const distance=new Map(),queue=[];
    for(const drain of drains){const k=key(drain.x,drain.y);distance.set(k,0);queue.push(drain);}
    for(let head=0;head<queue.length;head++){
      const tile=queue[head],d=Number(distance.get(key(tile.x,tile.y))||0);
      for(const next of neighbors(tile)){
        const k=key(next.x,next.y);if(distance.has(k))continue;
        distance.set(k,d+1);queue.push(next);
      }
    }

    const downstreamByKey=new Map();
    for(const tile of rivers){
      if(tile.hydrologyDrain===true)continue;
      const here=Number(distance.get(key(tile.x,tile.y))||0);
      const downstream=neighbors(tile)
        .filter(next=>Number(distance.get(key(next.x,next.y)))<here)
        .sort((a,b)=>Number(distance.get(key(a.x,a.y)))-Number(distance.get(key(b.x,b.y)))||a.y-b.y||a.x-b.x)[0]||null;
      if(downstream)downstreamByKey.set(key(tile.x,tile.y),downstream);
    }

    // A permanent stream's channel capacity must be sized for the catchment
    // which formed it. Historically only the entry carried its seeded yield;
    // every reach downstream still had baseDischarge=1 (.8 at a ford), choking
    // a strong spring-fed river into an identical tiny Q-only sheet. Propagate
    // *design capacity*, not a new water source or a second Q state. Actual Q
    // is still conserved and routed exclusively by HydrologyEngine.
    const catchmentDesign=new Map();
    for(const source of sources){
      const designRate=Math.max(0,Number(source.hydrologySourceInflow||source.baseDischarge||0));
      if(designRate<=0)continue;
      let current=source,visited=new Set();
      while(current&&!visited.has(key(current.x,current.y))){
        const currentKey=key(current.x,current.y);
        visited.add(currentKey);
        catchmentDesign.set(currentKey,(catchmentDesign.get(currentKey)||0)+designRate);
        current=downstreamByKey.get(currentKey)||null;
      }
    }
    for(const tile of rivers){
      const rate=catchmentDesign.get(key(tile.x,tile.y));
      if(rate>0)tile.baseDischarge=Math.max(Number(tile.baseDischarge||0),rate);
    }

    // Strategic roads cross the river at shallow fords. Every edge downstream of a
    // ford is therefore part of the navigable trunk and must remain a gentle reach;
    // otherwise a real terrain cliff farther downstream would lift every upstream
    // ford by the same waterfall drop and make the authored route impassable.
    // Tributaries and the reach upstream of the first ford may still preserve real
    // geological drops as cascades before they join the low-gradient trunk.
    const gentleTrunkEdges=new Set();
    for(const ford of rivers.filter(tile=>tile?.ford===true)){
      let cursor=ford,guard=0;
      while(cursor&&cursor.hydrologyDrain!==true&&guard++<=rivers.length){
        const downstream=downstreamByKey.get(key(cursor.x,cursor.y));
        if(!downstream)break;
        gentleTrunkEdges.add(`${key(cursor.x,cursor.y)}>${key(downstream.x,downstream.y)}`);
        cursor=downstream;
      }
    }

    // Build the authored water profile from the outlet upstream. Ordinary reaches
    // use a gentle grade. A real pre-carving terrain cliff becomes a cascade only
    // outside the ford-connected navigable trunk.
    const outletSurface=Math.min(...drains.map(tile=>Number(tile.waterSurfaceZ??0)));
    const surfaceByKey=new Map(drains.map(tile=>[key(tile.x,tile.y),outletSurface]));
    const cascades=[];
    const ordered=[...rivers].sort((a,b)=>Number(distance.get(key(a.x,a.y))||0)-Number(distance.get(key(b.x,b.y))||0)||a.y-b.y||a.x-b.x);

    for(const tile of ordered){
      const k=key(tile.x,tile.y);
      if(tile.hydrologyDrain===true){
        tile.elevation=outletSurface;
        tile.waterDepth=0;tile.waterSurfaceZ=null;
        tile.flowX=0;tile.flowY=0;
        delete tile.hydrologyCascadeToX;delete tile.hydrologyCascadeToY;delete tile.hydrologyCascadeDrop;
        continue;
      }
      const downstream=downstreamByKey.get(k);if(!downstream)continue;
      const dk=key(downstream.x,downstream.y);
      const downstreamSurface=Number(surfaceByKey.get(dk)??outletSurface);
      const upstreamBase=Number(tile.hydrologyChannelBaseElevation??tile.elevation??0);
      const downstreamBase=Number(downstream.hydrologyChannelBaseElevation??downstream.elevation??0);
      const bedDrop=upstreamBase-downstreamBase;
      const edgeId=`${k}>${dk}`;
      // A waterfall starts on a genuinely raised upstream geological reach.
      // An isolated ridge crossed by a long-eroded river is a CUT THROUGH
      // that ridge, not a dam which teleports the upstream stream bed uphill.
      // Preserve real upstream plateau cascades and their normal cliff geometry.
      const upperNeighbors=neighbors(tile).filter(n=>
        Number(distance.get(key(n.x,n.y)))>Number(distance.get(k)));
      const upstreamGeologySupportsLip=upperNeighbors.some(n=>
        Number(n.hydrologyChannelBaseElevation??n.elevation??0)>=upstreamBase-.75);
      const cascadeDrop=!gentleTrunkEdges.has(edgeId)&&bedDrop>RIVER_CASCADE_BED_DROP&&upstreamGeologySupportsLip?bedDrop:0;
      const surface=downstreamSurface+RIVER_GENTLE_STEP+cascadeDrop;
      surfaceByKey.set(k,surface);

      tile.elevation=surface;
      tile.waterDepth=0;
      tile.waterSurfaceZ=null;
      tile.flowX=Math.sign(downstream.x-tile.x);
      tile.flowY=Math.sign(downstream.y-tile.y);

      if(cascadeDrop>0){
        tile.hydrologyCascadeToX=downstream.x;
        tile.hydrologyCascadeToY=downstream.y;
        tile.hydrologyCascadeDrop=surface-downstreamSurface;
        cascades.push({x:tile.x,y:tile.y,toX:downstream.x,toY:downstream.y,drop:tile.hydrologyCascadeDrop});
      }else{
        delete tile.hydrologyCascadeToX;delete tile.hydrologyCascadeToY;delete tile.hydrologyCascadeDrop;
      }
    }

    // The stream graph is also a pre-existing eroded riverbed. Incision is an
    // actual gameplay elevation change, sampled by the existing 3x3 terrain
    // triangles, NOT a water mesh or a manufactured waterDepth. Preserve fords.
    const {count:incised,bankSlopeFloors}=carveGeneratedRiverbeds(map,rivers,downstreamByKey,distance);
    // Pockets are continuous river-bed depressions, preferentially located in
    // spring tributaries. Their water must arrive from a real upstream source.
    const pools=carveNaturalRiverPools(map,rivers,downstreamByKey,distance,bankSlopeFloors);

    // The profile is fully authored here because only the map generator still knows
    // the terrain before the channel was carved. Hydrology's existing preserve flag
    // keeps this topology while still owning discharge, capacity, flooding and flow.
    map.hydrology={...(map.hydrology||{}),preserveRiverProfile:true,generatedRiverProfile:true};
    map.generatedRiverProfile={
      sources:sources.map(tile=>({x:tile.x,y:tile.y,kind:tile.sourceKind||"BASIN_SOURCE",active:tile.hydrologySourceDisabled!==true,objectId:tile.sourceObjectId||null})),
      drains:drains.map(tile=>({x:tile.x,y:tile.y})),
      cascades,pools,incised
    };
    return map.generatedRiverProfile;
  }

  // Main stem and tributaries share ONE real gameplay elevation field. The
  // centre is lower than adjacent geological banks; TerrainRenderer's existing
  // registered triangles naturally interpolate the river cross section.
  function riverbankSlopeFloor(tile,byAll,grade){
    // TerrainRenderer / VisualSurfaceResolver use their ORIGINAL slope contract:
    // elevation difference <= 1.0001 interpolates a smooth bank. Never turn
    // an existing sloped riverbank contact into a vertical cliff by excavation.
    let floor=-Infinity;
    for(const [dx,dy] of DIRS){
      const bank=byAll.get(key(tile.x+dx,tile.y+dy));
      if(!bank||bank.river===true)continue;
      const h=Number(bank.elevation||0);
      if(Math.abs(h-grade)<=1.0001)floor=Math.max(floor,h-.975);
    }
    return floor;
  }

  function carveGeneratedRiverbeds(map,rivers,downstreamByKey,distance){
    const by=new Map(rivers.map(tile=>[key(tile.x,tile.y),tile]));
    const allBy=new Map(map.tiles.map(tile=>[key(tile.x,tile.y),tile]));
    const preCarveGrades=new Map(rivers.map(tile=>[key(tile.x,tile.y),Number(tile.elevation||0)]));
    const slopeFloor=new Map(rivers.map(tile=>[
      key(tile.x,tile.y),riverbankSlopeFloor(tile,allBy,Number(tile.elevation||0))
    ]));
    const fordDistance=new Map(),queue=[];
    for(const tile of rivers)if(tile.ford||tile.routeId){
      const k=key(tile.x,tile.y);fordDistance.set(k,0);queue.push(tile);
    }
    for(let i=0;i<queue.length;i++){
      const tile=queue[i],distance=fordDistance.get(key(tile.x,tile.y));
      if(distance>=3)continue;
      for(const [dx,dy] of DIRS){
        const next=by.get(key(tile.x+dx,tile.y+dy));if(!next)continue;
        const nk=key(next.x,next.y);
        if(!fordDistance.has(nk)){fordDistance.set(nk,distance+1);queue.push(next);}
      }
    }
    let count=0;
    for(const tile of rivers){
      if(tile.ford||tile.routeId||tile.captureZone||tile.hydrologyDrain)continue;
      const distance=fordDistance.get(key(tile.x,tile.y))??4;
      const bridgeFactor=distance===1?.15:distance===2?.50:1;
      const discharge=Math.max(0,Number(tile.baseDischarge||0));
      // A small creek cuts a shallower bed than a large catchment. Avoid one
      // rectangular deep ditch on every river tile, and avoid bridge cliffs.
      const depth=Number((Math.min(.56,.22+Math.sqrt(discharge)*.105)*bridgeFactor).toFixed(4));
      if(depth<=.0001)continue;
      const geologicalBed=Number(tile.hydrologyChannelBaseElevation??tile.elevation??0);
      const neighbors=DIRS.map(([dx,dy])=>
        map.tiles.find(other=>other.x===tile.x+dx&&other.y===tile.y+dy))
        .filter(n=>n&&n.river!==true);
      const lowestBank=neighbors.length?Math.min(...neighbors.map(n=>Number(n.elevation||0))):Infinity;
      // A river must NEVER run perched above its own geological valley or
      // lower than its natural surrounding lake only in the renderer. Excavation
      // lowers the actual gameplay bed; connected standing lakes supply real D.
      const grade=Number(tile.elevation||0);
      // The channel must run BELOW the adjacent real banks, not on top of a
      // graded zero-depth Q corridor. Use geology to find a natural valley,
      // then preserve every PRE-EXISTING bank slope using bankSlopeFloor.
      const inheritedLakeBed=geologicalBed<0?geologicalBed:Infinity;
      const bedTop=Math.min(grade,lowestBank,inheritedLakeBed);
      const carved=Math.max(bedTop-depth,slopeFloor.get(key(tile.x,tile.y))??-Infinity);
      tile.elevation=Number((Math.min(grade,carved)).toFixed(4));
      tile.hydrologyChannelIncision=Number(Math.max(0,grade-tile.elevation).toFixed(4));
      tile.waterDepth=0;tile.waterSurfaceZ=null;
      count++;
    }
    // An ordinary downstream reach cannot suddenly rise above its upstream
    // channel bottom. Keep a ford as a real shallow sill (or a pool outlet),
    // but remove accidental uphill ridges caused by independent tile cuts.
    const ordered=[...rivers].sort((a,b)=>
      Number(distance.get(key(b.x,b.y))||0)-Number(distance.get(key(a.x,a.y))||0));
    for(const tile of ordered){
      const downstream=downstreamByKey.get(key(tile.x,tile.y));
      if(!downstream||downstream.ford||downstream.routeId||downstream.hydrologyDrain)continue;
      const maxBed=Number(tile.elevation||0)+.10;
      const minSlopeBed=slopeFloor.get(key(downstream.x,downstream.y))??-Infinity;
      if(Number(downstream.elevation||0)>maxBed&&maxBed>=minSlopeBed){
        downstream.elevation=Number(maxBed.toFixed(4));
        downstream.hydrologyChannelIncision=Number((preCarveGrades.get(key(downstream.x,downstream.y))-downstream.elevation).toFixed(4));
      }
    }
    return{count,bankSlopeFloors:slopeFloor};
  }

  // Natural riverbed pockets use the pre-channel geology to choose locations.
  // They are real lower terrain elevations, NOT stamped waterDepth, and remain
  // subject to the canonical source Q, storage, outlet and drowning rules.
  function carveNaturalRiverPools(map,rivers,downstreamByKey,distance,bankSlopeFloors=new Map()){
    const by=new Map(map.tiles.map(tile=>[key(tile.x,tile.y),tile]));
    const directions=DIRS;
    const naturalHeight=tile=>Number(tile?.hydrologyChannelBaseElevation??tile?.elevation??0);
    const accessible=tile=>{
      if(!tile||!tile.river||tile.ford||tile.hydrologySource||tile.hydrologyDrain||tile.routeId||tile.captureZone)return false;
      if(tile.x<=0||tile.y<=0||tile.x>=map.width-1||tile.y>=map.height-1)return false;
      if(Number(tile.hydrologyCascadeDrop||0)>0)return false;
      // Keep both strategic crossings and their immediate banks undisturbed.
      return directions.every(([dx,dy])=>{
        const n=by.get(key(tile.x+dx,tile.y+dy));
        return !n?.ford&&!n?.routeId&&!n?.captureZone;
      });
    };
    // A pool must lie on a source-fed branch, not an incidental road connector.
    // Follow the SAME authored downstream graph used for Q distribution.
    const sourceReach=new Set();
    for(const source of rivers.filter(tile=>tile.hydrologySource===true)){
      let current=source;
      while(current&&!sourceReach.has(key(current.x,current.y))){
        sourceReach.add(key(current.x,current.y));
        current=downstreamByKey.get(key(current.x,current.y));
      }
    }
    const candidates=[];
    for(const tile of rivers){
      if(!sourceReach.has(key(tile.x,tile.y))||!accessible(tile))continue;
      const downstream=downstreamByKey.get(key(tile.x,tile.y));
      if(!downstream||downstream.ford||downstream.routeId||downstream.hydrologyDrain)continue;
      const banks=directions.map(([dx,dy])=>by.get(key(tile.x+dx,tile.y+dy)))
        .filter(n=>n&&!n.river);
      if(!banks.length)continue;
      const floor=naturalHeight(tile);
      const bankHeight=banks.reduce((sum,n)=>sum+naturalHeight(n),0)/banks.length;
      const naturalRelief=bankHeight-floor;
      if(naturalRelief<.15)continue; // require a natural valley signal, not a flat random trench
      const chance=createRandom(`${map.seed}:CHANNEL_POOL:${tile.x},${tile.y}`)();
      const score=naturalRelief*.6+chance*.75+(tile.hydrologyTributary===true?1.75:0);
      candidates.push({tile,downstream,naturalRelief,score,chance});
    }
    candidates.sort((a,b)=>b.score-a.score||Number(distance.get(key(b.tile.x,b.tile.y))||0)-Number(distance.get(key(a.tile.x,a.tile.y))||0));
    const limit=map.size==="XLARGE"?3:map.size==="LARGE"?2:1;
    const chosen=[],centers=[];
    for(const candidate of candidates){
      if(chosen.length>=limit)break;
      if(centers.some(c=>Math.abs(c.x-candidate.tile.x)+Math.abs(c.y-candidate.tile.y)<5))continue;
      const {tile,downstream,naturalRelief,chance}=candidate;
      // A basin must have a real rim in EVERY accessible direction, not just
      // along the river. Otherwise water escapes sideways through a lower bank
      // and the supposed "deep pool" can never hold more than a few centimetres.
      const prior=Number(tile.elevation||0);
      const adjacent=directions.map(([dx,dy])=>by.get(key(tile.x+dx,tile.y+dy))).filter(Boolean);
      const lowestRim=Math.min(...adjacent.map(n=>Number(n.elevation||0)));
      // Actual valley relief controls depth: low-relief creeks develop shallow
      // pools, pronounced rock-cut valleys can contain a rare swimmable hole.
      // The rim is the LOWEST existing escape, not only the routed downstream.
      const intendedStorage=.40+Math.min(1.25,naturalRelief*.48)+chance*.55;
      const naturalExcavation=.45+naturalRelief*.30+chance*.35;
      const requiredExcavation=prior-lowestRim+intendedStorage;
      if(requiredExcavation>3.10)continue; // prevent arbitrary vertical shafts
      // A carved storage pool may be deep below an existing cliff, but its
      // former sloped land contacts must REMAIN sloped for shoreline clipping.
      const desiredDepth=clamp(Math.max(naturalExcavation,requiredExcavation),.50,3.10);
      const floor=bankSlopeFloors.get(key(tile.x,tile.y))??riverbankSlopeFloor(tile,by,prior);
      const depth=Number(Math.max(0,Math.min(desiredDepth,prior-floor)).toFixed(4));
      if(depth<.50)continue;
      tile.elevation=Number((prior-depth).toFixed(4));
      // Do not prefill the depression; D must come from a real water source.
      tile.waterDepth=0;tile.waterSurfaceZ=null;
      tile.hydrologyNaturalChannelPool=true;
      tile.hydrologyNaturalChannelPoolDepth=depth;
      centers.push(tile);
      // On a tributary, widen a pool ALONG the existing channel. Adjacent
      // tributary cells remain part of the same hydrology network, not an
      // independent pond or a visual square pasted onto the terrain.
      const shoulders=[];
      if(tile.hydrologyTributary===true){
        const upstream=rivers.filter(other=>other.hydrologyTributary===true&&
          downstreamByKey.get(key(other.x,other.y))===tile&&!other.hydrologySource&&!other.ford);
        for(const other of upstream.slice(0,1)){
          const cut=Number(Math.min(.38,depth*.30).toFixed(4));
          other.elevation=Number((Number(other.elevation||0)-cut).toFixed(4));
          other.hydrologyNaturalChannelPool=true;
          other.hydrologyNaturalChannelPoolDepth=cut;
          shoulders.push({x:other.x,y:other.y,depth:cut});
        }
      }
      chosen.push({x:tile.x,y:tile.y,bed:tile.elevation,originalBed:prior,
        depth,downstreamX:downstream.x,downstreamY:downstream.y,
        outletBed:Number(downstream.elevation||0),lowestRim,
        tributary:tile.hydrologyTributary===true,shoulders,
        naturalBankRelief:Number(naturalRelief.toFixed(4))});
    }
    return chosen;
  }

  function createRiver(map,routes,protectedKeys,rand,{springMode="RANDOM"}={}){
    const xBase=clamp(Math.round(map.width*(.42+rand()*.16)),4,map.width-5);
    const river=[],riverKeys=new Set(),routeCrossings=new Map();
    const tileMap=new Map(map.tiles.map(tile=>[key(tile.x,tile.y),tile]));
    const getTile=(x,y)=>tileMap.get(key(x,y))||null;

    function riverTileAllowed(x,y,{allowGoal=false,goal=null}={}){
      const tile=getTile(x,y);
      if(!tile)return false;
      if(allowGoal&&goal&&x===goal.x&&y===goal.y)return true;
      return tile.captureZone!==true;
    }

    function naturalHeight(tile){
      return Number(tile?.hydrologyChannelBaseElevation??tile?.elevation??0);
    }

    function cardinalPath(start,goal){
      if(!start||!goal)return[];
      const startKey=key(start.x,start.y),goalKey=key(goal.x,goal.y);
      const queue=[{x:start.x,y:start.y}],seen=new Set([startKey]),parent=new Map();
      let head=0;

      while(head<queue.length){
        const current=queue[head++],currentKey=key(current.x,current.y);
        if(currentKey===goalKey)break;

        const steps=DIRS.map(([dx,dy])=>({x:current.x+dx,y:current.y+dy}))
          .filter(point=>inBounds(map.width,map.height,point.x,point.y))
          .filter(point=>point.x>=2&&point.x<=map.width-3)
          .filter(point=>riverTileAllowed(point.x,point.y,{allowGoal:true,goal}))
          .sort((a,b)=>
            (Math.abs(a.x-goal.x)+Math.abs(a.y-goal.y))-
            (Math.abs(b.x-goal.x)+Math.abs(b.y-goal.y))||
            Math.abs(a.x-start.x)-Math.abs(b.x-start.x)
          );

        for(const next of steps){
          const nextKey=key(next.x,next.y);
          if(seen.has(nextKey))continue;
          seen.add(nextKey);parent.set(nextKey,current);queue.push(next);
        }
      }

      if(!seen.has(goalKey))return[];
      const path=[];let cursor={x:goal.x,y:goal.y};
      while(true){
        path.push(cursor);
        const cursorKey=key(cursor.x,cursor.y);
        if(cursorKey===startKey)break;
        cursor=parent.get(cursorKey);
        if(!cursor)return[];
      }
      path.reverse();
      return path;
    }

    function chooseOffMapSource(){
      // An innate/pre-existing river may only enter from outside the battlefield.
      // Pick a boundary entry; do not invent an internal BASIN_SOURCE.
      const candidates=[];
      for(let x=2;x<=map.width-3;x++){
        const tile=getTile(x,0);
        if(!tile||tile.captureZone===true||protectedKeys.has(key(x,0)))continue;
        const next=getTile(x,1);
        const score=Number(tile.elevation||0)*2+Math.abs(x-xBase)*.45+Math.max(0,Number(tile.elevation||0)-Number(next?.elevation||0))*.2;
        candidates.push({tile,score});
      }
      candidates.sort((a,b)=>a.score-b.score||Math.abs(a.tile.x-xBase)-Math.abs(b.tile.x-xBase));
      return candidates[0]?.tile||getTile(clamp(xBase,2,map.width-3),0);
    }


    function chooseOffMapDrain(source){
      const candidates=[];
      for(let x=2;x<=map.width-3;x++){
        const tile=getTile(x,map.height-1);if(!tile||tile.captureZone===true)continue;
        const previous=getTile(x,map.height-2),height=naturalHeight(tile),approach=naturalHeight(previous);
        const score=height*2.5+Math.max(0,height-approach)*4+Math.abs(x-Number(source?.x??x))*.18;
        candidates.push({tile,score,height});
      }
      candidates.sort((a,b)=>a.score-b.score||a.height-b.height||a.tile.x-b.tile.x);
      return candidates[0]?.tile||getTile(clamp(Number(source?.x??xBase),2,map.width-3),map.height-1);
    }

    function naturalRiverPath(start,goal){
      if(!start||!goal)return[];
      const startKey=key(start.x,start.y),goalKey=key(goal.x,goal.y),cost=new Map([[startKey,0]]),parent=new Map(),open=[{x:start.x,y:start.y,g:0}];
      while(open.length){
        let best=0;for(let i=1;i<open.length;i++)if(open[i].g<open[best].g)best=i;
        const current=open.splice(best,1)[0],currentKey=key(current.x,current.y);
        if(current.g>Number(cost.get(currentKey))+1e-9)continue;
        if(currentKey===goalKey)break;
        const currentTile=getTile(current.x,current.y),currentHeight=naturalHeight(currentTile);
        for(const[dx,dy]of DIRS){
          const nx=current.x+dx,ny=current.y+dy,nk=key(nx,ny);
          if(!inBounds(map.width,map.height,nx,ny)||nx<2||nx>map.width-3)continue;
          const next=getTile(nx,ny);if(!next||next.captureZone===true)continue;
          const nextHeight=naturalHeight(next),uphill=Math.max(0,nextHeight-currentHeight),highland=Math.max(0,nextHeight-1),backtrack=Math.max(0,current.y-ny);
          const routePenalty=protectedKeys.has(nk)&&nk!==goalKey?8:0;
          const existingWater=Number(next.waterDepth||0)>0&&!next.river?-.35:0;
          const step=Math.max(.2,1+uphill*7+highland*1.8+backtrack*2.25+routePenalty+existingWater);
          const ng=current.g+step;
          if(ng+1e-9>=Number(cost.get(nk)??Infinity))continue;
          cost.set(nk,ng);parent.set(nk,{x:current.x,y:current.y});open.push({x:nx,y:ny,g:ng});
        }
      }
      if(!cost.has(goalKey))return[];
      const path=[];let cursor={x:goal.x,y:goal.y};
      while(true){path.push(cursor);const ck=key(cursor.x,cursor.y);if(ck===startKey)break;cursor=parent.get(ck);if(!cursor)return[];}
      path.reverse();return path;
    }

    function springCanReachOutlet(source){
      // A spring is not given a pre-carved river. We only reject placements whose
      // watershed cannot ever spill to an existing river or map boundary without
      // rising above the spring's own terrain level. Depressions/flats may fill first.
      const ceiling=Number(source.elevation||0)+1e-6,seen=new Set([key(source.x,source.y)]),queue=[source];
      while(queue.length){
        const current=queue.shift();
        if(current!==source&&(current.river===true||current.x===0||current.y===0||current.x===map.width-1||current.y===map.height-1))return true;
        for(const[dx,dy]of DIRS){
          const next=getTile(current.x+dx,current.y+dy),nk=next?key(next.x,next.y):null;
          if(!next||seen.has(nk)||next.captureZone===true||protectedKeys.has(nk)||Number(next.elevation||0)>ceiling)continue;
          seen.add(nk);queue.push(next);
        }
      }
      return false;
    }

    function placeNaturalSpring(){
      // Consume the normal random draw in every mode so a test toggle never
      // shifts subsequent forest/object generation for the same map seed.
      const naturalSpringRoll=rand();
      if(springMode==="NEVER")return null;
      if(springMode!=="ALWAYS"&&naturalSpringRoll>=HIGH_SPRING_SOURCE_CHANCE)return null;
      const candidates=[];
      for(let y=1;y<map.height-1;y++)for(let x=2;x<=map.width-3;x++){
        const tile=getTile(x,y),tileKey=key(x,y);
        if(!tile||tile.river===true||tile.captureZone===true||protectedKeys.has(tileKey)||Number(tile.waterDepth||0)>0)continue;
        const height=Number(tile.elevation||0);if(height<HIGH_SPRING_MIN_ELEVATION)continue;
        const neighbors=DIRS.map(([dx,dy])=>getTile(x+dx,y+dy)).filter(Boolean);
        const downhill=neighbors.filter(next=>Number(next.elevation||0)<height-1e-6);
        const gentleDownhill=downhill.filter(next=>height-Number(next.elevation||0)<=1.0001);
        const cliffFaces=downhill.filter(next=>height-Number(next.elevation||0)>1.0001).length;
        const supported=neighbors.filter(next=>Number(next.elevation||0)>=height-1e-6).length;
        // A natural spring should emerge on a shoulder / slope, not on top of an
        // isolated pillar. It needs at least one walkable-height downhill release,
        // enough lateral support, and at most one immediate cliff face.
        if(!gentleDownhill.length||supported<1||cliffFaces>1||!springCanReachOutlet(tile))continue;
        const lowest=Math.min(...downhill.map(next=>Number(next.elevation||0))),relief=height-lowest;
        const highPenalty=Math.max(0,height-3)*.9,cliffPenalty=cliffFaces*1.2;
        const score=Math.abs(x-xBase)*.12+y*.05+relief*.45+Math.abs(downhill.length-2)*.35+highPenalty+cliffPenalty;
        candidates.push({tile,score});
      }
      candidates.sort((a,b)=>a.score-b.score||a.tile.y-b.tile.y||a.tile.x-b.tile.x);
      const source=candidates[0]?.tile||null;if(!source)return null;
      const sourceKey=key(source.x,source.y);
      source.hydrologySource=true;source.hydrologyAuthoredSource=true;source.sourceKind="SPRING_SOURCE";
      const springYield=generatedSourceYield(map,source,source.sourceKind);
      source.hydrologySourceInflow=springYield;source.baseDischarge=springYield;source.discharge=springYield;
      source.sourceObjectId=`generated_spring_${source.x}_${source.y}`;source.hydrologySourceNaturalElevation=Number(source.elevation||0);
      // Source is a protected geological object footprint. The terrain remains
      // authored by the map elevation and terrain generators; Hydrology determines
      // its actual water/soil state and WaterRenderer draws the outlet footprint.
      source.springSourceFootprint=true;
      protectedKeys.add(sourceKey);
      return source;
    }


    function placeRiverTile(tx,ty){
      const tile=getTile(tx,ty);
      if(!tile||tile.captureZone===true)return null;

      if(!Number.isFinite(Number(tile.hydrologyChannelBaseElevation)))tile.hydrologyChannelBaseElevation=Number(tile.elevation||0);

      const routeIndex=typeof tile.routeId==="string"?Number(tile.routeId.split("_")[1]):null;
      const isRoute=Number.isInteger(routeIndex);
      const routeSurface=isRoute
        ?(tile.ford
          ?Number(tile.waterSurfaceZ??(Number(tile.elevation||0)+Number(tile.waterDepth||0)))
          :clamp(Number(tile.elevation||0),0,1))
        :0;

      setWater(tile,{
        bed:isRoute?routeSurface-.35:-1,
        depth:isRoute?.35:1,
        river:true,
        ford:isRoute,
        flowX:0,
        flowY:1,
        flowSpeed:isRoute?.45:.62,
        discharge:isRoute?.8:1
      });

      const tileKey=key(tile.x,tile.y);
      if(!riverKeys.has(tileKey)){
        riverKeys.add(tileKey);
        river.push({x:tile.x,y:tile.y});
      }
      if(isRoute&&!routeCrossings.has(routeIndex)){
        routeCrossings.set(routeIndex,{x:tile.x,y:tile.y});
        protectedKeys.add(tileKey);
      }
      return tile;
    }

    function layPath(path){
      for(const point of path)placeRiverTile(point.x,point.y);
      return path.length?path[path.length-1]:null;
    }



    // A pre-existing river has one formal OFF_MAP_SOURCE at the map boundary.
    // On-map springs are separate sources and never receive a pre-carved connector.
    const sourceSeed=chooseOffMapSource();
    if(!sourceSeed)throw new Error("Off-map river source generation failed");
    const drainSeed=chooseOffMapDrain(sourceSeed),naturalPath=naturalRiverPath(sourceSeed,drainSeed);
    if(!drainSeed||!naturalPath.length)throw new Error("Terrain-aware off-map river routing failed");
    const authoredSource=placeRiverTile(sourceSeed.x,sourceSeed.y);
    if(authoredSource){
      authoredSource.hydrologyAuthoredSource=true;authoredSource.sourceKind="OFF_MAP_SOURCE";
      const inletYield=generatedSourceYield(map,authoredSource,authoredSource.sourceKind);
      authoredSource.hydrologySourceInflow=inletYield;
      authoredSource.baseDischarge=inletYield;
      authoredSource.discharge=inletYield;
    }
    layPath(naturalPath.slice(1));

    // Every strategic route receives a real ford connected to the existing river
    // through the same cardinal routing rule. Capture zones are obstacles rather
    // than silently shifting an individual river tile away from its neighbours.
    routes.forEach((route,index)=>{
      if(routeCrossings.has(index))return;
      let best=null;
      for(const rp of route){
        const rpTile=getTile(rp.x,rp.y);
        if(!rpTile||rpTile.captureZone===true)continue;
        for(const rv of river){
          const d=Math.abs(rp.x-rv.x)+Math.abs(rp.y-rv.y);
          if(!best||d<best.d)best={rp,rv,d};
        }
      }
      if(!best)return;

      const crossing=getTile(best.rp.x,best.rp.y);
      if(!crossing)return;
      crossing.routeId=`route_${index}`;
      const path=cardinalPath(best.rv,best.rp);
      if(!path.length)throw new Error(`River ford routing failed for route ${index}`);
      layPath(path.slice(1));

      const ford=getTile(best.rp.x,best.rp.y);
      if(ford){
        ford.routeId=`route_${index}`;
        if(!ford.ford){
          const surface=clamp(Number(ford.elevation||0)+Number(ford.waterDepth||0),0,1);
          setWater(ford,{bed:surface-.35,depth:.35,river:true,ford:true,flowX:0,flowY:1,flowSpeed:.45,discharge:.8});
        }
        ford.ford=true;
        ford.baseFlowSpeed=.45;ford.flowSpeed=.45;
        ford.baseDischarge=.8;ford.discharge=.8;
        routeCrossings.set(index,{x:ford.x,y:ford.y});
        protectedKeys.add(key(ford.x,ford.y));
      }
    });

    const spring=placeNaturalSpring();
    let tributary=[];
    if(spring){
      // Connect a real uphill spring to a downstream mainstem reach before
      // finalising slopes and the catchment Q graph. Unconnectable springs keep
      // their existing natural terrain runoff instead of a fictional corridor.
      const joins=river.map(p=>getTile(p.x,p.y)).filter(t=>
        t&&!t.ford&&!t.routeId&&!t.hydrologyDrain&&t.y>=1&&t.y<map.height-2)
        .sort((a,b)=>Math.abs(a.x-spring.x)+Math.abs(a.y-spring.y)-
          (Math.abs(b.x-spring.x)+Math.abs(b.y-spring.y))||a.y-b.y);
      for(const join of joins.slice(0,18)){
        const path=naturalRiverPath(spring,join);
        if(path.length<2||path.length>Math.max(7,Math.round(map.height*.70)))continue;
        const middle=path.slice(1,-1);
        if(middle.some(p=>{
          const t=getTile(p.x,p.y);
          return !t||t.river||t.routeId||t.captureZone||protectedKeys.has(key(p.x,p.y));
        }))continue;
        tributary=path.slice(0,-1).map(p=>{
          const tile=placeRiverTile(p.x,p.y);
          if(tile)tile.hydrologyTributary=true;
          return{x:p.x,y:p.y};
        });
        // Source metadata is geological, not generated by the tributary.
        spring.hydrologySource=true;
        break;
      }
    }
    const profile=finalizeGeneratedRiverProfile(map);
    profile.tributaries=tributary.length?[{
      kind:"SPRING_FED",source:{x:spring.x,y:spring.y},
      cells:tributary,
      join:{x:tributary.at(-1).x+Number(getTile(tributary.at(-1).x,tributary.at(-1).y)?.flowX||0),
        y:tributary.at(-1).y+Number(getTile(tributary.at(-1).x,tributary.at(-1).y)?.flowY||0)}
    }]:[];
    if(spring&&!tributary.length){
      profile.sources.push({x:spring.x,y:spring.y,kind:"SPRING_SOURCE",active:true,objectId:spring.sourceObjectId});
    }
    const sourceObjects=spring?[{id:spring.sourceObjectId,x:spring.x,y:spring.y,type:"SPRING",environment:"WATER",destructible:true,blocksMovement:false,floatOnWater:false,hydrologySourceX:spring.x,hydrologySourceY:spring.y}]:[];
    return{tiles:river,crossings:[...routeCrossings.entries()].map(([routeIndex,p])=>({routeIndex,...p})),profile,sourceObjects};
  }

  function zoneTiles(map,x0,y0,w=2,h=2){const out=[];for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){const t=tileAt(map,x,y);if(t)out.push(t);}return out;}
  function areaAround(map,tiles,r=1){const seen=new Set(),out=[];for(const t of tiles)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const x=t.x+dx,y=t.y+dy,k=key(x,y);if(!inBounds(map.width,map.height,x,y)||seen.has(k))continue;seen.add(k);out.push({x,y});}return out;}

  function createCapturePoints(map,routes,protectedKeys){
    const labels=["北側","中央","南側"],ids=["north_outpost","center_outpost","south_outpost"],points=[];
    routes.forEach((route,i)=>{
      const center=route.reduce((best,p)=>Math.abs(p.x-map.width/2)<Math.abs(best.x-map.width/2)?p:best,route[0]);
      const x0=clamp(center.x-1,2,map.width-4),y0=clamp(center.y-(i===1?1:0),1,map.height-3),tiles=zoneTiles(map,x0,y0,2,2);
      tiles.forEach(t=>{setDry(t,Math.min(1,Math.max(0,Number(t.elevation||0))),"PLAIN");t.routeId=`route_${i}`;t.captureZone=true;protectedKeys.add(key(t.x,t.y));});
      points.push({id:ids[i],name:`${labels[i]}據點`,owner:"NEUTRAL",capturable:true,captureTiles:tiles.map(t=>({x:t.x,y:t.y})),area:areaAround(map,tiles,1)});
    });
    return points;
  }

  function paintForest(map,cx,cy,r,rand,protectedKeys){
    for(let y=Math.floor(cy-r);y<=Math.ceil(cy+r);y++)for(let x=Math.floor(cx-r);x<=Math.ceil(cx+r);x++){
      if(!inBounds(map.width,map.height,x,y)||protectedKeys.has(key(x,y)))continue;const t=tileAt(map,x,y);if(!t||t.river||Number(t.waterDepth||0)>0||t.elevation<0)continue;
      const d=Math.hypot((x-cx)/r,(y-cy)/(r*.78));if(d>1||d>.6+rand()*.52)continue;t.terrain="FOREST";
    }
  }
  function addForests(map,cfg,rand,protectedKeys){
    for(let i=0;i<cfg.forestClusters;i++){const cx=1+rand()*(map.width-2),cy=1+rand()*(map.height-2),r=2.2+rand()*Math.max(2,map.height*.15);paintForest(map,cx,cy,r,rand,protectedKeys);}
    const target=Math.round(map.tiles.length*.15);let count=map.tiles.filter(t=>t.terrain==="FOREST").length;
    const candidates=map.tiles.filter(t=>!protectedKeys.has(key(t.x,t.y))&&!t.river&&t.waterDepth<=0&&t.elevation>=0);
    for(const t of candidates){if(count>=target)break;if(rand()<.32){t.terrain="FOREST";count++;}}
  }

  function reachableTiles(map,objects,start){
    const seen=new Set(),q=[{x:start.x,y:start.y}];seen.add(key(start.x,start.y));
    while(q.length){
      const p=q.shift(),from=tileAt(map,p.x,p.y);
      for(const[dx,dy]of DIRS){
        const x=p.x+dx,y=p.y+dy,k=key(x,y);if(seen.has(k))continue;
        const to=tileAt(map,x,y);if(!normalPassable(map,objects,from,to))continue;
        seen.add(k);q.push({x,y});
      }
    }
    return seen;
  }

  function highGroundComponents(map){
    const candidates=new Set(map.tiles.filter(t=>Number(t.elevation||0)>=2&&Number(t.waterDepth||0)<=0).map(t=>key(t.x,t.y))),out=[];
    while(candidates.size){
      const first=candidates.values().next().value,[sx,sy]=first.split(",").map(Number),q=[tileAt(map,sx,sy)],component=[];candidates.delete(first);
      while(q.length){
        const t=q.shift();if(!t)continue;component.push(t);
        for(const[dx,dy]of DIRS){
          const k=key(t.x+dx,t.y+dy);if(!candidates.has(k))continue;
          candidates.delete(k);q.push(tileAt(map,t.x+dx,t.y+dy));
        }
      }
      out.push(component);
    }
    return out;
  }

  function rampSearch(map,start,reachable,protectedKeys){
    const startHeight=movementHeight(start),need=Math.max(1,Math.ceil(startHeight));
    const q=[{x:start.x,y:start.y,path:[start]}],seen=new Set([key(start.x,start.y)]);
    while(q.length){
      const cur=q.shift(),last=cur.path[cur.path.length-1];
      for(const[dx,dy]of DIRS){
        const n=tileAt(map,last.x+dx,last.y+dy);if(!n)continue;
        const k=key(n.x,n.y);if(seen.has(k))continue;
        const path=[...cur.path,n];
        if(reachable.has(k)&&path.length-1>=Math.max(1,Math.ceil(startHeight-movementHeight(n))))return path;
        if(n.river||n.captureZone||protectedKeys.has(k))continue;
        seen.add(k);
        if(path.length<=need+Math.max(5,Math.ceil(Math.sqrt(map.tiles.length)/2)))q.push({x:n.x,y:n.y,path});
      }
    }
    return null;
  }

  function carveMountainRamp(path,protectedKeys,rampIndex){
    if(!path||path.length<2)return 0;
    const top=path[0],bottom=path[path.length-1],topH=movementHeight(top),bottomH=movementHeight(bottom),steps=path.length-1;
    let changed=0;
    for(let i=1;i<path.length-1;i++){
      const t=path[i];
      const desired=Math.max(bottomH,topH-i);
      if(Math.abs(Number(t.elevation||0)-desired)>.0001||Number(t.waterDepth||0)>0){
        setDry(t,desired,desired>=2?"HIGH_GROUND":"PLAIN");changed++;
      }
      t.mountainRamp=true;t.rampId=`mountain_ramp_${rampIndex}`;protectedKeys.add(key(t.x,t.y));
    }
    top.mountainRamp=true;top.rampId=`mountain_ramp_${rampIndex}`;
    return changed;
  }

  function ensureMountainAccessibility(map,protectedKeys,baseInfo){
    const report={ramps:0,changedTiles:0,connectedComponents:0,remainingInaccessible:0};
    let guard=0;
    while(guard++<map.tiles.length){
      const reachable=reachableTiles(map,[],baseInfo.playerCore);
      const components=highGroundComponents(map).filter(component=>component.some(t=>!reachable.has(key(t.x,t.y))));
      if(!components.length)break;
      let connected=false;
      components.sort((a,b)=>b.length-a.length);
      for(const component of components){
        const unreachable=component.filter(t=>!reachable.has(key(t.x,t.y)));
        const edges=unreachable.filter(t=>DIRS.some(([dx,dy])=>!component.some(c=>c.x===t.x+dx&&c.y===t.y+dy)))
          .sort((a,b)=>movementHeight(a)-movementHeight(b));
        let best=null;
        for(const edge of edges){
          const path=rampSearch(map,edge,reachable,protectedKeys);
          if(path&&(!best||path.length<best.length))best=path;
        }
        if(!best)continue;
        report.changedTiles+=carveMountainRamp(best,protectedKeys,report.ramps);
        report.ramps++;report.connectedComponents++;connected=true;break;
      }
      if(!connected)break;
    }
    const finalReachable=reachableTiles(map,[],baseInfo.playerCore);
    report.remainingInaccessible=highGroundComponents(map).filter(component=>!component.some(t=>finalReachable.has(key(t.x,t.y)))).length;
    return report;
  }

  function addRocks(map,cfg,rand,protectedKeys){
    const candidates=map.tiles.filter(t=>!protectedKeys.has(key(t.x,t.y))&&!t.river&&t.terrain==="HIGH_GROUND"&&t.waterDepth<=0),objects=[];
    for(let i=0;i<cfg.rocks&&candidates.length;i++){const n=Math.floor(rand()*candidates.length),t=candidates.splice(n,1)[0];objects.push({id:`generated_rock_${i}`,x:t.x,y:t.y,type:"ROCK",environment:"STONE",destructible:true,blocksMovement:true,breaksIntoTerrain:"PLAIN"});}
    return objects;
  }

  function baseArea(map,owner,b){const out=[],left=owner==="PLAYER",core=left?b.playerCore:b.enemyCore;for(let y=b.mid-b.half;y<=b.mid+b.half;y++)for(let i=0;i<b.depth;i++){const x=left?i:map.width-1-i;if(inBounds(map.width,map.height,x,y)&&!(x===core.x&&y===core.y))out.push({x,y});}return out;}

  function movementHeight(tile){if(!tile)return 0;const depth=Math.max(0,Number(tile.waterDepth||0));return depth>0?Number(tile.elevation||0)+depth:Number(tile.elevation||0);}
  function normalPassable(map,objects,from,to){
    if(!to||!TERRAINS[to.terrain]?.passable)return false;
    if(objects.some(o=>!o.destroyed&&o.blocksMovement&&o.x===to.x&&o.y===to.y))return false;
    return Math.abs(movementHeight(to)-movementHeight(from))<=1.0001;
  }
  function hasPath(map,objects,start,goal){
    const q=[start],seen=new Set([key(start.x,start.y)]);
    while(q.length){const p=q.shift();if(p.x===goal.x&&p.y===goal.y)return true;const from=tileAt(map,p.x,p.y);for(const[dx,dy]of DIRS){const x=p.x+dx,y=p.y+dy,k=key(x,y);if(seen.has(k))continue;const to=tileAt(map,x,y);if(!normalPassable(map,objects,from,to))continue;seen.add(k);q.push({x,y});}}
    return false;
  }

  function riverComponentCount(map){
    const riverTiles=(map?.tiles||[]).filter(tile=>tile?.river===true);
    if(!riverTiles.length)return 0;
    const byKey=new Map(riverTiles.map(tile=>[key(tile.x,tile.y),tile]));
    const remaining=new Set(byKey.keys());
    let components=0;
    while(remaining.size){
      components++;
      const first=remaining.values().next().value;
      remaining.delete(first);
      const queue=[byKey.get(first)];
      while(queue.length){
        const tile=queue.shift();
        if(!tile)continue;
        for(const[dx,dy]of DIRS){
          const neighborKey=key(tile.x+dx,tile.y+dy);
          if(!remaining.has(neighborKey))continue;
          remaining.delete(neighborKey);
          queue.push(byKey.get(neighborKey));
        }
      }
    }
    return components;
  }

  function validateBattlefield(map,objects,cores,points,routes,river){
    const p=cores.find(c=>c.owner==="PLAYER"),e=cores.find(c=>c.owner==="ENEMY"),errors=[];
    const riverComponents=riverComponentCount(map);if(riverComponents!==1)errors.push(`RIVER_DISCONNECTED_${riverComponents}`);
    if(!hasPath(map,objects,p,e))errors.push("CORE_TO_CORE");
    for(const point of points){const goal=point.captureTiles?.[0];if(goal&&!hasPath(map,objects,p,goal))errors.push(`PLAYER_TO_${point.id}`);if(goal&&!hasPath(map,objects,e,goal))errors.push(`ENEMY_TO_${point.id}`);}
    routes.forEach((route,i)=>{
      for(let n=1;n<route.length;n++){const a=tileAt(map,route[n-1].x,route[n-1].y),b=tileAt(map,route[n].x,route[n].y);if(!a||!b||Math.abs(movementHeight(a)-movementHeight(b))>1.0001){errors.push(`ROUTE_${i}_CLIMB`);break;}}
      const crossing=river.crossings.find(c=>c.routeIndex===i),ford=crossing&&tileAt(map,crossing.x,crossing.y);if(!ford?.river||!ford?.ford||Number(ford.waterDepth||0)>.6)errors.push(`ROUTE_${i}_FORD`);
    });
    return{ok:errors.length===0,errors};
  }

  function stats(map){const e=map.tiles.map(t=>Number(t.elevation||0));return{minElevation:Math.min(...e),maxElevation:Math.max(...e),waterTiles:map.tiles.filter(t=>t.waterDepth>0).length,riverTiles:map.tiles.filter(t=>t.river).length,fordTiles:map.tiles.filter(t=>t.ford).length,forestTiles:map.tiles.filter(t=>t.terrain==="FOREST").length,highGroundTiles:map.tiles.filter(t=>t.terrain==="HIGH_GROUND").length};}

  function generateVersus({size="MEDIUM",seed=randomSeed(),coreRules={},springMode="RANDOM"}={}){
    const cfg=preset(size),resolvedSeed=Number(seed)>>>0,rand=createRandom(resolvedSeed),map={id:`generated_versus_${cfg.id.toLowerCase()}_${resolvedSeed}`,name:`Generated ${cfg.label}`,width:cfg.width,height:cfg.height,tiles:[],objects:[],generated:true,seed:resolvedSeed,size:cfg.id};
    for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++)map.tiles.push({x,y,terrain:"PLAIN",elevation:0,waterDepth:0,waterSurfaceZ:null});
    applyTerrain(map,elevationField(map.width,map.height,cfg,rand));

    const protectedKeys=new Set(),baseInfo=carveBaseZones(map,protectedKeys),ys=routeYs(map),routes=ys.map((y,i)=>carveStrategicRoute(map,y,i,protectedKeys,rand));
    connectRoutesToBases(map,routes,baseInfo,protectedKeys);
    const capturePoints=createCapturePoints(map,routes,protectedKeys),river=createRiver(map,routes,protectedKeys,rand,{springMode});
    addForests(map,cfg,rand,protectedKeys);
    const mountainAccess=ensureMountainAccessibility(map,protectedKeys,baseInfo);
    const rocks=addRocks(map,cfg,rand,protectedKeys);

    const hp=Math.max(1,Number(coreRules.hp??600)),shield=Math.max(0,Number(coreRules.shield??0)),defense=Math.max(0,Number(coreRules.defense??0));
    const cores=[
      {id:"player_core",name:"我方 Core",owner:"PLAYER",x:baseInfo.playerCore.x,y:baseInfo.playerCore.y,hp,maxHp:hp,shield,maxShield:shield,defense},
      {id:"enemy_core",name:"敵方 Core",owner:"ENEMY",x:baseInfo.enemyCore.x,y:baseInfo.enemyCore.y,hp,maxHp:hp,shield,maxShield:shield,defense}
    ];
    map.objects=[{id:"player_core_object",x:baseInfo.playerCore.x,y:baseInfo.playerCore.y,type:"CORE",environment:"STONE",destructible:false,blocksMovement:true},{id:"enemy_core_object",x:baseInfo.enemyCore.x,y:baseInfo.enemyCore.y,type:"CORE",environment:"STONE",destructible:false,blocksMovement:true},...(river.sourceObjects||[]),...rocks];
    const deploymentPoints=[{id:"player_base",name:"我方本陣",owner:"PLAYER",capturable:false,captureTiles:[],area:baseArea(map,"PLAYER",baseInfo)},...capturePoints,{id:"enemy_base",name:"敵方本陣",owner:"ENEMY",capturable:false,captureTiles:[],area:baseArea(map,"ENEMY",baseInfo)}];

    const validation=validateBattlefield(map,rocks,cores,capturePoints,routes,river);
    if(!validation.ok)throw new Error(`Generated battlefield validation failed: ${validation.errors.join(",")}`);
    const summary=stats(map);
    return{map,cores,deploymentPoints,meta:{generated:true,seed:resolvedSeed,size:cfg.id,label:cfg.label,width:map.width,height:map.height,routes:routes.length,riverCrossings:river.crossings.length,mountainRamps:mountainAccess.ramps,mountainRampTiles:mountainAccess.changedTiles,inaccessibleHighGround:mountainAccess.remainingInaccessible,validation:"PASS",...summary}};
  }

  return Object.freeze({SIZE_PRESETS,preset,randomSeed,generateVersus,validateBattlefield});
})();
globalThis.MapGenerator=MapGenerator;

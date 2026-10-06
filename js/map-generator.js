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
  const SOURCE_GENTLE_REACH=1;
  const SPRING_SOURCE_CHANCE=.50;
  const SPRING_MIN_ELEVATION=2;
  const SPRING_GENTLE_STEP=.025;
  const SPRING_POOL_DEPTH=.16;
  const RIVER_CHANNEL_DEPTH=.22;
  const SPRING_CHANNEL_DEPTH=.16;
  const RIVER_SURFACE_INSET=.035;
  const SOURCE_KIND=Object.freeze({OFF_MAP:"OFF_MAP_SOURCE",SPRING:"SPRING_SOURCE"});
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const inBounds=(w,h,x,y)=>x>=0&&y>=0&&x<w&&y<h;
  const tileAt=(map,x,y)=>map.tiles.find(t=>t.x===x&&t.y===y)||null;

  function hashSeed(seed){let h=2166136261>>>0;for(const ch of String(seed??"CARD_TACTICS")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h||0x6d2b79f5;}
  function createRandom(seed){let a=hashSeed(seed)>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
  function randomSeed(){if(globalThis.crypto?.getRandomValues){const a=new Uint32Array(1);globalThis.crypto.getRandomValues(a);return a[0]>>>0;}return((Date.now()>>>0)^Math.floor(Math.random()*0xffffffff))>>>0;}
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
    delete tile.hydrologySource;delete tile.hydrologyDrain;delete tile.hydrologyChannelBaseElevation;delete tile.hydrologyCascadeToX;delete tile.hydrologyCascadeToY;delete tile.hydrologyCascadeDrop;delete tile.hydrologyAuthoredSource;delete tile.hydrologyChannelNaturalSurface;delete tile.hydrologySourceNaturalElevation;delete tile.hydrologySourceSelectionMaxElevation;delete tile.hydrologySourceSpillSurface;delete tile.hydrologySourceOutletX;delete tile.hydrologySourceOutletY;delete tile.hydrologySpringPoolPlan;delete tile.hydrologySpringBankPlan;delete tile.sourceObjectId;delete tile.sourceKind;delete tile.sourcePool;
  }
  function setWater(tile,{bed=-1,depth=1,river=false,ford=false,flowX=0,flowY=1,flowSpeed=.6,discharge=1}={}){
    if(!tile)return;tile.elevation=Number(bed);tile.terrain="WATER";tile.waterDepth=Math.max(.1,Number(depth));tile.waterSurfaceZ=tile.elevation+tile.waterDepth;tile.dryTerrain="PLAIN";tile.soilMoisture=1;
    if(river){tile.river=true;tile.ford=!!ford;tile.flowX=Number(flowX||0);tile.flowY=Number(flowY||0);tile.baseFlowSpeed=Number(flowSpeed||.6);tile.flowSpeed=tile.baseFlowSpeed;tile.baseDischarge=Number(discharge||1);tile.discharge=tile.baseDischarge;}
  }

  function applyTerrain(map,field){
    // Land generation owns elevation only. Preserve the complete terrain field,
    // including negative valleys and basins, but never turn elevation into water.
    // Initial water must come from the formal Hydrology source/river contract.
    for(const tile of map.tiles){
      const elevation=Number(field[tile.y][tile.x]||0);
      setDry(tile,elevation,elevation>=2?"HIGH_GROUND":"PLAIN");
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
    const sources=rivers.filter(tile=>tile?.hydrologyAuthoredSource===true&&!drainKeys.has(key(tile.x,tile.y)));
    // Source ownership is explicit. Never promote an ordinary river leaf/ford/route
    // into a hydrology source: generated rivers must already have one authored
    // OFF_MAP_SOURCE or SPRING_SOURCE origin.
    if(!sources.length)throw new Error("Generated river is missing its authored hydrology source");

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

    // Strategic roads cross the river at shallow fords. Every edge downstream of a
    // ford is therefore part of the navigable trunk and must remain a gentle reach;
    // otherwise a real terrain cliff farther downstream would lift every upstream
    // ford by the same waterfall drop and make the authored route impassable.
    // Tributaries and the reach upstream of the first ford may still preserve real
    // geological drops as cascades before they join the low-gradient trunk.
    const gentleTrunkEdges=new Set();
    // Only the ford itself is a deliberately shallow / low-gradient crossing.
    // The previous implementation marked the *entire downstream trunk* gentle
    // after every ford. That erased real geological drops farther downstream:
    // a 2-4 level cliff still carried river water but lost its CASCADE metadata,
    // so Babylon correctly had no waterfall to render. Keep the exception local
    // to the crossing edge(s); the rest of the river must follow the terrain.
    for(const tile of rivers){
      if(tile.hydrologyDrain===true)continue;
      const downstream=downstreamByKey.get(key(tile.x,tile.y));
      if(!downstream)continue;
      if(tile.ford===true||downstream.ford===true){
        gentleTrunkEdges.add(`${key(tile.x,tile.y)}>${key(downstream.x,downstream.y)}`);
      }
    }

    // Do not hide a real cliff merely to manufacture a gentle first reach. A
    // source may keep its first edge gentle only when that edge is already a
    // naturally gentle bed transition. If the terrain actually drops by more than
    // the cascade threshold, Hydrology must receive a real authored CASCADE.
    for(const source of sources){
      let cursor=source;
      for(let step=0;step<SOURCE_GENTLE_REACH&&cursor&&cursor.hydrologyDrain!==true;step++){
        const downstream=downstreamByKey.get(key(cursor.x,cursor.y));
        if(!downstream)break;
        const upstreamBase=Number(cursor.hydrologyChannelBaseElevation??cursor.elevation??0);
        const downstreamBase=Number(downstream.hydrologyChannelBaseElevation??downstream.elevation??0);
        if(upstreamBase-downstreamBase<=RIVER_CASCADE_BED_DROP){
          gentleTrunkEdges.add(`${key(cursor.x,cursor.y)}>${key(downstream.x,downstream.y)}`);
        }
        cursor=downstream;
      }
    }

    // Build the authored water profile from the outlet upstream. A SPRING has a
    // real spill elevation supplied by the terrain basin; the whole upstream
    // profile must fit under that head. This prevents later cliffs from lifting a
    // spring pool above its enclosing banks and creating impossible water towers.
    const outletSurface=Math.min(...drains.map(tile=>Number(tile.waterSurfaceZ??0)));
    const requestedCascadeByEdge=new Map(),riseByEdge=new Map();
    for(const tile of rivers){
      if(tile.hydrologyDrain===true)continue;
      const downstream=downstreamByKey.get(key(tile.x,tile.y));if(!downstream)continue;
      const edgeId=`${key(tile.x,tile.y)}>${key(downstream.x,downstream.y)}`;
      const upstreamBase=Number(tile.hydrologyChannelBaseElevation??tile.elevation??0);
      const downstreamBase=Number(downstream.hydrologyChannelBaseElevation??downstream.elevation??0);
      const bedDrop=upstreamBase-downstreamBase;
      riseByEdge.set(edgeId,RIVER_GENTLE_STEP);
      requestedCascadeByEdge.set(edgeId,!gentleTrunkEdges.has(edgeId)&&bedDrop>RIVER_CASCADE_BED_DROP?bedDrop:0);
    }

    const allowedCascadeByEdge=new Map(requestedCascadeByEdge);
    for(const source of sources.filter(tile=>tile.sourceKind===SOURCE_KIND.SPRING)){
      const cap=Number(source.hydrologySourceSpillSurface);
      if(!Number.isFinite(cap))continue;
      const pathEdges=[];let cursor=source,guard=0;
      while(cursor&&cursor.hydrologyDrain!==true&&guard++<=rivers.length){
        const downstream=downstreamByKey.get(key(cursor.x,cursor.y));if(!downstream)break;
        pathEdges.push(`${key(cursor.x,cursor.y)}>${key(downstream.x,downstream.y)}`);cursor=downstream;
      }
      if(!pathEdges.length)continue;
      const availableHead=Math.max(0,cap-outletSurface);
      const gentlePerEdge=Math.min(SPRING_GENTLE_STEP,availableHead/pathEdges.length);
      for(const edgeId of pathEdges)riseByEdge.set(edgeId,gentlePerEdge);
      let cascadeBudget=Math.max(0,availableHead-gentlePerEdge*pathEdges.length);
      const requestedTotal=pathEdges.reduce((sum,edgeId)=>sum+Math.max(0,Number(requestedCascadeByEdge.get(edgeId)||0)),0);
      const scale=requestedTotal>0?Math.min(1,cascadeBudget/requestedTotal):0;
      for(const edgeId of pathEdges){
        const requested=Math.max(0,Number(requestedCascadeByEdge.get(edgeId)||0));
        allowedCascadeByEdge.set(edgeId,requested*scale);
      }
    }

    const surfaceByKey=new Map(drains.map(tile=>[key(tile.x,tile.y),outletSurface]));
    const cascades=[];
    const ordered=[...rivers].sort((a,b)=>Number(distance.get(key(a.x,a.y))||0)-Number(distance.get(key(b.x,b.y))||0)||a.y-b.y||a.x-b.x);

    for(const tile of ordered){
      const k=key(tile.x,tile.y);
      if(tile.hydrologyDrain===true){
        const depth=tile.ford===true?.35:Math.max(.75,Math.min(2,Number(tile.waterDepth||1)));
        tile.waterDepth=depth;tile.elevation=outletSurface-depth;tile.waterSurfaceZ=outletSurface;
        tile.flowX=0;tile.flowY=0;
        delete tile.hydrologyCascadeToX;delete tile.hydrologyCascadeToY;delete tile.hydrologyCascadeDrop;
        continue;
      }
      const downstream=downstreamByKey.get(k);if(!downstream)continue;
      const dk=key(downstream.x,downstream.y),edgeId=`${k}>${dk}`;
      const downstreamSurface=Number(surfaceByKey.get(dk)??outletSurface);
      const rise=Math.max(0,Number(riseByEdge.get(edgeId)??RIVER_GENTLE_STEP));
      const authoredDrop=Math.max(0,Number(allowedCascadeByEdge.get(edgeId)||0));
      const cascadeDrop=authoredDrop>=.18?authoredDrop:0;
      const surface=downstreamSurface+rise+cascadeDrop;
      surfaceByKey.set(k,surface);

      const depth=tile.ford===true?.35:tile.sourceKind===SOURCE_KIND.SPRING?SPRING_POOL_DEPTH:Math.max(.75,Math.min(2,Number(tile.waterDepth||1)));
      tile.waterDepth=depth;
      tile.elevation=surface-depth;
      tile.waterSurfaceZ=surface;
      tile.flowX=Math.sign(downstream.x-tile.x);
      tile.flowY=Math.sign(downstream.y-tile.y);

      if(cascadeDrop>0){
        tile.hydrologyCascadeToX=downstream.x;
        tile.hydrologyCascadeToY=downstream.y;
        tile.hydrologyCascadeDrop=cascadeDrop;
        cascades.push({x:tile.x,y:tile.y,toX:downstream.x,toY:downstream.y,drop:cascadeDrop});
      }else{
        delete tile.hydrologyCascadeToX;delete tile.hydrologyCascadeToY;delete tile.hydrologyCascadeDrop;
      }
    }

    // The profile is fully authored here because only the map generator still knows
    // the terrain before the channel was carved. Hydrology's existing preserve flag
    // keeps this topology while still owning discharge, capacity, flooding and flow.
    map.hydrology={...(map.hydrology||{}),preserveRiverProfile:true,generatedRiverProfile:true};
    map.generatedRiverProfile={
      sources:sources.map(tile=>({x:tile.x,y:tile.y,kind:tile.sourceKind||SOURCE_KIND.OFF_MAP,active:true,naturalElevation:Number(tile.hydrologySourceNaturalElevation??0),objectId:tile.sourceObjectId||null})),
      drains:drains.map(tile=>({x:tile.x,y:tile.y})),
      cascades
    };
    return map.generatedRiverProfile;
  }

  // Generation-time finalization only. MapGenerator still owns the initial world
  // until generateVersus() returns; runtime Hydrology has not started yet. This
  // pass settles generated river/source-pool surfaces against real dry banks,
  // preserves a non-uphill downstream profile, keeps authored strategic crossings
  // traversable, and refreshes cascade drops after mountain-access carving. It is
  // not a second runtime Hydrology authority; it finalizes the initial conditions
  // that Hydrology receives.
  function settleGeneratedWaterBanks(map,routes=[]){
    const tiles=map?.tiles||[],by=new Map(tiles.map(tile=>[key(tile.x,tile.y),tile]));
    const EPS=.0001,MAX_ROUTE_STEP=1.0001;
    const generated=tile=>!!tile&&Number(tile.waterDepth||0)>0&&(tile.river===true||tile.sourcePool===true);
    const surface=tile=>tile?.waterSurfaceZ==null?Number(tile?.elevation||0)+Number(tile?.waterDepth||0):Number(tile.waterSurfaceZ);
    const movement=tile=>Number(tile?.waterDepth||0)>0?surface(tile):Number(tile?.elevation||0);
    const touchedRouteTiles=new Set();
    const lowerWater=(tile,next)=>{
      if(!generated(tile)||!Number.isFinite(Number(next))||Number(next)>=surface(tile)-EPS)return false;
      const depth=Math.max(.1,Number(tile.waterDepth||0));
      tile.waterSurfaceZ=Number(next);tile.elevation=Number(next)-depth;
      return true;
    };
    const lowerRouteGround=(tile,next)=>{
      if(!tile||Number(tile.waterDepth||0)>EPS||tile.river===true||tile.terrain==="WALL"||!Number.isFinite(Number(next)))return false;
      const target=Math.min(Number(tile.elevation||0),Number(next));
      if(Number(tile.elevation||0)-target<=EPS)return false;
      tile.elevation=target;tile.terrain="PLAIN";touchedRouteTiles.add(key(tile.x,tile.y));
      return true;
    };
    const lowerRouteHighSide=(high,lowHeight)=>{
      // Grade to an exact one-level step, leaving the .0001 passability epsilon as
      // numerical tolerance instead of consuming it in authored geometry.
      const target=Number(lowHeight)+1;
      if(generated(high))return lowerWater(high,target);
      return lowerRouteGround(high,target);
    };

    let changed=true,passes=0;
    while(changed&&passes++<Math.max(1,tiles.length)){
      changed=false;

      // A generated waterline cannot stand above an adjacent dry bank. Natural
      // pre-existing lakes are not rewritten here; only authored river/sourcePool
      // cells belong to this generation finalizer.
      for(const tile of tiles){
        if(!generated(tile))continue;let cap=Infinity;
        for(const[dx,dy]of DIRS){
          const neighbor=by.get(key(tile.x+dx,tile.y+dy));
          if(!neighbor||neighbor.terrain==="WALL"||Number(neighbor.waterDepth||0)>0)continue;
          // A lower tile across a real terrain cliff is not this water cell's
          // containing bank. Treating the cliff foot as a bank used to pull the
          // upper river surface down to the lower plateau, erasing the authored
          // head/drop and therefore the waterfall. Only same-level / traversable
          // dry neighbours can cap the local waterline.
          const channelBase=Number(tile.hydrologyChannelBaseElevation??tile.elevation??0);
          const neighborElevation=Number(neighbor.elevation||0);
          if(channelBase-neighborElevation>MAX_ROUTE_STEP)continue;
          cap=Math.min(cap,neighborElevation);
        }
        if(Number.isFinite(cap)&&lowerWater(tile,cap))changed=true;
      }

      // Routed river free surface is monotone downstream. This only lowers the
      // downstream generated cell; it never fabricates flow or touches dry terrain.
      for(const tile of tiles){
        if(tile?.river!==true)continue;
        const dx=Math.sign(Number(tile.flowX||0)),dy=Math.sign(Number(tile.flowY||0));
        if(!dx&&!dy)continue;
        const downstream=by.get(key(tile.x+dx,tile.y+dy));
        if(!generated(downstream))continue;
        if(surface(downstream)>surface(tile)+EPS&&lowerWater(downstream,surface(tile)))changed=true;
      }

      // Strategic routes are authored passable corridors. River routing can turn
      // more than one consecutive route tile into shallow ford water; those wet-wet
      // edges must be graded too, not only dry approaches. Always lower the higher
      // side, so this cannot create a new bank overtop or an uphill river.
      for(const route of routes||[]){
        for(let i=1;i<route.length;i++){
          const a=by.get(key(route[i-1].x,route[i-1].y)),b=by.get(key(route[i].x,route[i].y));
          if(!a||!b)continue;
          const ah=movement(a),bh=movement(b);
          if(ah>bh+MAX_ROUTE_STEP&&lowerRouteHighSide(a,bh)){changed=true;if(Number(a.waterDepth||0)<=EPS)touchedRouteTiles.add(key(a.x,a.y));}
          else if(bh>ah+MAX_ROUTE_STEP&&lowerRouteHighSide(b,ah)){changed=true;if(Number(b.waterDepth||0)<=EPS)touchedRouteTiles.add(key(b.x,b.y));}
        }
      }
    }

    const cascades=[];
    for(const tile of tiles){
      if(tile?.river!==true)continue;
      const tx=Number(tile.hydrologyCascadeToX),ty=Number(tile.hydrologyCascadeToY);
      if(!Number.isFinite(tx)||!Number.isFinite(ty))continue;
      const downstream=by.get(key(tx,ty));if(!downstream)continue;
      const drop=surface(tile)-surface(downstream);
      if(drop>=.18){tile.hydrologyCascadeDrop=drop;cascades.push({x:tile.x,y:tile.y,toX:downstream.x,toY:downstream.y,drop});}
      else{delete tile.hydrologyCascadeToX;delete tile.hydrologyCascadeToY;delete tile.hydrologyCascadeDrop;}
    }
    if(map.generatedRiverProfile)map.generatedRiverProfile.cascades=cascades;
    return{passes:Math.max(0,passes-1),routeGradeTiles:touchedRouteTiles.size,cascades:cascades.length};
  }


  function createRiver(map,routes,protectedKeys,rand){
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

    function nearestOpenX(targetX,y,fromX=targetX){
      const minX=2,maxX=map.width-3;
      const candidates=[];
      for(let x=minX;x<=maxX;x++){
        const tile=getTile(x,y);
        if(!tile||tile.captureZone===true)continue;
        candidates.push({x,score:Math.abs(x-targetX)*4+Math.abs(x-fromX)});
      }
      candidates.sort((a,b)=>a.score-b.score||a.x-b.x);
      return candidates[0]?.x??clamp(targetX,minX,maxX);
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

    function sourcePoolCandidate(tile){
      return !!tile&&tile.captureZone!==true&&tile.terrain!=="WALL"&&Number(tile.waterDepth||0)<=0;
    }

    function chooseOffMapSource(){
      const y=0,candidates=[];
      for(let x=3;x<=map.width-4;x++){
        const tile=getTile(x,y);if(!tile||tile.captureZone===true)continue;
        candidates.push({tile,score:Math.abs(x-xBase)+rand()*.35});
      }
      candidates.sort((a,b)=>a.score-b.score||a.tile.x-b.tile.x);
      return candidates[0]?.tile||getTile(clamp(xBase,2,map.width-3),0)||null;
    }

    function chooseSpringSource(){
      // An on-map spring must begin on the actual highest terrain band. It is a
      // narrow headwater, not an artificial pool: no rim search, no basin carving,
      // no raised water plane. Prefer the uppermost candidate among equal maxima so
      // the existing downstream strategic layout remains useful.
      const candidates=[];
      for(let y=1;y<=map.height-2;y++)for(let x=2;x<=map.width-3;x++){
        const tile=getTile(x,y);if(!sourcePoolCandidate(tile)||protectedKeys.has(key(x,y)))continue;
        const elevation=Number(tile.elevation||0);if(elevation<SPRING_MIN_ELEVATION)continue;
        candidates.push(tile);
      }
      if(!candidates.length)return null;
      const maxElevation=Math.max(...candidates.map(tile=>Number(tile.elevation||0)));
      const highest=candidates.filter(tile=>Math.abs(Number(tile.elevation||0)-maxElevation)<=.0001);
      highest.sort((a,b)=>a.y-b.y||Math.abs(a.x-xBase)-Math.abs(b.x-xBase)||a.x-b.x);
      const shortlist=highest.slice(0,Math.min(6,highest.length));
      const tile=shortlist[Math.floor(rand()*shortlist.length)]||highest[0];
      return tile?{tile,maxElevation}:null;
    }

    function buildSpringSource(profile,sourceObjects){
      for(const ref of profile?.sources||[]){
        if(ref.kind!==SOURCE_KIND.SPRING)continue;
        const source=getTile(ref.x,ref.y);if(!source)continue;
        protectedKeys.add(key(source.x,source.y));
        const objectId=`spring_source_${source.x}_${source.y}`;
        source.sourceObjectId=objectId;ref.objectId=objectId;
        sourceObjects.push({id:objectId,type:"SPRING",x:source.x,y:source.y,sourceKind:SOURCE_KIND.SPRING,hydrologySourceX:source.x,hydrologySourceY:source.y,floatOnWater:true,destructible:true,blocksMovement:false});
      }
    }

    function placeRiverTile(tx,ty){
      const tile=getTile(tx,ty);
      if(!tile||tile.captureZone===true)return null;

      const originalElevation=Number(tile.elevation||0);
      const existingDepth=Math.max(0,Number(tile.waterDepth||0));
      const existingSurface=existingDepth>0
        ?Number(tile.waterSurfaceZ??(originalElevation+existingDepth))
        :null;
      if(!Number.isFinite(Number(tile.hydrologyChannelBaseElevation)))tile.hydrologyChannelBaseElevation=originalElevation;
      if(!Number.isFinite(Number(tile.hydrologyChannelNaturalSurface))){
        tile.hydrologyChannelNaturalSurface=existingSurface==null?originalElevation-RIVER_SURFACE_INSET:existingSurface;
      }

      const routeIndex=typeof tile.routeId==="string"?Number(tile.routeId.split("_")[1]):null;
      const isRoute=Number.isInteger(routeIndex);
      const depth=isRoute?.35:RIVER_CHANNEL_DEPTH;
      const surface=Number(tile.hydrologyChannelNaturalSurface);
      setWater(tile,{
        bed:surface-depth,
        depth,
        river:true,
        ford:isRoute,
        flowX:0,
        flowY:1,
        flowSpeed:isRoute?.45:.62,
        discharge:isRoute?.8:1
      });
      tile.hydrologyChannelNaturalSurface=surface;
      tile.hydrologyChannelBaseElevation=originalElevation;

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

    // One canonical river-source contract supports two authored origins. An
    // OFF_MAP source enters at the battlefield boundary; a SPRING source begins at
    // a visible highland depression inside the map. Both feed the same Hydrology
    // graph and the same downstream river profile.
    const requestedKind=rand()<SPRING_SOURCE_CHANCE?SOURCE_KIND.SPRING:SOURCE_KIND.OFF_MAP;
    const springPlan=requestedKind===SOURCE_KIND.SPRING?chooseSpringSource():null;
    const sourceKind=springPlan?SOURCE_KIND.SPRING:SOURCE_KIND.OFF_MAP;
    const sourceSeed=springPlan?.tile||chooseOffMapSource();
    if(!sourceSeed)throw new Error("River source generation failed");
    const sourceNaturalElevation=Number(sourceSeed.elevation||0);
    let targetX=sourceSeed.x,last={x:sourceSeed.x,y:sourceSeed.y};
    const authoredSource=placeRiverTile(last.x,last.y);
    if(authoredSource){
      authoredSource.hydrologyAuthoredSource=true;authoredSource.hydrologySourceActive=true;
      authoredSource.sourceKind=sourceKind;authoredSource.hydrologySourceNaturalElevation=sourceNaturalElevation;
      if(sourceKind===SOURCE_KIND.SPRING)authoredSource.hydrologySourceSelectionMaxElevation=Number(springPlan?.maxElevation??sourceNaturalElevation);
    }
    for(let y=sourceSeed.y+1;y<map.height;y++){
      if(rand()<.28)targetX=clamp(targetX+(rand()<.5?-1:1),3,map.width-4);
      const resolvedX=nearestOpenX(targetX,y,last?.x??targetX);
      const target={x:resolvedX,y};
      const path=cardinalPath(last,target);
      if(!path.length)throw new Error(`River routing failed at ${last.x},${last.y} -> ${target.x},${target.y}`);
      last=layPath(path.slice(1))||last;
    }

    // A ford only exists where the authored river actually reaches a strategic
    // route. For an on-map spring, routes entirely upstream of the spring remain
    // dry; drawing a connector back uphill would create a fake tributary around
    // the spring basin and can leave isolated square "walls" in the water.
    routes.forEach((route,index)=>{
      if(routeCrossings.has(index))return;
      if(sourceKind===SOURCE_KIND.SPRING&&Number(routeYAtX(route,sourceSeed.x))<Number(sourceSeed.y))return;
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

    const profile=finalizeGeneratedRiverProfile(map),sourceObjects=[];
    buildSpringSource(profile,sourceObjects);
    return{tiles:river,crossings:[...routeCrossings.entries()].map(([routeIndex,p])=>({routeIndex,...p})),profile,objects:sourceObjects,sourceKind};
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
        const dryReachable=reachable.has(k)&&n.river!==true&&Number(n.waterDepth||0)<=0;
        if(dryReachable&&path.length-1>=Math.max(1,Math.ceil(Math.max(0,startHeight-movementHeight(n)))))return path;
        if(n.river||Number(n.waterDepth||0)>0||n.captureZone||protectedKeys.has(k))continue;
        const wetSides=DIRS.reduce((count,[sx,sy])=>count+(Number(tileAt(map,n.x+sx,n.y+sy)?.waterDepth||0)>0?1:0),0);
        if(wetSides>=3)continue;
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
        const changedTiles=carveMountainRamp(best,protectedKeys,report.ramps);
        if(changedTiles<=0)continue;
        report.changedTiles+=changedTiles;
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

  function validateBattlefield(map,objects,cores,points,routes,river,protectedKeys=new Set()){
    const p=cores.find(c=>c.owner==="PLAYER"),e=cores.find(c=>c.owner==="ENEMY"),errors=[];
    const riverComponents=riverComponentCount(map);if(riverComponents!==1)errors.push(`RIVER_DISCONNECTED_${riverComponents}`);
    if(!hasPath(map,objects,p,e))errors.push("CORE_TO_CORE");
    for(const point of points){
      const goals=(point.captureTiles||[]).filter(Boolean);
      if(goals.length&&!goals.some(goal=>hasPath(map,objects,p,goal)))errors.push(`PLAYER_TO_${point.id}`);
      if(goals.length&&!goals.some(goal=>hasPath(map,objects,e,goal)))errors.push(`ENEMY_TO_${point.id}`);
    }
    routes.forEach((route,i)=>{
      for(let n=1;n<route.length;n++){const a=tileAt(map,route[n-1].x,route[n-1].y),b=tileAt(map,route[n].x,route[n].y);if(!a||!b||Math.abs(movementHeight(a)-movementHeight(b))>1.0001){errors.push(`ROUTE_${i}_CLIMB`);break;}}
      const springSource=(map?.tiles||[]).find(tile=>tile?.hydrologySource===true&&tile?.sourceKind===SOURCE_KIND.SPRING);
      const routeDownstream=!springSource||Number(routeYAtX(route,springSource.x))>=Number(springSource.y);
      const crossing=river.crossings.find(c=>c.routeIndex===i),ford=crossing&&tileAt(map,crossing.x,crossing.y);
      if(routeDownstream&&(!ford?.river||!ford?.ford||Number(ford.waterDepth||0)>.6))errors.push(`ROUTE_${i}_FORD`);
    });

    // Generated water must already be physically consistent before the battle
    // starts. Do not leave an impossible profile for WaterRenderer to disguise.
    const by=new Map((map?.tiles||[]).map(tile=>[key(tile.x,tile.y),tile]));
    let bankOvertop=0,uphillFlow=0;
    for(const tile of map?.tiles||[]){
      const depth=Math.max(0,Number(tile.waterDepth||0));
      if(depth<=0)continue;
      const surface=Number(tile.waterSurfaceZ??(Number(tile.elevation||0)+depth));
      for(const[dx,dy]of DIRS){
        const neighbor=by.get(key(tile.x+dx,tile.y+dy));
        if(!neighbor||neighbor.terrain==="WALL")continue;
        const neighborDepth=Math.max(0,Number(neighbor.waterDepth||0));
        if(neighborDepth<=0){
          const channelBase=Number(tile.hydrologyChannelBaseElevation??tile.elevation??0);
          const neighborElevation=Number(neighbor.elevation||0);
          const cliffFoot=channelBase-neighborElevation>1.0001;
          if(!cliffFoot&&surface>neighborElevation+.0001)bankOvertop++;
        }
      }
      if(tile.river===true&&(Number(tile.flowX||0)||Number(tile.flowY||0))){
        const downstream=by.get(key(tile.x+Math.sign(Number(tile.flowX||0)),tile.y+Math.sign(Number(tile.flowY||0))));
        if(downstream&&Number(downstream.waterDepth||0)>0){
          const downstreamSurface=Number(downstream.waterSurfaceZ??(Number(downstream.elevation||0)+Number(downstream.waterDepth||0)));
          if(downstreamSurface>surface+.0001)uphillFlow++;
        }
      }
    }
    if(bankOvertop)errors.push(`WATER_BANK_OVERTOP_${bankOvertop}`);
    if(uphillFlow)errors.push(`RIVER_UPHILL_FLOW_${uphillFlow}`);
    // Source contracts are explicit: off-map inflow must enter on the boundary;
    // on-map springs must remain visible, destructible highland basins. Every
    // spring waterline must stay below every dry rim side except its one carved outlet.
    let sourceDefinitionFailures=0;
    for(const source of (map?.tiles||[]).filter(tile=>tile?.hydrologySource===true)){
      const kind=source.sourceKind||SOURCE_KIND.OFF_MAP;
      const boundary=source.x===0||source.y===0||source.x===map.width-1||source.y===map.height-1;
      if(kind===SOURCE_KIND.OFF_MAP){
        if(!boundary)sourceDefinitionFailures++;
      }else if(kind===SOURCE_KIND.SPRING){
        const springObject=(map.objects||[]).find(object=>object?.type==="SPRING"&&object.id===source.sourceObjectId);
        const originalFloor=Number(source.hydrologySourceNaturalElevation||0);
        const selectionMax=Number(source.hydrologySourceSelectionMaxElevation??originalFloor);
        if(boundary||originalFloor<SPRING_MIN_ELEVATION||!springObject||originalFloor<selectionMax-.0001)sourceDefinitionFailures++;
      }else sourceDefinitionFailures++;
    }
    if(sourceDefinitionFailures)errors.push(`RIVER_SOURCE_DEFINITION_${sourceDefinitionFailures}`);

    // Land-first invariant: the generated battlefield begins with water only on
    // the authored source-fed river network. A low elevation or closed depression
    // is terrain geometry, never an implicit water source. Rain/flood/cards may
    // fill those basins later through HydrologyEngine.
    const unownedInitialWater=(map?.tiles||[]).filter(tile=>Number(tile?.waterDepth||0)>0&&tile?.river!==true);
    if(unownedInitialWater.length)errors.push(`UNOWNED_INITIAL_WATER_${unownedInitialWater.length}`);
    return{ok:errors.length===0,errors};
  }

  function stats(map){const e=map.tiles.map(t=>Number(t.elevation||0));return{minElevation:Math.min(...e),maxElevation:Math.max(...e),waterTiles:map.tiles.filter(t=>t.waterDepth>0).length,riverTiles:map.tiles.filter(t=>t.river).length,fordTiles:map.tiles.filter(t=>t.ford).length,forestTiles:map.tiles.filter(t=>t.terrain==="FOREST").length,highGroundTiles:map.tiles.filter(t=>t.terrain==="HIGH_GROUND").length};}

  function generateVersus({size="MEDIUM",seed=randomSeed(),coreRules={}}={}){
    const cfg=preset(size),resolvedSeed=Number(seed)>>>0,rand=createRandom(resolvedSeed),map={id:`generated_versus_${cfg.id.toLowerCase()}_${resolvedSeed}`,name:`Generated ${cfg.label}`,width:cfg.width,height:cfg.height,tiles:[],objects:[],generated:true,seed:resolvedSeed,size:cfg.id};
    for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++)map.tiles.push({x,y,terrain:"PLAIN",elevation:0,waterDepth:0,waterSurfaceZ:null});
    applyTerrain(map,elevationField(map.width,map.height,cfg,rand));

    const protectedKeys=new Set(),baseInfo=carveBaseZones(map,protectedKeys),ys=routeYs(map),routes=ys.map((y,i)=>carveStrategicRoute(map,y,i,protectedKeys,rand));
    connectRoutesToBases(map,routes,baseInfo,protectedKeys);
    // Finalize all gameplay land geometry before authoring generated water.
    // Hydrology seeding must read the terrain that will actually ship into battle;
    // mountain-access carving after river authoring used to invalidate source heads,
    // routed drops and CASCADE edges. Negative terrain remains dry land here; river
    // and optional natural-basin water are added only after the land is final.
    const capturePoints=createCapturePoints(map,routes,protectedKeys);
    addForests(map,cfg,rand,protectedKeys);
    const mountainAccess=ensureMountainAccessibility(map,protectedKeys,baseInfo);
    const river=createRiver(map,routes,protectedKeys,rand);
    const waterSettlement=settleGeneratedWaterBanks(map,routes);
    const rocks=addRocks(map,cfg,rand,protectedKeys);

    const hp=Math.max(1,Number(coreRules.hp??600)),shield=Math.max(0,Number(coreRules.shield??0)),defense=Math.max(0,Number(coreRules.defense??0));
    const cores=[
      {id:"player_core",name:"我方 Core",owner:"PLAYER",x:baseInfo.playerCore.x,y:baseInfo.playerCore.y,hp,maxHp:hp,shield,maxShield:shield,defense},
      {id:"enemy_core",name:"敵方 Core",owner:"ENEMY",x:baseInfo.enemyCore.x,y:baseInfo.enemyCore.y,hp,maxHp:hp,shield,maxShield:shield,defense}
    ];
    map.objects=[{id:"player_core_object",x:baseInfo.playerCore.x,y:baseInfo.playerCore.y,type:"CORE",environment:"STONE",destructible:false,blocksMovement:true},{id:"enemy_core_object",x:baseInfo.enemyCore.x,y:baseInfo.enemyCore.y,type:"CORE",environment:"STONE",destructible:false,blocksMovement:true},...(river.objects||[]),...rocks];
    const deploymentPoints=[{id:"player_base",name:"我方本陣",owner:"PLAYER",capturable:false,captureTiles:[],area:baseArea(map,"PLAYER",baseInfo)},...capturePoints,{id:"enemy_base",name:"敵方本陣",owner:"ENEMY",capturable:false,captureTiles:[],area:baseArea(map,"ENEMY",baseInfo)}];

    const validation=validateBattlefield(map,rocks,cores,capturePoints,routes,river,protectedKeys);
    if(!validation.ok)throw new Error(`Generated battlefield validation failed: ${validation.errors.join(",")}`);
    const summary=stats(map);
    return{map,cores,deploymentPoints,meta:{generated:true,seed:resolvedSeed,size:cfg.id,label:cfg.label,width:map.width,height:map.height,routes:routes.length,riverCrossings:river.crossings.length,riverSourceKind:river.sourceKind,mountainRamps:mountainAccess.ramps,mountainRampTiles:mountainAccess.changedTiles,inaccessibleHighGround:mountainAccess.remainingInaccessible,routeGradeTiles:waterSettlement.routeGradeTiles,waterSettlementPasses:waterSettlement.passes,validation:"PASS",...summary}};
  }

  return Object.freeze({SIZE_PRESETS,SOURCE_KIND,preset,randomSeed,generateVersus,validateBattlefield});
})();
globalThis.MapGenerator=MapGenerator;

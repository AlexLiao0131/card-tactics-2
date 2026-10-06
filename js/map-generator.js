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

    // Land-first generation: the procedural noise describes terrain shape only.
    // Normalize the complete field into the playable dry-land elevation range
    // instead of using negative values as hidden "future water". This preserves
    // valleys/ridges without either flattening every low tile to H0 or exposing
    // the old below-water pits as giant dry holes.
    const shaped=f.map(row=>row.map(v=>v*2.15+.65));
    const values=shaped.flat(),min=Math.min(...values),max=Math.max(...values),span=Math.max(.0001,max-min);
    return shaped.map(row=>row.map(value=>{
      const t=(value-min)/span;
      // Slight lowland bias keeps broad valleys while retaining mountain relief.
      const eased=Math.pow(clamp(t,0,1),1.08);
      return clamp(Math.round(eased*Number(cfg.maxElevation||4)),0,Number(cfg.maxElevation||4));
    }));
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
    // Terrain phase owns terrain only. Every tile is dry here; water is introduced
    // later exclusively by an OFF_MAP_SOURCE or a destructible SPRING_SOURCE.
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
    const sources=rivers.filter(tile=>tile?.hydrologyAuthoredSource===true);
    const drains=rivers.filter(tile=>tile?.hydrologyDrain===true);

    if(sources.length!==1)throw new Error(`Generated river source count invalid: ${sources.length}`);
    if(drains.length<1)throw new Error("Generated river is missing its drain");

    for(const tile of rivers){
      tile.hydrologySource=tile.hydrologyAuthoredSource===true;
      if(tile.hydrologyDrain!==true)tile.hydrologyDrain=false;
      delete tile.hydrologyCascadeToX;delete tile.hydrologyCascadeToY;delete tile.hydrologyCascadeDrop;
    }

    // The terrain-driven route already owns downstream direction. Do not rebuild
    // the river from graph distance or rewrite its water surface after the land has
    // been finalized. A waterfall exists only where that routed edge crosses a real
    // >1-level terrain drop and the free-water surface also has usable head.
    const cascades=[];
    for(const tile of rivers){
      if(tile.hydrologyDrain===true)continue;
      const dx=Math.sign(Number(tile.flowX||0)),dy=Math.sign(Number(tile.flowY||0));
      if(!dx&&!dy)continue;
      const downstream=by.get(key(tile.x+dx,tile.y+dy));
      if(!downstream)continue;

      const highBed=Number(tile.hydrologyChannelBaseElevation??tile.elevation??0);
      const lowBed=Number(downstream.hydrologyChannelBaseElevation??downstream.elevation??0);
      const highSurface=Number(tile.waterSurfaceZ??(Number(tile.elevation||0)+Number(tile.waterDepth||0)));
      const lowSurface=Number(downstream.waterSurfaceZ??(Number(downstream.elevation||0)+Number(downstream.waterDepth||0)));
      const bedDrop=highBed-lowBed;
      const surfaceDrop=highSurface-lowSurface;

      if(bedDrop>RIVER_CASCADE_BED_DROP&&surfaceDrop>=.18){
        tile.hydrologyCascadeToX=downstream.x;
        tile.hydrologyCascadeToY=downstream.y;
        tile.hydrologyCascadeDrop=surfaceDrop;
        cascades.push({x:tile.x,y:tile.y,toX:downstream.x,toY:downstream.y,drop:surfaceDrop});
      }
    }

    map.hydrology={...(map.hydrology||{}),preserveRiverProfile:true,generatedRiverProfile:true};
    map.generatedRiverProfile={
      sources:sources.map(tile=>({
        x:tile.x,y:tile.y,kind:tile.sourceKind||SOURCE_KIND.OFF_MAP,active:true,
        naturalElevation:Number(tile.hydrologySourceNaturalElevation??tile.hydrologyChannelBaseElevation??tile.elevation??0),
        objectId:tile.sourceObjectId||null
      })),
      drains:drains.map(tile=>({x:tile.x,y:tile.y})),
      cascades
    };
    return map.generatedRiverProfile;
  }

  function createRiver(map,routes,protectedKeys,rand){
    const river=[],riverKeys=new Set(),routeCrossings=new Map(),sourceObjects=[];
    const tileMap=new Map(map.tiles.map(tile=>[key(tile.x,tile.y),tile]));
    const getTile=(x,y)=>tileMap.get(key(x,y))||null;
    const elevationOf=tile=>Number(tile?.elevation||0);
    const canRoute=tile=>!!tile&&tile.captureZone!==true&&tile.terrain!=="WALL";

    // Compute one canonical drainage field from the finalized dry land toward the
    // bottom map edge. Each tile stores the lowest spill elevation required to
    // reach an outlet and a parent tile that points downstream. This is generation
    // planning only; runtime water remains owned by HydrologyEngine.
    function buildDrainageField(){
      const records=new Map(),open=[],visited=new Set();
      const better=(a,b)=>{
        if(!b)return true;
        if(a.spill<b.spill-.0001)return true;
        if(a.spill>b.spill+.0001)return false;
        if(a.uphill<b.uphill-.0001)return true;
        if(a.uphill>b.uphill+.0001)return false;
        return a.steps<b.steps;
      };
      for(let x=2;x<=map.width-3;x++){
        const tile=getTile(x,map.height-1);
        if(!canRoute(tile))continue;
        const rec={spill:elevationOf(tile),uphill:0,steps:0,parent:null};
        records.set(key(tile.x,tile.y),rec);open.push(tile);
      }
      while(open.length){
        open.sort((a,b)=>{
          const ra=records.get(key(a.x,a.y)),rb=records.get(key(b.x,b.y));
          return ra.spill-rb.spill||ra.uphill-rb.uphill||ra.steps-rb.steps||a.y-b.y||a.x-b.x;
        });
        const current=open.shift(),ck=key(current.x,current.y);
        if(visited.has(ck))continue;
        visited.add(ck);
        const cr=records.get(ck);
        for(const[dx,dy]of DIRS){
          const next=getTile(current.x+dx,current.y+dy);
          if(!canRoute(next))continue;
          // Keep generated river inside the playable interior except for the top
          // source row and bottom drain row.
          if(next.x<2||next.x>map.width-3)continue;
          const nk=key(next.x,next.y);
          const stepUphill=Math.max(0,elevationOf(current)-elevationOf(next));
          const candidate={
            spill:Math.max(elevationOf(next),Number(cr.spill)),
            uphill:Number(cr.uphill)+stepUphill,
            steps:Number(cr.steps)+1,
            parent:current
          };
          if(!better(candidate,records.get(nk)))continue;
          records.set(nk,candidate);open.push(next);
        }
      }
      return records;
    }

    const drainage=buildDrainageField();

    function sourcePoolCandidate(tile){
      return !!tile&&canRoute(tile)&&Number(tile.waterDepth||0)<=0&&drainage.has(key(tile.x,tile.y));
    }

    function chooseOffMapSource(){
      const y=0,candidates=[];
      for(let x=3;x<=map.width-4;x++){
        const tile=getTile(x,y);if(!sourcePoolCandidate(tile))continue;
        const rec=drainage.get(key(x,y));
        const requiredHead=Math.max(0,Number(rec.spill)-elevationOf(tile));
        candidates.push({tile,score:requiredHead*12+Number(rec.uphill)*2+Number(rec.steps)*.03+rand()*.25});
      }
      candidates.sort((a,b)=>a.score-b.score||a.tile.x-b.tile.x);
      return candidates[0]?.tile||null;
    }

    function chooseSpringSource(){
      const candidates=[];
      for(let y=1;y<=map.height-2;y++)for(let x=2;x<=map.width-3;x++){
        const tile=getTile(x,y);
        if(!sourcePoolCandidate(tile)||protectedKeys.has(key(x,y)))continue;
        const e=elevationOf(tile);if(e<SPRING_MIN_ELEVATION)continue;
        const rec=drainage.get(key(x,y));
        const requiredHead=Math.max(0,Number(rec.spill)-e);
        candidates.push({tile,requiredHead,score:-e*8+requiredHead*18+Number(rec.uphill)*1.5+y*.02+rand()*.2});
      }
      if(!candidates.length)return null;
      const maxElevation=Math.max(...candidates.map(entry=>elevationOf(entry.tile)));
      const highest=candidates.filter(entry=>Math.abs(elevationOf(entry.tile)-maxElevation)<=.0001);
      highest.sort((a,b)=>a.score-b.score||a.tile.y-b.tile.y||a.tile.x-b.tile.x);
      const best=highest[0];
      return{tile:best.tile,maxElevation};
    }

    function routeFrom(source){
      const out=[],seen=new Set();let cursor=source,guard=0;
      while(cursor&&guard++<=map.tiles.length){
        const k=key(cursor.x,cursor.y);
        if(seen.has(k))throw new Error("Terrain drainage route looped");
        seen.add(k);out.push(cursor);
        if(cursor.y===map.height-1)break;
        const parent=drainage.get(k)?.parent;
        if(!parent)throw new Error(`No terrain drainage outlet from ${cursor.x},${cursor.y}`);
        cursor=parent;
      }
      if(!out.length||out[out.length-1].y!==map.height-1)throw new Error("Terrain drainage route did not reach map outlet");
      return out;
    }

    function buildSpringSource(source){
      const objectId=`spring_source_${source.x}_${source.y}`;
      source.sourceObjectId=objectId;
      sourceObjects.push({
        id:objectId,type:"SPRING",x:source.x,y:source.y,sourceKind:SOURCE_KIND.SPRING,
        hydrologySourceX:source.x,hydrologySourceY:source.y,floatOnWater:true,
        destructible:true,blocksMovement:false
      });
    }

    const requestedKind=rand()<SPRING_SOURCE_CHANCE?SOURCE_KIND.SPRING:SOURCE_KIND.OFF_MAP;
    const springPlan=requestedKind===SOURCE_KIND.SPRING?chooseSpringSource():null;
    const sourceKind=springPlan?SOURCE_KIND.SPRING:SOURCE_KIND.OFF_MAP;
    const sourceSeed=springPlan?.tile||chooseOffMapSource();
    if(!sourceSeed)throw new Error("Terrain-driven water source generation failed");
    const path=routeFrom(sourceSeed),pathKeys=new Set(path.map(tile=>key(tile.x,tile.y)));
    const sourceNaturalElevation=elevationOf(sourceSeed);

    // Derive the free-water profile from the finalized terrain. Each routed reach
    // sits slightly below its local land surface; scanning from the outlet back to
    // the source fills only real downstream depressions up to their controlling
    // spill saddle. This guarantees a non-uphill river profile without inventing
    // arbitrary water areas.
    const localSurface=path.map(tile=>elevationOf(tile)-RIVER_SURFACE_INSET);
    const routedSurface=[...localSurface];
    for(let i=routedSurface.length-2;i>=0;i--)routedSurface[i]=Math.max(localSurface[i],routedSurface[i+1]);

    const basinVisited=new Set();

    // Author the river channel on top of that water profile. Only the channel bed
    // is incised by the configured shallow depth; the surrounding finalized land
    // is never rewritten.
    for(let i=0;i<path.length;i++){
      const tile=path[i],next=path[i+1]||null;
      const originalElevation=elevationOf(tile);
      const routeIndex=typeof tile.routeId==="string"?Number(tile.routeId.split("_")[1]):null;
      const isRoute=Number.isInteger(routeIndex);
      const existingDepth=Math.max(0,Number(tile.waterDepth||0));
      const existingSurface=existingDepth>0
        ?Number(tile.waterSurfaceZ??(Number(tile.elevation||0)+existingDepth))
        :-Infinity;
      const desiredSurface=Math.max(routedSurface[i],existingSurface);
      const desiredDepth=Math.max(RIVER_CHANNEL_DEPTH,existingDepth);
      const channelBed=desiredSurface-desiredDepth;
      const dryTerrain=tile.terrain==="WATER"?(tile.dryTerrain||"PLAIN"):tile.terrain;
      setWater(tile,{
        bed:channelBed,
        depth:desiredDepth,
        river:true,
        ford:isRoute,
        flowX:next?Math.sign(next.x-tile.x):0,
        flowY:next?Math.sign(next.y-tile.y):0,
        flowSpeed:isRoute?.45:.62,
        discharge:isRoute?.8:1
      });
      tile.dryTerrain=dryTerrain;
      tile.hydrologyChannelBaseElevation=originalElevation;
      tile.hydrologyChannelNaturalSurface=desiredSurface;
      tile.waterSurfaceZ=desiredSurface;
      tile.hydrologyDrain=!next;

      const tk=key(tile.x,tile.y);
      if(!riverKeys.has(tk)){riverKeys.add(tk);river.push({x:tile.x,y:tile.y});}
      if(isRoute&&!routeCrossings.has(routeIndex)){
        routeCrossings.set(routeIndex,{x:tile.x,y:tile.y});
        protectedKeys.add(tk);
      }
    }

    const authoredSource=path[0];
    authoredSource.hydrologyAuthoredSource=true;
    authoredSource.hydrologySource=true;
    authoredSource.hydrologySourceActive=true;
    authoredSource.sourceKind=sourceKind;
    authoredSource.hydrologySourceNaturalElevation=sourceNaturalElevation;
    authoredSource.hydrologySourceSelectionMaxElevation=sourceKind===SOURCE_KIND.SPRING
      ?Number(springPlan?.maxElevation??sourceNaturalElevation)
      :sourceNaturalElevation;
    authoredSource.hydrologySourceSpillSurface=Number(drainage.get(key(authoredSource.x,authoredSource.y))?.spill??authoredSource.waterSurfaceZ);

    if(sourceKind===SOURCE_KIND.SPRING)buildSpringSource(authoredSource);

    const profile=finalizeGeneratedRiverProfile(map);
    const profileSource=profile.sources?.[0];
    if(profileSource&&authoredSource.sourceObjectId)profileSource.objectId=authoredSource.sourceObjectId;

    return{
      tiles:river,
      crossings:[...routeCrossings.entries()].map(([routeIndex,p])=>({routeIndex,...p})),
      profile,
      objects:sourceObjects,
      sourceKind,
      basinTiles:basinVisited.size,
      routeLength:path.length
    };
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

  function movementHeight(tile){
    if(!tile)return 0;
    // Generation/path validation treats a shallow authored ford by its finalized
    // land crossing height. Runtime movement still uses Hydrology/VerticalMobility.
    if(tile.ford===true&&Number.isFinite(Number(tile.hydrologyChannelBaseElevation)))return Number(tile.hydrologyChannelBaseElevation);
    const depth=Math.max(0,Number(tile.waterDepth||0));
    return depth>0?Number(tile.elevation||0)+depth:Number(tile.elevation||0);
  }
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
      const routeDownstream=!springSource||route.some(point=>Number(point.y)>=Number(springSource.y));
      const crossing=river.crossings.find(c=>c.routeIndex===i),ford=crossing&&tileAt(map,crossing.x,crossing.y);
      if(routeDownstream&&crossing&&(!ford?.river||!ford?.ford))errors.push(`ROUTE_${i}_FORD`);
    });

    // Generated water must already be physically consistent before the battle
    // starts. Do not leave an impossible profile for WaterRenderer to disguise.
    const by=new Map((map?.tiles||[]).map(tile=>[key(tile.x,tile.y),tile]));
    let bankOvertop=0,uphillFlow=0;
    for(const tile of map?.tiles||[]){
      const depth=Math.max(0,Number(tile.waterDepth||0));
      if(depth<=0)continue;
      const surface=Number(tile.waterSurfaceZ??(Number(tile.elevation||0)+depth));
      if(tile.river!==true){
        for(const[dx,dy]of DIRS){
          const neighbor=by.get(key(tile.x+dx,tile.y+dy));
          if(!neighbor||neighbor.terrain==="WALL")continue;
          const neighborDepth=Math.max(0,Number(neighbor.waterDepth||0));
          if(neighborDepth<=0&&surface>Number(neighbor.elevation||0)+.0001)bankOvertop++;
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

    // Every initial non-river water tile must belong to a basin physically fed by
    // the authored source. Low terrain by itself is never water.
    const source=(map?.tiles||[]).find(tile=>tile?.hydrologySource===true);
    const fed=new Set();
    if(source){
      const queue=[source],seen=new Set();
      while(queue.length){
        const tile=queue.shift(),k=key(tile.x,tile.y);
        if(seen.has(k)||Number(tile.waterDepth||0)<=0)continue;
        seen.add(k);fed.add(k);
        for(const[dx,dy]of DIRS){
          const next=by.get(key(tile.x+dx,tile.y+dy));
          if(next&&!seen.has(key(next.x,next.y))&&Number(next.waterDepth||0)>0)queue.push(next);
        }
      }
    }
    const unownedInitialWater=(map?.tiles||[]).filter(tile=>Number(tile?.waterDepth||0)>0&&!fed.has(key(tile.x,tile.y)));
    if(unownedInitialWater.length)errors.push(`UNFED_INITIAL_WATER_${unownedInitialWater.length}`);
    return{ok:errors.length===0,errors};
  }

  function stats(map){const e=map.tiles.map(t=>Number(t.elevation||0));return{minElevation:Math.min(...e),maxElevation:Math.max(...e),waterTiles:map.tiles.filter(t=>t.waterDepth>0).length,riverTiles:map.tiles.filter(t=>t.river).length,fordTiles:map.tiles.filter(t=>t.ford).length,forestTiles:map.tiles.filter(t=>t.terrain==="FOREST").length,highGroundTiles:map.tiles.filter(t=>t.terrain==="HIGH_GROUND").length};}

  function generateVersus({size="MEDIUM",seed=randomSeed(),coreRules={}}={}){
    const cfg=preset(size),resolvedSeed=Number(seed)>>>0,rand=createRandom(resolvedSeed),map={id:`generated_versus_${cfg.id.toLowerCase()}_${resolvedSeed}`,name:`Generated ${cfg.label}`,width:cfg.width,height:cfg.height,tiles:[],objects:[],generated:true,seed:resolvedSeed,size:cfg.id};
    for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++)map.tiles.push({x,y,terrain:"PLAIN",elevation:0,waterDepth:0,waterSurfaceZ:null});
    applyTerrain(map,elevationField(map.width,map.height,cfg,rand));

    const protectedKeys=new Set(),baseInfo=carveBaseZones(map,protectedKeys),ys=routeYs(map),routes=ys.map((y,i)=>carveStrategicRoute(map,y,i,protectedKeys,rand));
    connectRoutesToBases(map,routes,baseInfo,protectedKeys);
    // Finalize all gameplay land geometry before authoring water. The generated
    // source then drains through that final terrain; reached depressions fill to
    // their real spill elevation before flow continues downstream.
    const capturePoints=createCapturePoints(map,routes,protectedKeys);
    addForests(map,cfg,rand,protectedKeys);
    const mountainAccess=ensureMountainAccessibility(map,protectedKeys,baseInfo);
    const river=createRiver(map,routes,protectedKeys,rand);
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
    return{map,cores,deploymentPoints,meta:{generated:true,seed:resolvedSeed,size:cfg.id,label:cfg.label,width:map.width,height:map.height,routes:routes.length,riverCrossings:river.crossings.length,riverSourceKind:river.sourceKind,sourceFedBasinTiles:river.basinTiles,riverRouteLength:river.routeLength,mountainRamps:mountainAccess.ramps,mountainRampTiles:mountainAccess.changedTiles,inaccessibleHighGround:mountainAccess.remainingInaccessible,validation:"PASS",...summary}};
  }

  return Object.freeze({SIZE_PRESETS,SOURCE_KIND,preset,randomSeed,generateVersus,validateBattlefield});
})();
globalThis.MapGenerator=MapGenerator;

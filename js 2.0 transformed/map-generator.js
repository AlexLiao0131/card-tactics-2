export const MapGenerator=(()=>{
  "use strict";

  const SIZE_PRESETS=Object.freeze({
    SMALL:Object.freeze({id:"SMALL",label:"小型",width:14,height:10,minElevation:-2,maxElevation:4,forestClusters:3,rocks:4}),
    MEDIUM:Object.freeze({id:"MEDIUM",label:"中型",width:20,height:14,minElevation:-3,maxElevation:5,forestClusters:5,rocks:6}),
    LARGE:Object.freeze({id:"LARGE",label:"大型",width:26,height:18,minElevation:-4,maxElevation:6,forestClusters:7,rocks:8}),
    XLARGE:Object.freeze({id:"XLARGE",label:"超大型",width:32,height:22,minElevation:-4,maxElevation:7,forestClusters:10,rocks:11})
  });

  const DIRS=[[1,0],[-1,0],[0,1],[0,-1]],key=(x,y)=>`${x},${y}`;
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
    delete tile.dryTerrain;delete tile.soilMoisture;delete tile.river;delete tile.ford;delete tile.flowX;delete tile.flowY;delete tile.baseFlowSpeed;delete tile.flowSpeed;delete tile.discharge;
  }
  function setWater(tile,{bed=-1,depth=1,river=false,ford=false,flowX=0,flowY=1,flowSpeed=.6,discharge=1}={}){
    if(!tile)return;tile.elevation=Number(bed);tile.terrain="WATER";tile.waterDepth=Math.max(.1,Number(depth));tile.waterSurfaceZ=tile.elevation+tile.waterDepth;tile.dryTerrain="PLAIN";tile.soilMoisture=1;
    if(river){tile.river=true;tile.ford=!!ford;tile.flowX=Number(flowX||0);tile.flowY=Number(flowY||0);tile.baseFlowSpeed=Number(flowSpeed||.6);tile.flowSpeed=tile.baseFlowSpeed;tile.baseDischarge=Number(discharge||1);tile.discharge=tile.baseDischarge;}
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
      carve(x,y); // horizontal step first
      if(nextY!==y){carve(x,nextY);y=nextY;} // then an orthogonal vertical step at the same x
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

  function createRiver(map,routes,protectedKeys,rand){
    const xBase=clamp(Math.round(map.width*(.42+rand()*.16)),4,map.width-5),river=[],routeCrossings=new Map();
    let x=xBase;
    function placeRiverTile(tx,ty){
      let tile=tileAt(map,tx,ty);if(!tile)return null;
      if(tile.captureZone){
        for(const shift of [-1,1,-2,2]){const candidate=tileAt(map,clamp(tx+shift,2,map.width-3),ty);if(candidate&&!candidate.captureZone){tile=candidate;break;}}
      }
      const routeIndex=typeof tile.routeId==="string"?Number(tile.routeId.split("_")[1]):null;
      const isRoute=Number.isInteger(routeIndex),routeSurface=isRoute?(tile.ford?Number(tile.waterSurfaceZ??(Number(tile.elevation||0)+Number(tile.waterDepth||0))):clamp(Number(tile.elevation||0),0,1)):0;
      setWater(tile,{bed:isRoute?routeSurface-.35:-1,depth:isRoute?.35:1,river:true,ford:isRoute,flowX:0,flowY:1,flowSpeed:isRoute?.45:.62,discharge:isRoute?.8:1});
      if(isRoute&&!routeCrossings.has(routeIndex))routeCrossings.set(routeIndex,{x:tile.x,y:tile.y});
      river.push({x:tile.x,y:tile.y});
      return tile;
    }
    for(let y=0;y<map.height;y++){
      if(y>0&&rand()<.28)x=clamp(x+(rand()<.5?-1:1),3,map.width-4);
      const last=river[river.length-1];
      if(last&&last.x!==x){let bx=last.x;while(bx!==x){bx+=Math.sign(x-bx);placeRiverTile(bx,y);}}
      placeRiverTile(x,y);
    }

    // If meander did not naturally touch a strategic route, extend a short branch to the nearest route point.
    routes.forEach((route,index)=>{
      if(routeCrossings.has(index))return;
      let best=null;
      for(const rp of route)for(const rv of river){
        const d=Math.abs(rp.x-rv.x)+Math.abs(rp.y-rv.y);
        if(!best||d<best.d)best={rp,rv,d};
      }
      if(!best)return;
      let x=best.rv.x,y=best.rv.y;
      while(y!==best.rp.y){y+=Math.sign(best.rp.y-y);placeRiverTile(x,y);}
      while(x!==best.rp.x){x+=Math.sign(best.rp.x-x);const t=tileAt(map,x,y);if(!t)break;t.routeId=`route_${index}`;placeRiverTile(x,y);}
      const ford=tileAt(map,best.rp.x,best.rp.y);if(ford){ford.routeId=`route_${index}`;if(!ford.ford){const surface=clamp(Number(ford.elevation||0),0,1);setWater(ford,{bed:surface-.35,depth:.35,river:true,ford:true,flowX:0,flowY:1,flowSpeed:.45,discharge:.8});}ford.ford=true;ford.baseFlowSpeed=.45;ford.flowSpeed=.45;ford.baseDischarge=.8;ford.discharge=.8;routeCrossings.set(index,{x:ford.x,y:ford.y});protectedKeys.add(key(ford.x,ford.y));}
    });
    return{tiles:river,crossings:[...routeCrossings.entries()].map(([routeIndex,p])=>({routeIndex,...p}))};
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
  function validateBattlefield(map,objects,cores,points,routes,river){
    const p=cores.find(c=>c.owner==="PLAYER"),e=cores.find(c=>c.owner==="ENEMY"),errors=[];
    if(!hasPath(map,objects,p,e))errors.push("CORE_TO_CORE");
    for(const point of points){const goal=point.captureTiles?.[0];if(goal&&!hasPath(map,objects,p,goal))errors.push(`PLAYER_TO_${point.id}`);if(goal&&!hasPath(map,objects,e,goal))errors.push(`ENEMY_TO_${point.id}`);}
    routes.forEach((route,i)=>{
      for(let n=1;n<route.length;n++){const a=tileAt(map,route[n-1].x,route[n-1].y),b=tileAt(map,route[n].x,route[n].y);if(!a||!b||Math.abs(movementHeight(a)-movementHeight(b))>1.0001){errors.push(`ROUTE_${i}_CLIMB`);break;}}
      const crossing=river.crossings.find(c=>c.routeIndex===i),ford=crossing&&tileAt(map,crossing.x,crossing.y);if(!ford?.river||!ford?.ford||Number(ford.waterDepth||0)>.6)errors.push(`ROUTE_${i}_FORD`);
    });
    return{ok:errors.length===0,errors};
  }

  function stats(map){const e=map.tiles.map(t=>Number(t.elevation||0));return{minElevation:Math.min(...e),maxElevation:Math.max(...e),waterTiles:map.tiles.filter(t=>t.waterDepth>0).length,riverTiles:map.tiles.filter(t=>t.river).length,fordTiles:map.tiles.filter(t=>t.ford).length,forestTiles:map.tiles.filter(t=>t.terrain==="FOREST").length,highGroundTiles:map.tiles.filter(t=>t.terrain==="HIGH_GROUND").length};}

  function generateVersus({size="MEDIUM",seed=randomSeed(),coreRules={}}={}){
    const cfg=preset(size),resolvedSeed=Number(seed)>>>0,rand=createRandom(resolvedSeed),map={id:`generated_versus_${cfg.id.toLowerCase()}_${resolvedSeed}`,name:`Generated ${cfg.label}`,width:cfg.width,height:cfg.height,tiles:[],objects:[],generated:true,seed:resolvedSeed,size:cfg.id};
    for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++)map.tiles.push({x,y,terrain:"PLAIN",elevation:0,waterDepth:0,waterSurfaceZ:null});
    applyTerrain(map,elevationField(map.width,map.height,cfg,rand));

    const protectedKeys=new Set(),baseInfo=carveBaseZones(map,protectedKeys),ys=routeYs(map),routes=ys.map((y,i)=>carveStrategicRoute(map,y,i,protectedKeys,rand));
    connectRoutesToBases(map,routes,baseInfo,protectedKeys);
    const capturePoints=createCapturePoints(map,routes,protectedKeys),river=createRiver(map,routes,protectedKeys,rand);
    addForests(map,cfg,rand,protectedKeys);
    const mountainAccess=ensureMountainAccessibility(map,protectedKeys,baseInfo);
    const rocks=addRocks(map,cfg,rand,protectedKeys);

    const hp=Math.max(1,Number(coreRules.hp??600)),shield=Math.max(0,Number(coreRules.shield??0)),defense=Math.max(0,Number(coreRules.defense??0));
    const cores=[
      {id:"player_core",name:"我方 Core",owner:"PLAYER",x:baseInfo.playerCore.x,y:baseInfo.playerCore.y,hp,maxHp:hp,shield,maxShield:shield,defense},
      {id:"enemy_core",name:"敵方 Core",owner:"ENEMY",x:baseInfo.enemyCore.x,y:baseInfo.enemyCore.y,hp,maxHp:hp,shield,maxShield:shield,defense}
    ];
    map.objects=[{id:"player_core_object",x:baseInfo.playerCore.x,y:baseInfo.playerCore.y,type:"CORE",environment:"STONE",destructible:false,blocksMovement:true},{id:"enemy_core_object",x:baseInfo.enemyCore.x,y:baseInfo.enemyCore.y,type:"CORE",environment:"STONE",destructible:false,blocksMovement:true},...rocks];
    const deploymentPoints=[{id:"player_base",name:"我方本陣",owner:"PLAYER",capturable:false,captureTiles:[],area:baseArea(map,"PLAYER",baseInfo)},...capturePoints,{id:"enemy_base",name:"敵方本陣",owner:"ENEMY",capturable:false,captureTiles:[],area:baseArea(map,"ENEMY",baseInfo)}];

    const validation=validateBattlefield(map,rocks,cores,capturePoints,routes,river);
    if(!validation.ok)throw new Error(`Generated battlefield validation failed: ${validation.errors.join(",")}`);
    const summary=stats(map);
    return{map,cores,deploymentPoints,meta:{generated:true,seed:resolvedSeed,size:cfg.id,label:cfg.label,width:map.width,height:map.height,routes:routes.length,riverCrossings:river.crossings.length,mountainRamps:mountainAccess.ramps,mountainRampTiles:mountainAccess.changedTiles,inaccessibleHighGround:mountainAccess.remainingInaccessible,validation:"PASS",...summary}};
  }

  return Object.freeze({SIZE_PRESETS,preset,randomSeed,generateVersus,validateBattlefield});
})();
globalThis.MapGenerator=MapGenerator;

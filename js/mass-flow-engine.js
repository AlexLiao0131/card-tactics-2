import {TerrainMaterial} from "./terrain-database.js";
export const MassFlowEngine=(()=>{
  "use strict";

  const MATERIAL=Object.freeze({SOIL:"SOIL",ROCK:"ROCK",DEBRIS:"DEBRIS",SNOW:"SNOW"});
  const CFG=Object.freeze({
    MAX_STEPS:12,
    MIN_DROP:.001,
    OBJECT_RESISTANCE_FACTOR:.18,
    SOIL:{pickup:.35,transport:.68},
    ROCK:{pickup:.18,transport:.78},
    DEBRIS:{pickup:.18,transport:.76},
    SNOW:{pickup:.30,transport:1}
  });
  const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
  const key=(x,y)=>`${x},${y}`;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
  const round=value=>Math.round(Number(value||0)*1000)/1000;
  const clean=value=>Math.max(0,round(value));
  // Shared canonical Grid tile index; no second hydrology state or coordinate cache.
const tileAt=(map,x,y)=>globalThis.TacticalEngine?.tile?globalThis.TacticalEngine.tile(map,x,y):map?.tiles?.find(t=>t.x===x&&t.y===y)||null;
  const elevation=tile=>Number(tile?.elevation||0);
  const snow=tile=>Math.max(0,Number(tile?.snowDepth||0));
  const moisture=tile=>Math.max(0,Number(globalThis.HydrologyEngine?.soilMoisture?.(tile)||0));
  const rockMass=(tile,map)=>Math.max(0,Number(tile?.rockMass??((TerrainMaterial.isRock(tile)||TerrainMaterial.exposedCliffFace(map,tile))?Math.max(.5,elevation(tile)*.35):0)));
  const normalizedMaterial=value=>String(value||MATERIAL.SOIL).toUpperCase();

  function flowPassable(tile){return !!tile&&tile.terrain!=="WALL";}
  function pickupFor(tile,material,map){
    const cfg=CFG[material]||CFG.SOIL;
    if(material===MATERIAL.SNOW)return Math.min(.45,snow(tile)*cfg.pickup);
    if(material===MATERIAL.ROCK||material===MATERIAL.DEBRIS)return Math.min(.55,rockMass(tile,map)*cfg.pickup);
    const sandBonus=tile?.terrain==="SAND"?.12:0;
    return Math.min(.48,moisture(tile)*cfg.pickup+(tile?.terrain==="MUD"?.06:0)+sandBonus);
  }
  function downhill(map,tile,visited=new Set(),material=MATERIAL.SOIL){
    return DIRS.map(([dx,dy])=>tileAt(map,tile.x+dx,tile.y+dy))
      .filter(next=>flowPassable(next)&&!visited.has(key(next.x,next.y)))
      .map(next=>{
        const drop=elevation(tile)-elevation(next),resistance=Math.max(0,Number(globalThis.EnvironmentObjectEngine?.flowResistanceAt?.(map,next)||0));
        return{tile:next,drop,resistance,score:drop-resistance*CFG.OBJECT_RESISTANCE_FACTOR};
      })
      .filter(entry=>entry.drop>CFG.MIN_DROP&&entry.score>CFG.MIN_DROP)
      .sort((a,b)=>b.score-a.score||b.drop-a.drop||elevation(a.tile)-elevation(b.tile))[0]||null;
  }
  // Head is in the existing elevation units, not a second velocity simulation.
  // Gravity adds head, the existing material transport and surface friction spend it.
  // A stopped flow can still deposit laterally, but cannot manufacture a new path.
  function trace(map,start,material,initialMass,{maxSteps=CFG.MAX_STEPS}={}){
    material=normalizedMaterial(material);if(!map||!flowPassable(start))return null;
    const cfg=CFG[material]||CFG.SOIL,visited=new Set([key(start.x,start.y)]);
    const baseMass=Math.max(0,Number(initialMass||0));
    const path=[{x:start.x,y:start.y,elevation:elevation(start),drop:0,pickup:0,resistance:Number(globalThis.EnvironmentObjectEngine?.flowResistanceAt?.(map,start)||0),head:0}];
    let current=start,carried=baseMass,head=0,heading=null;
    for(let i=0;i<Math.min(CFG.MAX_STEPS,Math.max(1,Math.trunc(Number(maxSteps)||CFG.MAX_STEPS)));i++){
      const candidates=DIRS.map(([dx,dy])=>{
        const t=tileAt(map,current.x+dx,current.y+dy);if(!flowPassable(t)||visited.has(key(t.x,t.y)))return null;
        const drop=elevation(current)-elevation(t),resistance=Math.max(0,Number(globalThis.EnvironmentObjectEngine?.flowResistanceAt?.(map,t)||0));
        const friction=Number(t.surfaceFriction??globalThis.EnvironmentResolver?.surfaceFriction?.({},t)??1);
        const loss=Math.max(0,friction)*(1-cfg.pickup)+resistance*CFG.OBJECT_RESISTANCE_FACTOR;
        const gravity=drop-resistance*CFG.OBJECT_RESISTANCE_FACTOR;
        if(gravity<=CFG.MIN_DROP&&(head<=CFG.MIN_DROP||drop<0||head<=resistance*CFG.OBJECT_RESISTANCE_FACTOR))return null;
        // Do not turn uphill or double back. Straight continuation wins a level tie.
        const alignment=heading?dx*heading[0]+dy*heading[1]:0;
        if(drop<=CFG.MIN_DROP&&alignment<0)return null;
        return{tile:t,drop,resistance,dx,dy,alignment,score:gravity,head:Math.max(0,(head+Math.max(0,drop))*cfg.transport-loss)};
      }).filter(Boolean).sort((a,b)=>b.score-a.score||b.alignment-a.alignment||b.head-a.head||a.tile.y-b.tile.y||a.tile.x-b.tile.x);
      const next=candidates[0];if(!next)break;
      current=next.tile;heading=[next.dx,next.dy];head=next.head;visited.add(key(current.x,current.y));
      const pickup=next.drop>CFG.MIN_DROP?pickupFor(current,material,map):0;carried+=pickup;
      path.push({x:current.x,y:current.y,elevation:elevation(current),drop:next.drop,pickup:clean(pickup),resistance:clean(next.resistance),head});
    }
    return{material,initialMass:clean(baseMass),mass:clean(carried),path,end:current};
  }
  // Allocate exact thousandths of one tile-height volume; remainder stays in
  // the last cell rather than creating material through independent rounding.
  const units=v=>Math.max(0,Math.floor((Number(v)||0)*1000+1e-7));
  const volume=n=>n/1000;
  function allocate(total,weights){
    const sum=weights.reduce((a,b)=>a+b,0);if(!sum||!total)return weights.map(()=>0);
    const raw=weights.map(w=>total*w/sum),result=raw.map(Math.floor);
    const order=raw.map((v,i)=>({i,f:v-result[i]})).filter(e=>weights[e.i]>0).sort((a,b)=>b.f-a.f||a.i-b.i);
    for(let i=0,left=total-result.reduce((a,b)=>a+b,0);i<left;i++)result[order[i%order.length].i]++;
    return result;
  }
  function depositPlan(map,flow,total,records,{snowLayer=false}={}){
    const path=flow.path,keys=new Set(path.map(p=>key(p.x,p.y))),n=path.length;
    const weights=path.map((p,i)=>{const t=i/(n-1);return t>=(snowLayer?.55:.30)?Math.pow(t,snowLayer?2.2:1.8):0;});
    const amounts=allocate(total,weights);
    for(let i=0;i<n;i++){
      const amount=amounts[i];if(!amount)continue;
      const p=path[i],center=tileAt(map,p.x,p.y),prev=path[i-1];
      const height=t=>elevation(t)+(snowLayer?snow(t):0)+volume(records.get(key(t.x,t.y))?.deposit||0)-volume(records.get(key(t.x,t.y))?.erosion||0);
      const options=[center];
      // At a slope break or the terminus, spread across physically reachable
      // neighbouring cells, never up the incoming channel or through walls.
      if(i===n-1||p.drop<=CFG.MIN_DROP||p.drop<(prev?.drop||0)){
        for(const [dx,dy] of DIRS){
          const t=tileAt(map,p.x+dx,p.y+dy);if(!flowPassable(t)||keys.has(key(t.x,t.y)))continue;
          if(prev&&dx*(p.x-prev.x)+dy*(p.y-prev.y)<0)continue;
          if(height(t)<=height(center)+volume(amount))options.push(t);
        }
      }
      // Fill the lowest reachable surface first. Integer allocation keeps the
      // physical volume exact even where a deposit is shared between cells.
      const ordered=options.map(t=>({t,h:height(t)})).sort((a,b)=>a.h-b.h||a.t.y-b.t.y||a.t.x-b.t.x);
      let remaining=amount,level=ordered[0].h,active=1;
      for(;active<ordered.length;active++){
        const needed=units((ordered[active].h-level)*active);
        if(needed>remaining)break;
        level=ordered[active].h;remaining-=needed;
      }
      const finalLevel=level+volume(remaining)/active;
      const shares=allocate(amount,ordered.map((o,j)=>j<active?Math.max(0,finalLevel-o.h):0));
      for(let j=0;j<ordered.length;j++)if(shares[j]){
        const t=ordered[j].t,k=key(t.x,t.y),r=records.get(k)||{tile:t,erosion:0,deposit:0,at:i};
        r.deposit+=shares[j];records.set(k,r);
      }
    }
  }
  function erosionFactor(map,tile,material){
    let susceptibility=1;
    if(tile?.terrain==="SAND")susceptibility=1.35;
    else if(tile?.terrain==="FOREST")susceptibility=.9;
    if(material===MATERIAL.ROCK||material===MATERIAL.DEBRIS)susceptibility*=1.08;
    const resistance=Math.max(0,Number(globalThis.EnvironmentObjectEngine?.erosionResistanceAt?.(map,tile)||0));
    return susceptibility*clamp(1-resistance,.35,1);
  }
  function markTerrainChange(tile,before,events,source,material){
    if(before===tile.terrain)return;
    events.push({type:"TERRAIN_CHANGED",x:tile.x,y:tile.y,from:before,to:tile.terrain,source,material});
  }
  function markElevation(tile,before,events,source,material,erosion,deposition){
    const after=elevation(tile);if(Math.abs(after-before)<=.00005)return;
    events.push({type:"ELEVATION_CHANGED",x:tile.x,y:tile.y,from:before,to:after,deltaElevation:Math.round((after-before)*10000)/10000,source,material,erosion,deposit:deposition});
  }
  function applySoilSurface(tile,erosion,deposition,events,source){
    const impact=erosion+deposition,before=tile.terrain;if(impact<=.025)return;
    if(deposition>=.14){
      if(TerrainMaterial.bedComposition(tile))globalThis.HydrologyEngine.setGroundMaterial(tile,"SILT",events,source);
      else if(!TerrainMaterial.hasSoil(tile))globalThis.HydrologyEngine.setGroundMaterial(tile,"SOIL",events,source);
    }
    if(!TerrainMaterial.hasSoil(tile))return;
    // Preserve the existing pore water store: moving dry-equivalent solid
    // volume is not a second source/sink of water.
    if(tile.terrain==="WATER"&&deposition>=.14)tile.dryTerrain="MUD";
    else if(tile.terrain==="PLAIN"||tile.terrain==="FOREST"){tile.terrain="MUD";if(before==="FOREST")tile.vegetation=0;}
    else if(tile.terrain==="SAND"&&deposition>=.18)tile.terrain="MUD";
    tile.massFlowResidue=clean(Number(tile.massFlowResidue||0)+impact);
    markTerrainChange(tile,before,events,source,MATERIAL.SOIL);
  }
  function applyRockSurface(tile,erosion,deposition,events,source,material,map){
    const impact=erosion+deposition,before=tile.terrain;
    tile.rockMass=clean(Math.max(0,Number(tile.rockMass??rockMass(tile,map))-erosion+deposition));
    tile.debrisMass=clean(Math.max(0,Number(tile.debrisMass||0)-erosion)+deposition);
    if(tile.debrisMass>=.28&&(TerrainMaterial.of(tile)!=="ROCK"||TerrainMaterial.hasSoil(tile)))globalThis.HydrologyEngine.setGroundMaterial(tile,"ROCK",events,source);
    if(before==="FOREST"&&impact>=.18){tile.terrain="PLAIN";tile.vegetation=0;}
    tile.massFlowResidue=clean(Number(tile.massFlowResidue||0)+impact);
    markTerrainChange(tile,before,events,source,material);
  }
  function evolveGround(map,flow,{events=[],source="MASS_FLOW"}={}){
    const path=flow.path,records=new Map(),rock=flow.material!==MATERIAL.SOIL;
    let total=0;
    for(let i=0;i<path.length;i++){
      const p=path[i],tile=tileAt(map,p.x,p.y);if(!tile)continue;
      const next=path[i+1],relief=next?Math.max(0,elevation(tile)-elevation(tileAt(map,next.x,next.y))):0;
      // Source mass already comes from the existing stability/release rule.
      // Downstream pickup is limited by actual local relief and resistance.
      const requested=i===0?flow.initialMass:Number(p.pickup||0)*erosionFactor(map,tile,flow.material);
      const available=rock?rockMass(tile,map):TerrainMaterial.hasSoil(tile)?relief:0;
      const amount=units(Math.min(requested,available,relief));
      records.set(key(p.x,p.y),{tile,erosion:amount,deposit:0,at:i,rockBefore:rock?rockMass(tile,map):null});total+=amount;
    }
    // A newly exposed, unsupported rock shoulder may join the collapse. Limit
    // the release to actual rock inventory and the newly created excess relief.
    if(rock&&total>0){
      const first=records.get(key(path[0].x,path[0].y)),t=first.tile,low=elevation(t)-volume(first.erosion);
      const threshold=globalThis.EnvironmentResolver?.CFG?.ROCK_FAILURE_MIN_DROP??1;
      for(const [dx,dy] of DIRS){
        const n=tileAt(map,t.x+dx,t.y+dy),k=n&&key(n.x,n.y);if(!flowPassable(n)||records.has(k)||!TerrainMaterial.isRock(n))continue;
        const before=elevation(n)-elevation(t),after=elevation(n)-low;
        if(before>threshold||after<=threshold)continue;
        const available=rockMass(n,map),cohesion=Math.max(0,Math.min(1,Number(n.rockCohesion??globalThis.EnvironmentResolver?.CFG?.ROCK_BASE_COHESION??.78)));
        const erosion=units(Math.min(available*(1-cohesion),after-threshold));if(!erosion)continue;
        records.set(k,{tile:n,erosion,deposit:0,at:0,rockBefore:available});total+=erosion;
      }
    }
    depositPlan(map,flow,total,records);
    let elevationChanges=0,terrainChanges=0,totalDeposit=0,totalSuspended=0;
    for(const r of records.values()){
      const {tile}=r,before=elevation(tile),beforeTerrain=tile.terrain,erosion=volume(r.erosion),gross=volume(r.deposit);
      // The old concentration coefficients become a fraction of the actual
      // arriving solid volume, bounded by the receiving liquid column.
      const suspended=globalThis.HydrologyEngine?.suspendSediment?.(tile,gross*(rock?.28:.42),events,source,flow.material)||0;
      const deposition=gross-suspended;
      tile.elevation=Math.round((before+deposition-erosion)*10000)/10000;
      if(rock)tile.rockMass=r.rockBefore??rockMass({...tile,elevation:before},map);
      const loose=Math.max(0,Number(tile.sedimentDeposit||0));
      if(loose>0||(!rock&&deposition>0))tile.sedimentDeposit=Math.round((Math.max(0,loose-erosion)+(rock?0:deposition))*10000)/10000;
      if(rock)applyRockSurface(tile,erosion,deposition,events,source,flow.material,map);
      else applySoilSurface(tile,erosion,deposition,events,source);
      markElevation(tile,before,events,source,flow.material,erosion,deposition);
      if(Math.abs(elevation(tile)-before)>.00005)elevationChanges++;
      if(tile.terrain!==beforeTerrain)terrainChanges++;
      totalDeposit+=deposition;totalSuspended+=suspended;
      r.node={x:tile.x,y:tile.y,elevation:before,elevationBefore:before,elevationAfter:elevation(tile),erosion,deposit:deposition,suspended,at:r.at};
    }
    flow.cells=[...records.values()].map(r=>r.node);
    for(const p of path)Object.assign(p,records.get(key(p.x,p.y))?.node||{});
    flow.mass=volume(total);
    const result={changed:elevationChanges>0||terrainChanges>0||totalSuspended>0,elevationChanges,terrainChanges,totalErosion:volume(total),totalDeposit,totalSuspended};
    events.push({type:"MASS_FLOW_TERRAIN_CHANGED",material:flow.material,source,tiles:flow.cells.length,...result,path:path.map(p=>({...p})),cells:flow.cells.map(p=>({...p}))});
    return result;
  }
  function evolveSnow(map,flow,{events=[],source="AVALANCHE"}={}){
    const records=new Map();let total=0,carriedWater=0;
    const waterOf=t=>Math.max(0,Number(t.snowWaterEquivalent??t.snowDepth??0));
    for(let i=0;i<flow.path.length;i++){
      const p=flow.path[i],tile=tileAt(map,p.x,p.y);if(!tile)continue;
      const take=units(Math.min(snow(tile),i===0?flow.initialMass:Number(p.pickup||0)));
      records.set(key(p.x,p.y),{tile,erosion:take,deposit:0,at:i});total+=take;
      if(take&&snow(tile)>0)carriedWater+=waterOf(tile)*volume(take)/snow(tile);
    }
    depositPlan(map,flow,total,records,{snowLayer:true});let snowChanges=0;
    for(const r of records.values()){
      const {tile}=r,from=snow(tile),swe=waterOf(tile),removed=volume(r.erosion),added=volume(r.deposit);
      tile.snowDepth=clean(from-removed+added);
      tile.snowWaterEquivalent=Math.max(0,swe-(from>0?swe*removed/from:0)+(total?carriedWater*r.deposit/total:0));
      const to=snow(tile);r.node={x:tile.x,y:tile.y,elevation:elevation(tile),snowDepthBefore:from,snowDepthAfter:to,erosion:removed,deposit:added,at:r.at};
      if(Math.abs(to-from)>.0005){snowChanges++;events.push({type:"SNOW_DEPTH_CHANGED",x:tile.x,y:tile.y,from,to,source,material:MATERIAL.SNOW});}
    }
    flow.cells=[...records.values()].map(r=>r.node);for(const p of flow.path)Object.assign(p,records.get(key(p.x,p.y))?.node||{});
    flow.mass=volume(total);events.push({type:"MASS_FLOW_SNOW_REDISTRIBUTED",material:MATERIAL.SNOW,source,tiles:flow.cells.length,snowChanges,mass:flow.mass,path:flow.path.map(p=>({...p})),cells:flow.cells.map(p=>({...p}))});
    return{changed:snowChanges>0,snowChanges};
  }
  function apply(map,flow,{events=[],source="MASS_FLOW"}={}){
    if(!flow||flow.path?.length<2)return{changed:false};
    const terrain=flow.material===MATERIAL.SNOW?evolveSnow(map,flow,{events,source}):evolveGround(map,flow,{events,source});
    const objects=globalThis.EnvironmentObjectEngine?.resolveMassFlow?.(map,flow,{events,source})||{affected:0,moved:0,destroyed:0};
    return{...terrain,objects,changed:!!terrain.changed||objects.affected>0};
  }

  function event(flow,{type="MASS_FLOW",source="STABILITY_FAILURE",damage=0,forceDistance=1,contactProfile="SURFACE_FLOW",extra={}}={}){
    return{type,material:flow.material,x:flow.path[0]?.x,y:flow.path[0]?.y,source,path:flow.path.map(p=>({...p})),cells:(flow.cells||flow.path).map(p=>({...p})),mass:clean(flow.mass),damage:Math.max(0,Math.round(Number(damage||0))),forceDistance:Math.max(0,Math.round(Number(forceDistance||0))),contactProfile,...extra};
  }

  return Object.freeze({MATERIAL,CFG,tileAt,elevation,snow,rockMass,downhill,trace,apply,event});
})();
globalThis.MassFlowEngine=MassFlowEngine;

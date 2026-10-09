import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const EPSILON=1e-8;
// The existing HydrologyEngine considers stored water present at D > 0.0001.
// WaterRenderer and the Q-only sheet must agree on that same ownership boundary.
// Geometric EPSILON remains separate; it is for triangle clipping precision.
export const STORED_WATER_DEPTH_EPSILON=0.0001;
export const hasStoredWaterDepth=tile=>waterDepthOf(tile)>STORED_WATER_DEPTH_EPSILON;
const MAX_VISUAL_SLOPE_DELTA=1.0001;
const WATERBED_DEPTH_RANGE=1.5;
const WATERBED_DEEP=Object.freeze([.13,.24,.25]);
const WET_GRASS=Object.freeze([.29,.43,.24]);
const WET_FOREST=Object.freeze([.14,.28,.18]);
const WET_SAND=Object.freeze([.48,.42,.29]);
const WET_MUD=Object.freeze([.24,.20,.15]);
const SILT_BANK=Object.freeze([.34,.34,.24]);
const FOREST_SOIL=Object.freeze([.24,.31,.20]);
const GRAVEL=Object.freeze([.43,.42,.37]);
const WET_ROCK=Object.freeze([.24,.30,.29]);
const PATCH_OFFSETS=Object.freeze([-.5,-1/6,1/6,.5]);
const CLIFF_EDGE_SEGMENTS=3;
const CLIFF_RUGGEDNESS=.13;

export const VISUAL_TERRAIN_COLORS=Object.freeze({
  PLAIN:[.39,.55,.28],
  FOREST:[.17,.37,.21],
  HIGH_GROUND:[.40,.43,.39],
  WATER:[.29,.37,.31],
  MUD:[.36,.28,.18],
  SAND:[.68,.60,.40],
  WALL:[.27,.28,.31],
  DEFAULT:[.35,.49,.27]
});

export const MICRO_REGION_LAYOUT=Object.freeze([
  Object.freeze({id:"NW",row:0,col:0,ox:-1/3,oz:-1/3,dirs:[[-1,0],[0,-1],[-1,-1]]}),
  Object.freeze({id:"N", row:0,col:1,ox:0,   oz:-1/3,dirs:[[0,-1]]}),
  Object.freeze({id:"NE",row:0,col:2,ox:1/3, oz:-1/3,dirs:[[1,0],[0,-1],[1,-1]]}),
  Object.freeze({id:"W", row:1,col:0,ox:-1/3,oz:0,   dirs:[[-1,0]]}),
  Object.freeze({id:"C", row:1,col:1,ox:0,   oz:0,   dirs:[]}),
  Object.freeze({id:"E", row:1,col:2,ox:1/3, oz:0,   dirs:[[1,0]]}),
  Object.freeze({id:"SW",row:2,col:0,ox:-1/3,oz:1/3, dirs:[[-1,0],[0,1],[-1,1]]}),
  Object.freeze({id:"S", row:2,col:1,ox:0,   oz:1/3, dirs:[[0,1]]}),
  Object.freeze({id:"SE",row:2,col:2,ox:1/3, oz:1/3, dirs:[[1,0],[0,1],[1,1]]})
]);

const keyOf=(x,y)=>`${x},${y}`;
const elevationOf=tile=>Number(tile?.elevation||0);
const waterDepthOf=tile=>Math.max(0,Number(tile?.waterDepth||0));
const clamp01=value=>Math.max(0,Math.min(1,Number(value||0)));
const smooth01=value=>{const t=clamp01(value);return t*t*(3-2*t);};
const average=values=>values.reduce((sum,value)=>sum+Number(value||0),0)/Math.max(1,values.length);
const hash01=value=>{const text=String(value||"");let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0)/4294967295;};
const mixColor=(a,b,t)=>{
  const q=clamp01(t);
  return[
    a[0]+(b[0]-a[0])*q,
    a[1]+(b[1]-a[1])*q,
    a[2]+(b[2]-a[2])*q
  ];
};
const averageColors=colors=>{
  const valid=(colors||[]).filter(Boolean);
  if(!valid.length)return VISUAL_TERRAIN_COLORS.DEFAULT;
  return[
    average(valid.map(color=>color[0])),
    average(valid.map(color=>color[1])),
    average(valid.map(color=>color[2]))
  ];
};

function baseTerrainOf(tile){
  if(tile?.material==="ROCK")return"HIGH_GROUND";
  if(tile?.terrain==="WATER"&&tile?.dryTerrain)return String(tile.dryTerrain);
  return String(tile?.terrain||"DEFAULT");
}

function influenceSnapshot(tile,weight,direction){
  if(!tile)return null;
  return{
    tile,
    direction,
    weight,
    terrain:baseTerrainOf(tile),
    material:String(tile?.material||""),
    elevation:elevationOf(tile),
    waterDepth:waterDepthOf(tile),
    soilMoisture:Math.max(0,Number(tile?.soilMoisture||0)),
    snowDepth:Math.max(0,Number(tile?.snowDepth||0)),
    iceThickness:Math.max(0,Number(tile?.iceThickness||0)),
    river:tile?.river===true,
    flowX:Number(tile?.flowX||0),
    flowY:Number(tile?.flowY||0),
    flowSpeed:Math.max(0,Number(tile?.flowSpeed||0))
  };
}

export class VisualSurfaceResolver{
  constructor({maxVisualSlopeDelta=MAX_VISUAL_SLOPE_DELTA}={}){
    this.maxVisualSlopeDelta=Math.max(0,Number(maxVisualSlopeDelta||0));
    // Runtime geometry contract: TerrainRenderer is the sole owner of visible
    // terrain geometry. Water and other presentation systems consume the exact
    // world-space vertices that were submitted to Babylon instead of rebuilding
    // a second approximation from GridState.
    this.renderedSurfaceGeometry=new Map();
    this.renderedSurfaceGeometryRevision=0;
    this.renderedCliffGeometry=new Map();
    this.renderedCliffGeometryRevision=0;
  }


  clearRenderedSurfaceGeometry(){
    this.renderedSurfaceGeometry.clear();
    this.renderedSurfaceGeometryRevision++;
  }

  registerRenderedSurfaceGeometry(tile,geometry){
    if(!tile||!geometry)return null;
    const key=this.keyOf(tile.x,tile.y);
    const clonePoint=point=>({x:Number(point.x),y:Number(point.y),z:Number(point.z)});
    const triangles=(geometry.triangles||[])
      .filter(triangle=>Array.isArray(triangle)&&triangle.length===3)
      .map(triangle=>triangle.map(clonePoint));
    const stored={key,revision:this.renderedSurfaceGeometryRevision,triangles};
    this.renderedSurfaceGeometry.set(key,stored);
    return stored;
  }

  getRenderedSurfaceGeometry(tile){
    if(!tile)return null;
    return this.renderedSurfaceGeometry.get(this.keyOf(tile.x,tile.y))||null;
  }

  // The published Babylon terrain triangles are the sole world-space height
  // authority. Do not reconstruct a slope from tile elevation or patchGrid here.
  publishedSurfacePoint(tile,x,z){
    const geometry=this.getRenderedSurfaceGeometry(tile);
    if(!geometry?.triangles?.length)return null;
    for(let triangleIndex=0;triangleIndex<geometry.triangles.length;triangleIndex++){
      const [a,b,c]=geometry.triangles[triangleIndex];
      const ax=b.x-a.x,az=b.z-a.z,bx=c.x-a.x,bz=c.z-a.z;
      const determinant=ax*bz-az*bx;
      if(Math.abs(determinant)<=EPSILON)continue;
      const px=Number(x)-a.x,pz=Number(z)-a.z;
      const u=(px*bz-pz*bx)/determinant,v=(ax*pz-az*px)/determinant,w=1-u-v;
      if(u < -EPSILON||v < -EPSILON||w < -EPSILON)continue;
      return{x:Number(x),y:a.y+u*(b.y-a.y)+v*(c.y-a.y),z:Number(z),
        triangleIndex,barycentric:{a:w,b:u,c:v},tileKey:geometry.key,terrainRevision:geometry.revision};
    }
    return null;
  }

  // One edge has ONE set of XZ sample coordinates on both sides. A cliff is
  // not a sloping seam: its two independently published lip/foot heights must
  // not be averaged into a fictitious surface crossing.
  publishedSheetBoundary(from,to){
    if(!from||!to)return{ok:false,reason:"MISSING_TILE",samples:[]};
    const dx=Number(to.x)-Number(from.x),dz=Number(to.y)-Number(from.y);
    if(Math.abs(dx)+Math.abs(dz)!==1)return{ok:false,reason:"NON_ADJACENT",samples:[]};
    if(this.getRenderedCliffGeometry(from,{dx,dy:dz})||
       this.getRenderedCliffGeometry(to,{dx:-dx,dy:-dz})){
      return{ok:false,reason:"REGISTERED_CLIFF_BOUNDARY",samples:[],
        terrainRevision:this.renderedSurfaceGeometryRevision,cliffRevision:this.renderedCliffGeometryRevision};
    }
    const samples=[];
    // Corners plus the THREE existing micro-region edge centres, sampled on
    // their exact world XZ coordinates, not a second tessellation.
    const edgeFractions=[0,1/6,.5,5/6,1];
    for(let i=0;i<edgeFractions.length;i++){
      const t=edgeFractions[i];
      const x=dx!==0?(Number(from.x)+dx*.5)*TILE_SIZE:(Number(from.x)-.5+t)*TILE_SIZE;
      const z=dz!==0?(Number(from.y)+dz*.5)*TILE_SIZE:(Number(from.y)-.5+t)*TILE_SIZE;
      const a=this.publishedSurfacePoint(from,x,z),b=this.publishedSurfacePoint(to,x,z);
      if(!a||!b)return{ok:false,reason:"MISSING_PUBLISHED_SURFACE",samples:[],
        terrainRevision:this.renderedSurfaceGeometryRevision,cliffRevision:this.renderedCliffGeometryRevision};
      // Distinct heights here mean no watertight smooth-terrain handoff exists.
      // Never draw a synthetic midpoint between the two surfaces.
      if(Math.abs(a.y-b.y)>EPSILON*100)return{ok:false,reason:"SURFACE_SEAM_HEIGHT_MISMATCH",samples:[],
        terrainRevision:this.renderedSurfaceGeometryRevision,cliffRevision:this.renderedCliffGeometryRevision,
        mismatch:{x,z,fromY:a.y,toY:b.y}};
      samples.push({x,y:a.y,z,fromTriangle:a.triangleIndex,toTriangle:b.triangleIndex,t});
    }
    return{ok:true,reason:"PUBLISHED_SURFACE_SEAM",samples,
      terrainRevision:this.renderedSurfaceGeometryRevision,cliffRevision:this.renderedCliffGeometryRevision};
  }

  // Read-only TILE-scale inventory of REAL hydrology edges. This deliberately
  // does not create microcell storage or a second water state. It will feed the
  // shared sheet-flow solve; every incident Q edge is represented once.
  sheetFlowBoundaryNetwork(tiles,edges){
    const nodes=new Map();
    for(const tile of tiles||[]){
      if(!tile)continue;
      const tileKey=this.keyOf(tile.x,tile.y);
      nodes.set(tileKey,{tileKey,waterDepth:waterDepthOf(tile),sourceRate:tile.hydrologySource===true&&tile.hydrologySourceDisabled!==true
        ?Math.max(0,Number(tile.hydrologySourceInflow||0)):0,
        incoming:[],outgoing:[],qIn:0,qOut:0});
    }
    const seen=new Set();
    for(const edge of edges||[]){
      const from=edge?.from,to=edge?.to;
      if(!from||!to)continue;
      const fromKey=this.keyOf(from.x,from.y),toKey=this.keyOf(to.x,to.y);
      const id=`${fromKey}->${toKey}`;
      if(seen.has(id))continue;
      seen.add(id);
      // HydrologyEngine separates sustained source Q from an actual per-turn
      // solver transfer. edgeDischarge is intentionally ZERO for a rain pulse;
      // nullish fallback (edgeDischarge ?? rate) therefore silently discarded
      // real, measured runoff. Never add the two rates: edgeFlowState already
      // gives one authoritative rate, with persistent transport taking priority.
      const persistentRate=Math.max(0,Number(edge.persistentRate||0),Number(edge.edgeDischarge||0));
      const transientRate=Math.max(0,Number(edge.solverRate||0),Number(edge.rate||0));
      const q=persistentRate>EPSILON?persistentRate:transientRate;
      if(q<=EPSILON)continue;
      const a=nodes.get(fromKey),b=nodes.get(toKey);
      if(!a||!b)continue;
      const seam=this.publishedSheetBoundary(from,to);
      const record={id,q,qKind:persistentRate>EPSILON?"PERSISTENT":"MEASURED",
        persistentRate,measuredRate:persistentRate>EPSILON?0:transientRate,
        fromKey,toKey,cascade:edge.cascade===true,
        transportVolume:Math.max(0,Number(edge.transportVolume??edge.volume??0)),
        geometryJoin:seam.reason,geometryJoinValid:seam.ok,terrainRevision:seam.terrainRevision,
        cliffRevision:seam.cliffRevision};
      a.outgoing.push(record);a.qOut+=q;b.incoming.push(record);b.qIn+=q;
    }
    for(const node of nodes.values()){
      node.incoming.sort((a,b)=>a.id.localeCompare(b.id));
      node.outgoing.sort((a,b)=>a.id.localeCompare(b.id));
    }
    return nodes;
  }

  // This is a PRESENTATION solve of a single tile's moving Q-only sheet,
  // not another hydrological storage grid. The published per-turn transport
  // volume supplies the sole scale of the visible cross-section. It is a
  // one-turn *transit proxy*, never a replacement for gameplay waterDepth.
  // The surface is fitted to the actual registered terrain triangles, then
  // clipped and volume-normalized; all sheet XYZ is derived from those faces.
  sheetFlowTileSurfaces(tiles,network){
    const results=new Map();
    const area=(a,b,c)=>Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))/2;
    const vertexKey=p=>`${Number(p.x).toFixed(9)},${Number(p.z).toFixed(9)}`;
    const clipWet=triangle=>{
      const out=[];
      for(let i=0;i<triangle.length;i++){
        const a=triangle[i],b=triangle[(i+1)%triangle.length];
        const aWet=a.depth>0,bWet=b.depth>0;
        if(aWet)out.push(a);
        if(aWet!==bWet){
          const t=a.depth/(a.depth-b.depth);
          out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,
            z:a.z+(b.z-a.z)*t,depth:0});
        }
      }
      return out;
    };
    // Film depth on each emitted triangle is affine. Its volume is exactly
    // the projected triangle area multiplied by average positive depth.
    const integration=polygon=>{
      let wetArea=0,volume=0;
      for(let i=1;i+1<polygon.length;i++){
        const a=polygon[0],b=polygon[i],c=polygon[i+1],aXZ=area(a,b,c);
        wetArea+=aXZ;volume+=aXZ*(a.depth+b.depth+c.depth)/3;
      }
      return {wetArea,volume};
    };
    // The published terrain owns real rugged cliff shoulders *outside* the
    // nominal gameplay square. They MUST stay rendered, but a tile's Q proxy
    // is normalized over its gameplay footprint, not over the extra decoration
    // area. Clip only the volume INTEGRAL; never trim the emitted water mesh.
    const clipToTile=(polygon,minX,maxX,minZ,maxZ)=>{
      let result=polygon;
      const boundaries=[
        [p=>p.x-minX,(a,b)=> (minX-a.x)/(b.x-a.x)],
        [p=>maxX-p.x,(a,b)=> (maxX-a.x)/(b.x-a.x)],
        [p=>p.z-minZ,(a,b)=> (minZ-a.z)/(b.z-a.z)],
        [p=>maxZ-p.z,(a,b)=> (maxZ-a.z)/(b.z-a.z)]
      ];
      for(const [signed,ratio] of boundaries){
        if(!result.length)break;
        const clipped=[];
        for(let i=0;i<result.length;i++){
          const a=result[i],b=result[(i+1)%result.length];
          const insideA=signed(a)>=-EPSILON,insideB=signed(b)>=-EPSILON;
          if(insideA)clipped.push(a);
          if(insideA!==insideB){
            const t=Math.max(0,Math.min(1,ratio(a,b)));
            clipped.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,
              z:a.z+(b.z-a.z)*t,depth:a.depth+(b.depth-a.depth)*t});
          }
        }
        result=clipped;
      }
      return result;
    };
    function solveHeight(volumeAt,target,low,high){
      if(volumeAt(low)>target+EPSILON)return null;
      for(let i=0;i<50&&volumeAt(high)<target;i++)high=high*2+Math.max(1,high-low);
      if(volumeAt(high)<target)return null;
      for(let i=0;i<42;i++){
        const mid=(low+high)*.5;
        if(volumeAt(mid)<target)low=mid;else high=mid;
      }
      return (low+high)/2;
    }
    for(const tile of tiles||[]){
      if(!tile||hasStoredWaterDepth(tile))continue;
      const key=this.keyOf(tile.x,tile.y),node=network?.get(key);
      const geometry=this.getRenderedSurfaceGeometry(tile);
      if(!node)continue;
      node.sheetStatus="NOT_SOLVED";
      node.sheetRejectReason=null;
      node.sheetRejectedEdges=[];
      node.sheetAcceptedEdges=[];
      if(!geometry?.triangles?.length){node.sheetRejectReason="MISSING_PUBLISHED_SURFACE";continue;}
      const allEdges=[...(node.incoming||[]),...(node.outgoing||[])];
      // A cliff or an invalid seam is a property of ONE edge, not the entire
      // tile. One rugged wall must never cancel valid dry-ground streams on
      // the other sides of a spring or confluence. Real cliff Q keeps its
      // existing waterfall renderer; no fake ramp is constructed here.
      const edges=allEdges.filter(edge=>!edge.cascade&&edge.geometryJoinValid);
      node.sheetAcceptedEdges=edges.map(edge=>edge.id);
      node.sheetRejectedEdges=allEdges.filter(edge=>!edges.includes(edge))
        .map(edge=>({id:edge.id,reason:edge.cascade?"CASCADE":edge.geometryJoin||"INVALID_PUBLISHED_SEAM"}));
      if(!edges.length){node.sheetRejectReason=allEdges.length?"NO_VALID_SURFACE_EDGE":"NO_Q_EDGE";continue;}
      const incoming=(node.incoming||[]).filter(edge=>edges.includes(edge)).reduce((sum,e)=>sum+Number(e.transportVolume||0),0);
      const outgoing=(node.outgoing||[]).filter(edge=>edges.includes(edge)).reduce((sum,e)=>sum+Number(e.transportVolume||0),0);
      const transit=Math.max(incoming,outgoing);
      if(transit<=EPSILON){node.sheetRejectReason="NO_TRANSPORT_VOLUME";continue;}
      const triangles=geometry.triangles;
      const minX=(Number(tile.x)-.5)*TILE_SIZE,maxX=minX+TILE_SIZE;
      const minZ=(Number(tile.y)-.5)*TILE_SIZE,maxZ=minZ+TILE_SIZE;
      const withinTile=p=>p.x>=minX-EPSILON&&p.x<=maxX+EPSILON&&p.z>=minZ-EPSILON&&p.z<=maxZ+EPSILON;
      const coreClassification=triangles.map(tri=>tri.every(withinTile)?"CORE":"SHOULDER");
      const renderedProjectedArea=triangles.reduce((sum,tri)=>sum+area(...tri),0);
      const coreProjectedArea=triangles.reduce((sum,tri,i)=>sum+
        (coreClassification[i]==="CORE"?area(...tri):integration(
          clipToTile(tri.map(p=>({...p,depth:1})),minX,maxX,minZ,maxZ)).wetArea),0);
      let weight=0,cx=0,cy=0,cz=0;
      for(const tri of triangles){
        const w=area(...tri);if(w<=EPSILON)continue;
        weight+=w;
        cx+=w*(tri[0].x+tri[1].x+tri[2].x)/3;
        cy+=w*(tri[0].y+tri[1].y+tri[2].y)/3;
        cz+=w*(tri[0].z+tri[1].z+tri[2].z)/3;
      }
      if(weight<=EPSILON){node.sheetRejectReason="DEGENERATE_PUBLISHED_SURFACE";continue;}
      cx/=weight;cy/=weight;cz/=weight;
      let xx=0,xz=0,zz=0,xy=0,zy=0;
      for(const tri of triangles){
        const w=area(...tri);if(w<=EPSILON)continue;
        const x=(tri[0].x+tri[1].x+tri[2].x)/3-cx;
        const z=(tri[0].z+tri[1].z+tri[2].z)/3-cz;
        const y=(tri[0].y+tri[1].y+tri[2].y)/3-cy;
        xx+=w*x*x;xz+=w*x*z;zz+=w*z*z;xy+=w*x*y;zy+=w*z*y;
      }
      const determinant=xx*zz-xz*xz;
      const sx=determinant>EPSILON?(xy*zz-zy*xz)/determinant:0;
      const sz=determinant>EPSILON?(zy*xx-xy*xz)/determinant:0;
      const residual=new Map();
      for(const tri of triangles)for(const p of tri){
        const k=vertexKey(p),relative=cy+sx*(p.x-cx)+sz*(p.z-cz)-p.y;
        residual.set(k,relative);
      }
      const values=[...residual.values()];if(!values.length)continue;
      const lowest=-Math.max(...values),highest=-Math.min(...values);
      const target=transit*TILE_SIZE*TILE_SIZE*ELEVATION_HEIGHT;
      const calculate=(offset,locked=null,emit=false)=>{
        let wetArea=0,coreWetArea=0,volume=0,renderedVolume=0;
        const polygons=[];
        const depths=emit?new Map():null;
        for(let triangleIndex=0;triangleIndex<triangles.length;triangleIndex++){
          const tri=triangles[triangleIndex];
          const points=tri.map(p=>{
            const k=vertexKey(p),raw=locked?.has(k)?locked.get(k):residual.get(k)+offset;
            if(depths)depths.set(k,Math.max(0,raw));
            return {...p,depth:raw};
          });
          const wet=clipWet(points);
          if(wet.length<3)continue;
          const measurement=integration(wet);
          wetArea+=measurement.wetArea;
          if(emit)renderedVolume+=measurement.volume;
          const coreWet=coreClassification[triangleIndex]==="CORE"?measurement:
            integration(clipToTile(wet,minX,maxX,minZ,maxZ));
          volume+=coreWet.volume;
          if(emit)coreWetArea+=coreWet.wetArea;
          if(emit&&measurement.wetArea>EPSILON)polygons.push({triangleIndex,points:wet});
        }
        return {wetArea,coreWetArea,volume,renderedVolume,polygons,depths};
      };
      const baseline=solveHeight(off=>calculate(off).volume,target,lowest,highest+target/weight);
      if(baseline==null){node.sheetRejectReason="NO_WET_SOLUTION";continue;}
      const preliminary=calculate(baseline,null,true);
      let fx=0,fz=0;
      for(const edge of edges){
        const [ax,az]=edge.fromKey.split(',').map(Number),[bx,bz]=edge.toKey.split(',').map(Number);
        fx+=(bx-ax)*edge.q;fz+=(bz-az)*edge.q;
      }
      const magnitude=Math.hypot(fx,fz);
      node.sheetStatus="CANDIDATE";
      results.set(key,{tile,key,triangles,geometryRevision:geometry.revision,
        targetVolume:target,transportVolume:transit,initialDepths:preliminary.depths,
        nominalTileArea:TILE_SIZE*TILE_SIZE,renderedProjectedArea,coreProjectedArea,
        residual,calculate,locked:new Map(),baseline,
        boundaryEdges:edges,flow:{x:magnitude?fx/magnitude:0,z:magnitude?fz/magnitude:0},
        model:'REGISTERED_TERRAIN_TRANSIT_SHEET'});
    }
    // The same registered edge coordinates are used by both adjacent dry tiles.
    // Avoid mismatch: a seam is wet only if both sides have a valid Q edge.
    const tileByKey=new Map((tiles||[]).map(tile=>[this.keyOf(tile.x,tile.y),tile]));
    for(const result of results.values()){
      const t=result.tile;
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const neighbor=tileByKey.get(this.keyOf(t.x+dx,t.y+dz));
        const other=neighbor&&results.get(this.keyOf(neighbor.x,neighbor.y));
        const forward=`${result.key}->${other?.key}`,reverse=`${other?.key}->${result.key}`;
        const valid=!!other&&result.boundaryEdges.some(edge=>(edge.id===forward||edge.id===reverse)&&edge.geometryJoinValid);
        if(valid&&result.key>other.key)continue;
        const xEdge=(t.x+dx*.5)*TILE_SIZE,zEdge=(t.y+dz*.5)*TILE_SIZE;
        const samples=new Set();
        for(const tri of result.triangles)for(const p of tri){
          if(Math.abs((dx!==0?p.x-xEdge:p.z-zEdge))<=EPSILON*10)samples.add(vertexKey(p));
        }
        for(const k of samples){
          const shared=valid?Math.min(result.initialDepths.get(k)||0,other.initialDepths.get(k)||0):0;
          result.locked.set(k,shared);
          if(valid)other.locked.set(k,shared);
        }
      }
    }
    const candidateKeys=new Set(results.keys());
    for(const result of results.values()){
      const values=[...result.residual.values()];
      const low=-Math.max(...values),high=-Math.min(...values)+result.targetVolume/(TILE_SIZE*TILE_SIZE*ELEVATION_HEIGHT);
      const minimal=result.calculate(low,result.locked);
      // A locked boundary with excessive wet volume cannot be reconciled by
      // the local solver. Fail the sheet instead of publishing fake water.
      if(minimal.volume>result.targetVolume+EPSILON){
        network.get(result.key).sheetRejectReason="SEAM_LOCK_EXCEEDS_VOLUME";
        results.delete(result.key);continue;
      }
      const offset=solveHeight(h=>result.calculate(h,result.locked).volume,result.targetVolume,low,high);
      if(offset==null){network.get(result.key).sheetRejectReason="SEAM_VOLUME_UNSOLVABLE";results.delete(result.key);continue;}
      const solved=result.calculate(offset,result.locked,true);
      if(!solved.polygons.length){network.get(result.key).sheetRejectReason="WET_TRIANGLES_CLIPPED";results.delete(result.key);continue;}
      result.polygons=solved.polygons;
      result.wetArea=solved.wetArea;
      result.coreWetArea=solved.coreWetArea;
      result.shoulderWetArea=Math.max(0,solved.wetArea-solved.coreWetArea);
      result.shoulderProjectedArea=Math.max(0,result.renderedProjectedArea-result.coreProjectedArea);
      result.renderedVolumeProxy=solved.renderedVolume;
      result.volumeProxyAfterSeam=solved.volume;
      result.maxDepth=Math.max(0,...solved.depths.values());
      result.minDepth=0;
      network.get(result.key).sheetStatus="SOLVED";
      delete result.initialDepths;delete result.locked;delete result.residual;delete result.calculate;
    }
    // If a paired seam fails after the coupled budget solve, discard its
    // connected candidate sheets as well. The legacy surface renderer remains
    // available; never leave a partially solved positive seam hanging.
    let changed=true;
    while(changed){
      changed=false;
      for(const entry of [...results.values()]){
        const disconnected=entry.boundaryEdges.some(edge=>{
          const other=edge.fromKey===entry.key?edge.toKey:edge.fromKey;
          return candidateKeys.has(other)&&!results.has(other);
        });
        if(disconnected){
          const node=network.get(entry.key);
          if(node){node.sheetStatus="REJECTED";node.sheetRejectReason="NEIGHBOR_SHEET_REJECTED";}
          results.delete(entry.key);changed=true;
        }
      }
    }
    for(const node of network?.values()||[]){
      if(node.sheetStatus==="CANDIDATE")node.sheetStatus="REJECTED";
      if(node.sheetStatus==="NOT_SOLVED")node.sheetStatus="REJECTED";
    }
    return results;
  }

  // Transport-only water has Q but no gameplay depth. This is a shared
  // PRESENTATION footprint, derived from the existing 3x3 sampling resolution
  // and the published terrain triangles. It does not create hydrology storage.
  // No Renderer may extrapolate a surface height outside these triangles.
  transportHalfWidth(edge){
    const from=edge?.from;
    const microWidth=TILE_SIZE/Math.sqrt(MICRO_REGION_LAYOUT.length);
    const discharge=Math.max(0,Number(edge?.edgeDischarge??edge?.persistentRate??edge?.rate??0));
    const outgoing=Object.values(from?.hydrologyEdgeDischarge||{}).reduce((sum,item)=>sum+Math.max(0,Number(item?.rate||0)),0);
    return microWidth*.5*(outgoing>EPSILON?Math.min(1,discharge/outgoing):1);
  }

  // The authoritative Q graph is tile-scale, while actual land contours are
  // resolved on the existing 3x3 microregions. A straight line between tile
  // centres is NOT a stream bed. Resolve each Q edge onto the published terrain
  // height field before generating its visible wet footprint.
  transportSurfacePath(edge){
    const from=edge?.from,to=edge?.to;
    if(!from||!to)return [];
    const dx=Number(to.x)-Number(from.x),dz=Number(to.y)-Number(from.y);
    if(Math.abs(dx)+Math.abs(dz)!==1)return [];
    const terrains=[from,to].map(tile=>this.getRenderedSurfaceGeometry(tile)?.triangles||[]);
    if(terrains.some(tris=>!tris.length))return [];
    const sampleY=(point,tile)=>this.publishedSurfacePoint(tile,point.x,point.z)?.y??null;
    const nodes=new Map(),links=new Map();
    const put=(id,x,z,tile)=>{
      const y=sampleY({x,z},tile);if(y==null)return;
      nodes.set(id,{id,x,y,z});links.set(id,[]);
    };
    const connect=(a,b)=>{
      if(!nodes.has(a)||!nodes.has(b))return;
      const p=nodes.get(a),q=nodes.get(b);
      const horizontal=Math.hypot(p.x-q.x,p.z-q.z);
      if(horizontal<=EPSILON)return;
      links.get(a).push({id:b,length:horizontal,rise:Math.max(0,q.y-p.y)});
      links.get(b).push({id:a,length:horizontal,rise:Math.max(0,p.y-q.y)});
    };
    const coords=[-1/3,0,1/3];
    for(let tileIndex=0;tileIndex<2;tileIndex++){
      const tile=tileIndex===0?from:to;
      for(let row=0;row<3;row++)for(let col=0;col<3;col++)
        put(`${tileIndex}:${row}:${col}`,(Number(tile.x)+coords[col])*TILE_SIZE,(Number(tile.y)+coords[row])*TILE_SIZE,tile);
      for(let row=0;row<3;row++)for(let col=0;col<3;col++){
        for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){
          const rr=row+dr,cc=col+dc;
          if(rr>=0&&rr<3&&cc>=0&&cc<3)connect(`${tileIndex}:${row}:${col}`,`${tileIndex}:${rr}:${cc}`);
        }
      }
    }
    const seam=this.publishedSheetBoundary(from,to);
    if(!seam.ok)return [];
    for(let lateral=0;lateral<3;lateral++){
      // Shared boundary samples use the *same world XZ* for both tiles.
      // They are not guessed tile-centre crossings or separate water heights.
      const x=dx!==0?(Number(from.x)+dx*.5)*TILE_SIZE:(Number(from.x)+coords[lateral])*TILE_SIZE;
      const z=dz!==0?(Number(from.y)+dz*.5)*TILE_SIZE:(Number(from.y)+coords[lateral])*TILE_SIZE;
      const p=seam.samples[lateral+1];
      if(!p)continue;
      const id=`seam:${lateral}`;
      nodes.set(id,{id,x:p.x,z:p.z,y:p.y});links.set(id,[]);
      if(dx!==0){
        const fromCol=dx>0?2:0,toCol=dx>0?0:2;
        connect(`${0}:${lateral}:${fromCol}`,id);connect(id,`${1}:${lateral}:${toCol}`);
      }else{
        const fromRow=dz>0?2:0,toRow=dz>0?0:2;
        connect(`${0}:${fromRow}:${lateral}`,id);connect(id,`${1}:${toRow}:${lateral}`);
      }
    }
    const source='0:1:1',sink='1:1:1';if(!nodes.has(source)||!nodes.has(sink))return [];
    // Minimise uphill crossing before path length. This uses real world-space
    // terrain elevations; Q direction still owns which tile receives water.
    // No new hydrological storage, runoff rate, or guessed visual meander.
    const scores=new Map([[source,{rise:0,length:0}]]),previous=new Map(),settled=new Set();
    while(true){
      let current=null;
      for(const [id,score] of scores){
        if(settled.has(id))continue;
        if(current===null){current=id;continue;}
        const old=scores.get(current);
        if(score.rise<old.rise-EPSILON||(Math.abs(score.rise-old.rise)<=EPSILON&&score.length<old.length-EPSILON))current=id;
      }
      if(current===null||current===sink)break;
      settled.add(current);
      const base=scores.get(current);
      for(const link of links.get(current)||[]){
        const candidate={rise:base.rise+link.rise,length:base.length+link.length};
        const old=scores.get(link.id);
        if(!old||candidate.rise<old.rise-EPSILON||(Math.abs(candidate.rise-old.rise)<=EPSILON&&candidate.length<old.length-EPSILON)){
          scores.set(link.id,candidate);previous.set(link.id,current);
        }
      }
    }
    if(!scores.has(sink))return [];
    const result=[],seen=new Set();let current=sink;
    while(current&& !seen.has(current)){
      seen.add(current);result.push(nodes.get(current));current=previous.get(current);
    }
    return result.reverse();
  }

  transportSurfaceFootprint(edge,segment,{surfaceTriangles=null}={}){
    const from=edge?.from,to=edge?.to;
    if(!from||!to||!segment)return{polygons:[],halfWidth:0};
    const halfWidth=this.transportHalfWidth(edge);
    if(halfWidth<=EPSILON)return{polygons:[],halfWidth:0};
    const path=this.transportSurfacePath(edge);
    if(path.length<2)return{polygons:[],halfWidth,path:[]};
    const pathLengths=[0];
    for(let i=1;i<path.length;i++)pathLengths.push(pathLengths[i-1]+Math.hypot(path[i].x-path[i-1].x,path[i].z-path[i-1].z));
    const startLength=Math.max(0,Number(segment.start))*pathLengths.at(-1),endLength=Math.min(1,Number(segment.end))*pathLengths.at(-1);
    const nearest=point=>{
      let best=null;
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i],vx=b.x-a.x,vz=b.z-a.z,den=vx*vx+vz*vz;
        if(den<=EPSILON)continue;
        const t=Math.max(0,Math.min(1,((point.x-a.x)*vx+(point.z-a.z)*vz)/den));
        const x=a.x+vx*t,z=a.z+vz*t,dx=point.x-x,dz=point.z-z;
        const distance=Math.hypot(dx,dz),along=pathLengths[i-1]+Math.sqrt(den)*t;
        if(along<startLength-EPSILON||along>endLength+EPSILON)continue;
        if(!best||distance<best.distance)best={distance,along,across:(vx*dz-vz*dx)/Math.sqrt(den)};
      }
      return best||{distance:Infinity,along:0,across:Infinity};
    };
    const clip=(poly)=>{
      const result=[];
      for(let i=0;i<poly.length;i++){
        const a=poly[i],b=poly[(i+1)%poly.length],da=halfWidth-a.distance,db=halfWidth-b.distance;
        const inA=da>=-EPSILON,inB=db>=-EPSILON;
        if(inA)result.push(a);
        if(inA!==inB){
          const t=da/(da-db),x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,z=a.z+(b.z-a.z)*t;
          const along=a.along+(b.along-a.along)*t;
          result.push({x,y,z,along,across:a.across+(b.across-a.across)*t,distance:halfWidth,
            ...(a.clearance!=null&&b.clearance!=null?{clearance:a.clearance+(b.clearance-a.clearance)*t}:{})});
        }
      }
      return result;
    };
    const polygons=[];
    // Refine each registered 3x3 triangle in its OWN plane, so even at a narrow
    // Q split there are vertices to resolve the wet edge. Every new XYZ is a
    // barycentric interpolation of actual TerrainRenderer mesh vertices.
    const subdivisions=Math.sqrt(MICRO_REGION_LAYOUT.length)*2;
    for(const tile of [from,to]){
      const terrain=this.getRenderedSurfaceGeometry(tile);
      const surfaces=typeof surfaceTriangles==='function'?surfaceTriangles(tile,terrain?.triangles||[]):terrain?.triangles||[];
      for(const polygon of surfaces){
        for(let fan=1;fan<polygon.length-1;fan++){
          const tri=[polygon[0],polygon[fan],polygon[fan+1]];
          const lattice=[];
          for(let i=0;i<=subdivisions;i++){
            const row=[];
            for(let j=0;j<=subdivisions-i;j++){
              const u=i/subdivisions,v=j/subdivisions,w=1-u-v;
              const point={x:tri[0].x*w+tri[1].x*u+tri[2].x*v,
                y:tri[0].y*w+tri[1].y*u+tri[2].y*v,
                z:tri[0].z*w+tri[1].z*u+tri[2].z*v};
              if(tri.every(p=>p.clearance!=null))point.clearance=tri[0].clearance*w+tri[1].clearance*u+tri[2].clearance*v;
              row.push({...point,...nearest(point)});
            }
            lattice.push(row);
          }
          const insert=(vertices)=>{
            if(!vertices.some(p=>p.distance<=halfWidth+EPSILON))return;
            const wet=clip(vertices);
            if(wet.length<3)return;
            const distinct=wet.filter((p,i)=>Math.hypot(p.x-wet[(i+wet.length-1)%wet.length].x,p.z-wet[(i+wet.length-1)%wet.length].z)>EPSILON);
            if(distinct.length<3)return;
            polygons.push({tile,points:distinct.map(p=>({...p,bankFade:Math.max(0,1-p.distance/halfWidth),along:p.along/TILE_SIZE}))});
          };
          for(let i=0;i<subdivisions;i++)for(let j=0;j<subdivisions-i;j++){
            insert([lattice[i][j],lattice[i+1][j],lattice[i][j+1]]);
            if(j<subdivisions-i-1)insert([lattice[i+1][j],lattice[i+1][j+1],lattice[i][j+1]]);
          }
        }
      }
    }
    return{polygons,halfWidth,path,revision:this.renderedSurfaceGeometryRevision};
  }

  cliffGeometryKey(tile,dir){
    const id=this.cliffDirectionId(dir);
    return tile&&id?`${Number(tile.x)},${Number(tile.y)}:${id}`:null;
  }

  clearRenderedCliffGeometry(){
    this.renderedCliffGeometry.clear();
    this.renderedCliffGeometryRevision++;
  }

  registerRenderedCliffGeometry(tile,dir,geometry){
    const key=this.cliffGeometryKey(tile,dir);if(!key||!geometry)return null;
    const cloneSeries=series=>(series||[]).map(point=>({
      x:Number(point.x),y:Number(point.y),z:Number(point.z),t:Number(point.t||0),
      ...(point.normal?{normal:{x:Number(point.normal.x||0),z:Number(point.normal.z||0)}}:{})
    }));
    const cloneSegment=segment=>({
      topA:{x:Number(segment.topA.x),y:Number(segment.topA.y),z:Number(segment.topA.z)},
      topB:{x:Number(segment.topB.x),y:Number(segment.topB.y),z:Number(segment.topB.z)},
      bottomA:{x:Number(segment.bottomA.x),y:Number(segment.bottomA.y),z:Number(segment.bottomA.z)},
      bottomB:{x:Number(segment.bottomB.x),y:Number(segment.bottomB.y),z:Number(segment.bottomB.z)},
      normal:{x:Number(segment.normal?.x||0),z:Number(segment.normal?.z||0)},
      // TerrainRenderer's exact submitted rock faces, not an inferred quad.
      faces:(segment.faces||[]).map(face=>({vertices:(face.vertices||[]).map(p=>({
        x:Number(p.x),y:Number(p.y),z:Number(p.z),u:Number(p.u),v:Number(p.v)
      }))}))
    });
    const stored={
      key,revision:this.renderedCliffGeometryRevision,
      lip:cloneSeries(geometry.lip),foot:cloneSeries(geometry.foot),
      segments:(geometry.segments||[]).map(cloneSegment),
      outward:{x:Number(geometry.outward?.x||0),z:Number(geometry.outward?.z||0)},
      drop:Number(geometry.drop||0)
    };
    this.renderedCliffGeometry.set(key,stored);return stored;
  }

  getRenderedCliffGeometry(tile,dir){
    const key=this.cliffGeometryKey(tile,dir);
    return key?this.renderedCliffGeometry.get(key)||null:null;
  }

  keyOf(x,y){return keyOf(x,y);}
  tileAt(byKey,x,y){return byKey?.get(keyOf(x,y))||null;}
  elevationOf(tile){return elevationOf(tile);}
  waterDepthOf(tile){return waterDepthOf(tile);}
  baseTerrainOf(tile){return baseTerrainOf(tile);}

  canSlope(a,b){
    return !!a&&!!b&&Math.abs(elevationOf(a)-elevationOf(b))<=this.maxVisualSlopeDelta;
  }

  dryColor(tile){
    return VISUAL_TERRAIN_COLORS[baseTerrainOf(tile)]||VISUAL_TERRAIN_COLORS.DEFAULT;
  }

  surfaceBlendAmount(value){
    // One continuous appearance field between neighbouring tile centres.
    // Shared borders are exactly 50/50 and smoothstep removes visible grid seams.
    return .5*smooth01(clamp01(Math.abs(Number(value||0))*2));
  }

  materialWeightsAt(tile,byKey,ox=0,oz=0){
    // Texture identity only; moisture/depth/fog tint remains in surfaceColorAt.
    const weightsOf=value=>{
      const terrain=baseTerrainOf(value);
      if(terrain==="SAND")return[0,0,0,1];
      if(terrain==="HIGH_GROUND"||terrain==="WALL")return[0,0,1,0];
      if(terrain==="MUD"||terrain==="WATER")return[0,1,0,0];
      if(terrain==="FOREST")return[.72,.28,0,0];
      return[1,0,0,0];
    };
    const mixWeights=(a,b,t)=>a.map((value,index)=>value+(b[index]-value)*t);
    const local=weightsOf(tile);

    // Keep submerged beds independent of neighbouring dry materials.
    if(waterDepthOf(tile)>0)return local;

    const px=Math.max(-.5,Math.min(.5,Number(ox||0)));
    const pz=Math.max(-.5,Math.min(.5,Number(oz||0)));
    const sx=Math.sign(px),sz=Math.sign(pz);
    const tx=this.surfaceBlendAmount(px),tz=this.surfaceBlendAmount(pz);
    const dryConnected=(from,to)=>!!to&&waterDepthOf(to)<=0&&this.canSlope(from,to);

    const rawX=sx?this.tileAt(byKey,tile.x+sx,tile.y):null;
    const rawZ=sz?this.tileAt(byKey,tile.x,tile.y+sz):null;
    const xTile=dryConnected(tile,rawX)?rawX:tile;
    const zTile=dryConnected(tile,rawZ)?rawZ:tile;

    let diagonal=tile;
    if(sx&&sz){
      const candidate=this.tileAt(byKey,tile.x+sx,tile.y+sz);
      const joinsX=candidate&&rawX&&dryConnected(rawX,candidate);
      const joinsZ=candidate&&rawZ&&dryConnected(rawZ,candidate);
      if(candidate&&waterDepthOf(candidate)<=0&&(joinsX||joinsZ))diagonal=candidate;
      else if(xTile!==tile)diagonal=xTile;
      else if(zTile!==tile)diagonal=zTile;
    }

    const nearRow=mixWeights(local,weightsOf(xTile),tx);
    const farRow=mixWeights(weightsOf(zTile),weightsOf(diagonal),tx);
    return mixWeights(nearRow,farRow,tz);
  }

  moistureAmount(tile){
    const terrain=baseTerrainOf(tile);
    const cap=terrain==="SAND"?.22:.45;
    return clamp01(Math.max(0,Number(tile?.soilMoisture||0))/cap);
  }

  wetDryColor(tile,amount=this.moistureAmount(tile)){
    const terrain=baseTerrainOf(tile);
    const base=this.dryColor(tile);
    const wet=clamp01(amount);
    if(wet<=0)return base;
    if(terrain==="SAND")return mixColor(base,WET_SAND,.72*wet);
    if(terrain==="FOREST")return mixColor(base,WET_FOREST,.58*wet);
    if(terrain==="HIGH_GROUND"||tile?.material==="ROCK")return mixColor(base,WET_ROCK,.48*wet);
    if(terrain==="MUD")return mixColor(base,WET_MUD,.65*wet);
    return mixColor(base,WET_GRASS,.62*wet);
  }

  submergedBedColor(tile,depth=waterDepthOf(tile)){
    const terrain=baseTerrainOf(tile);
    const base=this.dryColor(tile);
    const d=Math.max(0,Number(depth||0));
    let shallowTarget=SILT_BANK;
    if(terrain==="SAND")shallowTarget=WET_SAND;
    else if(terrain==="FOREST")shallowTarget=FOREST_SOIL;
    else if(terrain==="HIGH_GROUND"||tile?.material==="ROCK")shallowTarget=WET_ROCK;
    else if(terrain==="MUD")shallowTarget=SILT_BANK;

    // Underwater material is derived from the bed itself, never from a dry
    // neighbour. This keeps grass colour from bleeding into submerged slopes.
    const shallow=smooth01(d/.30);
    const deep=smooth01(d/WATERBED_DEPTH_RANGE);
    const bed=mixColor(base,shallowTarget,.78*shallow);
    return mixColor(bed,WATERBED_DEEP,.70*deep);
  }

  colorOf(tile){
    const depth=waterDepthOf(tile);
    return depth>0?this.submergedBedColor(tile,depth):this.wetDryColor(tile);
  }

  mixTileColors(tiles){
    return averageColors((tiles||[]).filter(Boolean).map(tile=>this.colorOf(tile)));
  }

  slopeConnectedCornerTiles(tile,byKey,dx,dy){
    const candidates=[
      tile,
      this.tileAt(byKey,tile.x+dx,tile.y),
      this.tileAt(byKey,tile.x,tile.y+dy),
      this.tileAt(byKey,tile.x+dx,tile.y+dy)
    ].filter(Boolean);
    const result=[tile];
    const included=new Set([keyOf(tile.x,tile.y)]);
    let changed=true;
    while(changed){
      changed=false;
      for(const candidate of candidates){
        const candidateKey=keyOf(candidate.x,candidate.y);
        if(included.has(candidateKey))continue;
        const joins=result.some(member=>{
          const cardinal=Math.abs(member.x-candidate.x)+Math.abs(member.y-candidate.y)===1;
          return cardinal&&this.canSlope(member,candidate);
        });
        if(!joins)continue;
        included.add(candidateKey);result.push(candidate);changed=true;
      }
    }
    return result;
  }

  cornerSample(tile,byKey,dx,dy){
    const members=this.slopeConnectedCornerTiles(tile,byKey,dx,dy);
    return{height:average(members.map(elevationOf)),color:this.mixTileColors(members)};
  }

  edgeSample(tile,neighbor){
    if(!neighbor||!this.canSlope(tile,neighbor))return{height:elevationOf(tile),color:this.colorOf(tile)};
    return{
      height:(elevationOf(tile)+elevationOf(neighbor))/2,
      color:this.mixTileColors([tile,neighbor])
    };
  }

  ringSamples(tile,byKey){
    return[
      {ox:-.5,oz:-.5,...this.cornerSample(tile,byKey,-1,-1)},
      {ox:0,oz:-.5,...this.edgeSample(tile,this.tileAt(byKey,tile.x,tile.y-1))},
      {ox:.5,oz:-.5,...this.cornerSample(tile,byKey,1,-1)},
      {ox:.5,oz:0,...this.edgeSample(tile,this.tileAt(byKey,tile.x+1,tile.y))},
      {ox:.5,oz:.5,...this.cornerSample(tile,byKey,1,1)},
      {ox:0,oz:.5,...this.edgeSample(tile,this.tileAt(byKey,tile.x,tile.y+1))},
      {ox:-.5,oz:.5,...this.cornerSample(tile,byKey,-1,1)},
      {ox:-.5,oz:0,...this.edgeSample(tile,this.tileAt(byKey,tile.x-1,tile.y))}
    ];
  }

  cliffDirectionId(dir){
    if(dir?.id)return String(dir.id).toUpperCase();
    const dx=Math.sign(Number(dir?.dx||0)),dy=Math.sign(Number(dir?.dy||0));
    if(dx===0&&dy===-1)return"N";
    if(dx===1&&dy===0)return"E";
    if(dx===0&&dy===1)return"S";
    if(dx===-1&&dy===0)return"W";
    return null;
  }

  cliffEdgePoints(tile,dir){
    const id=this.cliffDirectionId(dir);
    if(!tile||!id)return[];
    const cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE,h=TILE_SIZE*.5;
    if(id==="N")return[{x:cx-h,z:cz-h,t:0},{x:cx+h,z:cz-h,t:1}];
    if(id==="E")return[{x:cx+h,z:cz-h,t:0},{x:cx+h,z:cz+h,t:1}];
    if(id==="S")return[{x:cx+h,z:cz+h,t:0},{x:cx-h,z:cz+h,t:1}];
    return[{x:cx-h,z:cz+h,t:0},{x:cx-h,z:cz-h,t:1}];
  }

  cliffSurfaceEdgeSamples(tile,dir,byKey){
    const id=this.cliffDirectionId(dir);
    if(!tile||!id)return[];
    const patch=this.resolveTile(tile,byKey).patchGrid;
    let samples=[];
    if(id==="N")samples=patch[0];
    else if(id==="E")samples=patch.map(row=>row[3]);
    else if(id==="S")samples=[...patch[3]].reverse();
    else samples=[...patch].reverse().map(row=>row[0]);
    return samples.map((sample,index)=>({x:Number(sample.x),z:Number(sample.z),height:Number(sample.height),t:index/Math.max(1,samples.length-1)}));
  }

  cliffRoughPolyline(tile,dir,{segments=CLIFF_EDGE_SEGMENTS,ruggedness=CLIFF_RUGGEDNESS}={}){
    const id=this.cliffDirectionId(dir),edge=this.cliffEdgePoints(tile,dir);
    if(!id||edge.length!==2)return[];
    const [{x:x1,z:z1},{x:x2,z:z2}]=edge,points=[];
    const dx=id==="E"?1:id==="W"?-1:0,dz=id==="S"?1:id==="N"?-1:0;
    const edgeKey=`${Math.min(x1,x2).toFixed(3)},${Math.min(z1,z2).toFixed(3)}:${Math.max(x1,x2).toFixed(3)},${Math.max(z1,z2).toFixed(3)}`;
    const count=Math.max(1,Math.floor(Number(segments||CLIFF_EDGE_SEGMENTS)));
    for(let i=0;i<=count;i++){
      const t=i/count,x=x1+(x2-x1)*t,z=z1+(z2-z1)*t;
      if(i===0||i===count){points.push({x,z,t});continue;}
      const envelope=Math.sin(Math.PI*t),irregular=.28+.72*hash01(`cliff:${edgeKey}:${i}`);
      const offset=TILE_SIZE*Math.max(0,Number(ruggedness||0))*envelope*irregular;
      points.push({x:x+dx*offset,z:z+dz*offset,t});
    }
    return points;
  }

  // No inferred cliff edge/spill geometry is exposed to water. TerrainRenderer
  // owns wall construction and publishes the exact generated vertices above.

  // Deliberately no inferred cliffSpillProfile here. The exact visible wall
  // geometry is registered by TerrainRenderer via registerRenderedCliffGeometry().

  sampleHeightFromRing(centerHeight,ring,ox,oz){
    const px=Math.max(-.5,Math.min(.5,Number(ox||0)));
    const pz=Math.max(-.5,Math.min(.5,Number(oz||0)));
    if(Math.abs(px)<=EPSILON&&Math.abs(pz)<=EPSILON)return Number(centerHeight||0);
    const center={x:0,z:0,height:Number(centerHeight||0)};
    for(let i=0;i<ring.length;i++){
      const b={x:Number(ring[i].ox),z:Number(ring[i].oz),height:Number(ring[i].height)};
      const next=ring[(i+1)%ring.length];
      const c={x:Number(next.ox),z:Number(next.oz),height:Number(next.height)};
      const denom=(b.z-c.z)*(center.x-c.x)+(c.x-b.x)*(center.z-c.z);
      if(Math.abs(denom)<=EPSILON)continue;
      const wa=((b.z-c.z)*(px-c.x)+(c.x-b.x)*(pz-c.z))/denom;
      const wb=((c.z-center.z)*(px-c.x)+(center.x-c.x)*(pz-c.z))/denom;
      const wc=1-wa-wb;
      if(wa>=-1e-6&&wb>=-1e-6&&wc>=-1e-6){
        return wa*center.height+wb*b.height+wc*c.height;
      }
    }
    return center.height;
  }

  sampleHeight(tile,byKey,ox,oz){
    if(!tile)return null;
    return this.sampleHeightFromRing(elevationOf(tile),this.ringSamples(tile,byKey),ox,oz);
  }

  // Sample the exact alternating triangles emitted by TerrainRenderer's 4x4 grid.
  // Props use this instead of inventing a second height field at sloped contacts.
  sampleRenderedHeight(tile,byKey,ox=0,oz=0){
    if(!tile)return 0;
    const x=Math.max(-.5,Math.min(.5,ox)),z=Math.max(-.5,Math.min(.5,oz));
    const col=Math.min(2,Math.floor((x+.5)*3)),row=Math.min(2,Math.floor((z+.5)*3));
    const u=(x-PATCH_OFFSETS[col])*3,v=(z-PATCH_OFFSETS[row])*3,ring=this.ringSamples(tile,byKey);
    const height=(c,r)=>this.sampleHeightFromRing(elevationOf(tile),ring,PATCH_OFFSETS[c],PATCH_OFFSETS[r]);
    const nw=height(col,row),ne=height(col+1,row),sw=height(col,row+1),se=height(col+1,row+1);
    if(((Number(tile.x)+Number(tile.y)+row+col)&1)===0)
      return u>=v?nw*(1-u)+ne*(u-v)+se*v:nw*(1-v)+se*u+sw*(v-u);
    return u+v<=1?nw*(1-u-v)+ne*u+sw*v:ne*(1-v)+se*(u+v-1)+sw*(1-u);
  }

  sampleHeightAtWorld(worldX,worldZ,byKey){
    const tx=Math.round(Number(worldX||0)/TILE_SIZE);
    const ty=Math.round(Number(worldZ||0)/TILE_SIZE);
    const tile=this.tileAt(byKey,tx,ty);
    if(!tile)return null;
    const ox=(Number(worldX||0)-tx*TILE_SIZE)/TILE_SIZE;
    const oz=(Number(worldZ||0)-ty*TILE_SIZE)/TILE_SIZE;
    return this.sampleHeight(tile,byKey,ox,oz);
  }

  edgeInfluence(value){
    // Colour/environment transitions use the same centre-to-centre span as
    // material weights instead of starting only in the outer third of a tile.
    return this.surfaceBlendAmount(value);
  }

  localInfluences(tile,byKey,ox,oz){
    const wx=this.edgeInfluence(ox),wz=this.edgeInfluence(oz);
    const sx=Math.sign(Number(ox||0)),sz=Math.sign(Number(oz||0));
    const out=[];
    const add=(dx,dy,weight,label)=>{
      if(weight<=EPSILON)return;
      const neighbor=this.tileAt(byKey,tile.x+dx,tile.y+dy);
      if(!neighbor)return;
      const snapshot=influenceSnapshot(neighbor,weight,label);
      if(snapshot)out.push(snapshot);
    };
    if(sx)add(sx,0,wx,`${sx},0`);
    if(sz)add(0,sz,wz,`0,${sz}`);
    if(sx&&sz)add(sx,sz,wx*wz*.55,`${sx},${sz}`);
    return out;
  }

  shoreContactAt(tile,byKey,ox=0,oz=0){
    // Presentation only. Build one continuous shoreline-contact field from the
    // four real shared water edges, then bridge only corners that are connected
    // to one of those edges. This keeps the hydrology/grid ownership unchanged
    // while preventing the wet-bank decoration from tracing a hard 90-degree
    // tile mask around lakes and rivers. A diagonal water tile alone can never
    // wet through a dry corner.
    if(!tile||waterDepthOf(tile)>0)return 0;
    const px=Math.max(-.5,Math.min(.5,Number(ox||0)));
    const pz=Math.max(-.5,Math.min(.5,Number(oz||0)));
    let ground=null;
    const sampleGround=()=>ground==null?(ground=this.sampleRenderedHeight(tile,byKey,px,pz)):ground;
    const edgeContacts=new Map();
    const contactFor=(water,distance)=>{
      const level=this.waterSurfaceOf(water);
      if(level==null)return 0;
      const edge=1-smooth01(Math.max(0,distance)/.48);
      if(edge<=0)return 0;
      const height=1-smooth01(Math.abs(sampleGround()-level)/.65);
      const depth=smooth01(waterDepthOf(water)/.12);
      return clamp01(edge*height*depth);
    };

    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const water=this.tileAt(byKey,tile.x+dx,tile.y+dy);
      const distance=.5-px*dx-pz*dy;
      const contact=contactFor(water,distance);
      if(contact>0)edgeContacts.set(`${dx},${dy}`,contact);
    }

    // Probabilistic union gives the two edge bands a rounded, continuous join
    // instead of max()'s square/L-shaped isolines. It is still driven entirely
    // by actual cardinal water contacts.
    let dry=1;
    for(const contact of edgeContacts.values())dry*=1-contact;
    let contact=1-dry;

    // At a connected shoreline turn, use the real diagonal water level only to
    // round the outer decoration around the shared corner. Requiring at least one
    // adjacent cardinal wet edge prevents diagonal shortcuts across dry land.
    for(const sx of [-1,1])for(const sz of [-1,1]){
      const sideX=edgeContacts.get(`${sx},0`)||0;
      const sideZ=edgeContacts.get(`0,${sz}`)||0;
      if(sideX<=0&&sideZ<=0)continue;
      const diagonal=this.tileAt(byKey,tile.x+sx,tile.y+sz);
      if(this.waterSurfaceOf(diagonal)==null)continue;
      const dx=.5-px*sx,dz=.5-pz*sz;
      const radial=Math.hypot(Math.max(0,dx),Math.max(0,dz));
      const corner=contactFor(diagonal,radial)*Math.max(sideX,sideZ);
      contact=1-(1-contact)*(1-corner);
    }
    return clamp01(contact);
  }

  cliffWaterContact(tile,neighbor){
    // The lower neighbour touches this wall. Water on the upper tile alone
    // does not wet the whole exposed cliff (waterfalls have their own renderer).
    const level=this.waterSurfaceOf(neighbor);
    return level==null?{level:0,strength:0}:{level,strength:smooth01(waterDepthOf(neighbor)/.12)};
  }

  transitionColorAt(tile,byKey,ox=0,oz=0){
    if(!tile)return VISUAL_TERRAIN_COLORS.DEFAULT;
    const localDepth=waterDepthOf(tile);
    if(localDepth>0)return this.submergedBedColor(tile,localDepth);

    const terrain=baseTerrainOf(tile);
    let color=this.wetDryColor(tile);
    const influences=this.localInfluences(tile,byKey,ox,oz);

    const waterInfluence=this.shoreContactAt(tile,byKey,ox,oz);
    let forestInfluence=0,rockInfluence=0;
    for(const item of influences){
      const w=clamp01(item.weight);
      if(item.terrain==="FOREST")forestInfluence=Math.max(forestInfluence,w);
      if(item.terrain==="HIGH_GROUND"||item.material==="ROCK")rockInfluence=Math.max(rockInfluence,w);
    }

    // Non-water biome contact is deliberately subtle; it softens the tile mask
    // without replacing the owning tile's material identity.
    if(terrain!=="FOREST"&&forestInfluence>0){
      color=mixColor(color,FOREST_SOIL,.24*forestInfluence);
    }
    if(terrain!=="HIGH_GROUND"&&tile?.material!=="ROCK"&&rockInfluence>0){
      color=mixColor(color,GRAVEL,.26*rockInfluence);
    }

    if(waterInfluence>0){
      const wet=clamp01(waterInfluence*1.20);
      if(terrain==="SAND"){
        color=mixColor(color,WET_SAND,.82*wet);
        color=mixColor(color,[.38,.33,.23],.22*wet*wet);
      }else if(terrain==="MUD"){
        color=mixColor(color,WET_MUD,.78*wet);
      }else if(terrain==="FOREST"){
        color=mixColor(color,WET_FOREST,.72*wet);
        color=mixColor(color,FOREST_SOIL,.34*smooth01((wet-.42)/.58));
      }else if(terrain==="HIGH_GROUND"||tile?.material==="ROCK"){
        color=mixColor(color,WET_ROCK,.70*wet);
      }else{
        color=mixColor(color,WET_GRASS,.70*wet);
        color=mixColor(color,SILT_BANK,.56*smooth01((wet-.38)/.62));
      }
    }
    return color;
  }

  surfaceColorAt(tile,byKey,ox=0,oz=0){
    const px=Math.max(-.5,Math.min(.5,Number(ox||0)));
    const pz=Math.max(-.5,Math.min(.5,Number(oz||0)));
    const colors=[this.transitionColorAt(tile,byKey,px,pz)];
    const edgeX=Math.abs(Math.abs(px)-.5)<=1e-6?Math.sign(px):0;
    const edgeZ=Math.abs(Math.abs(pz)-.5)<=1e-6?Math.sign(pz):0;

    if(edgeX){
      const neighbor=this.tileAt(byKey,tile.x+edgeX,tile.y);
      if(neighbor&&this.canSlope(tile,neighbor))colors.push(this.transitionColorAt(neighbor,byKey,-edgeX*.5,pz));
    }
    if(edgeZ){
      const neighbor=this.tileAt(byKey,tile.x,tile.y+edgeZ);
      if(neighbor&&this.canSlope(tile,neighbor))colors.push(this.transitionColorAt(neighbor,byKey,px,-edgeZ*.5));
    }
    if(edgeX&&edgeZ){
      const diagonal=this.tileAt(byKey,tile.x+edgeX,tile.y+edgeZ);
      const sideX=this.tileAt(byKey,tile.x+edgeX,tile.y);
      const sideZ=this.tileAt(byKey,tile.x,tile.y+edgeZ);
      if(diagonal&&((sideX&&this.canSlope(sideX,diagonal))||(sideZ&&this.canSlope(sideZ,diagonal)))){
        colors.push(this.transitionColorAt(diagonal,byKey,-edgeX*.5,-edgeZ*.5));
      }
    }
    return averageColors(colors);
  }

  sampleColorAtWorld(worldX,worldZ,byKey){
    const tx=Math.round(Number(worldX||0)/TILE_SIZE);
    const ty=Math.round(Number(worldZ||0)/TILE_SIZE);
    const tile=this.tileAt(byKey,tx,ty);
    if(!tile)return VISUAL_TERRAIN_COLORS.DEFAULT;
    const ox=(Number(worldX||0)-tx*TILE_SIZE)/TILE_SIZE;
    const oz=(Number(worldZ||0)-ty*TILE_SIZE)/TILE_SIZE;
    return this.surfaceColorAt(tile,byKey,ox,oz);
  }


  sharedScalarAt(tile,byKey,ox,oz,getter,{connect=null}={}){
    if(!tile||typeof getter!=="function")return 0;
    const px=Math.max(-.5,Math.min(.5,Number(ox||0)));
    const pz=Math.max(-.5,Math.min(.5,Number(oz||0)));
    const local=Math.max(0,Number(getter(tile)||0));
    const onEdgeX=Math.abs(Math.abs(px)-.5)<=1e-6?Math.sign(px):0;
    const onEdgeZ=Math.abs(Math.abs(pz)-.5)<=1e-6?Math.sign(pz):0;
    const canJoin=(a,b)=>!connect?this.canSlope(a,b):!!connect(a,b);

    if(!onEdgeX&&!onEdgeZ)return local;

    const values=[local];
    if(onEdgeX){
      const neighbor=this.tileAt(byKey,tile.x+onEdgeX,tile.y);
      values.push(neighbor&&canJoin(tile,neighbor)?Math.max(0,Number(getter(neighbor)||0)):0);
    }
    if(onEdgeZ){
      const neighbor=this.tileAt(byKey,tile.x,tile.y+onEdgeZ);
      values.push(neighbor&&canJoin(tile,neighbor)?Math.max(0,Number(getter(neighbor)||0)):0);
    }
    if(onEdgeX&&onEdgeZ){
      const diagonal=this.tileAt(byKey,tile.x+onEdgeX,tile.y+onEdgeZ);
      const sideX=this.tileAt(byKey,tile.x+onEdgeX,tile.y);
      const sideZ=this.tileAt(byKey,tile.x,tile.y+onEdgeZ);
      const joins=diagonal&&(
        (sideX&&canJoin(sideX,diagonal))||
        (sideZ&&canJoin(sideZ,diagonal))
      );
      values.push(joins?Math.max(0,Number(getter(diagonal)||0)):0);
    }

    return Math.min(...values);
  }

  waterSurfaceOf(tile){
    const depth=waterDepthOf(tile);
    if(depth<=0)return null;
    return tile?.waterSurfaceZ==null
      ?elevationOf(tile)+depth
      :Number(tile.waterSurfaceZ);
  }

  microRegion(tile,byKey,layout,ring=null){
    const influences=[];
    for(const [dx,dy] of layout.dirs){
      const neighbor=this.tileAt(byKey,tile.x+dx,tile.y+dy);
      if(!neighbor)continue;
      const diagonal=Math.abs(dx)+Math.abs(dy)===2;
      const snapshot=influenceSnapshot(neighbor,diagonal?.48:1,`${dx},${dy}`);
      if(snapshot)influences.push(snapshot);
    }
    const localWater=waterDepthOf(tile);
    const totalWeight=influences.reduce((sum,item)=>sum+item.weight,0);
    const neighborWater=influences.reduce((sum,item)=>sum+item.waterDepth*item.weight,0)/Math.max(1,totalWeight);
    const waterInfluence=clamp01(Math.max(localWater,neighborWater)/.75);
    const soilMoisture=Math.max(0,Number(tile?.soilMoisture||0));
    const neighborMoisture=influences.reduce((sum,item)=>sum+item.soilMoisture*item.weight,0)/Math.max(1,totalWeight);
    const wetness=clamp01(Math.max(localWater/.3,soilMoisture/.45,neighborMoisture/.45,waterInfluence*.8));
    const rockInfluence=clamp01(influences.reduce((sum,item)=>sum+(item.material==="ROCK"||item.terrain==="HIGH_GROUND"?item.weight:0),0)/Math.max(1,totalWeight));
    const snowInfluence=clamp01(Math.max(Number(tile?.snowDepth||0),...influences.map(item=>item.snowDepth))/.5);
    const iceInfluence=clamp01(Math.max(Number(tile?.iceThickness||0),...influences.map(item=>item.iceThickness))/.5);
    return{
      id:layout.id,row:layout.row,col:layout.col,ox:layout.ox,oz:layout.oz,
      height:this.sampleHeightFromRing(elevationOf(tile),ring||this.ringSamples(tile,byKey),layout.ox,layout.oz),
      terrain:baseTerrainOf(tile),
      material:String(tile?.material||""),
      baseColor:this.colorOf(tile),
      visualColor:this.surfaceColorAt(tile,byKey,layout.ox,layout.oz),
      waterDepth:localWater,
      waterInfluence,
      soilMoisture,
      wetness,
      snowDepth:Math.max(0,Number(tile?.snowDepth||0)),
      snowInfluence,
      iceThickness:Math.max(0,Number(tile?.iceThickness||0)),
      iceInfluence,
      rockInfluence,
      river:tile?.river===true,
      flowX:Number(tile?.flowX||0),
      flowY:Number(tile?.flowY||0),
      flowSpeed:Math.max(0,Number(tile?.flowSpeed||0)),
      influences
    };
  }

  microGrid(tile,byKey,ring=null){
    const resolvedRing=ring||this.ringSamples(tile,byKey);
    return MICRO_REGION_LAYOUT.map(layout=>this.microRegion(tile,byKey,layout,resolvedRing));
  }

  patchGrid(tile,byKey,ring=null){
    const resolvedRing=ring||this.ringSamples(tile,byKey);
    const cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE;
    const rows=[];
    for(const oz of PATCH_OFFSETS){
      const row=[];
      for(const ox of PATCH_OFFSETS){
        row.push({
          ox,oz,
          x:cx+ox*TILE_SIZE,
          z:cz+oz*TILE_SIZE,
          height:this.sampleHeightFromRing(elevationOf(tile),resolvedRing,ox,oz),
          color:this.surfaceColorAt(tile,byKey,ox,oz)
        });
      }
      rows.push(row);
    }
    return rows;
  }

  resolveTile(tile,byKey){
    const ring=this.ringSamples(tile,byKey);
    return{
      tileX:Number(tile?.x||0),
      tileY:Number(tile?.y||0),
      centerHeight:elevationOf(tile),
      color:this.colorOf(tile),
      ring,
      microRegions:this.microGrid(tile,byKey,ring),
      patchGrid:this.patchGrid(tile,byKey,ring)
    };
  }

  diagnostics(){
    return{
      microGrid:"3x3",
      microRegionsPerTile:9,
      patchVerticesPerTile:16,
      sharedHeightSampling:true,
      sharedTerrainState:true,
      sharedEnvironmentScalarSampling:true,
      naturalMaterialTransitions:true,
      centreToCentreSurfaceBlend:true,
      sharedBorderMaterialWeights:true,
      submergedBedIsolation:true,
      gameplayGridSubdivision:false,
      renderedSurfaceGeometryRegistry:true,
      waterConsumesExactTerrainTriangles:true,
      renderedCliffGeometryRegistry:true,
      waterConsumesExactCliffVertices:true,
      waterConsumesExactCliffFaces:true
    };
  }
}

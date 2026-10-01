import { TILE_SIZE } from "./coordinate-system.js";

const EPSILON=1e-8;
const MAX_VISUAL_SLOPE_DELTA=1.0001;
const WATERBED_DEPTH_RANGE=1.5;
const WATERBED_DEEP=Object.freeze([.13,.24,.25]);
const WET_GRASS=Object.freeze([.29,.43,.24]);
const WET_FOREST=Object.freeze([.14,.28,.18]);
const WET_SAND=Object.freeze([.48,.42,.29]);
const SILT_BANK=Object.freeze([.34,.34,.24]);
const FOREST_SOIL=Object.freeze([.24,.31,.20]);
const GRAVEL=Object.freeze([.43,.42,.37]);
const WET_ROCK=Object.freeze([.24,.30,.29]);
const PATCH_OFFSETS=Object.freeze([-.5,-1/6,1/6,.5]);

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
    if(terrain==="MUD")return mixColor(base,SILT_BANK,.50*wet);
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
    return smooth01((Math.abs(Number(value||0))-1/6)/(1/3));
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

  transitionColorAt(tile,byKey,ox=0,oz=0){
    if(!tile)return VISUAL_TERRAIN_COLORS.DEFAULT;
    const localDepth=waterDepthOf(tile);
    if(localDepth>0)return this.submergedBedColor(tile,localDepth);

    const terrain=baseTerrainOf(tile);
    let color=this.wetDryColor(tile);
    const influences=this.localInfluences(tile,byKey,ox,oz);

    let waterInfluence=0,forestInfluence=0,rockInfluence=0;
    for(const item of influences){
      const w=clamp01(item.weight);
      if(item.waterDepth>0)waterInfluence=Math.max(waterInfluence,w*smooth01(item.waterDepth/.35));
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
      submergedBedIsolation:true,
      gameplayGridSubdivision:false
    };
  }
}

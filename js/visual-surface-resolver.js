import { TILE_SIZE } from "./coordinate-system.js";

const EPSILON=1e-8;
const MAX_VISUAL_SLOPE_DELTA=1.0001;
const WATERBED_DEPTH_RANGE=1.5;
const WATERBED_SHALLOW=Object.freeze([.39,.44,.29]);
const WATERBED_DEEP=Object.freeze([.13,.24,.25]);

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

function baseTerrainOf(tile){
  if(tile?.material==="ROCK")return"HIGH_GROUND";
  if(tile?.terrain==="WATER"&&tile?.dryTerrain)return String(tile.dryTerrain);
  return String(tile?.terrain||"DEFAULT");
}

function influenceSnapshot(tile,weight,direction){
  if(!tile)return null;
  return{
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

  colorOf(tile){
    const color=this.dryColor(tile);
    const depth=waterDepthOf(tile);
    if(depth<=0)return color;
    const wet=smooth01(depth/.28);
    const deep=smooth01(depth/WATERBED_DEPTH_RANGE);
    const shallow=mixColor(color,WATERBED_SHALLOW,.32*wet);
    return mixColor(shallow,WATERBED_DEEP,.72*deep);
  }

  mixTileColors(tiles){
    const valid=(tiles||[]).filter(Boolean);
    if(!valid.length)return VISUAL_TERRAIN_COLORS.DEFAULT;
    return[
      average(valid.map(tile=>this.colorOf(tile)[0])),
      average(valid.map(tile=>this.colorOf(tile)[1])),
      average(valid.map(tile=>this.colorOf(tile)[2]))
    ];
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

  sampleHeightAtWorld(worldX,worldZ,byKey){
    const tx=Math.round(Number(worldX||0)/TILE_SIZE);
    const ty=Math.round(Number(worldZ||0)/TILE_SIZE);
    const tile=this.tileAt(byKey,tx,ty);
    if(!tile)return null;
    const ox=(Number(worldX||0)-tx*TILE_SIZE)/TILE_SIZE;
    const oz=(Number(worldZ||0)-ty*TILE_SIZE)/TILE_SIZE;
    return this.sampleHeight(tile,byKey,ox,oz);
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
    const neighborWater=influences.reduce((sum,item)=>sum+item.waterDepth*item.weight,0)/Math.max(1,influences.reduce((sum,item)=>sum+item.weight,0));
    const waterInfluence=clamp01(Math.max(localWater,neighborWater)/.75);
    const soilMoisture=Math.max(0,Number(tile?.soilMoisture||0));
    const neighborMoisture=influences.reduce((sum,item)=>sum+item.soilMoisture*item.weight,0)/Math.max(1,influences.reduce((sum,item)=>sum+item.weight,0));
    const wetness=clamp01(Math.max(localWater/.3,soilMoisture/.45,neighborMoisture/.45,waterInfluence*.8));
    const rockInfluence=clamp01(influences.reduce((sum,item)=>sum+(item.material==="ROCK"||item.terrain==="HIGH_GROUND"?item.weight:0),0)/Math.max(1,influences.reduce((sum,item)=>sum+item.weight,0)));
    const snowInfluence=clamp01(Math.max(Number(tile?.snowDepth||0),...influences.map(item=>item.snowDepth))/.5);
    const iceInfluence=clamp01(Math.max(Number(tile?.iceThickness||0),...influences.map(item=>item.iceThickness))/.5);
    return{
      id:layout.id,row:layout.row,col:layout.col,ox:layout.ox,oz:layout.oz,
      height:this.sampleHeightFromRing(elevationOf(tile),ring||this.ringSamples(tile,byKey),layout.ox,layout.oz),
      terrain:baseTerrainOf(tile),
      material:String(tile?.material||""),
      baseColor:this.colorOf(tile),
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

  resolveTile(tile,byKey){
    const ring=this.ringSamples(tile,byKey);
    return{
      tileX:Number(tile?.x||0),
      tileY:Number(tile?.y||0),
      centerHeight:elevationOf(tile),
      color:this.colorOf(tile),
      ring,
      microRegions:this.microGrid(tile,byKey,ring)
    };
  }

  diagnostics(){
    return{
      microGrid:"3x3",
      microRegionsPerTile:9,
      sharedHeightSampling:true,
      sharedTerrainState:true,
      gameplayGridSubdivision:false
    };
  }
}

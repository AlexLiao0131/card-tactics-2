import { TILE_SIZE } from "./coordinate-system.js";

const EPSILON=1e-8;
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

  cliffEdgeProfile(tile,dir,byKey,options={}){
    const rough=this.cliffRoughPolyline(tile,dir,options),surface=this.cliffSurfaceEdgeSamples(tile,dir,byKey);
    if(!rough.length||!surface.length)return[];
    const sampleHeight=t=>{
      const scaled=Math.max(0,Math.min(1,Number(t||0)))*(surface.length-1),i=Math.min(surface.length-2,Math.floor(scaled)),q=scaled-i;
      return Number(surface[i].height)+(Number(surface[i+1].height)-Number(surface[i].height))*q;
    };
    return rough.map(point=>({...point,height:sampleHeight(point.t)}));
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
    // Presentation only: immediate shared edges and the rendered ground height.
    // No diagonal shortcuts through land and no wet tint up a dry high cliff.
    if(!tile||waterDepthOf(tile)>0)return 0;
    let ground=null;
    let contact=0;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const water=this.tileAt(byKey,tile.x+dx,tile.y+dy);
      const level=this.waterSurfaceOf(water);
      if(level==null)continue;
      const distance=Math.max(0,.5-ox*dx-oz*dy);
      const edge=1-smooth01(distance/.48);
      if(edge<=0)continue;
      if(ground==null)ground=this.sampleRenderedHeight(tile,byKey,ox,oz);
      const height=1-smooth01(Math.abs(ground-level)/.65);
      const depth=smooth01(waterDepthOf(water)/.12);
      contact=Math.max(contact,edge*height*depth);
    }
    return contact;
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
      sharedCliffEdgeProfile:true
    };
  }
}

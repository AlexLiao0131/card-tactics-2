import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const DIRS=Object.freeze([
  {id:"N",dx:0,dy:-1},
  {id:"E",dx:1,dy:0},
  {id:"S",dx:0,dy:1},
  {id:"W",dx:-1,dy:0}
]);

const keyOf=(x,y)=>`${x},${y}`;
const tilesOf=state=>state?.map?.tiles||state?.grid?.tiles||[];
const elevationOf=tile=>Number(tile?.elevation||0);
const MAX_VISUAL_SLOPE_DELTA=1.0001;
const NORMAL_EPSILON=1e-8;

const TERRAIN_COLORS=Object.freeze({
  PLAIN:[.39,.55,.28],
  FOREST:[.17,.37,.21],
  HIGH_GROUND:[.40,.43,.39],
  WATER:[.29,.37,.31],
  MUD:[.36,.28,.18],
  SAND:[.68,.60,.40],
  WALL:[.27,.28,.31],
  DEFAULT:[.35,.49,.27]
});
const WATERBED_SHALLOW=Object.freeze([.39,.44,.29]);
const WATERBED_DEEP=Object.freeze([.13,.24,.25]);
const WATERBED_DEPTH_RANGE=1.5;
const CLIFF_RUGGEDNESS=.13;
const CLIFF_EDGE_SEGMENTS=4;
const RELIEF_ELEVATION_STEP=.035;

function hash01(value){
  const text=String(value||"");let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return(h>>>0)/4294967295;
}

function clamp01(value){return Math.max(0,Math.min(1,Number(value||0)));}
function smooth01(value){const t=clamp01(value);return t*t*(3-2*t);}
function mixColor(a,b,t){
  const q=clamp01(t);
  return[
    a[0]+(b[0]-a[0])*q,
    a[1]+(b[1]-a[1])*q,
    a[2]+(b[2]-a[2])*q
  ];
}
function dryTerrainColor(tile){
  if(tile?.material==="ROCK")return TERRAIN_COLORS.HIGH_GROUND;
  const terrain=tile?.terrain==="WATER"&&tile?.dryTerrain
    ?String(tile.dryTerrain)
    :String(tile?.terrain||"DEFAULT");
  return TERRAIN_COLORS[terrain]||TERRAIN_COLORS.DEFAULT;
}
function baseColor(tile){
  const color=dryTerrainColor(tile);
  const depth=Math.max(0,Number(tile?.waterDepth||0));
  if(depth<=0)return color;

  // The terrain remains the terrain. This is only a visual underwater tint,
  // derived from hydrology depth and never written back into GridState.
  const wet=smooth01(depth/.28);
  const deep=smooth01(depth/WATERBED_DEPTH_RANGE);
  const shallow=mixColor(color,WATERBED_SHALLOW,.32*wet);
  return mixColor(shallow,WATERBED_DEEP,.72*deep);
}
function avg(values){return values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);}
function mixColors(tiles){
  if(!tiles.length)return TERRAIN_COLORS.DEFAULT;
  return[
    avg(tiles.map(tile=>baseColor(tile)[0])),
    avg(tiles.map(tile=>baseColor(tile)[1])),
    avg(tiles.map(tile=>baseColor(tile)[2]))
  ];
}
function shade(color,factor){
  return color.map(value=>Math.max(0,Math.min(1,value*factor)));
}
function elevationShade(height){
  return Math.max(.84,Math.min(1.14,.96+Number(height||0)*RELIEF_ELEVATION_STEP));
}
function faceNormal(a,b,c){
  const abx=b.x-a.x,aby=b.y-a.y,abz=b.z-a.z;
  const acx=c.x-a.x,acy=c.y-a.y,acz=c.z-a.z;
  let nx=aby*acz-abz*acy;
  let ny=abz*acx-abx*acz;
  let nz=abx*acy-aby*acx;
  let length=Math.hypot(nx,ny,nz);
  if(length<=NORMAL_EPSILON)return null;
  nx/=length;ny/=length;nz/=length;
  return{x:nx,y:ny,z:nz};
}
function orientUp(a,b,c){
  let normal=faceNormal(a,b,c);
  if(!normal)return null;

  // Babylon uses a left-handed scene by default. For an upward-facing XZ
  // surface, the front-face winding produces a geometric cross-product with
  // negative Y. Keep that winding for culling, while supplying an outward
  // (+Y) lighting normal.
  if(normal.y>0){
    const tmp=b;b=c;c=tmp;
    normal={x:-normal.x,y:-normal.y,z:-normal.z};
  }

  return{
    a,b,c,
    normal:{x:-normal.x,y:-normal.y,z:-normal.z}
  };
}
function mix3(a,b,c){
  return[
    (a[0]+b[0]+c[0])/3,
    (a[1]+b[1]+c[1])/3,
    (a[2]+b[2]+c[2])/3
  ];
}

export class TerrainRenderer{
  constructor(scene){
    this.scene=scene;
    this.meshes=new Map();
    this.signatureValue="";
    this.surfaceMaterial=this.makeSurfaceMaterial();
    this.cliffMaterial=this.makeCliffMaterial();
  }

  makeSurfaceMaterial(){
    const material=new BABYLON.StandardMaterial("terrain-surface",this.scene);
    material.diffuseColor=BABYLON.Color3.White();
    // Keep enough ambient fill to read terrain colours, but let the directional
    // lights and flat face normals carry the elevation. Full-white ambient was
    // flattening H0/H1/H2 into nearly the same value.
    material.ambientColor=new BABYLON.Color3(.48,.48,.48);
    material.specularColor=new BABYLON.Color3(.018,.018,.018);
    material.specularPower=7;
    // Geometry has deterministic winding and face normals now.
    material.backFaceCulling=true;
    material.twoSidedLighting=false;
    return material;
  }

  makeCliffMaterial(){
    const material=new BABYLON.StandardMaterial("terrain-cliffs",this.scene);
    material.diffuseColor=BABYLON.Color3.White();
    material.ambientColor=new BABYLON.Color3(.32,.32,.32);
    material.specularColor=new BABYLON.Color3(.012,.012,.012);
    material.specularPower=5;
    // Cliff quads may face any cardinal direction.
    material.backFaceCulling=false;
    material.twoSidedLighting=true;
    return material;
  }

  disposeMeshes(){
    for(const mesh of this.meshes.values())mesh.dispose();
    this.meshes.clear();
  }

  signature(tiles){
    return tiles.map(tile=>[
      tile.x,tile.y,
      String(tile.terrain||""),
      String(tile.material||""),
      elevationOf(tile).toFixed(4),
      Math.max(0,Number(tile.waterDepth||0)).toFixed(3),
      tile.fogged?1:0
    ].join(":")).sort().join("|");
  }

  tileAt(byKey,x,y){return byKey.get(keyOf(x,y))||null;}

  canSlope(a,b){
    return !!a&&!!b&&Math.abs(elevationOf(a)-elevationOf(b))<=MAX_VISUAL_SLOPE_DELTA;
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
        included.add(candidateKey);
        result.push(candidate);
        changed=true;
      }
    }
    return result;
  }

  cornerSample(tile,byKey,dx,dy){
    const members=this.slopeConnectedCornerTiles(tile,byKey,dx,dy);
    return{
      height:avg(members.map(elevationOf)),
      color:mixColors(members)
    };
  }

  edgeSample(tile,neighbor){
    if(!neighbor||!this.canSlope(tile,neighbor)){
      return{height:elevationOf(tile),color:baseColor(tile)};
    }
    return{
      height:(elevationOf(tile)+elevationOf(neighbor))/2,
      color:mixColors([tile,neighbor])
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

  pushFace(out,a,b,c,colors){
    const oriented=orientUp(a,b,c);
    if(!oriented)return false;

    const points=[oriented.a,oriented.b,oriented.c];
    const sourceColors=oriented.b===b
      ?colors
      :[colors[0],colors[2],colors[1]];
    const mixed=mix3(sourceColors[0],sourceColors[1],sourceColors[2]);
    // A small baked relief term complements Babylon lighting. It is geometric, not
    // gameplay state: upward / sun-facing facets read lighter while opposing slopes
    // retain enough contrast to make elevation visible on a phone screen.
    const n=oriented.normal;
    const sunDot=Math.max(0,n.x*.49+n.y*.82+n.z*.29);
    const faceColor=shade(mixed,.78+sunDot*.24);
    const base=out.positions.length/3;

    for(const point of points){
      out.positions.push(point.x,point.y,point.z);
      out.normals.push(n.x,n.y,n.z);
      // One colour per face gives a deliberate low-poly surface instead of grid seams.
      out.colors.push(faceColor[0],faceColor[1],faceColor[2],1);
    }
    out.indices.push(base,base+1,base+2);
    return true;
  }

  buildSurface(tiles,byKey){
    const out={positions:[],indices:[],normals:[],colors:[]};
    let skippedDegenerate=0;
    let minNormalY=1;

    for(const tile of tiles){
      const cx=Number(tile.x)*TILE_SIZE;
      const cz=Number(tile.y)*TILE_SIZE;
      const fog=tile.fogged?.62:1;

      const center={
        x:cx,
        y:elevationOf(tile)*ELEVATION_HEIGHT,
        z:cz
      };
      const centerColor=shade(baseColor(tile),fog*elevationShade(elevationOf(tile)));

      const ring=this.ringSamples(tile,byKey).map(sample=>({
        point:{
          x:cx+sample.ox*TILE_SIZE,
          y:sample.height*ELEVATION_HEIGHT,
          z:cz+sample.oz*TILE_SIZE
        },
        color:shade(sample.color,fog*elevationShade(sample.height))
      }));

      for(let i=0;i<ring.length;i++){
        const next=(i+1)%ring.length;
        const before=out.normals.length;
        const ok=this.pushFace(
          out,
          center,
          ring[i].point,
          ring[next].point,
          [centerColor,ring[i].color,ring[next].color]
        );
        if(!ok){skippedDegenerate++;continue;}
        for(let n=before+1;n<out.normals.length;n+=3){
          minNormalY=Math.min(minNormalY,out.normals[n]);
        }
      }
    }

    const mesh=new BABYLON.Mesh("terrain-surface",this.scene);
    const data=new BABYLON.VertexData();
    data.positions=out.positions;
    data.indices=out.indices;
    data.normals=out.normals;
    data.colors=out.colors;
    data.applyToMesh(mesh,false);

    mesh.material=this.surfaceMaterial;
    mesh.useVertexColors=true;
    mesh.isPickable=false;
    mesh.receiveShadows=true;
    mesh.metadata={
      kind:"terrain-surface",
      tileCount:tiles.length,
      polygonal:true,
      flatShaded:true,
      explicitFaceNormals:true,
      waterbedDepthTint:true,
      skippedDegenerate,
      minNormalY
    };
    return mesh;
  }

  cliffEdgePoints(tile,dir){
    const cx=Number(tile.x)*TILE_SIZE;
    const cz=Number(tile.y)*TILE_SIZE;
    const h=TILE_SIZE*.5;
    if(dir.id==="N")return[[cx-h,cz-h],[cx+h,cz-h]];
    if(dir.id==="E")return[[cx+h,cz-h],[cx+h,cz+h]];
    if(dir.id==="S")return[[cx+h,cz+h],[cx-h,cz+h]];
    return[[cx-h,cz+h],[cx-h,cz-h]];
  }

  cliffRoughPolyline(tile,dir,segments=CLIFF_EDGE_SEGMENTS){
    const [[x1,z1],[x2,z2]]=this.cliffEdgePoints(tile,dir);
    const points=[];
    const nx=Number(dir.dx||0),nz=Number(dir.dy||0);
    const edgeKey=`${Math.min(x1,x2).toFixed(3)},${Math.min(z1,z2).toFixed(3)}:${Math.max(x1,x2).toFixed(3)},${Math.max(z1,z2).toFixed(3)}`;
    for(let i=0;i<=segments;i++){
      const t=i/segments;
      const x=x1+(x2-x1)*t,z=z1+(z2-z1)*t;
      if(i===0||i===segments){points.push({x,z,t});continue;}
      const envelope=Math.sin(Math.PI*t);
      const irregular=.28+.72*hash01(`cliff:${edgeKey}:${i}`);
      const offset=TILE_SIZE*CLIFF_RUGGEDNESS*envelope*irregular;
      points.push({x:x+nx*offset,z:z+nz*offset,t});
    }
    return points;
  }

  profileHeight(a,mid,b,t){
    return t<=.5
      ?a+(mid-a)*(t*2)
      :mid+(b-mid)*((t-.5)*2);
  }

  pushCliffTriangle(out,a,b,c,color){
    const geometric=faceNormal(a,b,c);
    if(!geometric)return false;

    // Match Babylon's front-face winding: the lighting normal is opposite the
    // right-handed cross-product used by faceNormal().
    const normal={
      x:-geometric.x,
      y:-geometric.y,
      z:-geometric.z
    };

    const base=out.positions.length/3;
    for(const point of [a,b,c]){
      out.positions.push(point.x,point.y,point.z);
      out.normals.push(normal.x,normal.y,normal.z);
      out.colors.push(color[0],color[1],color[2],1);
    }
    out.indices.push(base,base+1,base+2);
    return true;
  }

  pushCliffQuad(out,a,b,c,d,color){
    this.pushCliffTriangle(out,a,b,c,color);
    this.pushCliffTriangle(out,a,c,d,color);
  }

  buildCliffs(tiles,byKey){
    const out={positions:[],indices:[],normals:[],colors:[]};
    const minElevation=tiles.length?Math.min(...tiles.map(elevationOf)):0;
    const boundaryBase=minElevation-.75;
    const EH=ELEVATION_HEIGHT;

    // The underlying grid edge stays the rule boundary. The visible cliff rim is
    // an outward eroded polyline with a narrow cap/apron connecting it back to the
    // terrain surfaces, so the silhouette is rugged without introducing cracks.
    const EDGE={
      N:{own:[[-1,-1],[1,-1]],nb:[[-1,1],[1,1]]},
      E:{own:[[1,-1],[1,1]],nb:[[-1,-1],[-1,1]]},
      S:{own:[[1,1],[-1,1]],nb:[[1,-1],[-1,-1]]},
      W:{own:[[-1,1],[-1,-1]],nb:[[1,1],[1,-1]]}
    };

    let ruggedEdges=0;
    for(const tile of tiles){
      const top=elevationOf(tile);
      const fog=tile.fogged?.62:1;

      for(const dir of DIRS){
        const neighbor=this.tileAt(byKey,tile.x+dir.dx,tile.y+dir.dy);
        const lower=neighbor?elevationOf(neighbor):boundaryBase;
        const drop=top-lower;
        if(drop<=MAX_VISUAL_SLOPE_DELTA)continue;

        const edge=EDGE[dir.id];
        const topA=this.cornerSample(tile,byKey,...edge.own[0]).height*EH;
        const topB=this.cornerSample(tile,byKey,...edge.own[1]).height*EH;
        const topM=top*EH;
        let botA=neighbor
          ?this.cornerSample(neighbor,byKey,...edge.nb[0]).height*EH
          :lower*EH;
        let botB=neighbor
          ?this.cornerSample(neighbor,byKey,...edge.nb[1]).height*EH
          :lower*EH;
        botA=Math.min(botA,topA);botB=Math.min(botB,topB);
        const botM=lower*EH;

        const rough=this.cliffRoughPolyline(tile,dir);
        const nominal=this.cliffEdgePoints(tile,dir);
        const [[x1,z1],[x2,z2]]=nominal;
        const wallColor=shade(baseColor(tile),Math.max(.42,.60-Math.min(.12,drop*.025))*fog);
        const rimColor=shade(baseColor(tile),.90*fog*elevationShade(top));
        const apronColor=shade(neighbor?baseColor(neighbor):baseColor(tile),.66*fog);

        for(let i=0;i<rough.length-1;i++){
          const a=rough[i],b=rough[i+1];
          const ta=a.t,tb=b.t;
          const aTop=this.profileHeight(topA,topM,topB,ta);
          const bTop=this.profileHeight(topA,topM,topB,tb);
          const aBot=this.profileHeight(botA,botM,botB,ta);
          const bBot=this.profileHeight(botA,botM,botB,tb);

          // Main irregular rock wall.
          this.pushCliffQuad(
            out,
            {x:a.x,y:aBot,z:a.z},
            {x:b.x,y:bBot,z:b.z},
            {x:b.x,y:bTop,z:b.z},
            {x:a.x,y:aTop,z:a.z},
            wallColor
          );

          // Original grid edge points at the same parameters. These narrow strips
          // make the new rim part of the cliff geometry rather than an overlay patch.
          const na={x:x1+(x2-x1)*ta,z:z1+(z2-z1)*ta};
          const nb={x:x1+(x2-x1)*tb,z:z1+(z2-z1)*tb};
          this.pushCliffQuad(
            out,
            {x:na.x,y:aTop+.003,z:na.z},
            {x:nb.x,y:bTop+.003,z:nb.z},
            {x:b.x,y:bTop+.003,z:b.z},
            {x:a.x,y:aTop+.003,z:a.z},
            rimColor
          );
          this.pushCliffQuad(
            out,
            {x:a.x,y:aBot+.002,z:a.z},
            {x:b.x,y:bBot+.002,z:b.z},
            {x:nb.x,y:bBot+.002,z:nb.z},
            {x:na.x,y:aBot+.002,z:na.z},
            apronColor
          );
        }
        ruggedEdges++;
      }
    }

    if(!out.positions.length)return null;
    const mesh=new BABYLON.Mesh("terrain-cliffs",this.scene);
    const data=new BABYLON.VertexData();
    data.positions=out.positions;
    data.indices=out.indices;
    data.normals=out.normals;
    data.colors=out.colors;
    data.applyToMesh(mesh,false);

    mesh.material=this.cliffMaterial;
    mesh.useVertexColors=true;
    mesh.isPickable=false;
    mesh.receiveShadows=true;
    mesh.metadata={
      kind:"terrain-cliffs",
      polygonal:true,
      explicitFaceNormals:true,
      surfaceMatchedEdges:true,
      ruggedNaturalRims:true,
      erosionCap:true,
      ruggedEdges
    };
    return mesh;
  }

  sync(state){
    const tiles=tilesOf(state);
    const signature=this.signature(tiles);
    if(signature===this.signatureValue)return;

    this.disposeMeshes();
    const byKey=new Map(tiles.map(tile=>[keyOf(tile.x,tile.y),tile]));

    const surface=this.buildSurface(tiles,byKey);
    this.meshes.set("surface",surface);

    const cliffs=this.buildCliffs(tiles,byKey);
    if(cliffs)this.meshes.set("cliffs",cliffs);

    this.signatureValue=signature;
  }

  diagnostics(){
    const surface=this.meshes.get("surface");
    return{
      meshes:this.meshes.size,
      polygonalSurface:true,
      tileBoxes:false,
      permanentGridLines:false,
      flatShaded:true,
      explicitFaceNormals:true,
      waterbedDepthTint:true,
      reliefLighting:true,
      ruggedNaturalCliffs:true,
      skippedDegenerate:surface?.metadata?.skippedDegenerate??null,
      minNormalY:surface?.metadata?.minNormalY??null
    };
  }
}

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

function baseColor(tile){
  const color=tile?.material==="ROCK"
    ?TERRAIN_COLORS.HIGH_GROUND
    :(TERRAIN_COLORS[String(tile?.terrain||"DEFAULT")]||TERRAIN_COLORS.DEFAULT);
  const wet=Math.min(1,Math.max(0,Number(tile?.waterDepth||0))/.3);
  return wet>0?color.map(value=>value*(1-.35*wet)):color;
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
    material.ambientColor=BABYLON.Color3.White();
    material.specularColor=new BABYLON.Color3(.025,.025,.025);
    material.specularPower=8;
    // Geometry has deterministic winding and face normals now.
    material.backFaceCulling=true;
    material.twoSidedLighting=false;
    return material;
  }

  makeCliffMaterial(){
    const material=new BABYLON.StandardMaterial("terrain-cliffs",this.scene);
    material.diffuseColor=BABYLON.Color3.White();
    material.ambientColor=BABYLON.Color3.White();
    material.specularColor=new BABYLON.Color3(.02,.02,.02);
    material.specularPower=6;
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
      Math.round(Math.min(1,Math.max(0,Number(tile.waterDepth||0))/.3)*8),
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
    const faceColor=mix3(sourceColors[0],sourceColors[1],sourceColors[2]);
    const base=out.positions.length/3;

    for(const point of points){
      out.positions.push(point.x,point.y,point.z);
      out.normals.push(oriented.normal.x,oriented.normal.y,oriented.normal.z);
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
      const centerColor=shade(baseColor(tile),fog);

      const ring=this.ringSamples(tile,byKey).map(sample=>({
        point:{
          x:cx+sample.ox*TILE_SIZE,
          y:sample.height*ELEVATION_HEIGHT,
          z:cz+sample.oz*TILE_SIZE
        },
        color:shade(sample.color,fog)
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

    // The surface mesh samples every tile edge as:
    // corner -> edge midpoint -> corner.
    // Cliff walls must reuse the exact same sampled heights or a crack appears
    // between the surface and the vertical wall.
    const EDGE={
      N:{own:[[-1,-1],[1,-1]],nb:[[-1,1],[1,1]]},
      E:{own:[[1,-1],[1,1]],nb:[[-1,-1],[-1,1]]},
      S:{own:[[1,1],[-1,1]],nb:[[1,-1],[-1,-1]]},
      W:{own:[[-1,1],[-1,-1]],nb:[[1,1],[1,-1]]}
    };

    for(const tile of tiles){
      const top=elevationOf(tile);
      const fog=tile.fogged?.62:1;
      const color=shade(baseColor(tile),.68*fog);

      for(const dir of DIRS){
        const neighbor=this.tileAt(byKey,tile.x+dir.dx,tile.y+dir.dy);
        const lower=neighbor?elevationOf(neighbor):boundaryBase;
        if(top-lower<=MAX_VISUAL_SLOPE_DELTA)continue;

        const [[x1,z1],[x2,z2]]=this.cliffEdgePoints(tile,dir);
        const xm=(x1+x2)/2;
        const zm=(z1+z2)/2;
        const edge=EDGE[dir.id];

        // High-side surface: reuse the same two corner samples used by ringSamples().
        const topA=this.cornerSample(tile,byKey,...edge.own[0]).height*EH;
        const topB=this.cornerSample(tile,byKey,...edge.own[1]).height*EH;

        // Low-side surface: sample the corresponding corners from the neighbour.
        // At the map boundary there is no neighbour surface, so fall back to the
        // boundary base used by the existing cliff system.
        let botA=neighbor
          ?this.cornerSample(neighbor,byKey,...edge.nb[0]).height*EH
          :lower*EH;
        let botB=neighbor
          ?this.cornerSample(neighbor,byKey,...edge.nb[1]).height*EH
          :lower*EH;

        // Never allow numerical/averaging edge cases to invert a wall segment.
        botA=Math.min(botA,topA);
        botB=Math.min(botB,topB);

        // For a discontinuity, edgeSample() on each side returns that tile's own
        // raw elevation, so these midpoint heights exactly match both surfaces.
        const topM=top*EH;
        const botM=lower*EH;

        // Split the wall at the midpoint because the surface edge is also two
        // independent segments: corner -> midpoint -> corner.
        this.pushCliffQuad(
          out,
          {x:x1,y:botA,z:z1},
          {x:xm,y:botM,z:zm},
          {x:xm,y:topM,z:zm},
          {x:x1,y:topA,z:z1},
          color
        );
        this.pushCliffQuad(
          out,
          {x:xm,y:botM,z:zm},
          {x:x2,y:botB,z:z2},
          {x:x2,y:topB,z:z2},
          {x:xm,y:topM,z:zm},
          color
        );
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
      midpointSplit:true
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
      skippedDegenerate:surface?.metadata?.skippedDegenerate??null,
      minNormalY:surface?.metadata?.minNormalY??null
    };
  }
}

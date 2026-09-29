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

const TERRAIN_COLORS=Object.freeze({
  PLAIN:[.38,.54,.27],
  FOREST:[.16,.36,.20],
  HIGH_GROUND:[.39,.42,.38],
  WATER:[.28,.35,.30],
  MUD:[.34,.26,.16],
  SAND:[.66,.58,.38],
  WALL:[.25,.26,.29],
  DEFAULT:[.34,.47,.26]
});

function shade(color,factor){
  return[
    Math.max(0,Math.min(1,color[0]*factor)),
    Math.max(0,Math.min(1,color[1]*factor)),
    Math.max(0,Math.min(1,color[2]*factor))
  ];
}
function hash01(x,y,n=0){
  let h=(Math.imul((Number(x)||0)+101,73856093)^Math.imul((Number(y)||0)+103,19349663)^Math.imul(n+107,83492791))>>>0;
  h^=h>>>13;h=Math.imul(h,1274126177)>>>0;return(h>>>0)/4294967295;
}
function baseColor(tile){
  if(tile?.material==="ROCK")return TERRAIN_COLORS.HIGH_GROUND;
  return TERRAIN_COLORS[String(tile?.terrain||"DEFAULT")]||TERRAIN_COLORS.DEFAULT;
}

export class TerrainRenderer{
  constructor(scene){
    this.scene=scene;
    this.meshes=new Map();
    this.signatureValue="";
    this.surfaceMaterial=this.material("terrain-surface");
    this.cliffMaterial=this.material("terrain-cliffs");
  }

  material(name){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=BABYLON.Color3.White();
    material.specularColor=new BABYLON.Color3(.035,.035,.035);
    material.specularPower=12;
    material.backFaceCulling=true;
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
      tile.fogged?1:0
    ].join(":")).sort().join("|");
  }

  tileAt(byKey,x,y){return byKey.get(keyOf(x,y))||null;}

  edgeCanSlope(a,b){
    if(!a||!b)return false;
    return Math.abs(elevationOf(a)-elevationOf(b))<=MAX_VISUAL_SLOPE_DELTA;
  }

  edgeHeight(tile,neighbor){
    if(!neighbor||!this.edgeCanSlope(tile,neighbor))return elevationOf(tile);
    return(elevationOf(tile)+elevationOf(neighbor))/2;
  }

  cornerHeight(tile,byKey,dx,dy){
    const candidates=[tile];
    const nx=this.tileAt(byKey,tile.x+dx,tile.y);
    const ny=this.tileAt(byKey,tile.x,tile.y+dy);
    const nd=this.tileAt(byKey,tile.x+dx,tile.y+dy);

    if(nx&&this.edgeCanSlope(tile,nx))candidates.push(nx);
    if(ny&&this.edgeCanSlope(tile,ny))candidates.push(ny);

    if(nd){
      const directOk=this.edgeCanSlope(tile,nd);
      const xOk=!nx||this.edgeCanSlope(nx,nd);
      const yOk=!ny||this.edgeCanSlope(ny,nd);
      if(directOk&&xOk&&yOk)candidates.push(nd);
    }

    return candidates.reduce((sum,t)=>sum+elevationOf(t),0)/candidates.length;
  }

  tileRing(tile,byKey){
    const n=this.tileAt(byKey,tile.x,tile.y-1);
    const e=this.tileAt(byKey,tile.x+1,tile.y);
    const s=this.tileAt(byKey,tile.x,tile.y+1);
    const w=this.tileAt(byKey,tile.x-1,tile.y);

    return[
      {x:-.5,z:-.5,h:this.cornerHeight(tile,byKey,-1,-1)},
      {x:0,z:-.5,h:this.edgeHeight(tile,n)},
      {x:.5,z:-.5,h:this.cornerHeight(tile,byKey,1,-1)},
      {x:.5,z:0,h:this.edgeHeight(tile,e)},
      {x:.5,z:.5,h:this.cornerHeight(tile,byKey,1,1)},
      {x:0,z:.5,h:this.edgeHeight(tile,s)},
      {x:-.5,z:.5,h:this.cornerHeight(tile,byKey,-1,1)},
      {x:-.5,z:0,h:this.edgeHeight(tile,w)}
    ];
  }

  pushTriangle(out,a,b,c,color){
    const base=out.positions.length/3;
    for(const p of [a,b,c]){
      out.positions.push(p.x,p.y,p.z);
      out.colors.push(color[0],color[1],color[2],color[3]??1);
    }
    out.indices.push(base,base+1,base+2);
  }

  buildSurface(tiles,byKey){
    const out={positions:[],indices:[],normals:[],colors:[]};

    for(const tile of tiles){
      const cx=Number(tile.x)*TILE_SIZE;
      const cz=Number(tile.y)*TILE_SIZE;
      const center={
        x:cx,
        y:elevationOf(tile)*ELEVATION_HEIGHT,
        z:cz
      };
      const ring=this.tileRing(tile,byKey).map(p=>({
        x:cx+p.x*TILE_SIZE,
        y:p.h*ELEVATION_HEIGHT,
        z:cz+p.z*TILE_SIZE
      }));
      const base=baseColor(tile);
      const fog=tile.fogged?.46:1;

      for(let i=0;i<ring.length;i++){
        const j=(i+1)%ring.length;
        const variation=.91+hash01(tile.x,tile.y,i)*.16;
        const rgb=shade(base,variation*fog);
        this.pushTriangle(out,center,ring[j],ring[i],[...rgb,1]);
      }
    }

    BABYLON.VertexData.ComputeNormals(out.positions,out.indices,out.normals);
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
    mesh.metadata={kind:"terrain-surface",tileCount:tiles.length,polygonal:true};
    mesh.freezeWorldMatrix();
    return mesh;
  }

  cliffEdgePoints(tile,dir){
    const cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE,h=TILE_SIZE*.5;
    if(dir.id==="N")return[[cx-h,cz-h],[cx+h,cz-h]];
    if(dir.id==="E")return[[cx+h,cz-h],[cx+h,cz+h]];
    if(dir.id==="S")return[[cx+h,cz+h],[cx-h,cz+h]];
    return[[cx-h,cz+h],[cx-h,cz-h]];
  }

  buildCliffs(tiles,byKey){
    const out={positions:[],indices:[],normals:[],colors:[]};
    const minElevation=tiles.length?Math.min(...tiles.map(elevationOf)):0;
    const boundaryBase=minElevation-.75;

    for(const tile of tiles){
      const top=elevationOf(tile);
      const base=baseColor(tile);
      const fog=tile.fogged?.46:1;

      for(const dir of DIRS){
        const neighbor=this.tileAt(byKey,tile.x+dir.dx,tile.y+dir.dy);
        const lower=neighbor?elevationOf(neighbor):boundaryBase;
        const delta=top-lower;
        if(delta<=MAX_VISUAL_SLOPE_DELTA)continue;

        const [[x1,z1],[x2,z2]]=this.cliffEdgePoints(tile,dir);
        const yTop=top*ELEVATION_HEIGHT;
        const yBottom=lower*ELEVATION_HEIGHT;
        const a={x:x1,y:yBottom,z:z1};
        const b={x:x2,y:yBottom,z:z2};
        const c={x:x2,y:yTop,z:z2};
        const d={x:x1,y:yTop,z:z1};
        const rgb=shade(base,(.64+hash01(tile.x,tile.y,dir.id.charCodeAt(0))*.08)*fog);
        this.pushTriangle(out,a,b,c,[...rgb,1]);
        this.pushTriangle(out,a,c,d,[...rgb,1]);
      }
    }

    if(!out.positions.length)return null;
    BABYLON.VertexData.ComputeNormals(out.positions,out.indices,out.normals);
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
    mesh.metadata={kind:"terrain-cliffs",polygonal:true};
    mesh.freezeWorldMatrix();
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
    return{
      meshes:this.meshes.size,
      polygonalSurface:true,
      tileBoxes:false,
      permanentGridLines:false,
      slopeRule:`delta<=${MAX_VISUAL_SLOPE_DELTA}`,
      cliffRule:`delta>${MAX_VISUAL_SLOPE_DELTA}`
    };
  }
}

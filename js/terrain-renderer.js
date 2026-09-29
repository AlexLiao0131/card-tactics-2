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
  if(tile?.material==="ROCK")return TERRAIN_COLORS.HIGH_GROUND;
  return TERRAIN_COLORS[String(tile?.terrain||"DEFAULT")]||TERRAIN_COLORS.DEFAULT;
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
function forceUpwardNormals(normals){
  for(let i=0;i<normals.length;i+=3){
    if(Number(normals[i+1]||0)>=0)continue;
    normals[i]*=-1;
    normals[i+1]*=-1;
    normals[i+2]*=-1;
  }
  return normals;
}

export class TerrainRenderer{
  constructor(scene){
    this.scene=scene;
    this.meshes=new Map();
    this.signatureValue="";
    this.surfaceMaterial=this.makeMaterial("terrain-surface");
    this.cliffMaterial=this.makeMaterial("terrain-cliffs");
  }

  makeMaterial(name){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=BABYLON.Color3.White();
    material.ambientColor=new BABYLON.Color3(.30,.30,.30);
    material.specularColor=new BABYLON.Color3(.025,.025,.025);
    material.specularPower=8;
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

  vertexKey(point){
    return`${point.x.toFixed(5)}|${point.y.toFixed(5)}|${point.z.toFixed(5)}`;
  }

  addVertex(out,cache,point,color){
    const key=this.vertexKey(point);
    if(cache.has(key)){
      const index=cache.get(key);
      const offset=index*4;
      out.colors[offset]=(out.colors[offset]+color[0])*.5;
      out.colors[offset+1]=(out.colors[offset+1]+color[1])*.5;
      out.colors[offset+2]=(out.colors[offset+2]+color[2])*.5;
      return index;
    }
    const index=out.positions.length/3;
    out.positions.push(point.x,point.y,point.z);
    out.colors.push(color[0],color[1],color[2],1);
    cache.set(key,index);
    return index;
  }

  pushTriangleUp(out,a,b,c){
    const ax=out.positions[a*3],az=out.positions[a*3+2];
    const bx=out.positions[b*3],bz=out.positions[b*3+2];
    const cx=out.positions[c*3],cz=out.positions[c*3+2];

    const signed=(bz-az)*(cx-ax)-(bx-ax)*(cz-az);
    if(signed>=0)out.indices.push(a,b,c);
    else out.indices.push(a,c,b);
  }

  buildSurface(tiles,byKey){
    const out={positions:[],indices:[],normals:[],colors:[]};
    const cache=new Map();

    for(const tile of tiles){
      const cx=Number(tile.x)*TILE_SIZE;
      const cz=Number(tile.y)*TILE_SIZE;
      const fog=tile.fogged?.62:1;
      const centerColor=shade(baseColor(tile),fog);

      const centerIndex=this.addVertex(
        out,cache,
        {x:cx,y:elevationOf(tile)*ELEVATION_HEIGHT,z:cz},
        centerColor
      );

      const ring=this.ringSamples(tile,byKey).map(sample=>{
        const color=shade(sample.color,fog);
        return this.addVertex(
          out,cache,
          {
            x:cx+sample.ox*TILE_SIZE,
            y:sample.height*ELEVATION_HEIGHT,
            z:cz+sample.oz*TILE_SIZE
          },
          color
        );
      });

      for(let i=0;i<ring.length;i++){
        const next=(i+1)%ring.length;
        this.pushTriangleUp(out,centerIndex,ring[i],ring[next]);
      }
    }

    BABYLON.VertexData.ComputeNormals(out.positions,out.indices,out.normals);
    forceUpwardNormals(out.normals);

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
      sharedVertices:true,
      upwardNormals:true
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

  pushQuad(out,a,b,c,d,color){
    const base=out.positions.length/3;
    for(const point of [a,b,c,d]){
      out.positions.push(point.x,point.y,point.z);
      out.colors.push(color[0],color[1],color[2],1);
    }
    out.indices.push(base,base+1,base+2,base,base+2,base+3);
  }

  buildCliffs(tiles,byKey){
    const out={positions:[],indices:[],normals:[],colors:[]};
    const minElevation=tiles.length?Math.min(...tiles.map(elevationOf)):0;
    const boundaryBase=minElevation-.75;

    for(const tile of tiles){
      const top=elevationOf(tile);
      const fog=tile.fogged?.62:1;
      const color=shade(baseColor(tile),.68*fog);

      for(const dir of DIRS){
        const neighbor=this.tileAt(byKey,tile.x+dir.dx,tile.y+dir.dy);
        const lower=neighbor?elevationOf(neighbor):boundaryBase;
        if(top-lower<=MAX_VISUAL_SLOPE_DELTA)continue;

        const [[x1,z1],[x2,z2]]=this.cliffEdgePoints(tile,dir);
        const yTop=top*ELEVATION_HEIGHT;
        const yBottom=lower*ELEVATION_HEIGHT;

        this.pushQuad(
          out,
          {x:x1,y:yBottom,z:z1},
          {x:x2,y:yBottom,z:z2},
          {x:x2,y:yTop,z:z2},
          {x:x1,y:yTop,z:z1},
          color
        );
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
      sharedVertices:true,
      tileBoxes:false,
      permanentGridLines:false,
      backfaceSafe:true,
      upwardNormals:true
    };
  }
}

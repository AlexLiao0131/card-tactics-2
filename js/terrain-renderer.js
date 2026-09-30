import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
import { VisualSurfaceResolver } from "./visual-surface-resolver.js";

const DIRS=Object.freeze([
  {id:"N",dx:0,dy:-1},
  {id:"E",dx:1,dy:0},
  {id:"S",dx:0,dy:1},
  {id:"W",dx:-1,dy:0}
]);

const keyOf=(x,y)=>`${x},${y}`;
const tilesOf=state=>state?.map?.tiles||state?.grid?.tiles||[];
const NORMAL_EPSILON=1e-8;

const CLIFF_RUGGEDNESS=.13;
const CLIFF_EDGE_SEGMENTS=4;
const RELIEF_ELEVATION_STEP=.035;

function hash01(value){
  const text=String(value||"");let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return(h>>>0)/4294967295;
}

function mixColor(a,b,t){
  const q=Math.max(0,Math.min(1,Number(t||0)));
  return[
    a[0]+(b[0]-a[0])*q,
    a[1]+(b[1]-a[1])*q,
    a[2]+(b[2]-a[2])*q
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
    this.surfaceResolver=new VisualSurfaceResolver();
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
    // Vertical rock faces keep stronger ambient colour so they read as exposed
    // earth/stone rather than a black outline along water and high-ground rims.
    material.ambientColor=new BABYLON.Color3(.44,.44,.44);
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
      String(tile.dryTerrain||""),
      String(tile.material||""),
      this.surfaceResolver.elevationOf(tile).toFixed(4),
      Math.max(0,Number(tile.waterDepth||0)).toFixed(3),
      Math.max(0,Number(tile.soilMoisture||0)).toFixed(3),
      tile.fogged?1:0
    ].join(":")).sort().join("|");
  }


  pushFace(out,a,b,c,colors){
    const oriented=orientUp(a,b,c);
    if(!oriented)return false;

    const points=[oriented.a,oriented.b,oriented.c];
    const sourceColors=oriented.b===b
      ?colors
      :[colors[0],colors[2],colors[1]];
    // Flat normals keep the low-poly geometry readable, while vertex colours are
    // allowed to interpolate across the face. That gives material transitions room
    // to blend without turning every 3x3 micro-region into another hard tile.
    const n=oriented.normal;
    const sunDot=Math.max(0,n.x*.49+n.y*.82+n.z*.29);
    const lightFactor=.78+sunDot*.24;
    const base=out.positions.length/3;

    points.forEach((point,index)=>{
      const color=shade(sourceColors[index],lightFactor);
      out.positions.push(point.x,point.y,point.z);
      out.normals.push(n.x,n.y,n.z);
      out.colors.push(color[0],color[1],color[2],1);
    });
    out.indices.push(base,base+1,base+2);
    return true;
  }

  buildSurface(tiles,byKey){
    const out={positions:[],indices:[],normals:[],colors:[]};
    let skippedDegenerate=0;
    let minNormalY=1;

    const addFace=(a,b,c,colors)=>{
      const before=out.normals.length;
      const ok=this.pushFace(out,a,b,c,colors);
      if(!ok){skippedDegenerate++;return;}
      for(let n=before+1;n<out.normals.length;n+=3){
        minNormalY=Math.min(minNormalY,out.normals[n]);
      }
    };

    for(const tile of tiles){
      const fog=tile.fogged?.62:1;
      const visual=this.surfaceResolver.resolveTile(tile,byKey);
      const grid=visual.patchGrid.map(row=>row.map(sample=>({
        point:{
          x:sample.x,
          y:sample.height*ELEVATION_HEIGHT,
          z:sample.z
        },
        color:shade(sample.color,fog*elevationShade(sample.height))
      })));

      // 4x4 shared samples describe nine visual micro-regions. They are still one
      // gameplay tile and all triangles are appended to the same terrain mesh.
      for(let row=0;row<3;row++)for(let col=0;col<3;col++){
        const nw=grid[row][col],ne=grid[row][col+1];
        const sw=grid[row+1][col],se=grid[row+1][col+1];
        const alternate=(Number(tile.x)+Number(tile.y)+row+col)&1;
        if(alternate===0){
          addFace(nw.point,ne.point,se.point,[nw.color,ne.color,se.color]);
          addFace(nw.point,se.point,sw.point,[nw.color,se.color,sw.color]);
        }else{
          addFace(nw.point,ne.point,sw.point,[nw.color,ne.color,sw.color]);
          addFace(ne.point,se.point,sw.point,[ne.color,se.color,sw.color]);
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
      visualSurfaceResolver:true,
      microRegionsPerTile:9,
      microRegionGeometry:true,
      vertexColorTransitions:true,
      submergedBedIsolation:true,
      trianglesPerTile:18,
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
    const minElevation=tiles.length?Math.min(...tiles.map(tile=>this.surfaceResolver.elevationOf(tile))):0;
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
      const top=this.surfaceResolver.elevationOf(tile);
      const fog=tile.fogged?.62:1;

      for(const dir of DIRS){
        const neighbor=this.surfaceResolver.tileAt(byKey,tile.x+dir.dx,tile.y+dir.dy);
        const lower=neighbor?this.surfaceResolver.elevationOf(neighbor):boundaryBase;
        const drop=top-lower;
        if(drop<=this.surfaceResolver.maxVisualSlopeDelta)continue;

        const edge=EDGE[dir.id];
        const topA=this.surfaceResolver.cornerSample(tile,byKey,...edge.own[0]).height*EH;
        const topB=this.surfaceResolver.cornerSample(tile,byKey,...edge.own[1]).height*EH;
        const topM=top*EH;
        let botA=neighbor
          ?this.surfaceResolver.cornerSample(neighbor,byKey,...edge.nb[0]).height*EH
          :lower*EH;
        let botB=neighbor
          ?this.surfaceResolver.cornerSample(neighbor,byKey,...edge.nb[1]).height*EH
          :lower*EH;
        botA=Math.min(botA,topA);botB=Math.min(botB,topB);
        const botM=lower*EH;

        const rough=this.cliffRoughPolyline(tile,dir);
        const nominal=this.cliffEdgePoints(tile,dir);
        const [[x1,z1],[x2,z2]]=nominal;
        const edgeColor=this.surfaceResolver.transitionColorAt(tile,byKey,dir.dx*.46,dir.dy*.46);
        const lowerColor=neighbor
          ?this.surfaceResolver.transitionColorAt(neighbor,byKey,-dir.dx*.46,-dir.dy*.46)
          :this.surfaceResolver.colorOf(tile);
        const exposedRock=mixColor(edgeColor,[.34,.32,.27],.38);
        const wallColor=shade(exposedRock,Math.max(.62,.72-Math.min(.08,drop*.015))*fog);
        const bankWaterDepth=Math.max(
          this.surfaceResolver.waterDepthOf(tile),
          this.surfaceResolver.waterDepthOf(neighbor)
        );
        const wetWallFactor=Math.max(0,Math.min(1,bankWaterDepth/.65));
        const wetWallColor=mixColor(wallColor,[.16,.24,.23],.55*wetWallFactor);
        const rimColor=shade(edgeColor,.94*fog*elevationShade(top));
        const apronColor=shade(lowerColor,.76*fog);

        for(let i=0;i<rough.length-1;i++){
          const a=rough[i],b=rough[i+1];
          const ta=a.t,tb=b.t;
          const aTop=this.profileHeight(topA,topM,topB,ta);
          const bTop=this.profileHeight(topA,topM,topB,tb);
          const aBot=this.profileHeight(botA,botM,botB,ta);
          const bBot=this.profileHeight(botA,botM,botB,tb);

          // Water-contact cliffs use the same geometry, but the lower rock band
          // becomes damp instead of keeping a grass-derived wall colour all the way
          // down to the waterline.
          if(wetWallFactor>0){
            const aMid=aBot+(aTop-aBot)*.46;
            const bMid=bBot+(bTop-bBot)*.46;
            this.pushCliffQuad(
              out,
              {x:a.x,y:aBot,z:a.z},
              {x:b.x,y:bBot,z:b.z},
              {x:b.x,y:bMid,z:b.z},
              {x:a.x,y:aMid,z:a.z},
              wetWallColor
            );
            this.pushCliffQuad(
              out,
              {x:a.x,y:aMid,z:a.z},
              {x:b.x,y:bMid,z:b.z},
              {x:b.x,y:bTop,z:b.z},
              {x:a.x,y:aTop,z:a.z},
              wallColor
            );
          }else{
            this.pushCliffQuad(
              out,
              {x:a.x,y:aBot,z:a.z},
              {x:b.x,y:bBot,z:b.z},
              {x:b.x,y:bTop,z:b.z},
              {x:a.x,y:aTop,z:a.z},
              wallColor
            );
          }

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
      submergedBedIsolation:true,
      naturalMaterialTransitions:true,
      microRegionGeometry:true,
      vertexColorTransitions:true,
      wetCliffBands:true,
      reliefLighting:true,
      ruggedNaturalCliffs:true,
      visualSurfaceResolver:this.surfaceResolver.diagnostics(),
      skippedDegenerate:surface?.metadata?.skippedDegenerate??null,
      minNormalY:surface?.metadata?.minNormalY??null
    };
  }
}

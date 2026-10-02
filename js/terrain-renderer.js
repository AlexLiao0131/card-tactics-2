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
const CLIFF_EDGE_SEGMENTS=3;
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

// Periodic detail fields: four small neutral textures retain the resolver's
// established palette. No external image fetches or per-frame canvas work.
function textureNoise(x,y,period,seed){
  const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
  const smooth=t=>t*t*(3-2*t),u=smooth(tx),v=smooth(ty);
  const value=(a,b)=>{
    const px=((a%period)+period)%period,py=((b%period)+period)%period;
    // Avalanche adjacent lattice coordinates so neighbouring samples do not
    // inherit the correlations of string hashes (visible as bands).
    let h=(seed^Math.imul(px,374761393)^Math.imul(py,668265263))>>>0;
    h=Math.imul(h^(h>>>16),0x7feb352d);
    h=Math.imul(h^(h>>>15),0x846ca68b);
    return((h^(h>>>16))>>>0)/4294967295;
  };
  const a=value(ix,iy)*(1-u)+value(ix+1,iy)*u;
  const b=value(ix,iy+1)*(1-u)+value(ix+1,iy+1)*u;
  return a*(1-v)+b*v;
}

export class TerrainRenderer{
  constructor(scene){
    this.scene=scene;
    this.meshes=new Map();
    this.signatureValue="";
    this.surfaceGeometrySignature="";
    this.cliffGeometrySignature="";
    this.surfaceColorBindings=[];
    this.cliffColorBindings=[];
    this.surfaceColors=null;
    this.cliffColors=null;
    this.updateCounts={surfaceBuilds:0,cliffBuilds:0,colorUpdates:0};
    this.surfaceResolver=new VisualSurfaceResolver();
    this.textureSignature="";
    this.textureBounds=null;
    this.surfaceMaterial=this.makeSurfaceMaterial();
    this.cliffMaterial=this.makeCliffMaterial();
    this.grassSignature="";this.grassMesh=null;this.grassBlades=[];
    this.grassTime=0;this.grassFrameTime=0;this.grassWasCalm=true;
    this.grassMaterial=new BABYLON.StandardMaterial("terrain-grass",scene);
    this.grassMaterial.diffuseColor=BABYLON.Color3.White();
    this.grassMaterial.specularColor=BABYLON.Color3.Black();
    this.grassMaterial.backFaceCulling=false;this.grassMaterial.twoSidedLighting=true;
    this.grassMaterial.maxSimultaneousLights=8;
    this.grassObserver=scene.onBeforeRenderObservable.add(()=>this.animateGrass(Math.min(.1,Math.max(0,scene.getEngine().getDeltaTime()/1000))));
    scene.onDisposeObservable.addOnce(()=>scene.onBeforeRenderObservable.remove(this.grassObserver));
  }

  makeSurfaceMaterial(){
    const material=new BABYLON.MixMaterial("terrain-surface",this.scene);
    this.detailTextures=["grass","soil","rock","sand"].map(kind=>this.makeDetailTexture(kind));
    this.detailTextures.forEach((texture,index)=>{material[`diffuseTexture${index+1}`]=texture;});
    material.mixTexture1=BABYLON.RawTexture.CreateRGBATexture(new Uint8Array([255,0,0,255]),1,1,this.scene,false,false,BABYLON.Texture.BILINEAR_SAMPLINGMODE);
    // Scene uses three base lights, lightning, and bounded local fire lights.
    material.maxSimultaneousLights=8;
    material.diffuseColor=BABYLON.Color3.White();
    // Neutral detail is multiplied by existing wet/depth/fog vertex colours.
    material.specularColor=new BABYLON.Color3(.018,.018,.018);
    material.specularPower=7;
    // Geometry has deterministic winding and face normals now.
    material.backFaceCulling=true;
    material.twoSidedLighting=false;
    return material;
  }

  makeDetailTexture(kind){
    const size=128,pixels=new Uint8Array(size*size*4);
    const seed=Math.floor(hash01(kind)*4294967295);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const u=x/size,v=y/size;
      // Periodic domain warping breaks up the underlying noise lattice while
      // keeping repeat edges seamless. No axis-aligned seams or sine stripes.
      const wx=textureNoise(u*4,v*4,4,seed^101)-.5;
      const wy=textureNoise(u*4,v*4,4,seed^307)-.5;
      const coarse=textureNoise(u*8+wx,v*8+wy,8,seed);
      const fine=textureNoise(u*32+wx,v*32+wy,32,seed^911);
      let detail;
      if(kind==="grass")detail=.85+.10*coarse+.025*fine;
      else if(kind==="soil")detail=.82+.13*coarse+.05*fine;
      else if(kind==="rock")detail=.86+.11*coarse+.025*fine;
      else detail=.89+.06*coarse+.025*fine;
      const value=Math.round(Math.max(0,Math.min(1,detail))*255),offset=(y*size+x)*4;
      pixels[offset]=pixels[offset+1]=pixels[offset+2]=value;pixels[offset+3]=255;
    }
    const texture=BABYLON.RawTexture.CreateRGBATexture(pixels,size,size,this.scene,true,false,BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    texture.name=`terrain-detail-${kind}`;texture.wrapU=texture.wrapV=BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.anisotropicFilteringLevel=2;
    return texture;
  }

  syncGrass(state,tiles){
    this.grassWind=state?.presentation?.environment?.wind||{x:0,y:0,strength:0};
    const signature=tiles.map(t=>[t.x,t.y,t.terrain,t.material,t.elevation,t.waterDepth,t.snowDepth,t.iceThickness,t.soilMoisture,t.debrisMass,t.fogged,!!t.core,!!t.capturePoint,(t.effects||[]).join(",")].join(":")).join("|");
    if(signature===this.grassSignature)return;
    this.grassSignature=signature;
    this.grassMesh?.dispose();this.grassMesh=null;this.grassBlades=[];
    if(!tiles.length)return;
    const byKey=new Map(tiles.map(t=>[keyOf(t.x,t.y),t])),candidates=[];
    for(const tile of tiles){
      const terrain=this.surfaceResolver.baseTerrainOf(tile);
      if(!["PLAIN","FOREST"].includes(terrain)||tile.core||tile.capturePoint||
        Number(tile.waterDepth||0)>.001||Number(tile.iceThickness||0)>.01||
        Number(tile.snowDepth||0)>.03||Number(tile.debrisMass||0)>.02||
        (tile.effects||[]).some(e=>e==="BURNING"||e==="FIRE_TORNADO"))continue;
      for(let i=0;i<5;i++)candidates.push({tile,i,rank:textureNoise(tile.x*7+i,tile.y*7,8192,701)});
    }
    // Distribute a fixed budget across the map, not just the first rows.
    candidates.sort((a,b)=>a.rank-b.rank);
    const positions=[],colors=[],indices=[];
    for(const {tile,i,rank} of candidates.slice(0,896)){
      const random=salt=>textureNoise(tile.x*13+i,tile.y*13,8192,salt);
      const ox=(random(173)-.5)*.78,oz=(random(397)-.5)*.78;
      // Leave the tile centre legible for units and small props.
      if(Math.hypot(ox,oz)<.18)continue;
      // Keep roots and their maximum wind bend back from wet neighbouring cells.
      const nearWater=[[1,0],[-1,0],[0,1],[0,-1]].some(([x,y])=>
        Number(byKey.get(keyOf(tile.x+x,tile.y+y))?.waterDepth||0)>.001&&ox*x+oz*y>.20);
      if(nearWater)continue;
      const tint=this.surfaceResolver.surfaceColorAt(tile,byKey,ox,oz);
      for(let blade=0;blade<3;blade++){
        const angle=random(613+blade*41)*Math.PI*2;
        const dx=Math.cos(angle),dz=Math.sin(angle),width=.035+random(883+blade)*.025;
        const height=.24+random(991+blade)*.19;
        const cx=(tile.x+ox)*TILE_SIZE+dx*.055,cz=(tile.y+oz)*TILE_SIZE+dz*.055;
        const rootY=(x,z)=>this.surfaceResolver.sampleRenderedHeight(tile,byKey,x/TILE_SIZE-tile.x,z/TILE_SIZE-tile.y)*ELEVATION_HEIGHT+.004;
        const cy=rootY(cx,cz),base=positions.length/3;
        const vertices=[
          [cx-dx*width,rootY(cx-dx*width,cz-dz*width),cz-dz*width],
          [cx+dx*width,rootY(cx+dx*width,cz+dz*width),cz+dz*width],
          [cx-dx*width*.5,cy+height*.55,cz-dz*width*.5],
          [cx+dx*width*.5,cy+height*.55,cz+dz*width*.5],
          [cx+dx*.06,cy+height,cz+dz*.06]
        ];
        for(let v=0;v<5;v++){
          positions.push(...vertices[v]);
          const shade=v<2?.67:v<4?.95:1.15;
          colors.push(Math.min(1,tint[0]*shade*.85),Math.min(1,tint[1]*shade*1.08),Math.min(1,tint[2]*shade*.75),1);
        }
        indices.push(base,base+2,base+1,base+1,base+2,base+3,base+2,base+4,base+3);
        this.grassBlades.push({base:base*3,height,phase:rank*Math.PI*2+blade*.7});
      }
    }
    if(!positions.length)return;
    const mesh=new BABYLON.Mesh("terrain-grass",this.scene),data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.colors=colors;
    data.normals=[];BABYLON.VertexData.ComputeNormals(positions,indices,data.normals);
    data.applyToMesh(mesh,true);
    mesh.material=this.grassMaterial;mesh.useVertexColors=true;mesh.isPickable=false;mesh.receiveShadows=true;
    mesh.metadata={kind:"terrain-grass",visualOnly:true,bladeCount:this.grassBlades.length};
    // Wind cannot move a tip further than this padded bound. Roots stay fixed.
    const bounds=mesh.getBoundingInfo().boundingBox;
    mesh.setBoundingInfo(new BABYLON.BoundingInfo(bounds.minimum.subtract(new BABYLON.Vector3(.3,0,.3)),bounds.maximum.add(new BABYLON.Vector3(.3,0,.3))));
    this.grassMesh=mesh;this.grassRest=new Float32Array(positions);this.grassPositions=new Float32Array(positions);
    this.animateGrass(0,true);
  }

  animateGrass(dt,force=false){
    this.grassTime+=dt;this.grassFrameTime+=dt;
    if(!this.grassMesh||(!force&&this.grassFrameTime<1/30))return;
    this.grassFrameTime=0;
    const wind=this.grassWind||{},strength=Math.max(0,Math.min(3,Number(wind.strength||0)));
    // Calm really is calm; do not invent wind in the presentation layer.
    if(!force&&strength===0&&this.grassWasCalm)return;
    this.grassWasCalm=strength===0;
    const length=Math.hypot(Number(wind.x||0),Number(wind.y||0))||1;
    const wx=Number(wind.x||0)/length,wz=Number(wind.y||0)/length;
    const out=this.grassPositions,rest=this.grassRest;
    for(const blade of this.grassBlades){
      const wave=.62+.28*Math.sin(this.grassTime*(1.5+strength*.5)+blade.phase)+.1*Math.sin(this.grassTime*3.1+blade.phase*2);
      const bend=blade.height*strength*.17*wave;
      for(let vertex=2;vertex<5;vertex++){
        const offset=blade.base+vertex*3,weight=vertex===4?1:.3;
        out[offset]=rest[offset]+wx*bend*weight;
        out[offset+2]=rest[offset+2]+wz*bend*weight;
      }
    }
    this.grassMesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,out,false,false);
  }

  syncMaterialMap(tiles,byKey){
    const signature=tiles.map(tile=>[tile.x,tile.y,tile.terrain,tile.dryTerrain,tile.material,this.surfaceResolver.elevationOf(tile),Number(tile.waterDepth||0)>0?1:0].join(":")).join("|");
    if(signature===this.textureSignature)return;
    const minX=Math.min(...tiles.map(t=>Number(t.x))),minY=Math.min(...tiles.map(t=>Number(t.y)));
    const spanX=Math.max(...tiles.map(t=>Number(t.x)))-minX+1,spanY=Math.max(...tiles.map(t=>Number(t.y)))-minY+1;
    const width=spanX*4,height=spanY*4,pixels=new Uint8Array(width*height*4);
    for(let py=0;py<height;py++)for(let px=0;px<width;px++){
      const gx=minX-.5+(px+.5)/4,gy=minY-.5+(py+.5)/4;
      const tile=byKey.get(keyOf(Math.round(gx),Math.round(gy)));
      const w=tile?this.surfaceResolver.materialWeightsAt(tile,byKey,gx-tile.x,gy-tile.y):[0,1,0,0];
      const offset=(py*width+px)*4,first=w[0]+w[1],firstThree=first+w[2];
      // MixMaterial uses sequential blends, with inverted alpha (not RGBA
      // additive splatting). Convert normalized weights to those blend factors.
      pixels[offset]=255;
      pixels[offset+1]=Math.round(255*(first>0?w[1]/first:0));
      pixels[offset+2]=Math.round(255*(firstThree>0?w[2]/firstThree:0));
      pixels[offset+3]=Math.round(255*(1-w[3]));
    }
    const previous=this.surfaceMaterial.mixTexture1,dimensions=previous.getSize();
    if(dimensions.width===width&&dimensions.height===height)previous.update(pixels);
    else{
      const texture=BABYLON.RawTexture.CreateRGBATexture(pixels,width,height,this.scene,false,false,BABYLON.Texture.BILINEAR_SAMPLINGMODE);
      texture.name="terrain-material-mix";texture.wrapU=texture.wrapV=BABYLON.Texture.CLAMP_ADDRESSMODE;
      this.surfaceMaterial.mixTexture1=texture;previous.dispose();
    }
    for(const texture of this.detailTextures){texture.uScale=spanX/2;texture.vScale=spanY/2;}
    this.textureBounds={minX:minX-.5,minY:minY-.5,spanX,spanY};
    this.textureSignature=signature;
  }

  makeCliffMaterial(){
    const material=new BABYLON.StandardMaterial("terrain-cliffs",this.scene);
    material.diffuseColor=BABYLON.Color3.White();
    // Vertical rock faces keep stronger ambient colour so they read as exposed
    // earth/stone rather than a black outline along water and high-ground rims.
    material.ambientColor=new BABYLON.Color3(.32,.32,.32);
    material.specularColor=new BABYLON.Color3(.012,.012,.012);
    material.specularPower=5;
    // Cliff quads may face any cardinal direction.
    material.backFaceCulling=false;
    material.twoSidedLighting=true;
    return material;
  }

  disposeMeshes(){
    this.grassMesh?.dispose();this.grassMesh=null;this.grassBlades=[];this.grassSignature="";
    for(const mesh of this.meshes.values())mesh.dispose();
    this.meshes.clear();
    this.signatureValue="";
    this.surfaceGeometrySignature="";
    this.cliffGeometrySignature="";
    this.surfaceColorBindings=[];
    this.cliffColorBindings=[];
    this.surfaceColors=null;
    this.cliffColors=null;
    this.textureSignature="";
  }

  signature(tiles){
    return tiles.map(tile=>[
      tile.x,tile.y,
      String(tile.terrain||""),
      String(tile.dryTerrain||""),
      String(tile.material||""),
      Math.max(0,Number(tile.waterDepth||0)),
      Math.max(0,Number(tile.soilMoisture||0)),
      tile.fogged?1:0
    ].join(":")).sort().join("|");
  }


  geometrySignature(tiles){
    // Height sampling and cliff silhouettes depend on the grid and elevations,
    // not terrain colour, moisture or visibility. Sort both data and signatures
    // so presentation tile reordering cannot misalign cached colour bindings.
    return `${this.surfaceResolver.maxVisualSlopeDelta}|`+tiles.map(tile=>[
      tile.x,tile.y,this.surfaceResolver.elevationOf(tile)
    ].join(":")).join("|");
  }

  cliffWaterSignature(tiles,byKey){
    // Existing wet cliffs have two vertical bands; dry cliffs have one. Only a
    // wet/dry crossing on an actual cliff changes that topology, not water level.
    const boundaryBase=(tiles.length?Math.min(...tiles.map(tile=>this.surfaceResolver.elevationOf(tile))):0)-.75;
    return tiles.map(tile=>DIRS.map(dir=>{
      const neighbor=this.surfaceResolver.tileAt(byKey,tile.x+dir.dx,tile.y+dir.dy);
      const lower=neighbor?this.surfaceResolver.elevationOf(neighbor):boundaryBase;
      if(this.surfaceResolver.elevationOf(tile)-lower<=this.surfaceResolver.maxVisualSlopeDelta)return "";
      return Math.max(this.surfaceResolver.waterDepthOf(tile),this.surfaceResolver.waterDepthOf(neighbor))>0?1:0;
    }).join("")).join("|");
  }

  updateSurfaceColors(byKey){
    for(const binding of this.surfaceColorBindings){
      const tile=byKey.get(binding.key),fog=tile.fogged?.62:1;
      const colors=binding.samples.map(sample=>shade(
        this.surfaceResolver.surfaceColorAt(tile,byKey,sample.ox,sample.oz),
        fog*elevationShade(sample.height)
      ));
      for(const vertex of binding.vertices){
        const color=shade(colors[vertex.sample],vertex.lightFactor);
        this.surfaceColors.set([...color,1],vertex.offset);
      }
    }
    this.meshes.get("surface").updateVerticesData(BABYLON.VertexBuffer.ColorKind,this.surfaceColors);
  }

  cliffPalette(tile,neighbor,dir,byKey,drop){
    const fog=tile.fogged?.62:1;
    const edgeColor=this.surfaceResolver.transitionColorAt(tile,byKey,dir.dx*.46,dir.dy*.46);
    const lowerColor=neighbor
      ?this.surfaceResolver.transitionColorAt(neighbor,byKey,-dir.dx*.46,-dir.dy*.46)
      :this.surfaceResolver.colorOf(tile);
    const exposedRock=mixColor(edgeColor,[.34,.32,.27],.38);
    const wallColor=shade(exposedRock,Math.max(.76,.86-Math.min(.08,drop*.015))*fog);
    const bankWaterDepth=Math.max(this.surfaceResolver.waterDepthOf(tile),this.surfaceResolver.waterDepthOf(neighbor));
    const wetWallFactor=Math.max(0,Math.min(1,bankWaterDepth/.65));
    return{
      wallColor,wetWallFactor,
      wetWallColor:mixColor(wallColor,[.16,.24,.23],.55*wetWallFactor),
      rimColor:shade(edgeColor,.98*fog*elevationShade(this.surfaceResolver.elevationOf(tile))),
      apronColor:shade(lowerColor,.86*fog)
    };
  }

  updateCliffColors(byKey){
    if(!this.meshes.has("cliffs"))return;
    for(const binding of this.cliffColorBindings){
      const tile=byKey.get(binding.key);
      const neighbor=this.surfaceResolver.tileAt(byKey,tile.x+binding.dir.dx,tile.y+binding.dir.dy);
      const palette=this.cliffPalette(tile,neighbor,binding.dir,byKey,binding.drop);
      for(const range of binding.ranges){
        const color=palette[range.kind];
        for(let i=range.start;i<range.end;i+=4)this.cliffColors.set([...color,1],i);
      }
    }
    this.meshes.get("cliffs").updateVerticesData(BABYLON.VertexBuffer.ColorKind,this.cliffColors);
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
    const lightFactor=.94+sunDot*.06;
    const base=out.positions.length/3;

    points.forEach((point,index)=>{
      const color=shade(sourceColors[index],lightFactor);
      out.positions.push(point.x,point.y,point.z);
      out.normals.push(n.x,n.y,n.z);
      const bounds=this.textureBounds;
      out.uvs.push((point.x/TILE_SIZE-bounds.minX)/bounds.spanX,(point.z/TILE_SIZE-bounds.minY)/bounds.spanY);
      out.binding.vertices.push({sample:point.sample,offset:out.colors.length,lightFactor});
      out.colors.push(color[0],color[1],color[2],1);
    });
    out.indices.push(base,base+1,base+2);
    return true;
  }

  buildSurface(tiles,byKey){
    this.surfaceColorBindings=[];
    this.updateCounts.surfaceBuilds++;
    const out={positions:[],indices:[],normals:[],colors:[],uvs:[]};
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
      const samples=visual.patchGrid.flat();
      out.binding={key:keyOf(tile.x,tile.y),samples,vertices:[]};
      this.surfaceColorBindings.push(out.binding);
      const grid=visual.patchGrid.map((row,rowIndex)=>row.map((sample,colIndex)=>({
        point:{
          sample:rowIndex*4+colIndex,
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
    data.uvs=out.uvs;
    data.applyToMesh(mesh,false);
    this.surfaceColors=new Float32Array(out.colors);
    mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind,this.surfaceColors,true);

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

  cliffSurfaceEdgeSamples(tile,dir,byKey){
    const patch=this.surfaceResolver.resolveTile(tile,byKey).patchGrid;
    if(dir.id==="N")return patch[0].map(sample=>({x:sample.x,z:sample.z,y:sample.height*ELEVATION_HEIGHT}));
    if(dir.id==="E")return patch.map(row=>row[3]).map(sample=>({x:sample.x,z:sample.z,y:sample.height*ELEVATION_HEIGHT}));
    if(dir.id==="S")return [...patch[3]].reverse().map(sample=>({x:sample.x,z:sample.z,y:sample.height*ELEVATION_HEIGHT}));
    return [...patch].reverse().map(row=>row[0]).map(sample=>({x:sample.x,z:sample.z,y:sample.height*ELEVATION_HEIGHT}));
  }

  cliffLowerEdgeSamples(neighbor,dir,byKey){
    if(!neighbor)return null;
    const patch=this.surfaceResolver.resolveTile(neighbor,byKey).patchGrid;
    // Return the neighbouring surface along the exact same world-space edge and
    // in the same point order as the higher tile's edge.
    if(dir.id==="N")return patch[3].map(sample=>({x:sample.x,z:sample.z,y:sample.height*ELEVATION_HEIGHT}));
    if(dir.id==="E")return patch.map(row=>row[0]).map(sample=>({x:sample.x,z:sample.z,y:sample.height*ELEVATION_HEIGHT}));
    if(dir.id==="S")return [...patch[0]].reverse().map(sample=>({x:sample.x,z:sample.z,y:sample.height*ELEVATION_HEIGHT}));
    return [...patch].reverse().map(row=>row[3]).map(sample=>({x:sample.x,z:sample.z,y:sample.height*ELEVATION_HEIGHT}));
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
    const start=out.colors.length;
    this.pushCliffTriangle(out,a,b,c,color);
    this.pushCliffTriangle(out,a,c,d,color);
    const kind=Object.keys(out.palette).find(key=>out.palette[key]===color);
    out.binding.ranges.push({start,end:out.colors.length,kind});
  }

  buildCliffs(tiles,byKey){
    this.cliffColorBindings=[];
    this.cliffColors=null;
    this.updateCounts.cliffBuilds++;
    const out={positions:[],indices:[],normals:[],colors:[]};
    const minElevation=tiles.length?Math.min(...tiles.map(tile=>this.surfaceResolver.elevationOf(tile))):0;
    const boundaryBase=minElevation-.75;
    const EH=ELEVATION_HEIGHT;

    // The underlying grid edge stays the rule boundary. The visible cliff rim is
    // an outward eroded polyline, but its inner cap edge now reuses the exact
    // VisualSurface patch vertices so the rugged silhouette cannot open cracks.

    let ruggedEdges=0;
    for(const tile of tiles){
      const top=this.surfaceResolver.elevationOf(tile);
      for(const dir of DIRS){
        const neighbor=this.surfaceResolver.tileAt(byKey,tile.x+dir.dx,tile.y+dir.dy);
        const lower=neighbor?this.surfaceResolver.elevationOf(neighbor):boundaryBase;
        const drop=top-lower;
        if(drop<=this.surfaceResolver.maxVisualSlopeDelta)continue;

        // The cap/apron must share the exact 4x4 VisualSurface edge vertices.
        // Estimating a separate corner→midpoint→corner profile created tiny gaps
        // after Stage 6 subdivided the terrain at 1/3 and 2/3 positions.
        const topEdge=this.cliffSurfaceEdgeSamples(tile,dir,byKey);
        const lowerEdge=this.cliffLowerEdgeSamples(neighbor,dir,byKey);

        const rough=this.cliffRoughPolyline(tile,dir);
        const nominal=this.cliffEdgePoints(tile,dir);
        const [[x1,z1],[x2,z2]]=nominal;
        out.palette=this.cliffPalette(tile,neighbor,dir,byKey,drop);
        const {wallColor,wetWallColor,wetWallFactor,rimColor,apronColor}=out.palette;
        out.binding={key:keyOf(tile.x,tile.y),dir,drop,ranges:[]};
        this.cliffColorBindings.push(out.binding);

        for(let i=0;i<rough.length-1;i++){
          const a=rough[i],b=rough[i+1];
          const ta=a.t,tb=b.t;
          const aTop=topEdge[i].y;
          const bTop=topEdge[i+1].y;
          const aBot=Math.min(lowerEdge?lowerEdge[i].y:lower*EH,aTop);
          const bBot=Math.min(lowerEdge?lowerEdge[i+1].y:lower*EH,bTop);

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

          // Original grid-edge samples and the rugged rim now meet at the exact
          // same heights as VisualSurface. No epsilon lift is needed because these
          // strips extend outside the terrain surface instead of overlapping it.
          const na={x:x1+(x2-x1)*ta,z:z1+(z2-z1)*ta};
          const nb={x:x1+(x2-x1)*tb,z:z1+(z2-z1)*tb};
          this.pushCliffQuad(
            out,
            {x:na.x,y:aTop,z:na.z},
            {x:nb.x,y:bTop,z:nb.z},
            {x:b.x,y:bTop,z:b.z},
            {x:a.x,y:aTop,z:a.z},
            rimColor
          );
          this.pushCliffQuad(
            out,
            {x:a.x,y:aBot,z:a.z},
            {x:b.x,y:bBot,z:b.z},
            {x:nb.x,y:bBot,z:nb.z},
            {x:na.x,y:aBot,z:na.z},
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
    data.applyToMesh(mesh,false);
    this.cliffColors=new Float32Array(out.colors);
    mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind,this.cliffColors,true);

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
      ruggedEdges,
      sharedVisualSurfaceEdgeVertices:true,
      sceneLightingPrimary:true,
      reducedBakedLighting:true,
      cliffEdgeSegments:CLIFF_EDGE_SEGMENTS
    };
    return mesh;
  }

  sync(state){
    const tiles=[...tilesOf(state)].sort((a,b)=>Number(a.y)-Number(b.y)||Number(a.x)-Number(b.x));
    this.syncGrass(state,tiles);
    if(!tiles.length){this.disposeMeshes();return;}
    const signature=this.signature(tiles);
    const geometry=this.geometrySignature(tiles);
    if(signature===this.signatureValue&&geometry===this.surfaceGeometrySignature)return;

    const byKey=new Map(tiles.map(tile=>[keyOf(tile.x,tile.y),tile]));
    this.syncMaterialMap(tiles,byKey);
    const cliffGeometry=geometry+"/"+this.cliffWaterSignature(tiles,byKey);
    const rebuildSurface=geometry!==this.surfaceGeometrySignature;
    const rebuildCliffs=cliffGeometry!==this.cliffGeometrySignature;
    if(rebuildSurface){
      this.meshes.get("surface")?.dispose();
      this.meshes.set("surface",this.buildSurface(tiles,byKey));
      this.surfaceGeometrySignature=geometry;
    }else this.updateSurfaceColors(byKey);

    if(rebuildCliffs){
      this.meshes.get("cliffs")?.dispose();
      this.meshes.delete("cliffs");
      const cliffs=this.buildCliffs(tiles,byKey);
      if(cliffs)this.meshes.set("cliffs",cliffs);
      this.cliffGeometrySignature=cliffGeometry;
    }else this.updateCliffColors(byKey);

    if(!rebuildSurface||!rebuildCliffs)this.updateCounts.colorUpdates++;
    this.signatureValue=signature;
  }

  diagnostics(){
    const surface=this.meshes.get("surface");
    return{
      meshes:this.meshes.size,
      updates:{...this.updateCounts},
      surfaceMaterial:"MixMaterial",
      detailTextureSize:128,
      grassBlades:this.grassBlades.length,
      grassClumpLimit:896,
      grassAnimationHz:30,
      materialMixSize:this.surfaceMaterial.mixTexture1.getSize(),
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
      cliffSurfaceEdgeMatched:true,
      visualSurfaceResolver:this.surfaceResolver.diagnostics(),
      skippedDegenerate:surface?.metadata?.skippedDegenerate??null,
      minNormalY:surface?.metadata?.minNormalY??null
    };
  }
}

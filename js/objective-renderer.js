import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
const ownerKey=owner=>owner==="PLAYER"?"PLAYER":owner==="ENEMY"?"ENEMY":"NEUTRAL";
const tileKey=(x,y)=>`${x},${y}`;
const surfaceZ=tile=>tile?.waterSurfaceZ==null?Number(tile?.elevation||0):Math.max(Number(tile?.elevation||0),Number(tile.waterSurfaceZ));
const CORE_WIDTH=1.22;
const CORE_HEIGHT=1.65;
const MARKER_RADIUS=.675;
const MARKER_CLEARANCE=.025;
const MARKER_SEGMENTS=32;
const MARKER_HEIGHT=.09;

export class ObjectiveRenderer{
  constructor(scene,{environment=null,terrain=null}={}){
    this.scene=scene;this.environment=environment;this.terrain=terrain;this.coverGeometry=[];this.cores=new Map();this.points=new Map();this.signatureValue=null;
    this.latestState=null;this.terrainDataCache=null;
    this.materials={
      PLAYER:this.mat("objective-player",new BABYLON.Color3(.20,.55,.95)),
      ENEMY:this.mat("objective-enemy",new BABYLON.Color3(.90,.24,.24)),
      NEUTRAL:this.mat("objective-neutral",new BABYLON.Color3(.86,.70,.18))
    };
    // Cores are solid lit crystals. Do not share an unlit tactical marker material
    // or their faces lose the scene's directional shading and specular highlights.
    this.coreMaterials={
      PLAYER:this.mat("core-player",new BABYLON.Color3(.20,.55,.95),true),
      ENEMY:this.mat("core-enemy",new BABYLON.Color3(.90,.24,.24),true),
      NEUTRAL:this.mat("core-neutral",new BABYLON.Color3(.86,.70,.18),true)
    };
    // TerrainRenderer publishes its triangles before ObjectiveRenderer.sync().
    // There is only one placement path; geometry revision, not mesh identity,
    // determines whether a height sample is still valid.
  }

  mat(name,color,crystal=false){
    const m=new BABYLON.StandardMaterial(name,this.scene);
    // Restore the original physically raised, light-responsive materials.
    // Emission keeps team ownership legible without disabling 3D shading.
    m.diffuseColor=color;
    m.emissiveColor=color.scale(.18);
    if(crystal){
      m.specularColor=new BABYLON.Color3(.32,.32,.32);
      m.specularPower=36;
    }
    return m;
  }
  // Reuse the same published cover mesh triangles as tactical highlights.
  // Never infer a new snow surface from tile.snowDepth or grid elevations.
  coverYAt(tile,x,z){
    if(!tile||!this.environment)return -Infinity;
    return this.environment.publishedCoverYAt(tile,x,z,this.coverGeometry)??-Infinity;
  }
  coverHighest(tile,cx,cz){
    if(!tile||!this.coverGeometry.length)return -Infinity;
    let highest=this.coverYAt(tile,cx,cz);
    for(let i=0;i<MARKER_SEGMENTS;i++){
      const angle=i*2*Math.PI/MARKER_SEGMENTS,cos=Math.cos(angle),sin=Math.sin(angle);
      for(const radius of [MARKER_RADIUS*.5,MARKER_RADIUS])
        highest=Math.max(highest,this.coverYAt(tile,cx+cos*radius,cz+sin*radius));
    }
    // Capture the peak of any visible published snow/ice vertex inside the
    // marker's circle, even when the edge samples missed that vertex.
    const key=tileKey(tile.x,tile.y),r2=MARKER_RADIUS*MARKER_RADIUS+1e-8;
    for(const layer of this.coverGeometry){
      const range=layer.tileRanges?.get(key);
      if(!range)continue;
      for(let v=range.startVertex;v<range.startVertex+range.vertexCount;v++){
        if(Number(layer.colors[v*4+3]||0)<=.001)continue;
        const x=layer.positions[v*3],z=layer.positions[v*3+2];
        if((x-cx)**2+(z-cz)**2<=r2)
          highest=Math.max(highest,Number(layer.positions[v*3+1]));
      }
    }
    return highest;
  }
  surfaceY(tile){return surfaceZ(tile)*ELEVATION_HEIGHT;}
  waterY(tile){
    const depth=Math.max(0,Number(tile?.waterDepth||0));
    return depth>.0001?(tile?.waterSurfaceZ==null?Number(tile?.elevation||0)+depth:Number(tile.waterSurfaceZ))*ELEVATION_HEIGHT:-Infinity;
  }
  publishedTerrainMesh(){
    const mesh=this.scene.getMeshByName("terrain-surface");
    return mesh?.metadata?.kind==="terrain-surface"?mesh:null;
  }
  publishedTerrainRevision(){
    return this.terrain?.surfaceResolver?.renderedSurfaceGeometryRevision??null;
  }
  terrainData(){
    const mesh=this.publishedTerrainMesh();
    if(!mesh){this.terrainDataCache=null;return null;}
    const revision=this.publishedTerrainRevision();
    if(this.terrainDataCache?.mesh===mesh&&this.terrainDataCache.revision===revision)
      return this.terrainDataCache;
    const positions=mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind),indices=mesh.getIndices();
    this.terrainDataCache=positions?.length&&indices?.length?{mesh,revision,positions,indices}:null;
    return this.terrainDataCache;
  }
  // The triangle vertices are the actual TerrainRenderer -> Babylon output,
  // not tile.elevation or a second terrain-height approximation.
  terrainTriangle(data,i){
    const {positions,indices}=data;
    return[0,1,2].map(j=>{
      const offset=indices[i+j]*3;
      return{x:Number(positions[offset]),y:Number(positions[offset+1]),z:Number(positions[offset+2])};
    });
  }
  triangleMayTouch(data,i,minX,maxX,minZ,maxZ){
    const {positions,indices}=data;
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    return Math.max(positions[a],positions[b],positions[c])>=minX&&
      Math.min(positions[a],positions[b],positions[c])<=maxX&&
      Math.max(positions[a+2],positions[b+2],positions[c+2])>=minZ&&
      Math.min(positions[a+2],positions[b+2],positions[c+2])<=maxZ;
  }
  pointHeight(data,x,z){
    if(!data)return null;
    for(let i=0;i<data.indices.length;i+=3){
      if(!this.triangleMayTouch(data,i,x-1e-6,x+1e-6,z-1e-6,z+1e-6))continue;
      const [a,b,c]=this.terrainTriangle(data,i);
      const dx1=b.x-a.x,dz1=b.z-a.z,dx2=c.x-a.x,dz2=c.z-a.z,den=dx1*dz2-dz1*dx2;
      if(Math.abs(den)<1e-12)continue;
      const u=((x-a.x)*dz2-(z-a.z)*dx2)/den,v=(dx1*(z-a.z)-dz1*(x-a.x))/den;
      if(u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6)return a.y+(b.y-a.y)*u+(c.y-a.y)*v;
    }
    return null;
  }
  // Exact support under a rigid Core box: clip the already published terrain
  // triangles against its world-space footprint. The maximum of a planar
  // triangle over that rectangle occurs at an intersection vertex. Sampling
  // only the centre can embed half a box into a sloped terrain patch.
  terrainFootprintHighest(data,cx,cz,halfWidth,halfDepth){
    if(!data)return null;
    const minX=cx-halfWidth,maxX=cx+halfWidth,minZ=cz-halfDepth,maxZ=cz+halfDepth;
    const clip=(polygon,axis,bound,greater)=>{
      if(!polygon.length)return polygon;
      const result=[];
      for(let i=0;i<polygon.length;i++){
        const a=polygon[i],b=polygon[(i+1)%polygon.length];
        const ain=greater?a[axis]>=bound:a[axis]<=bound;
        const bin=greater?b[axis]>=bound:b[axis]<=bound;
        if(ain)result.push(a);
        if(ain!==bin){
          const t=(bound-a[axis])/(b[axis]-a[axis]);
          result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
        }
      }
      return result;
    };
    let highest=null;
    for(let i=0;i<data.indices.length;i+=3){
      if(!this.triangleMayTouch(data,i,minX,maxX,minZ,maxZ))continue;
      let polygon=this.terrainTriangle(data,i);
      polygon=clip(polygon,"x",minX,true);
      polygon=clip(polygon,"x",maxX,false);
      polygon=clip(polygon,"z",minZ,true);
      polygon=clip(polygon,"z",maxZ,false);
      for(const vertex of polygon)highest=highest==null?vertex.y:Math.max(highest,vertex.y);
    }
    return highest;
  }

  // Build a height sampler from the *published* terrain triangles covering the
  // capture footprint. The renderer's actual terrain mesh remains the only
  // spatial authority; this does not recompute terrain from grid elevations.
  footprintSurface(data,cx,cz){
    if(!data)return null;
    const triangles=[];
    for(let i=0;i<data.indices.length;i+=3){
      if(this.triangleMayTouch(data,i,cx-MARKER_RADIUS,cx+MARKER_RADIUS,
        cz-MARKER_RADIUS,cz+MARKER_RADIUS))triangles.push(this.terrainTriangle(data,i));
    }
    const sample=(x,z)=>{
      for(const [a,b,c] of triangles){
        const dx1=b.x-a.x,dz1=b.z-a.z,dx2=c.x-a.x,dz2=c.z-a.z;
        const den=dx1*dz2-dz1*dx2;
        if(Math.abs(den)<1e-12)continue;
        const u=((x-a.x)*dz2-(z-a.z)*dx2)/den;
        const v=(dx1*(z-a.z)-dz1*(x-a.x))/den;
        if(u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6)
          return a.y+(b.y-a.y)*u+(c.y-a.y)*v;
      }
      return null;
    };
    let highest=sample(cx,cz);
    for(let i=0;i<MARKER_SEGMENTS;i++){
      const angle=2*Math.PI*i/MARKER_SEGMENTS;
      const cos=Math.cos(angle),sin=Math.sin(angle);
      for(const radius of [MARKER_RADIUS*.5,MARKER_RADIUS]){
        const height=sample(cx+cos*radius,cz+sin*radius);
        if(Number.isFinite(height))highest=highest==null?height:Math.max(highest,height);
      }
    }
    // A rendered terrain vertex can be a local peak between ring samples.
    // Include such peaks so the level top never intersects the terrain.
    const radiusSquared=MARKER_RADIUS*MARKER_RADIUS+1e-8;
    for(const tri of triangles)for(const point of tri){
      if((point.x-cx)**2+(point.z-cz)**2<=radiusSquared)
        highest=highest==null?point.y:Math.max(highest,point.y);
    }
    return{sample,highest};
  }
  captureMesh(id){
    // Preserve the original 32-sided cylinder, its flat upper cap and solid
    // side walls; only its underside is adjusted to meet the rendered terrain.
    const mesh=BABYLON.MeshBuilder.CreateCylinder(`capture-${id}`,
      {diameter:MARKER_RADIUS*2,height:MARKER_HEIGHT,tessellation:MARKER_SEGMENTS,
        updatable:true},this.scene);
    mesh.isPickable=false;
    mesh.metadata={kind:"capture-point",shape:"TERRAIN_SUPPORTED_CYLINDER",
      terrainConforming:false,terrainSupportedUnderside:true,
      originalPositions:Float32Array.from(mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind))};
    return mesh;
  }
  // A rigid cylinder raised to the footprint's highest point floats above
  // lower ground. Keep its top perfectly level, but lower the bottom vertices
  // to the *same* terrain surface at each vertex (including the bottom centre).
  // This fills the gap with real side-wall geometry instead of a flat decal.
  positionCapture(mesh,cx,cz,terrain,tile){
    const footprint=this.footprintSurface(terrain,cx,cz);
    const fallback=Number(tile.elevation||0)*ELEVATION_HEIGHT;
    const waterY=this.waterY(tile);
    const groundAt=(x,z)=>{
      const sampled=footprint?.sample(x,z);
      return Math.max(Number.isFinite(sampled)?sampled:fallback,waterY,this.coverYAt(tile,x,z));
    };
    const supportY=Math.max(footprint?.highest??fallback,waterY,this.coverHighest(tile,cx,cz));
    const centreY=supportY+MARKER_CLEARANCE+MARKER_HEIGHT*.5;
    const original=mesh.metadata.originalPositions;
    const positions=Float32Array.from(original),normals=[];
    let minGroundClearance=Infinity,maxWallHeight=0,minWallHeight=Infinity;
    for(let i=0;i<positions.length;i+=3){
      // Babylon.CreateCylinder duplicates top/side/bottom vertices to keep
      // hard normals at the cap. Change *only* the bottom copy in each group.
      if(original[i+1]>-MARKER_HEIGHT*.5+1e-5)continue;
      const ground=groundAt(cx+Number(original[i]),cz+Number(original[i+2]));
      const underside=ground+MARKER_CLEARANCE;
      positions[i+1]=underside-centreY;
      minGroundClearance=Math.min(minGroundClearance,underside-ground);
      const wallHeight=supportY+MARKER_HEIGHT-ground;
      minWallHeight=Math.min(minWallHeight,wallHeight);
      maxWallHeight=Math.max(maxWallHeight,wallHeight);
    }
    BABYLON.VertexData.ComputeNormals(positions,mesh.getIndices(),normals);
    mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,positions,true,false);
    mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind,normals);
    mesh.position.set(cx,centreY,cz);
    mesh.metadata={...mesh.metadata,publishedTerrainGeometry:footprint?.highest!=null,
      supportWorldY:supportY,minimumGroundClearance:Number.isFinite(minGroundClearance)?minGroundClearance:null,
      centreBottomWorldY:groundAt(cx,cz)+MARKER_CLEARANCE,
      topWorldY:centreY+MARKER_HEIGHT*.5,
      minimumWallHeight:Number.isFinite(minWallHeight)?minWallHeight:null,
      maximumWallHeight:maxWallHeight};
  }
  signature(state,byKey){
    const cores=(state?.cores||[]).map(core=>[
      "C",core.id,ownerKey(core.owner),core.hp>0?1:0,core.x,core.y,
      surfaceZ(byKey.get(tileKey(core.x,core.y))),
      this.waterY(byKey.get(tileKey(core.x,core.y)))
    ].join(":"));
    const points=(state?.presentation?.deploymentPoints||[]).filter(point=>point.capturable!==false&&point.captureTiles?.[0]).map(point=>{
      const tile=point.captureTiles[0];
      return["P",point.id,ownerKey(point.owner),tile.x,tile.y,
        surfaceZ(byKey.get(tileKey(tile.x,tile.y))),this.waterY(byKey.get(tileKey(tile.x,tile.y)))].join(":");
    });
    // Snow/ice geometry is published before ObjectiveRenderer.sync(). Any
    // change in the cover vertices must refresh core and capture support.
    return `${this.publishedTerrainMesh()?.uniqueId??"unpublished"}|${this.publishedTerrainRevision()??"unpublished"}|${this.environment?.publishedCoverRevision||0}|${[...cores,...points].sort().join(";")}`;
  }
  sync(state){
    this.latestState=state;
    this.refresh(state);
  }
  refresh(state){
    const tiles=state?.map?.tiles||[],byKey=new Map(tiles.map(tile=>[tileKey(tile.x,tile.y),tile]));
    const signature=this.signature(state,byKey);
    if(signature===this.signatureValue)return;
    this.signatureValue=signature;
    const terrain=this.terrainData();
    this.coverGeometry=this.environment?.publishedCoverGeometry?.()||[];

    const coreAlive=new Set();
    for(const core of state?.cores||[]){
      coreAlive.add(core.id);let mesh=this.cores.get(core.id);
      if(!mesh){mesh=BABYLON.MeshBuilder.CreateBox(`core-${core.id}`,{width:CORE_WIDTH,depth:CORE_WIDTH,height:CORE_HEIGHT},this.scene);mesh.isPickable=false;this.cores.set(core.id,mesh);}
      const tile=byKey.get(tileKey(core.x,core.y)),cx=core.x*TILE_SIZE,cz=core.y*TILE_SIZE;
      const publishedY=this.terrainFootprintHighest(terrain,cx,cz,CORE_WIDTH/2,CORE_WIDTH/2);
      mesh.material=this.coreMaterials[ownerKey(core.owner)];
      const supportY=Math.max(publishedY??Number(tile?.elevation||0)*ELEVATION_HEIGHT,
        this.waterY(tile),this.coverYAt(tile,cx,cz));
      mesh.position.set(cx,supportY+CORE_HEIGHT/2,cz);
      mesh.visibility=core.hp>0?1:.2;
    }
    for(const[id,mesh]of this.cores)if(!coreAlive.has(id)){mesh.dispose();this.cores.delete(id);}

    const pointAlive=new Set();
    for(const point of state?.presentation?.deploymentPoints||[]){
      if(point.capturable===false)continue;
      const capture=point.captureTiles?.[0];if(!capture)continue;
      const tile=byKey.get(tileKey(capture.x,capture.y));if(!tile)continue;
      pointAlive.add(point.id);
      let mesh=this.points.get(point.id);
      if(!mesh){mesh=this.captureMesh(point.id);this.points.set(point.id,mesh);}
      const cx=capture.x*TILE_SIZE,cz=capture.y*TILE_SIZE;
      this.positionCapture(mesh,cx,cz,terrain,tile);
      mesh.material=this.materials[ownerKey(point.owner)];
    }
    for(const[id,mesh]of this.points)if(!pointAlive.has(id)){mesh.dispose();this.points.delete(id);}
  }

  // Read-only diagnostics for the existing Test Lab. Never generates a new
  // terrain mesh or changes capture ownership / gameplay coordinates.
  diagnostics(worldPoint=null){
    const state=this.latestState,tiles=state?.map?.tiles||[];
    const byKey=new Map(tiles.map(tile=>[tileKey(tile.x,tile.y),tile]));
    const terrain=this.terrainData();
    const points=(state?.presentation?.deploymentPoints||[])
      .filter(point=>point.capturable!==false&&point.captureTiles?.[0]);
    const inventory=points.map(point=>{
      const tileRef=point.captureTiles[0],tile=byKey.get(tileKey(tileRef.x,tileRef.y));
      const cx=tileRef.x*TILE_SIZE,cz=tileRef.y*TILE_SIZE;
      const mesh=this.points.get(point.id),data=mesh?.getVerticesData?.(BABYLON.VertexBuffer.PositionKind)||[];
      const normals=mesh?.getVerticesData?.(BABYLON.VertexBuffer.NormalKind)||[];
      const groundY=this.pointHeight(terrain,cx,cz),waterY=this.waterY(tile);
      const fallback=mesh?.metadata?.publishedTerrainGeometry!==true;
      const vertexYs=[];
      for(let i=1;i<data.length;i+=3)vertexYs.push(Number(data[i])+(mesh?.position?.y||0));
      const upNormals=[];
      for(let i=1;i<normals.length;i+=3)upNormals.push(Number(normals[i]));
      const mat=mesh?.material,colour=mat?.emissiveColor;
      return{
        id:point.id,name:point.name||null,owner:ownerKey(point.owner),tile:{x:tileRef.x,y:tileRef.y},
        expectedWorld:{x:cx,z:cz},renderedWorld:mesh?{x:mesh.position.x,y:mesh.position.y,z:mesh.position.z}:null,
        meshExists:!!mesh&&!mesh.isDisposed?.(),meshName:mesh?.name||null,
        meshVisible:!!mesh&&mesh.isVisible!==false&&Number(mesh.visibility??1)>0,
        meshEnabled:mesh?.isEnabled?.()??null,terrainConforming:!!mesh?.metadata?.terrainConforming,
        geometryShape:mesh?.metadata?.shape||null,
        placement:"LEVEL_TOP_WITH_TERRAIN_SUPPORTED_UNDERSIDE",
        terrainSupportedUnderside:!!mesh?.metadata?.terrainSupportedUnderside,
        groundSupportWorldY:mesh?.metadata?.supportWorldY??null,
        topWorldY:mesh?.metadata?.topWorldY??null,
        minimumWallHeight:mesh?.metadata?.minimumWallHeight??null,
        maximumWallHeight:mesh?.metadata?.maximumWallHeight??null,
        centreBottomClearance:mesh?.metadata?.centreBottomWorldY!=null&&groundY!=null
          ?mesh.metadata.centreBottomWorldY-groundY:null,
        fallback:!!mesh&&fallback,triangleCount:(mesh?.getTotalIndices?.()||0)/3,
        vertexCount:data.length/3,groundWorldY:groundY,
        waterWorldY:Number.isFinite(waterY)?waterY:null,
        vertexYMin:vertexYs.length?Math.min(...vertexYs):null,
        vertexYMax:vertexYs.length?Math.max(...vertexYs):null,
        surfaceClearance:vertexYs.length&&groundY!=null?Math.min(...vertexYs)-groundY:null,
        minimumBottomClearance:mesh?.metadata?.minimumGroundClearance??null,
        upwardNormals:upNormals.length?upNormals.filter(y=>y>.05).length/upNormals.length:null,
        material:mat?{name:mat.name,disableLighting:!!mat.disableLighting,
          backFaceCulling:mat.backFaceCulling,
          emissiveColor:colour?{r:colour.r,g:colour.g,b:colour.b}:null,
          diffuseColor:mat.diffuseColor?{r:mat.diffuseColor.r,g:mat.diffuseColor.g,b:mat.diffuseColor.b}:null,
          alpha:mat.alpha??null}:null
      };
    });
    const w=worldPoint?.x,z=worldPoint?.z;
    const nearest=Number.isFinite(w)&&Number.isFinite(z)?
      inventory.map(point=>({...point,distanceXZ:Math.hypot(point.expectedWorld.x-w,point.expectedWorld.z-z)}))
        .sort((a,b)=>a.distanceXZ-b.distanceXZ)[0]||null:null;
    return{
      expectedCaptureCount:points.length,actualMeshCount:this.points.size,coreCount:this.cores.size,
      publishedTerrainMesh:terrain?.mesh?.name||null,
      publishedTerrainTriangleCount:terrain?.indices?.length/3??null,
      nearestCapture:nearest&&nearest.distanceXZ<=TILE_SIZE*.9?nearest:null,
      captures:inventory,
      cores:(state?.cores||[]).map(core=>{
        const mesh=this.cores.get(core.id),tile=byKey.get(tileKey(core.x,core.y));
        return{id:core.id,owner:ownerKey(core.owner),tile:{x:core.x,y:core.y},
          meshExists:!!mesh&&!mesh.isDisposed?.(),meshWorldY:mesh?.position?.y??null,
          material:mesh?.material?{name:mesh.material.name,disableLighting:!!mesh.material.disableLighting,
            specularPower:mesh.material.specularPower??null}:null,
          groundWorldY:this.pointHeight(terrain,core.x*TILE_SIZE,core.y*TILE_SIZE),
          groundFootprintHighestY:this.terrainFootprintHighest(terrain,core.x*TILE_SIZE,core.y*TILE_SIZE,CORE_WIDTH/2,CORE_WIDTH/2),
          terrainGeometryRevision:this.publishedTerrainRevision(),
          bottomWorldY:mesh?mesh.position.y-CORE_HEIGHT/2:null,
          waterWorldY:Number.isFinite(this.waterY(tile))?this.waterY(tile):null};
      })
    };
  }
}

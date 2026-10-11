import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
const ownerKey=owner=>owner==="PLAYER"?"PLAYER":owner==="ENEMY"?"ENEMY":"NEUTRAL";
const tileKey=(x,y)=>`${x},${y}`;
const surfaceZ=tile=>tile?.waterSurfaceZ==null?Number(tile?.elevation||0):Math.max(Number(tile?.elevation||0),Number(tile.waterSurfaceZ));
const MARKER_RADIUS=.675;
const MARKER_CLEARANCE=.026;
const MARKER_SEGMENTS=32;

export class ObjectiveRenderer{
  constructor(scene){
    this.scene=scene;this.cores=new Map();this.points=new Map();this.signatureValue=null;
    this.latestState=null;this.terrainMesh=null;this.terrainDataCache=null;
    this.materials={
      PLAYER:this.mat("objective-player",new BABYLON.Color3(.20,.55,.95)),
      ENEMY:this.mat("objective-enemy",new BABYLON.Color3(.90,.24,.24)),
      NEUTRAL:this.mat("objective-neutral",new BABYLON.Color3(.86,.70,.18))
    };
    // BabylonRenderer currently syncs objectives before terrain. Read the
    // authoritative terrain-surface mesh after terrain has published it, in the
    // same scene frame. This is still this ObjectiveRenderer's single sync path.
    scene.onBeforeRenderObservable.add(()=>{
      if(!this.latestState)return;
      const mesh=this.publishedTerrainMesh();
      if(mesh===this.terrainMesh)return;
      this.terrainMesh=mesh;
      this.terrainDataCache=null;
      this.signatureValue=null;
      this.refresh(this.latestState);
    });
  }
  mat(name,color){
    const m=new BABYLON.StandardMaterial(name,this.scene);
    // Capture-point markers are tactical UI indicators, not shaded terrain.
    // Keep the ownership colour readable under forests, heavy rain and fog.
    m.diffuseColor=color.scale(.4);
    m.emissiveColor=color.scale(.75);
    m.specularColor=new BABYLON.Color3(0,0,0);
    m.disableLighting=true;
    m.backFaceCulling=false;
    return m;
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
  terrainData(){
    const mesh=this.publishedTerrainMesh();
    if(!mesh)return null;
    if(this.terrainDataCache?.mesh===mesh)return this.terrainDataCache;
    const positions=mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind),indices=mesh.getIndices();
    this.terrainDataCache=positions?.length&&indices?.length?{mesh,positions,indices}:null;
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
  // Project a circular capture marker onto the existing published terrain
  // triangles. Clipping each triangle prevents a flat disc from being buried by
  // any micro-slope and avoids inventing another interpolated height field.
  markerGeometry(data,cx,cz,waterY){
    if(!data)return null;
    const ring=Array.from({length:MARKER_SEGMENTS},(_,i)=>{
      const angle=i*Math.PI*2/MARKER_SEGMENTS;
      return{x:cx+Math.cos(angle)*MARKER_RADIUS,z:cz+Math.sin(angle)*MARKER_RADIUS};
    });
    const positions=[],indices=[];
    const clip=(polygon,a,b)=>{
      const side=p=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
      const clipped=[];
      for(let i=0;i<polygon.length;i++){
        const p=polygon[i],q=polygon[(i+1)%polygon.length],d=side(p),e=side(q),inside=d>=-1e-8,nextInside=e>=-1e-8;
        if(inside)clipped.push(p);
        if(inside!==nextInside){
          const t=d/(d-e);
          clipped.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t,z:p.z+(q.z-p.z)*t});
        }
      }
      return clipped;
    };
    for(let i=0;i<data.indices.length;i+=3){
      if(!this.triangleMayTouch(data,i,cx-MARKER_RADIUS,cx+MARKER_RADIUS,
        cz-MARKER_RADIUS,cz+MARKER_RADIUS))continue;
      let polygon=this.terrainTriangle(data,i);
      for(let side=0;side<ring.length&&polygon.length>=3;side++)polygon=clip(polygon,ring[side],ring[(side+1)%ring.length]);
      if(polygon.length<3)continue;
      const base=positions.length/3;
      for(const point of polygon)positions.push(point.x-cx,Math.max(point.y,waterY)+MARKER_CLEARANCE,point.z-cz);
      for(let j=1;j<polygon.length-1;j++){
        const a=polygon[0],b=polygon[j],c=polygon[j+1];
        const area=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
        if(Math.abs(area)<1e-10)continue;
        // Babylon's vertical normal is positive for clockwise XZ triangles.
        if(area>0)indices.push(base,base+j+1,base+j);
        else indices.push(base,base+j,base+j+1);
      }
    }
    return indices.length?{positions,indices}:null;
  }
  captureMesh(id,tile,data){
    const cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE;
    const geometry=this.markerGeometry(data,cx,cz,this.waterY(tile));
    if(!geometry){
      // Initial frame before TerrainRenderer has published its first mesh.
      const mesh=BABYLON.MeshBuilder.CreateCylinder(`capture-${id}`,{diameter:1.35,height:.09,tessellation:32},this.scene);
      mesh.position.set(cx,this.surfaceY(tile)+.07,cz);mesh.isPickable=false;
      mesh.metadata={kind:"capture-point",terrainConforming:false,geometryFallback:"TERRAIN_NOT_PUBLISHED"};
      return mesh;
    }
    const mesh=new BABYLON.Mesh(`capture-${id}`,this.scene),normals=[];
    BABYLON.VertexData.ComputeNormals(geometry.positions,geometry.indices,normals);
    const vertexData=new BABYLON.VertexData();
    vertexData.positions=geometry.positions;vertexData.indices=geometry.indices;vertexData.normals=normals;
    vertexData.applyToMesh(mesh,false);
    mesh.position.set(cx,0,cz);mesh.isPickable=false;mesh.receiveShadows=false;
    mesh.metadata={kind:"capture-point",terrainConforming:true,publishedTerrainGeometry:true};
    return mesh;
  }
  signature(state,byKey){
    const cores=(state?.cores||[]).map(core=>[
      "C",core.id,ownerKey(core.owner),core.hp>0?1:0,core.x,core.y,
      surfaceZ(byKey.get(tileKey(core.x,core.y))).toFixed(3)
    ].join(":"));
    const points=(state?.presentation?.deploymentPoints||[]).filter(point=>point.capturable!==false&&point.captureTiles?.[0]).map(point=>{
      const tile=point.captureTiles[0];
      return["P",point.id,ownerKey(point.owner),tile.x,tile.y,surfaceZ(byKey.get(tileKey(tile.x,tile.y))).toFixed(3)].join(":");
    });
    return [...cores,...points].sort().join(";");
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

    const coreAlive=new Set();
    for(const core of state?.cores||[]){
      coreAlive.add(core.id);let mesh=this.cores.get(core.id);
      if(!mesh){mesh=BABYLON.MeshBuilder.CreateBox(`core-${core.id}`,{width:1.22,depth:1.22,height:1.65},this.scene);mesh.isPickable=false;this.cores.set(core.id,mesh);}
      const tile=byKey.get(tileKey(core.x,core.y)),cx=core.x*TILE_SIZE,cz=core.y*TILE_SIZE;
      const publishedY=this.pointHeight(terrain,cx,cz);
      mesh.material=this.materials[ownerKey(core.owner)];
      const supportY=Math.max(publishedY??Number(tile?.elevation||0)*ELEVATION_HEIGHT,this.waterY(tile));
      mesh.position.set(cx,supportY+.825,cz);
      mesh.visibility=core.hp>0?1:.2;
    }
    for(const[id,mesh]of this.cores)if(!coreAlive.has(id)){mesh.dispose();this.cores.delete(id);}

    const pointAlive=new Set();
    for(const point of state?.presentation?.deploymentPoints||[]){
      if(point.capturable===false)continue;
      const capture=point.captureTiles?.[0];if(!capture)continue;
      const tile=byKey.get(tileKey(capture.x,capture.y));if(!tile)continue;
      pointAlive.add(point.id);
      // Ownership changes update the shared material. Terrain / water-level
      // changes rebuild the one conforming marker through this same path.
      let mesh=this.points.get(point.id);
      if(mesh)mesh.dispose();
      mesh=this.captureMesh(point.id,tile,terrain);this.points.set(point.id,mesh);
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
      const fallback=!mesh?.metadata?.terrainConforming;
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
        fallback:!!mesh&&fallback,triangleCount:(mesh?.getTotalIndices?.()||0)/3,
        vertexCount:data.length/3,groundWorldY:groundY,
        waterWorldY:Number.isFinite(waterY)?waterY:null,
        vertexYMin:vertexYs.length?Math.min(...vertexYs):null,
        vertexYMax:vertexYs.length?Math.max(...vertexYs):null,
        surfaceClearance:vertexYs.length&&groundY!=null?Math.min(...vertexYs)-groundY:null,
        upwardNormals:upNormals.length?upNormals.filter(y=>y>.05).length/upNormals.length:null,
        material:mat?{name:mat.name,disableLighting:!!mat.disableLighting,
          backFaceCulling:mat.backFaceCulling,
          emissiveColor:colour?{r:colour.r,g:colour.g,b:colour.b}:null,
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
          groundWorldY:this.pointHeight(terrain,core.x*TILE_SIZE,core.y*TILE_SIZE),
          waterWorldY:Number.isFinite(this.waterY(tile))?this.waterY(tile):null};
      })
    };
  }
}

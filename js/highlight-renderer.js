import { TILE_SIZE,ELEVATION_HEIGHT,SURFACE_RENDER_ORDER } from "./coordinate-system.js";
const keyOf=tile=>`${tile.x},${tile.y}`;
const highlightKind=tile=>tile.inspected?"inspected":tile.attackable?"attackable":tile.deployable?"deployable":tile.targetRange?"targetRange":tile.reachable?"reachable":null;

export class HighlightRenderer{
  constructor(scene,{terrain,environment}={}){
    this.scene=scene;this.terrain=terrain;this.environment=environment;
    this.dynamic=new Map();this.areas=new Map();this.signatureValue=null;
    this.materials={
      reachable:this.mat("reachable",new BABYLON.Color3(.18,.55,1),.35),
      targetRange:this.mat("target-range",new BABYLON.Color3(1,.28,.22),.18),
      attackable:this.mat("attackable",new BABYLON.Color3(1,.25,.22),.48),
      deployable:this.mat("deployable",new BABYLON.Color3(.25,.92,.48),.38),
      inspected:this.mat("inspected",new BABYLON.Color3(1,.78,.25),.42),
      PLAYER:this.mat("deploy-area-player",new BABYLON.Color3(.20,.48,.96),.18),
      ENEMY:this.mat("deploy-area-enemy",new BABYLON.Color3(.92,.24,.28),.18),
      NEUTRAL:this.mat("deploy-area-neutral",new BABYLON.Color3(.78,.62,.22),.16)
    };
  }

  mat(name,color,alpha){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;material.emissiveColor=color;material.alpha=alpha;
    material.disableLighting=true;material.disableDepthWrite=true;
    material.backFaceCulling=false;
    return material;
  }

  // Overlay geometry follows the ACTUAL published terrain triangles; height
  // at each vertex also reads the water level and any published snow/ice cover.
  // Neither renderer guesses visual slopes, ice height or nearest tile vertices.
  indicatorGeometry(tile,clearance,layers){
    const resolver=this.terrain?.surfaceResolver;
    const triangles=resolver?.getRenderedSurfaceGeometry(tile)?.triangles;
    if(!triangles?.length)return null;
    const waterSurface=resolver.waterSurfaceOf(tile);
    const waterY=waterSurface==null?-Infinity:Number(waterSurface)*ELEVATION_HEIGHT;
    const positions=[],indices=[];
    for(const triangle of triangles){
      const base=positions.length/3;
      for(const point of triangle){
        const snowIceY=this.environment?.publishedCoverYAt(tile,point.x,point.z,layers)??-Infinity;
        positions.push(point.x,Math.max(point.y,waterY,snowIceY)+clearance,point.z);
      }
      indices.push(base,base+1,base+2);
    }
    return{positions,indices};
  }

  syncMesh(previous,name,tile,material,clearance,layers){
    const data=this.indicatorGeometry(tile,clearance,layers);
    if(!data){previous?.dispose();return null;}
    let mesh=previous;
    if(!mesh||mesh.getTotalVertices()!==data.positions.length/3){
      mesh?.dispose();
      mesh=new BABYLON.Mesh(name,this.scene);
      mesh.setVerticesData(BABYLON.VertexBuffer.PositionKind,data.positions,true);
      mesh.setIndices(data.indices);
      mesh.isPickable=false;mesh.receiveShadows=false;
      mesh.alphaIndex=SURFACE_RENDER_ORDER.TACTICAL_OVERLAY;
      mesh.metadata={kind:"tactical-ground-highlight",castShadow:false,publishedTerrainTriangles:true};
    }else mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,data.positions,true,false);
    mesh.material=material;
    return mesh;
  }

  signature(tiles){
    const parts=[];
    for(const tile of tiles){
      const owner=tile.deploymentAreaOwner||"",kind=highlightKind(tile)||"";
      if(!owner&&!kind)continue;
      parts.push([tile.x,tile.y,owner,kind,
        Number(tile.waterDepth||0).toFixed(4),
        tile.waterSurfaceZ==null?"n":Number(tile.waterSurfaceZ).toFixed(4)].join(":"));
    }
    return`${this.terrain?.surfaceResolver?.renderedSurfaceGeometryRevision||0}|${this.environment?.publishedCoverRevision||0}|${parts.sort().join(";")}`;
  }

  sync(state){
    const tiles=state?.map?.tiles||[],signature=this.signature(tiles);
    if(signature===this.signatureValue)return;
    // BabylonRenderer has already published terrain, water, snow and ice.
    const layers=this.environment?.publishedCoverGeometry()||[];
    const activeAreas=new Set(),activeDynamic=new Set();
    for(const tile of tiles){
      const key=keyOf(tile),owner=tile.deploymentAreaOwner,kind=highlightKind(tile);
      if(owner){
        activeAreas.add(key);
        const mesh=this.syncMesh(this.areas.get(key),`deploy-area-${key}`,tile,
          this.materials[owner]||this.materials.NEUTRAL,.045,layers);
        if(mesh)this.areas.set(key,mesh);else this.areas.delete(key);
      }
      if(kind){
        activeDynamic.add(key);
        const mesh=this.syncMesh(this.dynamic.get(key),`hl-${key}`,tile,
          this.materials[kind],.070,layers);
        if(mesh)this.dynamic.set(key,mesh);else this.dynamic.delete(key);
      }
    }
    for(const [key,mesh] of this.areas)if(!activeAreas.has(key)){mesh.dispose();this.areas.delete(key);}
    for(const [key,mesh] of this.dynamic)if(!activeDynamic.has(key)){mesh.dispose();this.dynamic.delete(key);}
    this.signatureValue=signature;
  }

  diagnostics(){
    const meshes=[...this.areas.values(),...this.dynamic.values()];
    return{deploymentAreaMeshes:this.areas.size,dynamicHighlights:this.dynamic.size,
      publishedTerrainRevision:this.terrain?.surfaceResolver?.renderedSurfaceGeometryRevision??null,
      publishedCoverRevision:this.environment?.publishedCoverRevision??null,
      terrainGeometryAligned:meshes.every(mesh=>mesh.metadata?.publishedTerrainTriangles===true),
      visibleOverlayMeshes:meshes.filter(mesh=>mesh.isEnabled?.()!==false&&mesh.isVisible!==false).length,
      total:meshes.length};
  }
}

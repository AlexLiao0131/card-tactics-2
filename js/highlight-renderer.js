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

  // Use the published snow/ice triangle topology where cover exists. A high
  // snow ridge between terrain vertices otherwise cuts through a terrain-
  // triangulated marker even when every marker vertex was elevated correctly.
  // Ground/water geometry remains unchanged; no extra render pass or mesh.
  indicatorGeometry(tile,clearance,layers){
    const resolver=this.terrain?.surfaceResolver;
    const triangles=resolver?.getRenderedSurfaceGeometry(tile)?.triangles;
    if(!triangles?.length)return null;
    const waterSurface=resolver.waterSurfaceOf(tile);
    const waterY=waterSurface==null?-Infinity:Number(waterSurface)*ELEVATION_HEIGHT;
    const key=keyOf(tile),cover=(layers||[]).filter(layer=>{
      const offset=layer.tileOffsets.get(key);
      if(offset===undefined)return false;
      for(let v=offset*16;v<(offset+1)*16;v++)
        if(Number(layer.colors[v*4+3]||0)>0.001)return true;
      return false;
    });
    const positions=[],indices=[];
    if(cover.length){
      // All published cover grids use the same 16 vertices / 18 triangles per
      // tile. Prefer snow; fall back to ice when only ice is visible.
      const reference=cover.find(layer=>layer.type==="SNOW")||cover[0];
      const offset=reference.tileOffsets.get(key),start=offset*54;
      for(let i=start;i<start+54;i+=3){
        const base=positions.length/3;
        for(let j=0;j<3;j++){
          const sourceIndex=reference.indices[i+j];
          const x=reference.positions[sourceIndex*3],z=reference.positions[sourceIndex*3+2];
          const ground=resolver.publishedSurfacePoint(tile,x,z)?.y??-Infinity;
          // The renderer's canonical published vertex buffers provide cover
          // heights. At every 4x4 grid vertex, all cover layers coincide in XZ.
          let coverY=-Infinity;
          const vertex=sourceIndex-offset*16;
          for(const layer of cover){
            const ownIndex=layer.tileOffsets.get(key)*16+vertex;
            coverY=Math.max(coverY,Number(layer.positions[ownIndex*3+1]));
          }
          positions.push(x,Math.max(ground,waterY,coverY)+clearance,z);
        }
        indices.push(base,base+1,base+2);
      }
      return{positions,indices};
    }
    for(const triangle of triangles){
      const base=positions.length/3;
      for(const point of triangle)positions.push(point.x,Math.max(point.y,waterY)+clearance,point.z);
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

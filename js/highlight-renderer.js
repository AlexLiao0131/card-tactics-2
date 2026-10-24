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
    material.diffuseColor=color;material.emissiveColor=color;
    // Preserve the existing clear-ground opacity as the UI authority. The
    // published SNOW alpha determines any visibility compensation per vertex.
    material.baseOverlayOpacity=alpha;material.alpha=1;
    if(BABYLON.Material?.MATERIAL_ALPHABLEND!=null)
      material.transparencyMode=BABYLON.Material.MATERIAL_ALPHABLEND;
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
    const key=keyOf(tile),waterSurface=resolver.waterSurfaceOf(tile);
    const waterY=waterSurface==null?-Infinity:Number(waterSurface)*ELEVATION_HEIGHT;
    const cover=(layers||[]).filter(layer=>layer.tileRanges?.has(key));
    const exposed=cover.filter(layer=>{
      const range=layer.tileRanges.get(key);
      for(let i=range.startVertex;i<range.startVertex+range.vertexCount;i++)
        if(Number(layer.colors[i*4+3]||0)>0)return true;
      return false;
    });
    const snow=exposed.find(layer=>layer.type==="SNOW")||null;
    const reference=snow||exposed[0];
    const positions=[],indices=[],snowCoverage=[];
    if(reference){
      // These are the EXISTING published triangles, either snow's 4x4
      // terrain-cover topology or WaterRenderer's wet D/Q polygon footprint.
      const range=reference.tileRanges.get(key);
      for(let i=range.startIndex;i<range.startIndex+range.indexCount;i+=3){
        const base=positions.length/3;
        for(let j=0;j<3;j++){
          const sourceIndex=reference.indices[i+j];
          const x=reference.positions[sourceIndex*3],z=reference.positions[sourceIndex*3+2];
          const ground=resolver.publishedSurfacePoint(tile,x,z)?.y??-Infinity;
          const coverY=this.environment?.publishedCoverYAt(tile,x,z,layers)??-Infinity;
          positions.push(x,Math.max(ground,coverY,reference.positions[sourceIndex*3+1])+clearance,z);
          // Snow and ICE have different triangulations. When snow is the
          // reference, its actual per-vertex alpha supplies snow visibility.
          const snowAlpha=snow===reference
            ?Number(snow.colors[sourceIndex*4+3]||0)*Number(snow.opacity??1):0;
          snowCoverage.push(Math.max(0,Math.min(1,snowAlpha)));
        }
        indices.push(base,base+1,base+2);
      }
      return{positions,indices,snowCoverage};
    }
    for(const triangle of triangles){
      const base=positions.length/3;
      for(const point of triangle){
        positions.push(point.x,Math.max(point.y,waterY)+clearance,point.z);
        snowCoverage.push(0);
      }
      indices.push(base,base+1,base+2);
    }
    return{positions,indices,snowCoverage};
  }

  syncMesh(previous,name,parts,material,overlayOrder){
    const positions=[],indices=[],colors=[];
    const baseOpacity=Number(material.baseOverlayOpacity??material.alpha??1);
    for(const part of parts){
      const base=positions.length/3;
      positions.push(...part.positions);
      for(const index of part.indices)indices.push(base+index);
      for(let v=0;v<part.positions.length/3;v++){
        const snow=Math.max(0,Math.min(1,Number(part.snowCoverage?.[v]||0)));
        // Inverse alpha compositing, derived from the actual published snow
        // alpha and the ORIGINAL material alpha; no invented snow threshold.
        const alpha=baseOpacity/((1-snow)+baseOpacity*snow);
        colors.push(1,1,1,alpha);
      }
    }
    if(!indices.length){previous?.dispose();return null;}
    let mesh=previous;
    if(!mesh||mesh.getTotalVertices()!==positions.length/3||mesh.getTotalIndices()!==indices.length){
      mesh?.dispose();mesh=new BABYLON.Mesh(name,this.scene);
      mesh.setVerticesData(BABYLON.VertexBuffer.PositionKind,positions,true);
      mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind,colors,true);
      mesh.setIndices(indices);
      mesh.isPickable=false;mesh.receiveShadows=false;
      mesh.useVertexColors=true;mesh.hasVertexAlpha=true;
      mesh.metadata={kind:"tactical-ground-highlight",castShadow:false,
        publishedTerrainTriangles:true,batchedTiles:parts.length};
    }else{
      mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,positions,true,false);
      mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind,colors,true,false);
      const oldIndices=mesh.getIndices();
      if(!oldIndices||oldIndices.some((index,i)=>index!==indices[i]))mesh.setIndices(indices);
      mesh.metadata.batchedTiles=parts.length;
    }
    mesh.alphaIndex=overlayOrder;mesh.material=material;mesh.refreshBoundingInfo();
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
    const layers=this.environment?.publishedCoverGeometry()||[];
    const areas=new Map(),dynamic=new Map();
    for(const tile of tiles){
      const owner=tile.deploymentAreaOwner,kind=highlightKind(tile);
      if(owner){
        const part=this.indicatorGeometry(tile,.045,layers);
        if(part){const group=areas.get(owner)||[];group.push(part);areas.set(owner,group);}
      }
      if(kind){
        const part=this.indicatorGeometry(tile,.070,layers);
        if(part){const group=dynamic.get(kind)||[];group.push(part);dynamic.set(kind,group);}
      }
    }
    for(const [owner,parts] of areas){
      const mesh=this.syncMesh(this.areas.get(owner),`deploy-area-${owner}`,parts,
        this.materials[owner]||this.materials.NEUTRAL,SURFACE_RENDER_ORDER.TACTICAL_OVERLAY);
      if(mesh)this.areas.set(owner,mesh);
    }
    for(const [kind,parts] of dynamic){
      const mesh=this.syncMesh(this.dynamic.get(kind),`hl-${kind}`,parts,
        this.materials[kind],SURFACE_RENDER_ORDER.TACTICAL_OVERLAY+1);
      if(mesh)this.dynamic.set(kind,mesh);
    }
    for(const [owner,mesh] of this.areas)if(!areas.has(owner)){mesh.dispose();this.areas.delete(owner);}
    for(const [kind,mesh] of this.dynamic)if(!dynamic.has(kind)){mesh.dispose();this.dynamic.delete(kind);}
    this.areaTileCount=[...areas.values()].reduce((sum,parts)=>sum+parts.length,0);
    this.dynamicTileCount=[...dynamic.values()].reduce((sum,parts)=>sum+parts.length,0);
    this.signatureValue=signature;
  }

  diagnostics(){
    const meshes=[...this.areas.values(),...this.dynamic.values()];
    return{deploymentAreaMeshes:this.areas.size,dynamicHighlights:this.dynamic.size,
      deploymentAreaTiles:this.areaTileCount||0,dynamicHighlightTiles:this.dynamicTileCount||0,
      batchedByMaterial:true,
      publishedTerrainRevision:this.terrain?.surfaceResolver?.renderedSurfaceGeometryRevision??null,
      publishedCoverRevision:this.environment?.publishedCoverRevision??null,
      terrainGeometryAligned:meshes.every(mesh=>mesh.metadata?.publishedTerrainTriangles===true),
      visibleOverlayMeshes:meshes.filter(mesh=>mesh.isEnabled?.()!==false&&mesh.isVisible!==false).length,
      total:meshes.length};
  }
}

import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const tilesOf=state=>state?.map?.tiles||state?.grid?.tiles||[];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
const keyOf=(x,y)=>`${x},${y}`;
const waterDepth=tile=>Math.max(0,Number(tile?.waterDepth||0));
const logicalSurface=tile=>tile?.waterSurfaceZ==null
  ?Number(tile?.elevation||0)+waterDepth(tile)
  :Number(tile.waterSurfaceZ);

const SURFACE_OFFSET=.016;
const EPSILON=.001;
const MIN_WATER_DEPTH=.12;
const WATERFALL_MIN_DROP=.18;
const SHORE_EPSILON=.002;

const DIRS=Object.freeze([
  {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}
]);
const EDGE_DIR_BY_RING=Object.freeze({
  1:{dx:0,dy:-1},3:{dx:1,dy:0},5:{dx:0,dy:1},7:{dx:-1,dy:0}
});
const CORNER_DIR_BY_RING=Object.freeze({
  0:{dx:-1,dy:-1},2:{dx:1,dy:-1},4:{dx:1,dy:1},6:{dx:-1,dy:1}
});

function visualSurface(tile){
  // Rendering consumes the real hydrology surface. No quantized LEVEL_STEP layer.
  return logicalSurface(tile);
}
function hasAnyWater(tile){
  return waterDepth(tile)>EPSILON;
}
function hasVisibleWater(tile){
  return waterDepth(tile)>MIN_WATER_DEPTH;
}
function average(values){
  return values.length?values.reduce((sum,value)=>sum+Number(value||0),0)/values.length:0;
}

export class WaterRenderer{
  constructor(scene,terrainRenderer=null){
    this.scene=scene;
    this.terrainRenderer=terrainRenderer;
    this.surfaceMeshes=new Map();
    this.cascades=new Map();
    this.surfaceSignature="";
    this.cascadeSignature="";

    this.surfaceMaterial=this.makeSurfaceMaterial();

    const cascade=this.makeCascadeMaterial();
    this.cascadeMaterial=cascade.material;
    this.cascadeTexture=cascade.texture;
    this.foamMaterial=this.makeSideMaterial("water-foam",new BABYLON.Color3(.78,.93,1),.52);

    this.beforeRender=this.scene.onBeforeRenderObservable.add(()=>{
      const dt=Math.min(.05,Math.max(0,Number(this.scene.getEngine().getDeltaTime()||16)/1000));
      this.cascadeTexture.vOffset=(this.cascadeTexture.vOffset-dt*.72)%1;
      for(const entry of this.cascades.values()){
        entry.foam.rotation.y+=dt*.7;
        const p=1+Math.sin(performance.now()/300+entry.phase)*.055;
        entry.foam.scaling.set(1.08*p,.38,.45*p);
      }
    });
  }

  makeSurfaceMaterial(){
    if(typeof BABYLON.WaterMaterial==="function"){
      const m=new BABYLON.WaterMaterial("water-surface",this.scene,new BABYLON.Vector2(256,256));
      m.bumpTexture=new BABYLON.Texture("https://assets.babylonjs.com/textures/waterbump.png",this.scene);
      m.bumpTexture.wrapU=BABYLON.Texture.WRAP_ADDRESSMODE;
      m.bumpTexture.wrapV=BABYLON.Texture.WRAP_ADDRESSMODE;
      m.bumpTexture.uScale=.40;
      m.bumpTexture.vScale=.40;
      m.windForce=1.85;
      m.waveHeight=.026;
      m.bumpHeight=.042;
      m.waveLength=1.18;
      m.windDirection=new BABYLON.Vector2(1,.24);
      m.waterColor=new BABYLON.Color3(.045,.27,.46);
      m.colorBlendFactor=.34;
      m.alpha=.78;
      m.backFaceCulling=false;
      return m;
    }
    const m=new BABYLON.StandardMaterial("water-surface-fallback",this.scene);
    m.diffuseColor=new BABYLON.Color3(.065,.33,.55);
    m.alpha=.68;
    m.specularColor=new BABYLON.Color3(.46,.67,.82);
    m.specularPower=64;
    m.backFaceCulling=false;
    return m;
  }

  makeSideMaterial(name,color,alpha){
    const m=new BABYLON.StandardMaterial(name,this.scene);
    m.diffuseColor=color;
    m.emissiveColor=color.scale(.08);
    m.alpha=alpha;
    m.specularColor=new BABYLON.Color3(.10,.16,.22);
    m.specularPower=18;
    m.backFaceCulling=false;
    m.needDepthPrePass=true;
    return m;
  }

  makeCascadeMaterial(){
    const texture=new BABYLON.DynamicTexture("cascade-flow-texture",{width:96,height:256},this.scene,false);
    texture.hasAlpha=true;
    const ctx=texture.getContext();
    ctx.clearRect(0,0,96,256);
    const gradient=ctx.createLinearGradient(0,0,96,0);
    gradient.addColorStop(0,"rgba(170,225,255,0.18)");
    gradient.addColorStop(.5,"rgba(225,248,255,0.62)");
    gradient.addColorStop(1,"rgba(150,215,250,0.16)");
    ctx.fillStyle=gradient;
    ctx.fillRect(0,0,96,256);
    ctx.strokeStyle="rgba(255,255,255,0.55)";
    ctx.lineWidth=3;
    for(let y=8;y<256;y+=34){
      ctx.beginPath();
      ctx.moveTo(8,y);
      ctx.bezierCurveTo(30,y+8,62,y-8,88,y+2);
      ctx.stroke();
    }
    texture.update();
    texture.wrapV=BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapU=BABYLON.Texture.WRAP_ADDRESSMODE;

    const material=new BABYLON.StandardMaterial("cascade-water",this.scene);
    material.diffuseTexture=texture;
    material.opacityTexture=texture;
    material.emissiveTexture=texture;
    material.diffuseColor=new BABYLON.Color3(.42,.76,.94);
    material.emissiveColor=new BABYLON.Color3(.12,.28,.36);
    material.alpha=.70;
    material.specularColor=new BABYLON.Color3(.75,.88,.96);
    material.specularPower=48;
    material.backFaceCulling=false;
    material.needDepthPrePass=true;
    return{material,texture};
  }

  surfaceGroup(tile){return tile?.fogged?"fogged":"visible";}
  turbidity(tile){return clamp(tile?.waterTurbidity||0,0,1);}
  waterTiles(state){return tilesOf(state).filter(hasVisibleWater);}
  byKey(tiles){return new Map(tiles.map(tile=>[keyOf(tile.x,tile.y),tile]));}
  allByKey(state){return new Map(tilesOf(state).map(tile=>[keyOf(tile.x,tile.y),tile]));}

  disposeMap(map){
    for(const value of map.values()){
      if(value?.root)value.root.dispose();
      else value?.dispose?.();
    }
    map.clear();
  }

  flowDirection(tile){
    const fx=Number(tile?.flowX||0),fy=Number(tile?.flowY||0);
    if(Math.abs(fx)<=EPSILON&&Math.abs(fy)<=EPSILON)return null;
    return Math.abs(fx)>=Math.abs(fy)
      ?{dx:Math.sign(fx),dy:0}
      :{dx:0,dy:Math.sign(fy)};
  }

  flowMatches(from,to){
    if(!from||!to)return false;
    const dir=this.flowDirection(from);
    return !!dir&&from.x+dir.dx===to.x&&from.y+dir.dy===to.y;
  }

  isCascadeBoundary(a,b){
    if(!hasAnyWater(a)||!hasAnyWater(b))return false;
    const delta=visualSurface(a)-visualSurface(b);
    if(Math.abs(delta)<WATERFALL_MIN_DROP)return false;
    return delta>0?this.flowMatches(a,b):this.flowMatches(b,a);
  }

  continuousWaterEdge(a,b){
    return !!a&&!!b&&hasVisibleWater(a)&&hasVisibleWater(b)&&!this.isCascadeBoundary(a,b);
  }

  surfaceComponents(waterTiles){
    const map=this.byKey(waterTiles);
    const unseen=new Set(waterTiles.map(tile=>keyOf(tile.x,tile.y)));
    const out=[];

    while(unseen.size){
      const firstKey=unseen.values().next().value;
      unseen.delete(firstKey);
      const first=map.get(firstKey);
      const group=this.surfaceGroup(first);
      const queue=[first],tiles=[];

      while(queue.length){
        const tile=queue.shift();
        tiles.push(tile);
        for(const dir of DIRS){
          const n=map.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));
          if(!n||this.surfaceGroup(n)!==group||!this.continuousWaterEdge(tile,n))continue;
          const k=keyOf(n.x,n.y);
          if(!unseen.has(k))continue;
          unseen.delete(k);
          queue.push(n);
        }
      }

      out.push({id:`${group}:${out.length}`,group,tiles});
    }
    return out;
  }

  terrainRing(tile,allMap){
    if(this.terrainRenderer?.ringSamples){
      return this.terrainRenderer.ringSamples(tile,allMap);
    }
    const h=Number(tile?.elevation||0);
    return[
      {ox:-.5,oz:-.5,height:h},{ox:0,oz:-.5,height:h},
      {ox:.5,oz:-.5,height:h},{ox:.5,oz:0,height:h},
      {ox:.5,oz:.5,height:h},{ox:0,oz:.5,height:h},
      {ox:-.5,oz:.5,height:h},{ox:-.5,oz:0,height:h}
    ];
  }

  cornerMembers(tile,index,allMap){
    const dir=CORNER_DIR_BY_RING[index];
    if(!dir)return[tile];

    const xNeighbor=allMap.get(keyOf(tile.x+dir.dx,tile.y));
    const yNeighbor=allMap.get(keyOf(tile.x,tile.y+dir.dy));
    const diagonal=allMap.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));
    const members=[tile];

    const xConnected=this.continuousWaterEdge(tile,xNeighbor);
    const yConnected=this.continuousWaterEdge(tile,yNeighbor);
    if(xConnected)members.push(xNeighbor);
    if(yConnected)members.push(yNeighbor);
    if(diagonal&&(
      (xConnected&&this.continuousWaterEdge(xNeighbor,diagonal))||
      (yConnected&&this.continuousWaterEdge(yNeighbor,diagonal))
    ))members.push(diagonal);

    return[...new Map(members.map(member=>[keyOf(member.x,member.y),member])).values()];
  }

  ringIsInternal(tile,index,allMap){
    const edgeDir=EDGE_DIR_BY_RING[index];
    if(edgeDir){
      const neighbor=allMap.get(keyOf(tile.x+edgeDir.dx,tile.y+edgeDir.dy));
      return this.continuousWaterEdge(tile,neighbor);
    }
    return this.cornerMembers(tile,index,allMap).length>1;
  }

  ringWaterLevel(tile,index,allMap){
    const edgeDir=EDGE_DIR_BY_RING[index];
    if(edgeDir){
      const neighbor=allMap.get(keyOf(tile.x+edgeDir.dx,tile.y+edgeDir.dy));
      if(this.continuousWaterEdge(tile,neighbor)){
        return average([visualSurface(tile),visualSurface(neighbor)]);
      }
      return visualSurface(tile);
    }
    return average(this.cornerMembers(tile,index,allMap).map(visualSurface));
  }

  shorelinePoint(tile,index,sample,allMap){
    const cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE;
    const fullX=cx+Number(sample.ox||0)*TILE_SIZE;
    const fullZ=cz+Number(sample.oz||0)*TILE_SIZE;
    const centerWater=visualSurface(tile);
    const ringWater=this.ringWaterLevel(tile,index,allMap);

    if(this.ringIsInternal(tile,index,allMap)){
      return{x:fullX,z:fullZ,level:ringWater,clipped:false};
    }

    const centerTerrain=Number(tile.elevation||0);
    const boundaryTerrain=Number(sample.height||0);
    const centerClearance=centerWater-centerTerrain;
    const boundaryClearance=ringWater-boundaryTerrain;
    let t=1;

    if(boundaryClearance<-SHORE_EPSILON){
      const denom=centerClearance-boundaryClearance;
      t=Math.abs(denom)<=EPSILON?0:clamp(centerClearance/denom,0,1);
    }

    return{
      x:cx+(fullX-cx)*t,
      z:cz+(fullZ-cz)*t,
      level:centerWater+(ringWater-centerWater)*t,
      clipped:t<1-EPSILON
    };
  }

  addVertex(out,cache,point){
    const y=Number(point.level)*ELEVATION_HEIGHT+SURFACE_OFFSET;
    const cacheKey=`${point.x.toFixed(5)}:${y.toFixed(5)}:${point.z.toFixed(5)}`;
    const existing=cache.get(cacheKey);
    if(existing!=null)return existing;

    const index=out.positions.length/3;
    out.positions.push(point.x,y,point.z);
    out.uvs.push(point.x/(TILE_SIZE*3.25),point.z/(TILE_SIZE*3.25));
    cache.set(cacheKey,index);
    return index;
  }

  pushTriangle(out,a,b,c){
    if(a===b||b===c||c===a)return;
    const ax=out.positions[a*3],az=out.positions[a*3+2];
    const bx=out.positions[b*3],bz=out.positions[b*3+2];
    const cx=out.positions[c*3],cz=out.positions[c*3+2];
    const abx=bx-ax,abz=bz-az,acx=cx-ax,acz=cz-az;
    const geometricY=abz*acx-abx*acz;
    if(Math.abs(geometricY)<=EPSILON)return;
    if(geometricY>0){const swap=b;b=c;c=swap;}
    out.indices.push(a,b,c);
  }

  buildSurface(component,state){
    const out={positions:[],indices:[],normals:[],uvs:[]};
    const cache=new Map();
    const allMap=this.allByKey(state);
    let clippedPoints=0;

    for(const tile of component.tiles){
      const cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE;
      const centerIndex=this.addVertex(out,cache,{x:cx,z:cz,level:visualSurface(tile)});
      const terrainRing=this.terrainRing(tile,allMap);
      const ringPoints=terrainRing.map((sample,index)=>{
        const point=this.shorelinePoint(tile,index,sample,allMap);
        if(point.clipped)clippedPoints++;
        return point;
      });
      const ringIndices=ringPoints.map(point=>this.addVertex(out,cache,point));

      for(let i=0;i<ringIndices.length;i++){
        this.pushTriangle(out,centerIndex,ringIndices[i],ringIndices[(i+1)%ringIndices.length]);
      }
    }

    if(!out.positions.length||!out.indices.length)return null;
    BABYLON.VertexData.ComputeNormals(out.positions,out.indices,out.normals);

    const mesh=new BABYLON.Mesh(`water-surface-${component.id}`,this.scene);
    const data=new BABYLON.VertexData();
    data.positions=out.positions;data.indices=out.indices;data.normals=out.normals;data.uvs=out.uvs;
    data.applyToMesh(mesh,false);
    mesh.material=this.surfaceMaterial;
    mesh.isPickable=false;
    mesh.visibility=component.group==="fogged"?.22:1;
    mesh.metadata={
      kind:"water-surface",
      tileCount:component.tiles.length,
      sharedWetEdges:true,
      hydrologySurface:true,
      quantizedLevels:false,
      clippedShorePoints:clippedPoints,
      vertexCount:out.positions.length/3,
      triangleCount:out.indices.length/3
    };
    mesh.freezeWorldMatrix();
    return mesh;
  }

  cascadeEdges(state,waterTiles){
    const allMap=this.allByKey(state),out=[];
    for(const tile of waterTiles){
      const dir=this.flowDirection(tile);
      if(!dir?.dx&&!dir?.dy)continue;
      const receiver=allMap.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));
      if(!receiver||!hasAnyWater(receiver))continue;

      const top=visualSurface(tile),bottom=visualSurface(receiver),drop=top-bottom;
      if(drop<WATERFALL_MIN_DROP)continue;
      out.push({
        id:`${tile.x},${tile.y}->${receiver.x},${receiver.y}`,
        tile,receiver,dx:dir.dx,dy:dir.dy,top,bottom,drop,
        speed:Math.max(.6,Number(tile.flowSpeed||0)+drop*.55)
      });
    }
    return out;
  }

  buildCascade(edge){
    const dirX=edge.dx,dirZ=edge.dy;
    const perpX=-dirZ,perpZ=dirX;
    const cx=Number(edge.tile.x)*TILE_SIZE,cz=Number(edge.tile.y)*TILE_SIZE;
    const edgeX=cx+dirX*TILE_SIZE*.5,edgeZ=cz+dirZ*TILE_SIZE*.5;
    const topY=edge.top*ELEVATION_HEIGHT+SURFACE_OFFSET*.9;
    const bottomY=edge.bottom*ELEVATION_HEIGHT+SURFACE_OFFSET*.9;
    const width=TILE_SIZE*.82;
    const half=width*.5;
    const inset=TILE_SIZE*.24;
    const lip=.035;

    const sections=[
      {x:cx+dirX*inset,z:cz+dirZ*inset,y:topY},
      {x:edgeX-dirX*lip,z:edgeZ-dirZ*lip,y:topY},
      {x:edgeX+dirX*lip,z:edgeZ+dirZ*lip,y:bottomY},
      {x:edgeX+dirX*inset,z:edgeZ+dirZ*inset,y:bottomY}
    ];

    const positions=[],indices=[],normals=[],uvs=[];
    let distance=0;
    for(let i=0;i<sections.length;i++){
      if(i){
        const a=sections[i-1],b=sections[i];
        distance+=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
      }
      const s=sections[i];
      for(const side of [-1,1]){
        positions.push(
          s.x+perpX*half*side,
          s.y,
          s.z+perpZ*half*side
        );
        uvs.push(side<0?0:1,distance/(TILE_SIZE*.55));
        normals.push(0,0,0);
      }
      if(i<sections.length-1){
        const b=i*2,n=(i+1)*2;
        indices.push(b,n+1,n,b,b+1,n+1);
      }
    }
    BABYLON.VertexData.ComputeNormals(positions,indices,normals);

    const mesh=new BABYLON.Mesh(`cascade-${edge.id}`,this.scene);
    const data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=uvs;
    data.applyToMesh(mesh,false);
    mesh.material=this.cascadeMaterial;
    mesh.isPickable=false;
    mesh.visibility=edge.tile.fogged?.16:1;
    mesh.metadata={kind:"water-cascade",drop:edge.drop,flowSpeed:edge.speed};

    const foam=BABYLON.MeshBuilder.CreateTorus(
      `cascade-foam-${edge.id}`,
      {diameter:TILE_SIZE*.42,thickness:.045,tessellation:20},
      this.scene
    );
    foam.material=this.foamMaterial;
    foam.isPickable=false;
    foam.position.set(
      edgeX+dirX*TILE_SIZE*.18,
      bottomY+.018,
      edgeZ+dirZ*TILE_SIZE*.18
    );
    foam.visibility=mesh.visibility;

    const root=new BABYLON.TransformNode(`cascade-root-${edge.id}`,this.scene);
    mesh.parent=root;foam.parent=root;
    return{root,mesh,foam,phase:(edge.tile.x*13+edge.tile.y*7)%17};
  }

  surfaceSignatureFor(components,state){
    const terrain=tilesOf(state).map(tile=>[
      keyOf(tile.x,tile.y),
      Number(tile.elevation||0).toFixed(4),
      waterDepth(tile).toFixed(4),
      hasAnyWater(tile)?visualSurface(tile).toFixed(4):"dry",
      Number(tile.flowX||0),Number(tile.flowY||0),
      tile.fogged?1:0
    ].join(":" )).sort().join(",");
    const groups=components.map(component=>
      `${component.id}:${component.tiles.map(tile=>keyOf(tile.x,tile.y)).sort().join(",")}`
    ).sort().join("|");
    return`${groups}#${terrain}`;
  }

  cascadeSignatureFor(edges){
    return edges.map(e=>`${e.id}:${e.top.toFixed(4)}:${e.bottom.toFixed(4)}:${e.speed.toFixed(2)}`).sort().join("|");
  }

  syncSurfaceDynamics(waterTiles){
    if(typeof BABYLON.WaterMaterial!=="function"||
       !(this.surfaceMaterial instanceof BABYLON.WaterMaterial)||
       !waterTiles.length)return;
    const maxFlow=waterTiles.reduce((m,t)=>Math.max(m,Number(t.flowSpeed||0)),0);
    const averageTurbidity=waterTiles.reduce((s,t)=>s+this.turbidity(t),0)/waterTiles.length;
    this.surfaceMaterial.windForce=clamp(1.8+maxFlow*.38,1.8,3.8);
    this.surfaceMaterial.waveHeight=clamp(.024+maxFlow*.006,.024,.055);
    this.surfaceMaterial.bumpHeight=clamp(.040+maxFlow*.005,.040,.075);
    this.surfaceMaterial.waveLength=clamp(1.20-maxFlow*.03,.84,1.20);
    this.surfaceMaterial.colorBlendFactor=clamp(.33+averageTurbidity*.09,.33,.42);
  }

  sync(state){
    const waterTiles=this.waterTiles(state);
    const components=this.surfaceComponents(waterTiles);
    const cascades=this.cascadeEdges(state,waterTiles);
    this.syncSurfaceDynamics(waterTiles);

    const surfaceSignature=this.surfaceSignatureFor(components,state);
    if(surfaceSignature!==this.surfaceSignature){
      this.disposeMap(this.surfaceMeshes);
      for(const component of components){
        const mesh=this.buildSurface(component,state);
        if(mesh)this.surfaceMeshes.set(component.id,mesh);
      }
      this.surfaceSignature=surfaceSignature;
    }

    const cascadeSignature=this.cascadeSignatureFor(cascades);
    if(cascadeSignature!==this.cascadeSignature){
      this.disposeMap(this.cascades);
      for(const edge of cascades)this.cascades.set(edge.id,this.buildCascade(edge));
      this.cascadeSignature=cascadeSignature;
    }

    if(!waterTiles.length){
      this.disposeMap(this.surfaceMeshes);this.disposeMap(this.cascades);
      this.surfaceSignature=this.cascadeSignature="";
    }
  }

  diagnostics(){
    return{
      surfaceMeshes:this.surfaceMeshes.size,
      sideMeshes:0,
      cascades:this.cascades.size,
      separatedWaterLevels:false,
      hydrologyContinuousSurface:true,
      sharedWetEdges:true,
      quantizedLevels:false,
      thinCascadeRibbon:true,
      perTileWaterBoxes:false,
      minVisibleWaterDepth:MIN_WATER_DEPTH,
      shorelineSkirts:false,
      terrainClippedShoreline:true,
      cascadesRequireHydrologyDirection:true,
      cascadesRequireDownstreamWater:true
    };
  }
}

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
const LEVEL_STEP=.10;

const DIRS=Object.freeze([
  {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}
]);

function visualSurface(tile){
  return Math.round(logicalSurface(tile)/LEVEL_STEP)*LEVEL_STEP;
}
function hasVisibleWater(tile){
  return waterDepth(tile)>MIN_WATER_DEPTH;
}

export class WaterRenderer{
  constructor(scene){
    this.scene=scene;
    this.surfaceMeshes=new Map();
    this.skirtMeshes=new Map();
    this.cascades=new Map();
    this.surfaceSignature="";
    this.skirtSignature="";
    this.cascadeSignature="";

    this.surfaceMaterial=this.makeSurfaceMaterial();
    this.clearSide=this.makeSideMaterial("water-side-clear",new BABYLON.Color3(.055,.23,.40),.30);
    this.murkySide=this.makeSideMaterial("water-side-murky",new BABYLON.Color3(.22,.24,.14),.42);
    this.muddySide=this.makeSideMaterial("water-side-muddy",new BABYLON.Color3(.28,.17,.08),.52);

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
  sideMaterial(tile){
    const value=this.turbidity(tile);
    return value>=.6?this.muddySide:value>=.18?this.murkySide:this.clearSide;
  }

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

  levelKey(tile){
    return `${this.surfaceGroup(tile)}:${visualSurface(tile).toFixed(2)}`;
  }

  surfaceComponents(waterTiles){
    const map=this.byKey(waterTiles);
    const unseen=new Set(waterTiles.map(tile=>keyOf(tile.x,tile.y)));
    const out=[];

    while(unseen.size){
      const firstKey=unseen.values().next().value;
      unseen.delete(firstKey);
      const first=map.get(firstKey);
      const group=this.levelKey(first);
      const queue=[first],tiles=[];

      while(queue.length){
        const tile=queue.shift();
        tiles.push(tile);
        for(const dir of DIRS){
          const n=map.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));
          if(!n||this.levelKey(n)!==group)continue;
          const k=keyOf(n.x,n.y);
          if(!unseen.has(k))continue;
          unseen.delete(k);
          queue.push(n);
        }
      }

      out.push({id:`${group}:${out.length}`,group,level:visualSurface(first),tiles});
    }
    return out;
  }

  buildSurface(component){
    const positions=[],indices=[],normals=[],uvs=[];
    const half=TILE_SIZE*.5;
    const y=component.level*ELEVATION_HEIGHT+SURFACE_OFFSET;

    for(const tile of component.tiles){
      const cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE;
      const base=positions.length/3;
      const corners=[
        [cx-half,y,cz-half],[cx+half,y,cz-half],
        [cx+half,y,cz+half],[cx-half,y,cz+half]
      ];
      for(const [x,py,z] of corners){
        positions.push(x,py,z);normals.push(0,1,0);uvs.push(x/(TILE_SIZE*3.25),z/(TILE_SIZE*3.25));
      }
      indices.push(base,base+2,base+1,base,base+3,base+2);
    }

    const mesh=new BABYLON.Mesh(`water-surface-${component.id}`,this.scene);
    const data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=uvs;
    data.applyToMesh(mesh,false);
    mesh.material=this.surfaceMaterial;
    mesh.isPickable=false;
    mesh.visibility=component.tiles.some(tile=>!tile.fogged)?1:.22;
    mesh.metadata={kind:"water-surface",level:component.level,tileCount:component.tiles.length};
    mesh.freezeWorldMatrix();
    return mesh;
  }

  flowDirection(tile,allMap){
    const fx=Number(tile?.flowX||0),fy=Number(tile?.flowY||0);
    if(Math.abs(fx)>.001||Math.abs(fy)>.001){
      return Math.abs(fx)>=Math.abs(fy)?{dx:Math.sign(fx),dy:0}:{dx:0,dy:Math.sign(fy)};
    }
    let best=null,top=visualSurface(tile);
    for(const dir of DIRS){
      const n=allMap.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));
      if(!n)continue;
      const target=hasVisibleWater(n)?visualSurface(n):Number(n.elevation||0);
      const drop=top-target;
      if(drop>WATERFALL_MIN_DROP&&(!best||drop>best.drop))best={...dir,drop};
    }
    return best&&{dx:best.dx,dy:best.dy};
  }

  cascadeEdges(state,waterTiles){
    const allMap=this.allByKey(state),out=[];
    for(const tile of waterTiles){
      const dir=this.flowDirection(tile,allMap);
      if(!dir?.dx&&!dir?.dy)continue;
      const receiver=allMap.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));
      if(!receiver)continue;
      const top=visualSurface(tile);
      const bottom=hasVisibleWater(receiver)?visualSurface(receiver):Number(receiver.elevation||0);
      const drop=top-bottom;
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

  buildSides(waterTiles,cascadeIds){
    const map=this.byKey(waterTiles);
    const groups=new Map();

    for(const tile of waterTiles){
      for(const dir of DIRS){
        const neighbor=map.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));
        if(!neighbor)continue; // Shoreline is cut naturally by the polygon terrain.
        const edgeId=`${tile.x},${tile.y}->${neighbor.x},${neighbor.y}`;
        if(cascadeIds.has(edgeId))continue;

        const top=visualSurface(tile);
        const lower=visualSurface(neighbor);
        if(lower>=top-EPSILON)continue;
        if(top-lower<=EPSILON)continue;

        const material=this.sideMaterial(tile);
        const materialKey=material.name;
        if(!groups.has(materialKey))groups.set(materialKey,{material,quads:[]});

        const cx=tile.x*TILE_SIZE,cz=tile.y*TILE_SIZE,h=TILE_SIZE*.5;
        let p1,p2;
        if(dir.dx===1){p1=[cx+h,cz-h];p2=[cx+h,cz+h];}
        else if(dir.dx===-1){p1=[cx-h,cz+h];p2=[cx-h,cz-h];}
        else if(dir.dy===1){p1=[cx+h,cz+h];p2=[cx-h,cz+h];}
        else{p1=[cx-h,cz-h];p2=[cx+h,cz-h];}
        groups.get(materialKey).quads.push({p1,p2,top,bottom:lower});
      }
    }

    const result=[];
    for(const {material,quads} of groups.values()){
      const positions=[],indices=[],normals=[],uvs=[];
      for(const q of quads){
        const base=positions.length/3;
        const y1=q.bottom*ELEVATION_HEIGHT,y2=q.top*ELEVATION_HEIGHT;
        const pts=[
          [q.p1[0],y1,q.p1[1]],[q.p2[0],y1,q.p2[1]],
          [q.p2[0],y2,q.p2[1]],[q.p1[0],y2,q.p1[1]]
        ];
        for(const [x,y,z] of pts){positions.push(x,y,z);normals.push(0,0,0);uvs.push(x/(TILE_SIZE*3),y/(TILE_SIZE*3));}
        indices.push(base,base+1,base+2,base,base+2,base+3);
      }
      if(!positions.length)continue;
      BABYLON.VertexData.ComputeNormals(positions,indices,normals);
      const mesh=new BABYLON.Mesh(`water-side-${material.name}`,this.scene);
      const data=new BABYLON.VertexData();
      data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=uvs;
      data.applyToMesh(mesh,false);
      mesh.material=material;mesh.isPickable=false;mesh.freezeWorldMatrix();
      result.push(mesh);
    }
    return result;
  }

  surfaceSignatureFor(components){
    return components.map(c=>`${c.id}:${c.level.toFixed(2)}:${c.tiles.map(t=>keyOf(t.x,t.y)).sort().join(",")}`).sort().join("|");
  }
  cascadeSignatureFor(edges){
    return edges.map(e=>`${e.id}:${e.top.toFixed(2)}:${e.bottom.toFixed(2)}:${e.speed.toFixed(2)}`).sort().join("|");
  }
  sideSignatureFor(waterTiles,cascades){
    return[
      ...waterTiles.map(t=>`${t.x},${t.y}:${visualSurface(t).toFixed(2)}:${this.turbidity(t).toFixed(2)}`),
      ...cascades.map(e=>`c:${e.id}`)
    ].sort().join("|");
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

    const surfaceSignature=this.surfaceSignatureFor(components);
    if(surfaceSignature!==this.surfaceSignature){
      this.disposeMap(this.surfaceMeshes);
      for(const component of components)this.surfaceMeshes.set(component.id,this.buildSurface(component));
      this.surfaceSignature=surfaceSignature;
    }

    const cascadeSignature=this.cascadeSignatureFor(cascades);
    if(cascadeSignature!==this.cascadeSignature){
      this.disposeMap(this.cascades);
      for(const edge of cascades)this.cascades.set(edge.id,this.buildCascade(edge));
      this.cascadeSignature=cascadeSignature;
    }

    const sideSignature=this.sideSignatureFor(waterTiles,cascades);
    if(sideSignature!==this.skirtSignature){
      this.disposeMap(this.skirtMeshes);
      const cascadeIds=new Set(cascades.map(e=>e.id));
      this.buildSides(waterTiles,cascadeIds).forEach((mesh,i)=>this.skirtMeshes.set(`${i}`,mesh));
      this.skirtSignature=sideSignature;
    }

    if(!waterTiles.length){
      this.disposeMap(this.surfaceMeshes);this.disposeMap(this.skirtMeshes);this.disposeMap(this.cascades);
      this.surfaceSignature=this.skirtSignature=this.cascadeSignature="";
    }
  }

  diagnostics(){
    return{
      surfaceMeshes:this.surfaceMeshes.size,
      sideMeshes:this.skirtMeshes.size,
      cascades:this.cascades.size,
      separatedWaterLevels:true,
      thinCascadeRibbon:true,
      perTileWaterBoxes:false,
      minVisibleWaterDepth:MIN_WATER_DEPTH,
      shorelineSkirts:false
    };
  }
}

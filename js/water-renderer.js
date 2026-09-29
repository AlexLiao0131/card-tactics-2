import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const tilesOf=state=>state?.map?.tiles||state?.grid?.tiles||[];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
const keyOf=(x,y)=>`${x},${y}`;
const waterDepth=tile=>Math.max(0,Number(tile?.waterDepth||0));
const surfaceOf=tile=>tile?.waterSurfaceZ==null
  ?Number(tile?.elevation||0)+waterDepth(tile)
  :Number(tile.waterSurfaceZ);

const UV_WORLD_SCALE=TILE_SIZE*3.25;
const SURFACE_OFFSET=.014;
const EPSILON=.001;
const WATERFALL_MIN_DROP=.28;

const DIRS=Object.freeze([
  {dx:1,dy:0,edge:"E"},
  {dx:-1,dy:0,edge:"W"},
  {dx:0,dy:1,edge:"S"},
  {dx:0,dy:-1,edge:"N"}
]);

export class WaterRenderer{
  constructor(scene){
    this.scene=scene;
    this.surfaceMeshes=new Map();
    this.skirtMeshes=new Map();
    this.waterfalls=new Map();
    this.surfaceSignature="";
    this.skirtSignature="";
    this.waterfallSignature="";

    this.surfaceMaterial=this.makeSurfaceMaterial();

    this.clearSkirtMaterial=this.makeSkirtMaterial(
      "waterSkirtClear",new BABYLON.Color3(.055,.23,.40),.34
    );
    this.murkySkirtMaterial=this.makeSkirtMaterial(
      "waterSkirtMurky",new BABYLON.Color3(.22,.24,.14),.46
    );
    this.muddySkirtMaterial=this.makeSkirtMaterial(
      "waterSkirtMuddy",new BABYLON.Color3(.28,.17,.08),.56
    );

    this.waterfallMaterial=this.makeWaterfallMaterial(
      "waterfallCurtain",new BABYLON.Color3(.20,.58,.82),.46
    );
    this.waterfallStreakMaterial=this.makeWaterfallMaterial(
      "waterfallStreak",new BABYLON.Color3(.72,.90,1),.58
    );
    this.foamMaterial=this.makeWaterfallMaterial(
      "waterfallFoam",new BABYLON.Color3(.78,.93,1),.50
    );

    this.beforeRender=this.scene.onBeforeRenderObservable.add(()=>{
      const dt=Math.min(.05,Math.max(0,Number(this.scene.getEngine().getDeltaTime()||16)/1000));
      for(const fall of this.waterfalls.values()){
        const height=Math.max(.001,fall.height);
        const half=height/2;
        for(const streak of fall.streaks){
          streak.position.y-=dt*fall.speed;
          if(streak.position.y<-half-streak.metadata.halfHeight){
            streak.position.y=half+streak.metadata.halfHeight;
          }
        }
        fall.foam.rotation.y+=dt*(.35+fall.speed*.08);
        const pulse=1+Math.sin(performance.now()/320+fall.phase)*.06;
        fall.foam.scaling.set(1.18*pulse,.42, .46*pulse);
      }
    });
  }

  makeSurfaceMaterial(){
    if(typeof BABYLON.WaterMaterial==="function"){
      const material=new BABYLON.WaterMaterial(
        "waterSurfaceMaterial",
        this.scene,
        new BABYLON.Vector2(256,256)
      );
      material.bumpTexture=new BABYLON.Texture(
        "https://assets.babylonjs.com/textures/waterbump.png",
        this.scene
      );
      material.bumpTexture.wrapU=BABYLON.Texture.WRAP_ADDRESSMODE;
      material.bumpTexture.wrapV=BABYLON.Texture.WRAP_ADDRESSMODE;
      material.bumpTexture.uScale=.42;
      material.bumpTexture.vScale=.42;
      material.windForce=2.0;
      material.waveHeight=.028;
      material.bumpHeight=.045;
      material.waveLength=1.15;
      material.windDirection=new BABYLON.Vector2(1,.24);
      material.waterColor=new BABYLON.Color3(.045,.27,.46);
      material.colorBlendFactor=.34;
      material.alpha=.78;
      material.backFaceCulling=false;
      return material;
    }

    const material=new BABYLON.StandardMaterial("waterSurfaceFallback",this.scene);
    material.diffuseColor=new BABYLON.Color3(.065,.33,.55);
    material.alpha=.68;
    material.specularColor=new BABYLON.Color3(.46,.67,.82);
    material.specularPower=64;
    material.backFaceCulling=false;
    return material;
  }

  makeSkirtMaterial(name,color,alpha){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;
    material.emissiveColor=color.scale(.08);
    material.alpha=alpha;
    material.specularColor=new BABYLON.Color3(.10,.16,.22);
    material.specularPower=18;
    material.backFaceCulling=false;
    material.needDepthPrePass=true;
    return material;
  }

  makeWaterfallMaterial(name,color,alpha){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;
    material.emissiveColor=color.scale(.20);
    material.alpha=alpha;
    material.specularColor=new BABYLON.Color3(.65,.82,.92);
    material.specularPower=48;
    material.backFaceCulling=false;
    material.needDepthPrePass=true;
    return material;
  }

  surfaceGroup(tile){return tile?.fogged?"fogged":"visible";}

  turbidityGroup(tile){
    const value=clamp(tile?.waterTurbidity||0,0,1);
    return value>=.6?"muddy":value>=.18?"murky":"clear";
  }

  waterTiles(state){
    return tilesOf(state).filter(tile=>waterDepth(tile)>EPSILON);
  }

  waterByKey(waterTiles){
    return new Map(waterTiles.map(tile=>[keyOf(tile.x,tile.y),tile]));
  }

  allByKey(state){
    return new Map(tilesOf(state).map(tile=>[keyOf(tile.x,tile.y),tile]));
  }

  disposeMap(map){
    for(const value of map.values()){
      if(value?.root)value.root.dispose();
      else value?.dispose?.();
    }
    map.clear();
  }

  surfaceTopologySignature(waterTiles){
    return waterTiles
      .map(tile=>`${tile.x},${tile.y}:${surfaceOf(tile).toFixed(4)}:${this.surfaceGroup(tile)}`)
      .sort().join("|");
  }

  flowDirection(tile,allMap){
    const sx=Math.sign(Number(tile?.flowX||0));
    const sy=Math.sign(Number(tile?.flowY||0));
    const explicit=Math.abs(Number(tile?.flowX||0))>=Math.abs(Number(tile?.flowY||0))
      ?{dx:sx,dy:0}
      :{dx:0,dy:sy};

    const top=surfaceOf(tile);

    if(explicit.dx||explicit.dy){
      const receiver=allMap.get(keyOf(Number(tile.x)+explicit.dx,Number(tile.y)+explicit.dy));
      if(receiver){
        const receiverLevel=waterDepth(receiver)>EPSILON
          ?surfaceOf(receiver)
          :Number(receiver.elevation||0);
        if(top-receiverLevel>=WATERFALL_MIN_DROP)return explicit;
      }
    }

    let best=null;
    for(const dir of DIRS){
      const receiver=allMap.get(keyOf(Number(tile.x)+dir.dx,Number(tile.y)+dir.dy));
      if(!receiver)continue;
      const receiverLevel=waterDepth(receiver)>EPSILON
        ?surfaceOf(receiver)
        :Number(receiver.elevation||0);
      const drop=top-receiverLevel;
      if(drop<WATERFALL_MIN_DROP)continue;
      if(!best||drop>best.drop)best={dx:dir.dx,dy:dir.dy,drop};
    }
    return best?{dx:best.dx,dy:best.dy}:null;
  }

  waterfallEdges(state,waterTiles){
    const allMap=this.allByKey(state);
    const out=[];

    for(const tile of waterTiles){
      const dir=this.flowDirection(tile,allMap);
      if(!dir)continue;

      const receiver=allMap.get(keyOf(Number(tile.x)+dir.dx,Number(tile.y)+dir.dy));
      if(!receiver)continue;

      const top=surfaceOf(tile);
      const bottom=waterDepth(receiver)>EPSILON
        ?surfaceOf(receiver)
        :Number(receiver.elevation||0);

      const drop=top-bottom;
      if(drop<WATERFALL_MIN_DROP)continue;

      out.push({
        id:`${tile.x},${tile.y}->${receiver.x},${receiver.y}`,
        tile,receiver,dx:dir.dx,dy:dir.dy,
        top,bottom,drop,
        speed:Math.max(.65,Number(tile.flowSpeed||0)+drop*.65),
        turbidity:Math.max(
          Number(tile.waterTurbidity||0),
          Number(receiver.waterTurbidity||0)
        )
      });
    }

    return out;
  }

  waterfallTopologySignature(edges){
    return edges.map(edge=>
      `${edge.id}:${edge.top.toFixed(4)}:${edge.bottom.toFixed(4)}:${edge.speed.toFixed(3)}:${edge.tile?.fogged?1:0}`
    ).sort().join("|");
  }

  buildSurfaceMesh(group,waterTiles){
    if(!waterTiles.length)return null;

    const positions=[],indices=[],normals=[],uvs=[];
    const half=TILE_SIZE*.5;

    for(const tile of waterTiles){
      const cx=Number(tile.x)*TILE_SIZE;
      const cz=Number(tile.y)*TILE_SIZE;
      const y=surfaceOf(tile)*ELEVATION_HEIGHT+SURFACE_OFFSET;
      const base=positions.length/3;
      const corners=[
        [cx-half,y,cz-half],
        [cx+half,y,cz-half],
        [cx+half,y,cz+half],
        [cx-half,y,cz+half]
      ];

      for(const [x,py,z] of corners){
        positions.push(x,py,z);
        normals.push(0,1,0);
        uvs.push(x/UV_WORLD_SCALE,z/UV_WORLD_SCALE);
      }
      indices.push(base,base+2,base+1,base,base+3,base+2);
    }

    const mesh=new BABYLON.Mesh(`water-surface-${group}`,this.scene);
    const data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=uvs;
    data.applyToMesh(mesh,false);

    mesh.material=this.surfaceMaterial;
    mesh.isPickable=false;
    mesh.visibility=group==="fogged"?.22:1;
    mesh.metadata={kind:"water-surface",group,tileCount:waterTiles.length};
    mesh.freezeWorldMatrix();
    this.surfaceMeshes.set(group,mesh);
    return mesh;
  }

  sideCorners(tile,edge,topY,bottomY){
    const cx=Number(tile.x)*TILE_SIZE;
    const cz=Number(tile.y)*TILE_SIZE;
    const h=TILE_SIZE*.5;
    if(edge==="E")return[
      [cx+h,bottomY,cz-h],[cx+h,bottomY,cz+h],
      [cx+h,topY,cz+h],[cx+h,topY,cz-h]
    ];
    if(edge==="W")return[
      [cx-h,bottomY,cz+h],[cx-h,bottomY,cz-h],
      [cx-h,topY,cz-h],[cx-h,topY,cz+h]
    ];
    if(edge==="S")return[
      [cx+h,bottomY,cz+h],[cx-h,bottomY,cz+h],
      [cx-h,topY,cz+h],[cx+h,topY,cz+h]
    ];
    return[
      [cx-h,bottomY,cz-h],[cx+h,bottomY,cz-h],
      [cx+h,topY,cz-h],[cx-h,topY,cz-h]
    ];
  }

  buildSkirtMesh(group,turbidity,tiles,waterMap,waterfallEdgeIds){
    const positions=[],indices=[],normals=[],uvs=[];

    for(const tile of tiles){
      const top=surfaceOf(tile)*ELEVATION_HEIGHT;
      const bed=Number(tile.elevation||0)*ELEVATION_HEIGHT;

      for(const {dx,dy,edge} of DIRS){
        const neighbor=waterMap.get(keyOf(Number(tile.x)+dx,Number(tile.y)+dy));
        const edgeId=neighbor?`${tile.x},${tile.y}->${neighbor.x},${neighbor.y}`:null;
        if(edgeId&&waterfallEdgeIds.has(edgeId))continue;

        const neighborTop=neighbor?surfaceOf(neighbor)*ELEVATION_HEIGHT:null;
        if(neighbor&&neighborTop>=top-EPSILON)continue;

        const bottom=neighbor?Math.max(bed,neighborTop):bed;
        if(top-bottom<=EPSILON)continue;

        const corners=this.sideCorners(tile,edge,top,bottom);
        const base=positions.length/3;
        for(const [x,y,z] of corners){
          positions.push(x,y,z);
          normals.push(0,0,0);
          uvs.push(x/UV_WORLD_SCALE,y/UV_WORLD_SCALE);
        }
        indices.push(base,base+1,base+2,base,base+2,base+3);
      }
    }

    if(!positions.length)return null;

    BABYLON.VertexData.ComputeNormals(positions,indices,normals);
    const mesh=new BABYLON.Mesh(`water-skirt-${group}-${turbidity}`,this.scene);
    const data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=uvs;
    data.applyToMesh(mesh,false);

    mesh.material=turbidity==="muddy"
      ?this.muddySkirtMaterial
      :turbidity==="murky"
        ?this.murkySkirtMaterial
        :this.clearSkirtMaterial;
    mesh.isPickable=false;
    mesh.visibility=group==="fogged"?.18:1;
    mesh.metadata={kind:"water-skirt",group,turbidity,segmentCount:indices.length/6};
    mesh.freezeWorldMatrix();
    this.skirtMeshes.set(`${group}:${turbidity}`,mesh);
    return mesh;
  }

  createWaterfall(edge){
    const root=new BABYLON.TransformNode(`waterfall-${edge.id}`,this.scene);
    const topY=edge.top*ELEVATION_HEIGHT;
    const bottomY=edge.bottom*ELEVATION_HEIGHT;
    const height=Math.max(.02,topY-bottomY);
    const width=TILE_SIZE*.90;

    root.position.set(
      (Number(edge.tile.x)+edge.dx*.5)*TILE_SIZE,
      (topY+bottomY)/2,
      (Number(edge.tile.y)+edge.dy*.5)*TILE_SIZE
    );
    root.rotation.y=edge.dx!==0?Math.PI/2:0;

    const curtain=BABYLON.MeshBuilder.CreatePlane(
      `waterfall-curtain-${edge.id}`,
      {width,height,sideOrientation:BABYLON.Mesh.DOUBLESIDE},
      this.scene
    );
    curtain.parent=root;
    curtain.material=this.waterfallMaterial;
    curtain.isPickable=false;

    const streaks=[];
    const streakCount=height>1.2?4:3;
    for(let i=0;i<streakCount;i++){
      const streakHeight=Math.max(.16,Math.min(.55,height*.32));
      const streak=BABYLON.MeshBuilder.CreatePlane(
        `waterfall-streak-${edge.id}-${i}`,
        {width:.045+(i%2)*.018,height:streakHeight,sideOrientation:BABYLON.Mesh.DOUBLESIDE},
        this.scene
      );
      streak.parent=root;
      streak.material=this.waterfallStreakMaterial;
      streak.isPickable=false;
      streak.position.x=(-.34+i*(.68/Math.max(1,streakCount-1)))*width;
      streak.position.z=-.004;
      streak.position.y=height/2-(i+1)*(height/(streakCount+1));
      streak.metadata={halfHeight:streakHeight/2};
      streaks.push(streak);
    }

    const foam=BABYLON.MeshBuilder.CreateTorus(
      `waterfall-foam-${edge.id}`,
      {diameter:.58,thickness:.055,tessellation:20},
      this.scene
    );
    foam.parent=root;
    foam.material=this.foamMaterial;
    foam.isPickable=false;
    foam.position.y=-height/2+.025;
    foam.position.z=.06;

    const visibility=edge.tile?.fogged?.12:1;
    curtain.visibility=visibility;
    foam.visibility=visibility;
    streaks.forEach(streak=>streak.visibility=visibility);

    const runtime={
      root,curtain,streaks,foam,height,
      speed:Math.max(.8,edge.speed*ELEVATION_HEIGHT),
      phase:(Number(edge.tile.x)*13+Number(edge.tile.y)*7)%11
    };
    this.waterfalls.set(edge.id,runtime);
    return runtime;
  }

  rebuildSurfaceMeshes(waterTiles){
    this.disposeMap(this.surfaceMeshes);
    const groups=new Map([["visible",[]],["fogged",[]]]);
    for(const tile of waterTiles)groups.get(this.surfaceGroup(tile)).push(tile);
    for(const [group,tiles] of groups)if(tiles.length)this.buildSurfaceMesh(group,tiles);
    this.surfaceSignature=this.surfaceTopologySignature(waterTiles);
  }

  rebuildWaterfalls(edges){
    this.disposeMap(this.waterfalls);
    for(const edge of edges)this.createWaterfall(edge);
    this.waterfallSignature=this.waterfallTopologySignature(edges);
  }

  rebuildSkirtMeshes(waterTiles,waterfallEdges){
    this.disposeMap(this.skirtMeshes);
    const waterMap=this.waterByKey(waterTiles);
    const waterfallEdgeIds=new Set(waterfallEdges.map(edge=>edge.id));
    const groups=new Map();

    for(const tile of waterTiles){
      const id=`${this.surfaceGroup(tile)}:${this.turbidityGroup(tile)}`;
      if(!groups.has(id))groups.set(id,[]);
      groups.get(id).push(tile);
    }

    for(const [id,tiles] of groups){
      const [group,turbidity]=id.split(":");
      this.buildSkirtMesh(group,turbidity,tiles,waterMap,waterfallEdgeIds);
    }
    this.skirtSignature=[
      ...waterTiles.map(tile=>
        `${tile.x},${tile.y}:${Number(tile.elevation||0).toFixed(4)}:${surfaceOf(tile).toFixed(4)}:${this.surfaceGroup(tile)}:${this.turbidityGroup(tile)}`
      ),
      ...[...waterfallEdgeIds].map(id=>`fall:${id}`)
    ].sort().join("|");
  }

  expectedSkirtSignature(waterTiles,waterfallEdges){
    return[
      ...waterTiles.map(tile=>
        `${tile.x},${tile.y}:${Number(tile.elevation||0).toFixed(4)}:${surfaceOf(tile).toFixed(4)}:${this.surfaceGroup(tile)}:${this.turbidityGroup(tile)}`
      ),
      ...waterfallEdges.map(edge=>`fall:${edge.id}`)
    ].sort().join("|");
  }

  syncSurfaceDynamics(waterTiles){
    if(typeof BABYLON.WaterMaterial!=="function"||
       !(this.surfaceMaterial instanceof BABYLON.WaterMaterial)||
       !waterTiles.length)return;

    const maxFlow=waterTiles.reduce(
      (max,tile)=>Math.max(max,Number(tile?.flowSpeed||0)),0
    );
    const averageTurbidity=waterTiles.reduce(
      (sum,tile)=>sum+clamp(tile?.waterTurbidity||0,0,1),0
    )/waterTiles.length;

    this.surfaceMaterial.windForce=clamp(1.9+maxFlow*.42,1.9,4.0);
    this.surfaceMaterial.waveHeight=clamp(.026+maxFlow*.007,.026,.060);
    this.surfaceMaterial.bumpHeight=clamp(.042+maxFlow*.006,.042,.080);
    this.surfaceMaterial.waveLength=clamp(1.18-maxFlow*.035,.80,1.18);
    this.surfaceMaterial.colorBlendFactor=clamp(.32+averageTurbidity*.10,.32,.42);
  }

  sync(state){
    const waterTiles=this.waterTiles(state);
    const waterfallEdges=this.waterfallEdges(state,waterTiles);
    this.syncSurfaceDynamics(waterTiles);

    const surfaceSignature=this.surfaceTopologySignature(waterTiles);
    if(surfaceSignature!==this.surfaceSignature)this.rebuildSurfaceMeshes(waterTiles);

    const waterfallSignature=this.waterfallTopologySignature(waterfallEdges);
    if(waterfallSignature!==this.waterfallSignature)this.rebuildWaterfalls(waterfallEdges);

    const skirtSignature=this.expectedSkirtSignature(waterTiles,waterfallEdges);
    if(skirtSignature!==this.skirtSignature)this.rebuildSkirtMeshes(waterTiles,waterfallEdges);

    if(!waterTiles.length){
      if(this.surfaceMeshes.size)this.disposeMap(this.surfaceMeshes);
      if(this.skirtMeshes.size)this.disposeMap(this.skirtMeshes);
      if(this.waterfalls.size)this.disposeMap(this.waterfalls);
      this.surfaceSignature="";
      this.skirtSignature="";
      this.waterfallSignature="";
    }
  }

  diagnostics(){
    return{
      surfaceMeshes:this.surfaceMeshes.size,
      skirtMeshes:this.skirtMeshes.size,
      waterfalls:this.waterfalls.size,
      surfaceTiles:[...this.surfaceMeshes.values()].reduce(
        (sum,mesh)=>sum+Number(mesh.metadata?.tileCount||0),0
      ),
      waterMaterial:typeof BABYLON.WaterMaterial==="function",
      materialName:this.surfaceMaterial?.name||null,
      perTileWaterBoxes:false,
      continuousWorldUv:true,
      boundaryDepthSkirts:true,
      waterfallVisualization:true
    };
  }
}

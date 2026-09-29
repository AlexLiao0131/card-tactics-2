import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const keyOf=(tile,type)=>`${tile.x},${tile.y}:${type}`;
const surfaceOf=tile=>tile.waterSurfaceZ==null
  ?Number(tile.elevation||0)
  :Math.max(Number(tile.elevation||0),Number(tile.waterSurfaceZ));

export class EnvironmentRenderer{
  constructor(scene){
    this.scene=scene;
    this.nodes=new Map();
    this.animated=new Map();

    this.currentTexture=this.makeCurrentTexture();

    this.materials={
      fire:this.mat("env-fire",new BABYLON.Color3(1,.28,.04),.76,new BABYLON.Color3(.9,.12,.01)),
      fireWind:this.mat("env-fire-wind",new BABYLON.Color3(1,.32,.05),.56,new BABYLON.Color3(.75,.08,.01)),
      wind:this.mat("env-wind",new BABYLON.Color3(.68,.82,.90),.23,new BABYLON.Color3(.12,.18,.22)),
      steam:this.mat("env-steam",new BABYLON.Color3(.80,.86,.88),.26),
      smoke:this.mat("env-smoke",new BABYLON.Color3(.12,.13,.14),.42),
      electric:this.mat("env-electric",new BABYLON.Color3(.45,.80,1),.68,new BABYLON.Color3(.22,.55,.95)),
      snow:this.mat("env-snow",new BABYLON.Color3(.92,.96,1),.94),
      ice:this.mat("env-ice",new BABYLON.Color3(.48,.82,.96),.45,new BABYLON.Color3(.12,.28,.36)),
      current:this.currentMaterial(),
      fragments:this.mat("env-fragments",new BABYLON.Color3(.48,.46,.43),.9),
      boiling:this.mat("env-boiling",new BABYLON.Color3(.72,.90,1),.48,new BABYLON.Color3(.16,.36,.5))
    };

    this.beforeRender=this.scene.onBeforeRenderObservable.add(()=>{
      const dt=Math.min(.05,Math.max(0,Number(this.scene.getEngine().getDeltaTime()||16)/1000));
      this.currentTexture.vOffset=(this.currentTexture.vOffset-dt*.24)%1;
      for(const {node,speed=0,spin=true} of this.animated.values())if(spin)node.rotation.y+=speed*dt;
    });
  }

  makeCurrentTexture(){
    const texture=new BABYLON.DynamicTexture("current-wave-texture",{width:256,height:256},this.scene,false);
    texture.hasAlpha=true;
    const ctx=texture.getContext();
    ctx.clearRect(0,0,256,256);
    ctx.lineCap="round";
    for(let row=0;row<4;row++){
      const y=28+row*58;
      ctx.strokeStyle=`rgba(170,230,255,${.22+row*.045})`;
      ctx.lineWidth=5;
      ctx.beginPath();
      ctx.moveTo(16,y);
      ctx.bezierCurveTo(72,y-12,116,y+14,168,y);
      ctx.bezierCurveTo(198,y-8,222,y+5,240,y-2);
      ctx.stroke();
      ctx.strokeStyle="rgba(230,250,255,.28)";
      ctx.lineWidth=2;
      ctx.beginPath();
      ctx.moveTo(24,y+9);
      ctx.bezierCurveTo(92,y+2,145,y+16,226,y+6);
      ctx.stroke();
    }
    texture.update();
    texture.wrapU=BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapV=BABYLON.Texture.WRAP_ADDRESSMODE;
    return texture;
  }

  currentMaterial(){
    const material=new BABYLON.StandardMaterial("env-current-wave",this.scene);
    material.diffuseTexture=this.currentTexture;
    material.opacityTexture=this.currentTexture;
    material.emissiveTexture=this.currentTexture;
    material.diffuseColor=new BABYLON.Color3(.38,.78,1);
    material.emissiveColor=new BABYLON.Color3(.12,.32,.44);
    material.alpha=.62;
    material.disableLighting=true;
    material.backFaceCulling=false;
    return material;
  }

  mat(name,color,alpha=1,emissive=null){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;material.alpha=alpha;material.specularColor=BABYLON.Color3.Black();
    if(emissive)material.emissiveColor=emissive;return material;
  }
  root(name){return new BABYLON.TransformNode(name,this.scene);}
  addMesh(root,mesh,material){mesh.parent=root;mesh.material=material;mesh.isPickable=false;return mesh;}

  create(type,key,tile){
    const root=this.root(`environment-${key}`);
    if(type==="BURNING"){
      const flame=this.addMesh(root,BABYLON.MeshBuilder.CreateCylinder(`burn-${key}`,{height:.88,diameterTop:.08,diameterBottom:.70,tessellation:8},this.scene),this.materials.fire);flame.position.y=.44;this.animated.set(key,{node:root,speed:2.8});
    }else if(type==="TORNADO"||type==="FIRE_TORNADO"){
      const material=type==="FIRE_TORNADO"?this.materials.fireWind:this.materials.wind;
      for(let i=0;i<3;i++){const ring=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(`wind-${key}-${i}`,{diameter:.52+i*.28,thickness:.055,tessellation:16},this.scene),material);ring.position.y=.28+i*.38;}
      const cone=this.addMesh(root,BABYLON.MeshBuilder.CreateCylinder(`wind-core-${key}`,{height:1.35,diameterTop:1.05,diameterBottom:.22,tessellation:12},this.scene),material);cone.position.y=.68;this.animated.set(key,{node:root,speed:type==="FIRE_TORNADO"?4.2:3.4});
    }else if(type==="STEAM"){
      const cloud=this.addMesh(root,BABYLON.MeshBuilder.CreateSphere(`steam-${key}`,{diameter:.95,segments:8},this.scene),this.materials.steam);cloud.position.y=.62;cloud.scaling.set(1,.72,1);this.animated.set(key,{node:root,speed:.45});
    }else if(type==="SMOKE"){
      for(let i=0;i<4;i++){const puff=this.addMesh(root,BABYLON.MeshBuilder.CreateSphere(`smoke-${key}-${i}`,{diameter:.72+i*.08,segments:7},this.scene),this.materials.smoke),side=(i%2?1:-1)*(.10+i*.035);puff.position.set(side,.48+i*.30,(i%3-1)*.08);puff.scaling.set(1.05,.76,1.05);}this.animated.set(key,{node:root,speed:.18});
    }else if(type==="ELECTRIFIED"){
      const ring=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(`electric-${key}`,{diameter:1.05,thickness:.065,tessellation:20},this.scene),this.materials.electric);ring.position.y=.11;this.animated.set(key,{node:root,speed:5.2});
    }else if(type==="BOILING"){
      const ring=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(`boiling-${key}`,{diameter:.8,thickness:.05,tessellation:18},this.scene),this.materials.boiling);ring.position.y=.08;this.animated.set(key,{node:root,speed:1.7});
    }else if(type==="FRAGMENTS"){
      for(let i=0;i<4;i++){const chip=this.addMesh(root,BABYLON.MeshBuilder.CreatePolyhedron(`fragment-${key}-${i}`,{type:2,size:.12},this.scene),this.materials.fragments),a=i*Math.PI/2+.35;chip.position.set(Math.cos(a)*.34,.10+(i%2)*.12,Math.sin(a)*.34);}
    }else if(type==="SNOW"){
      const plate=this.addMesh(root,BABYLON.MeshBuilder.CreateBox(`snow-${key}`,{width:TILE_SIZE*1.01,depth:TILE_SIZE*1.01,height:1},this.scene),this.materials.snow);plate.metadata={dynamicLayer:"SNOW"};
    }else if(type==="ICE"){
      const plate=this.addMesh(root,BABYLON.MeshBuilder.CreateGround(`ice-${key}`,{width:TILE_SIZE*1.01,height:TILE_SIZE*1.01,subdivisions:1},this.scene),this.materials.ice);plate.position.y=.034;
    }else if(type==="CURRENT"){
      const wave=this.addMesh(root,BABYLON.MeshBuilder.CreateGround(`current-${key}`,{width:TILE_SIZE*.88,height:TILE_SIZE*.88,subdivisions:1},this.scene),this.materials.current);
      wave.position.y=.046;
      root.metadata.currentWave=true;
      this.animated.set(key,{node:root,speed:0,spin:false});
    }else{root.dispose();return null;}
    root.metadata={...(root.metadata||{}),effectType:type,tileX:tile.x,tileY:tile.y};return root;
  }

  desiredTypes(tile){
    const types=new Set(tile.effects||[]);
    if(Number(tile.snowDepth||0)>0)types.add("SNOW");
    if(Number(tile.iceThickness||0)>0)types.add("ICE");
    if(Number(tile.flowSpeed||0)>.01)types.add("CURRENT");
    return types;
  }

  syncAtmosphere(state){
    const environment=state?.presentation?.environment||{},weather=String(environment.weather||"CLEAR"),night=environment.timeOfDay==="NIGHT";
    this.scene.clearColor=night?new BABYLON.Color4(.018,.027,.055,1):new BABYLON.Color4(.035,.055,.08,1);
    if(weather==="FOG"){this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;this.scene.fogDensity=.022;this.scene.fogColor=new BABYLON.Color3(.48,.53,.57);}
    else if(weather==="BLIZZARD"){this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;this.scene.fogDensity=.017;this.scene.fogColor=new BABYLON.Color3(.64,.69,.74);}
    else if(weather==="HEAVY_RAIN"||weather==="THUNDERSTORM"){this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;this.scene.fogDensity=.006;this.scene.fogColor=new BABYLON.Color3(.20,.26,.31);}
    else{this.scene.fogMode=BABYLON.Scene.FOGMODE_NONE;this.scene.fogDensity=0;}
  }

  sync(state){
    this.syncAtmosphere(state);const alive=new Set();
    for(const tile of state?.map?.tiles||[]){
      const surface=surfaceOf(tile)*ELEVATION_HEIGHT;
      for(const type of this.desiredTypes(tile)){
        const key=keyOf(tile,type);alive.add(key);let node=this.nodes.get(key);
        if(!node){node=this.create(type,key,tile);if(!node)continue;this.nodes.set(key,node);}
        node.position.set(tile.x*TILE_SIZE,surface,tile.y*TILE_SIZE);

        if(type==="SNOW"){
          const depth=Math.max(.015,Number(tile.snowDepth||0)*ELEVATION_HEIGHT);
          for(const mesh of node.getChildMeshes())if(mesh.metadata?.dynamicLayer==="SNOW"){mesh.scaling.y=depth;mesh.position.y=depth/2+.006;}
        }else if(type==="CURRENT"){
          const fx=Number(tile.flowX||0),fy=Number(tile.flowY||0);
          if(Math.abs(fx)>.001||Math.abs(fy)>.001)node.rotation.y=Math.atan2(fx,fy);
          const speed=Math.max(.1,Number(tile.flowSpeed||0));
          node.scaling.z=clamp(1+speed*.08,1,1.28);
        }

        const visible=tile.fogged?0:1;
        node.getChildMeshes().forEach(mesh=>mesh.visibility=visible);
      }
    }
    for(const[key,node]of this.nodes){
      if(alive.has(key))continue;
      this.animated.delete(key);node.dispose();this.nodes.delete(key);
    }
  }

  diagnostics(){
    const byType={};
    for(const node of this.nodes.values()){const type=node.metadata?.effectType||"UNKNOWN";byType[type]=(byType[type]||0)+1;}
    return{total:this.nodes.size,byType,currentWaveTexture:true};
  }
}

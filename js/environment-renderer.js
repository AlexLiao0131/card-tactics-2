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

    this.materials={
      fire:this.mat("env-fire",new BABYLON.Color3(1,.28,.04),.76,new BABYLON.Color3(.9,.12,.01)),
      fireWind:this.mat("env-fire-wind",new BABYLON.Color3(1,.32,.05),.56,new BABYLON.Color3(.75,.08,.01)),
      wind:this.mat("env-wind",new BABYLON.Color3(.68,.82,.90),.23,new BABYLON.Color3(.12,.18,.22)),
      steam:this.mat("env-steam",new BABYLON.Color3(.80,.86,.88),.26),
      electric:this.mat("env-electric",new BABYLON.Color3(.45,.80,1),.68,new BABYLON.Color3(.22,.55,.95)),
      snow:this.mat("env-snow",new BABYLON.Color3(.92,.96,1),.82),
      ice:this.mat("env-ice",new BABYLON.Color3(.48,.82,.96),.45,new BABYLON.Color3(.12,.28,.36)),
      current:this.mat("env-current",new BABYLON.Color3(.22,.72,1),.50,new BABYLON.Color3(.08,.25,.4)),
      fragments:this.mat("env-fragments",new BABYLON.Color3(.48,.46,.43),.9),
      boiling:this.mat("env-boiling",new BABYLON.Color3(.72,.90,1),.48,new BABYLON.Color3(.16,.36,.5))
    };

    this.beforeRender=this.scene.onBeforeRenderObservable.add(()=>{
      const dt=Math.min(.05,Math.max(0,Number(this.scene.getEngine().getDeltaTime()||16)/1000));
      for(const {node,speed=0} of this.animated.values())node.rotation.y+=speed*dt;
    });
  }

  mat(name,color,alpha=1,emissive=null){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;
    material.alpha=alpha;
    material.specularColor=BABYLON.Color3.Black();
    if(emissive)material.emissiveColor=emissive;
    return material;
  }

  root(name){
    return new BABYLON.TransformNode(name,this.scene);
  }

  addMesh(root,mesh,material){
    mesh.parent=root;
    mesh.material=material;
    mesh.isPickable=false;
    return mesh;
  }

  create(type,key,tile){
    const root=this.root(`environment-${key}`);

    if(type==="BURNING"){
      const flame=this.addMesh(root,BABYLON.MeshBuilder.CreateCylinder(
        `burn-${key}`,{height:.88,diameterTop:.08,diameterBottom:.70,tessellation:8},this.scene
      ),this.materials.fire);
      flame.position.y=.44;
      this.animated.set(key,{node:root,speed:2.8});
    }else if(type==="TORNADO"||type==="FIRE_TORNADO"){
      const material=type==="FIRE_TORNADO"?this.materials.fireWind:this.materials.wind;
      for(let i=0;i<3;i++){
        const ring=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(
          `wind-${key}-${i}`,{diameter:.52+i*.28,thickness:.055,tessellation:16},this.scene
        ),material);
        ring.position.y=.28+i*.38;
      }
      const cone=this.addMesh(root,BABYLON.MeshBuilder.CreateCylinder(
        `wind-core-${key}`,{height:1.35,diameterTop:1.05,diameterBottom:.22,tessellation:12},this.scene
      ),material);
      cone.position.y=.68;
      this.animated.set(key,{node:root,speed:type==="FIRE_TORNADO"?4.2:3.4});
    }else if(type==="STEAM"){
      const cloud=this.addMesh(root,BABYLON.MeshBuilder.CreateSphere(
        `steam-${key}`,{diameter:.95,segments:8},this.scene
      ),this.materials.steam);
      cloud.position.y=.62;
      cloud.scaling.set(1,.72,1);
      this.animated.set(key,{node:root,speed:.45});
    }else if(type==="ELECTRIFIED"){
      const ring=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(
        `electric-${key}`,{diameter:1.05,thickness:.065,tessellation:20},this.scene
      ),this.materials.electric);
      ring.position.y=.11;
      this.animated.set(key,{node:root,speed:5.2});
    }else if(type==="BOILING"){
      const ring=this.addMesh(root,BABYLON.MeshBuilder.CreateTorus(
        `boiling-${key}`,{diameter:.8,thickness:.05,tessellation:18},this.scene
      ),this.materials.boiling);
      ring.position.y=.08;
      this.animated.set(key,{node:root,speed:1.7});
    }else if(type==="FRAGMENTS"){
      for(let i=0;i<4;i++){
        const chip=this.addMesh(root,BABYLON.MeshBuilder.CreatePolyhedron(
          `fragment-${key}-${i}`,{type:2,size:.12},this.scene
        ),this.materials.fragments);
        const a=i*Math.PI/2+.35;
        chip.position.set(Math.cos(a)*.34,.10+(i%2)*.12,Math.sin(a)*.34);
      }
    }else if(type==="SNOW"){
      const plate=this.addMesh(root,BABYLON.MeshBuilder.CreateBox(
        `snow-${key}`,{width:TILE_SIZE*.88,depth:TILE_SIZE*.88,height:.045},this.scene
      ),this.materials.snow);
      plate.position.y=.026;
    }else if(type==="ICE"){
      const plate=this.addMesh(root,BABYLON.MeshBuilder.CreateBox(
        `ice-${key}`,{width:TILE_SIZE*.88,depth:TILE_SIZE*.88,height:.035},this.scene
      ),this.materials.ice);
      plate.position.y=.034;
    }else if(type==="CURRENT"){
      for(let i=-1;i<=1;i++){
        const stripe=this.addMesh(root,BABYLON.MeshBuilder.CreateBox(
          `current-${key}-${i}`,{width:.55,depth:.06,height:.025},this.scene
        ),this.materials.current);
        stripe.position.set(i*.42,.055,0);
      }
      this.animated.set(key,{node:root,speed:.7});
    }else{
      root.dispose();
      return null;
    }

    root.metadata={effectType:type,tileX:tile.x,tileY:tile.y};
    return root;
  }

  desiredTypes(tile){
    const types=new Set(tile.effects||[]);
    if(Number(tile.snowDepth||0)>0)types.add("SNOW");
    if(Number(tile.iceThickness||0)>0)types.add("ICE");
    if(Number(tile.flowSpeed||0)>.01)types.add("CURRENT");
    return types;
  }

  syncAtmosphere(state){
    const environment=state?.presentation?.environment||{};
    const weather=String(environment.weather||"CLEAR");
    const night=environment.timeOfDay==="NIGHT";

    this.scene.clearColor=night
      ?new BABYLON.Color4(.018,.027,.055,1)
      :new BABYLON.Color4(.035,.055,.08,1);

    if(weather==="FOG"){
      this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;
      this.scene.fogDensity=.022;
      this.scene.fogColor=new BABYLON.Color3(.48,.53,.57);
    }else if(weather==="BLIZZARD"){
      this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;
      this.scene.fogDensity=.017;
      this.scene.fogColor=new BABYLON.Color3(.64,.69,.74);
    }else if(weather==="HEAVY_RAIN"||weather==="THUNDERSTORM"){
      this.scene.fogMode=BABYLON.Scene.FOGMODE_EXP2;
      this.scene.fogDensity=.006;
      this.scene.fogColor=new BABYLON.Color3(.20,.26,.31);
    }else{
      this.scene.fogMode=BABYLON.Scene.FOGMODE_NONE;
      this.scene.fogDensity=0;
    }
  }

  sync(state){
    this.syncAtmosphere(state);
    const alive=new Set();

    for(const tile of state?.map?.tiles||[]){
      const surface=surfaceOf(tile)*ELEVATION_HEIGHT;
      for(const type of this.desiredTypes(tile)){
        const key=keyOf(tile,type);
        alive.add(key);

        let node=this.nodes.get(key);
        if(!node){
          node=this.create(type,key,tile);
          if(!node)continue;
          this.nodes.set(key,node);
        }

        node.position.set(tile.x*TILE_SIZE,surface,tile.y*TILE_SIZE);
        const visible=tile.fogged?0:1;
        node.getChildMeshes().forEach(mesh=>mesh.visibility=visible);
      }
    }

    for(const[key,node]of this.nodes){
      if(alive.has(key))continue;
      this.animated.delete(key);
      node.dispose();
      this.nodes.delete(key);
    }
  }

  diagnostics(){
    const byType={};
    for(const node of this.nodes.values()){
      const type=node.metadata?.effectType||"UNKNOWN";
      byType[type]=(byType[type]||0)+1;
    }
    return{total:this.nodes.size,byType};
  }
}

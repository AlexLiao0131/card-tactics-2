import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const keyOf=(x,y)=>`${x},${y}`;

function tileAt(state,x,y){
  return state?.map?.tiles?.find(tile=>tile.x===x&&tile.y===y)||null;
}

function surfaceY(state,x,y){
  const tile=tileAt(state,x,y);
  if(!tile)return 0;
  const surface=tile.waterSurfaceZ==null
    ?Number(tile.elevation||0)
    :Math.max(Number(tile.elevation||0),Number(tile.waterSurfaceZ));
  return surface*ELEVATION_HEIGHT;
}

function hash01(value){
  const text=String(value||"");
  let h=2166136261;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return (h>>>0)/4294967295;
}

export class MapObjectRenderer{
  constructor(scene){
    this.scene=scene;
    this.nodes=new Map();

    this.materials={
      trunk:this.mat("prop-trunk",new BABYLON.Color3(.28,.17,.09)),
      foliage:this.mat("prop-foliage",new BABYLON.Color3(.10,.34,.16)),
      rock:this.mat("prop-rock",new BABYLON.Color3(.36,.38,.42))
    };
  }

  mat(name,color){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;
    material.specularColor=BABYLON.Color3.Black();
    return material;
  }

  setNodeVisibility(node,value){
    node.getChildMeshes?.().forEach(mesh=>mesh.visibility=value);
  }

  createForest(tile){
    const root=new BABYLON.TransformNode(`forest-prop-${tile.x}-${tile.y}`,this.scene);
    const trunk=BABYLON.MeshBuilder.CreateCylinder(
      `forest-trunk-${tile.x}-${tile.y}`,
      {height:.78,diameter:.22,tessellation:7},
      this.scene
    );
    trunk.parent=root;
    trunk.position.y=.39;
    trunk.material=this.materials.trunk;
    trunk.isPickable=false;

    const canopy=BABYLON.MeshBuilder.CreateCylinder(
      `forest-canopy-${tile.x}-${tile.y}`,
      {height:1.15,diameterTop:.08,diameterBottom:1.0,tessellation:8},
      this.scene
    );
    canopy.parent=root;
    canopy.position.y=1.18;
    canopy.material=this.materials.foliage;
    canopy.isPickable=false;

    const seed=hash01(`forest:${tile.x},${tile.y}`);
    root.rotation.y=seed*Math.PI*2;
    root.scaling.setAll(.84+seed*.24);
    return root;
  }

  createRock(object){
    const root=new BABYLON.TransformNode(`map-object-${object.id}`,this.scene);
    const rock=BABYLON.MeshBuilder.CreatePolyhedron(
      `rock-${object.id}`,
      {type:2,size:.72},
      this.scene
    );
    rock.parent=root;
    rock.material=this.materials.rock;
    rock.isPickable=false;

    const seed=hash01(object.id);
    rock.scaling.set(.95+seed*.28,.75+seed*.48,.9+(1-seed)*.32);
    rock.rotation.set(seed*.35,seed*Math.PI*2,(1-seed)*.22);
    rock.position.y=.58;
    return root;
  }

  createGeneric(object){
    const root=new BABYLON.TransformNode(`map-object-${object.id}`,this.scene);
    const mesh=BABYLON.MeshBuilder.CreateBox(
      `prop-${object.id}`,
      {width:.8,height:.8,depth:.8},
      this.scene
    );
    mesh.parent=root;
    mesh.position.y=.4;
    mesh.material=this.materials.rock;
    mesh.isPickable=false;
    return root;
  }

  sync(state){
    const alive=new Set();

    for(const tile of state?.map?.tiles||[]){
      if(tile.terrain!=="FOREST")continue;
      const key=`FOREST:${keyOf(tile.x,tile.y)}`;
      alive.add(key);

      let node=this.nodes.get(key);
      if(!node){
        node=this.createForest(tile);
        this.nodes.set(key,node);
      }
      node.position.set(tile.x*TILE_SIZE,surfaceY(state,tile.x,tile.y),tile.y*TILE_SIZE);
      this.setNodeVisibility(node,tile.fogged?.24:1);
    }

    for(const object of state?.map?.objects||[]){
      if(object.destroyed||object.type==="CORE")continue;
      const key=`OBJECT:${object.id}`;
      alive.add(key);

      let node=this.nodes.get(key);
      if(!node){
        node=object.type==="ROCK"?this.createRock(object):this.createGeneric(object);
        this.nodes.set(key,node);
      }
      node.position.set(Number(object.x||0)*TILE_SIZE,surfaceY(state,object.x,object.y),Number(object.y||0)*TILE_SIZE);
      const tile=tileAt(state,object.x,object.y);
      this.setNodeVisibility(node,tile?.fogged?.24:1);
    }

    for(const[key,node]of this.nodes){
      if(alive.has(key))continue;
      node.dispose();
      this.nodes.delete(key);
    }
  }

  diagnostics(){
    let forests=0,objects=0;
    for(const key of this.nodes.keys())key.startsWith("FOREST:")?forests++:objects++;
    return{forests,objects,total:this.nodes.size};
  }
}

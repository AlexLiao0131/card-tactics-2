import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
const keyOf=t=>`${t.x},${t.y}`;
const tilesOf=state=>state?.map?.tiles||state?.grid?.tiles||[];
export class TerrainRenderer{
  constructor(scene){
    this.scene=scene;this.meshes=new Map();
    this.materials={
      soil:this.mat("soil",new BABYLON.Color3(.30,.42,.24)),
      forest:this.mat("forest",new BABYLON.Color3(.16,.34,.20)),
      rock:this.mat("rock",new BABYLON.Color3(.34,.36,.39)),
      mud:this.mat("mud",new BABYLON.Color3(.35,.27,.17)),
      wall:this.mat("wall",new BABYLON.Color3(.24,.25,.28))
    };
  }
  mat(name,color){const m=new BABYLON.StandardMaterial(name,this.scene);m.diffuseColor=color;m.specularColor=BABYLON.Color3.Black();return m}
  sync(state){
    const alive=new Set();
    for(const tile of tilesOf(state)){
      const key=keyOf(tile);alive.add(key);
      const topY=Number(tile.elevation||0)*ELEVATION_HEIGHT;
      const height=Math.max(.18,(Number(tile.elevation||0)+2)*ELEVATION_HEIGHT);
      let mesh=this.meshes.get(key);
      if(!mesh||Math.abs(Number(mesh.metadata?.height)-height)>.0001){
        mesh?.dispose();
        mesh=BABYLON.MeshBuilder.CreateBox(`tile-${key}`,{width:TILE_SIZE*.94,depth:TILE_SIZE*.94,height},this.scene);
        mesh.metadata={kind:"tile",x:tile.x,y:tile.y,height};
        this.meshes.set(key,mesh);
      }
      mesh.position.set(tile.x*TILE_SIZE,topY-height/2,tile.y*TILE_SIZE);
      mesh.material=tile.terrain==="MUD"?this.materials.mud:
        tile.terrain==="FOREST"?this.materials.forest:
        tile.terrain==="WALL"?this.materials.wall:
        (tile.terrain==="HIGH_GROUND"||tile.material==="ROCK"?this.materials.rock:this.materials.soil);
      mesh.visibility=tile.fogged?.38:1;
      mesh.receiveShadows=true;
    }
    for(const[key,mesh]of this.meshes)if(!alive.has(key)){mesh.dispose();this.meshes.delete(key)}
  }
}

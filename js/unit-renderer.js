import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from "./coordinate-system.js";

export class UnitRenderer{
  constructor(scene){
    this.scene=scene;
    this.meshes=new Map();
    this.materials={
      PLAYER:this.mat("player",new BABYLON.Color3(.20,.55,.95)),
      ENEMY:this.mat("enemy",new BABYLON.Color3(.90,.24,.24)),
      NEUTRAL:this.mat("neutral",new BABYLON.Color3(.75,.65,.25)),
      P:null,E:null,N:null
    };
    this.materials.P=this.materials.PLAYER;
    this.materials.E=this.materials.ENEMY;
    this.materials.N=this.materials.NEUTRAL;
  }

  mat(name,color){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;
    return material;
  }

  sync(state){
    const alive=new Set();

    for(const unit of state?.units||[]){
      alive.add(unit.id);

      let mesh=this.meshes.get(unit.id);
      if(!mesh){
        mesh=BABYLON.MeshBuilder.CreateCapsule(
          `unit-${unit.id}`,
          {height:UNIT_VISUAL_HEIGHT,radius:.42},
          this.scene
        );
        mesh.metadata={kind:"unit",unitId:unit.id};
        this.meshes.set(unit.id,mesh);
      }

      mesh.material=this.materials[unit.team]??this.materials.NEUTRAL;
      mesh.scaling.setAll(unit.selected?1.13:unit.finished?.92:1);
      mesh.visibility=unit.finished?.62:1;

      const x=Number(unit.x)*TILE_SIZE;
      const baseY=Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT;
      const z=Number(unit.y)*TILE_SIZE;
      mesh.position.set(x,baseY+UNIT_VISUAL_HEIGHT/2,z);
    }

    for(const[id,mesh]of this.meshes){
      if(alive.has(id))continue;
      mesh.dispose();
      this.meshes.delete(id);
    }
  }
}

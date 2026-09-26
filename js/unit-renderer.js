import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from "./coordinate-system.js";

const DEFAULT_BATTLE_VISUAL=Object.freeze({kind:"CAPSULE"});

export class UnitRenderer{
  constructor(scene){
    this.scene=scene;
    this.entries=new Map();
    // Kept for renderer diagnostics/backward compatibility.
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

  battleVisual(unit){
    return globalThis.VisualDatabase?.characterBattle?.(unit?.visualId)||DEFAULT_BATTLE_VISUAL;
  }

  visualSignature(unit,definition){
    return[
      unit?.visualId||"",
      definition?.kind||"CAPSULE",
      definition?.asset||definition?.src||"",
      Number(definition?.width||0),
      Number(definition?.height||0),
      Number(definition?.lift||0)
    ].join("|");
  }

  createCapsule(unit){
    const mesh=BABYLON.MeshBuilder.CreateCapsule(
      `unit-${unit.id}`,
      {height:UNIT_VISUAL_HEIGHT,radius:.42},
      this.scene
    );
    mesh.metadata={kind:"unit",unitId:unit.id,visualKind:"CAPSULE"};
    return{root:mesh,meshes:[mesh],kind:"CAPSULE",height:UNIT_VISUAL_HEIGHT,lift:0};
  }

  createBillboard(unit,definition){
    const asset=definition?.asset||definition?.src;
    if(!asset)return this.createCapsule(unit);

    const height=Math.max(.25,Number(definition.height||UNIT_VISUAL_HEIGHT));
    const width=Math.max(.15,Number(definition.width||height*.72));
    const root=new BABYLON.TransformNode(`unit-${unit.id}`,this.scene);
    root.metadata={kind:"unit",unitId:unit.id,visualKind:"BILLBOARD"};

    const plane=BABYLON.MeshBuilder.CreatePlane(
      `unit-billboard-${unit.id}`,
      {width,height,sideOrientation:BABYLON.Mesh.DOUBLESIDE},
      this.scene
    );
    plane.parent=root;
    plane.position.y=height/2;
    plane.billboardMode=BABYLON.Mesh.BILLBOARDMODE_Y;
    plane.isPickable=false;

    const material=new BABYLON.StandardMaterial(`unit-billboard-mat-${unit.id}`,this.scene);
    const texture=new BABYLON.Texture(asset,this.scene,true,false,BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    texture.hasAlpha=true;
    material.diffuseTexture=texture;
    material.useAlphaFromDiffuseTexture=true;
    material.opacityTexture=texture;
    material.backFaceCulling=false;
    material.specularColor=BABYLON.Color3.Black();
    material.emissiveColor=new BABYLON.Color3(.08,.08,.08);
    plane.material=material;

    return{
      root,
      meshes:[plane],
      kind:"BILLBOARD",
      height,
      lift:Number(definition.lift||0),
      dispose:()=>{
        texture.dispose();
        material.dispose();
      }
    };
  }

  createEntry(unit,definition,signature){
    const kind=String(definition?.kind||"CAPSULE").toUpperCase();
    const visual=kind==="BILLBOARD"
      ?this.createBillboard(unit,definition)
      :this.createCapsule(unit);

    const entry={...visual,signature};
    this.entries.set(unit.id,entry);
    this.meshes.set(unit.id,entry.root);
    return entry;
  }

  disposeEntry(id){
    const entry=this.entries.get(id);
    if(!entry)return;
    entry.dispose?.();
    entry.root?.dispose?.();
    this.entries.delete(id);
    this.meshes.delete(id);
  }

  setVisibility(entry,value){
    for(const mesh of entry?.meshes||[])mesh.visibility=value;
  }

  sync(state){
    const alive=new Set();

    for(const unit of state?.units||[]){
      alive.add(unit.id);

      const definition=this.battleVisual(unit);
      const signature=this.visualSignature(unit,definition);
      let entry=this.entries.get(unit.id);

      if(entry?.signature!==signature){
        this.disposeEntry(unit.id);
        entry=null;
      }
      if(!entry)entry=this.createEntry(unit,definition,signature);

      if(entry.kind==="CAPSULE"){
        entry.root.material=this.materials[unit.team]??this.materials.NEUTRAL;
      }

      const scale=unit.selected?1.13:unit.finished?.92:1;
      entry.root.scaling.setAll(scale);
      this.setVisibility(entry,unit.finished?.62:1);

      const x=Number(unit.x)*TILE_SIZE;
      const baseY=Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT;
      const z=Number(unit.y)*TILE_SIZE;
      const lift=Number(entry.lift||0);

      if(entry.kind==="CAPSULE")entry.root.position.set(x,baseY+entry.height/2+lift,z);
      else entry.root.position.set(x,baseY+lift,z);
    }

    for(const id of [...this.entries.keys()]){
      if(alive.has(id))continue;
      this.disposeEntry(id);
    }
  }
}

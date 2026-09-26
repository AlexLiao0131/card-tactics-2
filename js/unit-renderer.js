import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from "./coordinate-system.js";

const clamp01=value=>Math.max(0,Math.min(1,Number(value||0)));

export class UnitRenderer{
  constructor(scene){
    this.scene=scene;this.meshes=new Map();this.huds=new Map();
    this.materials={
      PLAYER:this.mat("player",new BABYLON.Color3(.20,.55,.95)),
      ENEMY:this.mat("enemy",new BABYLON.Color3(.90,.24,.24)),
      NEUTRAL:this.mat("neutral",new BABYLON.Color3(.75,.65,.25)),
      P:null,E:null,N:null
    };
    this.materials.P=this.materials.PLAYER;this.materials.E=this.materials.ENEMY;this.materials.N=this.materials.NEUTRAL;
  }

  mat(name,color){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;
    return material;
  }

  createHud(unit){
    const texture=new BABYLON.DynamicTexture(`unit-hud-texture-${unit.id}`,{width:256,height:72},this.scene,false);
    texture.hasAlpha=true;

    const material=new BABYLON.StandardMaterial(`unit-hud-material-${unit.id}`,this.scene);
    material.diffuseTexture=texture;
    material.emissiveTexture=texture;
    material.opacityTexture=texture;
    material.disableLighting=true;
    material.backFaceCulling=true;
    material.useAlphaFromDiffuseTexture=true;

    // Babylon's Plane front face points toward -Z, while billboard facing uses the
    // mesh forward direction (+Z). Build the HUD as BACKSIDE so its readable face
    // is the one the billboard continuously presents to the active camera.
    const plane=BABYLON.MeshBuilder.CreatePlane(
      `unit-hud-${unit.id}`,
      {width:1.72,height:.48,sideOrientation:BABYLON.Mesh.BACKSIDE},
      this.scene
    );
    plane.material=material;
    plane.isPickable=false;
    plane.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.renderingGroupId=3;

    const hud={plane,texture,material,key:""};
    this.huds.set(unit.id,hud);
    return hud;
  }

  drawHud(hud,unit){
    const hp=Math.max(0,Number(unit.hp||0));
    const maxHp=Math.max(1,Number(unit.maxHp||hp||1));
    const pct=clamp01(hp/maxHp);
    const key=`${unit.name}|${hp}|${maxHp}|${unit.team}|${unit.finished?1:0}`;
    if(hud.key===key)return;
    hud.key=key;

    const ctx=hud.texture.getContext();
    ctx.clearRect(0,0,256,72);
    ctx.fillStyle="rgba(5,10,16,.86)";
    ctx.fillRect(0,0,256,72);

    ctx.font="700 21px sans-serif";
    ctx.textAlign="left";
    ctx.textBaseline="middle";
    ctx.fillStyle="rgba(255,255,255,.96)";
    const label=String(unit.name||unit.id||"UNIT");
    ctx.fillText(label.length>12?label.slice(0,12):label,10,20);

    ctx.font="700 18px sans-serif";
    ctx.textAlign="right";
    ctx.fillText(`HP ${hp}/${maxHp}`,246,20);

    ctx.fillStyle="rgba(24,28,34,.98)";
    ctx.fillRect(10,42,236,17);
    ctx.fillStyle=pct>.5?"#55b46c":pct>.25?"#d9a441":"#d95b5b";
    ctx.fillRect(10,42,236*pct,17);

    ctx.strokeStyle="rgba(255,255,255,.72)";
    ctx.lineWidth=2;
    ctx.strokeRect(10,42,236,17);
    hud.texture.update(false);
  }

  sync(state){
    const alive=new Set();
    for(const unit of state?.units||[]){
      alive.add(unit.id);

      let mesh=this.meshes.get(unit.id);
      if(!mesh){
        mesh=BABYLON.MeshBuilder.CreateCapsule(`unit-${unit.id}`,{height:UNIT_VISUAL_HEIGHT,radius:.42},this.scene);
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

      const hud=this.huds.get(unit.id)||this.createHud(unit);
      this.drawHud(hud,unit);
      hud.plane.position.set(x,baseY+UNIT_VISUAL_HEIGHT+.42,z);
      hud.plane.visibility=unit.finished?.72:1;
    }

    for(const[id,mesh]of this.meshes){
      if(alive.has(id))continue;
      mesh.dispose();
      this.meshes.delete(id);

      const hud=this.huds.get(id);
      if(hud){
        hud.plane.dispose();
        hud.material.dispose();
        hud.texture.dispose();
        this.huds.delete(id);
      }
    }
  }
}

import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from "./coordinate-system.js";

const DEFAULT_BATTLE_VISUAL=Object.freeze({kind:"CAPSULE"});
const FACING_ANGLE=Object.freeze({S:0,E:Math.PI/2,N:Math.PI,W:-Math.PI/2});
const FACING_VECTOR=Object.freeze({N:{x:0,z:-1},E:{x:1,z:0},S:{x:0,z:1},W:{x:-1,z:0}});
const DEBUG_MIN_DURATION=Object.freeze({WALK:360,ATTACK:620,CAST:760,HURT:520,DEATH:1050});

function normalizeFacing(value){
  const facing=String(value||"S").toUpperCase();
  return Object.hasOwn(FACING_ANGLE,facing)?facing:"S";
}

function facingFromDelta(dx,dy,fallback="S"){
  if(!dx&&!dy)return normalizeFacing(fallback);
  if(Math.abs(dx)>Math.abs(dy))return dx>0?"E":"W";
  return dy>0?"S":"N";
}

function lerp(a,b,t){return Number(a||0)+(Number(b||0)-Number(a||0))*t;}
function clamp01(value){return Math.max(0,Math.min(1,Number(value||0)));}

export class UnitRenderer{
  constructor(scene){
    this.scene=scene;
    this.entries=new Map();
    this.meshes=new Map();
    this.animationQueues=new Map();
    this.activeAnimations=new Map();
    this.animationDebug=true;
    this.figureMaterials=new Map();
    this.materials={
      PLAYER:this.mat("player",new BABYLON.Color3(.20,.55,.95)),
      ENEMY:this.mat("enemy",new BABYLON.Color3(.90,.24,.24)),
      NEUTRAL:this.mat("neutral",new BABYLON.Color3(.75,.65,.25)),
      facing:this.mat("unit-facing",new BABYLON.Color3(.96,.90,.42)),
      submerged:this.mat("unit-submerged",new BABYLON.Color3(.35,.78,.98)),
      airborne:this.mat("unit-airborne",new BABYLON.Color3(.90,.88,.55)),
      P:null,E:null,N:null
    };
    this.materials.P=this.materials.PLAYER;
    this.materials.E=this.materials.ENEMY;
    this.materials.N=this.materials.NEUTRAL;
    this.materials.submerged.alpha=.68;this.materials.submerged.disableLighting=true;
    this.materials.airborne.alpha=.52;this.materials.airborne.disableLighting=true;
  }

  mat(name,color){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=color;
    return material;
  }

  battleVisual(unit){
    return globalThis.VisualDatabase?.characterBattle?.(unit?.visualId)||DEFAULT_BATTLE_VISUAL;
  }

  baseAssetForFacing(unit,definition,facing=unit?.facing){
    const f=normalizeFacing(facing);
    return definition?.facingAssets?.[f]||definition?.asset||definition?.src||"";
  }

  animationDefinition(unit,state){
    return globalThis.UnitAnimationEngine?.visualDefinition?.(unit?.visualId,state)||
      this.battleVisual(unit)?.animations?.[state]||{};
  }

  animationAsset(unit,definition,state,facing){
    const animation=this.animationDefinition(unit,state),f=normalizeFacing(facing);
    return animation?.facingAssets?.[f]||animation?.asset||animation?.src||this.baseAssetForFacing(unit,definition,f);
  }

  visualSignature(unit,definition){
    return[
      unit?.visualId||"",
      definition?.kind||"CAPSULE",
      this.baseAssetForFacing(unit,definition),
      Number(definition?.width||0),
      Number(definition?.height||0),
      Number(definition?.lift||0),
      Number(unit?.collisionHeight||0),
      JSON.stringify(definition?.figure||{}),
      JSON.stringify(definition?.bird||{})
    ].join("|");
  }

  createFacingMarker(unit){
    const root=new BABYLON.TransformNode(`unit-facing-${unit.id}`,this.scene);
    const pointer=BABYLON.MeshBuilder.CreateCylinder(
      `unit-facing-pointer-${unit.id}`,
      {height:.42,diameterTop:0,diameterBottom:.22,tessellation:6},
      this.scene
    );
    pointer.parent=root;
    pointer.material=this.materials.facing;
    pointer.rotation.x=Math.PI/2;
    pointer.position.set(0,.055,.38);
    pointer.isPickable=false;
    return{root,meshes:[pointer]};
  }

  createAnimationBadge(unit){
    const root=new BABYLON.TransformNode(`unit-animation-badge-${unit.id}`,this.scene);
    const plane=BABYLON.MeshBuilder.CreatePlane(
      `unit-animation-badge-plane-${unit.id}`,
      {width:.92,height:.25,sideOrientation:BABYLON.Mesh.DOUBLESIDE},
      this.scene
    );
    plane.parent=root;
    plane.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.isPickable=false;

    const texture=new BABYLON.DynamicTexture(
      `unit-animation-badge-texture-${unit.id}`,
      {width:256,height:64},
      this.scene,
      false
    );
    texture.hasAlpha=true;

    const material=new BABYLON.StandardMaterial(`unit-animation-badge-material-${unit.id}`,this.scene);
    material.diffuseTexture=texture;
    material.opacityTexture=texture;
    material.emissiveTexture=texture;
    material.disableLighting=true;
    material.backFaceCulling=false;
    material.specularColor=BABYLON.Color3.Black();
    plane.material=material;
    root.setEnabled(false);

    return{
      root,plane,texture,material,lastText:"",
      dispose:()=>{texture.dispose();material.dispose();root.dispose();}
    };
  }

  drawAnimationBadge(badge,text){
    if(!badge||badge.lastText===text)return;
    badge.lastText=text;
    badge.texture.drawText(
      text,
      null,
      45,
      "bold 34px Arial",
      "#ffffff",
      "rgba(0,0,0,0.78)",
      true,
      true
    );
  }

  updateAnimationBadge(entry,unit,state){
    const badge=entry?.animationBadge;
    if(!badge)return;
    const show=this.animationDebug&&(state!=="IDLE"||unit?.selected===true);
    badge.root.setEnabled(show);
    if(!show)return;

    this.drawAnimationBadge(badge,state);
    const extra=entry.kind==="CAPSULE"
      ?Number(entry.height||UNIT_VISUAL_HEIGHT)/2+.42
      :Number(entry.height||UNIT_VISUAL_HEIGHT)+.42;
    badge.root.position.set(
      entry.root.position.x,
      entry.root.position.y+extra,
      entry.root.position.z
    );
  }

  createCapsule(unit){
    const height=Math.max(.35,Number(unit?.collisionHeight||UNIT_VISUAL_HEIGHT));
    const radius=Math.max(.14,Math.min(.42,height*.28));
    const mesh=BABYLON.MeshBuilder.CreateCapsule(
      `unit-${unit.id}`,
      {height,radius},
      this.scene
    );
    mesh.metadata={kind:"unit",unitId:unit.id,visualKind:"CAPSULE"};
    return{root:mesh,meshes:[mesh],kind:"CAPSULE",height,lift:0};
  }

  figureColor(value,fallback="#ffffff"){
    const raw=String(value||fallback||"#ffffff");
    try{return BABYLON.Color3.FromHexString(raw);}
    catch(_error){return BABYLON.Color3.FromHexString(fallback);}
  }

  figureMaterial(name,color){
    const key=`${name}:${String(color||"")}`;
    let material=this.figureMaterials.get(key);
    if(material)return material;
    material=new BABYLON.StandardMaterial(`figure-${name}-${this.figureMaterials.size}`,this.scene);
    material.diffuseColor=this.figureColor(color);
    material.specularColor=new BABYLON.Color3(.08,.07,.06);
    material.specularPower=12;
    material.maxSimultaneousLights=8;
    this.figureMaterials.set(key,material);
    return material;
  }

  createFigure(unit,definition){
    const figure=definition?.figure||{},colors=figure.colors||{};
    const height=Math.max(.8,Number(definition?.height||figure.height||UNIT_VISUAL_HEIGHT));
    const scale=height/1.74;
    const root=new BABYLON.TransformNode(`unit-${unit.id}`,this.scene);
    root.metadata={kind:"unit",unitId:unit.id,visualKind:"FIGURE"};
    const meshes=[];
    const figureParts={};

    const makePart=(name,pivot)=>{
      const node=new BABYLON.TransformNode(`unit-${unit.id}-${name}`,this.scene);
      node.parent=root;
      node.position.set(pivot[0]*scale,pivot[1]*scale,pivot[2]*scale);
      node.metadata={
        kind:"unit-part-root",
        unitId:unit.id,
        figurePart:name,
        figurePivot:[...pivot],
        figureBase:{
          position:node.position.clone(),
          rotation:node.rotation.clone(),
          scaling:node.scaling.clone()
        }
      };
      figureParts[name]=node;
      return node;
    };

    makePart("body",[0,.82,0]);
    makePart("head",[0,1.38,0]);
    makePart("braid",[.17,1.40,.08]);
    makePart("hairBack",[0,1.46,-.10]);
    makePart("cape",[0,1.40,-.16]);
    makePart("skirt",[0,.92,-.01]);
    makePart("leftArm",[-.235,1.33,0]);
    makePart("rightArm",[.235,1.33,0]);
    makePart("leftLeg",[-.115,.82,0]);
    makePart("rightLeg",[.115,.82,0]);
    makePart("bow",[-.46,.96,.18]);
    makePart("quiver",[.275,1.48,-.225]);
    makePart("sword",[.30,.90,-.03]);
    makePart("weapon",[.30,.90,.02]);
    makePart("leftWeapon",[-.30,.80,.05]);
    makePart("rightWeapon",[.30,.80,.05]);
    makePart("tail",[0,.88,-.17]);

    const localPoint=(partName,point)=>{
      const pivot=figureParts[partName]?.metadata?.figurePivot||[0,0,0];
      return new BABYLON.Vector3(
        (point[0]-pivot[0])*scale,
        (point[1]-pivot[1])*scale,
        (point[2]-pivot[2])*scale
      );
    };

    const material={
      skin:this.figureMaterial("skin",colors.skin||"#e9b99d"),
      hair:this.figureMaterial("hair",colors.hair||"#56372d"),
      hairDark:this.figureMaterial("hair-dark",colors.hairDark||"#3d241f"),
      cape:this.figureMaterial("cape",colors.cape||"#2d4f94"),
      capeDark:this.figureMaterial("cape-dark",colors.capeDark||"#1d356b"),
      leather:this.figureMaterial("leather",colors.leather||"#4b3025"),
      leatherDark:this.figureMaterial("leather-dark",colors.leatherDark||"#2e1d18"),
      shirt:this.figureMaterial("shirt",colors.shirt||"#e9e1d7"),
      pants:this.figureMaterial("pants",colors.pants||"#27272b"),
      boots:this.figureMaterial("boots",colors.boots||colors.leather||"#40281f"),
      metal:this.figureMaterial("metal",colors.metal||"#92745b"),
      bow:this.figureMaterial("bow",colors.bow||"#70472d"),
      eye:this.figureMaterial("eye",colors.eyes||"#4d87d9"),
      accent:this.figureMaterial("accent",colors.accent||colors.capeDark||"#7a1f2b"),
      weapon:this.figureMaterial("weapon",colors.weapon||"#d7d9df"),
      gem:this.figureMaterial("gem",colors.gem||colors.eyes||"#b52635"),
      armor:this.figureMaterial("armor",colors.armor||colors.metal||"#d7d9df"),
      gold:this.figureMaterial("gold",colors.gold||"#b58a4d"),
      tabard:this.figureMaterial("tabard",colors.tabard||colors.shirt||"#eee9df"),
      holy:this.figureMaterial("holy",colors.holy||"#ffd86a"),
      tail:this.figureMaterial("tail",colors.tail||colors.hair||"#c8b9ae"),
      tailTip:this.figureMaterial("tail-tip",colors.tailTip||colors.hairDark||"#8f7b73"),
      innerEar:this.figureMaterial("inner-ear",colors.innerEar||"#c99096"),
      dark:this.figureMaterial("dark","#1d1c20")
    };
    material.cape.backFaceCulling=false;
    material.capeDark.backFaceCulling=false;
    material.hair.backFaceCulling=false;
    material.tail.backFaceCulling=false;
    material.innerEar.backFaceCulling=false;
    material.holy.backFaceCulling=false;
    material.holy.alpha=.72;
    material.holy.emissiveColor=this.figureColor(colors.holyEmissive||colors.holy||"#ffd86a").scale(.92);
    material.holy.specularColor=this.figureColor(colors.holy||"#ffd86a");

    const finish=(mesh,mat,pos=null,rotation=null,scaling=null,{castShadow=true,part=null}={})=>{
      const parent=part?figureParts[part]||root:root;
      const pivot=parent===root?[0,0,0]:parent.metadata?.figurePivot||[0,0,0];
      mesh.parent=parent;
      mesh.material=mat;
      mesh.isPickable=false;
      mesh.receiveShadows=true;
      mesh.metadata={...(mesh.metadata||{}),kind:"unit-part",unitId:unit.id,figurePart:part,castShadow};
      if(pos)mesh.position.set(
        (pos[0]-pivot[0])*scale,
        (pos[1]-pivot[1])*scale,
        (pos[2]-pivot[2])*scale
      );
      if(rotation)mesh.rotation.set(rotation[0],rotation[1],rotation[2]);
      if(scaling)mesh.scaling.set(scaling[0],scaling[1],scaling[2]);
      meshes.push(mesh);
      return mesh;
    };
    const sphere=(name,diameter,mat,pos,scaling=null,segments=6,part=null)=>finish(
      BABYLON.MeshBuilder.CreateSphere(`${name}-${unit.id}`,{diameter:diameter*scale,segments},this.scene),
      mat,pos,null,scaling,{part}
    );
    const box=(name,size,mat,pos,rotation=null,part=null)=>finish(
      BABYLON.MeshBuilder.CreateBox(`${name}-${unit.id}`,{width:size[0]*scale,height:size[1]*scale,depth:size[2]*scale},this.scene),
      mat,pos,rotation,null,{part}
    );
    const cylinder=(name,heightValue,top,bottom,mat,pos,rotation=null,tessellation=6,part=null)=>finish(
      BABYLON.MeshBuilder.CreateCylinder(`${name}-${unit.id}`,{
        height:heightValue*scale,diameterTop:top*scale,diameterBottom:bottom*scale,tessellation
      },this.scene),
      mat,pos,rotation,null,{part}
    );
    const custom=(name,points,indices,mat,part=null)=>{
      const mesh=new BABYLON.Mesh(`${name}-${unit.id}`,this.scene);
      const positions=[];
      const pivot=part?figureParts[part]?.metadata?.figurePivot||[0,0,0]:[0,0,0];
      for(const point of points)positions.push(
        (point[0]-pivot[0])*scale,
        (point[1]-pivot[1])*scale,
        (point[2]-pivot[2])*scale
      );
      const normals=[];BABYLON.VertexData.ComputeNormals(positions,indices,normals);
      const data=new BABYLON.VertexData();data.positions=positions;data.indices=indices;data.normals=normals;data.applyToMesh(mesh);
      return finish(mesh,mat,null,null,null,{part});
    };

    // Head: keep the face simple, spend geometry on silhouette instead of features.
    sphere("figure-head",.33,material.skin,[0,1.54,.015],[.92,1.02,.88],6,"head");
    sphere("figure-hair-cap",.36,material.hair,[0,1.615,-.025],[1.03,.78,.98],6,"head");
    sphere("figure-hair-back",.30,material.hairDark,[0,1.46,-.12],[1.08,1.65,.76],5,"head");

    // Angular fringe and side locks make the head read as hair rather than a helmet.
    box("figure-bang-l",[.07,.24,.055],material.hair,[-.085,1.57,.145],[.18,0,-.28],"head");
    box("figure-bang-c",[.06,.22,.05],material.hair,[0,1.575,.155],[.12,0,.06],"head");
    box("figure-bang-r",[.065,.23,.052],material.hair,[.075,1.565,.145],[.18,0,.26],"head");
    box("figure-side-lock-l",[.055,.36,.06],material.hair,[-.165,1.43,.035],[0,0,-.10],"head");
    box("figure-side-lock-r",[.055,.31,.06],material.hair,[.165,1.45,.035],[0,0,.13],"head");

    if(figure.braid!==false){
      for(let i=0;i<6;i++){
        const t=i/5,offset=Math.sin(t*Math.PI)*.018;
        cylinder(`figure-braid-${i}`,.12,.105-i*.006,.115-i*.006,material.hair,[.17+offset,1.34-t*.61,.09+t*.018],[0,0,-.18],6,"braid");
      }
      cylinder("figure-braid-tie",.055,.075,.075,material.leather,[.17,.71,.11],[0,0,-.18],6,"braid");
    }

    // Minimal anime face cue: two blue eye dots only.
    sphere("figure-eye-l",.032,material.eye,[-.055,1.545,.158],[1,.62,.40],4,"head");
    sphere("figure-eye-r",.032,material.eye,[.055,1.545,.158],[1,.62,.40],4,"head");

    if(figure.pointedEars){
      custom("figure-ear-l",[[-.155,1.57,.02],[-.33,1.60,.015],[-.165,1.48,.025]],[0,1,2],material.skin,"head");
      custom("figure-ear-r",[[.155,1.57,.02],[.33,1.60,.015],[.165,1.48,.025]],[0,2,1],material.skin,"head");
    }

    if(figure.catEars){
      custom("figure-cat-ear-l",[[-.18,1.67,-.015],[-.10,1.88,-.02],[-.02,1.67,-.015]],[0,1,2],material.hair,"head");
      custom("figure-cat-ear-r",[[.02,1.67,-.015],[.10,1.88,-.02],[.18,1.67,-.015]],[0,1,2],material.hair,"head");
      custom("figure-cat-ear-inner-l",[[-.145,1.69,.01],[-.10,1.82,.005],[-.055,1.69,.01]],[0,1,2],material.innerEar,"head");
      custom("figure-cat-ear-inner-r",[[.055,1.69,.01],[.10,1.82,.005],[.145,1.69,.01]],[0,1,2],material.innerEar,"head");
      box("figure-cat-ear-ribbon-l",[.085,.045,.035],material.accent,[-.17,1.68,.055],[.06,0,-.20],"head");
      box("figure-cat-ear-ribbon-r",[.085,.045,.035],material.accent,[.17,1.68,.055],[-.06,0,.20],"head");
    }

    if(figure.midHair){
      const xs=[-.20,-.10,0,.10,.20];
      for(let i=0;i<xs.length;i++){
        const x=xs[i],outer=Math.abs(x)>.15;
        cylinder(`figure-mid-hair-${i}`,outer?.46:.54,.07,.10,material.hairDark,[x,1.27,-.14],[0,0,x*.30],6,"hairBack");
      }
    }

    if(figure.longHair){
      const strandX=[-.24,-.14,-.05,.05,.14,.24];
      for(let i=0;i<strandX.length;i++){
        const x=strandX[i],outer=Math.abs(x)>.18;
        cylinder(`figure-long-hair-${i}`,outer?.78:.88,.075,.11,material.hairDark,[x,1.08,-.15],[0,0,x*.32],6,"hairBack");
      }
      box("figure-long-hair-back",[.46,.52,.10],material.hair,[0,1.22,-.145],[.10,0,0],"hairBack");
    }
    if(figure.hairRibbon){
      box("figure-hair-ribbon-knot",[.15,.10,.08],material.accent,[-.19,1.54,-.10],[0,.18,.12],"hairBack");
      box("figure-hair-ribbon-tail-a",[.065,.40,.035],material.accent,[-.23,1.32,-.12],[.18,0,.15],"hairBack");
      box("figure-hair-ribbon-tail-b",[.065,.36,.035],material.accent,[-.13,1.34,-.13],[-.12,0,-.10],"hairBack");
    }

    if(figure.hood){
      const hood=BABYLON.MeshBuilder.CreateTorus(`figure-hood-${unit.id}`,{diameter:.43*scale,thickness:.085*scale,tessellation:12},this.scene);
      finish(hood,material.cape,[0,1.46,-.13],[Math.PI/2,0,0],[1.08,.84,.68],{part:"cape"});
      box("figure-hood-fold",[.40,.16,.12],material.capeDark,[0,1.35,-.15],[.12,0,0],"cape");
    }

    // Tapered torso gives a readable shoulder/waist silhouette at tactical zoom.
    const cropped=figure.croppedTop===true;
    cylinder("figure-blouse",cropped?.30:.43,.43,.31,material.shirt,[0,cropped?1.24:1.17,0],null,6,"body");
    cylinder("figure-vest",cropped?.27:.36,.38,.29,material.leather,[0,cropped?1.235:1.15,.018],null,6,"body");
    if(cropped)cylinder("figure-midriff",.18,.30,.29,material.skin,[0,1.01,.015],null,7,"body");
    cylinder("figure-waist",.16,.29,.34,material.leatherDark,[0,.94,.005],null,6,"body");
    box("figure-belt",[.44,.07,.27],material.leather,[0,.96,.015],null,"body");
    box("figure-buckle",[.068,.064,.035],material.metal,[0,.96,.16],null,"body");
    box("figure-pouch",[.13,.16,.08],material.leather,[.20,.87,.12],[0,.08,.04],"body");
    sphere("figure-clasp",.075,material.metal,[-.19,1.36,.11],[1,.70,.45],5,"body");

    if(figure.thiefGear){
      box("figure-thief-cross-strap-a",[.055,.58,.035],material.leatherDark,[-.075,1.17,.16],[0,0,-.48],"body");
      box("figure-thief-cross-strap-b",[.055,.54,.035],material.leather,[.09,1.16,.165],[0,0,.48],"body");
      box("figure-thief-belt-low",[.48,.055,.285],material.leatherDark,[0,.875,.02],[0,0,.04],"body");
      box("figure-thief-pouch-l",[.14,.18,.09],material.leather,[-.24,.82,.08],[0,.08,-.05],"body");
      box("figure-thief-pouch-r",[.13,.16,.08],material.leather,[.24,.84,.07],[0,-.08,.05],"body");
      sphere("figure-thief-charm",.055,material.gem,[.13,.88,.17],[.70,1.05,.42],5,"body");
    }

    if(figure.heavyArmor){
      cylinder("figure-chest-plate",.38,.42,.34,material.armor,[0,1.18,.025],null,8,"body");
      box("figure-chest-gold-trim",[.31,.055,.305],material.gold,[0,1.24,.08],null,"body");
      sphere("figure-pauldron-l",.27,material.armor,[-.285,1.31,-.005],[1.18,.62,1.02],6,"leftArm");
      sphere("figure-pauldron-r",.27,material.armor,[.285,1.31,-.005],[1.18,.62,1.02],6,"rightArm");
      box("figure-pauldron-gold-l",[.17,.035,.19],material.gold,[-.31,1.34,.025],[0,0,-.12],"leftArm");
      box("figure-pauldron-gold-r",[.17,.035,.19],material.gold,[.31,1.34,.025],[0,0,.12],"rightArm");
    }

    // Sleeves taper into bracers; the slight angles stop the arms looking like rails.
    cylinder("figure-upper-arm-l",.30,.14,.12,material.shirt,[-.265,1.20,0],[0,0,-.13],6,"leftArm");
    cylinder("figure-upper-arm-r",.30,.14,.12,material.shirt,[.265,1.20,0],[0,0,.13],6,"rightArm");
    cylinder("figure-forearm-l",.27,.115,.095,material.leather,[-.295,.94,.035],[0,0,-.05],6,"leftArm");
    cylinder("figure-forearm-r",.27,.115,.095,material.leather,[.295,.94,.035],[0,0,.05],6,"rightArm");
    box("figure-glove-l",[.105,.12,.115],material.dark,[-.305,.755,.055],[0,0,-.03],"leftArm");
    box("figure-glove-r",[.105,.12,.115],material.dark,[.305,.755,.055],[0,0,.03],"rightArm");
    sphere("figure-fingers-l",.075,material.skin,[-.307,.70,.070],[.72,.65,.72],4,"leftArm");
    sphere("figure-fingers-r",.075,material.skin,[.307,.70,.070],[.72,.65,.72],4,"rightArm");
    if(figure.heavyArmor){
      cylinder("figure-vambrace-l",.29,.135,.115,material.armor,[-.298,.93,.035],[0,0,-.05],7,"leftArm");
      cylinder("figure-vambrace-r",.29,.135,.115,material.armor,[.298,.93,.035],[0,0,.05],7,"rightArm");
      box("figure-gauntlet-l",[.125,.13,.13],material.armor,[-.307,.755,.060],[0,0,-.03],"leftArm");
      box("figure-gauntlet-r",[.125,.13,.13],material.armor,[.307,.755,.060],[0,0,.03],"rightArm");
    }

    // Hips, thighs, knees and lower legs are separate to make the stance human-shaped.
    const asymmetric=figure.asymmetricLegwear===true;
    const leftThighMaterial=asymmetric?material.skin:material.pants;
    const rightThighMaterial=material.pants;
    const leftShinMaterial=asymmetric?material.skin:material.pants;
    const rightShinMaterial=material.pants;
    cylinder("figure-hips",.18,.33,.36,material.pants,[0,.82,0],null,6,"body");
    cylinder("figure-thigh-l",.38,.17,.145,leftThighMaterial,[-.115,.66,0],[0,0,.018],6,"leftLeg");
    cylinder("figure-thigh-r",.38,.17,.145,rightThighMaterial,[.115,.66,0],[0,0,-.018],6,"rightLeg");
    cylinder("figure-shin-l",.34,.135,.115,leftShinMaterial,[-.115,.36,.008],[0,0,.014],6,"leftLeg");
    cylinder("figure-shin-r",.34,.135,.115,rightShinMaterial,[.115,.36,.008],[0,0,-.014],6,"rightLeg");
    box("figure-boot-shaft-l",[.18,.29,.20],material.boots,[-.115,.245,.025],null,"leftLeg");
    box("figure-boot-shaft-r",[.18,.29,.20],material.boots,[.115,.245,.025],null,"rightLeg");
    box("figure-boot-foot-l",[.19,.11,.31],material.boots,[-.115,.075,.075],[-.03,0,0],"leftLeg");
    box("figure-boot-foot-r",[.19,.11,.31],material.boots,[.115,.075,.075],[-.03,0,0],"rightLeg");
    box("figure-boot-cuff-l",[.205,.07,.215],material.leather,[-.115,.37,.025],[0,0,.02],"leftLeg");
    box("figure-boot-cuff-r",[.205,.07,.215],material.leather,[.115,.37,.025],[0,0,-.02],"rightLeg");
    if(figure.thiefGear){
      box("figure-thigh-strap-l",[.21,.055,.19],material.leatherDark,[-.115,.68,.015],[0,0,.02],"leftLeg");
      box("figure-thigh-strap-r",[.21,.055,.19],material.leather,[.115,.61,.015],[0,0,-.02],"rightLeg");
      box("figure-thigh-knife-sheath",[.055,.27,.055],material.leatherDark,[.205,.57,.04],[0,0,-.12],"rightLeg");
    }
    if(figure.heavyArmor){
      box("figure-greave-l",[.205,.42,.215],material.armor,[-.115,.29,.02],[0,0,.02],"leftLeg");
      box("figure-greave-r",[.205,.42,.215],material.armor,[.115,.29,.02],[0,0,-.02],"rightLeg");
      sphere("figure-knee-l",.18,material.gold,[-.115,.49,.105],[1,.62,.46],5,"leftLeg");
      sphere("figure-knee-r",.18,material.gold,[.115,.49,.105],[1,.62,.46],5,"rightLeg");
      box("figure-sabatons-l",[.21,.115,.33],material.armor,[-.115,.075,.08],[-.03,0,0],"leftLeg");
      box("figure-sabatons-r",[.21,.115,.33],material.armor,[.115,.075,.08],[-.03,0,0],"rightLeg");
    }

    // Multi-fold cloak: 15 vertices / 16 triangles, still cheap but much less flat.
    if(figure.cape!==false){
      const xs=[-.34,-.17,0,.17,.34];
      const topZ=[-.13,-.18,-.21,-.18,-.13],midZ=[-.15,-.25,-.31,-.25,-.15],botZ=[-.10,-.24,-.36,-.24,-.10];
      const points=[];
      for(let i=0;i<5;i++)points.push([xs[i],1.43,topZ[i]]);
      for(let i=0;i<5;i++)points.push([xs[i]*(1.20),.94,midZ[i]]);
      for(let i=0;i<5;i++)points.push([xs[i]*(1.48),.27+(i%2)*.035,botZ[i]]);
      const indices=[];
      for(let row=0;row<2;row++)for(let i=0;i<4;i++){
        const a=row*5+i,b=a+1,c=a+5,d=c+1;
        indices.push(a,c,b,b,c,d);
      }
      custom("figure-cloak",points,indices,material.cape,"cape");
      box("figure-cape-collar-l",[.24,.10,.12],material.cape,[-.18,1.38,-.04],[0,.10,.04],"cape");
      box("figure-cape-collar-r",[.24,.10,.12],material.cape,[.18,1.38,-.04],[0,-.10,-.04],"cape");
      custom("figure-cape-fold",[[0,1.40,-.225],[-.055,.40,-.355],[.055,.40,-.355]],[0,1,2],material.capeDark,"cape");
    }

    // Quiver and visible arrow tips/fletching.
    if(figure.quiver!==false){
      cylinder("figure-quiver",.56,.14,.18,material.leather,[.275,1.18,-.225],[0,0,-.20],6,"quiver");
      for(let i=0;i<3;i++){
        cylinder(`figure-arrow-${i}`,.53,.017,.017,material.bow,[.22+i*.045,1.43,-.225],[0,0,-.20],5,"quiver");
        box(`figure-fletching-${i}`,[.045,.065,.018],material.cape,[.17+i*.045,1.65,-.225],[0,0,-.20],"quiver");
      }
    }

    // Recurve bow silhouette with a grip and taut string.
    if(figure.bow!==false){
      const path=[];
      for(let i=0;i<=12;i++){
        const t=i/12,y=.39+t*1.14;
        const bend=.19*Math.sin(t*Math.PI)+.035*Math.sin(t*Math.PI*3);
        path.push(localPoint("bow",[-.46-bend,y,.18]));
      }
      const bow=BABYLON.MeshBuilder.CreateTube(`figure-bow-${unit.id}`,{path,radius:.018*scale,tessellation:6,cap:BABYLON.Mesh.CAP_ALL},this.scene);
      finish(bow,material.bow,null,null,null,{part:"bow"});
      cylinder("figure-bow-grip",.16,.055,.055,material.leather,[-.46,.96,.18],[0,0,0],6,"bow");
      const string=BABYLON.MeshBuilder.CreateLines(`figure-bow-string-${unit.id}`,{
        points:[path[0],localPoint("bow",[-.46,.96,.18]),path[path.length-1]]
      },this.scene);
      string.parent=figureParts.bow;string.color=this.figureColor(colors.bowString||"#d9c6a7");string.isPickable=false;
      string.metadata={kind:"unit-part",unitId:unit.id,figurePart:"bow",castShadow:false,lineOnly:true};meshes.push(string);
    }

    // Side sword and pommel, kept simple because it is secondary equipment.
    if(figure.sideSword!==false){
      box("figure-side-sword",[.065,.66,.055],material.dark,[.345,.59,-.045],[0,0,-.13],"sword");
      box("figure-side-guard",[.15,.035,.065],material.metal,[.30,.88,-.035],[0,0,-.13],"sword");
      cylinder("figure-side-pommel",.12,.055,.055,material.leather,[.27,.95,-.03],[0,0,-.13],6,"sword");
    }

    if(figure.skirtPanels){
      const panel=(name,x,z,mat)=>custom(name,[
        [x-.12,.94,z],[x+.12,.94,z],[x+.17,.38,z+.025],[x-.17,.38,z+.025]
      ],[0,2,1,0,3,2],mat,"skirt");
      panel("figure-skirt-front",0,.13,material.accent);
      panel("figure-skirt-left",-.20,-.02,material.cape);
      panel("figure-skirt-right",.20,-.02,material.cape);
      panel("figure-skirt-back",0,-.15,material.capeDark);
    }

    if(figure.royalTabard){
      custom("figure-tabard-front",[[-.16,.98,.155],[.16,.98,.155],[.20,.28,.13],[-.20,.28,.13]],[0,2,1,0,3,2],material.tabard,"skirt");
      custom("figure-tabard-back",[[-.17,.96,-.17],[.17,.96,-.17],[.23,.22,-.16],[-.23,.22,-.16]],[0,1,2,0,2,3],material.cape,"skirt");
      box("figure-tabard-gold",[.055,.60,.025],material.gold,[0,.62,.17],null,"skirt");
    }

    if(figure.catTail){
      const tailPath=[[0,.88,-.17],[-.18,.82,-.22],[-.36,.92,-.28],[-.43,1.10,-.27],[-.31,1.27,-.22],[-.12,1.31,-.18]].map(point=>localPoint("tail",point));
      const tailMesh=BABYLON.MeshBuilder.CreateTube(`figure-cat-tail-${unit.id}`,{path:tailPath,radius:.060*scale,tessellation:7,cap:BABYLON.Mesh.CAP_ALL},this.scene);
      finish(tailMesh,material.tail,null,null,null,{part:"tail"});
      sphere("figure-cat-tail-tip",.15,material.tailTip,[-.12,1.31,-.18],[1.0,.78,.78],6,"tail");
    }

    if(figure.dualDaggers){
      const dagger=(side,part,x)=>{
        box(`figure-dagger-blade-${side}`,[.060,.34,.035],material.weapon,[x,.59,.075],[0,0,side==="l"?.10:-.10],part);
        box(`figure-dagger-guard-${side}`,[.16,.035,.060],material.metal,[x,.76,.075],[0,0,0],part);
        cylinder(`figure-dagger-grip-${side}`,.15,.045,.045,material.leather,[x,.855,.075],[0,0,0],6,part);
        sphere(`figure-dagger-gem-${side}`,.050,material.gem,[x,.945,.075],[.75,.75,.55],5,part);
      };
      dagger("l","leftWeapon",-.30);
      dagger("r","rightWeapon",.30);
    }

    if(figure.rapier){
      cylinder("figure-rapier-blade",.92,.018,.032,material.weapon,[.33,.43,.08],[0,0,-.05],7,"weapon");
      const guard=BABYLON.MeshBuilder.CreateTorus(`figure-rapier-guard-${unit.id}`,{diameter:.18*scale,thickness:.018*scale,tessellation:12},this.scene);
      finish(guard,material.metal,[.305,.89,.075],[Math.PI/2,0,0],null,{part:"weapon"});
      cylinder("figure-rapier-grip",.16,.045,.045,material.leather,[.29,.98,.07],[0,0,-.05],7,"weapon");
      sphere("figure-rapier-gem",.055,material.gem,[.285,1.075,.07],[.75,.75,.75],5,"weapon");
    }

    if(figure.greatsword){
      box("figure-greatsword-blade",[.115,1.10,.050],material.weapon,[.31,.47,.075],[0,0,-.04],"weapon");
      box("figure-greatsword-core",[.036,.96,.058],material.holy,[.31,.50,.075],[0,0,-.04],"weapon");
      box("figure-greatsword-guard",[.38,.055,.085],material.gold,[.285,1.00,.075],[0,0,-.04],"weapon");
      cylinder("figure-greatsword-grip",.25,.052,.052,material.leather,[.275,1.145,.075],[0,0,-.04],8,"weapon");
      sphere("figure-greatsword-pommel",.085,material.gold,[.27,1.295,.075],[.85,.85,.85],6,"weapon");
      sphere("figure-greatsword-gem",.070,material.holy,[.285,.995,.105],[.72,.72,.42],6,"weapon");
      const aura=BABYLON.MeshBuilder.CreateTorus(`figure-greatsword-aura-${unit.id}`,{diameter:.34*scale,thickness:.018*scale,tessellation:18},this.scene);
      finish(aura,material.holy,[.30,.72,.075],[Math.PI/2,0,0],null,{part:"weapon",castShadow:false});
    }

    // Keep FIGURE parts under the character root. Merging child meshes that already
    // inherit the root transform can bake parent/world transforms differently across
    // WebGL implementations and make the whole figure disappear after re-parenting.
    // The visual prototype stays unmerged until a parent-safe batching path is added.
    return{root,meshes,figureParts,kind:"FIGURE",height,lift:Number(definition?.lift||0)};
  }

  createBird(unit,definition){
    const bird=definition?.bird||{},colors=bird.colors||{};
    const height=Math.max(.35,Number(definition?.height||bird.height||.72)),scale=height/.72;
    const root=new BABYLON.TransformNode(`unit-${unit.id}`,this.scene);
    root.metadata={kind:"unit",unitId:unit.id,visualKind:"BIRD"};
    const meshes=[],birdParts={};
    const makePart=(name,pivot)=>{
      const node=new BABYLON.TransformNode(`unit-${unit.id}-${name}`,this.scene);
      node.parent=root;node.position.set(pivot[0]*scale,pivot[1]*scale,pivot[2]*scale);
      node.metadata={kind:"unit-part-root",unitId:unit.id,birdPart:name,birdBase:{position:node.position.clone(),rotation:node.rotation.clone(),scaling:node.scaling.clone()}};
      birdParts[name]=node;return node;
    };
    makePart("body",[0,.32,0]);makePart("head",[0,.49,.10]);makePart("leftWing",[-.12,.36,0]);makePart("rightWing",[.12,.36,0]);makePart("tail",[0,.27,-.15]);
    const bodyMat=this.figureMaterial("bird-body",colors.body||"#65452f"),wingMat=this.figureMaterial("bird-wing",colors.wing||"#4b3326"),lightMat=this.figureMaterial("bird-light",colors.light||"#d8c6a1"),beakMat=this.figureMaterial("bird-beak",colors.beak||"#c89534"),eyeMat=this.figureMaterial("bird-eye",colors.eyes||"#d3a42e");
    const finish=(mesh,mat,part,pos=null,rotation=null,scaling=null)=>{
      const node=birdParts[part]||root;mesh.parent=node;mesh.material=mat;mesh.isPickable=false;mesh.receiveShadows=true;
      const pivot=part==="body"?[0,.32,0]:part==="head"?[0,.49,.10]:part==="leftWing"?[-.12,.36,0]:part==="rightWing"?[.12,.36,0]:[0,.27,-.15];
      if(pos)mesh.position.set((pos[0]-pivot[0])*scale,(pos[1]-pivot[1])*scale,(pos[2]-pivot[2])*scale);
      if(rotation)mesh.rotation.set(...rotation);if(scaling)mesh.scaling.set(...scaling);
      mesh.metadata={kind:"unit-part",unitId:unit.id,birdPart:part,castShadow:true};meshes.push(mesh);return mesh;
    };
    const sphere=(name,d,mat,part,pos,scaling)=>finish(BABYLON.MeshBuilder.CreateSphere(`${name}-${unit.id}`,{diameter:d*scale,segments:6},this.scene),mat,part,pos,null,scaling);
    sphere("bird-body",.34,bodyMat,"body",[0,.32,0],[1,1.05,1.25]);
    sphere("bird-chest",.22,lightMat,"body",[0,.34,.12],[.82,1.05,.72]);
    sphere("bird-head",.20,bodyMat,"head",[0,.50,.11],[1,.95,1]);
    const beak=BABYLON.MeshBuilder.CreateCylinder(`bird-beak-${unit.id}`,{height:.16*scale,diameterTop:0,diameterBottom:.09*scale,tessellation:6},this.scene);
    finish(beak,beakMat,"head",[0,.48,.245],[Math.PI/2,0,0]);
    sphere("bird-eye-l",.035,eyeMat,"head",[-.065,.525,.18],[.7,.7,.55]);sphere("bird-eye-r",.035,eyeMat,"head",[.065,.525,.18],[.7,.7,.55]);
    const wing=(name,part,sign)=>{
      const mesh=new BABYLON.Mesh(`${name}-${unit.id}`,this.scene),positions=[0,0,0,sign*.34*scale,.015*scale,-.02*scale,sign*.52*scale,-.02*scale,-.08*scale,sign*.30*scale,-.04*scale,.07*scale],indices=[0,1,2,0,2,3],normals=[];
      BABYLON.VertexData.ComputeNormals(positions,indices,normals);const data=new BABYLON.VertexData();Object.assign(data,{positions,indices,normals});data.applyToMesh(mesh);
      finish(mesh,wingMat,part);return mesh;
    };
    wing("bird-wing-l","leftWing",-1);wing("bird-wing-r","rightWing",1);
    const tail=BABYLON.MeshBuilder.CreateBox(`bird-tail-${unit.id}`,{width:.22*scale,height:.055*scale,depth:.34*scale},this.scene);finish(tail,wingMat,"tail",[0,.26,-.29],[.08,0,0]);
    return{root,meshes,birdParts,kind:"BIRD",height,lift:Number(definition?.lift||0)};
  }

  createVerticalCue(unit){
    const ring=BABYLON.MeshBuilder.CreateTorus(
      `unit-vertical-cue-${unit.id}`,
      {diameter:.78,thickness:.045,tessellation:28},
      this.scene
    );
    const stem=BABYLON.MeshBuilder.CreateCylinder(
      `unit-vertical-stem-${unit.id}`,
      {height:1,diameter:.045,tessellation:10},
      this.scene
    );
    ring.isPickable=false;stem.isPickable=false;
    ring.setEnabled(false);stem.setEnabled(false);
    return{
      ring,stem,
      dispose:()=>{ring.dispose();stem.dispose();}
    };
  }

  updateVerticalCue(entry,unit){
    const cue=entry?.verticalCue;if(!cue)return;
    const mode=String(unit?.verticalMode||"");
    const visible=mode==="DIVING"||mode==="FLYING";
    cue.ring.setEnabled(visible);cue.stem.setEnabled(false);
    if(!visible)return;
    const material=mode==="DIVING"?this.materials.submerged:this.materials.airborne;
    const surfaceWorld=Number(unit.verticalSurfaceZ??unit.renderZ??unit.z??0)*ELEVATION_HEIGHT;
    const unitWorld=Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT;
    cue.ring.material=material;cue.stem.material=material;
    cue.ring.position.set(Number(unit.x||0)*TILE_SIZE,surfaceWorld+.055,Number(unit.y||0)*TILE_SIZE);
    cue.ring.scaling.setAll(mode==="DIVING"?1.06:.88);
    const span=unitWorld-surfaceWorld;
    if(Math.abs(span)>.08){
      cue.stem.setEnabled(true);
      cue.stem.position.set(Number(unit.x||0)*TILE_SIZE,surfaceWorld+span/2,Number(unit.y||0)*TILE_SIZE);
      cue.stem.scaling.set(1,Math.abs(span),1);
    }
  }

  createBillboard(unit,definition){
    const asset=this.baseAssetForFacing(unit,definition);
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
      plane,
      texture,
      currentAsset:asset,
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
      :kind==="FIGURE"
        ?this.createFigure(unit,definition)
        :kind==="BIRD"
          ?this.createBird(unit,definition)
          :this.createCapsule(unit);
    const facingMarker=this.createFacingMarker(unit);
    const animationBadge=this.createAnimationBadge(unit);
    const verticalCue=this.createVerticalCue(unit);
    const entry={
      ...visual,signature,facingMarker,animationBadge,verticalCue,definition,lastUnit:{...unit},baseScale:1,
      basePosition:new BABYLON.Vector3(0,0,0),baseMarkerPosition:new BABYLON.Vector3(0,0,0)
    };
    this.entries.set(unit.id,entry);
    this.meshes.set(unit.id,entry.root);
    return entry;
  }

  disposeEntry(id){
    const entry=this.entries.get(id);
    if(!entry)return;
    entry.dispose?.();
    entry.animationBadge?.dispose?.();
    entry.verticalCue?.dispose?.();
    entry.facingMarker?.root?.dispose?.();
    entry.root?.dispose?.();
    this.entries.delete(id);
    this.meshes.delete(id);
    this.animationQueues.delete(id);
    this.activeAnimations.delete(id);
  }

  setVisibility(entry,value){
    for(const mesh of entry?.meshes||[])mesh.visibility=value;
    for(const mesh of entry?.facingMarker?.meshes||[])mesh.visibility=value;
  }

  applyFacing(entry,unit,definition,facingOverride=null,animationState="IDLE"){
    const facing=normalizeFacing(facingOverride??unit?.facing),angle=FACING_ANGLE[facing];
    entry.facingMarker.root.rotation.y=angle;
    if(entry.kind!=="BILLBOARD")entry.root.rotation.y=angle;

    const animation=this.animationDefinition(unit,animationState);
    const ownsFacing=!!(animation?.facingAssets||definition?.facingAssets);
    if(entry.kind==="BILLBOARD"&&entry.plane){
      if(ownsFacing){entry.plane.scaling.x=1;return;}
      const base=String(definition?.baseFacing||"E").toUpperCase();
      if(facing==="E"||facing==="W"){
        const eastSign=base==="W"?-1:1;
        entry.plane.scaling.x=facing==="E"?eastSign:-eastSign;
      }else{
        entry.plane.scaling.x=base==="W"?-1:1;
      }
    }
  }

  setBillboardAsset(entry,unit,state,facing,progress=0){
    if(entry.kind!=="BILLBOARD"||!entry.texture)return;
    const animation=this.animationDefinition(unit,state),asset=this.animationAsset(unit,entry.definition,state,facing);
    if(asset&&asset!==entry.currentAsset){
      entry.texture.updateURL(asset);
      entry.currentAsset=asset;
    }

    const sheet=animation?.sheet;
    if(!sheet){
      entry.texture.uScale=1;entry.texture.vScale=1;entry.texture.uOffset=0;entry.texture.vOffset=0;
      return;
    }
    const columns=Math.max(1,Number(sheet.columns||1)),rows=Math.max(1,Number(sheet.rows||1));
    const frames=Array.isArray(sheet.frames)&&sheet.frames.length?sheet.frames:Array.from({length:columns*rows},(_,i)=>i);
    const loop=animation?.loop===true;
    const raw=loop?Math.floor((performance.now()/1000)*Number(sheet.fps||animation.fps||8)):Math.min(frames.length-1,Math.floor(clamp01(progress)*frames.length));
    const frame=Number(frames[raw%frames.length]||0),col=frame%columns,row=Math.floor(frame/columns)%rows;
    entry.texture.uScale=1/columns;entry.texture.vScale=1/rows;
    entry.texture.uOffset=col/columns;entry.texture.vOffset=row/rows;
  }

  enqueueEvents(events=[]){
    for(const event of events||[]){
      if(event?.type!=="UNIT_ANIMATION"||!event.unitId)continue;
      const id=String(event.unitId),queue=this.animationQueues.get(id)||[];
      if(event.state==="DEATH")queue.splice(0);
      queue.push({...event});
      this.animationQueues.set(id,queue);
    }
  }

  hasDeathPending(id){
    if(this.activeAnimations.get(id)?.event?.state==="DEATH")return true;
    return (this.animationQueues.get(id)||[]).some(event=>event.state==="DEATH");
  }

  debugDuration(event){
    const raw=Math.max(1,Number(event?.duration||300));
    if(!this.animationDebug)return raw;
    return Math.max(raw,Number(DEBUG_MIN_DURATION[event?.state]||0));
  }

  startNext(id,now){
    if(this.activeAnimations.has(id))return this.activeAnimations.get(id);
    const queue=this.animationQueues.get(id)||[];
    if(!queue.length)return null;
    const event=queue.shift();
    if(!queue.length)this.animationQueues.delete(id);
    const active={event,startedAt:now,duration:this.debugDuration(event)};
    this.activeAnimations.set(id,active);
    return active;
  }

  positionFor(entry,point){
    const x=Number(point?.x||0)*TILE_SIZE,z=Number(point?.y||0)*TILE_SIZE;
    const baseY=Number(point?.renderZ??point?.z??0)*ELEVATION_HEIGHT,lift=Number(entry.lift||0);
    const y=entry.kind==="CAPSULE"?baseY+entry.height/2+lift:baseY+lift;
    return new BABYLON.Vector3(x,y,z);
  }

  markerPositionFor(point){
    return new BABYLON.Vector3(Number(point?.x||0)*TILE_SIZE,Number(point?.renderZ??point?.z??0)*ELEVATION_HEIGHT,Number(point?.y||0)*TILE_SIZE);
  }

  resetPose(entry,unit){
    entry.root.position.copyFrom(entry.basePosition);
    entry.facingMarker.root.position.copyFrom(entry.baseMarkerPosition);
    entry.root.rotation.z=0;
    entry.root.scaling.setAll(entry.baseScale);
    if(entry.plane)entry.plane.rotation.z=0;
    for(const node of Object.values(entry.figureParts||{})){
      const base=node?.metadata?.figureBase;
      if(!base)continue;
      node.position.copyFrom(base.position);
      node.rotation.copyFrom(base.rotation);
      node.scaling.copyFrom(base.scaling);
    }
    for(const node of Object.values(entry.birdParts||{})){
      const base=node?.metadata?.birdBase;
      if(!base)continue;
      node.position.copyFrom(base.position);
      node.rotation.copyFrom(base.rotation);
      node.scaling.copyFrom(base.scaling);
    }
    this.applyFacing(entry,unit,entry.definition,null,"IDLE");
  }

  applyFigureWalk(entry,definition,local){
    const parts=entry.figureParts;
    if(entry.kind!=="FIGURE"||!parts)return;

    const motion=definition?.figureMotion||{};
    const cycle=local*Math.PI*2;
    const stride=Math.sin(cycle);
    const followLag=Number(motion.followLag??.65);
    const capeFollow=Math.sin(cycle-followLag);
    const braidFollow=Math.sin(cycle-followLag*.82);

    const legSwing=Number(motion.legSwing??.50);
    const armSwing=Number(motion.armSwing??.34);
    const bowSwing=Number(motion.bowSwing??armSwing*.78);
    const bodySway=Number(motion.bodySway??.025);
    const torsoBob=Number(motion.torsoBob??.018);
    const capeSwing=Number(motion.capeSwing??.11);
    const capeTwist=Number(motion.capeTwist??.045);
    const braidSwing=Number(motion.braidSwing??.16);
    const braidTwist=Number(motion.braidTwist??.07);

    if(parts.leftLeg)parts.leftLeg.rotation.x+=stride*legSwing;
    if(parts.rightLeg)parts.rightLeg.rotation.x-=stride*legSwing;
    if(parts.leftArm)parts.leftArm.rotation.x-=stride*armSwing;
    if(parts.rightArm)parts.rightArm.rotation.x+=stride*armSwing;
    if(parts.bow)parts.bow.rotation.x-=stride*bowSwing;

    if(parts.body){
      parts.body.rotation.z+=stride*bodySway;
      parts.body.position.y+=Math.abs(stride)*torsoBob;
    }
    if(parts.cape){
      parts.cape.rotation.x+=capeFollow*capeSwing;
      parts.cape.rotation.z+=Math.sin(cycle-followLag*.55)*capeTwist;
    }
    if(parts.braid){
      parts.braid.rotation.x+=braidFollow*braidSwing;
      parts.braid.rotation.z+=Math.sin(cycle-followLag*1.15)*braidTwist;
    }
    if(parts.hairBack){
      parts.hairBack.rotation.x+=braidFollow*(braidSwing*.72);
      parts.hairBack.rotation.z+=Math.sin(cycle-followLag)*braidTwist*.62;
    }
    if(parts.skirt)parts.skirt.rotation.x+=capeFollow*(capeSwing*.38);
    if(parts.weapon)parts.weapon.rotation.x+=stride*.055;
    if(parts.leftWeapon)parts.leftWeapon.rotation.x-=stride*armSwing*.92;
    if(parts.rightWeapon)parts.rightWeapon.rotation.x+=stride*armSwing*.92;
    if(parts.tail){
      parts.tail.rotation.y+=Math.sin(cycle*.72-followLag)*.16;
      parts.tail.rotation.z+=Math.sin(cycle-followLag*.45)*.12;
    }
  }

  applyBirdPose(entry,state,progress,now){
    const parts=entry.birdParts;if(entry.kind!=="BIRD"||!parts)return;
    const moving=state==="WALK",speed=moving?3.0:1.65,phase=(moving?progress:now/1000)*Math.PI*2*speed,flap=Math.sin(phase);
    if(parts.leftWing)parts.leftWing.rotation.z=-.28-flap*.72;
    if(parts.rightWing)parts.rightWing.rotation.z=.28+flap*.72;
    if(parts.tail)parts.tail.rotation.x=.08+Math.sin(phase*.5)*.08;
    if(parts.body)parts.body.rotation.x=-.04+Math.sin(phase*.5)*.035;
    entry.root.position.y+=Math.sin(phase*.5)*.035;
  }

  attackTypeFor(event){
    const id=event?.skillId;if(!id)return"";
    try{return String(globalThis.SkillDatabase?.get?.(id)?.attackType||"").toUpperCase();}
    catch(_error){return"";}
  }

  attackClassFor(event){
    const id=event?.skillId;if(!id)return"";
    try{return String(globalThis.SkillDatabase?.get?.(id)?.attackClass||"").toUpperCase();}
    catch(_error){return"";}
  }

  applyFigureAttack(entry,unit,event,progress){
    const parts=entry.figureParts;if(entry.kind!=="FIGURE"||!parts)return false;
    const type=this.attackTypeFor(event),facing=normalizeFacing(event?.facing??unit?.facing),vector=FACING_VECTOR[facing]||FACING_VECTOR.S;
    const ease=value=>{const t=clamp01(value);return t*t*(3-2*t);};

    if(type==="SHOT"&&parts.bow){
      const raise=ease(progress/.22),draw=progress<.66?ease((progress-.12)/.42):Math.max(0,1-ease((progress-.66)/.13)),recover=ease((progress-.72)/.28);
      if(parts.leftArm){parts.leftArm.rotation.x-=raise*1.15;parts.leftArm.rotation.z-=raise*.34;}
      if(parts.rightArm){parts.rightArm.rotation.x-=raise*.84;parts.rightArm.rotation.z+=draw*.92-recover*.16;}
      parts.bow.rotation.x-=raise*.88;parts.bow.rotation.z+=raise*.16;
      if(parts.body){parts.body.rotation.y-=draw*.20;parts.body.rotation.z-=draw*.06;}
      if(parts.cape)parts.cape.rotation.x+=draw*.12-recover*.07;
      if(parts.hairBack)parts.hairBack.rotation.x+=draw*.08;
      if(parts.braid)parts.braid.rotation.x+=draw*.10;
      entry.root.position.x-=vector.x*draw*.08;entry.root.position.z-=vector.z*draw*.08;
      return true;
    }

    const dualDaggers=entry.definition?.figure?.dualDaggers===true;
    if(type==="PIERCE"&&dualDaggers&&parts.rightWeapon){
      const ranged=this.attackClassFor(event)==="RANGED";
      if(ranged){
        const draw=ease(progress/.32),throwPhase=Math.sin(Math.PI*clamp01((progress-.22)/.58));
        if(parts.rightArm){parts.rightArm.rotation.x+=draw*.68-throwPhase*1.34;parts.rightArm.rotation.z-=draw*.44+throwPhase*.18;}
        parts.rightWeapon.rotation.x+=draw*.72-throwPhase*1.55;parts.rightWeapon.rotation.z-=draw*.28;
        if(parts.leftArm)parts.leftArm.rotation.z+=draw*.18;
        if(parts.body)parts.body.rotation.y+=draw*.20-throwPhase*.34;
        if(parts.cape)parts.cape.rotation.z-=throwPhase*.12;
        if(parts.tail)parts.tail.rotation.y-=throwPhase*.18;
        return true;
      }
      const ready=ease(progress/.22),thrust=Math.sin(Math.PI*clamp01((progress-.14)/.70));
      if(parts.rightArm){parts.rightArm.rotation.x-=ready*.46+thrust*1.02;parts.rightArm.rotation.z+=ready*.18;}
      if(parts.leftArm){parts.leftArm.rotation.x+=ready*.18;parts.leftArm.rotation.z-=ready*.36;}
      parts.rightWeapon.rotation.x-=ready*.58+thrust*1.08;parts.rightWeapon.rotation.z-=ready*.10;
      parts.leftWeapon.rotation.z+=ready*.28;
      if(parts.body){parts.body.rotation.x+=thrust*.05;parts.body.rotation.y-=thrust*.16;}
      if(parts.tail)parts.tail.rotation.y+=thrust*.22;
      entry.root.position.x+=vector.x*thrust*.62;entry.root.position.z+=vector.z*thrust*.62;
      return true;
    }

    if(type==="PIERCE"&&parts.weapon){
      const ready=ease(progress/.24),thrust=Math.sin(Math.PI*clamp01((progress-.16)/.68));
      if(parts.rightArm){parts.rightArm.rotation.x-=ready*.55+thrust*.92;parts.rightArm.rotation.z+=ready*.20;}
      if(parts.leftArm)parts.leftArm.rotation.x+=ready*.20;
      parts.weapon.rotation.x-=ready*.65+thrust*.93;parts.weapon.rotation.z-=ready*.12;
      if(parts.body){parts.body.rotation.x+=thrust*.06;parts.body.rotation.z-=thrust*.08;}
      if(parts.cape)parts.cape.rotation.x+=thrust*.16;
      if(parts.hairBack)parts.hairBack.rotation.x+=thrust*.12;
      entry.root.position.x+=vector.x*thrust*.58;entry.root.position.z+=vector.z*thrust*.58;
      return true;
    }

    if(type==="SLASH"&&dualDaggers&&parts.leftWeapon&&parts.rightWeapon){
      const wind=ease(progress/.22);
      const first=Math.sin(Math.PI*clamp01((progress-.12)/.50));
      const second=Math.sin(Math.PI*clamp01((progress-.42)/.50));
      if(parts.rightArm){parts.rightArm.rotation.x-=wind*.36+first*.64;parts.rightArm.rotation.z-=wind*.52-first*1.05+second*.28;}
      if(parts.leftArm){parts.leftArm.rotation.x-=wind*.24+second*.62;parts.leftArm.rotation.z+=wind*.48+second*1.00-first*.22;}
      parts.rightWeapon.rotation.z-=wind*.48-first*1.28+second*.24;
      parts.leftWeapon.rotation.z+=wind*.44+second*1.24-first*.20;
      if(parts.body){parts.body.rotation.y-=first*.34;parts.body.rotation.y+=second*.40;parts.body.rotation.z+=(second-first)*.06;}
      if(parts.cape)parts.cape.rotation.z+=(second-first)*.18;
      if(parts.tail){parts.tail.rotation.y+=(first-second)*.28;parts.tail.rotation.z+=(second-first)*.16;}
      const dash=Math.max(first,second);entry.root.position.x+=vector.x*dash*.34;entry.root.position.z+=vector.z*dash*.34;
      return true;
    }

    if(type==="SLASH"&&(parts.sword||parts.weapon)){
      const weapon=parts.sword||parts.weapon,wind=ease(progress/.28),swing=Math.sin(Math.PI*clamp01((progress-.18)/.66));
      const twoHanded=entry.definition?.figure?.twoHanded===true;
      if(parts.rightArm){parts.rightArm.rotation.x-=wind*(twoHanded?.70:.48);parts.rightArm.rotation.z-=wind*(twoHanded?.78:.64)-swing*(twoHanded?1.42:1.28);}
      if(twoHanded&&parts.leftArm){parts.leftArm.rotation.x-=wind*.60+swing*.18;parts.leftArm.rotation.z+=wind*.55-swing*.96;}
      weapon.rotation.x-=wind*(twoHanded?.44:.30);weapon.rotation.z-=wind*(twoHanded?.72:.55)-swing*(twoHanded?1.52:1.36);
      if(parts.body){parts.body.rotation.y-=wind*(twoHanded?.30:.22)-swing*(twoHanded?.55:.42);parts.body.rotation.z-=swing*(twoHanded?.08:0);}
      if(parts.cape)parts.cape.rotation.z+=swing*(twoHanded?.22:.16);
      if(parts.hairBack)parts.hairBack.rotation.z+=swing*(twoHanded?.12:.06);
      entry.root.position.x+=vector.x*swing*(twoHanded?.34:.26);entry.root.position.z+=vector.z*swing*(twoHanded?.34:.26);
      return true;
    }
    return false;
  }

  applyWalk(entry,unit,event,progress,definition={}){
    const points=event.path||[];
    if(points.length<2)return;
    const scaled=clamp01(progress)*(points.length-1),index=Math.min(points.length-2,Math.floor(scaled)),local=scaled-index;
    const a=points[index],b=points[index+1];
    const point={x:lerp(a.x,b.x,local),y:lerp(a.y,b.y,local),z:lerp(a.z,b.z,local)};
    entry.root.position.copyFrom(this.positionFor(entry,point));
    entry.facingMarker.root.position.copyFrom(this.markerPositionFor(point));
    const facing=facingFromDelta(Number(b.x)-Number(a.x),Number(b.y)-Number(a.y),event.facing||unit.facing);
    this.applyFacing(entry,unit,entry.definition,facing,"WALK");

    const forcedKind=String(event?.kind||"").toUpperCase();
    if(forcedKind==="AIRBORNE_FORCE"){
      const spinTurns=2.25,spin=progress*Math.PI*2*spinTurns;
      entry.root.rotation.y+=spin;
      entry.root.rotation.z=Math.sin(progress*Math.PI*3)*.26;
      if(entry.plane)entry.plane.rotation.z=Math.sin(progress*Math.PI*4)*.16;
      if(entry.kind==="FIGURE"){
        const parts=entry.figureParts||{},flail=Math.sin(progress*Math.PI*6);
        if(parts.leftArm)parts.leftArm.rotation.x+=.85+flail*.34;
        if(parts.rightArm)parts.rightArm.rotation.x-=.75+flail*.30;
        if(parts.leftLeg)parts.leftLeg.rotation.x+=flail*.40;
        if(parts.rightLeg)parts.rightLeg.rotation.x-=flail*.40;
        if(parts.cape)parts.cape.rotation.x+=.30+Math.sin(progress*Math.PI*5)*.20;
        if(parts.braid)parts.braid.rotation.x+=.38+Math.sin(progress*Math.PI*5.7)*.25;
        if(parts.tail){parts.tail.rotation.y+=Math.sin(progress*Math.PI*7)*.45;parts.tail.rotation.z+=Math.cos(progress*Math.PI*6)*.28;}
      }
      return;
    }

    const step=Math.sin(local*Math.PI*2);
    if(entry.kind==="BIRD"){
      entry.root.position.y+=Math.abs(step)*.08;
      this.applyBirdPose(entry,"WALK",local,performance.now());
      return;
    }
    if(entry.kind==="FIGURE"){
      const motion=definition?.figureMotion||{};
      entry.root.position.y+=Math.abs(step)*Number(motion.bodyBob??.065);
      entry.root.rotation.z=step*Number(motion.rootSway??.035);
      this.applyFigureWalk(entry,definition,local);
      return;
    }

    entry.root.position.y+=Math.abs(step)*.17;
    entry.root.rotation.z=step*.11;
  }

  applyProcedural(entry,unit,state,progress,now,event,definition){
    const procedural=String(definition?.procedural||"").toUpperCase();
    const facing=normalizeFacing(event?.facing??unit?.facing),vector=FACING_VECTOR[facing]||FACING_VECTOR.S;
    if(state==="WALK"&&event?.path?.length){this.applyWalk(entry,unit,event,progress,definition);return;}
    const weaponAction=this.attackTypeFor(event);
    if(entry.kind==="FIGURE"&&event?.skillId&&["SHOT","PIERCE","SLASH"].includes(weaponAction)&&this.applyFigureAttack(entry,unit,event,progress))return;

    if(entry.kind==="BIRD"&&(state==="IDLE"||procedural==="FLAP")){
      this.applyBirdPose(entry,state,progress,now);return;
    }

    if(procedural==="BREATHE"||state==="IDLE"){
      const breathe=Math.sin(now/300);
      entry.root.position.y+=breathe*.055;
      entry.root.scaling.y=entry.baseScale*(1+breathe*.035);
      if(entry.kind==="FIGURE"&&entry.figureParts?.tail){
        entry.figureParts.tail.rotation.y+=Math.sin(now/420)*.14;
        entry.figureParts.tail.rotation.z+=Math.sin(now/610+.8)*.09;
      }
      return;
    }

    if(procedural==="STEP"||state==="WALK"){
      entry.root.position.y+=Math.abs(Math.sin(progress*Math.PI*4))*.16;
      entry.root.rotation.z=Math.sin(progress*Math.PI*4)*.11;
      return;
    }

    if(procedural==="LUNGE"||state==="ATTACK"){
      const thrust=Math.sin(Math.PI*progress);
      const distance=thrust*.72;
      entry.root.position.x+=vector.x*distance;
      entry.root.position.z+=vector.z*distance;
      entry.root.rotation.z=thrust*-.30;
      entry.root.scaling.set(
        entry.baseScale*(1-thrust*.08),
        entry.baseScale*(1+thrust*.13),
        entry.baseScale*(1-thrust*.08)
      );
      return;
    }

    if(procedural==="CAST"||state==="CAST"){
      const pulse=Math.sin(Math.PI*progress);
      entry.root.position.y+=pulse*.30;
      entry.root.rotation.y+=progress*Math.PI*2;
      entry.root.scaling.setAll(entry.baseScale*(1+pulse*.18));
      return;
    }

    if(procedural==="RECOIL"||state==="HURT"){
      const recoil=Math.sin(Math.PI*progress);
      entry.root.position.x-=vector.x*recoil*.48;
      entry.root.position.z-=vector.z*recoil*.48;
      entry.root.rotation.z=recoil*.38;
      entry.root.scaling.set(
        entry.baseScale*(1+recoil*.10),
        entry.baseScale*(1-recoil*.12),
        entry.baseScale*(1+recoil*.10)
      );
      return;
    }

    if(procedural==="FALL"||state==="DEATH"){
      const p=clamp01(progress),side=facing==="W"||facing==="N"?-1:1;
      entry.root.rotation.z=side*p*Math.PI*.5;
      entry.root.position.y-=p*.34;
      entry.root.scaling.set(entry.baseScale,entry.baseScale*(1-p*.30),entry.baseScale);
    }
  }

  updateFrame(now=performance.now()){
    for(const[id,entry]of [...this.entries]){
      const unit=entry.lastUnit||{};
      let active=this.activeAnimations.get(id)||this.startNext(id,now);
      if(active&&now-active.startedAt>=active.duration){
        const wasDeath=active.event.state==="DEATH";
        this.activeAnimations.delete(id);
        if(wasDeath){this.disposeEntry(id);continue;}
        active=this.startNext(id,now);
      }

      this.resetPose(entry,unit);
      const state=active?.event?.state||"IDLE",duration=active?.duration||1200;
      const progress=active?clamp01((now-active.startedAt)/duration):((now%duration)/duration);
      const definition=this.animationDefinition(unit,state);
      const event=active?.event||{state,facing:unit.facing};
      this.applyFacing(entry,unit,entry.definition,event.facing??unit.facing,state);
      this.setBillboardAsset(entry,unit,state,event.facing??unit.facing,progress);
      this.applyProcedural(entry,unit,state,progress,now,event,definition);
      this.updateAnimationBadge(entry,unit,state);
    }
  }

  sync(state,events=[]){
    this.enqueueEvents(events);
    const visible=new Set();

    for(const unit of state?.units||[]){
      visible.add(String(unit.id));
      const definition=this.battleVisual(unit),signature=this.visualSignature(unit,definition);
      let entry=this.entries.get(unit.id);
      if(entry?.signature!==signature){this.disposeEntry(unit.id);entry=null;}
      if(!entry)entry=this.createEntry(unit,definition,signature);
      entry.lastUnit={...unit};
      entry.definition=definition;
      this.applyFacing(entry,unit,definition,null,"IDLE");

      if(entry.kind==="CAPSULE")entry.root.material=this.materials[unit.team]??this.materials.NEUTRAL;

      const verticalMode=String(unit.verticalMode||"");
      const scale=(unit.selected?1.13:unit.finished?.92:1)*(verticalMode==="DIVING"?.9:1);
      entry.baseScale=scale;
      const stealthOpacity=unit.stealthed&&unit.friendlyToViewer?.45:1;
      const verticalOpacity=verticalMode==="DIVING"?.5:1;
      this.setVisibility(entry,(unit.finished?.62:1)*stealthOpacity*verticalOpacity);
      this.updateVerticalCue(entry,unit);

      entry.basePosition.copyFrom(this.positionFor(entry,unit));
      entry.baseMarkerPosition.copyFrom(this.markerPositionFor(unit));
      if(!this.activeAnimations.has(unit.id)){
        entry.root.position.copyFrom(entry.basePosition);
        entry.facingMarker.root.position.copyFrom(entry.baseMarkerPosition);
      }
    }

    for(const id of [...this.entries.keys()]){
      if(visible.has(String(id))||this.hasDeathPending(id))continue;
      this.disposeEntry(id);
    }
    this.updateFrame();
  }

  setAnimationDebug(value){
    this.animationDebug=!!value;
    if(!this.animationDebug){
      for(const entry of this.entries.values())entry.animationBadge?.root?.setEnabled(false);
    }
    return this.animationDebug;
  }

  diagnostics(){
    const states={};
    for(const active of this.activeAnimations.values())states[active.event.state]=(states[active.event.state]||0)+1;
    return{
      units:this.entries.size,
      activeAnimations:this.activeAnimations.size,
      queuedAnimations:[...this.animationQueues.values()].reduce((n,q)=>n+q.length,0),
      animationDebug:this.animationDebug,
      states
    };
  }
}

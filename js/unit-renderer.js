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
    // Own the immutable per-appearance mesh layouts in the existing renderer.
    // Each unit keeps its own animated pivots and GPU meshes; identical figures
    // reuse prepared LOCAL-space geometry instead of rebuilding hundreds of primitives.
    this.figureTemplates=new Map();
    // Ordinary opaque FIGURE paints use one vertex-tint material per sidedness.
    // Articulated pivots are still the animation and shadow owners.
    this.figureTintMaterials=new Map();
    this.figureBuildStats={templatesBuilt:0,templatesReused:0,originalMeshes:0,batchedMeshes:0,
      buildMs:0,cloneMs:0,entriesCreated:0,entriesDisposed:0,entryBuildMs:0,
      tintableSourceMeshes:0,tintedDrawMeshes:0,articulatedBatchesSaved:0,birdShadowDrawMeshesSaved:0};
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

  animationAsset(unit,definition,state,facing,resolvedAnimation=null){
    const animation=resolvedAnimation||this.animationDefinition(unit,state),f=normalizeFacing(facing);
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

  // One StandardMaterial lighting contract for every *ordinary opaque* paint.
  // Different diffuse colours are stored in immutable per-vertex RGBA instead of
  // requiring a separate Babylon submission for every palette colour. Special
  // luminous/translucent materials keep their exact independent material.
  figureTintMaterial(twoSided){
    const key=twoSided?"double":"front";
    if(this.figureTintMaterials.has(key))return this.figureTintMaterials.get(key);
    const mat=this.figureMaterial(`vertex-tint-${key}`,"#ffffff");
    mat.backFaceCulling=!twoSided;
    this.figureTintMaterials.set(key,mat);
    return mat;
  }

  // Material compatibility is a rendering contract, not a figure-specific
  // hardcoded paint list. Preserve emission, alpha, light response and textures
  // where they cannot be factored safely into the vertex diffuse colour.
  figureTintClass(material,materialKey){
    if(materialKey==="holy"||materialKey==="arcane"||
       Number(material?.alpha??1)!==1||material?.disableLighting===true||
       material?.diffuseTexture||material?.opacityTexture||material?.emissiveTexture||
       material?.ambientTexture||material?.bumpTexture||material?.reflectionTexture||
       material?.refractionTexture||material?.lightmapTexture||material?.specularTexture||
       material?.useEmissiveAsIllumination===true||material?.linkEmissiveWithDiffuse===true||
       material?.specularPower!==12||material?.maxSimultaneousLights!==8)return null;
    const spec=material?.specularColor;
    if(!spec||Math.abs(spec.r-.08)>1e-8||Math.abs(spec.g-.07)>1e-8||
       Math.abs(spec.b-.06)>1e-8)return null;
    return material.backFaceCulling===false?"double":"front";
  }

  // FIGURE geometry belongs to UnitRenderer. This is a material/hinge-level
  // assembly, NOT world-space MergeMeshes: Babylon animated parent transforms
  // must never be baked into the final vertex coordinates.
  figurePartGeometry(mesh,pivot){
    const positions=mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const indices=mesh.getIndices();
    const normals=mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
    const uvs=mesh.getVerticesData(BABYLON.VertexBuffer.UVKind);
    if(!positions?.length||!indices?.length||indices.length%3!==0||!normals?.length)
      throw new Error(`FIGURE geometry requires triangles and normals: ${mesh.name}`);
    // Babylon uses local * parent for its matrices. Cancel the real pivot's
    // world matrix, including any sturdy-build scaling or nested hand pivot.
    const toPivot=mesh.computeWorldMatrix(true).multiply(pivot.computeWorldMatrix(true).clone().invert());
    const normalTransform=toPivot.clone().invert().transpose();
    const localPositions=[],localNormals=[];
    for(let i=0;i<positions.length;i+=3){
      const v=BABYLON.Vector3.TransformCoordinates(
        new BABYLON.Vector3(positions[i],positions[i+1],positions[i+2]),toPivot);
      localPositions.push(v.x,v.y,v.z);
      const n=BABYLON.Vector3.TransformNormal(
        new BABYLON.Vector3(normals[i],normals[i+1],normals[i+2]),normalTransform).normalize();
      localNormals.push(n.x,n.y,n.z);
    }
    return{positions:localPositions,normals:localNormals,
      uvs:uvs?.length===positions.length/3*2?Array.from(uvs):Array(positions.length/3*2).fill(0),
      indices:Array.from(indices),mirrored:toPivot.determinant()<0};
  }

  figureLineLayout(mesh,pivot){
    const positions=mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)||[];
    const toPivot=mesh.computeWorldMatrix(true).multiply(pivot.computeWorldMatrix(true).clone().invert());
    const points=[];
    for(let i=0;i<positions.length;i+=3){
      const p=BABYLON.Vector3.TransformCoordinates(
        new BABYLON.Vector3(positions[i],positions[i+1],positions[i+2]),toPivot);
      points.push([p.x,p.y,p.z]);
    }
    return{part:mesh.metadata.figurePart,points,
      color:[mesh.color?.r??1,mesh.color?.g??1,mesh.color?.b??1]};
  }

  instantiateFigureTemplate(unit,template,figureParts,root,materials,height,definition,kind="FIGURE"){
    const meshes=[];
    for(let i=0;i<template.surfaces.length;i++){
      const group=template.surfaces[i],pivot=figureParts[group.part]||root;
      const mesh=new BABYLON.Mesh(`unit-batch-${group.part}-${i}-${unit.id}`,this.scene);
      const data=new BABYLON.VertexData();
      data.positions=group.positions;data.normals=group.normals;
      data.uvs=group.uvs;data.indices=group.indices;
      if(group.tintClass)data.colors=group.colors;
      data.applyToMesh(mesh);
      mesh.parent=pivot;
      mesh.material=group.tintClass?this.figureTintMaterial(group.tintClass==="double")
        :materials[group.materialKey];
      mesh.useVertexColors=!!group.tintClass;
      mesh.useVertexAlpha=false;
      mesh.receiveShadows=group.receiveShadows;mesh.isPickable=false;
      mesh.metadata={kind:"unit-part",unitId:unit.id,
        ...(kind==="BIRD"?{birdPart:group.part}:{figurePart:group.part}),
        castShadow:group.castShadow,sourceMeshCount:group.sources,
        vertexTintBatch:!!group.tintClass,tintClass:group.tintClass||null};
      meshes.push(mesh);
    }
    for(let i=0;i<template.lines.length;i++){
      const item=template.lines[i];
      const mesh=BABYLON.MeshBuilder.CreateLines(`figure-line-${i}-${unit.id}`,{
        points:item.points.map(v=>new BABYLON.Vector3(v[0],v[1],v[2]))
      },this.scene);
      mesh.parent=figureParts[item.part]||root;
      mesh.color=new BABYLON.Color3(...item.color);
      mesh.isPickable=false;
      mesh.metadata={kind:"unit-part",unitId:unit.id,figurePart:item.part,
        castShadow:false,lineOnly:true};
      meshes.push(mesh);
    }
    return{root,meshes,[kind==="BIRD"?"birdParts":"figureParts"]:figureParts,
      kind,height,lift:Number(definition?.lift||0)};
  }

  batchFigureParts(unit,signature,root,figureParts,meshes,materials,height,definition,kind="FIGURE"){
    // Stable order comes from createFigure()'s own formal primitive builders.
    // A batch shares a SINGLE animated pivot, material, and shadow policy.
    // The original meshes are disposed only after the complete local geometry
    // has been captured. Animated pivots and decorative line meshes survive.
    const materialKeys=new Map(Object.entries(materials).map(([k,v])=>[v,k]));
    const groups=[],byKey=new Map(),lines=[];
    for(const mesh of meshes){
      const part=mesh.metadata?.figurePart||mesh.metadata?.birdPart||"",pivot=figureParts[part]||root;
      if(mesh.metadata?.lineOnly){lines.push(this.figureLineLayout(mesh,pivot));continue;}
      const materialKey=materialKeys.get(mesh.material);
      if(!materialKey)throw new Error(`FIGURE material not registered: ${mesh.name}`);
      const geometry=this.figurePartGeometry(mesh,pivot);
      const castShadow=mesh.metadata?.castShadow!==false,receiveShadows=mesh.receiveShadows!==false;
      const tintClass=this.figureTintClass(mesh.material,materialKey);
      // Never merge across independent animated pivots or shadow policies.
      const key=JSON.stringify([part,tintClass?`vertex:${tintClass}`:materialKey,
        castShadow,receiveShadows]);
      let group=byKey.get(key);
      // Keep indices 16-bit safe on WebGL1 as well as WebGL2. Group split is
      // determined by actual vertex count, not an arbitrary map/hero rule.
      if(!group||group.positions.length/3+geometry.positions.length>65535){
        group={part,materialKey:tintClass?null:materialKey,tintClass,
          castShadow,receiveShadows,
          positions:[],normals:[],uvs:[],colors:[],indices:[],sources:0};
        groups.push(group);byKey.set(key,group);
      }
      const base=group.positions.length/3;
      group.positions.push(...geometry.positions);
      group.normals.push(...geometry.normals);
      group.uvs.push(...geometry.uvs);
      if(tintClass){
        const diffuse=mesh.material.diffuseColor;
        for(let i=0,n=geometry.positions.length/3;i<n;i++)
          group.colors.push(diffuse.r,diffuse.g,diffuse.b,1);
      }
      if(geometry.mirrored){
        for(let i=0;i<geometry.indices.length;i+=3)
          group.indices.push(base+geometry.indices[i],base+geometry.indices[i+2],base+geometry.indices[i+1]);
      }else for(const index of geometry.indices)group.indices.push(base+index);
      group.sources++;
    }
    const template={surfaces:groups,lines};
    // The first instance also uses the same creation contract as every later
    // instance, so batching has no separate visual or animation implementation.
    const entry=this.instantiateFigureTemplate(unit,template,figureParts,root,materials,height,definition,kind);
    this.figureTemplates.set(signature,template);
    this.figureBuildStats.templatesBuilt++;
    this.figureBuildStats.originalMeshes+=meshes.length;
    this.figureBuildStats.batchedMeshes+=entry.meshes.length;
    this.figureBuildStats.tintableSourceMeshes+=groups.reduce((n,g)=>n+(g.tintClass?g.sources:0),0);
    this.figureBuildStats.tintedDrawMeshes+=groups.filter(g=>g.tintClass).length;
    // Relative to existing part/material batching, not raw unbatched primitives.
    const legacyGroups=new Set();
    for(const mesh of meshes){
      if(mesh.metadata?.lineOnly)continue;
      const originalKey=materialKeys.get(mesh.material);
      legacyGroups.add(JSON.stringify([mesh.metadata?.figurePart||mesh.metadata?.birdPart||"",originalKey,
        mesh.metadata?.castShadow!==false,mesh.receiveShadows!==false]));
    }
    this.figureBuildStats.articulatedBatchesSaved+=Math.max(0,legacyGroups.size-groups.length);
    // Actual per-frame scene + shadow submissions for a BIRD are one mesh
    // per existing animated pivot/material compatibility group, rather than
    // one submission for each feather/claw primitive. Geometry and lighting
    // remain identical; no shadow caster is discarded.
    if(kind==="BIRD")this.figureBuildStats.birdShadowDrawMeshesSaved+=
      Math.max(0,meshes.filter(mesh=>mesh.metadata?.castShadow!==false).length-
        entry.meshes.filter(mesh=>mesh.metadata?.castShadow!==false).length);
    for(const mesh of meshes)mesh.dispose(false,false);
    return entry;
  }

  createFigure(unit,definition,signature=this.visualSignature(unit,definition)){
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
    if(figure.fieldTowerShield)makePart("shield",[-.305,.75,.07]);
    makePart("tail",[0,.88,-.17]);
    // Reusable angelic silhouette roots. Each wing hinges at the shoulder so
    // flight, aiming, and landing can articulate without moving the torso.
    makePart("leftWing",[-.24,1.36,-.22]);
    makePart("rightWing",[.24,1.36,-.22]);
    makePart("halo",[0,1.82,-.08]);
    if(figure.sturdyBuild){
      // Body proportions are selected in VisualDatabase. Save the expanded
      // bases so resetPose() never shrinks a sturdy warrior after an event.
      for(const [part,width] of [["body",1.13],["leftArm",1.09],["rightArm",1.09],["leftLeg",1.07],["rightLeg",1.07]]){
        figureParts[part].scaling.x=width;
        figureParts[part].metadata.figureBase.scaling.copyFrom(figureParts[part].scaling);
      }
    }
    if(figure.armingSword||figure.blessedGreatsword||figure.fieldWarHammer){
      // The hilt is centered inside the RIGHT glove. Rotating that arm carries
      // the entire arming sword; it cannot drift when walking or slashing.
      const hand=[.307,.70,.070],shoulder=figureParts.rightArm.metadata.figurePivot;
      const swordRoot=figureParts.weapon;
      swordRoot.parent=figureParts.rightArm;
      swordRoot.position.set((hand[0]-shoulder[0])*scale,(hand[1]-shoulder[1])*scale,(hand[2]-shoulder[2])*scale);
      swordRoot.metadata.figurePivot=[...hand];
      swordRoot.metadata.figureBase.position.copyFrom(swordRoot.position);
    }

    if(figure.fieldTowerShield){
      // Field shields remain attached to the LEFT hand through every
      // facing, walking, blocking and death pose; never a world-space prop.
      const hand=[-.305,.75,.07],shoulder=figureParts.leftArm.metadata.figurePivot;
      const shieldRoot=figureParts.shield;
      shieldRoot.parent=figureParts.leftArm;
      shieldRoot.position.set((hand[0]-shoulder[0])*scale,(hand[1]-shoulder[1])*scale,(hand[2]-shoulder[2])*scale);
      shieldRoot.metadata.figurePivot=[...hand];
      shieldRoot.metadata.figureBase.position.copyFrom(shieldRoot.position);
    }

    if(figure.fieldSpear){
      // Every issued polearm follows the LEFT grip, including walk and thrust.
      // The independent hand pivot lets the spear tip pitch forward without
      // dislocating the glove or introducing a second weapon renderer.
      const grip=[-.307,.755,.086],shoulder=figureParts.leftArm.metadata.figurePivot;
      const spearRoot=figureParts.leftWeapon;
      spearRoot.parent=figureParts.leftArm;
      spearRoot.position.set((grip[0]-shoulder[0])*scale,(grip[1]-shoulder[1])*scale,(grip[2]-shoulder[2])*scale);
      spearRoot.metadata.figurePivot=[...grip];
      spearRoot.metadata.figureBase.position.copyFrom(spearRoot.position);
    }

    if(figure.holyBow||figure.fieldBow){
      // Hand attachment: the bow pivot belongs to the LEFT arm, not the scene.
      // Keep its stored base transform consistent with resetPose().
      const hand=[-.305,.70,.09],shoulder=figureParts.leftArm.metadata.figurePivot;
      const bowRoot=figureParts.bow;
      bowRoot.parent=figureParts.leftArm;
      bowRoot.position.set((hand[0]-shoulder[0])*scale,(hand[1]-shoulder[1])*scale,(hand[2]-shoulder[2])*scale);
      bowRoot.metadata.figurePivot=[...hand];
      bowRoot.metadata.figureBase.position.copyFrom(bowRoot.position);
    }

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
      chainmail:this.figureMaterial("chainmail",colors.chainmail||"#777b7c"),
      steelDark:this.figureMaterial("steel-dark",colors.steelDark||"#5b5f60"),
      gold:this.figureMaterial("gold",colors.gold||"#b58a4d"),
      tabard:this.figureMaterial("tabard",colors.tabard||colors.shirt||"#eee9df"),
      holy:this.figureMaterial("holy",colors.holy||"#ffd86a"),
      tail:this.figureMaterial("tail",colors.tail||colors.hair||"#c8b9ae"),
      tailTip:this.figureMaterial("tail-tip",colors.tailTip||colors.hairDark||"#8f7b73"),
      innerEar:this.figureMaterial("inner-ear",colors.innerEar||"#c99096"),
      scale:this.figureMaterial("scale",colors.scale||"#2f6581"),
      scaleLight:this.figureMaterial("scale-light",colors.scaleLight||"#91c7d3"),
      pearl:this.figureMaterial("pearl",colors.pearl||"#e8eef0"),
      horn:this.figureMaterial("horn",colors.horn||colors.leatherDark||"#44353c"),
      arcane:this.figureMaterial("arcane",colors.arcane||colors.gem||"#9a64d8"),
      dark:this.figureMaterial("dark","#1d1c20")
    };
    material.cape.backFaceCulling=false;
    material.capeDark.backFaceCulling=false;
    material.hair.backFaceCulling=false;
    material.tail.backFaceCulling=false;
    material.innerEar.backFaceCulling=false;
    material.scaleLight.backFaceCulling=false;
    material.tabard.backFaceCulling=false;
    material.pearl.backFaceCulling=false;
    material.gold.backFaceCulling=false;
    material.arcane.backFaceCulling=false;
    material.arcane.emissiveColor=this.figureColor(colors.arcaneEmissive||colors.arcane||colors.gem||"#9a64d8").scale(.72);
    material.arcane.specularColor=this.figureColor(colors.arcane||colors.gem||"#9a64d8");
    material.holy.backFaceCulling=false;
    material.holy.alpha=.72;
    material.holy.emissiveColor=this.figureColor(colors.holyEmissive||colors.holy||"#ffd86a").scale(.92);
    material.holy.specularColor=this.figureColor(colors.holy||"#ffd86a");

    const template=this.figureTemplates.get(signature);
    if(template){
      const start=performance.now();
      const entry=this.instantiateFigureTemplate(unit,template,figureParts,root,material,height,definition);
      this.figureBuildStats.templatesReused++;
      this.figureBuildStats.cloneMs+=performance.now()-start;
      return entry;
    }
    const geometryBuildStart=performance.now();
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
    if(!figure.soldierHelm)box("figure-bang-l",[.07,.24,.055],material.hair,[-.085,1.57,.145],[.18,0,-.28],"head");
    if(!figure.soldierHelm)box("figure-bang-c",[.06,.22,.05],material.hair,[0,1.575,.155],[.12,0,.06],"head");
    if(!figure.soldierHelm)box("figure-bang-r",[.065,.23,.052],material.hair,[.075,1.565,.145],[.18,0,.26],"head");
    box("figure-side-lock-l",[.055,.36,.06],material.hair,[-.165,1.43,.035],[0,0,-.10],"head");
    box("figure-side-lock-r",[.055,.31,.06],material.hair,[.165,1.45,.035],[0,0,.13],"head");

    if(figure.messyHair){
      box("figure-messy-lock-l",[.055,.24,.052],material.hairDark,[-.13,1.50,.12],[.12,0,-.38],"head");
      box("figure-messy-lock-r",[.052,.21,.050],material.hairDark,[.13,1.49,.12],[.10,0,.34],"head");
      box("figure-messy-back-l",[.060,.28,.055],material.hairDark,[-.12,1.40,-.12],[.20,0,-.16],"hairBack");
      box("figure-messy-back-r",[.060,.25,.055],material.hairDark,[.12,1.41,-.12],[-.16,0,.14],"hairBack");
    }

    if(figure.braid!==false){
      for(let i=0;i<6;i++){
        const t=i/5,offset=Math.sin(t*Math.PI)*.018;
        cylinder(`figure-braid-${i}`,.12,.105-i*.006,.115-i*.006,material.hair,[.17+offset,1.34-t*.61,.09+t*.018],[0,0,-.18],6,"braid");
      }
      cylinder("figure-braid-tie",.055,.075,.075,material.leather,[.17,.71,.11],[0,0,-.18],6,"braid");
    }

    // Helmets obscure the eyes, not the entire face. Keep the lower face intact.
    if(!figure.soldierHelm){
      sphere("figure-eye-l",.032,material.eye,[-.055,1.545,.158],[1,.62,.40],4,"head");
      sphere("figure-eye-r",.032,material.eye,[.055,1.545,.158],[1,.62,.40],4,"head");
    }
    if(figure.friendlySmile&&!figure.soldierHelm){
      // A subtle curved smile; local head coordinates let it follow HURT,
      // IDLE and WALK without a second facial-animation system.
      const smilePoints=[[-.068,1.453,.181],[-.036,1.442,.190],[0,1.437,.194],[.036,1.442,.190],[.068,1.453,.181]].map(p=>localPoint("head",p));
      const smile=BABYLON.MeshBuilder.CreateTube(`figure-smile-${unit.id}`,{
        path:smilePoints,radius:.008*scale,tessellation:5,cap:BABYLON.Mesh.CAP_ALL
      },this.scene);
      finish(smile,material.hairDark,null,null,null,{part:"head",castShadow:false});
    }
    if(figure.soldierHelm){
      // Plain issued sallet, projecting visor and rear/side neck plates.
      sphere("figure-infantry-helm-dome",.42,material.armor,[0,1.685,-.015],[1.08,.72,1.00],9,"head");
      cylinder("figure-infantry-helm-crown",.12,.36,.38,material.armor,[0,1.66,-.020],null,10,"head");
      custom("figure-infantry-helm-visor",[
        [-.215,1.585,.11],[.215,1.585,.11],[.18,1.515,.245],[-.18,1.515,.245]
      ],[0,2,1,0,3,2,1,2,0,2,3,0],material.armor,"head");
      box("figure-infantry-helm-visor-dark",[.28,.035,.020],material.steelDark,[0,1.520,.195],[.28,0,0],"head");
      for(const side of [-1,1]){
        const t=side<0?"l":"r";
        box(`figure-infantry-helm-neck-${t}`,[.070,.16,.20],material.armor,[side*.181,1.457,-.082],[0,side*.11,side*.09],"head");
        sphere(`figure-infantry-helm-rivet-${t}`,.030,material.metal,[side*.185,1.59,.130],[.70,.70,.46],5,"head");
      }
      // The visible nose and mouth are simple geometry; no glowing or painted eyes.
      sphere("figure-infantry-nose",.038,material.skin,[0,1.466,.180],[.62,.75,1.0],6,"head");
      box("figure-infantry-mouth",[.057,.012,.010],material.hairDark,[0,1.426,.172],null,"head");
    }

    if(figure.pointedEars){
      custom("figure-ear-l",[[-.155,1.57,.02],[-.33,1.60,.015],[-.165,1.48,.025]],[0,1,2],material.skin,"head");
      custom("figure-ear-r",[[.155,1.57,.02],[.33,1.60,.015],[.165,1.48,.025]],[0,2,1],material.skin,"head");
    }

    if(figure.demonHorns){
      const horn=(side)=>{
        const points=[
          [side*.105,1.69,-.055],[side*.155,1.77,-.070],[side*.235,1.79,-.050],
          [side*.285,1.73,-.020],[side*.275,1.65,.015],[side*.215,1.61,.035]
        ].map(point=>localPoint("head",point));
        const mesh=BABYLON.MeshBuilder.CreateTube(`figure-demon-horn-${side<0?"l":"r"}-${unit.id}`,{path:points,radius:.032*scale,tessellation:7,cap:BABYLON.Mesh.CAP_ALL},this.scene);
        finish(mesh,material.horn,null,null,null,{part:"head"});
        cylinder(`figure-demon-horn-band-${side<0?"l":"r"}`,.040,.080,.080,material.metal,[side*.232,1.775,-.047],[Math.PI/2,0,0],8,"head");
      };
      horn(-1);horn(1);
    }

    if(figure.seaFinEars){
      custom("figure-sea-fin-ear-l",[[-.155,1.57,.015],[-.30,1.68,-.005],[-.28,1.54,.015],[-.31,1.45,.005]],[0,1,2,0,2,3],material.scaleLight,"head");
      custom("figure-sea-fin-ear-r",[[.155,1.57,.015],[.30,1.68,-.005],[.28,1.54,.015],[.31,1.45,.005]],[0,2,1,0,3,2],material.scaleLight,"head");
      sphere("figure-sea-ear-gem-l",.052,material.gem,[-.185,1.56,.055],[.65,1,.45],6,"head");
      sphere("figure-sea-ear-gem-r",.052,material.gem,[.185,1.56,.055],[.65,1,.45],6,"head");
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
    if(figure.elfHairVines){
      // Reusable elven ceremonial hair ornaments; attached to the same head
      // and long-hair pivots as the rest of the procedural hairstyle.
      for(const side of [-1,1]){
        const tag=side<0?"l":"r";
        for(let i=0;i<4;i++){
          const x=side*(.070+i*.038),y=1.716-i*.012;
          sphere(`figure-elf-hair-leaf-${tag}-${i}`,.047,material.gold,[x,y,.015+i*.008],[.65,.35,1.25],5,"head");
        }
        sphere(`figure-elf-hair-gem-${tag}`,.043,material.gem,[side*.17,1.69,.09],[.65,.8,.40],7,"head");
      }
      box("figure-elf-braided-clasp",[.085,.042,.055],material.gold,[.19,1.01,.105],[0,0,.18],"braid");
    }

    if(figure.hairRibbon){
      box("figure-hair-ribbon-knot",[.15,.10,.08],material.accent,[-.19,1.54,-.10],[0,.18,.12],"hairBack");
      box("figure-hair-ribbon-tail-a",[.065,.40,.035],material.accent,[-.23,1.32,-.12],[.18,0,.15],"hairBack");
      box("figure-hair-ribbon-tail-b",[.065,.36,.035],material.accent,[-.13,1.34,-.13],[-.12,0,-.10],"hairBack");
    }

    if(figure.ceremonialHairRibbon){
      box("figure-ceremonial-hair-bow",[.18,.10,.055],material.accent,[-.22,1.62,-.10],[0,.18,-.28],"head");
      box("figure-ceremonial-hair-streamer-l",[.062,.36,.030],material.accent,[-.25,1.37,-.13],[.14,0,-.12],"hairBack");
      box("figure-ceremonial-hair-streamer-r",[.056,.31,.029],material.accent,[-.16,1.40,-.13],[-.10,0,.09],"hairBack");
      sphere("figure-ceremonial-hair-clasp",.053,material.gold,[-.20,1.65,-.08],[.7,.7,.55],6,"head");
    }

    if(figure.hood){
      const hood=BABYLON.MeshBuilder.CreateTorus(`figure-hood-${unit.id}`,{diameter:.43*scale,thickness:.085*scale,tessellation:12},this.scene);
      finish(hood,material.cape,[0,1.46,-.13],[Math.PI/2,0,0],[1.08,.84,.68],{part:"cape"});
      box("figure-hood-fold",[.40,.16,.12],material.capeDark,[0,1.35,-.15],[.12,0,0],"cape");
    }

    if(figure.witchHat){
      // Broad-brim witch silhouette for senior arcane casters. The entire hat is
      // attached to the head pivot so casting, recoil and death keep it aligned.
      const brim=BABYLON.MeshBuilder.CreateTorus(`figure-witch-hat-brim-${unit.id}`,{diameter:.92*scale,thickness:.036*scale,tessellation:22},this.scene);
      finish(brim,material.cape,[0,1.72,-.020],[Math.PI/2,0,0],[1.16,.38,1.00],{part:"head"});
      cylinder("figure-witch-hat-crown",.34,.16,.23,material.cape,[0,1.86,-.025],[0,0,-.08],12,"head");
      cylinder("figure-witch-hat-tip",.32,.02,.15,material.cape,[.06,2.08,-.035],[0,0,.32],12,"head");
      box("figure-witch-hat-band",[.29,.040,.19],material.gold,[0,1.73,.07],[0,0,0],"head");
      sphere("figure-witch-hat-gem",.055,material.gem,[.135,1.73,.145],[.70,.95,.42],6,"head");
      box("figure-witch-hat-chain",[.016,.18,.016],material.gold,[.26,1.67,.03],[.10,0,.08],"head");
      sphere("figure-witch-hat-charm",.045,material.gem,[.285,1.55,.045],[.60,.95,.38],5,"head");
    }

    // Tapered torso gives a readable shoulder/waist silhouette at tactical zoom.
    // Some armour sets (for example a fitted scale cuirass) are the torso garment
    // themselves and must not reveal the generic shirt/vest underneath.
    const cropped=figure.croppedTop===true;
    const replaceBaseTorso=figure.replaceBaseTorso===true;
    if(!replaceBaseTorso){
      cylinder("figure-blouse",cropped?.30:.43,.43,.31,material.shirt,[0,cropped?1.24:1.17,0],null,6,"body");
      cylinder("figure-vest",cropped?.27:.36,.38,.29,material.leather,[0,cropped?1.235:1.15,.018],null,6,"body");
      if(cropped)cylinder("figure-midriff",.18,.30,.29,material.skin,[0,1.01,.015],null,7,"body");
      cylinder("figure-waist",.16,.29,.34,material.leatherDark,[0,.94,.005],null,6,"body");
    }

    if(figure.chainmail){
      cylinder("figure-chainmail-torso",.47,.405,.315,material.chainmail,[0,1.15,.012],null,10,"body");
      cylinder("figure-chainmail-skirt",.30,.345,.375,material.chainmail,[0,.80,.006],null,10,"body");
    }

    box("figure-belt",[.44,.07,.27],material.leather,[0,.96,.015],null,"body");
    box("figure-buckle",[.068,.064,.035],material.metal,[0,.96,.16],null,"body");
    box("figure-pouch",[.13,.16,.08],material.leather,[.20,.87,.12],[0,.08,.04],"body");
    sphere("figure-clasp",.075,material.metal,[-.19,1.36,.11],[1,.70,.45],5,"body");

    if(figure.chestHarness){
      box("figure-harness-a",[.048,.56,.032],material.leatherDark,[-.085,1.18,.158],[0,0,-.43],"body");
      box("figure-harness-b",[.048,.56,.032],material.leather,[.085,1.18,.162],[0,0,.43],"body");
      sphere("figure-harness-ring",.070,material.metal,[0,1.10,.18],[1,.38,.38],7,"body");
    }

    if(figure.beltDetail){
      box("figure-belt-low",[.47,.050,.285],material.leatherDark,[0,.885,.018],[0,0,.035],"body");
      box("figure-belt-low-buckle",[.060,.060,.035],material.metal,[-.095,.885,.17],[0,0,.04],"body");
    }

    if(figure.waistPouches){
      box("figure-waist-pouch-l",[.13,.16,.085],material.leather,[-.235,.84,.085],[0,.08,-.05],"body");
      box("figure-waist-pouch-r",[.13,.15,.080],material.leather,[.235,.85,.08],[0,-.08,.05],"body");
      box("figure-waist-pouch-flap-l",[.115,.045,.095],material.leatherDark,[-.235,.905,.09],[.10,0,0],"body");
      box("figure-waist-pouch-flap-r",[.115,.045,.090],material.leatherDark,[.235,.91,.085],[.10,0,0],"body");
    }

    if(figure.scholarGear){
      // Grimoire + writing-case silhouette, kept as a reusable mage equipment set.
      box("figure-scholar-book",[.17,.29,.075],material.dark,[.245,.79,.105],[0,-.08,.04],"body");
      box("figure-scholar-book-band-a",[.18,.028,.082],material.gold,[.245,.88,.11],[0,-.08,.04],"body");
      box("figure-scholar-book-band-b",[.18,.028,.082],material.gold,[.245,.70,.11],[0,-.08,.04],"body");
      box("figure-scholar-book-spine",[.028,.26,.082],material.gold,[.18,.79,.11],[0,-.08,.04],"body");
      sphere("figure-scholar-book-gem",.050,material.gem,[.255,.79,.155],[.72,1,.42],6,"body");
      box("figure-scholar-pouch",[.13,.17,.085],material.leatherDark,[-.23,.82,.085],[0,.08,-.04],"body");
      sphere("figure-scholar-charm",.042,material.arcane,[-.19,.70,.15],[.65,1,.40],6,"body");
    }

    if(figure.pendant){
      cylinder("figure-pendant-chain",.18,.012,.012,material.metal,[0,1.34,.165],[0,0,0],6,"body");
      sphere("figure-pendant-gem",.070,material.gem,[0,1.23,.185],[.72,1.0,.45],6,"body");
    }

    if(figure.neckAccessory){
      const choker=BABYLON.MeshBuilder.CreateTorus(`figure-choker-${unit.id}`,{diameter:.24*scale,thickness:.025*scale,tessellation:12},this.scene);
      finish(choker,material.leatherDark,[0,1.405,.01],[Math.PI/2,0,0],[1,.80,.85],{part:"body"});
      sphere("figure-neck-gem",.052,material.gem,[0,1.385,.145],[.70,1.0,.42],5,"body");
    }

    if(figure.corsetDetail){
      box("figure-corset-center",[.055,.33,.030],material.accent,[0,1.145,.177],null,"body");
      box("figure-corset-l",[.040,.30,.028],material.leatherDark,[-.13,1.14,.165],[0,0,-.08],"body");
      box("figure-corset-r",[.040,.30,.028],material.leatherDark,[.13,1.14,.165],[0,0,.08],"body");
      for(let i=0;i<3;i++)sphere(`figure-corset-stud-${i}`,.025,material.metal,[0,1.06+i*.075,.195],[.65,.65,.38],5,"body");
    }

    if(figure.thiefGear){
      box("figure-thief-cross-strap-a",[.055,.58,.035],material.leatherDark,[-.075,1.17,.16],[0,0,-.48],"body");
      box("figure-thief-cross-strap-b",[.055,.54,.035],material.leather,[.09,1.16,.165],[0,0,.48],"body");
      box("figure-thief-belt-low",[.48,.055,.285],material.leatherDark,[0,.875,.02],[0,0,.04],"body");
      box("figure-thief-pouch-l",[.14,.18,.09],material.leather,[-.24,.82,.08],[0,.08,-.05],"body");
      box("figure-thief-pouch-r",[.13,.16,.08],material.leather,[.24,.84,.07],[0,-.08,.05],"body");
      sphere("figure-thief-charm",.055,material.gem,[.13,.88,.17],[.70,1.05,.42],5,"body");
    }

    if(figure.upperBreastplate){
      custom("figure-upper-breastplate",[
        [-.215,1.37,.185],[.215,1.37,.185],[.185,1.18,.195],[-.185,1.18,.195],
        [-.17,1.39,.105],[.17,1.39,.105],[.15,1.18,.115],[-.15,1.18,.115]
      ],[
        0,2,1,0,3,2,
        4,5,6,4,6,7,
        0,4,7,0,7,3,
        1,2,6,1,6,5,
        0,1,5,0,5,4,
        3,7,6,3,6,2
      ],material.armor,"body");
      box("figure-upper-breastplate-ridge",[.038,.165,.026],material.steelDark,[0,1.275,.205],null,"body");
      box("figure-upper-breastplate-strap-l",[.045,.30,.025],material.leatherDark,[-.175,1.29,.198],[0,0,-.12],"body");
      box("figure-upper-breastplate-strap-r",[.045,.30,.025],material.leatherDark,[.175,1.29,.198],[0,0,.12],"body");
    }

    if(figure.elfCourtArmor){
      // Gold-framed green-and-ivory armour is a reusable elven court style.
      // All panels use existing torso/arm roots; no extra state or renderer.
      box("figure-elf-cuirass-collar",[.32,.038,.045],material.gold,[0,1.39,.125],null,"body");
      box("figure-elf-cuirass-center",[.044,.33,.029],material.gold,[0,1.18,.210],null,"body");
      sphere("figure-elf-heart-gem",.072,material.gem,[0,1.325,.229],[.72,1.12,.43],8,"body");
      for(const side of [-1,1]){
        const tag=side<0?"l":"r";
        box(`figure-elf-cuirass-edge-${tag}`,[.030,.29,.035],material.gold,[side*.175,1.235,.163],[0,0,-side*.20],"body");
        box(`figure-elf-cuirass-chevrons-${tag}`,[.17,.026,.034],material.gold,[side*.100,1.08,.211],[0,0,side*.24],"body");
        sphere(`figure-elf-shoulder-jewel-${tag}`,.075,material.gem,[side*.30,1.34,.108],[.78,.70,.50],7,tag==="l"?"leftArm":"rightArm");
        box(`figure-elf-arm-scroll-${tag}`,[.145,.026,.030],material.gold,[side*.29,1.205,.133],[0,0,side*.15],tag==="l"?"leftArm":"rightArm");
      }
      box("figure-elf-waist-crest",[.23,.068,.032],material.gold,[0,.95,.160],null,"body");
      sphere("figure-elf-waist-emerald",.064,material.gem,[0,.951,.194],[.85,.85,.45],7,"body");
    }

    if(figure.scaleArmor){
      cylinder("figure-scale-cuirass",.36,.395,.305,material.scale,[0,1.18,.028],null,10,"body");
      cylinder("figure-scale-waist",.23,.305,.315,material.scaleLight,[0,.97,.022],null,10,"body");
      box("figure-scale-gold-spine",[.038,.34,.028],material.gold,[0,1.18,.206],null,"body");
      box("figure-scale-neck-trim",[.31,.035,.032],material.gold,[0,1.37,.17],null,"body");
      box("figure-scale-waist-trim",[.34,.035,.030],material.gold,[0,1.00,.17],null,"body");
      const scaleRows=[
        {y:1.31,xs:[-.15,-.075,0,.075,.15]},
        {y:1.23,xs:[-.18,-.09,0,.09,.18]},
        {y:1.15,xs:[-.15,-.075,0,.075,.15]},
        {y:1.07,xs:[-.12,-.04,.04,.12]}
      ];
      let seaScaleIndex=0;
      for(const row of scaleRows)for(const x of row.xs){
        sphere(`figure-scale-tile-${seaScaleIndex++}`,.085,seaScaleIndex%2?material.scaleLight:material.scale,[x,row.y,.195],[.85,.48,.28],5,"body");
      }
      sphere("figure-scale-chest-gem",.075,material.gem,[0,1.34,.215],[.72,1,.40],7,"body");
    }

    if(figure.militaryTabard){
      // Field uniform: small plain ivory tunic over chainmail, red central stripe.
      // Low segment count keeps mass infantry cheap in tactical view.
      cylinder("figure-infantry-surcoat",.37,.415,.305,material.tabard,[0,1.18,.025],null,8,"body");
      box("figure-infantry-front-stripe",[.075,.37,.027],material.accent,[0,1.18,.193],null,"body");
      box("figure-infantry-shoulder-seam-l",[.075,.14,.040],material.tabard,[-.213,1.34,.045],[0,0,-.18],"body");
      box("figure-infantry-shoulder-seam-r",[.075,.14,.040],material.tabard,[.213,1.34,.045],[0,0,.18],"body");
    }

    if(figure.celestialAttire){
      // Bodice and independent layered cloth. No generic heavy-armour shell.
      cylinder("figure-celestial-bodice",.43,.39,.30,material.tabard,[0,1.18,.02],null,10,"body");
      cylinder("figure-celestial-waist",.23,.29,.29,material.tabard,[0,.97,.02],null,9,"body");
      for(const side of [-1,1]){
        const label=side<0?"l":"r";
        box(`figure-celestial-corset-line-${label}`,[.026,.37,.025],material.gold,[side*.12,1.16,.177],[0,0,side*.20],"body");
        sphere(`figure-celestial-shoulder-gem-${label}`,.065,material.gem,[side*.22,1.39,.135],[.70,.80,.43],6,"body");
        box(`figure-celestial-harness-${label}`,[.026,.41,.024],material.gold,[side*.165,1.17,.177],[0,0,-side*.26],"body");
        box(`figure-celestial-sleeve-band-${label}`,[.14,.035,.12],material.gold,[side*.28,1.16,.075],null,side<0?"leftArm":"rightArm");
      }
      sphere("figure-celestial-bodice-crystal",.085,material.gem,[0,1.31,.205],[.74,1,.40],7,"body");
      box("figure-celestial-center-ornament",[.027,.27,.025],material.gold,[0,1.12,.206],null,"body");
      sphere("figure-celestial-belt-gem",.066,material.gem,[0,.965,.184],[.75,.75,.45],7,"body");
    }

    if(figure.mediumPlate){
      sphere("figure-medium-pauldron-l",.24,material.armor,[-.29,1.31,-.004],[1.15,.48,.95],6,"leftArm");
      sphere("figure-medium-pauldron-r",.22,material.armor,[.29,1.31,-.004],[1.08,.44,.92],6,"rightArm");
      box("figure-medium-pauldron-edge-l",[.19,.025,.16],material.steelDark,[-.31,1.29,.055],[0,0,-.10],"leftArm");
      box("figure-medium-pauldron-edge-r",[.18,.025,.15],material.steelDark,[.31,1.29,.055],[0,0,.10],"rightArm");
    }

    if(figure.heavyArmor){
      cylinder("figure-chest-plate",.38,.42,.34,material.armor,[0,1.18,.025],null,8,"body");
      box("figure-chest-gold-trim",[.31,.055,.305],material.gold,[0,1.24,.08],null,"body");
      sphere("figure-pauldron-l",.27,material.armor,[-.285,1.31,-.005],[1.18,.62,1.02],6,"leftArm");
      sphere("figure-pauldron-r",.27,material.armor,[.285,1.31,-.005],[1.18,.62,1.02],6,"rightArm");
      box("figure-pauldron-gold-l",[.17,.035,.19],material.gold,[-.31,1.34,.025],[0,0,-.12],"leftArm");
      box("figure-pauldron-gold-r",[.17,.035,.19],material.gold,[.31,1.34,.025],[0,0,.12],"rightArm");
      if(figure.armorTrim){
        box("figure-armor-center-ridge",[.060,.30,.035],material.gold,[0,1.18,.195],null,"body");
        sphere("figure-armor-brooch",.085,material.holy,[0,1.34,.205],[.85,.85,.40],7,"body");
        box("figure-pauldron-ridge-l",[.22,.025,.16],material.gold,[-.295,1.285,.10],[0,0,-.13],"leftArm");
        box("figure-pauldron-ridge-r",[.22,.025,.16],material.gold,[.295,1.285,.10],[0,0,.13],"rightArm");
      }
    }

    // Sleeves taper into bracers; bare-arm outfits swap the shared sleeve material
    // for skin while keeping any jewellery / bracer overlays as separate parts.
    const bareArms=figure.bareArms===true;
    const clothSleeves=figure.clothSleeves===true;
    const bareHands=figure.bareHands===true;
    const upperArmMaterial=bareArms?material.skin:material.shirt;
    const forearmMaterial=bareArms?material.skin:(clothSleeves?material.shirt:material.leather);
    const handMaterial=(bareArms||bareHands)?material.skin:material.dark;
    cylinder("figure-upper-arm-l",.30,.14,.12,upperArmMaterial,[-.265,1.20,0],[0,0,-.13],6,"leftArm");
    cylinder("figure-upper-arm-r",.30,.14,.12,upperArmMaterial,[.265,1.20,0],[0,0,.13],6,"rightArm");
    if(figure.chainmail){
      cylinder("figure-chainmail-sleeve-l",.25,.145,.125,material.chainmail,[-.268,1.17,.002],[0,0,-.13],8,"leftArm");
      cylinder("figure-chainmail-sleeve-r",.25,.145,.125,material.chainmail,[.268,1.17,.002],[0,0,.13],8,"rightArm");
    }
    cylinder("figure-forearm-l",.27,.115,.095,forearmMaterial,[-.295,.94,.035],[0,0,-.05],6,"leftArm");
    cylinder("figure-forearm-r",.27,.115,.095,forearmMaterial,[.295,.94,.035],[0,0,.05],6,"rightArm");
    box("figure-glove-l",[.105,.12,.115],handMaterial,[-.305,.755,.055],[0,0,-.03],"leftArm");
    box("figure-glove-r",[.105,.12,.115],handMaterial,[.305,.755,.055],[0,0,.03],"rightArm");
    sphere("figure-fingers-l",.075,figure.darkGloves?handMaterial:material.skin,[-.307,.70,.070],[.72,.65,.72],4,"leftArm");
    sphere("figure-fingers-r",.075,figure.darkGloves?handMaterial:material.skin,[.307,.70,.070],[.72,.65,.72],4,"rightArm");

    if(figure.clothSleeves){
      cylinder("figure-cloth-cuff-l",.085,.155,.145,material.shirt,[-.303,.805,.055],[0,0,-.03],9,"leftArm");
      cylinder("figure-cloth-cuff-r",.085,.155,.145,material.shirt,[.303,.805,.055],[0,0,.03],9,"rightArm");
      box("figure-cloth-cuff-trim-l",[.15,.025,.145],material.accent,[-.303,.82,.07],[0,0,-.03],"leftArm");
      box("figure-cloth-cuff-trim-r",[.15,.025,.145],material.accent,[.303,.82,.07],[0,0,.03],"rightArm");
    }

    if(figure.bracerDetail){
      box("figure-bracer-band-l",[.145,.055,.14],material.metal,[-.298,.99,.04],[0,0,-.05],"leftArm");
      box("figure-bracer-band-r",[.145,.055,.14],material.metal,[.298,.99,.04],[0,0,.05],"rightArm");
      box("figure-bracer-ridge-l",[.045,.20,.025],material.accent,[-.298,.91,.115],[0,0,-.05],"leftArm");
      box("figure-bracer-ridge-r",[.045,.20,.025],material.accent,[.298,.91,.115],[0,0,.05],"rightArm");
    }

    if(figure.gloveDetail){
      box("figure-glove-cuff-l",[.145,.060,.145],material.leatherDark,[-.303,.79,.055],[0,0,-.03],"leftArm");
      box("figure-glove-cuff-r",[.145,.060,.145],material.leatherDark,[.303,.79,.055],[0,0,.03],"rightArm");
      sphere("figure-glove-stud-l",.034,material.metal,[-.303,.805,.13],[.65,.65,.38],5,"leftArm");
      sphere("figure-glove-stud-r",.034,material.metal,[.303,.805,.13],[.65,.65,.38],5,"rightArm");
    }

    if(figure.mediumPlate){
      box("figure-medium-vambrace-l",[.135,.22,.145],material.armor,[-.298,.92,.05],[0,0,-.05],"leftArm");
      box("figure-medium-vambrace-r",[.135,.22,.145],material.armor,[.298,.92,.05],[0,0,.05],"rightArm");
      box("figure-medium-vambrace-band-l",[.145,.030,.15],material.steelDark,[-.298,.84,.065],[0,0,-.05],"leftArm");
      box("figure-medium-vambrace-band-r",[.145,.030,.15],material.steelDark,[.298,.84,.065],[0,0,.05],"rightArm");
    }

    if(figure.heavyArmor){
      cylinder("figure-vambrace-l",.29,.135,.115,material.armor,[-.298,.93,.035],[0,0,-.05],7,"leftArm");
      cylinder("figure-vambrace-r",.29,.135,.115,material.armor,[.298,.93,.035],[0,0,.05],7,"rightArm");
      box("figure-gauntlet-l",[.125,.13,.13],material.armor,[-.307,.755,.060],[0,0,-.03],"leftArm");
      box("figure-gauntlet-r",[.125,.13,.13],material.armor,[.307,.755,.060],[0,0,.03],"rightArm");
      if(figure.armorTrim){
        box("figure-gauntlet-gold-l",[.115,.030,.14],material.gold,[-.307,.805,.075],[0,0,-.03],"leftArm");
        box("figure-gauntlet-gold-r",[.115,.030,.14],material.gold,[.307,.805,.075],[0,0,.03],"rightArm");
      }
    }

    if(figure.seaJewelry){
      const collar=BABYLON.MeshBuilder.CreateTorus(`figure-sea-collar-${unit.id}`,{diameter:.28*scale,thickness:.018*scale,tessellation:16},this.scene);
      finish(collar,material.gold,[0,1.42,.02],[Math.PI/2,0,0],null,{part:"body"});
      sphere("figure-sea-neck-gem",.065,material.gem,[0,1.385,.155],[.65,1,.42],7,"body");
      sphere("figure-sea-hip-gem-l",.060,material.gem,[-.22,.91,.13],[.60,1,.40],6,"body");
      sphere("figure-sea-hip-gem-r",.060,material.gem,[.22,.91,.13],[.60,1,.40],6,"body");
      box("figure-sea-chain-l",[.020,.30,.018],material.gold,[-.18,.78,.13],[0,0,-.20],"body");
      box("figure-sea-chain-r",[.020,.30,.018],material.gold,[.18,.78,.13],[0,0,.20],"body");
    }

    if(figure.ceremonialMantle){
      // Shoulder capelet, leather corset, book and red ribbons are reusable
      // components rather than an ID-specific sacred character mesh.
      custom("figure-mantle-shoulder-l",[[-.41,1.41,.03],[-.12,1.45,.13],[-.09,1.14,.16],[-.48,1.19,.06]],
        [0,2,1,0,3,2],material.tabard,"cape");
      custom("figure-mantle-shoulder-r",[[.12,1.45,.13],[.41,1.41,.03],[.48,1.19,.06],[.09,1.14,.16]],
        [0,2,1,0,3,2],material.tabard,"cape");
      for(const side of [-1,1]){
        const t=side<0?"l":"r";
        box(`figure-mantle-cross-v-${t}`,[.027,.16,.030],material.gold,[side*.28,1.325,.115],null,"cape");
        box(`figure-mantle-cross-h-${t}`,[.11,.027,.030],material.gold,[side*.28,1.34,.115],null,"cape");
        box(`figure-mantle-ribbon-${t}`,[.065,.36,.022],material.accent,[side*.23,1.17,.14],[0,0,side*.34],"cape");
      }
      for(const side of [-1,1]){
        const t=side<0?"l":"r",arm=t==="l"?"leftArm":"rightArm",x=side*.285;
        cylinder(`figure-ceremonial-sleeve-${t}`,.36,.255,.345,material.tabard,[x,1.05,.02],[0,0,side*.08],10,arm);
        cylinder(`figure-ceremonial-cuff-${t}`,.05,.36,.36,material.gold,[x+side*.009,.87,.035],[0,0,side*.08],10,arm);
        cylinder(`figure-ceremonial-cuff-edge-${t}`,.055,.325,.325,material.accent,[x+side*.009,.88,.034],[0,0,side*.08],10,arm);
      }
      box("figure-ceremonial-corset",[.35,.30,.315],material.leatherDark,[0,1.15,.034],null,"body");
      for(const y of [1.29,1.17,1.06]){
        box(`figure-ceremonial-belt-${y}`,[.46,.035,.345],material.leather,[0,y,.03],null,"body");
        box(`figure-ceremonial-buckle-${y}`,[.065,.055,.026],material.gold,[0,y,.211],null,"body");
      }
      box("figure-scripture-book-cover",[.21,.31,.10],material.leatherDark,[-.32,.78,.10],[0,0,-.15],"body");
      box("figure-scripture-book-pages",[.17,.26,.012],material.tabard,[-.33,.78,.166],[0,0,-.15],"body");
      box("figure-scripture-book-cross-v",[.024,.16,.020],material.gold,[-.33,.79,.182],null,"body");
      box("figure-scripture-book-cross-h",[.13,.027,.020],material.gold,[-.33,.81,.182],null,"body");
      sphere("figure-scripture-bell",.085,material.gold,[.15,.84,.13],[.78,.9,.78],7,"body");
      sphere("figure-holy-collar-brooch",.078,material.gold,[0,1.40,.17],[.92,.92,.42],7,"body");
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
    if(figure.seaSandals){
      box("figure-sea-foot-l",[.18,.09,.29],material.skin,[-.115,.065,.075],[-.03,0,0],"leftLeg");
      box("figure-sea-foot-r",[.18,.09,.29],material.skin,[.115,.065,.075],[-.03,0,0],"rightLeg");
      for(const [side,x] of [["l",-.115],["r",.115]]){
        box(`figure-sea-sandal-sole-${side}`,[.19,.025,.31],material.gold,[x,.025,.08],[-.03,0,0],side==="l"?"leftLeg":"rightLeg");
        box(`figure-sea-sandal-strap-a-${side}`,[.025,.34,.025],material.gold,[x-.045,.22,.105],[0,0,-.20],side==="l"?"leftLeg":"rightLeg");
        box(`figure-sea-sandal-strap-b-${side}`,[.025,.34,.025],material.gold,[x+.045,.22,.105],[0,0,.20],side==="l"?"leftLeg":"rightLeg");
        sphere(`figure-sea-sandal-gem-${side}`,.050,material.gem,[x,.22,.135],[.62,1,.42],6,side==="l"?"leftLeg":"rightLeg");
      }
    }else{
      box("figure-boot-shaft-l",[.18,.29,.20],material.boots,[-.115,.245,.025],null,"leftLeg");
      box("figure-boot-shaft-r",[.18,.29,.20],material.boots,[.115,.245,.025],null,"rightLeg");
      box("figure-boot-foot-l",[.19,.11,.31],material.boots,[-.115,.075,.075],[-.03,0,0],"leftLeg");
      box("figure-boot-foot-r",[.19,.11,.31],material.boots,[.115,.075,.075],[-.03,0,0],"rightLeg");
      box("figure-boot-cuff-l",[.205,.07,.215],material.leather,[-.115,.37,.025],[0,0,.02],"leftLeg");
      box("figure-boot-cuff-r",[.205,.07,.215],material.leather,[.115,.37,.025],[0,0,-.02],"rightLeg");
    }

    if(figure.legStraps){
      box("figure-leg-strap-l-a",[.205,.045,.19],material.leatherDark,[-.115,.70,.015],[0,0,.02],"leftLeg");
      box("figure-leg-strap-r-a",[.205,.045,.19],material.leather,[.115,.62,.015],[0,0,-.02],"rightLeg");
      box("figure-leg-strap-r-b",[.205,.045,.19],material.leatherDark,[.115,.52,.015],[0,0,-.02],"rightLeg");
      sphere("figure-leg-ring-r",.055,material.metal,[.205,.60,.10],[.80,.80,.35],6,"rightLeg");
    }

    if(figure.bootDetail){
      box("figure-boot-sole-l",[.205,.045,.34],material.dark,[-.115,.028,.085],null,"leftLeg");
      box("figure-boot-sole-r",[.205,.045,.34],material.dark,[.115,.028,.085],null,"rightLeg");
      box("figure-boot-strap-l",[.20,.045,.225],material.leatherDark,[-.115,.245,.04],[0,0,.02],"leftLeg");
      box("figure-boot-strap-r",[.20,.045,.225],material.leatherDark,[.115,.245,.04],[0,0,-.02],"rightLeg");
      sphere("figure-boot-buckle-l",.045,material.metal,[-.205,.245,.135],[.70,.70,.35],5,"leftLeg");
      sphere("figure-boot-buckle-r",.045,material.metal,[.205,.245,.135],[.70,.70,.35],5,"rightLeg");
    }

    if(figure.thiefGear){
      box("figure-thigh-strap-l",[.21,.055,.19],material.leatherDark,[-.115,.68,.015],[0,0,.02],"leftLeg");
      box("figure-thigh-strap-r",[.21,.055,.19],material.leather,[.115,.61,.015],[0,0,-.02],"rightLeg");
      box("figure-thigh-knife-sheath",[.055,.27,.055],material.leatherDark,[.205,.57,.04],[0,0,-.12],"rightLeg");
    }
    if(figure.mediumPlate){
      box("figure-medium-knee-l",[.17,.14,.18],material.armor,[-.115,.49,.085],[0,0,.02],"leftLeg");
      box("figure-medium-knee-r",[.17,.14,.18],material.armor,[.115,.49,.085],[0,0,-.02],"rightLeg");
      box("figure-medium-shin-plate-l",[.15,.22,.075],material.armor,[-.115,.31,.12],[0,0,.02],"leftLeg");
      box("figure-medium-shin-plate-r",[.15,.22,.075],material.armor,[.115,.31,.12],[0,0,-.02],"rightLeg");
    }
    if(figure.heavyArmor){
      box("figure-greave-l",[.205,.42,.215],material.armor,[-.115,.29,.02],[0,0,.02],"leftLeg");
      box("figure-greave-r",[.205,.42,.215],material.armor,[.115,.29,.02],[0,0,-.02],"rightLeg");
      sphere("figure-knee-l",.18,material.gold,[-.115,.49,.105],[1,.62,.46],5,"leftLeg");
      sphere("figure-knee-r",.18,material.gold,[.115,.49,.105],[1,.62,.46],5,"rightLeg");
      box("figure-sabatons-l",[.21,.115,.33],material.armor,[-.115,.075,.08],[-.03,0,0],"leftLeg");
      box("figure-sabatons-r",[.21,.115,.33],material.armor,[.115,.075,.08],[-.03,0,0],"rightLeg");
      if(figure.armorTrim){
        box("figure-greave-gold-l",[.045,.30,.026],material.gold,[-.115,.30,.145],[0,0,.02],"leftLeg");
        box("figure-greave-gold-r",[.045,.30,.026],material.gold,[.115,.30,.145],[0,0,-.02],"rightLeg");
        box("figure-sabaton-gold-l",[.18,.025,.28],material.gold,[-.115,.095,.175],[-.03,0,0],"leftLeg");
        box("figure-sabaton-gold-r",[.18,.025,.28],material.gold,[.115,.095,.175],[-.03,0,0],"rightLeg");
      }
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
      if(figure.capeLayers){
        custom("figure-cape-inner",[[-.23,1.34,-.235],[.23,1.34,-.235],[.34,.42,-.31],[-.34,.42,-.31]],[0,2,1,0,3,2],material.capeDark,"cape");
        custom("figure-cape-trim-l",[[-.35,1.28,-.17],[-.29,1.29,-.18],[-.47,.33,-.11],[-.53,.31,-.10]],[0,2,1,0,3,2],material.accent,"cape");
        custom("figure-cape-trim-r",[[.29,1.29,-.18],[.35,1.28,-.17],[.53,.31,-.10],[.47,.33,-.11]],[0,2,1,0,3,2],material.accent,"cape");
      }
      if(figure.tatteredCape){
        custom("figure-cape-tatter-l",[[-.43,.74,-.24],[-.20,.72,-.30],[-.36,.14,-.21]],[0,1,2],material.cape,"cape");
        custom("figure-cape-tatter-c",[[-.19,.70,-.31],[.15,.70,-.33],[.02,.08,-.29]],[0,1,2],material.capeDark,"cape");
        custom("figure-cape-tatter-r",[[.16,.72,-.30],[.43,.74,-.24],[.34,.18,-.20]],[0,1,2],material.cape,"cape");
      }
    }

    if(figure.angelWings){
      // Three light mesh layers per side, not a separate mesh for every feather.
      // x/y live in figure coordinates and are converted by the common custom()
      // builder. Geometry is behind the body so it keeps the face/bow readable.
      const featherLayer=(tag,side,part,rows,mat)=>{
        const vertices=[],indices=[];
        for(const [a,b,c] of rows){
          const start=vertices.length;
          vertices.push([side*a[0],a[1],a[2]],[side*b[0],b[1],b[2]],[side*c[0],c[1],c[2]]);
          indices.push(start,start+1,start+2);
        }
        custom(`figure-wing-${tag}`,vertices,indices,mat,part);
      };
      for(const side of [-1,1]){
        const part=side<0?"leftWing":"rightWing",tag=side<0?"l":"r";
        const mantle=[
          [[.22,1.37,-.235],[.44,1.85,-.28],[.76,1.65,-.31]],
          [[.44,1.85,-.28],[1.12,1.97,-.34],[.76,1.65,-.31]],
          [[1.12,1.97,-.34],[1.47,1.54,-.39],[.76,1.65,-.31]],
          [[1.47,1.54,-.39],[1.42,.75,-.42],[.76,1.65,-.31]]
        ];
        featherLayer(`${tag}-mantle`,side,part,mantle,material.pearl);
        const primaries=[],secondaries=[];
        for(let i=0;i<10;i++){
          const t=i/9;
          const baseX=.42+t*.91,baseY=1.80-t*.47;
          primaries.push([
            [baseX,baseY,-.33],[baseX+.20,baseY-.16,-.37],
            [.77+t*.65,1.34-t*.73-(i%2)*.045,-.41]
          ]);
        }
        for(let i=0;i<7;i++){
          const t=i/6;
          secondaries.push([
            [.33+t*.77,1.58-t*.27,-.30],
            [.45+t*.85,1.48-t*.30,-.34],
            [.69+t*.67,1.23-t*.44,-.36]
          ]);
        }
        featherLayer(`${tag}-primaries`,side,part,primaries,material.tabard);
        featherLayer(`${tag}-secondaries`,side,part,secondaries,material.pearl);
        const path=[[side*.23,1.37,-.226],[side*.43,1.80,-.28],[side*.83,1.85,-.32],[side*1.30,1.46,-.39]].map(p=>localPoint(part,p));
        const goldRib=BABYLON.MeshBuilder.CreateTube(`figure-wing-gold-rib-${tag}-${unit.id}`,{
          path,radius:.012*scale,tessellation:5
        },this.scene);
        finish(goldRib,material.gold,null,null,null,{part,castShadow:false});
        for(const [i,x,y] of [[0,.56,1.72],[1,1.17,1.49]]){
          sphere(`figure-wing-sapphire-${tag}-${i}`,.065,material.gem,[side*x,y,-.274],[.72,1,.45],6,part);
          box(`figure-wing-gold-tassel-${tag}-${i}`,[.017,.15,.016],material.gold,[side*x,y-.13,-.267],[0,0,side*.15],part);
        }
      }
    }
    if(figure.angelHalo){
      const halo=BABYLON.MeshBuilder.CreateTorus(`figure-angel-halo-${unit.id}`,{
        diameter:.44*scale,thickness:.022*scale,tessellation:22
      },this.scene);
      finish(halo,material.gold,[0,1.82,-.083],[Math.PI/2,0,0],null,{part:"halo",castShadow:false});
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4,x=Math.cos(a)*.25,y=1.82+Math.sin(a)*.25;
        sphere(`figure-angel-halo-point-${i}`,.075,material.gold,[x,y,-.081],[.65,.85,.52],5,"halo");
      }
      sphere("figure-angel-halo-top-gem",.060,material.gem,[0,2.10,-.075],[.8,1,.48],6,"halo");
    }

    // Quiver and visible arrow tips/fletching.
    if(figure.quiver!==false){
      cylinder("figure-quiver",.56,.14,.18,material.leather,[.275,1.18,-.225],[0,0,-.20],6,"quiver");
      if(figure.quiverDetail){
        cylinder("figure-quiver-rim",.055,.205,.205,material.metal,[.225,1.45,-.225],[0,0,-.20],8,"quiver");
        box("figure-quiver-strap",[.055,.62,.032],material.leatherDark,[.13,1.18,-.205],[0,0,-.42],"quiver");
        sphere("figure-quiver-charm",.050,material.accent,[.36,1.05,-.16],[.70,1.0,.42],5,"quiver");
      }
      for(let i=0;i<(figure.fieldBow?5:3);i++){
        cylinder(`figure-arrow-${i}`,.53,.017,.017,material.bow,[.22+i*.045,1.43,-.225],[0,0,-.20],5,"quiver");
        box(`figure-fletching-${i}`,[.045,.065,.018],figure.fieldBow&&i%2?material.tabard:material.cape,[.17+i*.045,1.65,-.225],[0,0,-.20],"quiver");
      }
    }

    // Issued infantry bow: two low-poly recurve limbs and a hand-wrapped grip.
    // Shares the existing bow part/left-arm attachment with the ceremonial bow.
    // No independent weapon runtime, and the string rotates with the bow.
    if(figure.fieldBow){
      const bowPath=[];
      for(let i=0;i<=12;i++){
        const t=i/12;
        const y=.11+t*1.18;
        const x=-.305+.180*Math.cos(Math.PI*t)**2;
        bowPath.push(localPoint("bow",[x,y,.105]));
      }
      const limb=BABYLON.MeshBuilder.CreateTube(`figure-field-bow-${unit.id}`,{
        path:bowPath,radius:.022*scale,tessellation:6,cap:BABYLON.Mesh.CAP_ALL
      },this.scene);
      finish(limb,material.bow,null,null,null,{part:"bow"});
      cylinder("figure-field-bow-grip",.205,.065,.063,material.leatherDark,[-.305,.70,.105],null,7,"bow");
      for(const y of [.28,1.12]){
        cylinder(`figure-field-bow-tip-band-${y}`,.045,.055,.055,material.steelDark,[-.305+.180*Math.cos(Math.PI*((y-.11)/1.18))**2,y,.105],null,6,"bow");
      }
      const bowstring=BABYLON.MeshBuilder.CreateLines(`figure-field-bow-string-${unit.id}`,{
        points:[bowPath[0],localPoint("bow",[-.103,.70,.105]),bowPath[bowPath.length-1]]
      },this.scene);
      bowstring.parent=figureParts.bow;
      bowstring.color=this.figureColor(colors.bowString||"#c7b9a1");
      bowstring.isPickable=false;
      bowstring.metadata={kind:"unit-part",unitId:unit.id,figurePart:"bow",castShadow:false,lineOnly:true};
      meshes.push(bowstring);
      // Visible grip over the wood, rather than a bow floating beside the glove.
      for(let n=0;n<3;n++)box(`figure-field-bow-knuckle-${n}`,[.038,.044,.024],material.dark,
        [-.307,.745-n*.040,.147],null,"bow");
    }

    // Recurve bow silhouette with a grip and taut string.
    if(figure.bow!==false&&!figure.fieldBow){
      const path=[];
      for(let i=0;i<=12;i++){
        const t=i/12,y=.39+t*1.14;
        const bend=.19*Math.sin(t*Math.PI)+.035*Math.sin(t*Math.PI*3);
        path.push(localPoint("bow",[-.46-bend,y,.18]));
      }
      const bow=BABYLON.MeshBuilder.CreateTube(`figure-bow-${unit.id}`,{path,radius:.018*scale,tessellation:6,cap:BABYLON.Mesh.CAP_ALL},this.scene);
      finish(bow,material.bow,null,null,null,{part:"bow"});
      cylinder("figure-bow-grip",.16,.055,.055,material.leather,[-.46,.96,.18],[0,0,0],6,"bow");
      if(figure.bowDetail){
        cylinder("figure-bow-band-upper",.06,.052,.052,material.metal,[-.49,1.31,.18],[0,0,-.20],7,"bow");
        cylinder("figure-bow-band-lower",.06,.052,.052,material.metal,[-.49,.61,.18],[0,0,.20],7,"bow");
        sphere("figure-bow-gem",.055,material.gem,[-.46,.96,.205],[.72,.72,.42],6,"bow");
      }
      const string=BABYLON.MeshBuilder.CreateLines(`figure-bow-string-${unit.id}`,{
        points:[path[0],localPoint("bow",[-.46,.96,.18]),path[path.length-1]]
      },this.scene);
      string.parent=figureParts.bow;string.color=this.figureColor(colors.bowString||"#d9c6a7");string.isPickable=false;
      string.metadata={kind:"unit-part",unitId:unit.id,figurePart:"bow",castShadow:false,lineOnly:true};meshes.push(string);
    }

    if(figure.holyBow){
      // One white-and-gold bow, gripped at x=-.305 y=.70. Because the bow's
      // pivot is a child of leftArm, raising that arm carries the entire bow.
      const part="bow",path=[];
      for(let i=0;i<=16;i++){
        const t=i/16,y=.18+t*1.34;
        const outside=Math.sin(t*Math.PI);
        const x=-.45+.15*Math.pow(outside,2)+.06*Math.sin(t*Math.PI*2);
        path.push(localPoint(part,[x,y,.105]));
      }
      const arc=BABYLON.MeshBuilder.CreateTube(`figure-holy-bow-white-${unit.id}`,{
        path,radius:.032*scale,tessellation:7
      },this.scene);
      finish(arc,material.pearl,null,null,null,{part});
      const goldLine=path.map(p=>new BABYLON.Vector3(p.x,p.y,p.z+.023*scale));
      const rim=BABYLON.MeshBuilder.CreateTube(`figure-holy-bow-gold-${unit.id}`,{
        path:goldLine,radius:.009*scale,tessellation:5
      },this.scene);
      finish(rim,material.gold,null,null,null,{part});
      cylinder("figure-holy-bow-hand-grip",.17,.06,.055,material.gold,[-.305,.70,.105],null,8,part);
      sphere("figure-holy-bow-sapphire",.087,material.gem,[-.30,.70,.155],[.72,.88,.48],7,part);
      for(const [name,y,x] of [["upper",1.38,-.42],["lower",.30,-.42]]){
        custom(`figure-holy-bow-feather-${name}`,[[x-.12,y+.15,.13],[x+.055,y+.12,.12],[x+.055,y-.13,.13]],
          [0,1,2],material.pearl,part);
        sphere(`figure-holy-bow-gem-${name}`,.065,material.gem,[x,y,.145],[.70,.90,.40],6,part);
      }
      const string=BABYLON.MeshBuilder.CreateLines(`figure-holy-bow-string-${unit.id}`,{
        points:[path[0],path[path.length-1]]
      },this.scene);
      string.parent=figureParts.bow;
      string.isPickable=false;
      string.color=this.figureColor(colors.bowString||"#f7f5ee");
      string.metadata={kind:"unit-part",unitId:unit.id,figurePart:"bow",castShadow:false,lineOnly:true};
      meshes.push(string);
    }

    // Side sword and pommel, kept simple because it is secondary equipment.
    if(figure.sideSword!==false){
      box("figure-side-sword",[.065,.66,.055],material.dark,[.345,.59,-.045],[0,0,-.13],"sword");
      box("figure-side-guard",[.15,.035,.065],material.metal,[.30,.88,-.035],[0,0,-.13],"sword");
      cylinder("figure-side-pommel",.12,.055,.055,material.leather,[.27,.95,-.03],[0,0,-.13],6,"sword");
      if(figure.sideSwordDetail){
        box("figure-side-sheath-band-a",[.090,.035,.075],material.metal,[.35,.70,-.04],[0,0,-.13],"sword");
        box("figure-side-sheath-band-b",[.090,.035,.075],material.metal,[.38,.44,-.05],[0,0,-.13],"sword");
        sphere("figure-side-pommel-gem",.055,material.gem,[.255,1.02,-.025],[.75,.75,.50],6,"sword");
      }
    }

    if(figure.skirtPanels){
      const panel=(name,x,z,mat)=>custom(name,[
        [x-.12,.94,z],[x+.12,.94,z],[x+.17,.38,z+.025],[x-.17,.38,z+.025]
      ],[0,2,1,0,3,2],mat,"skirt");
      panel("figure-skirt-front",0,.13,material.accent);
      panel("figure-skirt-left",-.20,-.02,material.cape);
      panel("figure-skirt-right",.20,-.02,material.cape);
      panel("figure-skirt-back",0,-.15,material.capeDark);
      if(figure.skirtTrim){
        box("figure-skirt-trim-front",[.24,.035,.035],material.accent,[0,.42,.17],null,"skirt");
        box("figure-skirt-trim-l",[.20,.035,.035],material.metal,[-.20,.47,.07],[0,0,.10],"skirt");
        box("figure-skirt-trim-r",[.20,.035,.035],material.metal,[.20,.47,.07],[0,0,-.10],"skirt");
      }
    }

    if(figure.elfCourtDrapes){
      // Asymmetric ceremonial panels, moving with the existing skirt joint.
      // Wide panels echo the illustrated flowing green cape without obscuring
      // both legs or introducing transparent overdraw-heavy materials.
      for(const side of [-1,1]){
        const tag=side<0?"l":"r",x=side*.24;
        custom(`figure-elf-long-overpanel-${tag}`,[
          [side*.10,.945,.11],[side*.32,.945,.09],
          [side*.47,.15,.06],[side*.08,.19,.135]
        ],[0,2,1,0,3,2],material.cape,"skirt");
        custom(`figure-elf-silk-lining-${tag}`,[
          [side*.16,.93,.12],[side*.26,.92,.12],
          [side*.35,.21,.089],[side*.17,.24,.13]
        ],[0,2,1,0,3,2],material.tabard,"skirt");
        box(`figure-elf-hem-band-${tag}`,[.15,.021,.022],material.gold,[side*.24,.24,.157],[0,0,side*.08],"skirt");
        sphere(`figure-elf-hem-gem-${tag}`,.055,material.gem,[side*.30,.23,.173],[.62,1.08,.50],6,"skirt");
      }
      custom("figure-elf-front-leaf-tab",[
        [-.095,.95,.165],[.095,.95,.165],[.075,.42,.183],[-.075,.42,.183]
      ],[0,2,1,0,3,2],material.capeDark,"skirt");
      box("figure-elf-front-gold-inlay",[.038,.39,.024],material.gold,[0,.72,.189],null,"skirt");
    }

    if(figure.scholarRobe){
      custom("figure-scholar-inner-front",[[-.15,.96,.155],[.15,.96,.155],[.19,.24,.13],[-.19,.24,.13]],[0,2,1,0,3,2],material.shirt,"skirt");
      custom("figure-scholar-robe-l",[[-.32,.94,.02],[-.08,.95,.03],[-.12,.10,-.02],[-.43,.22,-.04]],[0,2,1,0,3,2],material.cape,"skirt");
      custom("figure-scholar-robe-r",[[.08,.95,.03],[.32,.94,.02],[.43,.22,-.04],[.12,.10,-.02]],[0,2,1,0,3,2],material.cape,"skirt");
      custom("figure-scholar-robe-back",[[-.28,.94,-.14],[.28,.94,-.14],[.36,.12,-.22],[-.36,.12,-.22]],[0,1,2,0,2,3],material.capeDark,"skirt");
      box("figure-scholar-front-trim",[.032,.62,.025],material.gold,[0,.58,.175],null,"skirt");
      box("figure-scholar-left-trim",[.028,.68,.022],material.gold,[-.27,.55,.05],[0,0,-.06],"skirt");
      box("figure-scholar-right-trim",[.028,.68,.022],material.gold,[.27,.55,.05],[0,0,.06],"skirt");
    }

    if(figure.ceremonialRobe){
      // Long opaque skirt replaces the short panel silhouette. All layers are
      // parented to the same skirt pivot, so walking and spell poses agree.
      const lining=cylinder("figure-ceremonial-lining",.97,.42,1.20,material.accent,[0,.48,-.008],null,14,"skirt");
      lining.scaling.z=.76;
      const gown=cylinder("figure-ceremonial-gown",.92,.415,1.09,material.tabard,[0,.505,.025],null,14,"skirt");
      gown.scaling.z=.78;
      const panel=(name,pts,mat)=>custom(name,pts,[0,2,1,0,3,2],mat,"skirt");
      // Contrasting inner folds and raised over-panels: no exposed thigh.
      panel("figure-ceremonial-front-left",[[-.29,.94,.20],[-.025,.94,.21],[.035,.09,.425],[-.48,.08,.39]],material.tabard);
      panel("figure-ceremonial-front-right",[[.025,.94,.21],[.29,.94,.20],[.48,.10,.39],[-.035,.09,.425]],material.tabard);
      panel("figure-ceremonial-red-left",[[-.34,.91,.08],[-.24,.92,.18],[-.56,.055,.28],[-.70,.12,.13]],material.accent);
      panel("figure-ceremonial-red-right",[[.24,.92,.18],[.34,.91,.08],[.70,.12,.13],[.56,.055,.28]],material.accent);
      panel("figure-ceremonial-back-left",[[-.30,.96,-.12],[0,.95,-.18],[0,.06,-.48],[-.66,.08,-.35]],material.tabard);
      panel("figure-ceremonial-back-right",[[0,.95,-.18],[.30,.96,-.12],[.66,.08,-.35],[0,.06,-.48]],material.tabard);
      // Emblems stay on the moving robe, not on the leg joints.
      if(figure.robeEmbroidery){
        for(const [i,y,z] of [[0,.78,.265],[1,.56,.333],[2,.34,.397]]){
          box(`figure-robe-cross-v-${i}`,[.022,.090,.018],material.gold,[0,y,z],null,"skirt");
          box(`figure-robe-cross-h-${i}`,[.074,.018,.019],material.gold,[0,y+.012,z+.002],null,"skirt");
        }
        for(const side of [-1,1]){
          const tag=side<0?"l":"r";
          box(`figure-robe-hem-gold-${tag}`,[.21,.020,.022],material.gold,[side*.30,.165,.405],null,"skirt");
          sphere(`figure-robe-hem-gem-${tag}`,.040,material.gold,[side*.32,.23,.415],[.60,.95,.35],5,"skirt");
        }
      }
    }

    if(figure.royalTabard){
      custom("figure-tabard-front",[[-.16,.98,.155],[.16,.98,.155],[.20,.28,.13],[-.20,.28,.13]],[0,2,1,0,3,2],material.tabard,"skirt");
      custom("figure-tabard-back",[[-.17,.96,-.17],[.17,.96,-.17],[.23,.22,-.16],[-.23,.22,-.16]],[0,1,2,0,2,3],material.cape,"skirt");
      box("figure-tabard-gold",[.055,.60,.025],material.gold,[0,.62,.17],null,"skirt");
      if(figure.tabardDetail){
        box("figure-tabard-top-trim",[.30,.040,.028],material.gold,[0,.94,.18],null,"skirt");
        sphere("figure-tabard-emblem",.080,material.holy,[0,.78,.19],[.90,.90,.35],7,"skirt");
        box("figure-tabard-bottom-trim",[.31,.035,.026],material.gold,[0,.31,.16],null,"skirt");
      }
    }

    if(figure.militaryTabard){
      // Cloth hangs from the shared skirt pivot, not from each leg; boots and
      // knee guards remain visible and can animate independently.
      custom("figure-infantry-tabard-front",[
        [-.23,.96,.175],[.23,.96,.175],[.25,.47,.195],[-.25,.47,.195]
      ],[0,2,1,0,3,2],material.tabard,"skirt");
      custom("figure-infantry-tabard-stripe",[
        [-.045,.955,.185],[.045,.955,.185],[.048,.47,.203],[-.048,.47,.203]
      ],[0,2,1,0,3,2],material.accent,"skirt");
      custom("figure-infantry-tabard-back",[
        [-.20,.95,-.185],[.20,.95,-.185],[.235,.47,-.17],[-.235,.47,-.17]
      ],[0,1,2,0,2,3],material.tabard,"skirt");
    }

    if(figure.celestialDrapes){
      // Light outer silk with blue reverse layers. Movement uses the shared
      // skirt pivot; the legs remain real and visible beneath the front split.
      const capelet=(name,points,mat)=>custom(name,points,[0,2,1,0,3,2],mat,"skirt");
      capelet("figure-celestial-front-l",[[-.28,.94,.16],[-.02,.94,.20],[-.13,.22,.27],[-.48,.12,.15]],material.tabard);
      capelet("figure-celestial-front-r",[[.02,.94,.20],[.28,.94,.16],[.48,.12,.15],[.13,.22,.27]],material.tabard);
      capelet("figure-celestial-inner-l",[[-.35,.95,.01],[-.19,.95,.09],[-.57,.08,.10],[-.70,.18,-.03]],material.cape);
      capelet("figure-celestial-inner-r",[[.19,.95,.09],[.35,.95,.01],[.70,.18,-.03],[.57,.08,.10]],material.cape);
      capelet("figure-celestial-back",[[-.28,.92,-.15],[.28,.92,-.15],[.64,.05,-.28],[-.64,.05,-.28]],material.tabard);
      for(const side of [-1,1]){
        const tag=side<0?"l":"r";
        box(`figure-celestial-hem-gold-${tag}`,[.023,.47,.023],material.gold,[side*.29,.48,.188],[0,0,side*.10],"skirt");
        sphere(`figure-celestial-hem-gem-${tag}`,.060,material.gem,[side*.34,.26,.190],[.70,1,.45],6,"skirt");
      }
    }

    if(figure.seaDrapes){
      const finPanel=(name,points,mat)=>custom(name,points,[0,2,1,0,3,2],mat,"skirt");
      finPanel("figure-sea-drape-front",[[-.12,.96,.16],[.12,.96,.16],[.18,.30,.14],[-.18,.30,.14]],material.pearl);
      finPanel("figure-sea-drape-left",[[-.28,.92,.04],[-.08,.94,.02],[-.18,.18,-.02],[-.42,.30,-.03]],material.scaleLight);
      finPanel("figure-sea-drape-right",[[.08,.94,.02],[.28,.92,.04],[.42,.30,-.03],[.18,.18,-.02]],material.scaleLight);
      finPanel("figure-sea-drape-back",[[-.24,.93,-.13],[.24,.93,-.13],[.34,.20,-.22],[-.34,.20,-.22]],material.cape);
      custom("figure-sea-fin-tail-l",[[-.40,.44,-.06],[-.15,.36,-.10],[-.34,.08,-.10]],[0,1,2],material.cape,"skirt");
      custom("figure-sea-fin-tail-r",[[.15,.36,-.10],[.40,.44,-.06],[.34,.08,-.10]],[0,1,2],material.cape,"skirt");
      box("figure-sea-drape-gold-l",[.025,.58,.022],material.gold,[-.19,.60,.16],[0,0,-.08],"skirt");
      box("figure-sea-drape-gold-r",[.025,.58,.022],material.gold,[.19,.60,.16],[0,0,.08],"skirt");
      sphere("figure-sea-drape-gem-l",.052,material.gem,[-.20,.34,.17],[.60,1,.42],6,"skirt");
      sphere("figure-sea-drape-gem-r",.052,material.gem,[.20,.34,.17],[.60,1,.42],6,"skirt");
    }

    if(figure.catTail){
      const tailPath=[[0,.88,-.17],[-.18,.82,-.22],[-.36,.92,-.28],[-.43,1.10,-.27],[-.31,1.27,-.22],[-.12,1.31,-.18]].map(point=>localPoint("tail",point));
      const tailMesh=BABYLON.MeshBuilder.CreateTube(`figure-cat-tail-${unit.id}`,{path:tailPath,radius:.060*scale,tessellation:7,cap:BABYLON.Mesh.CAP_ALL},this.scene);
      finish(tailMesh,material.tail,null,null,null,{part:"tail"});
      sphere("figure-cat-tail-tip",.15,material.tailTip,[-.12,1.31,-.18],[1.0,.78,.78],6,"tail");
    }

    if(figure.fieldTowerShield){
      // Reusable low-poly tower shield: solid steel core, forest-green field,
      // a simple branch emblem. Geometry is built in shield local space and
      // inherits the left glove pivot instead of floating in world space.
      const outline=[
        [-.55,1.57],[-.79,1.48],[-.87,1.09],[-.78,.55],
        [-.56,.20],[-.35,.55],[-.28,1.09],[-.36,1.48]
      ];
      const shieldPlate=(name,shape,front,back,mat)=>{
        const n=shape.length;
        const pts=[...shape.map(([x,y])=>[x,y,front]),...shape.map(([x,y])=>[x,y,back])];
        const indices=[];
        for(let i=1;i<n-1;i++)indices.push(0,i,i+1,n,n+i+1,n+i);
        for(let i=0;i<n;i++){
          const j=(i+1)%n;
          indices.push(i,n+i,j,j,n+i,n+j);
        }
        return custom(name,pts,indices,mat,"shield");
      };
      shieldPlate("figure-tower-shield-iron",outline,.260,.190,material.armor);
      // A flat front panel is opaque: no transparency sorting cost on mobile.
      const inset=outline.map(([x,y])=>[-.56+(x+.56)*.90,.885+(y-.885)*.94]);
      shieldPlate("figure-tower-shield-painted-field",inset,.285,.262,material.cape);
      box("figure-tower-shield-center-rib",[.034,.83,.025],material.metal,[-.56,.925,.303],null,"shield");
      for(const side of [-1,1]){
        box(`figure-tower-shield-leaf-${side}`,[.17,.034,.024],material.tabard,
          [-.56+side*.09,1.16,.321],[0,0,side*.42],"shield");
        box(`figure-tower-shield-lower-leaf-${side}`,[.13,.030,.024],material.tabard,
          [-.56+side*.07,.87,.322],[0,0,side*.48],"shield");
      }
      sphere("figure-tower-shield-center-boss",.080,material.metal,[-.56,1.05,.326],[.8,.8,.35],7,"shield");
    }

    if(figure.fieldWarHammer){
      // The leather haft crosses the RIGHT glove. The hammerhead sits below
      // the grip in a relaxed stance and swings as a single wrist-owned part.
      cylinder("figure-field-hammer-haft",.65,.067,.073,material.leatherDark,[.307,.545,.075],null,8,"weapon");
      cylinder("figure-field-hammer-ferrule",.07,.103,.103,material.metal,[.307,.32,.075],null,8,"weapon");
      box("figure-field-hammer-head",[.34,.22,.24],material.armor,[.307,.247,.075],null,"weapon");
      box("figure-field-hammer-face",[.24,.15,.024],material.cape,[.307,.247,.210],null,"weapon");
      box("figure-field-hammer-crest",[.035,.11,.026],material.tabard,[.307,.247,.227],null,"weapon");
      box("figure-field-hammer-grip-band",[.085,.028,.082],material.metal,[.307,.745,.075],null,"weapon");
      sphere("figure-field-hammer-pommel",.082,material.metal,[.307,.889,.075],[.85,.8,.85],6,"weapon");
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
      if(figure.rapierDetail){
        const knuckle=BABYLON.MeshBuilder.CreateTorus(`figure-rapier-knuckle-${unit.id}`,{diameter:.14*scale,thickness:.014*scale,tessellation:12},this.scene);
        finish(knuckle,material.metal,[.335,.93,.075],[Math.PI/2,0,.25],null,{part:"weapon"});
        box("figure-rapier-fulleredge",[.018,.76,.012],material.accent,[.335,.48,.10],[0,0,-.05],"weapon");
      }
    }

    if(figure.arcaneStaff){
      cylinder("figure-arcane-staff-shaft",1.18,.042,.048,material.leatherDark,[.31,.82,.075],[0,0,-.035],9,"weapon");
      cylinder("figure-arcane-staff-grip",.24,.058,.058,material.leather,[.30,.88,.075],[0,0,-.035],8,"weapon");
      const ringA=BABYLON.MeshBuilder.CreateTorus(`figure-arcane-staff-ring-a-${unit.id}`,{diameter:.34*scale,thickness:.018*scale,tessellation:18},this.scene);
      finish(ringA,material.gold,[.31,1.39,.075],[Math.PI/2,0,.18],null,{part:"weapon"});
      const ringB=BABYLON.MeshBuilder.CreateTorus(`figure-arcane-staff-ring-b-${unit.id}`,{diameter:.27*scale,thickness:.016*scale,tessellation:16},this.scene);
      finish(ringB,material.metal,[.31,1.39,.075],[Math.PI/2,.18,-.22],null,{part:"weapon"});
      sphere("figure-arcane-staff-orb",.20,material.arcane,[.31,1.39,.085],[1,1,1],10,"weapon");
      for(let i=0;i<4;i++){
        const a=i*Math.PI/2+.20,x=.31+Math.cos(a)*.19,z=.075+Math.sin(a)*.035;
        box(`figure-arcane-staff-ray-${i}`,[.045,.19,.035],material.gold,[x,1.39+Math.sin(a)*.17,z],[0,0,-a],"weapon");
      }
      box("figure-arcane-staff-crown",[.095,.25,.065],material.arcane,[.31,1.66,.075],[0,0,.08],"weapon");
      for(const [i,x] of [[0,.22],[1,.31],[2,.40]]){
        box(`figure-arcane-staff-chain-${i}`,[.015,.20,.015],material.gold,[x,1.20,.075],[0,0,0],"weapon");
        sphere(`figure-arcane-staff-drop-${i}`,.065,material.arcane,[x,1.08-(i===1?.06:0),.075],[.65,1.25,.42],6,"weapon");
      }
      sphere("figure-arcane-staff-pommel",.070,material.gold,[.27,.18,.075],[.82,.82,.82],6,"weapon");
    }

    if(figure.holyScepter){
      // The center shaft passes through the right-hand grip at x=.30 y=.76.
      cylinder("figure-holy-scepter-shaft",1.60,.052,.060,material.leatherDark,[.305,1.00,.075],null,9,"weapon");
      for(const y of [.39,.79,1.30,1.57]){
        cylinder(`figure-holy-scepter-ferrule-${y}`,.084,.092,.092,material.gold,[.305,y,.075],null,9,"weapon");
        sphere(`figure-holy-scepter-garnet-${y}`,.053,material.gem,[.305,y,.13],[.75,.80,.38],6,"weapon");
      }
      const head=BABYLON.MeshBuilder.CreateTorus(`figure-holy-scepter-halo-${unit.id}`,{
        diameter:.34*scale,thickness:.034*scale,tessellation:16
      },this.scene);
      finish(head,material.gold,[.305,1.80,.075],[Math.PI/2,0,0],null,{part:"weapon"});
      box("figure-holy-scepter-cross-v",[.050,.40,.037],material.gold,[.305,1.80,.083],null,"weapon");
      box("figure-holy-scepter-cross-h",[.40,.052,.037],material.gold,[.305,1.80,.083],null,"weapon");
      sphere("figure-holy-scepter-crystal",.125,material.holy,[.305,1.80,.120],[1.0,1.0,.48],8,"weapon");
      for(const [tag,dx,dy] of [["t",0,.23],["b",0,-.23],["l",-.23,0],["r",.23,0]]){
        sphere(`figure-holy-scepter-point-${tag}`,.080,material.gold,[.305+dx,1.80+dy,.086],[.60,1.1,.55],5,"weapon");
      }
      for(const [tag,dx] of [["l",-.14],["r",.14]]){
        box(`figure-holy-scepter-ribbon-${tag}`,[.045,.38,.014],material.accent,[.305+dx,1.44,.072],[0,0,dx*.50],"weapon");
        sphere(`figure-holy-scepter-charm-${tag}`,.040,material.gold,[.305+dx*1.35,1.22,.073],[.55,1.1,.45],5,"weapon");
      }
      sphere("figure-holy-scepter-finial",.085,material.gold,[.305,.17,.077],[.68,1.25,.68],7,"weapon");
    }

    if(figure.trident){
      cylinder("figure-trident-shaft",1.18,.040,.045,material.leatherDark,[.31,.68,.075],[0,0,-.04],8,"weapon");
      box("figure-trident-center-prong",[.055,.42,.045],material.weapon,[.31,.10,.075],[0,0,-.04],"weapon");
      custom("figure-trident-left-prong",[[.28,.28,.075],[.10,.04,.075],[.17,.37,.075]],[0,1,2],material.weapon,"weapon");
      custom("figure-trident-right-prong",[[.34,.28,.075],[.52,.04,.075],[.45,.37,.075]],[0,2,1],material.weapon,"weapon");
      box("figure-trident-crossguard",[.36,.045,.070],material.gold,[.31,.31,.075],[0,0,-.04],"weapon");
      sphere("figure-trident-gem",.095,material.gem,[.31,.27,.105],[.72,1,.42],7,"weapon");
      box("figure-trident-gold-spine",[.025,.30,.052],material.gold,[.31,.12,.105],[0,0,-.04],"weapon");
      sphere("figure-trident-pommel",.075,material.gold,[.265,1.31,.075],[.82,.82,.82],6,"weapon");
    }

    if(figure.fieldSpear){
      // Standard infantry spear: single issued leaf-point, iron socket and
      // leather-wrapped wooden shaft. The whole weapon is under LEFT glove.
      const x=-.307,z=.086;
      cylinder("figure-field-spear-shaft",1.88,.050,.054,material.leatherDark,[x,1.095,z],null,7,"leftWeapon");
      cylinder("figure-field-spear-grip",.32,.062,.060,material.leather,[x,.755,z],null,7,"leftWeapon");
      cylinder("figure-field-spear-iron-socket",.185,.083,.066,material.steelDark,[x,2.057,z],null,7,"leftWeapon");
      // Diamond-shaped double-sided tapered point (width .23, length .42).
      custom("figure-field-spear-steel-point",[
        [x,2.40,z], [x-.105,2.045,z], [x,1.982,z], [x+.105,2.045,z],
        [x,2.106,z+.035], [x,2.106,z-.035]
      ],[
        0,1,4, 1,2,4, 2,3,4, 3,0,4,
        1,0,5, 2,1,5, 3,2,5, 0,3,5
      ],material.weapon,"leftWeapon");
      cylinder("figure-field-spear-shaft-cap",.085,.078,.078,material.steelDark,[x,.190,z],null,7,"leftWeapon");
      // Positive grip in front of the wrapped haft, the forearm owns it.
      for(let finger=0;finger<3;finger++){
        box(`figure-field-spear-knuckle-${finger}`,[.028,.047,.028],material.leatherDark,
          [x-.036+finger*.034,.738+finger*.004,z+.059],[0,0,-.09],"leftArm");
      }
    }

    if(figure.armingSword){
      // Standard arming sword: cheap and visibly held, not a detached hip prop.
      // Blade begins just below the fist and angles clear of the soldier's leg.
      custom("figure-arming-sword-steel",[
        [.295,.592,.065],[.360,.592,.065],[.585,.102,.065],[.545,.035,.065]
      ],[0,2,1,0,3,2,1,2,0,2,3,0],material.weapon,"weapon");
      box("figure-arming-sword-fuller",[.017,.44,.016],material.steelDark,[.422,.335,.076],[0,0,.36],"weapon");
      box("figure-arming-sword-guard",[.250,.047,.082],material.steelDark,[.325,.615,.070],[0,0,.03],"weapon");
      cylinder("figure-arming-sword-grip",.195,.048,.048,material.leatherDark,[.307,.705,.070],[0,0,0],7,"weapon");
      sphere("figure-arming-sword-pommel",.068,material.metal,[.307,.823,.070],[.88,.80,.88],6,"weapon");
      // Three overlapping knuckle shapes show a positive grip over the sword.
      for(let finger=0;finger<3;finger++){
        box(`figure-arming-sword-knuckle-${finger}`,[.031,.042,.023],material.dark,
          [.288+finger*.019,.685+finger*.010,.120],[0,0,-.23],"rightArm");
      }
    }

    if(figure.fieldGreatsword){
      box("figure-field-greatsword-blade",[.125,1.12,.050],material.weapon,[.31,.46,.075],[0,0,-.04],"weapon");
      box("figure-field-greatsword-fuller",[.032,.98,.056],material.steelDark,[.31,.48,.077],[0,0,-.04],"weapon");
      box("figure-field-greatsword-guard",[.36,.050,.082],material.metal,[.285,1.01,.075],[0,0,-.04],"weapon");
      cylinder("figure-field-greatsword-grip",.29,.054,.054,material.leatherDark,[.275,1.18,.075],[0,0,-.04],8,"weapon");
      sphere("figure-field-greatsword-pommel",.080,material.metal,[.268,1.35,.075],[.82,.82,.82],6,"weapon");
      box("figure-field-greatsword-guard-core",[.060,.075,.088],material.steelDark,[.285,1.01,.075],[0,0,-.04],"weapon");
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
      if(figure.greatswordDetail){
        box("figure-greatsword-edge-l",[.018,.98,.060],material.holy,[.265,.50,.076],[0,0,-.04],"weapon");
        box("figure-greatsword-edge-r",[.018,.98,.060],material.holy,[.355,.50,.076],[0,0,-.04],"weapon");
        sphere("figure-greatsword-pommel-aura",.13,material.holy,[.27,1.295,.075],[.85,.85,.40],7,"weapon");
      }
    }

    if(figure.blessedGreatsword){
      // Knightly elven two-hand sword. Grip lies inside the existing right
      // glove; the blade is a wrist-owned part rather than a floating prop.
      // Forward (positive Z) faces the viewer and reads at tactical zoom.
      const blade=[
        [.245,.615,.10],[.38,.615,.10],
        [.385,.26,.105],[.355,.10,.105],[.315,.015,.102],
        [.275,.10,.105],[.242,.26,.105]
      ];
      custom("figure-blessed-sword-blade",blade,[
        0,1,2, 0,2,3, 0,3,4, 0,4,5, 0,5,6,
        2,1,0, 3,2,0, 4,3,0, 5,4,0, 6,5,0
      ],material.weapon,"weapon");
      box("figure-blessed-sword-fuller",[.030,.43,.018],material.armor,[.315,.395,.118],null,"weapon");
      box("figure-blessed-sword-gold-inlay",[.018,.33,.025],material.gold,[.315,.39,.136],null,"weapon");
      box("figure-blessed-sword-guard",[.41,.047,.095],material.gold,[.314,.638,.098],[0,0,-.045],"weapon");
      for(const side of [-1,1]){
        const tag=side<0?"l":"r";
        box(`figure-blessed-sword-wing-${tag}`,[.13,.036,.059],material.armor,[.314+side*.185,.655,.098],[0,0,side*.35],"weapon");
        sphere(`figure-blessed-sword-guard-gem-${tag}`,.048,material.gem,[.314+side*.14,.665,.137],[.7,.9,.5],6,"weapon");
      }
      cylinder("figure-blessed-sword-hilt",.355,.066,.066,material.leatherDark,[.307,.775,.07],null,8,"weapon");
      for(let i=0;i<4;i++){
        cylinder(`figure-blessed-sword-hilt-wrap-${i}`,.023,.073,.073,material.gold,[.307,.705+i*.060,.071],null,8,"weapon");
      }
      sphere("figure-blessed-sword-pommel",.090,material.gold,[.307,.972,.070],[.86,.96,.82],8,"weapon");
      sphere("figure-blessed-sword-pommel-jewel",.060,material.gem,[.307,.972,.122],[.62,.76,.33],7,"weapon");
      sphere("figure-blessed-sword-heart",.087,material.holy,[.315,.635,.165],[.69,.82,.42],8,"weapon");
      box("figure-blessed-sword-blessing",[.012,.39,.014],material.holy,[.315,.39,.153],null,"weapon");
      // Glove knuckles are attached to the arm, not the sword, so they
      // remain coherent when swinging and resetting the wrist pivot.
      for(let i=0;i<3;i++)box(`figure-blessed-sword-knuckle-${i}`,[.028,.040,.026],material.leatherDark,
        [.280+i*.028,.690+i*.008,.122],[0,0,-.12],"rightArm");
    }

    const entry=this.batchFigureParts(unit,signature,root,figureParts,meshes,material,height,definition);
    this.figureBuildStats.buildMs+=performance.now()-geometryBuildStart;
    return entry;
  }

  createBird(unit,definition,signature=this.visualSignature(unit,definition)){
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
    const bodyMat=this.figureMaterial("bird-body",colors.body||"#65452f"),wingMat=this.figureMaterial("bird-wing",colors.wing||"#4b3326"),lightMat=this.figureMaterial("bird-light",colors.light||"#d8c6a1"),headMat=this.figureMaterial("bird-head-light",colors.head||colors.light||"#e2dccb"),beakMat=this.figureMaterial("bird-beak",colors.beak||"#c89534"),eyeMat=this.figureMaterial("bird-eye",colors.eyes||"#d3a42e"),talonMat=this.figureMaterial("bird-talon",colors.talons||"#b18a4a");
    const material={body:bodyMat,wing:wingMat,light:lightMat,head:headMat,
      beak:beakMat,eye:eyeMat,talon:talonMat};
    // Bird wings/tail articulate through the SAME pivots as before. Share the
    // figure geometry batching owner for immutable bird primitives; keeping
    // a separate bird batching/shadow runtime would duplicate ownership.
    const template=this.figureTemplates.get(signature);
    if(template){
      this.figureBuildStats.templatesReused++;
      return this.instantiateFigureTemplate(unit,template,birdParts,root,material,height,definition,"BIRD");
    }
    const geometryBuildStart=performance.now();
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
    sphere("bird-head",.20,headMat,"head",[0,.50,.11],[1,.95,1]);
    sphere("bird-neck",.19,headMat,"body",[0,.405,.055],[1.02,1.15,.92]);
    const beak=BABYLON.MeshBuilder.CreateCylinder(`bird-beak-${unit.id}`,{height:.16*scale,diameterTop:0,diameterBottom:.09*scale,tessellation:6},this.scene);
    finish(beak,beakMat,"head",[0,.48,.245],[Math.PI/2,0,0]);
    sphere("bird-eye-l",.035,eyeMat,"head",[-.065,.525,.18],[.7,.7,.55]);sphere("bird-eye-r",.035,eyeMat,"head",[.065,.525,.18],[.7,.7,.55]);
    const wing=(name,part,sign)=>{
      const mesh=new BABYLON.Mesh(`${name}-${unit.id}`,this.scene),positions=[0,0,0,sign*.34*scale,.015*scale,-.02*scale,sign*.52*scale,-.02*scale,-.08*scale,sign*.30*scale,-.04*scale,.07*scale],indices=[0,1,2,0,2,3],normals=[];
      BABYLON.VertexData.ComputeNormals(positions,indices,normals);const data=new BABYLON.VertexData();Object.assign(data,{positions,indices,normals});data.applyToMesh(mesh);
      finish(mesh,wingMat,part);return mesh;
    };
    wing("bird-wing-l","leftWing",-1);wing("bird-wing-r","rightWing",1);

    const feather=(name,part,sign,y,z,length,rot)=>{
      const mesh=BABYLON.MeshBuilder.CreateBox(`${name}-${unit.id}`,{width:.075*scale,height:.018*scale,depth:length*scale},this.scene);
      finish(mesh,wingMat,part,[sign*(.18+Math.abs(z)*.16),y,z],[0,sign*rot,sign*.08]);
    };
    for(let i=0;i<4;i++){
      feather(`bird-primary-l-${i}`,"leftWing",-1,.34-i*.010,-.10-i*.055,.25+i*.035,.12+i*.05);
      feather(`bird-primary-r-${i}`,"rightWing",1,.34-i*.010,-.10-i*.055,.25+i*.035,.12+i*.05);
    }

    for(let i=-1;i<=1;i++){
      const mesh=BABYLON.MeshBuilder.CreateBox(`bird-tail-feather-${i}-${unit.id}`,{width:.07*scale,height:.025*scale,depth:.36*scale},this.scene);
      finish(mesh,wingMat,"tail",[i*.07,.26,-.31],[.08,i*.08,0]);
    }

    for(const sign of [-1,1]){
      const legX=sign*.075;
      const leg=BABYLON.MeshBuilder.CreateCylinder(`bird-leg-${sign}-${unit.id}`,{height:.16*scale,diameter:.032*scale,tessellation:6},this.scene);
      finish(leg,talonMat,"body",[legX,.18,.035],[0,0,0]);
      for(let toe=0;toe<3;toe++){
        const claw=BABYLON.MeshBuilder.CreateCylinder(`bird-talon-${sign}-${toe}-${unit.id}`,{height:.10*scale,diameterTop:.012*scale,diameterBottom:.022*scale,tessellation:5},this.scene);
        finish(claw,talonMat,"body",[legX+(toe-1)*.025,.105,.085+toe*.012],[Math.PI/2.8,0,(toe-1)*.20]);
      }
    }

    const entry=this.batchFigureParts(unit,signature,root,birdParts,meshes,material,height,definition,"BIRD");
    this.figureBuildStats.buildMs+=performance.now()-geometryBuildStart;
    return entry;
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
    const visible=mode==="DIVING"||mode==="SINKING"||mode==="FLYING";
    cue.ring.setEnabled(visible);cue.stem.setEnabled(false);
    if(!visible)return;
    const submerged=mode==="DIVING"||mode==="SINKING",material=submerged?this.materials.submerged:this.materials.airborne;
    const surfaceWorld=Number(unit.verticalSurfaceZ??unit.renderZ??unit.z??0)*ELEVATION_HEIGHT;
    const unitWorld=Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT;
    cue.ring.material=material;cue.stem.material=material;
    cue.ring.position.set(Number(unit.x||0)*TILE_SIZE,surfaceWorld+.055,Number(unit.y||0)*TILE_SIZE);
    cue.ring.scaling.setAll(submerged?1.06:.88);
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
    const entryStart=performance.now();
    const kind=String(definition?.kind||"CAPSULE").toUpperCase();
    const visual=kind==="BILLBOARD"
      ?this.createBillboard(unit,definition)
      :kind==="FIGURE"
        ?this.createFigure(unit,definition,signature)
        :kind==="BIRD"
          ?this.createBird(unit,definition,signature)
          :this.createCapsule(unit);
    const facingMarker=this.createFacingMarker(unit);
    const animationBadge=this.createAnimationBadge(unit);
    const verticalCue=this.createVerticalCue(unit);
    const entry={
      ...visual,signature,facingMarker,animationBadge,verticalCue,definition,lastUnit:{...unit},baseScale:1,
      basePosition:new BABYLON.Vector3(0,0,0),baseMarkerPosition:new BABYLON.Vector3(0,0,0)
    };
    // Pivot membership and bind poses are immutable for this visual entry.
    // Keep references on the existing entry; no secondary animation owner.
    entry.poseResetParts=[
      ...Object.values(entry.figureParts||{}).map(node=>({node,base:node?.metadata?.figureBase})),
      ...Object.values(entry.birdParts||{}).map(node=>({node,base:node?.metadata?.birdBase}))
    ].filter(item=>item.node&&item.base);
    this.entries.set(unit.id,entry);
    this.meshes.set(unit.id,entry.root);
    this.figureBuildStats.entriesCreated++;
    this.figureBuildStats.entryBuildMs+=performance.now()-entryStart;
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
    this.figureBuildStats.entriesDisposed++;
    this.meshes.delete(id);
    this.animationQueues.delete(id);
    this.activeAnimations.delete(id);
  }

  setVisibility(entry,value){
    for(const mesh of entry?.meshes||[])mesh.visibility=value;
    for(const mesh of entry?.facingMarker?.meshes||[])mesh.visibility=value;
  }

  applyFacing(entry,unit,definition,facingOverride=null,animationState="IDLE",resolvedAnimation=null){
    const facing=normalizeFacing(facingOverride??unit?.facing),angle=FACING_ANGLE[facing];
    entry.facingMarker.root.rotation.y=angle;
    if(entry.kind!=="BILLBOARD")entry.root.rotation.y=angle;

    const animation=resolvedAnimation||this.animationDefinition(unit,animationState);
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

  setBillboardAsset(entry,unit,state,facing,progress=0,resolvedAnimation=null){
    if(entry.kind!=="BILLBOARD"||!entry.texture)return;
    const animation=resolvedAnimation||this.animationDefinition(unit,state),
      asset=this.animationAsset(unit,entry.definition,state,facing,animation);
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
    entry.root.rotation.x=0;
    entry.root.rotation.z=0;
    entry.root.scaling.setAll(entry.baseScale);
    if(entry.plane)entry.plane.rotation.z=0;
    for(const {node,base} of entry.poseResetParts||[]){
      node.position.copyFrom(base.position);
      node.rotation.copyFrom(base.rotation);
      node.scaling.copyFrom(base.scaling);
    }
    // updateFrame() applies the resolved facing exactly once after reset.
    // A second IDLE-facing evaluation here was overwritten immediately.
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
    if(parts.leftArm)parts.leftArm.rotation.x-=stride*armSwing*(entry.definition?.figure?.fieldTowerShield?.20:1);
    if(parts.rightArm)parts.rightArm.rotation.x+=stride*armSwing;
    if(entry.definition?.figure?.fieldTowerShield&&parts.shield){
      parts.shield.rotation.z+=stride*.024;
      parts.shield.rotation.y+=capeFollow*.017;
    }
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
    if(parts.leftWeapon)parts.leftWeapon.rotation.x-=stride*Number(motion.leftWeaponSwing??armSwing*.92);
    if(parts.rightWeapon)parts.rightWeapon.rotation.x+=stride*armSwing*.92;
    if(parts.tail){
      parts.tail.rotation.y+=Math.sin(cycle*.72-followLag)*.16;
      parts.tail.rotation.z+=Math.sin(cycle-followLag*.45)*.12;
    }
  }

  applyFigureWingPose(entry,unit,phase,{moving=false,now=performance.now(),attack=false}={}){
    const parts=entry.figureParts,wingMotion=entry.definition?.figure?.wingMotion;
    if(entry.kind!=="FIGURE"||!parts?.leftWing||!parts?.rightWing||!wingMotion)return false;
    const air=String(unit?.verticalMode||unit?.character?.verticalMobility?.defaultMode||"").toUpperCase()==="FLYING";
    const cycle=(moving?phase*3.3:now/1100)*Math.PI*2;
    const flap=Math.sin(cycle)*(air?Number(wingMotion.flightFlap??.25):Number(wingMotion.groundFlap??.04));
    const open=air?Number(wingMotion.flightSpread??.24):Number(wingMotion.groundFold??.38);
    parts.leftWing.rotation.z-=open+flap;
    parts.rightWing.rotation.z+=open+flap;
    parts.leftWing.rotation.y+=air?-.07:.45;
    parts.rightWing.rotation.y+=air?.07:-.45;
    if(parts.halo)parts.halo.rotation.z+=Math.sin(cycle*.42)*.025;
    if(air){
      entry.root.position.y+=Math.sin(cycle*.5)*Number(wingMotion.hoverBob??.045);
      if(parts.hairBack)parts.hairBack.rotation.x+=.12+flap*.15;
      if(parts.skirt)parts.skirt.rotation.x+=.08+flap*.10;
    }
    return true;
  }

  applyFigureAquaticPose(entry,unit,phase,{moving=false,now=performance.now()}={}){
    const parts=entry.figureParts;if(entry.kind!=="FIGURE"||!parts)return false;
    const mode=String(unit?.verticalMode||"").toUpperCase();
    if(mode!=="SWIMMING"&&mode!=="DIVING"&&mode!=="SINKING")return false;
    const motion=entry.definition?.figure?.aquaticMotion||{};
    const cycle=(moving?phase:now/1000)*Math.PI*2;
    const wave=Math.sin(cycle),follow=Math.sin(cycle-.85),deep=mode==="DIVING"||mode==="SINKING";
    entry.root.rotation.x+=Number(deep?motion.divePitch??-1.02:motion.surfacePitch??-.18);
    entry.root.position.y+=wave*Number(deep?motion.diveBob??.025:motion.surfaceBob??.045);
    if(parts.body)parts.body.rotation.z+=wave*Number(motion.bodyRoll??.035);
    if(parts.leftLeg)parts.leftLeg.rotation.x+=wave*Number(deep?motion.diveKick??.38:motion.surfaceKick??.26);
    if(parts.rightLeg)parts.rightLeg.rotation.x-=wave*Number(deep?motion.diveKick??.38:motion.surfaceKick??.26);
    if(parts.leftArm){parts.leftArm.rotation.x+=deep?-.42:-.18;parts.leftArm.rotation.z+=follow*.08;}
    if(parts.rightArm){parts.rightArm.rotation.x+=deep?-.48:-.22;parts.rightArm.rotation.z-=follow*.08;}
    if(parts.weapon){parts.weapon.rotation.x+=deep?-.36:-.12;parts.weapon.rotation.z+=wave*.035;}
    if(parts.hairBack){parts.hairBack.rotation.x+=Number(motion.hairFloat??.34)+follow*.16;parts.hairBack.rotation.z+=wave*.10;}
    if(parts.braid){parts.braid.rotation.x+=Number(motion.hairFloat??.34)+follow*.14;parts.braid.rotation.z-=wave*.08;}
    if(parts.skirt){parts.skirt.rotation.x+=Number(motion.drapeFloat??.30)+follow*.18;parts.skirt.rotation.z-=wave*.08;}
    if(parts.cape){parts.cape.rotation.x+=Number(motion.drapeFloat??.30)+follow*.14;parts.cape.rotation.z+=wave*.06;}
    return true;
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

  figureAttackType(entry,event){
    const type=this.attackTypeFor(event);
    // Combat resolves INHERIT from equipment. Reuse the visible weapon's
    // generic FIGURE capability rather than branching on unit/skill IDs.
    if(type!=="INHERIT")return type;
    const figure=entry?.definition?.figure||{};
    if(figure.fieldSpear)return"PIERCE";
    if(figure.fieldWarHammer)return"STRIKE";
    if(figure.fieldBow||figure.holyBow||figure.bow===true)return"SHOT";
    if(figure.armingSword||figure.blessedGreatsword||figure.greatsword||figure.fieldGreatsword)return"SLASH";
    return type;
  }

  applyFigureAttack(entry,unit,event,progress){
    const parts=entry.figureParts;if(entry.kind!=="FIGURE"||!parts)return false;
    const type=this.figureAttackType(entry,event),facing=normalizeFacing(event?.facing??unit?.facing),vector=FACING_VECTOR[facing]||FACING_VECTOR.S;
    const ease=value=>{const t=clamp01(value);return t*t*(3-2*t);};

    if(type==="SHOT"&&parts.bow){
      const raise=ease(progress/.22),draw=progress<.66?ease((progress-.12)/.42):Math.max(0,1-ease((progress-.66)/.13)),recover=ease((progress-.72)/.28);
      if(parts.leftArm){parts.leftArm.rotation.x-=raise*1.15;parts.leftArm.rotation.z-=raise*.34;}
      if(parts.rightArm){parts.rightArm.rotation.x-=raise*.84;parts.rightArm.rotation.z+=draw*.92-recover*.16;}
      parts.bow.rotation.x-=raise*.88;parts.bow.rotation.z+=raise*.16;
      if(entry.definition?.figure?.holyBow||entry.definition?.figure?.fieldBow){
        // Pull the free hand toward the nocked string, then release. The held
        // bow remains a child of the left wrist throughout the animation.
        if(parts.rightArm){
          parts.rightArm.position.x-=draw*(entry.definition.figure.fieldBow?.40:.28);
          parts.rightArm.position.z+=draw*.10;
        }
        if(entry.definition.figure.holyBow){
          if(parts.leftWing)parts.leftWing.rotation.z-=draw*.28;
          if(parts.rightWing)parts.rightWing.rotation.z+=draw*.28;
          if(parts.bow)parts.bow.rotation.y+=raise*.10;
        }
      }
      if(parts.body){parts.body.rotation.y-=draw*.20;parts.body.rotation.z-=draw*.06;}
      if(parts.cape)parts.cape.rotation.x+=draw*.12-recover*.07;
      if(parts.hairBack)parts.hairBack.rotation.x+=draw*.08;
      if(parts.braid)parts.braid.rotation.x+=draw*.10;
      entry.root.position.x-=vector.x*draw*.08;entry.root.position.z-=vector.z*draw*.08;
      return true;
    }

    const dualDaggers=entry.definition?.figure?.dualDaggers===true;
    if(type==="PIERCE"&&entry.definition?.figure?.fieldSpear&&parts.leftWeapon){
      // Start upright, level the spear at the wrist, then project the point
      // forward. LEFT glove, shaft and tip remain on one inherited transform.
      const wind=ease(progress/.27);
      const drive=Math.sin(Math.PI*clamp01((progress-.24)/.57));
      const recover=ease((progress-.80)/.20);
      const aim=Math.max(0,wind-recover);
      if(parts.leftArm){
        parts.leftArm.rotation.x-=aim*.48+drive*.24;
        parts.leftArm.rotation.z+=aim*.12;
      }
      parts.leftWeapon.rotation.x+=aim*1.62+drive*.39;
      parts.leftWeapon.rotation.y+=aim*.04;
      if(parts.rightArm){parts.rightArm.rotation.x-=aim*.28;parts.rightArm.rotation.z-=aim*.16;}
      if(parts.body){parts.body.rotation.y+=drive*.12;parts.body.rotation.x+=drive*.07;}
      if(parts.cape){parts.cape.rotation.x+=drive*.16;parts.cape.rotation.z+=drive*.05;}
      entry.root.position.x+=vector.x*drive*.44;
      entry.root.position.z+=vector.z*drive*.44;
      return true;
    }

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
      const twoHanded=entry.definition?.figure?.twoHanded===true;
      if(parts.rightArm){parts.rightArm.rotation.x-=ready*(twoHanded?.66:.55)+thrust*(twoHanded?1.04:.92);parts.rightArm.rotation.z+=ready*(twoHanded?.28:.20);}
      if(parts.leftArm){
        if(twoHanded){parts.leftArm.rotation.x-=ready*.48+thrust*.72;parts.leftArm.rotation.z-=ready*.30;}
        else parts.leftArm.rotation.x+=ready*.20;
      }
      parts.weapon.rotation.x-=ready*(twoHanded?.72:.65)+thrust*(twoHanded?1.08:.93);parts.weapon.rotation.z-=ready*.12;
      if(parts.body){parts.body.rotation.x+=thrust*(twoHanded?.08:.06);parts.body.rotation.z-=thrust*.08;}
      if(parts.cape)parts.cape.rotation.x+=thrust*(twoHanded?.20:.16);
      if(parts.hairBack)parts.hairBack.rotation.x+=thrust*.12;
      entry.root.position.x+=vector.x*thrust*(twoHanded?.66:.58);entry.root.position.z+=vector.z*thrust*(twoHanded?.66:.58);
      return true;
    }

    if(type==="STRIKE"&&parts.weapon&&entry.definition?.figure?.fieldWarHammer){
      const brace=ease(progress/.24);
      const impact=Math.sin(Math.PI*clamp01((progress-.24)/.55));
      const recover=ease((progress-.79)/.21);
      if(parts.rightArm){parts.rightArm.rotation.x-=brace*.77+impact*.63-recover*.20;parts.rightArm.rotation.z-=brace*.34+impact*.22;}
      parts.weapon.rotation.x-=brace*.32+impact*.63;
      parts.weapon.rotation.z-=impact*.28;
      if(parts.leftArm&&entry.definition?.figure?.fieldTowerShield)parts.leftArm.rotation.x-=brace*.22;
      if(parts.shield)parts.shield.rotation.x+=brace*.16-impact*.08;
      if(parts.body){parts.body.rotation.y-=brace*.13+impact*.16;parts.body.rotation.x+=impact*.07;}
      if(parts.cape)parts.cape.rotation.x+=impact*.15;
      entry.root.position.x+=vector.x*impact*.24;
      entry.root.position.z+=vector.z*impact*.24;
      return true;
    }

    if(type==="STRIKE"&&parts.weapon&&entry.definition?.figure?.twoHanded===true){
      const wind=ease(progress/.30),impact=Math.sin(Math.PI*clamp01((progress-.22)/.62));
      if(parts.rightArm){parts.rightArm.rotation.x-=wind*.82-impact*.30;parts.rightArm.rotation.z-=wind*.52+impact*.54;}
      if(parts.leftArm){parts.leftArm.rotation.x-=wind*.74-impact*.24;parts.leftArm.rotation.z+=wind*.46-impact*.48;}
      parts.weapon.rotation.x-=wind*.88+impact*.62;parts.weapon.rotation.z-=wind*.44-impact*.78;
      if(parts.body){parts.body.rotation.x-=wind*.10;parts.body.rotation.y-=wind*.24-impact*.28;}
      if(parts.cape)parts.cape.rotation.z+=impact*.24;
      entry.root.position.x+=vector.x*impact*.30;entry.root.position.z+=vector.z*impact*.30;
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
      const figure=entry.definition?.figure||{},twoHanded=figure.twoHanded===true;
      const weapon=(figure.armingSword||figure.blessedGreatsword||figure.greatsword||figure.fieldGreatsword)
        ?parts.weapon:(parts.sword||parts.weapon);
      const wind=ease(progress/.28),swing=Math.sin(Math.PI*clamp01((progress-.18)/.66));
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
      if(this.applyFigureAquaticPose(entry,unit,local,{moving:true,now:performance.now()}))return;
      const flying=String(unit?.verticalMode||unit?.character?.verticalMobility?.defaultMode||"").toUpperCase()==="FLYING";
      if(flying&&entry.definition?.figure?.wingMotion){
        this.applyFigureWingPose(entry,unit,local,{moving:true});
        const parts=entry.figureParts||{},sway=Math.sin(local*Math.PI*2);
        if(parts.leftLeg)parts.leftLeg.rotation.x+=.12+sway*.10;
        if(parts.rightLeg)parts.rightLeg.rotation.x+=.05-sway*.10;
        if(parts.leftArm)parts.leftArm.rotation.x-=sway*.11;
        if(parts.rightArm)parts.rightArm.rotation.x+=sway*.12;
        if(parts.bow)parts.bow.rotation.z+=sway*.04;
        if(parts.cape)parts.cape.rotation.x+=.16;
        return;
      }
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
    const aquaticPose=entry.kind==="FIGURE"?this.applyFigureAquaticPose(entry,unit,progress,{moving:false,now}):false;
    if(entry.kind==="FIGURE")this.applyFigureWingPose(entry,unit,progress,{now});
    const weaponAction=this.figureAttackType(entry,event);
    if(entry.kind==="FIGURE"&&event?.skillId&&["SHOT","PIERCE","SLASH","STRIKE"].includes(weaponAction)&&this.applyFigureAttack(entry,unit,event,progress))return;

    if(entry.kind==="BIRD"&&(state==="IDLE"||procedural==="FLAP")){
      this.applyBirdPose(entry,state,progress,now);return;
    }

    if(procedural==="BREATHE"||state==="IDLE"){
      if(aquaticPose)return;
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
      if(entry.kind==="FIGURE"&&entry.definition?.figure?.fieldTowerShield){
        // Shared guard/support stance: brace the shield instead of the
        // unrelated generic spell spin for a shield-bearing defender.
        const parts=entry.figureParts||{};
        if(parts.leftArm){parts.leftArm.rotation.x-=pulse*.33;parts.leftArm.rotation.z+=pulse*.12;}
        if(parts.shield){parts.shield.rotation.x-=pulse*.18;parts.shield.rotation.y+=pulse*.14;}
        if(parts.rightArm)parts.rightArm.rotation.x-=pulse*.19;
        if(parts.body)parts.body.rotation.x+=pulse*.045;
        entry.root.position.y-=pulse*.035;
        return;
      }
      if(entry.kind==="FIGURE"&&entry.definition?.figure?.holyBow){
        const parts=entry.figureParts||{},ready=Math.sin(Math.PI*progress);
        if(parts.leftArm){parts.leftArm.rotation.x-=ready*.85;parts.leftArm.rotation.z-=ready*.16;}
        if(parts.rightArm){parts.rightArm.rotation.x-=ready*.62;parts.rightArm.rotation.z+=ready*.48;}
        if(parts.bow){parts.bow.rotation.x-=ready*.60;parts.bow.rotation.z+=ready*.12;}
        if(parts.leftWing)parts.leftWing.rotation.z-=ready*.25;
        if(parts.rightWing)parts.rightWing.rotation.z+=ready*.25;
        if(parts.hairBack)parts.hairBack.rotation.x+=ready*.14;
        if(parts.skirt)parts.skirt.rotation.x+=ready*.12;
        entry.root.position.y+=ready*.075;
        return;
      }
      if(entry.kind==="FIGURE"&&entry.definition?.figure?.blessedGreatsword){
        // Shared blessing-and-command stance for an enchanted two-hand
        // weapon; unlike the generic CAST fallback it does not spin the unit.
        const parts=entry.figureParts||{},ready=Math.sin(Math.PI*progress);
        if(parts.rightArm){parts.rightArm.rotation.x-=ready*.45;parts.rightArm.rotation.z-=ready*.22;}
        if(parts.weapon){parts.weapon.rotation.x-=ready*.37;parts.weapon.rotation.z-=ready*.32;}
        if(parts.leftArm){parts.leftArm.rotation.x-=ready*.48;parts.leftArm.rotation.z+=ready*.34;}
        if(parts.body)parts.body.rotation.y+=ready*.09;
        if(parts.cape)parts.cape.rotation.x+=ready*.18;
        if(parts.hairBack)parts.hairBack.rotation.x+=ready*.10;
        if(parts.skirt)parts.skirt.rotation.x+=ready*.09;
        entry.root.position.y+=ready*.040;
        return;
      }
      if(entry.kind==="FIGURE"&&entry.definition?.figure?.arcaneStaff){
        const parts=entry.figureParts||{},skillId=String(event?.skillId||"");
        const intense=skillId.includes("dimension_collapse")||skillId.includes("existence_breakdown")?1.18:1;
        if(parts.rightArm){parts.rightArm.rotation.x-=pulse*.72*intense;parts.rightArm.rotation.z-=pulse*.24;}
        if(parts.leftArm){parts.leftArm.rotation.x-=pulse*.38;parts.leftArm.rotation.z+=pulse*.58;}
        if(parts.weapon){parts.weapon.rotation.x-=pulse*.40*intense;parts.weapon.rotation.z-=pulse*.22;}
        if(parts.body){parts.body.rotation.y-=pulse*.10;parts.body.rotation.z+=Math.sin(progress*Math.PI*2)*.025;}
        if(parts.hairBack){parts.hairBack.rotation.x+=pulse*.20;parts.hairBack.rotation.z+=Math.sin(progress*Math.PI*2)*.08;}
        if(parts.cape){parts.cape.rotation.x+=pulse*.18;parts.cape.rotation.z-=Math.sin(progress*Math.PI*2)*.07;}
        if(parts.skirt){parts.skirt.rotation.x+=pulse*.15;parts.skirt.rotation.z+=Math.sin(progress*Math.PI*2)*.05;}
        entry.root.position.y+=pulse*.10*intense;
        entry.root.scaling.setAll(entry.baseScale*(1+pulse*.045*intense));
        return;
      }
      if(entry.kind==="FIGURE"&&entry.definition?.figure?.holyScepter){
        const parts=entry.figureParts||{};
        const ready=clamp01(progress/.30),release=Math.sin(Math.PI*progress);
        if(parts.rightArm){parts.rightArm.rotation.x-=ready*.33+release*.20;parts.rightArm.rotation.z-=ready*.10;}
        if(parts.weapon){parts.weapon.rotation.x-=ready*.25+release*.18;parts.weapon.rotation.z-=ready*.12;}
        if(parts.leftArm){parts.leftArm.rotation.x-=ready*.88;parts.leftArm.rotation.z+=ready*.38;}
        if(parts.body)parts.body.rotation.y+=release*.06;
        if(parts.hairBack)parts.hairBack.rotation.x+=release*.13;
        if(parts.cape)parts.cape.rotation.x+=release*.16;
        if(parts.skirt)parts.skirt.rotation.x+=release*.035;
        entry.root.position.y+=release*.065;
        return;
      }
      if(entry.kind==="FIGURE"&&entry.definition?.figure?.trident){
        const parts=entry.figureParts||{};
        if(parts.rightArm){parts.rightArm.rotation.x-=pulse*.82;parts.rightArm.rotation.z-=pulse*.18;}
        if(parts.leftArm){parts.leftArm.rotation.x-=pulse*.36;parts.leftArm.rotation.z+=pulse*.28;}
        if(parts.weapon){parts.weapon.rotation.x-=pulse*.72;parts.weapon.rotation.z-=pulse*.18;}
        if(parts.hairBack)parts.hairBack.rotation.x+=pulse*.18;
        if(parts.skirt)parts.skirt.rotation.x+=pulse*.16;
        entry.root.position.y+=pulse*.12;
        entry.root.scaling.setAll(entry.baseScale*(1+pulse*.06));
        return;
      }
      entry.root.position.y+=pulse*.30;
      entry.root.rotation.y+=progress*Math.PI*2;
      entry.root.scaling.setAll(entry.baseScale*(1+pulse*.18));
      return;
    }

    if(procedural==="RECOIL"||state==="HURT"){
      const recoil=Math.sin(Math.PI*progress);
      if(entry.kind==="FIGURE"&&entry.definition?.figure?.fieldTowerShield){
        const parts=entry.figureParts||{};
        if(parts.leftArm)parts.leftArm.rotation.x-=recoil*.28;
        if(parts.shield){parts.shield.rotation.x-=recoil*.22;parts.shield.rotation.y+=recoil*.10;}
        if(parts.body)parts.body.rotation.x+=recoil*.05;
        entry.root.position.x-=vector.x*recoil*.15;
        entry.root.position.z-=vector.z*recoil*.15;
        return;
      }
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
    // Deleting a finished DEATH entry during Map iteration is safe and avoids
    // allocating a fresh array of all visible units every rendered frame.
    for(const[id,entry]of this.entries){
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
      const facing=event.facing??unit.facing;
      this.applyFacing(entry,unit,entry.definition,facing,state,definition);
      this.setBillboardAsset(entry,unit,state,facing,progress,definition);
      this.applyProcedural(entry,unit,state,progress,now,event,definition);
      this.updateAnimationBadge(entry,unit,state);
    }
  }

  // Rim/reflective readability only: no individual PointLight, so unit count
  // cannot grow the mobile lighting cost. Invisible enemies are not rendered.
  syncNightReadability(state){
    const env=state?.presentation?.environment||{};
    const night=env.timeOfDay==="NIGHT",moon=String(env.moonlight||"PARTIAL").toUpperCase();
    const reflection=night?(moon==="FULL"?.13:moon==="NONE"?.23:.18):.02;
    for(const material of this.figureMaterials.values()){
      // Existing genuinely luminous magic stays authoritative. The shared
      // white material's emissive term is multiplied by each vertex's paint
      // colour in StandardMaterial, preserving the old night tint per part.
      if(String(material.name).includes("figure-holy-")||String(material.name).includes("figure-arcane-"))continue;
      material.emissiveColor.copyFrom(material.diffuseColor.scale(reflection));
    }
    for(const material of [this.materials.PLAYER,this.materials.ENEMY,this.materials.NEUTRAL])
      material.emissiveColor.copyFrom(material.diffuseColor.scale(reflection));
    for(const entry of this.entries.values())if(entry.kind==="BILLBOARD"&&entry.plane?.material)
      {const amount=night?(moon==="NONE"?.20:.14):.08;entry.plane.material.emissiveColor.set(amount,amount,amount);}
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

      const verticalMode=String(unit.verticalMode||""),submerged=verticalMode==="DIVING"||verticalMode==="SINKING";
      const scale=(unit.selected?1.13:unit.finished?.92:1)*(submerged?.9:1);
      entry.baseScale=scale;
      // Stealth affects the figure, while the friendly facing/locator marker
      // remains readable. Render opacity does not grant detection to enemies.
      const stealthOpacity=unit.stealthed&&unit.friendlyToViewer?.50:1;
      const verticalOpacity=submerged?.48:1;
      // Finished is a turn-command state, not physical transparency. Real 3D
      // figures/birds/capsules already have the finished-state scale above.
      // Sending every independently hinged material batch through Babylon's
      // alpha-blend sorter makes opaque head/hair/clothing overlap incorrectly,
      // especially after animations settle to IDLE. Retain the historical
      // finished-state translucency only on billboards, whose single image
      // plane already belongs to the transparent pipeline. Stealth and diving
      // continue to own optical opacity for all visual kinds.
      const actionOpacity=unit.finished&&entry.kind==="BILLBOARD"
        ?(unit.friendlyToViewer?.88:.62):1;
      this.setVisibility(entry,actionOpacity*stealthOpacity*verticalOpacity);
      if(unit.friendlyToViewer&&unit.stealthed)
        for(const marker of entry.facingMarker?.meshes||[])marker.visibility=Math.max(.85,verticalOpacity);
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
    this.syncNightReadability(state);
    // The one BabylonRenderer render loop advances unit poses immediately
    // before scene.render(). Running updateFrame() inside sync() duplicated
    // the same animation/pose work during presentation publication.
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
      figureGeometry:{...this.figureBuildStats,cachedAppearances:this.figureTemplates.size,
        averageEntryBuildMs:this.figureBuildStats.entriesCreated
          ?this.figureBuildStats.entryBuildMs/this.figureBuildStats.entriesCreated:0},
      states
    };
  }
}

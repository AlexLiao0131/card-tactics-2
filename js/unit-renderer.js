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
      JSON.stringify(definition?.figure||{})
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
    const scale=height/1.72;
    const root=new BABYLON.TransformNode(`unit-${unit.id}`,this.scene);
    root.metadata={kind:"unit",unitId:unit.id,visualKind:"FIGURE"};
    const meshes=[];

    const material={
      skin:this.figureMaterial("skin",colors.skin||"#e9b99d"),
      hair:this.figureMaterial("hair",colors.hair||"#56372d"),
      cape:this.figureMaterial("cape",colors.cape||"#2d4f94"),
      leather:this.figureMaterial("leather",colors.leather||"#4b3025"),
      shirt:this.figureMaterial("shirt",colors.shirt||"#e9e1d7"),
      pants:this.figureMaterial("pants",colors.pants||"#27272b"),
      boots:this.figureMaterial("boots",colors.boots||colors.leather||"#40281f"),
      metal:this.figureMaterial("metal",colors.metal||"#92745b"),
      bow:this.figureMaterial("bow",colors.bow||"#70472d"),
      eye:this.figureMaterial("eye",colors.eyes||"#4d87d9"),
      dark:this.figureMaterial("dark","#1d1c20")
    };
    material.cape.backFaceCulling=false;

    const finish=(mesh,mat,pos=null,rotation=null,scaling=null)=>{
      mesh.parent=root;
      mesh.material=mat;
      mesh.isPickable=false;
      mesh.receiveShadows=true;
      mesh.metadata={...(mesh.metadata||{}),kind:"unit-part",unitId:unit.id,castShadow:true};
      if(pos)mesh.position.set(pos[0]*scale,pos[1]*scale,pos[2]*scale);
      if(rotation)mesh.rotation.set(rotation[0],rotation[1],rotation[2]);
      if(scaling)mesh.scaling.set(scaling[0],scaling[1],scaling[2]);
      meshes.push(mesh);
      return mesh;
    };
    const sphere=(name,diameter,mat,pos,scaling=null)=>finish(
      BABYLON.MeshBuilder.CreateSphere(`${name}-${unit.id}`,{diameter:diameter*scale,segments:8},this.scene),
      mat,pos,null,scaling
    );
    const box=(name,size,mat,pos,rotation=null)=>finish(
      BABYLON.MeshBuilder.CreateBox(`${name}-${unit.id}`,{width:size[0]*scale,height:size[1]*scale,depth:size[2]*scale},this.scene),
      mat,pos,rotation
    );
    const cylinder=(name,heightValue,diameter,mat,pos,rotation=null,tessellation=7)=>finish(
      BABYLON.MeshBuilder.CreateCylinder(`${name}-${unit.id}`,{height:heightValue*scale,diameter:diameter*scale,tessellation},this.scene),
      mat,pos,rotation
    );

    // Head and simplified hair mass.
    sphere("figure-head",.34,material.skin,[0,1.52,0], [1,.98,.92]);
    sphere("figure-hair-cap",.38,material.hair,[0,1.59,-.035],[1.03,.82,.98]);
    sphere("figure-hair-back",.31,material.hair,[0,1.43,-.12],[1.02,1.55,.72]);
    if(figure.braid!==false){
      for(let i=0;i<5;i++){
        const t=i/4;
        sphere(`figure-braid-${i}`,.13-i*.01,material.hair,[.16,1.38-t*.55,.10+t*.015],[.82,1.12,.82]);
      }
    }
    // Tiny eye dots are enough to keep the anime read without building a face.
    sphere("figure-eye-l",.034,material.eye,[-.058,1.535,.153],[1,.65,.45]);
    sphere("figure-eye-r",.034,material.eye,[.058,1.535,.153],[1,.65,.45]);

    // White blouse under a compact leather hunter vest.
    box("figure-shirt",[.42,.48,.23],material.shirt,[0,1.13,0]);
    box("figure-vest",[.36,.39,.25],material.leather,[0,1.12,.025]);
    box("figure-belt",[.46,.075,.27],material.leather,[0,.91,.01]);
    box("figure-buckle",[.075,.07,.035],material.metal,[0,.91,.16]);

    // Arms: white sleeves with brown bracers/gloves.
    cylinder("figure-upper-arm-l",.37,.13,material.shirt,[-.27,1.16,0],[0,0,-.13]);
    cylinder("figure-upper-arm-r",.37,.13,material.shirt,[.27,1.16,0],[0,0,.13]);
    cylinder("figure-bracer-l",.29,.115,material.leather,[-.30,.86,.035],[0,0,-.04]);
    cylinder("figure-bracer-r",.29,.115,material.leather,[.30,.86,.035],[0,0,.04]);
    sphere("figure-hand-l",.12,material.skin,[-.31,.68,.045],[.72,1,.72]);
    sphere("figure-hand-r",.12,material.skin,[.31,.68,.045],[.72,1,.72]);

    // Slim dark legs and tall brown boots.
    cylinder("figure-leg-l",.52,.17,material.pants,[-.12,.60,0],[0,0,.025]);
    cylinder("figure-leg-r",.52,.17,material.pants,[.12,.60,0],[0,0,-.025]);
    box("figure-boot-l",[.19,.37,.23],material.boots,[-.12,.23,.045]);
    box("figure-boot-r",[.19,.37,.23],material.boots,[.12,.23,.045]);

    // Broad blue cloak: one very cheap six-vertex mesh with a centre fold.
    if(figure.cape!==false){
      const cloak=new BABYLON.Mesh(`figure-cloak-${unit.id}`,this.scene);
      const positions=[
        -.31*scale,1.42*scale,-.15*scale, 0,1.47*scale,-.20*scale, .31*scale,1.42*scale,-.15*scale,
        -.48*scale,.36*scale,-.18*scale, 0,.27*scale,-.31*scale, .48*scale,.36*scale,-.18*scale
      ];
      const indices=[0,3,4,0,4,1,1,4,5,1,5,2],normals=[];
      BABYLON.VertexData.ComputeNormals(positions,indices,normals);
      const data=new BABYLON.VertexData();data.positions=positions;data.indices=indices;data.normals=normals;data.applyToMesh(cloak);
      finish(cloak,material.cape);
    }

    // Quiver and a few visible arrow shafts.
    if(figure.quiver!==false){
      cylinder("figure-quiver",.58,.16,material.leather,[.27,1.16,-.22],[0,0,-.18]);
      for(let i=0;i<3;i++){
        cylinder(`figure-arrow-${i}`,.55,.018,material.bow,[.22+i*.045,1.42,-.22],[0,0,-.18],5);
      }
    }

    // The bow silhouette carries most of Livia's class identity at tactical zoom.
    if(figure.bow!==false){
      const path=[];
      for(let i=0;i<=8;i++){
        const t=i/8,y=.43+t*1.08,bend=Math.sin(t*Math.PI)*.18;
        path.push(new BABYLON.Vector3((- .43-bend)*scale,y*scale,.18*scale));
      }
      const bow=BABYLON.MeshBuilder.CreateTube(`figure-bow-${unit.id}`,{path,radius:.022*scale,tessellation:6,cap:BABYLON.Mesh.CAP_ALL},this.scene);
      finish(bow,material.bow);
      const string=BABYLON.MeshBuilder.CreateLines(`figure-bow-string-${unit.id}`,{
        points:[path[0],new BABYLON.Vector3(-.43*scale,.97*scale,.18*scale),path[path.length-1]]
      },this.scene);
      string.parent=root;string.color=this.figureColor(colors.bowString||"#d9c6a7");string.isPickable=false;
      string.metadata={kind:"unit-part",unitId:unit.id,castShadow:false};meshes.push(string);
    }

    // A simple dark side sword/scabbard, not a detailed weapon model.
    if(figure.sideSword!==false){
      const sword=box("figure-side-sword",[.075,.70,.065],material.dark,[.34,.61,-.04],[0,0,-.10]);
      sword.position.y=.62*scale;
    }

    return{root,meshes,kind:"FIGURE",height,lift:Number(definition?.lift||0)};
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
    this.applyFacing(entry,unit,entry.definition,null,"IDLE");
  }

  applyWalk(entry,unit,event,progress){
    const points=event.path||[];
    if(points.length<2)return;
    const scaled=clamp01(progress)*(points.length-1),index=Math.min(points.length-2,Math.floor(scaled)),local=scaled-index;
    const a=points[index],b=points[index+1];
    const point={x:lerp(a.x,b.x,local),y:lerp(a.y,b.y,local),z:lerp(a.z,b.z,local)};
    entry.root.position.copyFrom(this.positionFor(entry,point));
    entry.facingMarker.root.position.copyFrom(this.markerPositionFor(point));
    const facing=facingFromDelta(Number(b.x)-Number(a.x),Number(b.y)-Number(a.y),event.facing||unit.facing);
    this.applyFacing(entry,unit,entry.definition,facing,"WALK");
    entry.root.position.y+=Math.abs(Math.sin(local*Math.PI*2))*.17;
    entry.root.rotation.z=Math.sin(local*Math.PI*2)*.11;
  }

  applyProcedural(entry,unit,state,progress,now,event,definition){
    const procedural=String(definition?.procedural||"").toUpperCase();
    const facing=normalizeFacing(event?.facing??unit?.facing),vector=FACING_VECTOR[facing]||FACING_VECTOR.S;
    if(state==="WALK"&&event?.path?.length){this.applyWalk(entry,unit,event,progress);return;}

    if(procedural==="BREATHE"||state==="IDLE"){
      const breathe=Math.sin(now/300);
      entry.root.position.y+=breathe*.055;
      entry.root.scaling.y=entry.baseScale*(1+breathe*.035);
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

/**
 * Babylon presentation only; no game RNG or damage. Consumes the actual
 * authoritative event and the team-filtered tile snapshot.
 */
import {TILE_SIZE,ELEVATION_HEIGHT} from './coordinate-system.js';
const C=(r,g,b)=>new BABYLON.Color3(r,g,b);
const time=()=>typeof performance!=='undefined'?performance.now():0;
const xy=(x,y)=>`${x},${y}`;
export class LiviaDualityVfx{
  constructor(scene,{units=null}={}){
    this.scene=scene;this.units=units;this.mapId=null;this.wells=new Map();
    this.rifts=new Map();this.auras=new Map();this.ghosts=new Map();this.flurries=[];
    // The existing LOCAL engagement playback gate inspects handler.active.
    // Only finite combo actions appear here; permanent berserk auras do not.
    this.active=this.flurries;
    this.swings=[];this.materials=new Map();this.seenActions=new Set();
    scene.onDisposeObservable?.addOnce?.(()=>this.dispose());
  }
  mat(name,color,alpha=1){
    if(this.materials.has(name))return this.materials.get(name);
    const m=new BABYLON.StandardMaterial(`livia-dual-${name}`,this.scene);
    m.diffuseColor=C(...color).scale(.12);m.emissiveColor=C(...color);
    m.specularColor=C(.35,.40,.55);m.alpha=alpha;m.backFaceCulling=false;
    this.materials.set(name,m);return m;
  }
  mesh(mesh,material,parent=null){
    mesh.material=material;mesh.isPickable=false;mesh.receiveShadows=false;
    mesh.metadata={castShadow:false};if(parent)mesh.parent=parent;return mesh;
  }
  yOf(snapshot,x,y){const t=snapshot?.map?.tiles?.find(t=>t.x===x&&t.y===y);
    return Number(t?.elevation||0)*ELEVATION_HEIGHT;}
  makeManaWell(t){
    const root=new BABYLON.TransformNode(`mana-well-${t.x}-${t.y}`,this.scene);
    root.position.set(t.x*TILE_SIZE,this.yOf(this._snapshot,t.x,t.y)+.13,t.y*TILE_SIZE);
    const crystal=this.mesh(BABYLON.MeshBuilder.CreatePolyhedron(`mana-crystal-${t.x}-${t.y}`,{
      type:1,size:TILE_SIZE*.18},this.scene),this.mat('crystal',[.28,.82,1]),root);
    crystal.position.y=.21;
    const ring=this.mesh(BABYLON.MeshBuilder.CreateTorus(`mana-well-ring-${t.x}-${t.y}`,{
      diameter:TILE_SIZE*.63,thickness:TILE_SIZE*.018,tessellation:16},this.scene),
      this.mat('ring',[.16,.6,.9],.7),root);
    ring.rotation.x=Math.PI/2;ring.position.y=.02;
    return root;
  }
  makeDistortion(t){
    const root=new BABYLON.TransformNode(`spatial-rift-${t.x}-${t.y}`,this.scene);
    root.position.set(t.x*TILE_SIZE,this.yOf(this._snapshot,t.x,t.y)+.06,t.y*TILE_SIZE);
    const ground=this.mesh(BABYLON.MeshBuilder.CreatePlane(`rift-plane-${t.x}-${t.y}`,{
      size:TILE_SIZE*.92},this.scene),this.mat('rift',[.38,.74,1],.21),root);
    ground.rotation.x=Math.PI/2;
    const line=this.mesh(BABYLON.MeshBuilder.CreateBox(`rift-line-${t.x}-${t.y}`,{
      width:TILE_SIZE*.68,height:.015,depth:TILE_SIZE*.026},this.scene),
      this.mat('rift-line',[.85,.96,1],.68),root);
    line.position.y=.035;line.rotation.y=Math.PI/4;
    return root;
  }
  makeAura(u){
    const root=new BABYLON.TransformNode(`complete-form-${u.id}`,this.scene);
    const halo=this.mesh(BABYLON.MeshBuilder.CreateTorus(`complete-halo-${u.id}`,{
      diameter:TILE_SIZE*.82,thickness:.026,tessellation:24},this.scene),
      this.mat('complete',[.33,.72,1],.7),root);
    halo.rotation.x=Math.PI/2;
    return root;
  }
  // The apparition uses only committed, viewer-visible unit data. It has no
  // collision, hitbox, AI influence or independent gameplay entity.
  makeSpecter(id,{ambient=false}={}){
    const root=new BABYLON.TransformNode(`livia-specter-${id}`,this.scene);
    const smoke=this.mat('ghost-smoke',[.075,.025,.12],.70);
    const edge=this.mat('ghost-edge',[.34,.13,.61],.40);
    const eyes=this.mat('ghost-eyes',[.81,.57,1],.87);
    const body=this.mesh(BABYLON.MeshBuilder.CreateCylinder(`specter-cloak-${id}`,{
      height:1.15,diameterTop:.35,diameterBottom:.88,tessellation:8},this.scene),smoke,root);
    body.position.y=.66;
    const head=this.mesh(BABYLON.MeshBuilder.CreateSphere(`specter-head-${id}`,{
      diameter:.38,segments:8},this.scene),smoke,root);
    head.position.y=1.36;
    for(const side of [-1,1]){
      const arm=this.mesh(BABYLON.MeshBuilder.CreateCylinder(`specter-arm-${id}-${side}`,{
        height:.86,diameterTop:.12,diameterBottom:.28,tessellation:6},this.scene),edge,root);
      arm.position.set(side*.36,.84,0);arm.rotation.z=side*.38;
      const eye=this.mesh(BABYLON.MeshBuilder.CreateSphere(`specter-eye-${id}-${side}`,{
        diameter:.075,segments:6},this.scene),eyes,root);
      eye.position.set(side*.10,1.40,-.17);
    }
    if(ambient){
      const ring=this.mesh(BABYLON.MeshBuilder.CreateTorus(`specter-void-${id}`,{
        diameter:TILE_SIZE*.91,thickness:.026,tessellation:16},this.scene),edge,root);
      ring.position.y=.16;ring.rotation.x=Math.PI/2;
      for(let i=0;i<4;i++){
        const mote=this.mesh(BABYLON.MeshBuilder.CreateSphere(`specter-wisp-${id}-${i}`,{
          diameter:.09,segments:6},this.scene),edge,root);
        mote.metadata={...(mote.metadata||{}),specterWisp:i};
      }
    }
    return root;
  }
  entryFor(id){
    const entries=this.units?.entries;
    return entries?.get(id)||entries?.get(String(id))||
      [...(entries?.values?.()||[])].find(e=>String(e.lastUnit?.id)===String(id))||null;
  }
  ghostOpacity(id,active){
    const entry=this.entryFor(id);
    if(!entry)return;
    // The unit renderer still owns the figure. Only tint its CURRENT meshes
    // for this viewer; never mutate shared materials, team, or game state.
    if(active){
      if(!this.ghostOpacityCache)this.ghostOpacityCache=new Map();
      const cache=this.ghostOpacityCache.get(String(id))||new Map();
      for(const mesh of entry.meshes||[]){
        if(!cache.has(mesh))cache.set(mesh,mesh.visibility);
        mesh.visibility=Math.min(mesh.visibility,.16);
      }
      this.ghostOpacityCache.set(String(id),cache);
    }else{
      const cache=this.ghostOpacityCache?.get(String(id));
      for(const [mesh,vis] of cache||[])if(!mesh.isDisposed?.())mesh.visibility=vis;
      this.ghostOpacityCache?.delete(String(id));
    }
  }
  makeFlurry(snapshot,event){
    const unit=(snapshot?.units||[]).find(u=>String(u.id)===String(event.unitId));
    const points=Array.isArray(event.path)?event.path.filter(p=>
      Number.isFinite(Number(p?.x))&&Number.isFinite(Number(p?.y))):[];
    if(!unit||unit.characterId!=='livia'||points.length<2)return;
    const echoes=points.map((point,index)=>{
      const apparition=this.makeSpecter(`flurry-${event.sequence}-${index}`);
      apparition.position.set(point.x*TILE_SIZE,Number(point.z||0)*ELEVATION_HEIGHT,
        point.y*TILE_SIZE);
      const sword=this.mesh(BABYLON.MeshBuilder.CreateBox(`specter-saber-${event.sequence}-${index}`,{
        width:.13,height:TILE_SIZE*1.22,depth:.06},this.scene),
        this.mat('ghost-saber',[.55,.23,.89],.80),apparition);
      sword.position.set(.35,1.04,-.18);
      sword.metadata={...(sword.metadata||{}),specterSaber:true};
      const rupture=this.mesh(BABYLON.MeshBuilder.CreateTorus(`specter-rift-${event.sequence}-${index}`,{
        diameter:TILE_SIZE*.66,thickness:.027,tessellation:16},this.scene),
        this.mat('ghost-rift',[.28,.08,.51],.54),apparition);
      rupture.rotation.x=Math.PI/2;rupture.position.y=.14;
      apparition.setEnabled(false);
      return apparition;
    });
    this.flurries.push({event:{unitId:String(unit.id)},unitId:String(unit.id),
      targetX:Number(event.targetX),targetY:Number(event.targetY),points,echoes,started:time(),
      duration:Math.max(880,points.length*330),id:event.sequence});
  }
  swing(snapshot,event){
    const source=(snapshot?.units||[]).find(u=>String(u.id)===String(event.unitId));
    if(!source)return; // Never reveal an unseen source in a PVP client's sky.
    const x=Number(source.x)*TILE_SIZE,z=Number(source.y)*TILE_SIZE,
      face=Math.atan2(Number(event.targetX-source.x),Number(event.targetY-source.y));
    const h=Number(source.renderZ??source.z??0)*ELEVATION_HEIGHT+1.05;
    const pivot=new BABYLON.TransformNode(`purified-great-blade-${event.sequence}`,this.scene);
    pivot.position.set(x,h,z);
    const bladeLength=TILE_SIZE*3.55;
    const blade=this.mesh(BABYLON.MeshBuilder.CreateBox(`livia-giant-blade-${event.sequence}`,{
      width:.42,height:bladeLength,depth:.15},this.scene),this.mat('sword',[.57,.84,1],.90),pivot);
    blade.position.y=bladeLength*.50;
    const core=this.mesh(BABYLON.MeshBuilder.CreateBox(`livia-giant-core-${event.sequence}`,{
      width:.13,height:bladeLength,depth:.19},this.scene),this.mat('sword-core',[.96,.98,1]),pivot);
    core.position.y=bladeLength*.50;
    const guard=this.mesh(BABYLON.MeshBuilder.CreateBox(`livia-sword-guard-${event.sequence}`,{
      width:.8,height:.08,depth:.20},this.scene),this.mat('guard',[.4,.62,.9]),pivot);
    guard.position.y=.20;
    this.swings.push({pivot,from:face,started:time(),duration:950,materials:[blade.material,core.material]});
  }
  // One event per committed attack. These meshes depict the black sword itself;
  // the original renderer remains authoritative for character pose and position.
  swordTechnique(snapshot,event,{shadow=false}={}){
    const source=(snapshot?.units||[]).find(u=>String(u.id)===String(event.unitId));
    if(!source||source.characterId!=='livia')return; // No fog-of-war leaks.
    const x=Number(event.x??source.x)*TILE_SIZE,z=Number(event.y??source.y)*TILE_SIZE;
    const tx=Number(event.targetX??source.x)*TILE_SIZE,tz=Number(event.targetY??source.y)*TILE_SIZE;
    const face=Math.atan2(tx-x,tz-z),height=Number(event.z??source.z??0)*ELEVATION_HEIGHT+1.05;
    const pivot=new BABYLON.TransformNode(`livia-${shadow?'shadow-flurry':'black-slash'}-${event.sequence}`,this.scene);
    pivot.position.set(x,height,z);
    const slices=[],count=shadow?4:1;
    const mat=this.mat(shadow?'flurry-pulse':'black-steel',shadow?[.58,.18,.97]:[.62,.73,.88],shadow?.82:.93);
    const glow=this.mat(shadow?'flurry-glow':'black-edge',shadow?[.84,.43,1]:[.92,.96,1],shadow?.72:.86);
    for(let i=0;i<count;i++){
      const node=new BABYLON.TransformNode(`livia-sword-sweep-${event.sequence}-${i}`,this.scene);
      node.parent=pivot;
      const blade=this.mesh(BABYLON.MeshBuilder.CreateBox(`livia-blade-${event.sequence}-${i}`,{
        width:shadow?.13:.13,height:shadow?TILE_SIZE*1.23:TILE_SIZE*.95,depth:.07},this.scene),mat,node);
      blade.position.y=shadow?TILE_SIZE*.50:TILE_SIZE*.43;
      const edge=this.mesh(BABYLON.MeshBuilder.CreateBox(`livia-blade-edge-${event.sequence}-${i}`,{
        width:.028,height:shadow?TILE_SIZE*1.26:TILE_SIZE*.98,depth:.085},this.scene),glow,node);
      edge.position.y=blade.position.y;
      node.rotation.y=face;
      node.setEnabled(false);
      slices.push(node);
    }
    this.swings.push({pivot,from:face,kind:shadow?'SHADOW':'BLACK',slices,
      started:time(),duration:shadow?1080:550});
  }
  sync(snapshot,events=[]){
    const mapId=snapshot?.map?.id??null;
    if(this.mapId!==null&&mapId!==this.mapId)this.clear();
    this.mapId=mapId;this._snapshot=snapshot;
    const tiles=snapshot?.map?.tiles||[];
    const wantedWells=new Set(),wantedRifts=new Set();
    for(const t of tiles){
      if(t.manaWell){const k=xy(t.x,t.y);wantedWells.add(k);if(!this.wells.has(k))this.wells.set(k,this.makeManaWell(t));}
      if(t.spatialDistortion){const k=xy(t.x,t.y);wantedRifts.add(k);if(!this.rifts.has(k))this.rifts.set(k,this.makeDistortion(t));}
    }
    for(const [key,node] of this.wells)if(!wantedWells.has(key)){node.dispose(false,false);this.wells.delete(key);}
    for(const [key,node] of this.rifts)if(!wantedRifts.has(key)){node.dispose(false,false);this.rifts.delete(key);}
    const complete=(snapshot?.units||[]).filter(u=>u.characterId==='livia'&&u.resources?.duality?.value===0);
    const active=new Set(complete.map(u=>String(u.id)));
    for(const u of complete){const id=String(u.id);if(!this.auras.has(id))this.auras.set(id,this.makeAura(u));}
    for(const [key,node] of this.auras)if(!active.has(key)){node.dispose(false,false);this.auras.delete(key);}
    const berserk=(snapshot?.units||[]).filter(u=>u.characterId==='livia'&&
      u.resources?.duality?.berserk===true);
    const berserkIds=new Set(berserk.map(u=>String(u.id)));
    for(const u of berserk){
      const id=String(u.id);
      if(!this.ghosts.has(id))this.ghosts.set(id,this.makeSpecter(`berserk-${id}`,{ambient:true}));
      this.ghostOpacity(id,true);
    }
    for(const [id,node] of this.ghosts)if(!berserkIds.has(id)){
      node.dispose(false,false);this.ghosts.delete(id);this.ghostOpacity(id,false);
    }
    for(const event of events||[]){
      if(event?.type==='LIVIA_FLURRY_PATH'){
        const key=`${mapId}:${event.sequence}:${event.unitId}`;
        if(!this.seenActions.has(key)){
          this.seenActions.add(key);this.makeFlurry(snapshot,event);
        }
        continue;
      }
      if(event?.type!=='UNIT_ANIMATION'||!['livia_purified_nether','nether_slash','black_slash'].includes(event.skillId))continue;
      const key=`${mapId}:${event.sequence}:${event.skillId}:${event.unitId}`;
      if(this.seenActions.has(key))continue;
      this.seenActions.add(key);
      // The animation stream drains events; keep a bounded history only as a
      // safeguard against a replayed network presentation snapshot.
      if(this.seenActions.size>384)this.seenActions.delete(this.seenActions.values().next().value);
      if(event.skillId==='livia_purified_nether')this.swing(snapshot,event);
      else if(event.skillId==='black_slash')this.swordTechnique(snapshot,event);
      else if(!event.blinkCombo&&(Number(event.hitCount||0)>1||
        (snapshot?.units||[]).some(u=>String(u.id)===String(event.unitId)&&u.resources?.duality?.value===100)))
        this.swordTechnique(snapshot,event,{shadow:true});
    }
  }
  updateFrame(now=time()){
    for(const [key,root] of this.wells){root.rotation.y+=.006;
      root.position.y=this.yOf(this._snapshot,...key.split(',').map(Number))+.13+Math.sin(now*.002)*.04;}
    for(const [key,root] of this.rifts)root.rotation.y=Math.sin(now*.001+key.length)*.10;
    for(const [id,root] of this.auras){const unit=(this._snapshot?.units||[]).find(u=>String(u.id)===id);
      if(!unit)continue;root.position.set(unit.x*TILE_SIZE,
        Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT+.12,unit.y*TILE_SIZE);root.rotation.y+=.005;}
    for(const combo of [...this.flurries]){
      const t=Math.max(0,Math.min(1,(now-combo.started)/combo.duration));
      const phase=t*combo.points.length;
      const index=Math.min(combo.points.length-1,Math.floor(phase));
      const local=Math.max(0,Math.min(1,phase-index));
      const point=combo.points[index],entry=this.entryFor(combo.unitId);
      if(entry){
        // Called after UnitRenderer.updateFrame: animate the actual Babylon
        // actor, NOT a detached sword beam. Final coordinates always come
        // from the authoritative snapshot on the next frame.
        const position=this.units.positionFor(entry,point);
        entry.root.position.copyFrom(position);
        entry.facingMarker?.root?.position.copyFrom(this.units.markerPositionFor(point));
        if(Number.isFinite(combo.targetX)&&Number.isFinite(combo.targetY)){
          const dx=combo.targetX-point.x,dy=combo.targetY-point.y;
          if(dx||dy){
            const angle=Math.atan2(dx,dy);
            entry.root.rotation.y=angle;
            if(entry.facingMarker?.root)entry.facingMarker.root.rotation.y=angle;
          }
        }
        entry.root.scaling.setAll((entry.baseScale||1)*(local<.16?.08:local>.85?.42:1));
      }
      for(let i=0;i<combo.echoes.length;i++){
        const echo=combo.echoes[i],visible=i<=index&&index-i<=1;
        echo.setEnabled(visible);
        if(visible){
          const fade=i===index?1:Math.max(.05,1-local);
          echo.scaling.setAll((i===index?.68:.90)*fade);
          echo.rotation.y=now*.004+(i%2?Math.PI:0);
          for(const mesh of echo.getChildMeshes?.()||[])if(mesh.metadata?.specterSaber)
            mesh.rotation.z=(i%2?1:-1)*(.9-1.7*local);
        }
      }
      if(t>=1){
        for(const echo of combo.echoes)echo.dispose(false,false);
        this.flurries.splice(this.flurries.indexOf(combo),1);
      }
    }
    for(const [id,root] of this.ghosts){
      const unit=(this._snapshot?.units||[]).find(u=>String(u.id)===id);
      if(!unit)continue;
      const comboActive=this.flurries.some(c=>c.unitId===id);
      const entry=comboActive?this.entryFor(id):null;
      if(entry)root.position.set(entry.root.position.x,
        entry.root.position.y+.02+Math.sin(now*.003)*.035,
        entry.root.position.z);
      else root.position.set(Number(unit.x)*TILE_SIZE,
        Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT+.02+Math.sin(now*.003)*.035,
        Number(unit.y)*TILE_SIZE);
      root.rotation.y+=.012;
      const wisps=root.getChildMeshes?.()||[];
      for(const mesh of wisps){
        const i=mesh.metadata?.specterWisp;
        if(!Number.isInteger(i))continue;
        const a=now*.0011+i*Math.PI*.5;
        mesh.position.set(Math.sin(a)*.42,.43+Math.sin(a*1.7)*.27,
          Math.cos(a)*.42);
      }
    }
    for(const item of [...this.swings]){
      const progress=Math.max(0,Math.min(1,(now-item.started)/item.duration));
      if(item.kind==='SHADOW'||item.kind==='BLACK'){
        item.pivot.rotation.y=item.from;
        const count=item.slices.length;
        item.slices.forEach((slice,i)=>{
          const local=progress*count-i;
          if(local<0||local>1){slice.setEnabled(false);return;}
          slice.setEnabled(true);
          slice.rotation.y=(i%2?-.58:.58)+(local-.5)*1.5;
          slice.rotation.z=(i%2?-1:1)*(.82-local*1.65);
          slice.position.set(Math.sin(local*Math.PI)*(i%2?-.18:.18),0,Math.sin(local*Math.PI)*.17);
          slice.scaling.setAll(Math.max(.04,Math.sin(Math.PI*local)));
        });
      }else{
        item.pivot.rotation.y=item.from-.95+progress*1.9;
        item.pivot.rotation.z=.68-progress*1.35;
        item.pivot.scaling.setAll(progress<.18?Math.max(.03,progress/.18):progress>.78?Math.max(.02,(1-progress)/.22):1);
      }
      if(progress>=1){item.pivot.dispose(false,false);this.swings.splice(this.swings.indexOf(item),1);}
    }
  }
  clear(){
    for(const id of this.ghosts.keys())this.ghostOpacity(id,false);
    for(const group of [this.wells,this.rifts,this.auras,this.ghosts]){for(const node of group.values())node.dispose(false,false);group.clear();}
    for(const combo of this.flurries)for(const echo of combo.echoes)echo.dispose(false,false);
    this.flurries.length=0;
    for(const item of this.swings)item.pivot.dispose(false,false);this.swings.length=0;this.seenActions.clear();
  }
  diagnostics(){return{wells:this.wells.size,distortionTiles:this.rifts.size,completeAuras:this.auras.size,berserkGhosts:this.ghosts.size,flurryAnimations:this.flurries.length,bladeSwings:this.swings.length};}
  dispose(){this.clear();for(const material of this.materials.values())material.dispose();this.materials.clear();}
}

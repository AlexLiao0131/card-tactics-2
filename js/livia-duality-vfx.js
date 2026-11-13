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
    this.rifts=new Map();this.auras=new Map();this.swings=[];this.materials=new Map();
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
    for(const event of events||[])if(event.type==='UNIT_ANIMATION'&&event.skillId==='livia_purified_nether')this.swing(snapshot,event);
  }
  updateFrame(now=time()){
    for(const [key,root] of this.wells){root.rotation.y+=.006;
      root.position.y=this.yOf(this._snapshot,...key.split(',').map(Number))+.13+Math.sin(now*.002)*.04;}
    for(const [key,root] of this.rifts)root.rotation.y=Math.sin(now*.001+key.length)*.10;
    for(const [id,root] of this.auras){const unit=(this._snapshot?.units||[]).find(u=>String(u.id)===id);
      if(!unit)continue;root.position.set(unit.x*TILE_SIZE,
        Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT+.12,unit.y*TILE_SIZE);root.rotation.y+=.005;}
    for(const item of [...this.swings]){
      const progress=Math.max(0,Math.min(1,(now-item.started)/item.duration));
      item.pivot.rotation.y=item.from-.95+progress*1.9;
      item.pivot.rotation.z=.68-progress*1.35;
      item.pivot.scaling.setAll(progress<.18?Math.max(.03,progress/.18):progress>.78?Math.max(.02,(1-progress)/.22):1);
      if(progress>=1){item.pivot.dispose(false,false);this.swings.splice(this.swings.indexOf(item),1);}
    }
  }
  clear(){
    for(const group of [this.wells,this.rifts,this.auras]){for(const node of group.values())node.dispose(false,false);group.clear();}
    for(const item of this.swings)item.pivot.dispose(false,false);this.swings.length=0;
  }
  diagnostics(){return{wells:this.wells.size,distortionTiles:this.rifts.size,completeAuras:this.auras.size,bladeSwings:this.swings.length};}
  dispose(){this.clear();for(const material of this.materials.values())material.dispose();this.materials.clear();}
}

/**
 * Shared, presentation-only Babylon primitives for the three original heroes.
 * Does not read or mutate gameplay state, move units, compute hits, or tick buffs.
 * Material reuse, capped active effects, and the native renderer frame clock
 * keep this viable on mobile Safari. Every target derives from a visible
 * authoritative snapshot or a delivered official presentation event.
 */
import {TILE_SIZE,ELEVATION_HEIGHT} from './coordinate-system.js';

export const VFX_TILE=TILE_SIZE;
export const VFX_TAU=Math.PI*2;
export const vfxClamp=value=>Math.max(0,Math.min(1,Number(value)||0));
export const vfxSmooth=value=>{const t=vfxClamp(value);return t*t*(3-2*t)};
export const vfxLerp=(a,b,t)=>a+(b-a)*t;
export const vfxVec=(x,y,z)=>new BABYLON.Vector3(x,y,z);

export class HeroCombatVfxBase{
  constructor(scene,{name,colors,maxActive=7}={}){
    this.scene=scene;
    this.name=name;
    this.maxActive=maxActive;
    this.active=[];
    this.auras=new Map();
    this.seen=new Set();
    this.lastMapId=null;
    this.lastRound=null;
    this.materials={};
    for(const [key,[rgb,alpha]] of Object.entries(colors||{})){
      const material=new BABYLON.StandardMaterial(`${name}-${key}`,scene);
      material.diffuseColor=new BABYLON.Color3(...rgb);
      material.emissiveColor=new BABYLON.Color3(...rgb);
      material.alpha=alpha;
      material.disableLighting=true;
      material.backFaceCulling=false;
      material.disableDepthWrite=true;
      if(BABYLON.Engine?.ALPHA_ADD!==undefined)material.alphaMode=BABYLON.Engine.ALPHA_ADD;
      this.materials[key]=material;
    }
    scene.onDisposeObservable?.addOnce?.(()=>this.dispose());
  }
  node(name,position){
    const root=new BABYLON.TransformNode(`${this.name}-${name}`,this.scene);
    if(position)root.position.copyFrom(position);
    return root;
  }
  mesh(root,name,type,params,material){
    const mesh=BABYLON.MeshBuilder[type](`${this.name}-${name}`,params,this.scene);
    mesh.parent=root;
    mesh.material=this.materials[material];
    mesh.isPickable=false;
    mesh.receiveShadows=false;
    mesh.metadata={castShadow:false};
    return mesh;
  }
  ring(root,name,diameter,material,segments=12){
    return this.mesh(root,name,'CreateTorus',{diameter,thickness:.055,tessellation:segments},material);
  }
  orb(root,name,diameter,material){
    return this.mesh(root,name,'CreateSphere',{diameter,segments:8},material);
  }
  shard(root,name,material,height=.30){
    return this.mesh(root,name,'CreateBox',{width:.09,height,depth:.065},material);
  }
  tube(root,name,points,material,radius=.065){
    return this.mesh(root,name,'CreateTube',{path:points,radius,tessellation:6,updatable:false},material);
  }
  findUnit(snapshot,id){
    return (snapshot?.units||[]).find(u=>String(u.id)===String(id))||null;
  }
  terrainY(snapshot,x,y){
    const tile=(snapshot?.map?.tiles||[]).find(t=>t.x===x&&t.y===y);
    return Number(tile?.elevation??0)*ELEVATION_HEIGHT;
  }
  unitY(unit){return Number(unit?.renderZ??unit?.z??0)*ELEVATION_HEIGHT;}
  point(snapshot,x,y,above=.8){
    const unit=(snapshot?.units||[]).find(u=>u.alive!==false&&u.x===x&&u.y===y);
    return vfxVec(Number(x)*TILE_SIZE,
      (unit?this.unitY(unit):this.terrainY(snapshot,x,y))+above,
      Number(y)*TILE_SIZE);
  }
  unitPoint(unit,above=.85){
    return vfxVec(Number(unit.x)*TILE_SIZE,this.unitY(unit)+above,Number(unit.y)*TILE_SIZE);
  }
  prepare(snapshot){
    const mapId=snapshot?.map?.id??null;
    const round=Number(snapshot?.round??0);
    if(this.lastRound!==null&&(this.lastMapId!==mapId||round<this.lastRound))this.clear();
    this.lastMapId=mapId;
    this.lastRound=round;
  }
  /** Reject actors and unit targets removed by the official seat visibility projection. */
  acceptEvent(snapshot,event,ids){
    if(event?.type!=='UNIT_ANIMATION'||!ids.includes(event.skillId)||
       !Number.isFinite(event.x)||!Number.isFinite(event.y)||
       !Number.isFinite(event.targetX)||!Number.isFinite(event.targetY))return false;
    if(!this.findUnit(snapshot,event.unitId))return false;
    if(event.targetId!=null&&event.targetKind!=='MAP'&&
       !this.findUnit(snapshot,event.targetId)&&event.targetDefeated!==true)return false;
    const key=`${this.lastMapId}:${event.sequence}:${event.unitId}:${event.skillId}`;
    if(this.seen.has(key))return false;
    this.seen.add(key);
    if(this.seen.size>192)this.seen.delete(this.seen.values().next().value);
    return true;
  }
  createEffect(kind,event,snapshot,now,duration){
    const from=this.point(snapshot,event.x,event.y,1.05);
    const to=this.point(snapshot,event.targetX,event.targetY,.82);
    const root=this.node(`${kind}-${event.sequence}`,to);
    const effect={root,kind,from,to,started:now,duration,event};
    this.active.push(effect);
    while(this.active.length>this.maxActive)this.removeEffect(this.active.shift());
    return effect;
  }
  removeEffect(effect){effect?.root?.dispose?.(false,false);}
  status(key,unit,create){
    let fx=this.auras.get(key);
    if(!fx){fx=create();this.auras.set(key,fx);}
    fx.root.position.copyFrom(this.unitPoint(unit,fx.above??.75));
    return fx;
  }
  pruneStatuses(wanted){
    for(const [id,fx] of this.auras){
      if(!wanted.has(id)){fx.root.dispose?.(false,false);this.auras.delete(id);}
    }
  }
  updateFrame(now=performance.now()){
    for(let i=this.active.length-1;i>=0;i--){
      const fx=this.active[i],elapsed=Math.max(0,now-fx.started);
      if(elapsed>=fx.duration){this.removeEffect(fx);this.active.splice(i,1);continue;}
      this.updateEffect(fx,elapsed,vfxClamp(elapsed/fx.duration));
    }
    this.updateAuras(now);
  }
  updateEffect(_fx,_elapsed,_progress){}
  updateAuras(_now){}
  clear(){
    for(const fx of this.active)this.removeEffect(fx);
    this.active.length=0;
    for(const fx of this.auras.values())fx.root.dispose?.(false,false);
    this.auras.clear();this.seen.clear();
  }
  dispose(){
    this.clear();
    for(const material of Object.values(this.materials))material.dispose?.();
  }
  diagnostics(){return{active:this.active.length,auras:this.auras.size,
    materials:Object.keys(this.materials).length};}
}

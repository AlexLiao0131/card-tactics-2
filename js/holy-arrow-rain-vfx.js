/**
 * Babylon-only presentation for the canonical airborne Holy Arrow Rain.
 * Thirteen gold-white arrows leave the angel's EXISTING bow and arc toward
 * the legal 13-cell diamond. Damage, team filtering, costs and actual target
 * validation remain with TacticalActionController / BattleEngine, never here.
 * Single existing render clock, no per-arrow light or external textures.
 */
import {TILE_SIZE,ELEVATION_HEIGHT} from './coordinate-system.js';

const SKILL_ID='angel_holy_arrow_rain';
const CHARGE_MS=280,STAGGER_MS=12,FLIGHT_MS=470,AFTERGLOW_MS=290;
const LIFE_MS=CHARGE_MS+STAGGER_MS*12+FLIGHT_MS+AFTERGLOW_MS;
const clamp01=v=>Math.max(0,Math.min(1,Number(v)||0));
const smooth=t=>{const p=clamp01(t);return p*p*(3-2*p)};

export function holyArrowRainTiles(map,center){
  if(!Number.isInteger(center?.x)||!Number.isInteger(center?.y))return[];
  return (map?.tiles||[]).filter(tile=>
    Math.abs(tile.x-center.x)+Math.abs(tile.y-center.y)<=2);
}

export class HolyArrowRainVfx{
  constructor(scene,{units=null}={}){
    this.scene=scene;
    this.units=units;
    this.active=[];
    this.lastMapId=null;
    this.lastRound=null;
    this.recent=new Set();
    this.materials={
      gold:this.material('holy-arrow-gold',[1,.71,.17],.96),
      core:this.material('holy-arrow-core',[1,.97,.78],.98),
      glow:this.material('holy-arrow-afterglow',[1,.80,.32],.64)
    };
    scene.onDisposeObservable?.addOnce?.(()=>this.dispose());
  }
  material(name,color,alpha){
    const m=new BABYLON.StandardMaterial(name,this.scene);
    m.diffuseColor=new BABYLON.Color3(...color);
    m.emissiveColor=new BABYLON.Color3(...color);
    m.disableLighting=true;m.backFaceCulling=false;m.alpha=alpha;
    return m;
  }
  child(root,mesh,mat){
    mesh.parent=root;mesh.material=mat;mesh.isPickable=false;
    mesh.receiveShadows=false;mesh.metadata={castShadow:false};return mesh;
  }
  height(snapshot,tile){
    const matching=(snapshot?.units||[]).find(u=>u.x===tile.x&&u.y===tile.y&&u.alive!==false);
    if(matching&&Number.isFinite(Number(matching.renderZ??matching.z)))
      return Number(matching.renderZ??matching.z)*ELEVATION_HEIGHT;
    return Number(tile.elevation||0)*ELEVATION_HEIGHT;
  }
  getBowPosition(cast){
    const part=cast.entry?.kind==='FIGURE'?cast.entry?.figureParts?.bow:null;
    if(part?.getAbsolutePosition){
      part.computeWorldMatrix?.(true);
      const v=part.getAbsolutePosition();
      if(v&&[v.x,v.y,v.z].every(Number.isFinite))return v.clone();
    }
    return new BABYLON.Vector3(cast.from.x*TILE_SIZE,
      Number(cast.from.renderZ??cast.from.z??0)*ELEVATION_HEIGHT+1.25,
      cast.from.y*TILE_SIZE);
  }
  arrowFor(cast,tile,index){
    const root=new BABYLON.TransformNode(`holy-rain-arrow-${index}`,this.scene);
    const shaft=this.child(root,BABYLON.MeshBuilder.CreateCylinder(`holy-rain-shaft-${index}`,
      {height:.52,diameter:.085,tessellation:6},this.scene),this.materials.gold);
    shaft.rotation.x=Math.PI/2;
    const core=this.child(root,BABYLON.MeshBuilder.CreateCylinder(`holy-rain-core-${index}`,
      {height:.42,diameter:.033,tessellation:6},this.scene),this.materials.core);
    core.rotation.x=Math.PI/2;
    const tip=this.child(root,BABYLON.MeshBuilder.CreateCylinder(`holy-rain-tip-${index}`,
      {height:.22,diameterTop:.025,diameterBottom:.14,tessellation:6},this.scene),this.materials.gold);
    tip.rotation.x=Math.PI/2;tip.position.z=.33;
    root.setEnabled(false);
    const halo=this.child(null,BABYLON.MeshBuilder.CreateTorus(`holy-rain-impact-${index}`,
      {diameter:.78,thickness:.08,tessellation:12},this.scene),this.materials.glow);
    halo.rotation.x=Math.PI/2;
    halo.position.set(tile.x*TILE_SIZE,this.height(cast.snapshot,tile)+.14,tile.y*TILE_SIZE);
    halo.setEnabled(false);
    return{root,halo,tile,index,impactAt:null};
  }
  start(event,snapshot,now){
    const center={x:Number(event.targetX),y:Number(event.targetY)};
    if(!Number.isSafeInteger(center.x)||!Number.isSafeInteger(center.y))return;
    const from=(snapshot.units||[]).find(u=>String(u.id)===String(event.unitId));
    if(!from)return;
    const tiles=holyArrowRainTiles(snapshot.map,center);
    if(!tiles.some(tile=>tile.x===center.x&&tile.y===center.y))return;
    const entry=this.units?.entries?.get(from.id)||this.units?.entries?.get(String(from.id))||null;
    const cast={from,entry,snapshot,center,started:now,origin:null,arrows:[],charge:null};
    // Collect light AT the held bow and release it as a single fan of arcs.
    const chargeRoot=new BABYLON.TransformNode('holy-rain-bow-charge',this.scene);
    const mesh=this.child(chargeRoot,BABYLON.MeshBuilder.CreateSphere('holy-rain-bow-focus',
      {diameter:.37,segments:8},this.scene),this.materials.core);
    cast.charge={root:chargeRoot,mesh};
    cast.arrows=tiles.map((tile,i)=>this.arrowFor(cast,tile,i));
    this.active.push(cast);
    while(this.active.length>3){const obsolete=this.active.shift();this.remove(obsolete);}
  }
  sync(snapshot,events=[]){
    const mapId=snapshot?.map?.id??null,round=Number(snapshot?.round||0);
    if(this.lastMapId!==null&&(mapId!==this.lastMapId||round<this.lastRound))this.clear();
    this.lastMapId=mapId;this.lastRound=round;
    const visible=new Set((snapshot?.units||[]).map(u=>String(u.id)));
    const now=performance.now();
    for(const event of events||[]){
      if(event?.type!=='UNIT_ANIMATION'||event.skillId!==SKILL_ID||
        !visible.has(String(event.unitId)))continue;
      const token=Number.isSafeInteger(event.sequence)
        ?`${mapId}:${event.sequence}:${event.unitId}`:null;
      if(token&&this.recent.has(token))continue;
      if(token){this.recent.add(token);if(this.recent.size>48)this.recent.delete(this.recent.values().next().value);}
      this.start(event,snapshot,now);
    }
  }
  updateFrame(now=performance.now()){
    for(let i=this.active.length-1;i>=0;i--){
      const cast=this.active[i],elapsed=Math.max(0,now-cast.started);
      if(elapsed>=LIFE_MS){this.remove(cast);this.active.splice(i,1);continue;}
      const bow=this.getBowPosition(cast);
      cast.charge.root.position.copyFrom(bow);
      cast.charge.root.scaling.setAll(.15+.95*smooth(elapsed/CHARGE_MS));
      cast.charge.mesh.visibility=elapsed<CHARGE_MS?(.35+.65*smooth(elapsed/CHARGE_MS)):0;
      cast.charge.root.setEnabled(elapsed<CHARGE_MS);
      if(elapsed>=CHARGE_MS&&!cast.origin)cast.origin=bow.clone();
      for(const arrow of cast.arrows){
        const since=elapsed-CHARGE_MS-arrow.index*STAGGER_MS;
        if(since<0){arrow.root.setEnabled(false);arrow.halo.setEnabled(false);continue;}
        const p=clamp01(since/FLIGHT_MS),start=cast.origin||bow;
        const end=new BABYLON.Vector3(arrow.tile.x*TILE_SIZE,
          this.height(cast.snapshot,arrow.tile)+.23,arrow.tile.y*TILE_SIZE);
        if(p<1){
          arrow.root.setEnabled(true);arrow.halo.setEnabled(false);
          const distance=BABYLON.Vector3.Distance(start,end);
          const control=start.add(end).scale(.5);
          control.y=Math.max(start.y,end.y)+1.55+distance*.20;
          const point=BABYLON.Vector3.Lerp(BABYLON.Vector3.Lerp(start,control,p),
            BABYLON.Vector3.Lerp(control,end,p),p);
          const nextP=Math.min(1,p+.015);
          const next=BABYLON.Vector3.Lerp(BABYLON.Vector3.Lerp(start,control,nextP),
            BABYLON.Vector3.Lerp(control,end,nextP),nextP);
          arrow.root.position.copyFrom(point);
          arrow.root.lookAt(next);
        }else{
          arrow.root.setEnabled(false);
          arrow.halo.setEnabled(true);
          const aftermath=clamp01((since-FLIGHT_MS)/AFTERGLOW_MS);
          arrow.halo.scaling.setAll(.30+1.30*smooth(aftermath));
          arrow.halo.visibility=(1-aftermath)*.88;
        }
      }
    }
  }
  remove(cast){
    cast?.charge?.root?.dispose?.(false,false);
    for(const arrow of cast?.arrows||[]){arrow.root?.dispose?.(false,false);arrow.halo?.dispose?.();}
  }
  clear(){for(const cast of this.active)this.remove(cast);this.active.length=0;this.recent.clear();}
  dispose(){this.clear();for(const mat of Object.values(this.materials))mat.dispose?.();}
  diagnostics(){return{active:this.active.length,arrowCount:this.active.reduce((n,c)=>n+c.arrows.length,0),materials:3};}
}

/**
 * Shared Babylon bow projectile presentation. Every equipped BOW/SHOT attack
 * uses the same flight mesh. It consumes the official UNIT_ANIMATION stream;
 * it never rolls attacks, applies damage, or invents gameplay projectiles.
 * The angel's already-authored Holy Arrow Rain is deliberately left to its
 * dedicated full-area VFX to avoid drawing that special spell twice.
 */
import {SkillDatabase} from './skill-database.js';
import {TILE_SIZE,ELEVATION_HEIGHT} from './coordinate-system.js';

const SPECIALIZED=new Set(['angel_holy_arrow_rain']);
const clamp=t=>Math.max(0,Math.min(1,t));
export function isBowProjectileEvent(event){
  if(event?.type!=='UNIT_ANIMATION'||!event.skillId||SPECIALIZED.has(event.skillId))return false;
  let skill=null;
  try{skill=SkillDatabase.get(event.skillId);}catch(_error){return false;}
  // Official resolution emits the equipped weapon kind for INHERIT shots.
  return event.projectileKind==='BOW'||skill?.attackType==='SHOT'||
    skill?.projectile?.kind==='BOW_ARROW';
}
export class ArrowProjectileVfx{
  constructor(scene,{units=null}={}){
    this.scene=scene;this.units=units;this.active=[];this.seen=new Set();
    this.mapId=null;this.lastRound=null;this.materials={};
    scene.onDisposeObservable?.addOnce?.(()=>this.dispose());
  }
  material(name,rgb){
    if(this.materials[name])return this.materials[name];
    const m=new BABYLON.StandardMaterial(`bow-projectile-${name}`,this.scene);
    m.diffuseColor=new BABYLON.Color3(...rgb);m.emissiveColor=new BABYLON.Color3(...rgb).scale(.12);
    m.specularColor=BABYLON.Color3.Black();m.backFaceCulling=false;
    this.materials[name]=m;return m;
  }
  mesh(root,mesh,mat){
    mesh.parent=root;mesh.material=mat;mesh.isPickable=false;
    mesh.receiveShadows=false;mesh.metadata={castShadow:false};return mesh;
  }
  createArrow(token){
    const root=new BABYLON.TransformNode(`bow-arrow-flight-${token}`,this.scene);
    const shaft=this.mesh(root,BABYLON.MeshBuilder.CreateCylinder(`bow-shaft-${token}`,{
      height:.63,diameter:.022,tessellation:5},this.scene),this.material('wood',[.43,.30,.17]));
    shaft.rotation.x=Math.PI/2;
    const tip=this.mesh(root,BABYLON.MeshBuilder.CreateCylinder(`bow-tip-${token}`,{
      height:.14,diameterTop:0,diameterBottom:.07,tessellation:5},this.scene),this.material('metal',[.74,.79,.76]));
    tip.rotation.x=Math.PI/2;tip.position.z=.385;
    for(const side of [-1,1]){
      const feather=this.mesh(root,BABYLON.MeshBuilder.CreateBox(`bow-fletch-${side}-${token}`,{
        width:.065,height:.008,depth:.15},this.scene),this.material('feather',[.77,.76,.63]));
      feather.position.set(side*.035,0,-.26);feather.rotation.z=side*.28;
    }
    root.setEnabled(false);return root;
  }
  unit(snapshot,id){return (snapshot?.units||[]).find(u=>String(u.id)===String(id));}
  bowOrigin(unit){
    const entry=this.units?.entries?.get(unit.id)||this.units?.entries?.get(String(unit.id));
    const bow=entry?.figureParts?.bow;
    if(bow?.getAbsolutePosition){
      bow.computeWorldMatrix?.(true);const point=bow.getAbsolutePosition();
      if(point&&[point.x,point.y,point.z].every(Number.isFinite))return point.clone();
    }
    return new BABYLON.Vector3(Number(unit.x)*TILE_SIZE,
      Number(unit.renderZ??unit.z??0)*ELEVATION_HEIGHT+1.15,Number(unit.y)*TILE_SIZE);
  }
  impact(snapshot,x,y){
    const victim=(snapshot?.units||[]).find(u=>u.x===x&&u.y===y);
    const tile=(snapshot?.map?.tiles||[]).find(t=>t.x===x&&t.y===y);
    const level=Number(victim?.renderZ??victim?.z??tile?.elevation??0)*ELEVATION_HEIGHT;
    return new BABYLON.Vector3(x*TILE_SIZE,level+(victim?1.0:.16),y*TILE_SIZE);
  }
  sync(snapshot,events=[]){
    const mapId=snapshot?.map?.id??null,round=Number(snapshot?.round||0);
    if(this.mapId!==null&&(mapId!==this.mapId||round<this.lastRound))this.clear();
    this.mapId=mapId;this.lastRound=round;
    const now=performance.now();
    for(const event of events||[]){
      if(!isBowProjectileEvent(event))continue;
      const sourceIds=Array.isArray(event.projectileSources)&&event.projectileSources.length
        ?event.projectileSources:[event.unitId];
      for(let index=0;index<sourceIds.length;index++){
        const id=sourceIds[index],unit=this.unit(snapshot,id);
        if(!unit)continue; // Never reveal a hidden opposing archer.
        const skill=SkillDatabase.get(event.skillId);
        const fan=skill?.fanShot&&Array.isArray(event.fanTargetCells)?
          event.fanTargetCells.filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)):null;
        const triple=skill?.hitCount===3;
        const targets=fan?.length?fan:(triple?[0,1,2].map(()=>({x:event.targetX,y:event.targetY})):
          [{x:event.targetX,y:event.targetY}]);
        const from=skill?.backstep?new BABYLON.Vector3(Number(event.x)*TILE_SIZE,
          Number(event.z??unit.renderZ??unit.z??0)*ELEVATION_HEIGHT+1.15,
          Number(event.y)*TILE_SIZE):this.bowOrigin(unit);
        const tokenBase=`${mapId}:${event.sequence}:${id}:${index}`;
        if(this.seen.has(tokenBase))continue;
        this.seen.add(tokenBase);if(this.seen.size>160)this.seen.delete(this.seen.values().next().value);
        for(let shotIndex=0;shotIndex<targets.length;shotIndex++){
          const x=Number(targets[shotIndex].x),y=Number(targets[shotIndex].y);
          if(!Number.isFinite(x)||!Number.isFinite(y))continue;
          const token=`${tokenBase}:${shotIndex}`;
          const to=this.impact(snapshot,x,y);
          const distance=BABYLON.Vector3.Distance(from,to);
          const duration=Math.max(290,Math.min(710,300+distance*32));
          // Single burst fan; sequential rapid fire is separated by each draw.
          const delay=triple?shotIndex*150:fan?shotIndex*12:index*24;
          this.active.push({root:this.createArrow(token),from:from.clone(),to,
            started:now+delay,duration,sourceId:String(id),targetX:x,targetY:y});
        }
      }
    }
    while(this.active.length>32){const old=this.active.shift();old.root.dispose?.(false,false);}
  }
  // Used by shared fire-arrow impact synchronization. Preserve the existing
  // public contract when replacing the original arrow flight implementation.
  impactTime({x,y,sourceId}={}){
    const source=sourceId==null?null:String(sourceId);
    const entries=this.active.filter(a=>a.targetX===x&&a.targetY===y&&
      (source===null||a.sourceId===source));
    return entries.length?Math.min(...entries.map(a=>a.started+a.duration)):null;
  }
  updateFrame(now=performance.now()){
    for(let i=this.active.length-1;i>=0;i--){
      const a=this.active[i],p=(now-a.started)/a.duration;
      if(p<0)continue;
      if(p>=1){a.root.dispose?.(false,false);this.active.splice(i,1);continue;}
      const t=clamp(p),from=a.from,to=a.to;
      const control=from.add(to).scale(.5);
      control.y=Math.max(from.y,to.y)+Math.min(1.2,.24+BABYLON.Vector3.Distance(from,to)*.13);
      const curve=u=>BABYLON.Vector3.Lerp(BABYLON.Vector3.Lerp(from,control,u),BABYLON.Vector3.Lerp(control,to,u),u);
      const pos=curve(t),ahead=curve(Math.min(1,t+.018));
      a.root.setEnabled(true);a.root.position.copyFrom(pos);a.root.lookAt(ahead);
    }
  }
  clear(){for(const entry of this.active)entry.root.dispose?.(false,false);this.active.length=0;this.seen.clear();}
  dispose(){this.clear();for(const mat of Object.values(this.materials))mat.dispose?.();}
  diagnostics(){return{active:this.active.length,materials:Object.keys(this.materials).length};}
}

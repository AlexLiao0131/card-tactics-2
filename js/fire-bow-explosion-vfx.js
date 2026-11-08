/**
 * Shared Babylon fire-arrow detonation for every equipped BOW.
 * Consumes the FIRE_BOW_EXPLOSION event produced ONLY after the canonical
 * EnchantmentImpact gameplay resolver has committed its one real blast.
 * The source ability supplies its real radius (Livia 1 / Reina volley 2).
 * One event = one visual center. This module never applies damage or fire.
 */
import {TILE_SIZE,ELEVATION_HEIGHT} from './coordinate-system.js';

const LIFE_MS=760;
const clamp01=n=>Math.min(1,Math.max(0,Number(n)||0));
const smooth=n=>{const p=clamp01(n);return p*p*(3-2*p);};

export function isFireBowExplosionEvent(e){
  return e?.type==='FIRE_BOW_EXPLOSION'&&
    Number.isSafeInteger(e.x)&&Number.isSafeInteger(e.y)&&
    Number.isFinite(e.radius)&&e.radius>=0;
}

export class FireBowExplosionVfx{
  constructor(scene,{projectiles=null}={}){
    this.scene=scene;this.projectiles=projectiles;
    this.active=[];this.recent=new Set();this.mapId=null;this.lastRound=null;
    this.materials={
      flash:this.material('fire-arrow-impact-flash',[1,.96,.64],.96),
      flame:this.material('fire-arrow-impact-flame',[1,.37,.055],.72),
      shock:this.material('fire-arrow-impact-shock',[1,.57,.09],.86),
      sparks:this.material('fire-arrow-impact-embers',[1,.78,.18],.98)
    };
    scene.onDisposeObservable?.addOnce?.(()=>this.dispose());
  }
  material(name,color,alpha){
    const m=new BABYLON.StandardMaterial(name,this.scene);
    m.diffuseColor=new BABYLON.Color3(...color);
    m.emissiveColor=new BABYLON.Color3(...color);
    m.disableLighting=true;m.backFaceCulling=false;m.alpha=alpha;
    m.disableDepthWrite=true;
    return m;
  }
  child(root,mesh,material){
    mesh.parent=root;mesh.material=material;mesh.isPickable=false;
    mesh.receiveShadows=false;mesh.metadata={castShadow:false};
    return mesh;
  }
  ground(snapshot,x,y){
    const tile=(snapshot?.map?.tiles||[]).find(t=>t.x===x&&t.y===y);
    return Number(tile?.elevation||0)*ELEVATION_HEIGHT;
  }
  start(e,snapshot,now){
    const tile=(snapshot?.map?.tiles||[]).find(t=>t.x===e.x&&t.y===e.y);
    if(!tile)return;
    const sourceId=e.sourceId==null?null:String(e.sourceId);
    const arrival=this.projectiles?.impactTime?.({x:e.x,y:e.y,sourceId});
    const started=Number.isFinite(arrival)?Math.max(now,arrival):now;
    const root=new BABYLON.TransformNode(`fire-arrow-blast-${e.sequence}`,this.scene);
    root.position.set(e.x*TILE_SIZE,this.ground(snapshot,e.x,e.y),e.y*TILE_SIZE);
    const flash=this.child(root,BABYLON.MeshBuilder.CreateSphere('fire-blast-flash',
      {diameter:1,segments:8},this.scene),this.materials.flash);
    const flame=this.child(root,BABYLON.MeshBuilder.CreateSphere('fire-blast-core',
      {diameter:1,segments:12},this.scene),this.materials.flame);
    const ring=this.child(root,BABYLON.MeshBuilder.CreateTorus('fire-blast-ring',
      {diameter:1,thickness:.055,tessellation:24},this.scene),this.materials.shock);
    ring.rotation.x=Math.PI/2;
    const embers=[];
    for(let i=0;i<6;i++){
      const ember=this.child(root,BABYLON.MeshBuilder.CreateSphere(`fire-blast-ember-${i}`,
        {diameter:.17,segments:5},this.scene),this.materials.sparks);
      embers.push(ember);
    }
    root.setEnabled(false);
    const radial=(Number(e.radius)+.45)*TILE_SIZE;
    this.active.push({root,flash,flame,ring,embers,started,radial,sourceId,
      center:{x:e.x,y:e.y},radius:e.radius});
    while(this.active.length>5)this.remove(this.active.shift());
  }
  sync(snapshot,events=[]){
    const mapId=snapshot?.map?.id??null,round=Number(snapshot?.round||0);
    if(this.mapId!==null&&(mapId!==this.mapId||round<this.lastRound))this.clear();
    this.mapId=mapId;this.lastRound=round;
    const now=performance.now();
    for(const e of events||[]){
      if(!isFireBowExplosionEvent(e))continue;
      const token=`${mapId}:${e.sequence}:${e.x}:${e.y}`;
      if(this.recent.has(token))continue;
      this.recent.add(token);
      if(this.recent.size>80)this.recent.delete(this.recent.values().next().value);
      this.start(e,snapshot,now);
    }
  }
  updateFrame(now=performance.now()){
    for(let i=this.active.length-1;i>=0;i--){
      const fx=this.active[i],elapsed=now-fx.started;
      if(elapsed<0)continue;
      if(elapsed>=LIFE_MS){this.remove(fx);this.active.splice(i,1);continue;}
      const p=clamp01(elapsed/LIFE_MS),expand=smooth(p/.52),falloff=1-smooth((p-.24)/.76);
      fx.root.setEnabled(true);
      // Gold-white impact flash, expanding incandescent fireball and a single
      // horizontal shockwave: larger volleys scale to the actual area radius.
      const bright=1-smooth(p/.25);
      fx.flash.scaling.setAll(.22+fx.radial*(.35+.40*expand));
      fx.flash.position.y=.36+fx.radial*.11;
      fx.flash.visibility=.92*bright;
      const spread=.28+fx.radial*(.23+.67*expand);
      fx.flame.scaling.set(spread,spread*.60,spread);
      fx.flame.position.y=spread*.28;
      fx.flame.visibility=.74*falloff;
      const ringScale=.18+fx.radial*2*expand;
      fx.ring.scaling.set(ringScale,ringScale,ringScale);
      fx.ring.position.y=.13;
      fx.ring.visibility=.90*(1-smooth(p/.68));
      // A fixed six-ember burst avoids per-frame object creation and random
      // divergence. Materials are shared among all explosions in the scene.
      for(let j=0;j<fx.embers.length;j++){
        const a=j*Math.PI/3+.18,spur=(.30+fx.radial*.78*smooth(p/.75))*(.82+(j%3)*.12);
        const spark=fx.embers[j];
        spark.position.set(Math.cos(a)*spur,.24+spur*(.25+(j%2)*.20)+p*.42,Math.sin(a)*spur);
        spark.scaling.setAll(1.1+.7*smooth(p/.4));
        spark.visibility=Math.max(0,1-smooth((p-.33)/.67));
      }
    }
  }
  remove(fx){fx?.root?.dispose?.(false,false);}
  clear(){for(const fx of this.active)this.remove(fx);this.active.length=0;this.recent.clear();}
  dispose(){this.clear();for(const mat of Object.values(this.materials))mat.dispose?.();}
  diagnostics(){return{active:this.active.length,materials:Object.keys(this.materials).length,
    centers:this.active.map(e=>({...e.center,radius:e.radius}))};}
}

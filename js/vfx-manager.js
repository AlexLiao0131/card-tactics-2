/**
 * The ONE Babylon presentation VFX owner. The battle renderer neither imports
 * heroes nor enumerates spell modules. Rules remain in SkillDatabase /
 * EffectEngine / BattleResolution; this manager only dispatches official events
 * and committed, viewer-filtered presentation snapshots.
 *
 * Adding a skill that reuses an effect role: edit vfx-database.js only.
 * Adding a genuinely new geometry type: register one new behavior factory here.
 */
import {VfxDatabase} from './vfx-database.js?rev=20261121-alchemy-swift-breath-1';
import {TILE_SIZE,ELEVATION_HEIGHT} from './coordinate-system.js';
import {isBowProjectileEvent,ArrowProjectileVfx} from './arrow-projectile-vfx.js';
import {FireBowExplosionVfx} from './fire-bow-explosion-vfx.js';
import {HolyBladeVfx} from './holy-blade-vfx.js';
import {HolyVolleyVfx} from './holy-volley-vfx.js';
import {DimensionalRiftVfx} from './dimensional-rift-vfx.js';
import {ArcaneSigilVfx} from './arcane-sigil-vfx.js?rev=20261121-alchemy-swift-breath-1';
import {ShadowElementalVfx} from './shadow-elemental-vfx.js';
import {NatureGrowthVfx} from './nature-growth-vfx.js';
import {BloodRitualVfx} from './blood-ritual-vfx.js';
import {HolyRitualVfx} from './holy-ritual-vfx.js';
import {AquaticMagicVfx} from './aquatic-magic-vfx.js';
import {BladeStealthVfx} from './blade-stealth-vfx.js';
import {SwordsmanshipVfx} from './swordsmanship-vfx.js';
import {ShieldGuardVfx} from './shield-guard-vfx.js';
import {LiviaDualityVfx} from './livia-duality-vfx.js';
import {PhysicalImpactVfx} from './physical-impact-vfx.js';
import {WildMagicVfx} from './wild-magic-vfx.js?rev=20261118-avreshi-vfx-2';

/** The Babylon scene is the identity of one visual playback session.
 * No game-state writer, global unit position cache, or secondary frame loop. */
const liveManagers=new WeakMap();
export const visualManagerFor=scene=>liveManagers.get(scene)||null;

const UNIT_AURA_MODULES=new Set([
  'nature-growth','blood-ritual','holy-ritual','aquatic-magic',
  'blade-stealth','livia-duality','dimensional','wild-magic'
]);

/** Resolve a visible character's ACTUAL interpolated Babylon root. The
 * authoritative snapshot coordinates are destinations and must NOT position
 * a body-bound aura while UnitRenderer is still crossing tiles. */
export function attachAurasToRenderedUnits(instances,unitRenderer){
  const entries=unitRenderer?.entries;
  if(!entries)return 0;
  const entryFor=id=>entries.get(String(id))||entries.get(id);
  const follow=(root,id,height)=>{
    const entry=entryFor(id);
    if(!root?.position||!entry?.root||entry.root.isDisposed?.())return false;
    const position=entry.root.getAbsolutePosition?.()||entry.root.position;
    if(!position)return false;
    root.position.copyFrom(position);
    // CAPSULE roots are centered; FIGURE/BIRD/QUADRUPED roots stand on ground.
    root.position.y+=(entry.kind==='CAPSULE'?-Number(entry.height||0)/2:0)+height;
    return true;
  };
  let moved=0;
  for(const [module,handler] of instances||[]){
    if(UNIT_AURA_MODULES.has(module)){
      for(const [key,fx] of handler?.auras||[]){
        if(String(key).startsWith('SOURCE:')||fx?.soulSource)continue;
        const candidates=module==='livia-duality'||module==='dimensional'
          ?[String(key)]:[String(key).split(':').at(-1),String(key)];
        const unitId=candidates.find(id=>entryFor(id));
        if(unitId==null)continue;
        const node=fx?.root||fx;
        const offset=module==='livia-duality'?.12:module==='dimensional'?.35:
          Number(fx?.above??.75);
        if(follow(node,unitId,offset))moved++;
      }
    }
    // Cassandra's analysis glyphs have a distinct map, not an aura record.
    if(module==='arcane')for(const [unitId,glyph] of handler?.analysisGlyphs||[])
      if(follow(glyph?.root,unitId,1.58))moved++;
    // The enchantment module already follows the real weapon pivot itself;
    // never overwrite that precise pose with the generic body origin.
  }
  return moved;
}

/** A float tied to an official action must wait for its actual Babylon
 * playback; no speculative millisecond/skill damage timers are involved. */
export function actionVisualsPending(unitRenderer,instances,action){
  if(!action||!Number.isSafeInteger(action.sequence))return false;
  const same=e=>e?.type==='UNIT_ANIMATION'&&e.sequence===action.sequence&&
    String(e.unitId)===String(action.unitId)&&e.skillId===action.skillId;
  for(const queue of unitRenderer?.animationQueues?.values?.()||[])
    if(queue.some(same))return true;
  for(const animation of unitRenderer?.activeAnimations?.values?.()||[])
    if(same(animation?.event))return true;
  // Some official projectile and impact modules predate the common fx.event
  // receipt. Their active objects still identify the original actor, or are
  // restricted to the skill's routed presentation module. Never guess a delay.
  const routed=new Set(vfxRoutesForEvent(action));
  for(const [module,handler] of instances||[]){
    for(const fx of handler?.active||[]){
      if(same(fx?.event))return true;
      if(fx?.event?.sequence!=null)continue; // a different official action
      const actor=fx?.sourceId??fx?.actorId??null;
      if(actor!=null&&String(actor)===String(action.unitId))return true;
      if(actor==null&&routed.has(module))return true;
    }
  }
  return false;
}

/**
 * Shared Babylon visual for skill categories, never an executor of game rules.
 * The heart is an actual 3D billboard plane with a transparent procedural texture;
 * the official UNIT_ANIMATION event exclusively supplies source and target.
 */
class DanceSongVfx{
  constructor(scene){
    this.scene=scene;this.active=[];this.recent=new Set();
    this.materials={};this.heartTexture=null;
    scene.onDisposeObservable?.addOnce?.(()=>this.dispose());
  }
  mat(id,rgb){
    if(this.materials[id])return this.materials[id];
    const m=new BABYLON.StandardMaterial('dance-'+id,this.scene);
    m.diffuseColor=new BABYLON.Color3(...rgb);m.emissiveColor=m.diffuseColor;
    m.alpha=.86;m.disableLighting=true;m.backFaceCulling=false;
    this.materials[id]=m;return m;
  }
  height(snapshot,x,y){
    const unit=(snapshot?.units||[]).find(u=>u.x===x&&u.y===y&&u.alive!==false);
    const raw=unit?.renderZ??unit?.z??(snapshot?.map?.tiles||[]).find(t=>t.x===x&&t.y===y)?.elevation??0;
    return Number(raw)*ELEVATION_HEIGHT;
  }
  pos(snapshot,x,y,above=.8){return new BABYLON.Vector3(Number(x)*TILE_SIZE,
    this.height(snapshot,x,y)+above,Number(y)*TILE_SIZE);}
  heartMaterial(){
    if(this.materials.heart)return this.materials.heart;
    const texture=new BABYLON.DynamicTexture('dance-actual-heart',256,this.scene,false);
    const ctx=texture.getContext();ctx.clearRect(0,0,256,256);
    ctx.fillStyle='#FF4C9F';ctx.strokeStyle='#FFE2EF';ctx.lineWidth=9;
    ctx.beginPath();ctx.moveTo(128,213);
    ctx.bezierCurveTo(83,176,25,126,30,82);
    ctx.bezierCurveTo(34,28,102,21,128,72);
    ctx.bezierCurveTo(153,21,223,28,226,82);
    ctx.bezierCurveTo(229,126,171,176,128,213);
    ctx.closePath();ctx.fill();ctx.stroke();texture.hasAlpha=true;texture.update();
    const mat=new BABYLON.StandardMaterial('dance-heart-pink',this.scene);
    mat.diffuseTexture=texture;mat.opacityTexture=texture;
    mat.useAlphaFromDiffuseTexture=true;mat.backFaceCulling=false;
    mat.disableLighting=true;mat.emissiveColor=new BABYLON.Color3(1,.31,.65);
    this.heartTexture=texture;this.materials.heart=mat;return mat;
  }
  sync(snapshot,events=[]){
    for(const e of events){
      if(e?.type!=='UNIT_ANIMATION'||!Number.isFinite(e.x)||!Number.isFinite(e.y))continue;
      if(this.recent.has(e.sequence))continue;
      this.recent.add(e.sequence);
      if(this.recent.size>512)this.recent.delete(this.recent.values().next().value);
      const role=VfxDatabase.roleFor('dance-magic',e.skillId);
      if(!role)continue;
      const now=performance.now(),from=this.pos(snapshot,e.x,e.y,1.1);
      const tx=Number.isFinite(e.targetX)?e.targetX:e.x,ty=Number.isFinite(e.targetY)?e.targetY:e.y;
      const to=this.pos(snapshot,tx,ty,1.15);
      let mesh,duration=850,bladeRoot=null;
      if(role==='CHARM'&&Number.isFinite(e.targetX)&&Number.isFinite(e.targetY)){
        mesh=BABYLON.MeshBuilder.CreatePlane('dancer-charm-heart',{size:.85},this.scene);
        mesh.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;mesh.material=this.heartMaterial();
        mesh.position.copyFrom(from);duration=780;
      }else{
        mesh=BABYLON.MeshBuilder.CreateTorus('dance-'+role,{diameter:role==='INSPIRE'||role==='PURIFY'?
          (Math.max(1,Number(e.danceRadius||1))*2+.3)*TILE_SIZE:1.18,
          thickness:role==='INSPIRE'||role==='PURIFY'?.065:.10,tessellation:32},this.scene);
        mesh.material=this.mat(role,role==='HYMN'?[1,.90,.45]:role==='OCEAN'?[.20,.69,.94]:
          role==='PURIFY'?[.94,.85,.61]:role==='CHARM'?[1,.31,.65]:[.88,.38,.75]);
        mesh.position.copyFrom(role==='SWORD'||role==='DEATH'?to:from);
        duration=Math.max(280,Math.min(1100,Number(e.duration)||750));
        if(role==='SWORD'||role==='DEATH'){
          // A visible sweeping pair of blades for EACH authoritative hit.
          // UnitRenderer owns the actual step/position and its articulated pose;
          // these meshes contain no collision or gameplay-side movement.
          bladeRoot=new BABYLON.TransformNode('dancer-blade-arcs-'+e.sequence,this.scene);
          bladeRoot.position.copyFrom(to);
          const step=Number(e.danceStep??e.deathDanceStep??1);
          const pink=this.mat('dancer-blade-pink',[1,.36,.72]);
          const ivory=this.mat('dancer-blade-ivory',[1,.89,.97]);
          for(let k=0;k<2;k++){
            const startAngle=(step%3)*Math.PI*.55+k*.44;
            const points=Array.from({length:13},(_,i)=>{
              const theta=startAngle+(i/12)*Math.PI*1.30;
              const radius=k===0?.98:.75;
              return new BABYLON.Vector3(Math.cos(theta)*radius,
                .36+Math.sin(i/12*Math.PI)*.64+(k*.19),Math.sin(theta)*radius);
            });
            const trail=BABYLON.MeshBuilder.CreateTube('dancer-cut-'+e.sequence+'-'+k,
              {path:points,radius:k===0?.045:.026,tessellation:5,updatable:false},this.scene);
            trail.parent=bladeRoot;trail.material=k===0?pink:ivory;
            trail.isPickable=false;trail.metadata={castShadow:false};
          }
          duration=Math.min(duration,620);
        }
      }
      mesh.isPickable=false;mesh.metadata={castShadow:false};
      this.active.push({mesh,from,to,start:now,duration,role,bladeRoot});
    }
  }
  updateFrame(now=performance.now()){
    for(const fx of [...this.active]){
      const t=Math.min(1,Math.max(0,(now-fx.start)/fx.duration));
      if(fx.role==='CHARM'){
        fx.mesh.position.copyFrom(BABYLON.Vector3.Lerp(fx.from,fx.to,t));
        fx.mesh.position.y+=Math.sin(t*Math.PI)*.50;
        fx.mesh.scaling.setAll(1+.22*Math.sin(t*Math.PI));
      }else{
        fx.mesh.rotation.x=Math.PI/2;
        fx.mesh.rotation.z+=.03;
        fx.mesh.scaling.setAll(.75+t*.55);
        if(fx.bladeRoot){
          fx.bladeRoot.rotation.y=t*Math.PI*1.45;
          fx.bladeRoot.scaling.setAll(.65+t*.48);
          // Only blade trails fade; they are not gameplay damage indicators.
          for(const part of fx.bladeRoot.getChildMeshes())part.visibility=1-t*.95;
        }
      }
      fx.mesh.visibility=1-t*.9;
      if(t>=1){fx.mesh.dispose();fx.bladeRoot?.dispose(false,false);
        this.active.splice(this.active.indexOf(fx),1);}
    }
  }
  diagnostics(){return{active:this.active.length};}
  dispose(){for(const fx of this.active){fx.mesh.dispose();fx.bladeRoot?.dispose(false,false);}this.active=[];
    for(const material of Object.values(this.materials))material.dispose();this.heartTexture?.dispose();
    this.materials={};this.recent.clear();}
}

const factories=Object.freeze({
  'dance-magic':scene=>new DanceSongVfx(scene),
  'livia-duality':(scene,ctx)=>new LiviaDualityVfx(scene,{units:ctx.units}),
  'shield-guard':scene=>new ShieldGuardVfx(scene),
  'swordsmanship':scene=>new SwordsmanshipVfx(scene),
  'physical-impact':(scene,ctx)=>new PhysicalImpactVfx(scene,{units:ctx.units}),
  'holy-blade':(scene,ctx)=>new HolyBladeVfx(scene,{units:ctx.units}),
  'holy-volley':(scene,ctx)=>new HolyVolleyVfx(scene,{units:ctx.units}),
  'projectile':(scene,ctx)=>new ArrowProjectileVfx(scene,{units:ctx.units}),
  'fire-impact':(scene,ctx)=>new FireBowExplosionVfx(scene,{projectiles:ctx.get('projectile')}),
  'dimensional':scene=>new DimensionalRiftVfx(scene),
  'arcane':scene=>new ArcaneSigilVfx(scene),
  'shadow-elemental':(scene,ctx)=>new ShadowElementalVfx(scene,{units:ctx.units}),
  'nature-growth':scene=>new NatureGrowthVfx(scene),
  'blood-ritual':scene=>new BloodRitualVfx(scene),
  'holy-ritual':scene=>new HolyRitualVfx(scene),
  'aquatic-magic':scene=>new AquaticMagicVfx(scene),
  'blade-stealth':scene=>new BladeStealthVfx(scene),
  'wild-magic':(scene,ctx)=>new WildMagicVfx(scene,{units:ctx.units})
});

export function vfxRoutesForEvent(event){
  if(!event||typeof event!=='object')return [];
  if(event.type==='UNIT_ANIMATION'){
    const routes=VfxDatabase.routeSkill(event.skillId);
    if(isBowProjectileEvent(event))routes.push('projectile');
    return [...new Set(routes)];
  }
  return VfxDatabase.modules().filter(module=>VfxDatabase.hasEvent(module,event.type));
}

export class VfxManager{
  constructor(scene,{units=null}={}){
    if(!scene)throw Error('VFX_SCENE_REQUIRED');
    this.scene=scene;
    this.units=units;
    this.instances=new Map();
    this.seen=new Map();
    this.errors=new Map();
    this.mapId=null;this.round=null;this.disposed=false;
    const ctx={units,get:key=>this.instances.get(key)};
    for(const module of VfxDatabase.modules()){
      const factory=factories[module];
      if(!factory)throw Error(`VFX_UNREGISTERED_BEHAVIOR:${module}`);
      this.instances.set(module,factory(scene,ctx));
      this.seen.set(module,new Set());
    }
    liveManagers.set(scene,this);
    // Every behavior already registered its own scene-disposal hook above.
    // Release central references AFTER those hooks without disposing twice.
    scene.onDisposeObservable?.addOnce?.(()=>{
      this.disposed=true;
      if(liveManagers.get(scene)===this)liveManagers.delete(scene);
      this.instances.clear();this.seen.clear();this.errors.clear();
    });
  }
  /** Existing modules are still updated on empty-event revisions: auras
   * must disappear on an official dispel, cleanse, death or map change. */
  sync(snapshot,events=[]){
    if(this.disposed)return;
    const mapId=snapshot?.map?.id??null,round=Number(snapshot?.round||0);
    if(this.mapId!==null&&(this.mapId!==mapId||round<this.round))
      for(const seen of this.seen.values())seen.clear();
    this.mapId=mapId;this.round=round;
    const groups=new Map([...this.instances].map(([key])=>[key,[]]));
    const pendingKeys=new Map([...this.instances].map(([key])=>[key,new Set()]));
    const revision=snapshot?.presentation?.battleEventRevision??snapshot?.revision??round;
    for(const event of Array.isArray(events)?events:[]){
      for(const module of vfxRoutesForEvent(event)){
        if(!groups.has(module))continue;
        const keys=this.seen.get(module);
        const key=Number.isSafeInteger(event.sequence)
          ?`${mapId}:${revision}:${event.type}:${event.sequence}:${event.unitId??''}:${event.skillId??''}`:null;
        if(key&&(keys.has(key)||pendingKeys.get(module).has(key)))continue;
        if(key)pendingKeys.get(module).add(key);
        groups.get(module).push({event,key});
      }
    }
    const druidActions=(Array.isArray(events)?events:[]).filter(event=>
      event?.type==='UNIT_ANIMATION'&&String(event.skillId||'').startsWith('avreshi_'));
    if(druidActions.length)for(const action of druidActions){
      globalThis.CardTacticsDiagnostics?.push?.('AVRESHI_VFX_DISPATCH',{
        skillId:action.skillId,sequence:action.sequence,unitId:action.unitId,
        targetX:action.targetX,targetY:action.targetY,
        routes:vfxRoutesForEvent(action),visualBuild:'20261118-avreshi-vfx-2'
      });
    }
    const failures=[];
    for(const [module,handler] of this.instances){
      const pending=groups.get(module);
      try{
        handler.sync(snapshot,pending.map(item=>item.event));
        this.errors.delete(module);
        const keys=this.seen.get(module);
        for(const {key} of pending)if(key)keys.add(key);
        while(keys.size>512)keys.delete(keys.values().next().value);
      }catch(error){
        const msg=String(error?.message||error);
        this.errors.set(module,msg);failures.push(`${module}:${msg}`);
      }
    }
    // Preserve renderer's existing incomplete-subsystem retry contract.
    if(failures.length)throw Error(`VFX_SYNC_FAILED:${failures.join('|')}`);
  }
  updateFrame(now=performance.now()){
    if(this.disposed)return;
    for(const [module,handler] of this.instances){
      try{handler.updateFrame(now)}
      catch(error){this.errors.set(module,`FRAME:${String(error?.message||error)}`)}
    }
    // UnitRenderer.updateFrame ran immediately before this manager. One shared
    // late pose pass keeps ALL body-bound effects with that rendered frame.
    try{
      attachAurasToRenderedUnits(this.instances,this.units);
      this.errors.delete('body-attachment');
    }catch(error){
      this.errors.set('body-attachment',String(error?.message||error));
    }
  }
  visualPending(action){return actionVisualsPending(this.units,this.instances,action)}
  diagnostics(){
    return{
      visualBuild:'20261118-avreshi-vfx-2',
      instances:this.instances.size,
      active:Object.fromEntries([...this.instances].map(([key,handler])=>[key,handler.diagnostics?.()||{}])),
      errors:Object.fromEntries(this.errors),
      receiptCache:Object.fromEntries([...this.seen].map(([key,cache])=>[key,cache.size]))
    };
  }
  /** Backward-compatible diagnostics readout for existing diagnostic clients. */
  legacyDiagnostics(){
    const names=VfxDatabase.legacyDiagnostics();
    return Object.fromEntries([...this.instances].map(([key,handler])=>
      [names[key],handler.diagnostics?.()||{}]));
  }
  get(module){return this.instances.get(module)||null}
  dispose(){
    if(this.disposed)return;
    this.disposed=true;
    if(liveManagers.get(this.scene)===this)liveManagers.delete(this.scene);
    for(const handler of this.instances.values())handler.dispose?.();
    this.instances.clear();this.seen.clear();this.errors.clear();
  }
}

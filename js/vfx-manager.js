/**
 * The ONE Babylon presentation VFX owner. The battle renderer neither imports
 * heroes nor enumerates spell modules. Rules remain in SkillDatabase /
 * EffectEngine / BattleResolution; this manager only dispatches official events
 * and committed, viewer-filtered presentation snapshots.
 *
 * Adding a skill that reuses an effect role: edit vfx-database.js only.
 * Adding a genuinely new geometry type: register one new behavior factory here.
 */
import {VfxDatabase} from './vfx-database.js';
import {isBowProjectileEvent,ArrowProjectileVfx} from './arrow-projectile-vfx.js';
import {FireBowExplosionVfx} from './fire-bow-explosion-vfx.js';
import {HolyBladeVfx} from './holy-blade-vfx.js';
import {HolyVolleyVfx} from './holy-volley-vfx.js';
import {DimensionalRiftVfx} from './dimensional-rift-vfx.js';
import {ArcaneSigilVfx} from './arcane-sigil-vfx.js';
import {ShadowElementalVfx} from './shadow-elemental-vfx.js';
import {NatureGrowthVfx} from './nature-growth-vfx.js';
import {BloodRitualVfx} from './blood-ritual-vfx.js';
import {HolyRitualVfx} from './holy-ritual-vfx.js';
import {AquaticMagicVfx} from './aquatic-magic-vfx.js';
import {BladeStealthVfx} from './blade-stealth-vfx.js';
import {SwordsmanshipVfx} from './swordsmanship-vfx.js';

const factories=Object.freeze({
  'swordsmanship':scene=>new SwordsmanshipVfx(scene),
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
  'blade-stealth':scene=>new BladeStealthVfx(scene)
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
    // Every behavior already registered its own scene-disposal hook above.
    // Release central references AFTER those hooks without disposing twice.
    scene.onDisposeObservable?.addOnce?.(()=>{
      this.disposed=true;
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
  }
  diagnostics(){
    return{
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
    for(const handler of this.instances.values())handler.dispose?.();
    this.instances.clear();this.seen.clear();this.errors.clear();
  }
}

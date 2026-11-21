/**
 * The ONE Babylon presentation VFX owner. The battle renderer neither imports
 * heroes nor enumerates spell modules. Rules remain in SkillDatabase /
 * EffectEngine / BattleResolution; this manager only dispatches official events
 * and committed, viewer-filtered presentation snapshots.
 *
 * Adding a skill that reuses an effect role: edit vfx-database.js only.
 * Adding a genuinely new geometry type: register one new behavior factory here.
 */
import {VfxDatabase} from './vfx-database.js?rev=20261121-alchemy-vfx-1';
import {isBowProjectileEvent,ArrowProjectileVfx} from './arrow-projectile-vfx.js';
import {FireBowExplosionVfx} from './fire-bow-explosion-vfx.js';
import {HolyBladeVfx} from './holy-blade-vfx.js';
import {HolyVolleyVfx} from './holy-volley-vfx.js';
import {DimensionalRiftVfx} from './dimensional-rift-vfx.js';
import {ArcaneSigilVfx} from './arcane-sigil-vfx.js?rev=20261121-alchemy-vfx-1';
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

const factories=Object.freeze({
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

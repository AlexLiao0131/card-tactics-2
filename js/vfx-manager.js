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
  constructor(scene,{units=null}={}){
    this.scene=scene;this.units=units;
    this.active=[];this.pending=new Map();this.bladePool=[];
    this.recent=new Set();this.materials={};this.heartTexture=null;
    this.disposed=false;
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
    if(this.disposed)return;
    for(const e of events){
      if(e?.type!=='UNIT_ANIMATION'||!Number.isFinite(e.x)||!Number.isFinite(e.y))continue;
      const role=VfxDatabase.roleFor('dance-magic',e.skillId);
      if(!role||this.recent.has(e.sequence))continue;
      this.recent.add(e.sequence);
      if(this.recent.size>512)this.recent.delete(this.recent.values().next().value);
      const from=this.pos(snapshot,e.x,e.y,1.1);
      const tx=Number.isFinite(e.targetX)?e.targetX:e.x,ty=Number.isFinite(e.targetY)?e.targetY:e.y;
      const to=this.pos(snapshot,tx,ty,1.15);
      if(this.units&&(role==='SWORD'||role==='DEATH')){
        // Resolution commits all hits at once; the visible animator plays them
        // one by one. Only their immutable event/positions are retained.
        this.pending.set(e.sequence,{event:e,role,from,to});
      }else this.spawn(e,role,from,to);
    }
  }
  spawn(e,role,from,to){
    const sword=role==='SWORD'||role==='DEATH';
    let mesh,bladeRoot=null,trails=null,duration=850,baseAngle=0;
    if(role==='CHARM'&&Number.isFinite(e.targetX)&&Number.isFinite(e.targetY)){
      mesh=BABYLON.MeshBuilder.CreatePlane('dancer-charm-heart',{size:.85},this.scene);
      mesh.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;
      mesh.material=this.heartMaterial();mesh.position.copyFrom(from);duration=780;
    }else{
      // Recycle the exact same GPU buffers across consecutive sword contacts.
      // A triple contact has at most three reusable blade sets; no growth per
      // dance cast and no stale mesh still alive after the scene is disposed.
      const reused=sword?this.bladePool.pop():null;
      if(reused){
        mesh=reused.mesh;bladeRoot=reused.bladeRoot;trails=reused.trails;
        mesh.setEnabled(true);bladeRoot.setEnabled(true);
      }else{
        mesh=BABYLON.MeshBuilder.CreateTorus('dance-'+role,{diameter:role==='INSPIRE'||role==='PURIFY'?
          (Math.max(1,Number(e.danceRadius||1))*2+.3)*TILE_SIZE:1.18,
          thickness:role==='INSPIRE'||role==='PURIFY'?.065:.10,tessellation:32},this.scene);
      }
      mesh.material=this.mat(role,role==='HYMN'?[1,.90,.45]:role==='OCEAN'?[.20,.69,.94]:
        role==='PURIFY'?[.94,.85,.61]:role==='CHARM'?[1,.31,.65]:[.88,.38,.75]);
      mesh.position.copyFrom(sword?to:from);
      duration=Math.max(280,Math.min(1100,Number(e.duration)||750));
      if(sword){
        const step=Number(e.danceStep??e.deathDanceStep??1);
        baseAngle=(step%3)*Math.PI*.55;
        if(!bladeRoot){
          bladeRoot=new BABYLON.TransformNode('dancer-blade-arcs',this.scene);
          trails=[];
          const pink=this.mat('dancer-blade-pink',[1,.36,.72]);
          const ivory=this.mat('dancer-blade-ivory',[1,.89,.97]);
          for(let k=0;k<2;k++){
            const points=Array.from({length:13},(_,i)=>{
              const theta=k*.44+(i/12)*Math.PI*1.30;
              const radius=k===0?.98:.75;
              return new BABYLON.Vector3(Math.cos(theta)*radius,
                .36+Math.sin(i/12*Math.PI)*.64+(k*.19),Math.sin(theta)*radius);
            });
            const trail=BABYLON.MeshBuilder.CreateTube('dancer-cut-'+k,
              {path:points,radius:k===0?.045:.026,tessellation:5,updatable:false},this.scene);
            trail.parent=bladeRoot;trail.material=k===0?pink:ivory;
            trail.isPickable=false;trail.metadata={castShadow:false};
            trails.push(trail);
          }
        }
        bladeRoot.position.copyFrom(to);
        bladeRoot.rotation.y=baseAngle;bladeRoot.scaling.setAll(1);
        for(const trail of trails)trail.visibility=1;
        duration=Math.min(duration,620);
      }
    }
    mesh.visibility=1;mesh.scaling.setAll(1);mesh.rotation.z=0;
    mesh.isPickable=false;mesh.metadata={castShadow:false};
    this.active.push({mesh,from,to,start:performance.now(),duration,role,
      bladeRoot,trails,baseAngle,event:e});
  }
  updateFrame(now=performance.now()){
    if(this.disposed)return;
    if(this.pending.size){
      const animations=this.units?.activeAnimations,queues=this.units?.animationQueues;
      for(const [seq,pending] of this.pending){
        const id=String(pending.event.unitId);
        const same=e=>e?.sequence===seq&&String(e.unitId)===id;
        const active=Array.from(animations?.values?.()||[]).some(a=>same(a.event));
        const queued=Array.from(queues?.values?.()||[]).some(q=>q.some(same));
        if(active){
          this.spawn(pending.event,pending.role,pending.from,pending.to);
          this.pending.delete(seq);
        }else if(!queued){
          // Hidden, dead, or cancelled actions never allocate scene geometry.
          this.pending.delete(seq);
        }
      }
    }
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
          fx.bladeRoot.rotation.y=fx.baseAngle+t*Math.PI*1.45;
          fx.bladeRoot.scaling.setAll(.65+t*.48);
          for(const part of fx.trails)part.visibility=1-t*.95;
        }
      }
      fx.mesh.visibility=1-t*.9;
      if(t>=1){
        this.active.splice(this.active.indexOf(fx),1);
        if(fx.bladeRoot&&this.bladePool.length<3){
          fx.mesh.setEnabled(false);fx.bladeRoot.setEnabled(false);
          this.bladePool.push({mesh:fx.mesh,bladeRoot:fx.bladeRoot,trails:fx.trails});
        }else{
          fx.mesh.dispose();fx.bladeRoot?.dispose(false,false);
        }
      }
    }
  }
  diagnostics(){return{active:this.active.length,pending:this.pending.size,pooled:this.bladePool.length};}
  dispose(){
    if(this.disposed)return;this.disposed=true;
    this.pending.clear();
    for(const fx of this.active){fx.mesh.dispose();fx.bladeRoot?.dispose(false,false);}
    for(const fx of this.bladePool){fx.mesh.dispose();fx.bladeRoot.dispose(false,false);}
    this.active=[];this.bladePool=[];
    for(const material of Object.values(this.materials))material.dispose();
    this.heartTexture?.dispose();this.materials={};this.recent.clear();
  }
}

/**
 * Water-lurker: one viewer-filtered unit, one articulated Babylon surface model.
 * It follows official water-surface tiles; there are NO hydrology writes, fake
 * units, separate frame timers, or rebuilds of WaterRenderer's shared geometry.
 */
class WaterLurkerSurfaceModel{
  constructor(scene){
    this.scene=scene;this.entries=new Map();this.materials=[];
    this.initialized=false;
    scene.onDisposeObservable?.addOnce?.(()=>this.dispose());
  }
  ensureMaterials(){
    if(this.initialized)return;
    this.initialized=true;
    const scene=this.scene;
    const tint=(name,base,glow=null,alpha=1)=>{
      const m=new BABYLON.StandardMaterial('neutral-lurker-'+name,scene);
      m.diffuseColor=new BABYLON.Color3(...base);
      m.specularColor=new BABYLON.Color3(.26,.35,.38);
      if(glow)m.emissiveColor=new BABYLON.Color3(...glow);
      m.alpha=alpha;m.backFaceCulling=false;this.materials.push(m);return m;
    };
    this.skin=tint('skin',[.19,.18,.30],[.028,.021,.050]);
    // Slightly brighter mantle makes the surfaced head readable in night/fog
    // without altering the established dark-purple tentacle materials.
    this.mantleSkin=tint('mantle',[.29,.25,.41],[.075,.055,.088]);
    this.underside=tint('underside',[.39,.27,.43],[.045,.025,.052]);
    this.sucker=tint('suckers',[.63,.43,.57]);
    this.eye=tint('eye',[.88,.69,.29],[.62,.33,.07]);
    this.ripple=tint('ripple',[.23,.60,.73],[.16,.45,.60],.43);
    this.foam=tint('foam',[.73,.93,.92],[.31,.45,.48],.55);
  }
  part(parent,name,shape,options,material,unitId,{pick=true}={}){
    const mesh=BABYLON.MeshBuilder[shape](name,options,this.scene);
    mesh.parent=parent;mesh.material=material;
    mesh.isPickable=pick;
    mesh.metadata={kind:'unit',unitId,castShadow:false,waterLurker:true};
    mesh.receiveShadows=false;
    return mesh;
  }
  build(unit){
    this.ensureMaterials();
    const id=String(unit.id),root=new BABYLON.TransformNode('neutral-water-lurker-'+id,this.scene);
    root.metadata={kind:'unit',unitId:id,waterLurker:true};
    // The old mantle was entirely below the water surface (-.72 tiles) and
    // could never be seen. A body rig now rises into a readable OCTOPUS head:
    // surface = upper half visible; dive = head and face genuinely submerged.
    const headRig=new BABYLON.TransformNode('lurker-head-rig-'+id,this.scene);
    headRig.parent=root;
    const head=this.part(headRig,'lurker-raised-mantle-'+id,'CreateSphere',
      {diameter:1,segments:24},this.mantleSkin,id);
    head.scaling.set(TILE_SIZE*1.52,1.25*TILE_SIZE,TILE_SIZE*1.38);
    head.position.y=-.17*TILE_SIZE;
    const face=this.part(headRig,'lurker-face-'+id,'CreateSphere',
      {diameter:1,segments:18},this.underside,id);
    face.scaling.set(TILE_SIZE*.95,TILE_SIZE*.62,TILE_SIZE*.86);
    face.position.set(0,-.30*TILE_SIZE,.37*TILE_SIZE);
    const brow=this.part(headRig,'lurker-brow-'+id,'CreateSphere',
      {diameter:1,segments:14},this.skin,id,{pick:false});
    brow.scaling.set(.91*TILE_SIZE,.19*TILE_SIZE,.28*TILE_SIZE);
    brow.position.set(0,.08*TILE_SIZE,.55*TILE_SIZE);
    const beak=this.part(headRig,'lurker-beak-'+id,'CreateSphere',
      {diameter:1,segments:12},this.skin,id,{pick:false});
    beak.scaling.set(.23*TILE_SIZE,.29*TILE_SIZE,.22*TILE_SIZE);
    beak.position.set(0,-.51*TILE_SIZE,.78*TILE_SIZE);
    const base=this.part(root,'lurker-underbody-'+id,'CreateSphere',
      {diameter:1,segments:18},this.underside,id);
    base.scaling.set(TILE_SIZE*1.48,.58*TILE_SIZE,TILE_SIZE*1.39);
    base.position.y=-.77*TILE_SIZE;
    const siphons=[];
    for(const side of [-1,1]){
      const siphon=this.part(headRig,'lurker-siphon-'+id+'-'+side,'CreateCylinder',
        {height:TILE_SIZE*.35,diameterTop:TILE_SIZE*.12,diameterBottom:TILE_SIZE*.23,tessellation:12},
        this.underside,id,{pick:false});
      siphon.position.set(side*.56*TILE_SIZE,-.40*TILE_SIZE,.15*TILE_SIZE);
      siphon.rotation.z=side*.50;siphons.push(siphon);
    }
    const arms=[];
    const number=5;
    for(let n=0;n<number;n++){
      const angle=n*Math.PI*2/number+.36;
      const joint=new BABYLON.TransformNode('lurker-arm-pivot-'+id+'-'+n,this.scene);
      joint.parent=root;
      const spread=n%2===0?.72:.93;
      joint.position.set(Math.cos(angle)*spread*TILE_SIZE,-.24*TILE_SIZE,
        Math.sin(angle)*spread*TILE_SIZE);
      joint.rotation.y=angle;
      const pivots=[];let parent=joint;
      for(let j=0;j<5;j++){
        const length=TILE_SIZE*(j===0?.38:j===1?.35:j===2?.30:.25);
        const width=TILE_SIZE*(.18-j*.027);
        const pivot=new BABYLON.TransformNode('lurker-joint-'+id+'-'+n+'-'+j,this.scene);
        pivot.parent=parent;
        if(j>0)pivot.position.y=TILE_SIZE*(j===1?.38:j===2?.35:j===3?.30:.25);
        const segment=this.part(pivot,'lurker-tentacle-'+id+'-'+n+'-'+j,'CreateCylinder',
          {height:length,diameterTop:width*.72,diameterBottom:width,tessellation:9},this.skin,id);
        segment.position.y=length/2;
        if(j<4){
          const pad=this.part(pivot,'lurker-sucker-'+id+'-'+n+'-'+j,'CreateSphere',
            {diameter:1,segments:7},this.sucker,id,{pick:false});
          pad.scaling.set(width*.62,length*.25,width*.29);
          pad.position.set(0,length*.57,width*.40);
        }
        pivots.push(pivot);parent=pivot;
      }
      const ring=this.part(root,'lurker-water-ring-'+id+'-'+n,'CreateTorus',
        {diameter:TILE_SIZE*.76,thickness:.025*TILE_SIZE,tessellation:24},this.ripple,id,{pick:false});
      ring.rotation.x=Math.PI/2;
      ring.position.set(joint.position.x,.018,joint.position.z);
      const spray=this.part(root,'lurker-foam-'+id+'-'+n,'CreateTorus',
        {diameter:TILE_SIZE*.43,thickness:.020*TILE_SIZE,tessellation:20},this.foam,id,{pick:false});
      spray.rotation.x=Math.PI/2;
      spray.position.set(joint.position.x,.028,joint.position.z);
      arms.push({joint,pivots,ring,spray,n});
    }
    const eyes=[];
    for(const side of [-1,1]){
      const socket=this.part(headRig,'lurker-eye-socket-'+id+'-'+side,'CreateSphere',
        {diameter:.31*TILE_SIZE,segments:14},this.skin,id,{pick:false});
      socket.scaling.set(.85,1,.70);
      socket.position.set(side*.29*TILE_SIZE,.01*TILE_SIZE,.66*TILE_SIZE);
      const e=this.part(headRig,'lurker-glowing-eye-'+id+'-'+side,'CreateSphere',
        {diameter:.19*TILE_SIZE,segments:14},this.eye,id);
      e.position.set(side*.29*TILE_SIZE,.04*TILE_SIZE,.79*TILE_SIZE);
      const pupil=this.part(headRig,'lurker-pupil-'+id+'-'+side,'CreateSphere',
        {diameter:.068*TILE_SIZE,segments:8},this.skin,id,{pick:false});
      pupil.position.set(side*.29*TILE_SIZE,.04*TILE_SIZE,.885*TILE_SIZE);
      eyes.push(e);
    }
    return{root,arms,head,headRig,face,base,eyes,id,unitId:id,
      phase:arms.map((_,i)=>i*1.43),state:'IDLE',diveBlend:0,targetDive:0,
      lastPoseTime:null,nodes:[root]};
  }
  surfaceY(snapshot,unit){
    const tiles=snapshot?.map?.tiles||[];
    const width=Math.max(1,Number(unit?.footprint?.width||2));
    const height=Math.max(1,Number(unit?.footprint?.height||2));
    const samples=[];
    for(let dy=0;dy<height;dy++)for(let dx=0;dx<width;dx++){
      const tile=tiles.find(t=>t.x===unit.x+dx&&t.y===unit.y+dy);
      const y=Number(tile?.waterSurfaceZ);
      if(tile&&Number.isFinite(y))samples.push(y);
    }
    const surface=samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:
      Number(unit.verticalSurfaceZ??unit.z??0);
    return surface*ELEVATION_HEIGHT;
  }
  sync(snapshot,events=[]){
    const active=new Set();
    const mapId=snapshot?.map?.id??null;
    if(this.mapId!==null&&mapId!==this.mapId)this.clear();
    this.mapId=mapId;
    for(const unit of snapshot?.units||[]){
      if(unit?.monsterId!=='water_lurker'&&unit?.visualId!=='water_lurker_default')continue;
      if(unit.alive===false)continue;
      const id=String(unit.id);active.add(id);
      let fx=this.entries.get(id);
      if(!fx){fx=this.build(unit);this.entries.set(id,fx)}
      const width=Math.max(1,Number(unit.footprint?.width||2));
      const height=Math.max(1,Number(unit.footprint?.height||2));
      fx.root.position.set((Number(unit.x)+(width-1)/2)*TILE_SIZE,
        this.surfaceY(snapshot,unit),(Number(unit.y)+(height-1)/2)*TILE_SIZE);
      fx.root.setEnabled(true);
      fx.state=String(unit.acted?'IDLE':unit.moved?'SWIM':'IDLE');
      // Only authoritative vertical state controls emergence. Never infer
      // diving from a VFX timer, animation name, or player's camera angle.
      fx.verticalMode=String(unit.verticalMode||unit.verticalState?.mode||'SWIMMING').toUpperCase();
      fx.targetDive=fx.verticalMode==='DIVING'?1:0;
      fx.lastUnit=unit;
    }
    for(const [id,fx] of this.entries)if(!active.has(id)){
      fx.root.dispose(false,false);this.entries.delete(id);
    }
    for(const event of events||[]){
      if(event?.type!=='UNIT_ANIMATION')continue;
      const fx=this.entries.get(String(event.unitId));if(!fx)continue;
      if(event.state==='ATTACK')fx.lastAttackTime=performance.now();
      if(event.state==='HURT')fx.lastHurtTime=performance.now();
    }
  }
  updateFrame(now=performance.now()){
    for(const fx of this.entries.values()){
      const attack=fx.lastAttackTime!=null?Math.max(0,1-(now-fx.lastAttackTime)/820):0;
      const recoil=fx.lastHurtTime!=null?Math.max(0,1-(now-fx.lastHurtTime)/360):0;
      const elapsed=fx.lastPoseTime==null?0:Math.max(0,Math.min(120,now-fx.lastPoseTime));
      fx.lastPoseTime=now;
      // First frame shows the actual state; subsequent transitions are smooth.
      if(elapsed===0)fx.diveBlend=fx.targetDive;
      else fx.diveBlend+=(fx.targetDive-fx.diveBlend)*Math.min(1,elapsed/330);
      const submerged=fx.diveBlend;
      const motion=Math.sin(now*.0011)*.045-recoil*.11;
      // At the surface the crown breaches the waterline and the full face is
      // visible. DIVING moves the entire head beneath the same waterline.
      fx.headRig.position.y=(-.035-1.53*submerged)*TILE_SIZE+motion;
      fx.head.rotation.z=Math.sin(now*.00053)*.018;
      fx.base.position.y=(-.77-.25*submerged)*TILE_SIZE+motion*.35;
      for(const arm of fx.arms){
        const phase=now*.00155+fx.phase[arm.n],active=attack&&arm.n===Math.floor(fx.arms.length/2);
        // The tips may remain visible when diving, while their roots retract.
        arm.joint.position.y=(-.24-.68*submerged)*TILE_SIZE;
        arm.joint.rotation.z=Math.sin(phase)*.14+(active?-.70*Math.sin(attack*Math.PI):0);
        arm.joint.rotation.x=Math.cos(phase*.8)*.11;
        for(let i=0;i<arm.pivots.length;i++){
          const p=arm.pivots[i];
          p.rotation.z=Math.sin(phase-i*.46)*(.12+i*.048)+
            (active?.36*Math.sin((1-attack)*Math.PI*2):0);
          p.rotation.x=Math.cos(phase*.81+i*.62)*.12;
        }
        arm.ring.scaling.setAll(1+.12*Math.sin(phase));
        arm.spray.scaling.setAll(1+.06*Math.cos(phase));
      }
    }
  }
  clear(){for(const fx of this.entries.values())fx.root.dispose(false,false);this.entries.clear()}
  dispose(){this.clear();for(const m of this.materials)m.dispose();this.materials=[]}
  diagnostics(){return{visible:this.entries.size,meshes:[...this.entries.values()].reduce((n,fx)=>n+fx.root.getChildMeshes().length,0)}}
}

const factories=Object.freeze({
  'dance-magic':(scene,ctx)=>new DanceSongVfx(scene,{units:ctx.units}),
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
    this.waterLurker=new WaterLurkerSurfaceModel(scene);
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
    // Water lurker only sees the same viewer-filtered snapshot as other Babylon
    // effects. Unobserved monsters never create world meshes or reveal intel.
    try{this.waterLurker.sync(snapshot,events)}catch(error){
      const msg=String(error?.message||error);
      this.errors.set('water-lurker',msg);failures.push(`water-lurker:${msg}`);
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
    try{this.waterLurker.updateFrame(now)}catch(error){
      this.errors.set('water-lurker',`FRAME:${String(error?.message||error)}`);
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
      waterLurker:this.waterLurker.diagnostics(),
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
    this.waterLurker.dispose();
    for(const handler of this.instances.values())handler.dispose?.();
    this.instances.clear();this.seen.clear();this.errors.clear();
  }
}

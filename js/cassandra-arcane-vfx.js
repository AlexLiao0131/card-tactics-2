/**
 * Cassandra's shared Babylon-only spell presentation.
 *
 * Every cast begins from an authoritative UNIT_ANIMATION presentation event.
 * Buff removal, HP damage, MP loss, analysis duration and PvP visibility remain
 * exclusively owned by the game's existing combat/state engines. A visible
 * analysis glyph follows the effect carried by the published unit snapshot.
 *
 * Uses BabylonRenderer's existing scene, snapshot commit and frame clock;
 * no extra timers, lights, textures, colliders or gameplay-side mutations.
 */
import {TILE_SIZE,ELEVATION_HEIGHT} from './coordinate-system.js';

const SPELLS=Object.freeze({
  cassandra_magic_bolt:'ANALYZE',
  cassandra_fire_burst:'MANA_BURN',
  cassandra_frost:'DISPEL',
  cassandra_dissolve:'DISSOLVE'
});
const ANALYSIS_ID='CASSANDRA_ANALYSIS';
const DURATION=Object.freeze({ANALYZE:1060,MANA_BURN:1160,DISPEL:1050,DISSOLVE:1390});
const MAX_ACTIVE=4;
const PI=Math.PI,TAU=2*PI;
const clamp=x=>Math.max(0,Math.min(1,Number(x)||0));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t)};
const mix=(a,b,t)=>a+(b-a)*t;
const vec=(x,y,z)=>new BABYLON.Vector3(x,y,z);

export function isCassandraSpellPresentationEvent(event){
  return !!event&&event.type==='UNIT_ANIMATION'&&
    Object.prototype.hasOwnProperty.call(SPELLS,event.skillId)&&
    Number.isFinite(event.targetX)&&Number.isFinite(event.targetY)&&
    Number.isFinite(event.x)&&Number.isFinite(event.y)&&
    event.unitId!=null;
}

export class CassandraArcaneVfx{
  constructor(scene){
    this.scene=scene;
    this.active=[];
    this.analysisGlyphs=new Map();
    this.recent=new Set();
    this.mapId=null;this.round=null;this.hasTimeline=false;
    this.materials={
      ink:this.material('cassandra-ink',[.11,.035,.28],.86),
      violet:this.material('cassandra-violet',[.56,.20,.94],.90),
      bright:this.material('cassandra-bright',[.88,.65,1],.95),
      cyan:this.material('cassandra-mana-flame',[.16,.61,1],.93),
      gold:this.material('cassandra-ward-fracture',[1,.72,.32],.87)
    };
    scene.onDisposeObservable?.addOnce?.(()=>this.dispose());
  }
  material(name,color,alpha){
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=new BABYLON.Color3(...color);
    material.emissiveColor=new BABYLON.Color3(...color);
    material.alpha=alpha;
    material.disableLighting=true;
    material.backFaceCulling=false;
    if(BABYLON.Engine?.ALPHA_ADD!==undefined)
      material.alphaMode=BABYLON.Engine.ALPHA_ADD;
    return material;
  }
  mesh(root,name,kind,args,material='violet'){
    const mesh=BABYLON.MeshBuilder[kind](name,args,this.scene);
    mesh.parent=root;
    mesh.material=this.materials[material];
    mesh.isPickable=false;mesh.receiveShadows=false;
    mesh.metadata={castShadow:false};
    return mesh;
  }
  rune(root,name,diameter=1,material='violet',sides=8){
    return this.mesh(root,name,'CreateTorus',{
      diameter,thickness:.045,tessellation:sides
    },material);
  }
  sphere(root,name,diameter,material='bright'){
    return this.mesh(root,name,'CreateSphere',{diameter,segments:8},material);
  }
  shard(root,name,index,count,radius,material='violet',height=.28){
    const mesh=this.mesh(root,name,'CreateBox',{
      width:.12,height,depth:.085
    },material);
    const angle=TAU*index/count;
    mesh.position.set(Math.cos(angle)*radius,Math.sin(angle*2)*.10,Math.sin(angle)*radius);
    mesh.rotation.set(.3,angle,.55+angle);
    return mesh;
  }
  height(snapshot,x,y){
    const unit=(snapshot?.units||[]).find(u=>u.alive!==false&&u.x===x&&u.y===y);
    if(unit){
      const z=unit.renderZ??unit.z;
      if(z!=null&&Number.isFinite(Number(z)))return Number(z)*ELEVATION_HEIGHT;
    }
    const tile=(snapshot?.map?.tiles||[]).find(t=>t.x===x&&t.y===y);
    return Number(tile?.elevation??0)*ELEVATION_HEIGHT;
  }
  position(snapshot,x,y,above){
    return vec(x*TILE_SIZE,this.height(snapshot,x,y)+above,y*TILE_SIZE);
  }
  spawn(event,snapshot,now){
    const kind=SPELLS[event.skillId];
    const source=this.position(snapshot,event.x,event.y,1.18);
    const target=this.position(snapshot,event.targetX,event.targetY,.80);
    const root=new BABYLON.TransformNode(`cassandra-${kind}-caster`,this.scene);
    const impact=new BABYLON.TransformNode(`cassandra-${kind}-target`,this.scene);
    root.position.copyFrom(source);impact.position.copyFrom(target);
    const effect={kind,root,impact,source,target,start:now,duration:DURATION[kind],
      sourceSigil:null,targetSigils:[],shards:[],orb:null,trails:[],
      flames:[],shock:null,beamRoot:null,beam:null};
    effect.sourceSigil=this.rune(root,'cassandra-caster-runic-ring',.84,'bright',8);
    effect.sourceSigil.rotation.x=PI/2;
    if(kind==='ANALYZE'){
      const second=this.rune(root,'cassandra-analysis-hex',.62,'violet',6);
      second.rotation.x=PI/2;effect.casterInner=second;
      effect.orb=this.sphere(root,'cassandra-analysis-dart',.28,'violet');
      effect.orbCore=this.sphere(root,'cassandra-analysis-dart-core',.12,'cyan');
      effect.trails=Array.from({length:3},(_,i)=>this.sphere(root,`cassandra-analysis-trail-${i}`, .15-i*.025,'bright'));
      effect.targetSigils=[this.rune(impact,'cassandra-analysis-lock',.90,'cyan',6)];
      effect.targetSigils[0].rotation.x=PI/2;
    }else if(kind==='MANA_BURN'){
      effect.orb=this.sphere(root,'cassandra-mana-burn-core',.25,'cyan');
      effect.trails=Array.from({length:2},(_,i)=>this.sphere(root,`cassandra-mana-trail-${i}`,.13-i*.03,'violet'));
      effect.targetSigils=[this.rune(impact,'cassandra-mana-brand-a',1.08,'cyan',8),
        this.rune(impact,'cassandra-mana-brand-b',.71,'violet',6)];
      for(const ring of effect.targetSigils)ring.rotation.x=PI/2;
      effect.flames=Array.from({length:7},(_,i)=>{
        const flame=this.mesh(impact,`cassandra-mana-splinter-${i}`,'CreateBox',
          {width:.095,height:.35,depth:.07},i%2?'cyan':'violet');
        const angle=TAU*i/7;
        flame.position.set(Math.cos(angle)*.46,0,Math.sin(angle)*.46);
        flame.rotation.set(.3,angle,angle*.36);
        return flame;
      });
    }else if(kind==='DISPEL'){
      // One ward fractures, not a second damage calculation. The same effect
      // works against a chosen unit buff or a four-cell Holy Wing Wall anchor.
      effect.targetSigils=[this.rune(impact,'cassandra-ward-outer',1.48,'gold',8),
        this.rune(impact,'cassandra-ward-inner',.93,'bright',6),
        this.rune(impact,'cassandra-dispel-cut',.56,'cyan',6)];
      effect.targetSigils[0].rotation.x=PI/2;
      effect.targetSigils[1].rotation.y=PI/2;
      effect.targetSigils[2].rotation.z=PI/2;
      effect.shards=Array.from({length:9},(_,i)=>this.shard(impact,
        `cassandra-shattered-ward-${i}`,i,9,.45,i%3?'gold':'cyan',.47));
    }else if(kind==='DISSOLVE'){
      effect.targetSigils=[this.rune(impact,'cassandra-dissolve-seal-a',1.70,'violet',8),
        this.rune(impact,'cassandra-dissolve-seal-b',1.25,'bright',6),
        this.rune(impact,'cassandra-dissolve-seal-c',.72,'cyan',8)];
      effect.targetSigils[0].rotation.x=PI/2;
      effect.targetSigils[1].rotation.z=PI/2;
      effect.targetSigils[2].rotation.y=PI/2;
      effect.shards=Array.from({length:11},(_,i)=>this.shard(impact,
        `cassandra-dissolve-rune-${i}`,i,11,1.50,i%3?'violet':'cyan',.46));
      effect.orb=this.sphere(impact,'cassandra-dissolve-implosion',.73,'ink');
      effect.shock=this.rune(impact,'cassandra-dissolve-wave',1.35,'bright',20);
      effect.shock.rotation.x=PI/2;
      const beamRoot=new BABYLON.TransformNode('cassandra-dissolve-ray-root',this.scene);
      beamRoot.position.copyFrom(source.add(target).scale(.5));
      beamRoot.lookAt(target);
      const distance=target.subtract(source).length();
      effect.beamRoot=beamRoot;
      effect.beam=this.mesh(beamRoot,'cassandra-dissolve-ray','CreateBox',
        {width:.11,height:.16,depth:Math.max(.10,distance)},'cyan');
      effect.beamRoot.setEnabled(false);
    }
    this.active.push(effect);
    while(this.active.length>MAX_ACTIVE)this.remove(this.active.shift());
  }
  addGlyph(id,unit){
    const root=new BABYLON.TransformNode(`cassandra-analysis-glyph-${id}`,this.scene);
    const outer=this.rune(root,'cassandra-analysis-status-hex',.89,'cyan',6);
    const inner=this.rune(root,'cassandra-analysis-status-core',.47,'bright',8);
    outer.rotation.x=PI/2;inner.rotation.z=PI/2;
    const glyph={root,outer,inner};
    this.analysisGlyphs.set(id,glyph);
    this.moveGlyph(glyph,unit);
    return glyph;
  }
  moveGlyph(glyph,unit){
    const z=unit.renderZ??unit.z??0;
    glyph.root.position.set(Number(unit.x)*TILE_SIZE,
      Number(z)*ELEVATION_HEIGHT+1.58,Number(unit.y)*TILE_SIZE);
  }
  sync(snapshot,events=[]){
    const mapId=snapshot?.map?.id??null;
    const round=Number(snapshot?.round??0);
    if(this.hasTimeline&&(this.mapId!==mapId||round<this.round))this.clear();
    this.mapId=mapId;this.round=round;this.hasTimeline=true;
    const visible=new Set((snapshot?.units||[]).filter(u=>u.alive!==false).map(u=>String(u.id)));
    const now=performance.now();
    for(const event of events||[]){
      if(!isCassandraSpellPresentationEvent(event)||!visible.has(String(event.unitId)))continue;
      const key=Number.isSafeInteger(event.sequence)
        ? `${mapId}:${event.sequence}:${event.unitId}:${event.skillId}`:null;
      if(key&&this.recent.has(key))continue;
      if(key){
        this.recent.add(key);
        if(this.recent.size>128)this.recent.delete(this.recent.values().next().value);
      }
      this.spawn(event,snapshot,now);
    }
    // The authoritative snapshot is the sole source for visible analysis marks.
    // A miss, a cleanse or an expired status never leaves a predicted marker.
    const wanted=new Set();
    for(const unit of snapshot?.units||[]){
      if(unit.alive===false||!Array.isArray(unit.effects)||
         !unit.effects.some(e=>e.id===ANALYSIS_ID))continue;
      const id=String(unit.id);wanted.add(id);
      const glyph=this.analysisGlyphs.get(id)||this.addGlyph(id,unit);
      this.moveGlyph(glyph,unit);
    }
    for(const [id,glyph] of this.analysisGlyphs){
      if(!wanted.has(id)){glyph.root.dispose(false,false);this.analysisGlyphs.delete(id)}
    }
  }
  updateFrame(now=performance.now()){
    for(const glyph of this.analysisGlyphs.values()){
      glyph.outer.rotation.y+=.022;
      glyph.inner.rotation.y-=.034;
      glyph.outer.visibility=.46+.14*Math.sin(now*.006);
      glyph.inner.visibility=.64+.16*Math.sin(now*.008);
    }
    for(let i=this.active.length-1;i>=0;i--){
      const f=this.active[i],elapsed=Math.max(0,now-f.start);
      if(elapsed>=f.duration){this.remove(f);this.active.splice(i,1);continue;}
      const progress=clamp(elapsed/f.duration);
      f.sourceSigil.rotation.y=elapsed*.0032;
      f.sourceSigil.scaling.setAll(.2+.8*smooth(elapsed/290));
      f.sourceSigil.visibility=(1-progress)*.87;
      if(f.kind==='ANALYZE'||f.kind==='MANA_BURN'){
        const travel=smooth((elapsed-170)/520);
        const live=elapsed>=150&&elapsed<740;
        const arc=Math.sin(PI*travel)*.45;
        const x=mix(f.source.x,f.target.x,travel)-f.source.x;
        const y=mix(f.source.y,f.target.y,travel)-f.source.y+arc;
        const z=mix(f.source.z,f.target.z,travel)-f.source.z;
        f.orb.position.set(x,y,z);f.orb.setEnabled(live);
        if(f.orbCore){f.orbCore.position.copyFrom(f.orb.position);f.orbCore.setEnabled(live)}
        f.trails.forEach((trail,index)=>{
          const lag=smooth((elapsed-170-(index+1)*52)/520);
          trail.position.set(mix(f.source.x,f.target.x,lag)-f.source.x,
            mix(f.source.y,f.target.y,lag)-f.source.y+Math.sin(PI*lag)*.45,
            mix(f.source.z,f.target.z,lag)-f.source.z);
          trail.setEnabled(live);
          trail.visibility=(1-progress)*(.64-index*.13);
        });
        f.targetSigils.forEach((ring,index)=>{
          const bloom=smooth((elapsed-670)/290);
          ring.setEnabled(elapsed>=650);
          ring.scaling.setAll(.12+bloom*(index?.95:1.40));
          ring.visibility=(1-bloom)*(index?.85:1);
          ring.rotation.y=elapsed*(index?-.003:.003);
        });
        if(f.casterInner){f.casterInner.rotation.y=-elapsed*.004;
          f.casterInner.visibility=(1-progress)*.78;}
        if(f.flames.length){
          const flamePulse=smooth((elapsed-630)/170),fade=1-smooth((elapsed-920)/220);
          f.flames.forEach((mesh,index)=>{
            const a=TAU*index/f.flames.length;
            const lift=flamePulse*(.30+index%3*.12);
            mesh.position.set(Math.cos(a)*(.30+flamePulse*.35),lift,
              Math.sin(a)*(.30+flamePulse*.35));
            mesh.scaling.y=.35+flamePulse*(.85+(index%3)*.18);
            mesh.visibility=flamePulse*fade;
          });
        }
      }else if(f.kind==='DISPEL'){
        const shatter=smooth((elapsed-290)/450);
        const fade=1-smooth((elapsed-650)/350);
        f.targetSigils.forEach((mesh,index)=>{
          mesh.rotation.y=elapsed*(index%2?.004:-.004);
          mesh.scaling.setAll(.36+.65*smooth(elapsed/290)+shatter*.30);
          mesh.visibility=fade*(1-shatter*.76);
        });
        f.shards.forEach((mesh,index)=>{
          const angle=TAU*index/f.shards.length;
          const radius=.32+shatter*1.45;
          mesh.position.set(Math.cos(angle)*radius,
            Math.sin(angle*2)*.12+shatter*(.25+index%3*.17),
            Math.sin(angle)*radius);
          mesh.rotation.z=angle+elapsed*.004;
          mesh.visibility=shatter*fade;
        });
      }else if(f.kind==='DISSOLVE'){
        const gather=smooth((elapsed-120)/500);
        const explode=smooth((elapsed-660)/470);
        f.targetSigils.forEach((ring,index)=>{
          ring.rotation.y=elapsed*(index%2?.005:-.006);
          ring.scaling.setAll(.18+gather*(index===0?1.22:.88)-explode*.39);
          ring.visibility=(1-smooth((elapsed-1030)/360))*.88;
        });
        f.shards.forEach((mesh,index)=>{
          const angle=TAU*index/f.shards.length+elapsed*.0018;
          const radius=mix(1.65,.22,gather)+explode*1.70;
          mesh.position.set(Math.cos(angle)*radius,Math.sin(angle*2)*(.2+explode*.7),
            Math.sin(angle)*radius);
          mesh.rotation.y=elapsed*.003+angle;
          mesh.visibility=(1-explode)*.85;
        });
        f.orb.scaling.setAll(.30+gather*.78-explode*.69);
        f.orb.visibility=1-smooth((elapsed-890)/340);
        f.beamRoot.setEnabled(elapsed>=530&&elapsed<940);
        f.beam.visibility=1-smooth((elapsed-810)/130);
        f.shock.setEnabled(elapsed>=660);
        f.shock.scaling.setAll(.13+1.7*explode);
        f.shock.visibility=1-explode;
      }
    }
  }
  remove(effect){
    effect?.root?.dispose?.(false,false);
    effect?.impact?.dispose?.(false,false);
    effect?.beamRoot?.dispose?.(false,false);
  }
  clear(){
    for(const effect of this.active)this.remove(effect);
    this.active.length=0;
    for(const glyph of this.analysisGlyphs.values())glyph.root.dispose(false,false);
    this.analysisGlyphs.clear();this.recent.clear();
  }
  dispose(){
    this.clear();
    for(const material of Object.values(this.materials))material.dispose?.();
  }
  diagnostics(){return{active:this.active.length,analysisMarks:this.analysisGlyphs.size,
    materials:Object.keys(this.materials).length,skills:Object.keys(SPELLS).length};}
}

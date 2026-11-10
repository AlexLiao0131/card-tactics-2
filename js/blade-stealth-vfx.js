/** Shared dual-blade, surprise slash, poisoned knife and stealth cast visuals.
 * Smoke is already a real EnvironmentRenderer effect; this file only renders
 * the throwing action, never another smoke cloud. Status visuals use the
 * official viewer-filtered snapshot, not hidden enemy units.
 */
import {HeroCombatVfxBase,VFX_TAU,vfxClamp,vfxSmooth,vfxLerp,vfxVec} from './hero-combat-vfx-common.js';
import {VfxDatabase} from './vfx-database.js';
const MODULE='blade-stealth',IDS=VfxDatabase.skillIds(MODULE);
const DUR={DOUBLE:760,BACKSTAB:760,POISON_KNIFE:890,SMOKE:790,STEAL:650,HIDE:650};
export class BladeStealthVfx extends HeroCombatVfxBase{
  constructor(scene){
    super(scene,{name:'blade-stealth',maxActive:8,colors:{
      blade:[[.88,.94,1],.95],shadow:[[.29,.31,.47],.65],poison:[[.52,.86,.18],.86],
      teal:[[.36,.94,.70],.83],mist:[[.59,.61,.68],.65]
    }});
  }
  sync(snapshot,events=[]){
    this.prepare(snapshot);
    const now=performance.now();
    for(const e of events){if(!this.acceptEvent(snapshot,e,IDS))continue;
      this.cast(VfxDatabase.roleFor(MODULE,e.skillId),e,snapshot,now);
    }
    const wanted=new Set();
    for(const unit of snapshot?.units||[]){
      if((unit.effects||[]).some(e=>String(e.id)==='POISON')){
        const id=`POISON:${unit.id}`;wanted.add(id);
        this.status(id,unit,()=>this.makeStatus(id,'poison'));
      }
      if(unit.stealthed&&unit.friendlyToViewer){
        // UnitRenderer already handles translucency; this is an understated
        // ankle-level contour, NEVER a duplicate invisible clone.
        const id=`STEALTH:${unit.id}`;wanted.add(id);
        this.status(id,unit,()=>this.makeStatus(id,'shadow'));
      }
    }
    this.pruneStatuses(wanted);
  }
  makeStatus(id,kind){
    const root=this.node(`rogue-status-${id}`);
    const ring=this.ring(root,`${kind}-status-ring`,1.00,kind,16);
    ring.rotation.x=Math.PI/2;
    const motes=Array.from({length:4},(_,i)=>this.orb(root,`${kind}-status-dot-${i}`,.09,kind));
    return {root,above:.18,ring,motes,kind};
  }
  cast(kind,e,s,now){
    const fx=this.createEffect(kind,e,s,now,DUR[kind]);
    fx.root.position.copyFrom(kind==='SMOKE'||kind==='HIDE'||kind==='STEAL'?fx.from:fx.to);
    fx.ring=this.ring(fx.root,`${kind}-impact-rune`,kind==='SMOKE'?1.48:.80,
      kind==='POISON_KNIFE'?'poison':kind==='HIDE'||kind==='BACKSTAB'?'shadow':'blade',14);
    fx.ring.rotation.x=Math.PI/2;
    fx.shards=Array.from({length:kind==='DOUBLE'?8:5},(_,i)=>this.shard(fx.root,`${kind}-spark-${i}`,
      kind==='POISON_KNIFE'?'poison':kind==='BACKSTAB'?'shadow':'teal',.22));
    if(kind==='DOUBLE'||kind==='BACKSTAB'){
      fx.edges=Array.from({length:kind==='DOUBLE'?2:1},(_,i)=>{
        const mesh=this.mesh(fx.root,`${kind}-knife-arc-${i}`,'CreateBox',
          {width:1.32,height:.07,depth:.06},i===0?'blade':'teal');
        mesh.rotation.y=(i?-.82:.82);return mesh;
      });
    }
    if(kind==='SMOKE'){
      // Throwing the canister is visual only. The shared EnvironmentRenderer
      // continues to own the actual rising/LOS-blocking smoke cluster.
      fx.canister=this.orb(fx.root,'smoke-bomb-canister',.19,'mist');
    }
    if(kind==='STEAL'){
      // No loot/gold or inventory data is serialized in this flash.
      fx.sleight=this.orb(fx.root,'pickpocket-hand-glint',.16,'teal');
    }
    if(kind==='POISON_KNIFE'){
      fx.knife=this.node('poison-knife-flight',fx.from);
      fx.knife.parent=fx.root;fx.knife.position.copyFrom(fx.from.subtract(fx.root.position));
      const edge=this.mesh(fx.knife,'poison-knife-metal','CreateCylinder',
        {height:.42,diameterTop:0,diameterBottom:.105,tessellation:7},'blade');edge.rotation.x=Math.PI/2;
      const hilt=this.mesh(fx.knife,'poison-knife-hilt','CreateCylinder',
        {height:.17,diameter:.06,tessellation:7},'poison');hilt.rotation.x=Math.PI/2;hilt.position.z=-.27;
    }
    return fx;
  }
  updateEffect(fx,elapsed,p){
    fx.ring.scaling.setAll(.25+1.65*vfxSmooth(p));fx.ring.visibility=(1-p)*.8;
    fx.shards.forEach((shard,i)=>{
      const a=VFX_TAU*i/fx.shards.length+(fx.kind==='SMOKE'?elapsed*.006:0);
      const radius=.2+1.0*vfxSmooth(p);
      shard.position.set(Math.cos(a)*radius,.12+Math.sin(a*2)*.15,Math.sin(a)*radius);
      shard.visibility=(1-p)*.85;
    });
    if(fx.edges)fx.edges.forEach((edge,i)=>{
      edge.rotation.z=(i===0?1:-1)*(.30+Math.PI*vfxSmooth(p));
      edge.visibility=1-vfxClamp((p-.58)/.42);
    });
    if(fx.knife){const pos=fx.from.add(fx.to.subtract(fx.from).scale(vfxSmooth(p)));
      pos.y+=Math.sin(Math.PI*p)*.20;
      fx.knife.position.copyFrom(pos.subtract(fx.root.position));
      fx.knife.rotation.y+=.06;
      fx.knife.setEnabled(p<.98);
    }
    if(fx.canister){
      const pos=fx.from.clone();pos.y+=Math.sin(Math.PI*p)*.48-p*.85;
      fx.canister.position.copyFrom(pos.subtract(fx.root.position));
      fx.canister.visibility=1-vfxClamp((p-.68)/.32);
    }
    if(fx.sleight){
      const pos=fx.to.add(fx.from.subtract(fx.to).scale(vfxSmooth(p)));
      fx.sleight.position.copyFrom(pos.subtract(fx.root.position));
      fx.sleight.visibility=1-p;
    }
  }
  updateAuras(now){for(const fx of this.auras.values()){
    const a=now*.0015;
    fx.ring.rotation.z=a*.30;
    fx.ring.visibility=.38+.18*Math.sin(a*2);
    fx.motes.forEach((m,i)=>{const theta=VFX_TAU*i/fx.motes.length+a;
      m.position.set(.5*Math.cos(theta),.06+Math.sin(theta)*.11,.5*Math.sin(theta));});
  }}
}

/**
 * Reusable heavy-weapon, ground-fracture and impact VFX.
 * Pure Babylon presentation: no combat RNG, coordinates, HP, terrain writes,
 * knockback or independent animation clock. Queued effects start only when
 * UnitRenderer begins the matching authoritative UNIT_ANIMATION sequence.
 */
import {HeroCombatVfxBase,VFX_TILE,VFX_TAU,vfxClamp,vfxSmooth,vfxLerp,vfxVec} from './hero-combat-vfx-common.js';
import {VfxDatabase} from './vfx-database.js';

const MODULE='physical-impact';
const SKILLS=VfxDatabase.skillIds(MODULE);
const LIFE=Object.freeze({RAGE_SLASH:540,QUAKE:1040,CLEAVE:760,EXECUTION:830});
const COLOR=Object.freeze({
  rage:[[.95,.065,.085],.86],
  flash:[[1,.78,.48],.94],
  scar:[[.24,.105,.065],.87],
  stone:[[.56,.42,.29],.89],
  dust:[[.56,.47,.38],.34],
  silver:[[.91,.93,.91],.90]
});

export class PhysicalImpactVfx extends HeroCombatVfxBase{
  constructor(scene,{units=null}={}){
    super(scene,{name:'physical-impact',maxActive:6,colors:COLOR});
    this.units=units;
    this.pending=new Map();
    this.shakeUndo=null;
  }

  sync(snapshot,events=[]){
    const previous=this.lastMapId,previousRound=this.lastRound;
    this.prepare(snapshot);
    if(previous!==null&&(previous!==this.lastMapId||this.lastRound<previousRound))
      this.pending.clear();
    const now=performance.now();
    for(const event of events){
      if(!this.acceptEvent(snapshot,event,SKILLS))continue;
      const role=VfxDatabase.roleFor(MODULE,event.skillId);
      if(!role)continue;
      // A leap animation and its CAST are queued at the same commit. Merely
      // seeing CAST in the presentation stream must NOT crack the ground yet.
      this.pending.set(event.sequence,{event,role,snapshot,received:now});
    }
    while(this.pending.size>24)this.pending.delete(this.pending.keys().next().value);
  }

  startEffect(pending,now){
    const {event,role,snapshot}=pending;
    const fx=this.createEffect(role,event,snapshot,now,LIFE[role]);
    fx.role=role;
    fx.direction=fx.to.subtract(fx.from);
    const length=Math.hypot(fx.direction.x,fx.direction.z)||1;
    fx.direction.x/=length;fx.direction.z/=length;
    fx.parts=[];
    if(role==='QUAKE')this.createQuake(fx,snapshot);
    else this.createSword(fx,role);
    return fx;
  }

  createSword(fx,role){
    fx.root.position.copyFrom(fx.from);
    const main=role==='RAGE_SLASH'?'rage':role==='CLEAVE'?'silver':'flash';
    fx.arc=this.ring(fx.root,`${role}-blade-arc`,role==='EXECUTION'?2.1:1.55,main,22);
    fx.arc.rotation.x=Math.PI*.42;
    fx.edge=this.mesh(fx.root,`${role}-greatsword-flash`,'CreateBox',
      {width:role==='EXECUTION'?1.72:1.33,height:.09,depth:.055},'flash');
    fx.edge.rotation.z=role==='CLEAVE'?.52:-.58;
    fx.trail=this.ring(fx.root,`${role}-aftertrail`,role==='EXECUTION'?2.40:1.78,
      role==='EXECUTION'?'rage':'scar',20);
    fx.trail.rotation.x=Math.PI*.35;
    fx.bursts=Array.from({length:role==='EXECUTION'?7:5},(_,i)=>{
      const part=this.shard(fx.root,`${role}-impact-spark-${i}`,i%2?'flash':main,.19);
      return part;
    });
    if(role==='RAGE_SLASH'){
      fx.charge=this.ring(fx.root,'rage-on-sword',.75,'rage',16);
      fx.charge.rotation.x=Math.PI/2;
    }
    if(role==='CLEAVE'){
      // Heavy-weapon impact is a localized physical shock, not an extra hit.
      fx.impact=this.ring(fx.root,'cleave-weight-impact',.88,'stone',16);
      fx.impact.rotation.x=Math.PI/2;
    }
  }

  createQuake(fx,snapshot){
    // The ground quake uses the real landed TILE height. It does not replace,
    // deform, or edit any TerrainRenderer / HydrologyEngine data.
    fx.root.position.set(Number(fx.event.targetX)*VFX_TILE,
      this.terrainY(snapshot,fx.event.targetX,fx.event.targetY)+.055,
      Number(fx.event.targetY)*VFX_TILE);
    fx.rings=[
      this.ring(fx.root,'earthquake-compression',.85,'flash',22),
      this.ring(fx.root,'earthquake-pressure-front',1.18,'stone',26),
      this.ring(fx.root,'earthquake-dust-front',1.45,'dust',26)
    ];
    for(const ring of fx.rings){ring.rotation.x=Math.PI/2;ring.scaling.setAll(.15);}
    fx.core=this.mesh(fx.root,'quake-contact-pressure','CreateCylinder',
      {diameter:.75,height:.06,tessellation:20},'scar');
    fx.core.position.y=.01;
    fx.cracks=[];
    for(let i=0;i<9;i++){
      // Deterministic branches read only local artwork placement. The tactical
      // footprint remains the existing radius-one diamond, not these meshes.
      const angle=i*VFX_TAU/9+.12*Math.sin(i*2.3);
      const radius=.93+(i%3)*.21;
      const points=[
        vfxVec(0,.045,0),
        vfxVec(Math.cos(angle)*radius*.48,.047,Math.sin(angle)*radius*.48),
        vfxVec(Math.cos(angle+.14*(i%2?1:-1))*radius,.047,
          Math.sin(angle+.14*(i%2?1:-1))*radius)
      ];
      const line=this.tube(fx.root,`crack-${i}`,points,'scar',.047);
      line.visibility=0;
      fx.cracks.push(line);
    }
    fx.rocks=Array.from({length:8},(_,i)=>{
      const angle=i*VFX_TAU/8;
      const rock=this.mesh(fx.root,`flying-stone-${i}`,'CreateBox',
        {width:.15+(i%3)*.045,height:.13+(i%2)*.07,depth:.12},'stone');
      rock.metadata={...rock.metadata,angle,radius:.45+(i%4)*.25};
      return rock;
    });
    fx.dust=Array.from({length:6},(_,i)=>{
      const cloud=this.orb(fx.root,`dust-puff-${i}`,.41+(i%3)*.12,'dust');
      cloud.metadata={...cloud.metadata,angle:i*VFX_TAU/6};
      return cloud;
    });
  }

  updateFrame(now=performance.now()){
    // UnitRenderer.updateFrame() is called immediately before VfxManager in the
    // ONE Babylon render loop. Its active sequence is the exact time owner.
    const track=this.units?.activeAnimations;
    for(const [sequence,pending] of this.pending){
      const unitId=String(pending.event.unitId);
      const active=track?.get?.(unitId)??track?.get?.(pending.event.unitId);
      if(!track||!this.units?.entries){
        this.startEffect(pending,now);this.pending.delete(sequence);continue;
      }
      if(active?.event?.sequence===sequence){
        this.startEffect(pending,now);this.pending.delete(sequence);continue;
      }
      // Discard events dropped by perception projection, death or map change;
      // never trigger a remote action solely because a timer expired.
      const queued=this.units?.animationQueues?.get?.(unitId)||
        this.units?.animationQueues?.get?.(pending.event.unitId)||[];
      const expected=queued.some(e=>e.sequence===sequence);
      if(!expected&&now-pending.received>12000)this.pending.delete(sequence);
    }
    super.updateFrame(now);
    this.shakeView(now);
  }

  updateEffect(fx,elapsed,t){
    if(fx.role==='QUAKE'){
      const wave=vfxSmooth(t/.46),fade=1-vfxSmooth((t-.40)/.60);
      const crack=1-vfxSmooth((t-.70)/.30);
      fx.rings.forEach((ring,i)=>{
        const front=vfxSmooth(Math.max(0,(t-i*.065)/.43));
        ring.scaling.setAll(.14+front*(i===0?2.6:i===1?3.15:3.45));
        ring.visibility=(1-vfxSmooth(Math.max(0,(t-i*.05-.34)/.42)))*(i===2?.58:.78);
      });
      fx.core.scaling.setAll(.80+wave*1.5);
      fx.core.visibility=fade*.62;
      for(const line of fx.cracks){line.visibility=crack*(.46+.45*vfxSmooth(t/.17));}
      fx.rocks.forEach((rock,i)=>{
        const angle=rock.metadata.angle,rad=rock.metadata.radius;
        const h=Math.max(0,Math.sin(Math.PI*vfxClamp(t/.85)));
        rock.position.set(Math.cos(angle)*(rad+wave*.42),.11+h*(.38+(i%3)*.14),
          Math.sin(angle)*(rad+wave*.42));
        rock.rotation.x=elapsed*(.004+(i%3)*.001);
        rock.rotation.z=elapsed*(.003+(i%2)*.002);
        rock.visibility=fade;
      });
      fx.dust.forEach((cloud,i)=>{
        const angle=cloud.metadata.angle,rad=.45+wave*(.83+i*.065);
        cloud.position.set(Math.cos(angle)*rad,.17+wave*.24,Math.sin(angle)*rad);
        cloud.scaling.setAll(.45+wave*(.95+i*.06));
        cloud.visibility=fade*.48;
      });
      return;
    }
    const sweep=vfxSmooth(t/.56);
    const opacity=1-vfxSmooth((t-.56)/.44);
    fx.root.position.copyFrom(BABYLON.Vector3.Lerp(fx.from,fx.to,sweep*.65));
    const force=fx.role==='EXECUTION'?1.45:fx.role==='CLEAVE'?1.22:1;
    fx.arc.scaling.setAll(.42+force*sweep);
    fx.arc.rotation.z=(fx.role==='EXECUTION'?-1:1)*Math.sin(Math.PI*t)*1.2;
    fx.arc.visibility=opacity*.90;
    fx.edge.rotation.z+=Math.sin(Math.PI*t)*.18;
    fx.edge.visibility=opacity;
    fx.trail.scaling.setAll(.58+force*sweep*1.17);
    fx.trail.visibility=opacity*.72;
    fx.bursts.forEach((particle,i)=>{
      const angle=i*VFX_TAU/fx.bursts.length;
      const r=.2+sweep*(.50+(i%2)*.25);
      particle.position.set(Math.cos(angle)*r,.07+Math.sin(Math.PI*t)*.35,Math.sin(angle)*r);
      particle.rotation.y=elapsed*.009;
      particle.visibility=opacity*.9;
    });
    if(fx.charge){fx.charge.scaling.setAll(.52+sweep*.74);fx.charge.visibility=opacity*.8;}
    if(fx.impact){fx.impact.scaling.setAll(.4+sweep*1.6);fx.impact.visibility=opacity*.78;}
  }

  shakeView(now){
    // A renderer error may skip scene.render() and its afterRender cleanup.
    // Never accumulate stale per-frame offsets across subsequent frames.
    this.shakeUndo?.();
    // Small reversible screen-space vibration. No world coordinate mutation,
    // camera pan or zoom overwrite, and no independent render/timer loop.
    let x=0,y=0;
    for(const fx of this.active){
      if(fx.role!=='QUAKE')continue;
      const age=Math.max(0,now-fx.started);
      const envelope=1-vfxSmooth(vfxClamp(age/360));
      x+=Math.sin(age*.103)*envelope*.13;
      y+=Math.cos(age*.137)*envelope*.095;
    }
    if(!x&&!y)return;
    const camera=this.scene?.activeCamera;
    const offset=camera?.targetScreenOffset;
    const after=this.scene?.onAfterRenderObservable;
    if(!offset||typeof after?.addOnce!=='function')return;
    const baseX=offset.x,baseY=offset.y;
    const deltaX=Math.max(-.15,Math.min(.15,x)),deltaY=Math.max(-.12,Math.min(.12,y));
    offset.x+=deltaX;offset.y+=deltaY;
    const expectedX=offset.x,expectedY=offset.y;
    const undo=()=>{
      // BattleCamera may resync during beforeRender; only undo the offset if
      // ours is still present, otherwise leave the canonical camera untouched.
      if(Math.abs(offset.x-expectedX)<1e-6)offset.x=baseX;
      if(Math.abs(offset.y-expectedY)<1e-6)offset.y=baseY;
      if(this.shakeUndo===undo)this.shakeUndo=null;
    };
    this.shakeUndo=undo;
    after.addOnce(undo);
  }

  clear(){this.shakeUndo?.();this.shakeUndo=null;super.clear();this.pending?.clear();}
  diagnostics(){return{...super.diagnostics(),pending:this.pending.size};}
}

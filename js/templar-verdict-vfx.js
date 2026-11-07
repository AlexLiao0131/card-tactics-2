/**
 * Visual-only Babylon companion to the canonical Templar Verdict.
 * The luminous blade belongs to the caster's existing wrist/weapon pivot;
 * a crescent travels from that hand toward the enemy. The impact burst is the
 * established, unchanged post-engagement visual, never another damage source.
 * No external textures, per-cast lights, postprocess, or second render loop.
 */
import {TILE_SIZE,ELEVATION_HEIGHT} from './coordinate-system.js';

const SKILL_ID='templar_verdict';
const IMPACT_EVENT='TEMPLAR_VERDICT_IMPACT';
// Match the caster's 760ms CAST swing: raise -> release -> impact -> recovery.
const RAISE_MS=265,RELEASE_MS=255,IMPACT_MS=520,LIFE_MS=1180;
const clamp01=v=>Math.max(0,Math.min(1,Number(v)||0));
const ease=t=>{const p=clamp01(t);return p*p*(3-2*p);};
const fade=t=>1-clamp01(t);

export class TemplarVerdictVfx{
  constructor(scene,{units=null}={}){
    this.scene=scene;
    this.units=units; // Official UnitRenderer owns the FIGURE and wrist pivots.
    this.active=[];
    this.lastMapId=null;
    this.lastRound=null;
    this.materials={
      blade:this.material('verdict-gold-blade',[1,.70,.16],.96),
      white:this.material('verdict-white-core',[1,.96,.72],.95),
      aura:this.material('verdict-holy-halo',[1,.60,.12],.64)
    };
    scene.onDisposeObservable?.addOnce?.(()=>this.dispose());
  }

  material(name,color,alpha){
    const mat=new BABYLON.StandardMaterial(name,this.scene);
    mat.diffuseColor=new BABYLON.Color3(...color);
    mat.emissiveColor=new BABYLON.Color3(...color);
    mat.disableLighting=true;
    mat.backFaceCulling=false;
    mat.alpha=alpha;
    if(BABYLON.Engine?.ALPHA_ADD!==undefined)mat.alphaMode=BABYLON.Engine.ALPHA_ADD;
    return mat;
  }
  attach(mesh,parent,material){
    mesh.parent=parent;mesh.material=material;mesh.isPickable=false;
    mesh.receiveShadows=false;return mesh;
  }

  /** The blade is drawn OVER the actual held sword, not summoned at the target. */
  createChargedSword(actor,entry,direction){
    const root=new BABYLON.TransformNode('templar-verdict-weapon-light',this.scene);
    const pivot=entry?.kind==='FIGURE'?entry.figureParts?.weapon:null;
    const articulated=!!(pivot&&(entry?.definition?.figure?.blessedGreatsword||entry?.definition?.figure?.greatsword));
    const longSword=!!entry?.definition?.figure?.greatsword;
    const scale=articulated?Math.max(.1,Number(entry.definition?.height||entry.definition?.figure?.height||1.74)/1.74):1;
    const grip=articulated?(pivot.metadata?.figurePivot||[.307,.70,.070]):[.307,.70,.070];
    if(articulated){
      // Same local pivot as the existing, wrist-owned blessed greatsword.
      root.parent=pivot;
      root.position.set(0,0,0);
    }else{
      // Defensive fallback for capsule/billboard figures: still at the CASTER.
      root.position.set(actor.x*TILE_SIZE,
        Number(actor.renderZ??actor.z??0)*ELEVATION_HEIGHT+1.1,
        actor.y*TILE_SIZE);
      root.rotation.y=Math.atan2(direction.x,direction.z);
    }
    const local=point=>articulated?point.map((v,i)=>(v-grip[i])*scale):point;
    const create=(name,kind,opts,where,mat)=>{
      const mesh=this.attach(BABYLON.MeshBuilder[kind](name,opts,this.scene),root,mat);
      mesh.position.set(...local(where));return mesh;
    };
    // Hero Alicia has `figure.greatsword`; the other templar silhouette may
    // use `blessedGreatsword`. Respect the real authored blade/grip locations.
    const bladeY=longSword?.20:-.18,bladeHeight=longSword?1.86:1.57,
      guardY=longSword?1.0:.635;
    const parts=[
      create('verdict-held-gold-blade','CreateBox',
        {width:.30*scale,height:bladeHeight*scale,depth:.14*scale},[.315,bladeY,.110],this.materials.blade),
      create('verdict-held-white-edge','CreateBox',
        {width:.10*scale,height:(bladeHeight-.04)*scale,depth:.18*scale},[.315,bladeY,.116],this.materials.white),
      create('verdict-held-crossguard-light','CreateBox',
        {width:.52*scale,height:.075*scale,depth:.18*scale},[.314,guardY,.105],this.materials.white)
    ];
    // True converging golden motes. All are local to the existing sword pivot,
    // and thus follow every arm, weapon, root, and facing animation.
    const motes=[];
    for(let i=0;i<9;i++){
      const mesh=create(`verdict-gather-${i}`,'CreateSphere',
        {diameter:(i%3===0?.11:.08)*scale,segments:6},[.315,.3,.11],
        i%3===0?this.materials.white:this.materials.aura);
      motes.push(mesh);
    }
    return {root,parts,motes,articulated,scale,grip,guardY};
  }

  /** A real, curved golden cutting wave: NEVER a vertical sky column. */
  createSlashWave(){
    const root=new BABYLON.TransformNode('templar-verdict-outgoing-slash',this.scene);
    root.setEnabled(false);
    const ribbon=(name,inner,outer,material)=>{
      const pathArray=[[],[]];
      for(let i=0;i<=12;i++){
        const theta=-1.20+i*2.40/12;
        // Vertical crescent, centered in front of the sword. Width is spread
        // perpendicular to travel, not down from the sky.
        pathArray[0].push(new BABYLON.Vector3(Math.sin(theta)*inner,
          .95+Math.cos(theta)*inner*.78,0));
        pathArray[1].push(new BABYLON.Vector3(Math.sin(theta)*outer,
          .95+Math.cos(theta)*outer*.78,0));
      }
      return this.attach(BABYLON.MeshBuilder.CreateRibbon(name,
        {pathArray,sideOrientation:BABYLON.Mesh.DOUBLESIDE},this.scene),root,material);
    };
    const parts=[
      ribbon('verdict-gold-sword-crescent',.79,1.15,this.materials.blade),
      ribbon('verdict-white-sword-crescent',.90,1.03,this.materials.white)
    ];
    return {root,parts};
  }

  /** Previous gold-white burst preserved as-is, including the +/-2 cross. */
  createExplosion(){
    const root=new BABYLON.TransformNode('templar-verdict-holy-impact',this.scene);
    root.setEnabled(false);
    const pieces=[];
    const add=(name,kind,options,pos,mat)=>{
      const mesh=this.attach(BABYLON.MeshBuilder[kind](name,options,this.scene),root,mat);
      mesh.position.set(...pos);pieces.push(mesh);return mesh;
    };
    const flash=add('verdict-holy-flash','CreateSphere',{diameter:1,segments:10},[0,.55,0],this.materials.white);
    const halo=add('verdict-impact-halo','CreateSphere',{diameter:2.2,segments:12},[0,.48,0],this.materials.aura);
    const rings=[
      add('verdict-shockwave-1','CreateTorus',{diameter:1.6,thickness:.12,tessellation:20},[0,.26,0],this.materials.white),
      add('verdict-shockwave-2','CreateTorus',{diameter:2.1,thickness:.10,tessellation:20},[0,.33,0],this.materials.blade)
    ];
    rings.forEach(r=>r.rotation.x=Math.PI/2);
    const cross=[];
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const alongX=dx!==0;
      const beam=add(`verdict-cross-${dx}-${dz}`,'CreateBox',
        {width:alongX?TILE_SIZE*2:.34,height:.13,depth:alongX?.34:TILE_SIZE*2},
        [dx*TILE_SIZE,.20,dz*TILE_SIZE],this.materials.blade);
      cross.push({mesh:beam,dx,dz});
    }
    const rays=[];
    for(let i=0;i<8;i++){
      const theta=i*Math.PI/4,dx=Math.cos(theta),dz=Math.sin(theta);
      const ray=add(`verdict-ray-${i}`,'CreateBox',
        {width:.075,height:1.6,depth:.075},[dx*.6,.60,dz*.6],i%2?this.materials.blade:this.materials.white);
      ray.rotation.z=dx*.47;ray.rotation.x=dz*.47;rays.push(ray);
    }
    return {root,flash,halo,rings,cross,rays,pieces};
  }

  heightFor(snapshot,x,y){
    const unit=(snapshot.units||[]).find(u=>u.x===x&&u.y===y&&u.alive!==false);
    if(unit&&Number.isFinite(Number(unit.renderZ??unit.z)))return Number(unit.renderZ??unit.z)*ELEVATION_HEIGHT;
    const tile=(snapshot.map?.tiles||[]).find(t=>t.x===x&&t.y===y);
    return Number(tile?.elevation||0)*ELEVATION_HEIGHT;
  }
  start(event,snapshot,now){
    const targetX=Number(event.targetX),targetY=Number(event.targetY);
    if(!Number.isFinite(targetX)||!Number.isFinite(targetY))return null;
    const actor=(snapshot.units||[]).find(u=>String(u.id)===String(event.unitId));
    if(!actor)return null;
    // The actor, not the target, owns the first luminous object.
    const ax=Number(actor.x),ay=Number(actor.y),dx=targetX-ax,dy=targetY-ay,mag=Math.hypot(dx,dy)||1;
    const direction={x:dx/mag,z:dy/mag};
    const entry=this.units?.entries?.get(actor.id)||this.units?.entries?.get(String(actor.id))||null;
    const effect={actorId:String(actor.id),targetId:String(event.targetId||''),
      targetX,targetY,x:targetX*TILE_SIZE,z:targetY*TILE_SIZE,
      fromX:ax*TILE_SIZE,fromZ:ay*TILE_SIZE,
      sourceY:Number(actor.renderZ??actor.z??0)*ELEVATION_HEIGHT,
      groundY:this.heightFor(snapshot,targetX,targetY),dirX:direction.x,dirZ:direction.z,
      started:now,impact:false,
      sword:this.createChargedSword(actor,entry,direction),wave:this.createSlashWave(),blast:null};
    this.active.push(effect);
    while(this.active.length>4)this.remove(this.active.shift());
    return effect;
  }

  sync(snapshot,events=[]){
    const mapId=snapshot?.map?.id??null,round=Number(snapshot?.round||0);
    if(this.lastMapId!==null&&(mapId!==this.lastMapId||round<this.lastRound))this.clear();
    this.lastMapId=mapId;this.lastRound=round;
    const visible=new Set((snapshot?.units||[]).map(u=>String(u.id)));
    const now=performance.now();
    for(const event of events||[]){
      if(event?.skillId!==SKILL_ID||!visible.has(String(event.unitId)))continue;
      if(event.type==='UNIT_ANIMATION'){
        // Sanitized PvP presentation removes coordinates of unseen targets.
        if(Number.isFinite(event.targetX)&&Number.isFinite(event.targetY))this.start(event,snapshot,now);
      }else if(event.type===IMPACT_EVENT){
        const fx=[...this.active].reverse().find(e=>e.actorId===String(event.unitId)&&
          e.targetId===String(event.targetId||'')&&e.targetX===Number(event.targetX)&&
          e.targetY===Number(event.targetY)&&now-e.started<950);
        if(fx&&!fx.impact){
          fx.impact=true;
          fx.blast=this.createExplosion();
          fx.blast.root.position.set(fx.x,fx.groundY,fx.z);
        }
      }
    }
  }

  updateFrame(now=performance.now()){
    for(let i=this.active.length-1;i>=0;i--){
      const fx=this.active[i],elapsed=Math.max(0,now-fx.started);
      if(elapsed>=LIFE_MS){this.remove(fx);this.active.splice(i,1);continue;}
      const charge=ease(elapsed/RAISE_MS),release=ease((elapsed-RAISE_MS)/RELEASE_MS);
      const swordVisibility=fade((elapsed-RAISE_MS-RELEASE_MS)/190);
      const {sword,wave}=fx;
      const scale=.10+charge*1.03;
      sword.root.scaling.setAll(scale);
      // Fallback casters without a FIGURE wrist stay at their own cell.
      if(!sword.articulated){
        sword.root.rotation.x=-(1-release)*.65+release*.92;
        sword.root.rotation.z=-release*1.12;
      }
      for(const mesh of sword.parts)mesh.visibility=charge*swordVisibility;
      for(let j=0;j<sword.motes.length;j++){
        const particle=sword.motes[j],angle=j*2.39996;
        const radius=(1-charge)*(.45+.13*(j%3))*sword.scale;
        const y=sword.guardY-.25-(j%4)*.37;
        const coord=[.315+Math.cos(angle)*radius,y,.105+Math.sin(angle)*radius];
        const loc=sword.articulated?coord.map((v,k)=>(v-sword.grip[k])*sword.scale):coord;
        particle.position.set(...loc);
        particle.visibility=charge*(1-charge*.65)*swordVisibility;
      }
      // Real sword energy is released forward, not dropped from above.
      const isReleased=elapsed>=RAISE_MS&&elapsed<IMPACT_MS+120;
      wave.root.setEnabled(isReleased);
      if(isReleased){
        const p=release;
        const along=.78+(Math.hypot(fx.x-fx.fromX,fx.z-fx.fromZ)-.78)*p;
        wave.root.position.set(fx.fromX+fx.dirX*along,
          fx.sourceY+(.85+(fx.groundY-fx.sourceY)*p),
          fx.fromZ+fx.dirZ*along);
        wave.root.rotation.y=Math.atan2(fx.dirX,fx.dirZ);
        wave.root.scaling.setAll(.68+p*.40);
        for(const mesh of wave.parts)mesh.visibility=fade((elapsed-IMPACT_MS)/145)*Math.min(1,(elapsed-RAISE_MS)/75);
      }
      // Preserve the former gold burst exactly, but time its appearance to
      // the outgoing sword arc reaching the target. A MISS never has a blast.
      const showBlast=fx.impact&&elapsed>=IMPACT_MS;
      if(fx.blast)fx.blast.root.setEnabled(showBlast);
      if(!showBlast||!fx.blast)continue;
      const p=clamp01((elapsed-IMPACT_MS)/(LIFE_MS-IMPACT_MS)),out=1-Math.pow(1-p,3),opacity=(1-p)*(1-p);
      fx.blast.flash.scaling.setAll(.3+out*3.5);
      fx.blast.flash.visibility=opacity;
      fx.blast.halo.scaling.setAll(.25+out*2.9);
      fx.blast.halo.visibility=opacity*.52;
      fx.blast.rings.forEach((ring,index)=>{
        ring.scaling.setAll(.3+out*(2.4+index*.65));ring.visibility=opacity*(index===0?.9:.65);
      });
      for(const {mesh,dx,dz} of fx.blast.cross){
        const expansion=.03+out*.97;
        mesh.scaling.set(dx?expansion:1,1,dz?expansion:1);
        mesh.position.x=dx*TILE_SIZE*expansion;
        mesh.position.z=dz*TILE_SIZE*expansion;
        mesh.visibility=opacity*.85;
      }
      fx.blast.rays.forEach((ray,index)=>{
        const angle=index*Math.PI/4,dist=.5+out*2.5;
        ray.position.x=Math.cos(angle)*dist;ray.position.z=Math.sin(angle)*dist;
        ray.position.y=.5+out*.9;ray.scaling.y=1+out*.8;ray.visibility=opacity*.8;
      });
    }
  }
  remove(effect){effect?.sword?.root?.dispose?.(false,false);effect?.wave?.root?.dispose?.(false,false);effect?.blast?.root?.dispose?.(false,false);}
  clear(){for(const effect of this.active)this.remove(effect);this.active.length=0;}
  dispose(){this.clear();for(const m of Object.values(this.materials))m.dispose?.();}
  diagnostics(){return {active:this.active.length,materialCount:Object.keys(this.materials).length};}
}

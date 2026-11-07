/**
 * Babylon-only visual companion to the official Templar Verdict skill.
 * Gameplay never reads this class. Damage, hit, cross radius and resources
 * stay in BattleResolution/PostEngagementEngine. No post-processing/glow RT,
 * per-cast lights, timers or new scene loops: good for mobile WebGL.
 */
import {TILE_SIZE,ELEVATION_HEIGHT} from './coordinate-system.js';

const SKILL_ID='templar_verdict';
const IMPACT_EVENT='TEMPLAR_VERDICT_IMPACT';
const SLASH_MS=520;
const LIFE_MS=1180;
const clamp01=v=>Math.max(0,Math.min(1,Number(v)||0));
const easeOut=t=>1-Math.pow(1-clamp01(t),3);

export class TemplarVerdictVfx{
  constructor(scene){
    this.scene=scene;
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
    const material=new BABYLON.StandardMaterial(name,this.scene);
    material.diffuseColor=new BABYLON.Color3(...color);
    material.emissiveColor=new BABYLON.Color3(...color);
    material.disableLighting=true;
    material.backFaceCulling=false;
    material.alpha=alpha;
    if(BABYLON.Engine?.ALPHA_ADD!==undefined)material.alphaMode=BABYLON.Engine.ALPHA_ADD;
    return material;
  }

  attach(mesh,root,material){
    mesh.parent=root;
    mesh.material=material;
    mesh.isPickable=false;
    mesh.receiveShadows=false;
    return mesh;
  }

  createSword(){
    const root=new BABYLON.TransformNode('templar-verdict-sword',this.scene);
    const build=(name,kind,options,pos,mat)=>{
      const mesh=this.attach(BABYLON.MeshBuilder[kind](name,options,this.scene),root,mat);
      mesh.position.set(...pos);
      return mesh;
    };
    // Blade points downward: the gleaming point meets the target at impact.
    const parts=[
      build('verdict-greatblade','CreateBox',{width:.64,height:2.75,depth:.18},[0,-1.43,0],this.materials.blade),
      build('verdict-blade-core','CreateBox',{width:.16,height:2.65,depth:.23},[0,-1.43,0],this.materials.white),
      build('verdict-blade-tip','CreateCylinder',{height:.72,diameterTop:.65,diameterBottom:0,tessellation:4},[0,-3.16,0],this.materials.blade),
      build('verdict-crossguard','CreateBox',{width:1.38,height:.18,depth:.29},[0,.04,0],this.materials.white),
      build('verdict-grip','CreateCylinder',{height:.82,diameter:.16,tessellation:8},[0,.54,0],this.materials.blade),
      build('verdict-pommel','CreateSphere',{diameter:.30,segments:8},[0,1.05,0],this.materials.white)
    ];
    return {root,parts};
  }

  createExplosion(){
    const root=new BABYLON.TransformNode('templar-verdict-holy-impact',this.scene);
    root.setEnabled(false);
    const pieces=[];
    const add=(name,kind,options,pos,mat)=>{
      const mesh=this.attach(BABYLON.MeshBuilder[kind](name,options,this.scene),root,mat);
      mesh.position.set(...pos);
      pieces.push(mesh);
      return mesh;
    };
    const flash=add('verdict-holy-flash','CreateSphere',{diameter:1,segments:10},[0,.55,0],this.materials.white);
    const halo=add('verdict-impact-halo','CreateSphere',{diameter:2.2,segments:12},[0,.48,0],this.materials.aura);
    const rings=[
      add('verdict-shockwave-1','CreateTorus',{diameter:1.6,thickness:.12,tessellation:20},[0,.26,0],this.materials.white),
      add('verdict-shockwave-2','CreateTorus',{diameter:2.1,thickness:.10,tessellation:20},[0,.33,0],this.materials.blade)
    ];
    rings.forEach(r=>r.rotation.x=Math.PI/2);
    // Visualize the actual authored +/-2 tile cross; these meshes never deal damage.
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
      ray.rotation.z=dx*.47;
      ray.rotation.x=dz*.47;
      rays.push(ray);
    }
    return {root,flash,halo,rings,cross,rays,pieces};
  }

  heightFor(snapshot,x,y){
    const unit=(snapshot.units||[]).find(u=>u.x===x&&u.y===y&&u.alive!==false);
    if(unit&&Number.isFinite(Number(unit.renderZ??unit.z)))
      return Number(unit.renderZ??unit.z)*ELEVATION_HEIGHT;
    const tile=(snapshot.map?.tiles||[]).find(t=>t.x===x&&t.y===y);
    return Number(tile?.elevation||0)*ELEVATION_HEIGHT;
  }

  start(event,snapshot,now){
    const x=Number(event.targetX),y=Number(event.targetY);
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    const fromX=Number(event.x??x),fromY=Number(event.y??y);
    const dx=x-fromX,dy=y-fromY,mag=Math.hypot(dx,dy)||1;
    const effect={actorId:String(event.unitId),targetId:String(event.targetId||''),
      targetX:x,targetY:y,x:x*TILE_SIZE,z:y*TILE_SIZE,
      groundY:this.heightFor(snapshot,x,y),dirX:dx/mag,dirZ:dy/mag,
      started:now,impact:false,sword:this.createSword(),blast:null};
    this.active.push(effect);
    // Never retain a growing VFX queue during a stress battle.
    while(this.active.length>4)this.remove(this.active.shift());
    return effect;
  }

  sync(snapshot,events=[]){
    // This receives the same seat-filtered events as UnitRenderer, not an
    // unfiltered battlefield. Never reveal unseen attacks or targets.
    const mapId=snapshot?.map?.id??null,round=Number(snapshot?.round||0);
    if(this.lastMapId!==null&&(mapId!==this.lastMapId||round<this.lastRound))this.clear();
    this.lastMapId=mapId;this.lastRound=round;
    const visible=new Set((snapshot?.units||[]).map(u=>String(u.id)));
    const now=performance.now();
    for(const event of events||[]){
      if(event?.skillId!==SKILL_ID||!visible.has(String(event.unitId)))continue;
      if(event.type==='UNIT_ANIMATION'){
        if(Number.isFinite(Number(event.targetX))&&Number.isFinite(Number(event.targetY)))
          this.start(event,snapshot,now);
      }else if(event.type===IMPACT_EVENT){
        const fx=[...this.active].reverse().find(e=>e.actorId===String(event.unitId)&&
          e.targetId===String(event.targetId||'')&&
          e.targetX===Number(event.targetX)&&e.targetY===Number(event.targetY)&&
          now-e.started<900);
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
      const fall=easeOut(elapsed/SLASH_MS),fade=1-clamp01((elapsed-SLASH_MS)/280);
      const {root,parts}=fx.sword;
      root.position.set(fx.x-fx.dirX*(1-fall)*.9,
        fx.groundY+3.55+(1-fall)*2.6,
        fx.z-fx.dirZ*(1-fall)*.9);
      root.rotation.y=Math.atan2(fx.dirX,fx.dirZ);
      root.rotation.z=-(1-fall)*.72;
      for(const mesh of parts)mesh.visibility=Math.max(0,fade);
      // A miss still shows the summoned blade, but no fabricated blast.
      const showBlast=fx.impact&&elapsed>=SLASH_MS;
      if(fx.blast)fx.blast.root.setEnabled(showBlast);
      if(!showBlast||!fx.blast)continue;
      const p=clamp01((elapsed-SLASH_MS)/(LIFE_MS-SLASH_MS)),out=easeOut(p),opacity=(1-p)*(1-p);
      fx.blast.flash.scaling.setAll(.3+out*3.5);
      fx.blast.flash.visibility=opacity;
      fx.blast.halo.scaling.setAll(.25+out*2.9);
      fx.blast.halo.visibility=opacity*.52;
      fx.blast.rings.forEach((ring,index)=>{
        ring.scaling.setAll(.3+out*(2.4+index*.65));
        ring.visibility=opacity*(index===0?.9:.65);
      });
      for(const {mesh,dx,dz} of fx.blast.cross){
        const scale=.03+out*.97;
        mesh.scaling.set(dx?scale:1,1,dz?scale:1);
        mesh.position.x=dx*TILE_SIZE*scale;
        mesh.position.z=dz*TILE_SIZE*scale;
        mesh.visibility=opacity*.85;
      }
      fx.blast.rays.forEach((ray,index)=>{
        const angle=index*Math.PI/4,dist=.5+out*2.5;
        ray.position.x=Math.cos(angle)*dist;
        ray.position.z=Math.sin(angle)*dist;
        ray.position.y=.5+out*.9;
        ray.scaling.y=1+out*.8;
        ray.visibility=opacity*.8;
      });
    }
  }

  remove(effect){effect?.sword?.root?.dispose?.(false,false);effect?.blast?.root?.dispose?.(false,false);}
  clear(){for(const effect of this.active)this.remove(effect);this.active.length=0;}
  dispose(){this.clear();for(const m of Object.values(this.materials))m.dispose?.();}
  diagnostics(){return {active:this.active.length,materialCount:Object.keys(this.materials).length};}
}

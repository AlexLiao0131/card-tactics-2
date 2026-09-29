import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";

const keyOf=t=>`${t.x},${t.y}`;
const tilesOf=state=>state?.map?.tiles||state?.grid?.tiles||[];

function phaseFor(key){let hash=2166136261;for(const ch of String(key)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}return((hash>>>0)%1000)/1000*Math.PI*2;}

export class WaterRenderer{
  constructor(scene){
    this.scene=scene;this.meshes=new Map();this.ripples=new Map();
    this.material=this.makeWaterMaterial("waterMaterial",new BABYLON.Color3(.12,.42,.75),.58,new BABYLON.Color3(.35,.55,.75));
    this.murkyMaterial=this.makeWaterMaterial("waterMurkyMaterial",new BABYLON.Color3(.27,.31,.20),.66,new BABYLON.Color3(.20,.24,.16));
    this.muddyMaterial=this.makeWaterMaterial("waterMuddyMaterial",new BABYLON.Color3(.30,.22,.12),.72,new BABYLON.Color3(.16,.12,.08));

    this.rippleMaterial=new BABYLON.StandardMaterial("waterRippleMaterial",scene);
    this.rippleMaterial.diffuseColor=new BABYLON.Color3(.50,.78,.96);this.rippleMaterial.emissiveColor=new BABYLON.Color3(.10,.24,.34);this.rippleMaterial.alpha=.30;this.rippleMaterial.disableLighting=true;this.rippleMaterial.backFaceCulling=false;
    this.beforeRender=this.scene.onBeforeRenderObservable.add(()=>{const time=performance.now()/1000;for(const ripple of this.ripples.values())ripple.rings.forEach((ring,index)=>{const pulse=1+Math.sin(time*1.25+ripple.phase+index*Math.PI)*.055;ring.scaling.set(pulse,1,pulse);});});
  }

  makeWaterMaterial(name,color,alpha,specular){const material=new BABYLON.StandardMaterial(name,this.scene);material.diffuseColor=color;material.alpha=alpha;material.specularColor=specular;material.specularPower=48;return material;}
  materialFor(tile){const value=Math.max(0,Math.min(1,Number(tile?.waterTurbidity||0)));return value>=.6?this.muddyMaterial:value>=.18?this.murkyMaterial:this.material;}
  createVolume(key){const mesh=BABYLON.MeshBuilder.CreateBox(`water-${key}`,{width:TILE_SIZE*.88,depth:TILE_SIZE*.88,height:1},this.scene);mesh.material=this.material;mesh.isPickable=false;mesh.metadata={kind:"water"};this.meshes.set(key,mesh);return mesh;}
  createRipples(key){const rings=[.52,.96].map((diameter,index)=>{const ring=BABYLON.MeshBuilder.CreateTorus(`water-ripple-${key}-${index}`,{diameter,thickness:.025,tessellation:24},this.scene);ring.material=this.rippleMaterial;ring.isPickable=false;return ring;});const ripple={rings,phase:phaseFor(key)};this.ripples.set(key,ripple);return ripple;}

  sync(state){
    const alive=new Set();
    for(const tile of tilesOf(state)){
      const depth=Math.max(0,Number(tile.waterDepth||0)),surface=tile.waterSurfaceZ==null?(depth>0?Number(tile.elevation||0)+depth:null):Number(tile.waterSurfaceZ);if(surface==null||depth<=0)continue;
      const key=keyOf(tile);alive.add(key);const height=Math.max(.001,depth*ELEVATION_HEIGHT),bottom=Number(tile.elevation||0)*ELEVATION_HEIGHT,top=surface*ELEVATION_HEIGHT;
      const mesh=this.meshes.get(key)||this.createVolume(key);mesh.material=this.materialFor(tile);mesh.scaling.y=height;mesh.position.set(tile.x*TILE_SIZE,(bottom+top)/2,tile.y*TILE_SIZE);mesh.visibility=tile.fogged?.22:1;
      const ripple=this.ripples.get(key)||this.createRipples(key);ripple.rings.forEach((ring,index)=>{const offset=index===0?-.26:.24;ring.position.set(tile.x*TILE_SIZE+offset,top+.022+index*.004,tile.y*TILE_SIZE+(index===0?.18:-.16));ring.visibility=tile.fogged?0:.72;});
    }
    for(const[key,mesh]of this.meshes){if(alive.has(key))continue;mesh.dispose();this.meshes.delete(key);const ripple=this.ripples.get(key);if(ripple){ripple.rings.forEach(ring=>ring.dispose());this.ripples.delete(key);}}
  }
}

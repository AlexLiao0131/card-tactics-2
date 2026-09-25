export class GridPicker{
  constructor(scene,canvas,onTile,gestureGuard=null){
    this.scene=scene;this.canvas=canvas;this.onTile=onTile;this.gestureGuard=gestureGuard;
    canvas.addEventListener("pointerup",e=>{
      if(this.gestureGuard?.consumeTapSuppression?.())return;
      const pick=scene.pick(scene.pointerX,scene.pointerY,mesh=>mesh?.metadata?.kind==="tile");
      const meta=pick?.pickedMesh?.metadata;
      if(pick?.hit&&meta?.kind==="tile")onTile(meta.x,meta.y);
    });
  }
}

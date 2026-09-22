export class GridPicker {
  constructor(scene, canvas, onTile) {
    this.scene = scene;
    this.canvas = canvas;
    this.onTile = onTile;
    scene.onPointerObservable.add(pointerInfo => {
      if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERPICK) return;
      const pick = pointerInfo.pickInfo;
      const meta = pick?.pickedMesh?.metadata;
      if (pick?.hit && meta?.kind === "tile") onTile(meta.x, meta.y);
    });
  }
}

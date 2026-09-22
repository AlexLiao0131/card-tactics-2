import { BattleCamera } from "./battle-camera.js";
import { TerrainRenderer } from "./terrain-renderer.js";
import { WaterRenderer } from "./water-renderer.js";
import { UnitRenderer } from "./unit-renderer.js";
import { GridPicker } from "./grid-picker.js";

export class BabylonRenderer {
  constructor(canvas, state, { onTilePicked } = {}) {
    this.canvas = canvas;
    this.engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.05, 0.08, 0.11, 1);

    const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.75;
    const dir = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.6, -1, -0.35), this.scene);
    dir.position = new BABYLON.Vector3(10, 18, 10);
    dir.intensity = 0.75;

    this.camera = new BattleCamera(this.scene, canvas, state);
    this.terrain = new TerrainRenderer(this.scene);
    this.water = new WaterRenderer(this.scene);
    this.units = new UnitRenderer(this.scene);
    this.picker = new GridPicker(this.scene, canvas, onTilePicked ?? (() => {}));

    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", () => {
      this.engine.resize();
      this.camera.sync(this.lastState ?? state);
    });
  }

  sync(state) {
    this.lastState = state;
    this.camera.sync(state);
    this.terrain.sync(state);
    this.water.sync(state);
    this.units.sync(state);
  }
}

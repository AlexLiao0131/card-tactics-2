(()=>{
  "use strict";

  /*
    Legacy tile inspector intentionally has no independent visual surface.
    Tile details are owned by TacticalUIController's single on-demand context inspector.
    Keeping this compatibility object avoids breaking callers while preventing duplicate HUDs.
  */
  window.TileInspectionUI=Object.freeze({
    open:()=>window.TacticalUIController?.openInspector?.("TILE"),
    close:()=>window.TacticalUIController?.closeInspector?.()
  });
})();

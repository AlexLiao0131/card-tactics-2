import { GridState } from "./grid-state.js";

export function createPrototypeBattleState() {
  const elevations = [
    [0,0,0,0,0,1,1,1],
    [0,0,0,1,1,1,2,2],
    [0,0,1,1,2,2,3,2],
    [0,0,1,2,2,1,1,1],
    [0,0,0,1,1,0,0,0],
    [0,0,0,0,0,0,0,0]
  ];

  const tiles = [];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 8; x++) {
      const elevation = elevations[y][x];
      const basin = (x === 1 && y === 4) || (x === 2 && y === 4) || (x === 1 && y === 5);
      tiles.push({
        x,
        y,
        elevation,
        waterDepth: basin ? 0.65 : 0,
        snowDepth: 0,
        iceThickness: 0,
        material: elevation >= 2 ? "ROCK" : "SOIL"
      });
    }
  }

  const grid = new GridState({ width: 8, height: 6, tiles });
  return {
    revision: 0,
    round: 1,
    grid,
    units: [
      { id: "P1", team: "P", name: "Player", gridX: 1, gridY: 1, alive: true },
      { id: "E1", team: "E", name: "Enemy", gridX: 6, gridY: 4, alive: true }
    ],
    selectedUnitId: "P1",
    meteorTarget: { x: 6, y: 2 },
    cameraQuarterTurns: 0
  };
}

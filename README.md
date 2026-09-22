# Card Tactics 2.0

New Babylon.js renderer prototype for Card Tactics.

## Rules

- Card Tactics 1.0 remains untouched and is the legacy rules source of truth.
- Grid / Battle State is authoritative.
- Babylon.js only renders state and reports picking intents.
- Babylon world positions never become gameplay coordinates.
- No Phaser-to-Babylon line-by-line translation.

## Milestone 1

This prototype includes:

- 8x6 grid
- Babylon.js scene
- orthographic isometric camera
- 90-degree camera rotation
- grid picking
- H0/H1/H2/H3 elevation
- placeholder player/enemy units
- state-driven one-tile movement
- Meteor changing a tile from H3 to H1
- state-driven mesh height update
- WaterDepth visualization
- unchanged logical grid coordinates after camera rotation

## Run

Serve this directory with any static HTTP server. It can be deployed directly with GitHub Pages.

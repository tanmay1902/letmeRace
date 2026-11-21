# Race3D

A 3D open-wheel racing game that runs in the browser. It uses three.js and is a static site, so it works on GitHub Pages with no build step.

## Modes
- **Grand Prix**: Valle Verde GP, a 3.7 km permanent circuit in daylight. It has kerbs, gravel traps, tyre walls, grandstands, a pit building and a start gantry.
- **City Racer**: Harbour City Street Circuit, a 2.5 km street track at dusk. Concrete walls and debris fences run close to the racing line, with street lamps, lit skyscrapers and a harbour.
- **IISER Mohali** *(coming soon, not selectable yet)*: IISER Mohali Campus Circuit, a 1.9 km track through the real campus in Mohali, Punjab. The layout comes from [OpenStreetMap](https://www.openstreetmap.org) road data, scaled up ×1.3 to fit the cars. It starts on the Main road and runs down the diagonal past Hostel 5, around the Hostel 6/7/8 loop, past Academic Blocks 1 and 2, and on past the Library, Lecture Hall Complex, Admin block and CAF to the main gate. The campus buildings are extruded from their OSM footprints and labelled with their names.

The playable modes have up to 9 AI opponents, a start-light sequence, lap timing, a live standings tower, a minimap and a results screen. You can also run a time trial with 0 opponents, and your best lap on each circuit is saved in your browser.

## Live commentary
Two commentators, a lead and an analyst, call the race out loud using your browser's built-in speech voices, with on-screen captions. They react to the start, overtakes, lead changes, battles, the slipstream, crashes, spins, off-track moments, fastest laps, the final lap and the finish. On the campus circuit they also call out the buildings you pass. You can choose voice and captions, captions only, or no commentary in the menu.

## Simulation
- Dynamic bicycle model with Pacejka-style tyres, a friction circle and load transfer
- Aerodynamic downforce and drag, so grip increases with speed (up to about 5 g in fast corners)
- 8-speed gearbox, automatic or manual
- About 780 kW of power, for a top speed of about 335 km/h
- Slipstream, plus different grip on kerbs, grass and gravel
- Optional traction control and steering assist
- The AI drives a racing line computed for minimum curvature, using a speed profile based on grip. It also overtakes and follows other cars.

## Controls
| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle | W / ↑ | RT / A |
| Brake / reverse | S / ↓ / Space | LT / B |
| Steer | A D / ← → | Left stick |
| Shift up / down (manual) | E / Q | RB / LB |
| Camera (chase, far chase, cockpit, T-cam, nose, TV) | C | Y |
| Reset car | R | X |
| Pause | P / Esc | Start |
| Mute | M | |

On phones and tablets, the game shows touch controls.

## Run locally
ES modules don't load from `file://`, so serve the folder with any static server:
```
python -m http.server 8000
```
Then open http://localhost:8000.

## Deploy to GitHub Pages
1. Push this folder to a GitHub repository.
2. On GitHub, go to **Settings → Pages → Build and deployment**.
3. Set **Source** to *Deploy from a branch*, then pick the `main` branch and the `/ (root)` folder.
4. Open `https://<user>.github.io/<repo>/`.

## Asset credits
All textures, skies and 3D models are **CC0 (public domain)** from [Poly Haven](https://polyhaven.com):
- Textures: `asphalt_track`, `clean_asphalt`, `aerial_grass_rock`, `gravel_floor_02`, `concrete_wall_004`, `concrete_pavement`, `rectangular_facade_tiles`, `concrete_tile_facade`, `brick_wall_001`
- HDRI skies: `kloofendal_48d_partly_cloudy_puresky`, `qwantani_dusk_2_puresky`
- Models: `old_tyre` (tyre barriers), `street_lamp_01` (city lamps)

IISER Mohali map data: © OpenStreetMap contributors, available under the [ODbL](https://www.openstreetmap.org/copyright). The data is extracted in `js/data/iiser.js`.

The race cars, the Valle Verde and Harbour City circuits, buildings, audio and liveries are generated in code, and the team, driver and sponsor names are made up. The game uses three.js (MIT), which loads from the jsDelivr CDN.

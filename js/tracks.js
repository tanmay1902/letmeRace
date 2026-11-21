// Track definitions. Coordinates are in metres on the ground plane (x, z).
// Valle Verde and Harbour City are original layouts. The IISER Mohali circuit follows
// real campus roads from OpenStreetMap (ODbL), see js/data/iiser.js.
import { IISER } from './data/iiser.js';

export const TRACKS = {
  gp: {
    id: 'gp',
    name: 'Valle Verde GP',
    subtitle: 'Permanent circuit · day',
    type: 'spline',
    halfWidth: 7,
    wallDist: 22,       // distance from centreline to barrier
    kerbs: true,
    gravel: true,
    scenery: 'gp',
    hdri: 'assets/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
    sunDir: [0.55, 0.62, 0.35],
    points: [
      [0, 0], [400, 0], [700, 0], [790, 40], [805, 140], [740, 220], [620, 250],
      [520, 300], [480, 400], [530, 500], [650, 560], [760, 640], [775, 745],
      [690, 800], [600, 745], [500, 650], [350, 600], [200, 620], [80, 700],
      [-60, 700], [-150, 620], [-170, 500], [-120, 400], [-170, 300], [-200, 180],
      [-150, 60], [-80, 5],
    ],
  },
  city: {
    id: 'city',
    name: 'Harbour City Street Circuit',
    subtitle: 'Street circuit · dusk',
    type: 'polygon',
    halfWidth: 6,
    wallDist: 7.2,
    kerbs: false,
    gravel: false,
    street: true,
    scenery: 'city',
    hdri: 'assets/hdri/qwantani_dusk_2_puresky_2k.hdr',
    sunDir: [-0.7, 0.18, 0.4],
    cornerRadius: 22,
    points: [
      [0, 0], [480, 0], [480, 180], [360, 180], [360, 300], [600, 300],
      [600, 520], [240, 520], [240, 400], [100, 400], [100, 220], [-60, 220],
      [-60, 80],
    ],
    radii: { 12: 40 },  // per-vertex radius overrides
  },
  iiser: {
    id: 'iiser',
    name: 'IISER Mohali Campus Circuit',
    subtitle: 'Campus roads · afternoon',
    type: 'polygon',
    halfWidth: 6,
    wallDist: 7.6,
    kerbs: true,
    gravel: false,
    street: true,
    scenery: 'campus',
    hdri: 'assets/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
    sunDir: [-0.4, 0.6, 0.55],
    cornerRadius: 17,
    points: IISER.points,
    campus: IISER,
  },
};

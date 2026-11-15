import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** How far `p` is through [a, b], clamped to 0..1. */
const seg = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));

/*
 * The business home's map, low-poly pass (2026-11-01, user, with a low-poly
 * valley screenshot: "try this kinda design… make better design for this map
 * concept"; the home's only opening since that evening).
 *
 * Iberia as a faceted low-poly heightfield: a jittered grid triangulated and
 * flat-shaded, every facet coloured by what it is — ochre and wheat meseta,
 * lavender rock on the sierras, snow above the snow line, turquoise rivers
 * and reservoirs, sand on the coast — and the Pyrenees, the Cantabrian range,
 * Sistema Central, Ibérico, Sierra Morena and the Béticas raised where they
 * really are (the outline and ranges come from real lon/lat: x = (lon+3)·2.6,
 * z = −(lat−40)·3.4). Roads carve their own valleys through the ranges, so a
 * van on the A-3 runs between mountains like a bus up a valley.
 *
 * Life on it: Cesto vans shuttle every highway out of the Madrid depot,
 * pausing to pick up (blue ping) and deliver (green ping); a pickup van works
 * a street of partner shops; people walk the plazas and hikers the trails;
 * clouds drift and their shadows cross the meseta; leaves (or snow, or
 * petals) fall past the lens. Four seasons repaint the land.
 *
 * The story: MapStory hands scroll progress to `apply`. Each chapter flies
 * the camera to its place (wide Spain → shops → depot → the A-3 → the network
 * → the buyer's shop), and a shader spotlight mutes everything outside the
 * place and draws a glowing ring on the facets around it. Your order rides
 * one van ("Tu pedido") whose journey is the scroll itself, and the last
 * chapter walks the parcel to the buyer's door. Pins are real DOM (crisp
 * type at any zoom); the mouse orbits the camera, lights the land under it,
 * and hovering a city pin lights that city.
 */

export type Season = 'autumn' | 'winter' | 'spring' | 'summer';
export type MapPlace = 'wide' | 'depot' | 'stores' | 'road' | 'network' | 'south' | 'delivery';
export interface MapApi {
  /** the scroll's progress; `snap` puts the camera there at once instead of flying */
  apply: (p: number, snap?: boolean) => void;
  /** false while the sky veil fully covers the map: stop drawing frames nobody sees */
  setAwake: (on: boolean) => void;
  /** px from the top the page's own floating layers occupy (header, wordmark, order bar): no pins there */
  setTopInset: (px: number) => void;
}
export interface SpainMapProps {
  places: MapPlace[];
  season: Season;
  words: { brand: string; stores: string; shop: string; delivered: string; yourOrder: string };
  register: (api: MapApi | null) => void;
  /** the chapter the CAMERA is in — the words follow this, so they never run ahead of the flight */
  onChapter?: (ch: number) => void;
}

type P2 = [number, number];

// ── Iberia from real coordinates ──
const COAST: P2[] = [
  [-12.19, -12.89], [-10.52, -12.04], [-7.42, -12.44], [-6.93, -12.04], [-2.08, -11.76], [0.18, -11.08],
  [2.66, -11.29], [3.18, -11.46], [5.21, -11.22], [9.11, -10.88], [13.02, -10.71], [15.75, -9.18],
  [16.07, -8.26], [16.46, -7.89], [13.46, -4.69], [11.07, -3.81], [10.08, -2.38], [7.71, 0.07],
  [6.95, 1.8], [8.41, 4.32], [6.56, 5.61], [6.02, 8.06], [5.26, 8.16], [3.7, 8.84], [3.07, 9.59],
  [2.11, 11.15], [1.41, 10.78], [-1.35, 11.15], [-3.7, 11.15], [-6.12, 13.16], [-6.77, 13.57],
  [-8.57, 11.8], [-10.29, 9.52], [-11.46, 9.62], [-12.84, 10.17], [-15.6, 10.13], [-15.29, 6.97],
  [-15.36, 5.1], [-16.93, 4.15], [-16.67, 2.18], [-14.97, -2.18], [-14.76, -3.91], [-15.29, -6.36],
  [-14.97, -7.62], [-16.33, -9.79], [-14.06, -11.46],
];
const PORTUGAL: P2[] = [
  [-15.29, -6.36], [-14.76, -3.91], [-14.97, -2.18], [-16.67, 2.18], [-16.93, 4.15], [-15.36, 5.1],
  [-15.29, 6.97], [-15.6, 10.13], [-12.84, 10.17], [-11.46, 9.62], [-10.42, 6.8], [-11.2, 5.44],
  [-10.42, 3.74], [-11.72, 1.36], [-10.42, 1.02], [-9.9, -1.02], [-10.16, -3.4], [-8.33, -5.44],
  [-10.94, -6.46], [-13.28, -6.97],
];
const ISLES = [
  { x: 15.49, z: 1.36, rx: 1.35, rz: 0.85, a: 0.3 },
  { x: 18.49, z: 0.17, rx: 0.75, rz: 0.32, a: 0.25 },
  { x: 11.54, z: 3.47, rx: 0.5, rz: 0.4, a: 0.6 },
];
interface Range { pts: P2[]; amps: number[]; w: number; seed: number }
const RANGES: Range[] = [
  { pts: [[3.6, -10.5], [6.0, -9.9], [8.5, -9.45], [11.2, -9.2], [13.8, -8.9], [15.4, -8.6]], amps: [1.2, 2.3, 3.1, 3.3, 2.5, 1.2], w: 0.95, seed: 1 },
  { pts: [[-10.4, -9.6], [-6.5, -10.2], [-4.2, -10.3], [-1.8, -9.9]], amps: [1.4, 2.4, 2.0, 1.0], w: 0.85, seed: 2 },
  { pts: [[-0.6, -9.6], [2.6, -10.0]], amps: [0.9, 0.8], w: 0.6, seed: 3 },
  { pts: [[-13.5, -9.2], [-11.6, -8.2], [-10.0, -7.4]], amps: [1.0, 1.3, 1.0], w: 1.2, seed: 4 },
  { pts: [[-11.98, -1.02], [-8.8, -0.6], [-5.73, -0.85], [-2.6, -2.72], [-0.52, -4.25]], amps: [1.5, 1.4, 2.0, 1.8, 1.3], w: 0.85, seed: 5 },
  { pts: [[-0.26, -7.6], [0.6, -6.9], [2.6, -6.3], [3.4, -4.4], [4.17, -2.2], [4.8, -0.9]], amps: [1.2, 1.7, 1.9, 1.5, 1.6, 1.2], w: 0.9, seed: 6 },
  { pts: [[2.2, -1.2], [3.6, -0.6], [4.6, -0.2]], amps: [1.4, 1.7, 1.3], w: 0.75, seed: 7 },
  { pts: [[2.2, 3.1], [3.3, 3.3], [4.2, 3.6]], amps: [1.0, 1.3, 0.8], w: 0.7, seed: 8 },
  { pts: [[-6.5, 1.8], [-5.2, 2.05], [-2.1, 1.9]], amps: [0.9, 1.0, 0.8], w: 0.8, seed: 9 },
  { pts: [[-11.0, 6.0], [-9.1, 6.6], [-3.9, 5.8], [0.5, 5.45], [2.5, 5.9]], amps: [0.8, 1.0, 1.1, 0.9, 0.8], w: 0.85, seed: 10 },
  { pts: [[-6.3, 11.8], [-4.7, 9.8], [-2.4, 9.6], [-0.78, 9.95], [1.8, 9.35], [3.9, 6.8], [5.0, 6.2]], amps: [1.2, 1.5, 2.3, 2.9, 1.9, 1.3, 0.9], w: 0.95, seed: 11 },
];
const RIVERS: P2[][] = [
  [[-2.86, -10.0], [1.43, -8.4], [3.6, -6.9], [5.49, -5.3], [8.0, -3.9], [10.08, -2.38]],
  [[3.2, -1.4], [1.4, -0.55], [-0.3, 0.3], [-1.8, 0.35], [-2.66, 0.48], [-4.77, 0.2], [-7.5, 0.9], [-10.16, 1.02], [-12.8, 2.4], [-15.88, 4.42]],
  [[0.4, 7.0], [-2.0, 7.0], [-4.64, 7.45], [-6.4, 8.3], [-7.79, 8.75], [-8.75, 10.6]],
  [[0.39, -6.63], [-1.2, -6.0], [-4.48, -5.61], [-7.16, -5.1], [-10.0, -4.4], [-12.6, -4.0], [-14.58, -3.88]],
];
const LAKES = [{ x: 2.6, z: -0.3, r: 0.5 }, { x: -6.0, z: 3.6, r: 0.55 }];
interface City { id: string; name: string; x: number; z: number; r: number; n: number; tall: number }
const CITIES: City[] = [
  { id: 'madrid', name: 'Madrid', x: -1.82, z: -1.43, r: 0.62, n: 26, tall: 0.6 },
  { id: 'barcelona', name: 'Barcelona', x: 13.0, z: -4.5, r: 0.55, n: 22, tall: 0.48 },
  { id: 'valencia', name: 'Valencia', x: 6.45, z: 1.75, r: 0.5, n: 17, tall: 0.36 },
  { id: 'sevilla', name: 'Sevilla', x: -7.76, z: 8.87, r: 0.5, n: 16, tall: 0.3 },
  { id: 'zaragoza', name: 'Zaragoza', x: 5.49, z: -5.61, r: 0.45, n: 13, tall: 0.28 },
  { id: 'bilbao', name: 'Bilbao', x: 0.2, z: -10.6, r: 0.42, n: 12, tall: 0.3 },
  { id: 'malaga', name: 'Málaga', x: -3.7, z: 10.7, r: 0.4, n: 12, tall: 0.26 },
  { id: 'coruna', name: 'A Coruña', x: -13.75, z: -11.0, r: 0.35, n: 9, tall: 0.24 },
];
const DEPOT = { x: -0.75, z: -0.65 };
const SHOPS: P2[] = [[-2.55, -0.76], [-2.95, -0.72], [-3.35, -0.62]];
const BUYER = { x: 5.9, z: 2.15, yaw: 0 };
const ROADS: Record<string, P2[]> = {
  a1: [[-0.75, -0.18], [-0.1, -0.35], [-0.15, -1.3], [-1.25, -2.4], [-1.5, -3.8], [-1.8, -5.7], [-1.82, -7.9], [-0.6, -9.2], [0.15, -10.35]],
  a2: [[-0.75, -0.18], [-0.1, -0.35], [-0.15, -1.3], [-0.4, -2.0], [1.2, -3.1], [3.0, -4.3], [5.3, -5.45], [7.5, -5.75], [9.43, -5.51], [11.4, -5.0], [12.8, -4.55]],
  a3: [[-0.75, -0.18], [0.4, -0.1], [1.7, 0.75], [3.1, 1.3], [4.5, 1.65], [5.15, 2.05]],
  a4: [[-0.75, -0.18], [-1.0, 0.7], [-0.9, 3.2], [-1.4, 5.4], [-2.1, 6.5], [-4.6, 7.25], [-6.3, 8.2], [-7.55, 8.75]],
  a6: [[-0.75, -0.18], [-1.4, -0.25], [-2.6, -1.25], [-3.6, -2.6], [-5.2, -5.0], [-7.0, -6.8], [-9.4, -8.6], [-11.9, -10.1], [-13.55, -10.85]],
  ap7: [[6.45, 1.75], [7.4, 0.1], [9.6, -2.2], [11.0, -3.6], [12.8, -4.55]],
  a92: [[-7.55, 8.75], [-6.0, 9.6], [-4.1, 10.1], [-3.75, 10.55]],
  street: [[-0.75, -0.18], [-1.5, -0.42], [-2.4, -0.45], [-3.6, -0.32]],
};

// ── palettes ──
interface Pal {
  fields: number[]; olive: number; rock: number[]; snow: number[]; beach: number; water: number[]; seabed: number;
  snowLine: number; rockLine: number; cone: number[]; ball: number[]; leaf: number[]; leafCount: number; round: boolean;
}
const PALETTES: Record<Season, Pal> = {
  autumn: {
    fields: [0xf0b640, 0xf6cb6c, 0xe8963b, 0xeba64a], olive: 0xb9af5e,
    rock: [0xbba9bc, 0xa996ad, 0xc9bac6], snow: [0xf7f4ef, 0xede8e3], beach: 0xf4e3c2,
    water: [0x2ec6d8, 0x22b5d0], seabed: 0xd9c9a5, snowLine: 2.05, rockLine: 1.3,
    cone: [0xf2b52f, 0xe9a12c, 0xf5c451], ball: [0xe8572b, 0xf07a2f, 0xd9462a],
    leaf: [0xf07a2e, 0xe8582b, 0xf2b42f], leafCount: 56, round: false,
  },
  winter: {
    fields: [0xdcd3be, 0xe6dfcd, 0xcfc3a8, 0xd8ccb2], olive: 0xa2a381,
    rock: [0xaeabc6, 0x9c99b8, 0xbdbad2], snow: [0xfbfbff, 0xeef1fa], beach: 0xefe6d2,
    water: [0x4cc6da, 0x3ab3cf], seabed: 0xcfc4aa, snowLine: 1.15, rockLine: 1.0,
    cone: [0x3f7a62, 0x4e8a6f, 0x356b55], ball: [0xc9d1da, 0xb5beca, 0xdde3ea],
    leaf: [0xffffff, 0xf2f6ff], leafCount: 84, round: true,
  },
  spring: {
    fields: [0x9ccb5e, 0xb7da74, 0xe9d86b, 0x8abd57], olive: 0x7fa850,
    rock: [0xb6aac0, 0xa497b0, 0xc5bbcb], snow: [0xf7f5f2, 0xece9e5], beach: 0xf4e5c6,
    water: [0x35cedf, 0x27bcd6], seabed: 0xd7cba8, snowLine: 1.75, rockLine: 1.3,
    cone: [0x6db35a, 0x5aa34e, 0x82c063], ball: [0xf5a9c4, 0xf8c6d5, 0x9bd06e],
    leaf: [0xf7c4d4, 0xffffff, 0xf5a9c4], leafCount: 44, round: false,
  },
  summer: {
    fields: [0xf3c553, 0xf8da8f, 0xe5ae44, 0xddb561], olive: 0xa3a65c,
    rock: [0xc5b2b7, 0xb3a0a8, 0xd2c2c3], snow: [0xf7f4ef, 0xede8e3], beach: 0xf6e8c8,
    water: [0x27cbdd, 0x1db8d3], seabed: 0xdccda8, snowLine: 2.6, rockLine: 1.35,
    cone: [0x86a84b, 0x779a42, 0x95b356], ball: [0x6e9e45, 0x7dab4e, 0x5e8e3c],
    leaf: [0xf8da8f, 0xffffff], leafCount: 14, round: true,
  },
};

// ── pure helpers ──
const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const hash = (x: number, z: number) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const vnoise = (x: number, z: number) => {
  const xi = Math.floor(x); const zi = Math.floor(z);
  const xf = x - xi; const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf); const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi); const b = hash(xi + 1, zi); const c = hash(xi, zi + 1); const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x: number, z: number) => vnoise(x, z) * 0.5 + vnoise(x * 2.03 + 5.2, z * 2.03 + 1.3) * 0.25 + vnoise(x * 4.1 + 9.7, z * 4.1 + 3.1) * 0.125;
let segT = 0;
const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax; const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  segT = t;
  const qx = ax + dx * t - px; const qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
};
interface Poly { xs: number[]; zs: number[]; x0: number; x1: number; z0: number; z1: number }
const poly = (pts: P2[]): Poly => ({
  xs: pts.map((q) => q[0]), zs: pts.map((q) => q[1]),
  x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])),
  z0: Math.min(...pts.map((q) => q[1])), z1: Math.max(...pts.map((q) => q[1])),
});
const polyDist = (pl: Poly, x: number, z: number, far: number): number => {
  if (x < pl.x0 - far || x > pl.x1 + far || z < pl.z0 - far || z > pl.z1 + far) return far;
  let best = far;
  for (let i = 0; i < pl.xs.length - 1; i++) {
    const d = segDist(x, z, pl.xs[i], pl.zs[i], pl.xs[i + 1], pl.zs[i + 1]);
    if (d < best) best = d;
  }
  return best;
};
const inPoly = (pts: P2[], x: number, z: number): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0]; const zi = pts[i][1]; const xj = pts[j][0]; const zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const COAST_POLY = poly([...COAST, COAST[0]]);
const coastSd = (x: number, z: number): number => {
  const d = polyDist(COAST_POLY, x, z, 1e9);
  let sd = inPoly(COAST, x, z) ? d : -d;
  for (const s of ISLES) {
    const dx = x - s.x; const dz = z - s.z;
    const c = Math.cos(-s.a); const sn = Math.sin(-s.a);
    const lx = dx * c - dz * sn; const lz = dx * sn + dz * c;
    const k = Math.sqrt((lx / s.rx) ** 2 + (lz / s.rz) ** 2);
    sd = Math.max(sd, (1 - k) * Math.min(s.rx, s.rz));
  }
  return sd;
};
const plainAt = (x: number, z: number, d: number, pt: boolean) =>
  0.1 + smooth01(d / 2.4) * (pt ? 0.36 : 0.55) + (fbm(x * 0.32 + 11, z * 0.32 - 4) - 0.42) * 0.42 * smooth01(d / 1.2);
const rangeAt = (r: Range, x: number, z: number): number => {
  let best = Infinity; let amp = 0;
  for (let i = 0; i < r.pts.length - 1; i++) {
    const d = segDist(x, z, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]);
    if (d < best) { best = d; amp = r.amps[i] + (r.amps[i + 1] - r.amps[i]) * segT; }
  }
  if (best > r.w * 2.6) return 0;
  return amp * Math.exp(-((best / r.w) ** 2)) * (0.6 + 0.8 * vnoise(x * 1.3 + r.seed * 7.1, z * 1.3 - r.seed * 3.3));
};
const lerpAngle = (a: number, b: number, k: number) => {
  const d = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + d * k;
};

const LEAF_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M11.5 14.5C6.5 13.5 4.5 9.5 5.5 4.5c5 1 7 5 6 10Z" fill="#7CE29A"/><path d="M13 14.5c0-3.7 2.8-6.5 6.5-6.5 0 3.7-2.8 6.5-6.5 6.5Z" fill="#4CBB6C"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export default function SpainMap({ places, season: firstSeason, words, register, onChapter }: SpainMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onChapterRef = useRef(onChapter);
  onChapterRef.current = onChapter;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const n = places.length;
    let disposed = false;
    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(x: T): T => { disposables.push(x); return x; };
    let seed = 1337;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let q = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
      return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
    };

    // ── stage ──
    // touch screens get fewer pixels and cheaper shadows: phones must keep up with a finger
    let coarse = false;
    try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* assume a mouse */ }
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.25 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = coarse ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.domElement.className = 'absolute inset-0 w-full h-full biz-map3d';
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    // Phones light the land with plain Lambert: on a matte, faceted world it looks the same,
    // and it is a fraction of the per-pixel cost of PBR with image-based reflections.
    const lite = coarse;
    if (!lite) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      scene.environment = track(pmrem.fromScene(room, 0.04).texture);
      (room as unknown as { dispose?: () => void }).dispose?.();
      pmrem.dispose();
      scene.environmentIntensity = 0.35;
    }
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
    scene.add(camera);
    const fog = new THREE.Fog(0xd4defa, 30, 110);
    scene.fog = fog;
    const hemi = new THREE.HemisphereLight(0xe3ebff, 0xc9a77a, 0.62);
    scene.add(hemi);
    // the reflection environment was a neutral fill from every side: on a phone a plain ambient
    // light stands in for it (tuned by A/B against the full renderer, same frame, same land)
    const fillLight = new THREE.AmbientLight(0xe6edff, lite ? 1.2 : 0);
    if (lite) scene.add(fillLight);
    const SUN_DIR_0 = new THREE.Vector3(-0.55, 0.72, 0.42).normalize();
    const sun = new THREE.DirectionalLight(0xfff0d4, 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.025;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    scene.add(sun, sun.target);
    // On a touch screen the shadows are STATIC: one map over the whole peninsula from a fixed
    // sun, drawn once after the world is built, and nothing that moves casts. Drawing the whole
    // country a second time every frame was the biggest cost a phone paid. A mouse machine
    // keeps the live shadow that follows the camera.
    const staticShadows = coarse;
    if (staticShadows) {
      sun.shadow.mapSize.set(2048, 2048);
      const sc0 = sun.shadow.camera;
      sc0.left = -25; sc0.right = 25; sc0.top = 25; sc0.bottom = -25; sc0.far = 140;
      sc0.updateProjectionMatrix();
      sun.target.position.set(0, 0, 0.5);
      sun.position.set(SUN_DIR_0.x * 60, SUN_DIR_0.y * 60, 0.5 + SUN_DIR_0.z * 60);
      renderer.shadowMap.autoUpdate = false;
    }
    const SUN_DIR = new THREE.Vector3(-0.55, 0.72, 0.42).normalize();

    // canvas textures that redraw once the fonts land
    const redraws: Array<() => void> = [];
    const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d')!;
      draw(g);
      const tex = track(new THREE.CanvasTexture(c));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      redraws.push(() => { g.clearRect(0, 0, w, h); draw(g); tex.needsUpdate = true; });
      return tex;
    };

    // ── the spotlight every world material shares ──
    const U = {
      uTime: { value: 0 },
      uFocus: { value: new THREE.Vector3() },
      uFocusR: { value: 2 },
      uFocusAmt: { value: 0 },
      uRingCol: { value: new THREE.Color(0x2f6bff) },
      uGlow: { value: new THREE.Vector3(999, 0, 999) },
      uGlowR: { value: 1 },
      uGlowAmt: { value: 0 },
      // the season fade: 0 shows the colour set in 'color' / instanceColor, 1 the one in '…To'
      uSeasonMix: { value: 0 },
    };
    type Blend = 'vertex' | 'instance' | undefined;
    const blendDecl = (blend: Blend) => (blend === 'vertex' ? '\nattribute vec3 colorTo;\nuniform float uSeasonMix;'
      : blend === 'instance' ? '\nattribute vec3 instanceColorTo;\nuniform float uSeasonMix;' : '');
    const blendMix = (blend: Blend) => (blend === 'vertex' ? '\nvColor.xyz = mix(color.xyz, colorTo, uSeasonMix);'
      : blend === 'instance' ? '\nvColor.xyz = mix(instanceColor.xyz, instanceColorTo, uSeasonMix);' : '');
    const focusify = (m: THREE.Material, water = false, blend: Blend = undefined) => {
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vBizW;' + blendDecl(blend))
          .replace('#include <color_vertex>', '#include <color_vertex>' + blendMix(blend))
          .replace('#include <begin_vertex>', water
            ? '#include <begin_vertex>\ntransformed.z += sin(position.x * 1.7 + uTime * 1.1) * 0.035 + cos(position.y * 1.3 + uTime * 0.8) * 0.03;'
            : '#include <begin_vertex>')
          .replace('#include <project_vertex>', '#include <project_vertex>\n{\n vec4 bw = vec4(transformed, 1.0);\n #ifdef USE_INSTANCING\n bw = instanceMatrix * bw;\n #endif\n vBizW = (modelMatrix * bw).xyz;\n}');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uFocus; uniform float uFocusR; uniform float uFocusAmt; uniform vec3 uRingCol; uniform vec3 uGlow; uniform float uGlowR; uniform float uGlowAmt;\nvarying vec3 vBizW;')
          .replace('#include <color_fragment>', `#include <color_fragment>
            float bizD = distance(vBizW.xz, uFocus.xz);
            float bizIn = 1.0 - smoothstep(uFocusR * 0.8, uFocusR * 1.04, bizD);
            float bizLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(bizLum), diffuseColor.rgb, 0.5) * 0.8, uFocusAmt * (1.0 - bizIn));
            float bizRing = (1.0 - smoothstep(0.0, 0.05 * uFocusR + 0.02, abs(bizD - uFocusR))) * uFocusAmt;
            float bizG = (1.0 - smoothstep(0.0, uGlowR, distance(vBizW.xz, uGlow.xz))) * uGlowAmt;
            diffuseColor.rgb *= 1.0 + bizG * 0.2;`)
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uRingCol * bizRing * (0.85 + 0.15 * sin(uTime * 3.0));');
      };
      m.customProgramCacheKey = () => `biz-map${water ? '-water' : ''}${blend ? `-${blend}` : ''}`;
    };
    type MapMat = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
    const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}, water = false, blend: Blend = undefined): MapMat => {
      let m: MapMat;
      if (lite) {
        // only what Lambert understands (and never an undefined: three warns about those)
        const lp: Record<string, unknown> = { color, flatShading: true };
        for (const k of ['vertexColors', 'emissive', 'emissiveIntensity', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits'] as const) {
          if (extra[k] !== undefined) lp[k] = extra[k];
        }
        m = track(new THREE.MeshLambertMaterial(lp as THREE.MeshLambertMaterialParameters));
      } else {
        m = track(new THREE.MeshStandardMaterial({ color, roughness: 0.88, flatShading: true, ...extra }));
      }
      focusify(m, water, blend);
      return m;
    };
    const M = {
      terrain: mat(0xffffff, { vertexColors: true, roughness: 0.95 }, false, 'vertex'),
      water: mat(0xffffff, { vertexColors: true, roughness: 0.3, metalness: 0.05 }, true),
      road: mat(0xfff3dc, { roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      wall: mat(0xffffff, { roughness: 0.85 }),
      roof: mat(0xffffff, { roughness: 0.9 }),
      window: mat(0xffd98e, { emissive: 0xffc96a, emissiveIntensity: 0 }),
      tree: mat(0xffffff, { roughness: 0.85 }, false, 'instance'),
      trunk: mat(0x7a5236),
      van: mat(0xffffff, { vertexColors: true, roughness: 0.58 }),
      statics: mat(0xffffff, { vertexColors: true, roughness: 0.85 }),
      depot: mat(0x1e5ef0, { roughness: 0.7 }),
      apron: mat(0xe8e1d1),
      dock: mat(0x14204a),
      shopWall: mat(0xfbf7ef),
      kraft: mat(0xd9a562),
      person: mat(0xffffff, { roughness: 0.8 }),
      skin: mat(0xf0c096),
      dots: mat(0xffffff, { roughness: 0.6 }),
      cream: mat(0xf7f1e6),
      tower: mat(0xbfd4ff, { roughness: 0.3, metalness: 0.3 }),
      plant: mat(0x3f9e4f),
      awnings: [mat(0x2e9e54), mat(0xf08a24), mat(0xe8584a)],
    };

    // ── roads and rivers as curves, then the ground they shape ──
    const curveOf = (pts: P2[]) => new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const tmpV = new THREE.Vector3();
    const sampled = (curve: THREE.Curve<THREE.Vector3>, step: number): Poly => {
      const k = Math.max(2, Math.ceil(curve.getLength() / step));
      const pts: P2[] = [];
      for (let i = 0; i <= k; i++) { curve.getPointAt(i / k, tmpV); pts.push([tmpV.x, tmpV.z]); }
      return poly(pts);
    };
    const roadCurves: Record<string, THREE.CatmullRomCurve3> = {};
    Object.entries(ROADS).forEach(([k, pts]) => { roadCurves[k] = curveOf(pts); });
    const roadPolys = Object.values(roadCurves).map((c) => sampled(c, 0.25));
    const riverPolys = RIVERS.map((r) => sampled(curveOf(r), 0.25));
    const roadDistAt = (x: number, z: number, far: number) => {
      let best = far;
      for (const rp of roadPolys) { const d = polyDist(rp, x, z, best); if (d < best) best = d; }
      return best;
    };
    const riverDistAt = (x: number, z: number, far: number) => {
      let best = far;
      for (const rp of riverPolys) { const d = polyDist(rp, x, z, best); if (d < best) best = d; }
      return best;
    };
    const FLATS = [
      ...CITIES.map((c) => ({ x: c.x, z: c.z, r: c.r + 0.12, level: 0 })),
      { x: DEPOT.x, z: DEPOT.z, r: 0.75, level: 0 },
      { x: -2.95, z: -0.62, r: 0.6, level: 0 },
      { x: 5.55, z: 2.15, r: 0.6, level: 0 },
      ...LAKES.map((l) => ({ x: l.x, z: l.z, r: l.r, level: 0 })),
    ];
    FLATS.forEach((fl) => {
      const d = coastSd(fl.x, fl.z);
      fl.level = plainAt(fl.x, fl.z, d, inPoly(PORTUGAL, fl.x, fl.z));
    });
    let lastFlat = 0;
    const heightAt = (x: number, z: number): number => {
      lastFlat = 0;
      const d = coastSd(x, z);
      if (d < 0) return Math.max(-1.1, d * 0.45) - 0.06;
      const pt = inPoly(PORTUGAL, x, z);
      let m = 0;
      for (const r of RANGES) m += rangeAt(r, x, z);
      m *= 1 - 0.82 * Math.exp(-((roadDistAt(x, z, 3) / 0.7) ** 2));
      let h = plainAt(x, z, d, pt) + m;
      for (const fl of FLATS) {
        const fd = Math.hypot(x - fl.x, z - fl.z);
        if (fd < fl.r + 0.6) {
          const k = 1 - smooth01((fd - fl.r) / 0.6);
          h += (fl.level - h) * k;
          if (k > lastFlat) lastFlat = k;
        }
      }
      h -= 0.17 * Math.exp(-((riverDistAt(x, z, 1.2) / 0.3) ** 2));
      return h * smooth01(d / 0.5) + 0.02;
    };

    // ── the faceted ground ──
    const CELL = 0.42; const X0 = -18.8; const Z0 = -14.0; const NX = 94; const NZ = 69;
    const vCount = (NX + 1) * (NZ + 1);
    const VX = new Float32Array(vCount); const VZ = new Float32Array(vCount); const VH = new Float32Array(vCount);
    const vi = (i: number, j: number) => j * (NX + 1) + i;
    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NX; i++) {
        const edge = i === 0 || j === 0 || i === NX || j === NZ;
        const x = X0 + i * CELL + (edge ? 0 : (hash(i * 1.37, j * 2.91) - 0.5) * 0.62 * CELL);
        const z = Z0 + j * CELL + (edge ? 0 : (hash(i * 3.17 + 5.1, j * 0.73 + 1.9) - 0.5) * 0.62 * CELL);
        let h = heightAt(x, z);
        if (h > 0.06) h += (hash(i * 2.13 + 9.7, j * 4.21 + 3.3) - 0.5) * 0.08 * (1 - lastFlat);
        const k = vi(i, j);
        VX[k] = x; VZ[k] = z; VH[k] = h;
      }
    }
    const inTri = (px: number, pz: number, p0: number, p1: number, p2: number): number | null => {
      const x1 = VX[p0]; const z1 = VZ[p0]; const x2 = VX[p1]; const z2 = VZ[p1]; const x3 = VX[p2]; const z3 = VZ[p2];
      const det = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3);
      if (Math.abs(det) < 1e-9) return null;
      const l1 = ((z2 - z3) * (px - x3) + (x3 - x2) * (pz - z3)) / det;
      const l2 = ((z3 - z1) * (px - x3) + (x1 - x3) * (pz - z3)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) return null;
      return l1 * VH[p0] + l2 * VH[p1] + l3 * VH[p2];
    };
    /** The height of the actual facet under (x, z) — what objects must stand on. */
    const surfaceY = (x: number, z: number): number => {
      const ci = Math.floor((x - X0) / CELL); const cj = Math.floor((z - Z0) / CELL);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const i = ci + di; const j = cj + dj;
          if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
          const a = vi(i, j); const b = vi(i + 1, j); const c = vi(i, j + 1); const d = vi(i + 1, j + 1);
          const h = ((i + j) & 1) === 1
            ? (inTri(x, z, a, c, d) ?? inTri(x, z, a, d, b))
            : (inTri(x, z, a, c, b) ?? inTri(x, z, b, c, d));
          if (h !== null) return h;
        }
      }
      return heightAt(x, z);
    };

    const tPos: number[] = [];
    const fH: number[] = []; const fS: number[] = []; const fN: number[] = []; const fR1: number[] = []; const fR2: number[] = [];
    const fKind: number[] = []; const fPt: boolean[] = []; const fSouth: boolean[] = [];
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const a = vi(i, j); const b = vi(i + 1, j); const c = vi(i, j + 1); const d = vi(i + 1, j + 1);
        const tris = ((i + j) & 1) === 1 ? [[a, c, d], [a, d, b]] : [[a, c, b], [b, c, d]];
        for (const [p0, p1, p2] of tris) {
          if (VH[p0] < -0.05 && VH[p1] < -0.05 && VH[p2] < -0.05) continue;
          tPos.push(VX[p0], VH[p0], VZ[p0], VX[p1], VH[p1], VZ[p1], VX[p2], VH[p2], VZ[p2]);
          const ux = VX[p1] - VX[p0]; const uy = VH[p1] - VH[p0]; const uz = VZ[p1] - VZ[p0];
          const wx = VX[p2] - VX[p0]; const wy = VH[p2] - VH[p0]; const wz = VZ[p2] - VZ[p0];
          const nx = uy * wz - uz * wy; const ny = uz * wx - ux * wz; const nz = ux * wy - uy * wx;
          const slope = 1 - Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
          const cx = (VX[p0] + VX[p1] + VX[p2]) / 3; const cz = (VZ[p0] + VZ[p1] + VZ[p2]) / 3;
          const ch = (VH[p0] + VH[p1] + VH[p2]) / 3;
          const dC = coastSd(cx, cz);
          const lake = LAKES.some((l) => Math.hypot(cx - l.x, cz - l.z) < l.r);
          fH.push(ch); fS.push(slope);
          fN.push(fbm(cx * 0.22 + 3.1, cz * 0.22 - 7.7));
          fR1.push(hash(cx * 7.1, cz * 3.3)); fR2.push(hash(cx * 2.3 + 1, cz * 9.1 + 2));
          fKind.push(ch < -0.01 ? 3 : lake ? 2 : dC < 0.6 && ch < 0.3 ? 1 : 0);
          fPt.push(inPoly(PORTUGAL, cx, cz)); fSouth.push(cz > 4.5);
        }
      }
    }
    const faceCount = fH.length;
    const terrainGeo = track(new THREE.BufferGeometry());
    terrainGeo.setAttribute('position', new THREE.Float32BufferAttribute(tPos, 3));
    // two colour sets: the land shows one while the next season is painted into the other
    const colA = new Float32Array(faceCount * 9);
    const colB = new Float32Array(faceCount * 9);
    const colAttr = new THREE.BufferAttribute(colA, 3);
    const colToAttr = new THREE.BufferAttribute(colB, 3);
    terrainGeo.setAttribute('color', colAttr);
    terrainGeo.setAttribute('colorTo', colToAttr);
    terrainGeo.computeVertexNormals();
    const terrain = new THREE.Mesh(terrainGeo, M.terrain);
    terrain.castShadow = true;
    terrain.receiveShadow = true;
    scene.add(terrain);

    const cTmp = new THREE.Color();
    const faceColor = (fi: number, pal: Pal, out: THREE.Color) => {
      const kind = fKind[fi];
      if (kind === 2) out.setHex(pal.water[fR1[fi] < 0.5 ? 0 : 1]);
      else if (kind === 3) out.setHex(pal.seabed);
      else if (kind === 1) out.setHex(pal.beach);
      else {
        const h = fH[fi]; const nz = fN[fi];
        if (h > pal.snowLine + (nz - 0.45) * 0.6) out.setHex(pal.snow[fR1[fi] < 0.6 ? 0 : 1]);
        else if (fS[fi] > 0.45 || h > pal.rockLine + (nz - 0.45) * 0.5) {
          const k = fR1[fi];
          out.setHex(pal.rock[k < 0.45 ? 0 : k < 0.85 ? 1 : 2]);
        } else if ((fSouth[fi] || fPt[fi]) && fR2[fi] < 0.2) out.setHex(pal.olive);
        else {
          const tt = Math.min(0.999, Math.max(0, nz * 1.05 + fR1[fi] * 0.22 - 0.12));
          out.setHex(pal.fields[Math.floor(tt * pal.fields.length)]);
        }
      }
      if (fPt[fi] && kind !== 2) {
        const l = out.r * 0.3 + out.g * 0.59 + out.b * 0.11;
        out.r += (l - out.r) * 0.35; out.g += (l - out.g) * 0.35; out.b += (l - out.b) * 0.35;
        out.multiplyScalar(1.03);
      }
      return out;
    };
    const fillColors = (pal: Pal, into: Float32Array, from = 0, to = faceCount) => {
      for (let fi = from; fi < to; fi++) {
        faceColor(fi, pal, cTmp);
        for (let k = 0; k < 3; k++) { into[fi * 9 + k * 3] = cTmp.r; into[fi * 9 + k * 3 + 1] = cTmp.g; into[fi * 9 + k * 3 + 2] = cTmp.b; }
      }
    };

    // ── the sea: faceted, breathing, turquoise at the coast to deep blue ──
    const wGeo = track(new THREE.PlaneGeometry(90, 76, 90, 76));
    const wp = wGeo.attributes.position as THREE.BufferAttribute;
    const wCol = new Float32Array(wp.count * 3);
    const cTurq = new THREE.Color(0x45d1e2); const cMid = new THREE.Color(0x2a8fea); const cDeep = new THREE.Color(0x1554da);
    for (let k = 0; k < wp.count; k++) {
      let lx = wp.getX(k); let ly = wp.getY(k);
      if (Math.abs(lx) < 44.9 && Math.abs(ly) < 37.9) {
        lx += (hash(k * 0.37, 1.7) - 0.5) * 0.55;
        ly += (hash(2.3, k * 0.61) - 0.5) * 0.55;
        wp.setXY(k, lx, ly);
      }
      const t = smooth01(-coastSd(lx + 1, -ly + 0.5) / 3.4);
      cTmp.copy(cTurq).lerp(cMid, smooth01(t * 2)).lerp(cDeep, smooth01(t * 2 - 1));
      wCol[k * 3] = cTmp.r; wCol[k * 3 + 1] = cTmp.g; wCol[k * 3 + 2] = cTmp.b;
    }
    wGeo.setAttribute('color', new THREE.BufferAttribute(wCol, 3));
    const sea = new THREE.Mesh(wGeo, M.water);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(1, 0, 0.5);
    sea.receiveShadow = true;
    scene.add(sea);

    // ── roads: cream ribbons draped on the facets, plus flowing route dashes ──
    const dashTex = canvasTex(64, 16, (g) => { g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(4, 4, 30, 8, 4); g.fill(); });
    dashTex.wrapS = THREE.RepeatWrapping;
    const ribbon = (curve: THREE.CatmullRomCurve3, width: number, lift: number, material: THREE.Material): THREE.Mesh => {
      const len = curve.getLength();
      const k = Math.max(2, Math.ceil(len / 0.07));
      const pos = new Float32Array((k + 1) * 6); const uv = new Float32Array((k + 1) * 4);
      const idx: number[] = [];
      const P = new THREE.Vector3(); const T = new THREE.Vector3();
      for (let s = 0; s <= k; s++) {
        const u = s / k;
        curve.getPointAt(u, P); curve.getTangentAt(u, T);
        const nl = Math.hypot(T.x, T.z) || 1;
        const ox = (-T.z / nl) * (width / 2); const oz = (T.x / nl) * (width / 2);
        const ax = P.x + ox; const az = P.z + oz; const bx = P.x - ox; const bz = P.z - oz;
        pos.set([ax, surfaceY(ax, az) + lift, az, bx, surfaceY(bx, bz) + lift, bz], s * 6);
        uv.set([(u * len) / 0.42, 0, (u * len) / 0.42, 1], s * 4);
        if (s < k) { const q = s * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
      }
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, material);
      mesh.receiveShadow = true;
      return mesh;
    };
    const overlays: Array<{ key: string; mat: THREE.MeshBasicMaterial; mesh: THREE.Mesh }> = [];
    // every road is one mesh: a dozen ribbons, one draw
    const batch = (meshes: THREE.Mesh[], material: THREE.Material): THREE.Mesh => {
      const merged = track(mergeGeometries(meshes.map((m) => m.geometry as THREE.BufferGeometry), false));
      const mesh = new THREE.Mesh(merged, material);
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    };
    const roadRibbons: THREE.Mesh[] = [];
    Object.entries(roadCurves).forEach(([key, curve]) => {
      roadRibbons.push(ribbon(curve, key === 'street' ? 0.1 : 0.14, 0.03, M.road));
      if (key === 'street') return;
      const om = track(new THREE.MeshBasicMaterial({ map: dashTex, color: 0x2f6bff, transparent: true, opacity: 0, depthWrite: false }));
      const o = ribbon(curve, 0.055, 0.045, om);
      o.receiveShadow = false;
      o.renderOrder = 2;
      o.visible = false;
      scene.add(o);
      overlays.push({ key, mat: om, mesh: o });
    });
    batch(roadRibbons, M.road);
    const riverMat = mat(0x35c6dc, { roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    batch(RIVERS.map((r) => ribbon(curveOf(r), 0.085, 0.02, riverMat)), riverMat);

    // ── placement bookkeeping ──
    // small claims live in a spatial hash; the few big ones (depot, shops) in a list
    const BUCKET = 0.25;
    const buckets = new Map<number, number[]>();
    const bigClaims: number[] = [];
    const bkey = (i: number, j: number) => i * 10007 + j;
    const free = (x: number, z: number, gap: number) => {
      for (let i = 0; i < bigClaims.length; i += 3) {
        const dx = bigClaims[i] - x; const dz = bigClaims[i + 1] - z; const r = bigClaims[i + 2] + gap;
        if (dx * dx + dz * dz < r * r) return false;
      }
      const ci = Math.floor(x / BUCKET); const cj = Math.floor(z / BUCKET);
      const reach = Math.ceil((0.2 + gap) / BUCKET);
      for (let di = -reach; di <= reach; di++) {
        for (let dj = -reach; dj <= reach; dj++) {
          const b = buckets.get(bkey(ci + di, cj + dj));
          if (!b) continue;
          for (let i = 0; i < b.length; i += 3) {
            const dx = b[i] - x; const dz = b[i + 1] - z; const r = b[i + 2] + gap;
            if (dx * dx + dz * dz < r * r) return false;
          }
        }
      }
      return true;
    };
    const claim = (x: number, z: number, r: number) => {
      if (r > 0.2) { bigClaims.push(x, z, r); return; }
      const k = bkey(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
      const b = buckets.get(k);
      if (b) b.push(x, z, r); else buckets.set(k, [x, z, r]);
    };
    claim(DEPOT.x, DEPOT.z, 0.62);
    SHOPS.forEach(([x, z]) => claim(x, z, 0.16));
    claim(BUYER.x, BUYER.z, 0.24);
    const groundOk = (x: number, z: number) => coastSd(x, z) > 0.18 && roadDistAt(x, z, 1) > 0.1 && riverDistAt(x, z, 1) > 0.17 && !LAKES.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 0.12);

    // ── buildings: walls + gable roofs (+ windows that glow at night), instanced ──
    const prismGeo = track(new THREE.CylinderGeometry(0.5, 0.5, 1, 3));
    prismGeo.rotateZ(Math.PI / 2); prismGeo.rotateX(-Math.PI / 2); prismGeo.translate(0, 0.25, 0);
    const boxGeo = track(new THREE.BoxGeometry(1, 1, 1));
    const walls = new THREE.InstancedMesh(boxGeo, M.wall, 520);
    const roofs = new THREE.InstancedMesh(prismGeo, M.roof, 380);
    const wins = new THREE.InstancedMesh(boxGeo, M.window, 260);
    let nWall = 0; let nRoof = 0; let nWin = 0;
    const mtx = new THREE.Matrix4(); const qtn = new THREE.Quaternion(); const scl = new THREE.Vector3(); const pv = new THREE.Vector3();
    const YAXIS = new THREE.Vector3(0, 1, 0);
    const WALL_C = [0xf7f1e6, 0xf2e7d2, 0xeadbc2, 0xffffff, 0xf4ece0];
    const ROOF_C = [0xc9643c, 0xb9573a, 0xd4744a, 0xbf5f3f];
    const addBuilding = (x: number, z: number, w: number, h: number, d: number, yaw: number, gable: boolean, lit: boolean) => {
      const y = surfaceY(x, z) - 0.01;
      qtn.setFromAxisAngle(YAXIS, yaw);
      if (nWall < 520) {
        walls.setMatrixAt(nWall, mtx.compose(pv.set(x, y + h / 2, z), qtn, scl.set(w, h, d)));
        walls.setColorAt(nWall, cTmp.setHex(WALL_C[Math.floor(hash(x * 3.1, z * 1.7) * WALL_C.length)]));
        nWall++;
      }
      if (gable && nRoof < 380) {
        roofs.setMatrixAt(nRoof, mtx.compose(pv.set(x, y + h, z), qtn, scl.set(w * 1.1, (Math.min(w, d) * 0.55) / 0.75, (d * 1.12) / 0.866)));
        roofs.setColorAt(nRoof, cTmp.setHex(ROOF_C[Math.floor(hash(x * 1.9, z * 4.3) * ROOF_C.length)]));
        nRoof++;
      }
      if (lit && nWin < 258) {
        const s = Math.sin(yaw); const c = Math.cos(yaw);
        for (const fy of [0.35, 0.7]) {
          const wy = y + h * fy;
          wins.setMatrixAt(nWin++, mtx.compose(pv.set(x + s * (d / 2 + 0.004), wy, z + c * (d / 2 + 0.004)), qtn, scl.set(w * 0.5, 0.018, 0.006)));
        }
      }
    };
    for (const c of CITIES) {
      claim(c.x, c.z, 0.02);
      let made = 0; let tries = 0;
      while (made < c.n && tries < 500) {
        tries++;
        const a = rnd() * Math.PI * 2; const rr = Math.sqrt(rnd()) * c.r;
        const x = c.x + Math.cos(a) * rr; const z = c.z + Math.sin(a) * rr;
        if (!groundOk(x, z) || !free(x, z, 0.035)) continue;
        const central = 1 - rr / c.r;
        const tall = rnd() < 0.4 * central + 0.08;
        const w = 0.075 + rnd() * 0.06; const d = 0.075 + rnd() * 0.06;
        const h = tall ? 0.15 + rnd() * c.tall * (0.5 + central * 0.5) : 0.065 + rnd() * 0.06;
        addBuilding(x, z, w, h, d, (rnd() - 0.5) * 0.5, !tall && rnd() < 0.8, tall || rnd() < 0.3);
        claim(x, z, Math.max(w, d) * 0.55);
        made++;
      }
    }
    // villages: little white houses with terracotta roofs, never far from a road
    for (let v = 0, tries = 0; v < 36 && tries < 3000; tries++) {
      const x = -15 + rnd() * 31; const z = -12 + rnd() * 24;
      const d = coastSd(x, z);
      if (d < 0.5) continue;
      const h = surfaceY(x, z);
      const rd = roadDistAt(x, z, 3);
      if (h < 0.3 || h > 1.25 || rd < 0.25 || rd > 1.8 || !groundOk(x, z)) continue;
      if (CITIES.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 0.8) || !free(x, z, 0.4)) continue;
      const count = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < count; k++) {
        const hx = x + (rnd() - 0.5) * 0.5; const hz = z + (rnd() - 0.5) * 0.5;
        if (!groundOk(hx, hz) || !free(hx, hz, 0.03)) continue;
        const w = 0.07 + rnd() * 0.04;
        addBuilding(hx, hz, w, 0.05 + rnd() * 0.035, 0.065 + rnd() * 0.03, rnd() * Math.PI, true, rnd() < 0.25);
        claim(hx, hz, w * 0.6);
      }
      v++;
    }
    walls.count = nWall; roofs.count = nRoof; wins.count = nWin;
    [walls, roofs].forEach((im) => { im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; scene.add(im); });
    wins.instanceMatrix.needsUpdate = true;
    scene.add(wins);

    // landmarks — every static piece is collected and later baked into ONE mesh (bakeStatics)
    const statics: THREE.Mesh[] = [];
    const solid = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.rotation.y = ry;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      statics.push(mesh);
      return mesh;
    };
    const coneGeo6 = track(new THREE.ConeGeometry(0.5, 1, 6));
    const icoGeo = track(new THREE.IcosahedronGeometry(0.5, 0));
    for (let k = 0; k < 3; k++) {
      const x = -1.95 + k * 0.13; const z = -1.92 - k * 0.03;
      solid(boxGeo, M.tower, x, surfaceY(x, z) + 0.31, z, 0.065, 0.62 + k * 0.04, 0.065);
    }
    {
      const x = 12.7; const z = -4.3; const y = surfaceY(x, z);
      solid(boxGeo, M.cream, x, y + 0.08, z, 0.16, 0.16, 0.1);
      for (let k = 0; k < 4; k++) solid(coneGeo6, M.cream, x - 0.06 + (k % 2) * 0.12, y + 0.26, z - 0.03 + Math.floor(k / 2) * 0.06, 0.035, 0.36, 0.035);
      const sx = -7.6; const sz = 8.7; const sy = surfaceY(sx, sz);
      solid(boxGeo, M.cream, sx, sy + 0.17, sz, 0.06, 0.34, 0.06);
      solid(coneGeo6, M.cream, sx, sy + 0.38, sz, 0.05, 0.08, 0.05);
      const vx = 6.75; const vz = 2.05;
      solid(icoGeo, M.cream, vx, surfaceY(vx, vz) + 0.02, vz, 0.42, 0.12, 0.16, 0.4);
    }

    // ── trees: autumn cones and round canopies, in clusters ──
    const coneTop = track(new THREE.ConeGeometry(0.07, 0.22, 6)); coneTop.translate(0, 0.145, 0);
    const ballTop = track(new THREE.IcosahedronGeometry(0.08, 0)); ballTop.translate(0, 0.12, 0);
    const trunkGeo = track(new THREE.CylinderGeometry(0.011, 0.015, 0.05, 5)); trunkGeo.translate(0, 0.025, 0);
    const TREES = 980;
    const cones = new THREE.InstancedMesh(coneTop, M.tree, TREES);
    const balls = new THREE.InstancedMesh(ballTop, M.tree, TREES);
    const trunks = new THREE.InstancedMesh(trunkGeo, M.trunk, TREES * 2);
    let nCone = 0; let nBall = 0; let nTrunk = 0;
    const coneSeed: number[] = []; const ballSeed: number[] = [];
    const addTree = (x: number, z: number, s: number) => {
      const y = surfaceY(x, z) - 0.01;
      qtn.setFromAxisAngle(YAXIS, rnd() * Math.PI);
      const isCone = rnd() < 0.58;
      if (isCone && nCone < TREES) { cones.setMatrixAt(nCone++, mtx.compose(pv.set(x, y, z), qtn, scl.set(s, s * (0.9 + rnd() * 0.5), s))); coneSeed.push(rnd()); }
      else if (!isCone && nBall < TREES) { balls.setMatrixAt(nBall++, mtx.compose(pv.set(x, y, z), qtn, scl.set(s, s, s))); ballSeed.push(rnd()); }
      if (nTrunk < TREES * 2) trunks.setMatrixAt(nTrunk++, mtx.compose(pv.set(x, y, z), qtn, scl.set(s, s, s)));
    };
    const treeOk = (x: number, z: number) => {
      if (!groundOk(x, z) || coastSd(x, z) < 0.3 || roadDistAt(x, z, 1) < 0.16) return false;
      const h = surfaceY(x, z);
      if (h < 0.22 || h > 1.95) return false;
      const gx = surfaceY(x + 0.12, z) - surfaceY(x - 0.12, z); const gz = surfaceY(x, z + 0.12) - surfaceY(x, z - 0.12);
      return Math.hypot(gx, gz) < 0.32;
    };
    for (let cl = 0, tries = 0; cl < 110 && tries < 6000; tries++) {
      const x = -16 + rnd() * 33; const z = -12.5 + rnd() * 25;
      if (fbm(x * 0.4 + 20, z * 0.4 - 13) < 0.4 || !treeOk(x, z)) continue;
      if (CITIES.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 0.25)) continue;
      const count = 5 + Math.floor(rnd() * 8);
      for (let k = 0; k < count; k++) {
        const tx = x + (rnd() - 0.5) * 0.85; const tz = z + (rnd() - 0.5) * 0.85;
        if (!treeOk(tx, tz) || !free(tx, tz, 0.035)) continue;
        addTree(tx, tz, 0.85 + rnd() * 0.55);
        claim(tx, tz, 0.035);
      }
      cl++;
    }
    // a little green around the places the story visits
    for (const [x, z] of [[-0.05, -0.25], [-0.25, -1.05], [-1.35, -0.95], [-2.2, -1.0], [-3.75, -0.85], [6.15, 2.55], [5.35, 2.7], [6.25, 1.95]] as P2[]) {
      for (let k = 0; k < 4; k++) {
        const tx = x + (rnd() - 0.5) * 0.35; const tz = z + (rnd() - 0.5) * 0.35;
        if (groundOk(tx, tz) && free(tx, tz, 0.03)) { addTree(tx, tz, 0.9 + rnd() * 0.4); claim(tx, tz, 0.03); }
      }
    }
    cones.count = nCone; balls.count = nBall; trunks.count = nTrunk;
    [cones, balls, trunks].forEach((im) => { im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; scene.add(im); });
    const coneA = new Float32Array(Math.max(1, nCone) * 3); const coneB = new Float32Array(coneA.length);
    const ballA = new Float32Array(Math.max(1, nBall) * 3); const ballB = new Float32Array(ballA.length);
    const coneAttr = new THREE.InstancedBufferAttribute(coneA, 3); const coneToAttr = new THREE.InstancedBufferAttribute(coneB, 3);
    const ballAttr = new THREE.InstancedBufferAttribute(ballA, 3); const ballToAttr = new THREE.InstancedBufferAttribute(ballB, 3);
    cones.instanceColor = coneAttr; balls.instanceColor = ballAttr;
    coneTop.setAttribute('instanceColorTo', coneToAttr); ballTop.setAttribute('instanceColorTo', ballToAttr);
    const fillTrees = (pal: Pal, intoCone: Float32Array, intoBall: Float32Array) => {
      for (let k = 0; k < nCone; k++) { cTmp.setHex(pal.cone[Math.floor(coneSeed[k] * pal.cone.length)]); intoCone.set([cTmp.r, cTmp.g, cTmp.b], k * 3); }
      for (let k = 0; k < nBall; k++) { cTmp.setHex(pal.ball[Math.floor(ballSeed[k] * pal.ball.length)]); intoBall.set([cTmp.r, cTmp.g, cTmp.b], k * 3); }
    };

    // ── the depot: Cesto blue, the logo on its roof, three docks ──
    const depotY = surfaceY(DEPOT.x, DEPOT.z);
    solid(boxGeo, M.depot, DEPOT.x, depotY + 0.11, DEPOT.z, 0.95, 0.22, 0.55);
    const roofTex = canvasTex(512, 256, (g) => {
      g.fillStyle = '#F2F5FF'; g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#0A47CE'; g.font = '800 150px "DM Sans", Outfit, system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(words.brand, 236, 136);
      g.fillStyle = '#53C97B'; g.beginPath(); g.arc(418, 70, 22, 0, 7); g.fill();
      g.fillStyle = '#2E9E54'; g.beginPath(); g.arc(447, 99, 16, 0, 7); g.fill();
    });
    const roofTop = lite ? new THREE.MeshLambertMaterial({ map: roofTex }) : new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.8 });
    const roofSlab = new THREE.Mesh(boxGeo, [M.cream, M.cream, track(roofTop), M.cream, M.cream, M.cream]);
    roofSlab.position.set(DEPOT.x, depotY + 0.237, DEPOT.z);
    roofSlab.scale.set(0.99, 0.035, 0.59);
    roofSlab.castShadow = true;
    scene.add(roofSlab);
    solid(boxGeo, M.apron, DEPOT.x, depotY + 0.006, DEPOT.z + 0.47, 1.15, 0.012, 0.42);
    const DOCKS = [-0.3, 0, 0.3].map((dx) => ({ x: DEPOT.x + dx, z: DEPOT.z + 0.277 }));
    DOCKS.forEach((dk) => solid(boxGeo, M.dock, dk.x, depotY + 0.07, dk.z, 0.16, 0.13, 0.008));

    // ── partner shops along a Madrid street ──
    const shopDoors: P2[] = [];
    SHOPS.forEach(([x, z], k) => {
      const y = surfaceY(x, z);
      solid(boxGeo, M.shopWall, x, y + 0.065, z, 0.2, 0.13, 0.16);
      const aw = solid(boxGeo, M.awnings[k], x, y + 0.115, z + 0.1, 0.21, 0.012, 0.07);
      aw.rotation.x = 0.35;
      solid(boxGeo, M.dock, x + 0.05, y + 0.04, z + 0.081, 0.05, 0.08, 0.004);
      shopDoors.push([x + 0.05, z + 0.12]);
    });

    // ── the buyer's shop at the edge of Valencia ──
    const by = surfaceY(BUYER.x, BUYER.z);
    const fx = Math.sin(BUYER.yaw); const fz = Math.cos(BUYER.yaw);
    solid(boxGeo, M.shopWall, BUYER.x, by + 0.075, BUYER.z, 0.26, 0.15, 0.2, BUYER.yaw);
    const bAw = solid(boxGeo, M.awnings[0], BUYER.x + fx * 0.125, by + 0.13, BUYER.z + fz * 0.125, 0.27, 0.012, 0.08, BUYER.yaw);
    bAw.rotateX(0.35);
    solid(boxGeo, M.dock, BUYER.x + fx * 0.101 - fz * 0.06, by + 0.045, BUYER.z + fz * 0.101 + fx * 0.06, 0.055, 0.09, 0.004, BUYER.yaw);
    for (const side of [-1, 1]) {
      const px = BUYER.x + fx * 0.14 + Math.cos(BUYER.yaw) * side * 0.15; const pz = BUYER.z + fz * 0.14 - Math.sin(BUYER.yaw) * side * 0.15;
      solid(icoGeo, M.plant, px, surfaceY(px, pz) + 0.03, pz, 0.07, 0.07, 0.07);
    }
    const doorX = BUYER.x + fx * 0.19 - fz * 0.06; const doorZ = BUYER.z + fz * 0.19 + fx * 0.06;

    // bake: ~40 little meshes (towers, landmarks, depot, docks, shops, awnings, plants) → one draw
    {
      const parts: THREE.BufferGeometry[] = [];
      for (const m of statics) {
        m.updateMatrixWorld(true);
        const src = (m.geometry as THREE.BufferGeometry).clone();
        const g = src.index ? src.toNonIndexed() : src;
        if (g !== src) src.dispose();
        g.deleteAttribute('uv');
        g.applyMatrix4(m.matrixWorld);
        const c = (m.material as THREE.MeshStandardMaterial).color;
        const col = new Float32Array(g.attributes.position.count * 3);
        for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        parts.push(g);
        scene.remove(m);
      }
      const baked = new THREE.Mesh(track(mergeGeometries(parts, false)), M.statics);
      parts.forEach((g) => g.dispose());
      baked.castShadow = true;
      baked.receiveShadow = true;
      scene.add(baked);
    }

    // ── vans: a proper low-poly delivery van (2026-11-01, user: "the vans are very absurd… use some
    //    better vans and design them better with cesto logo on them"). One extruded body — raked
    //    windshield, sloped hood, real wheel arches — with round wheels, hubs, bumpers and mirrors
    //    (vertex-coloured), and a skin for the brand: the cesto wordmark and leaf on both sides and
    //    big on the roof (what the bird's-eye camera sees most), cab glass, headlights and grille,
    //    rear doors and tail lights — all from ONE small texture atlas. The whole fleet stays two
    //    instanced draws. Local axes: +z forward, +y up; 0.30 long, 0.10 wide, 0.13 tall.
    const vanParts: THREE.BufferGeometry[] = [];
    const vanPart = (g: THREE.BufferGeometry, hex: number) => {
      const src = g.index ? g.toNonIndexed() : g;
      if (src !== g) g.dispose();
      src.deleteAttribute('uv');
      cTmp.setHex(hex);
      const col = new Float32Array(src.attributes.position.count * 3);
      for (let i = 0; i < col.length; i += 3) { col[i] = cTmp.r; col[i + 1] = cTmp.g; col[i + 2] = cTmp.b; }
      src.setAttribute('color', new THREE.BufferAttribute(col, 3));
      vanParts.push(src);
    };
    {
      // the side profile, rear to front over the roof, then back along the arched bottom
      const shape = new THREE.Shape();
      shape.moveTo(-0.15, 0.016);
      shape.lineTo(-0.15, 0.128);
      shape.lineTo(0.06, 0.128);
      shape.quadraticCurveTo(0.072, 0.128, 0.077, 0.121);
      shape.lineTo(0.113, 0.076);
      shape.lineTo(0.141, 0.066);
      shape.quadraticCurveTo(0.151, 0.063, 0.151, 0.052);
      shape.lineTo(0.151, 0.018);
      shape.lineTo(0.128, 0.016);
      shape.absarc(0.098, 0.02, 0.029, 0, Math.PI, false);
      shape.lineTo(-0.061, 0.016);
      shape.absarc(-0.09, 0.02, 0.029, 0, Math.PI, false);
      shape.lineTo(-0.15, 0.016);
      const body = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 1, curveSegments: 6 });
      body.rotateY(-Math.PI / 2); // profile x → van z, extrusion → van x
      body.translate(0.045, 0, 0); // centred: the sides at x = ±0.05
      vanPart(body, 0xf7f9ff);
      for (const wz of [0.098, -0.09]) {
        for (const wx of [-0.046, 0.046]) {
          const tire = new THREE.CylinderGeometry(0.021, 0.021, 0.016, 10);
          tire.rotateZ(Math.PI / 2);
          tire.translate(wx, 0.021, wz);
          vanPart(tire, 0x1d2333);
          const hub = new THREE.CylinderGeometry(0.0095, 0.0095, 0.018, 8);
          hub.rotateZ(Math.PI / 2);
          hub.translate(wx, 0.021, wz);
          vanPart(hub, 0xc9d2e3);
        }
      }
      for (const bz of [0.154, -0.154]) {
        const bumper = new THREE.BoxGeometry(0.102, 0.01, 0.009);
        bumper.translate(0, 0.021, bz);
        vanPart(bumper, 0x4a5368);
      }
      for (const sx of [-0.0555, 0.0555]) {
        const mirror = new THREE.BoxGeometry(0.0055, 0.012, 0.008); // at the windshield pillar
        mirror.translate(sx, 0.106, 0.084);
        vanPart(mirror, 0x4a5368);
      }
    }
    const vanGeo = track(mergeGeometries(vanParts, false));
    vanParts.forEach((g) => g.dispose());

    // the skin atlas: [x, y, w, h] in canvas px
    const SKIN_W = 512; const SKIN_H = 1024;
    const SKIN = {
      sideL: [0, 0, 512, 139], sideR: [0, 150, 512, 139], roof: [0, 300, 512, 229],
      glass: [0, 540, 128, 96], front: [140, 540, 320, 100], back: [0, 650, 184, 200],
    } as const;
    const vanSkinTex = canvasTex(SKIN_W, SKIN_H, (g) => {
      const WHITE = '#F7F9FF'; const STRIPE = '#1E5EF0';
      const word = (x: number, y: number, size: number) => {
        g.fillStyle = '#0A47CE'; g.font = `800 ${size}px "DM Sans", Outfit, system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(words.brand, x, y);
        // the leaf, up and to the right of the word, as on the depot's roof
        const w = g.measureText(words.brand).width;
        g.fillStyle = '#53C97B'; g.beginPath(); g.arc(x + w / 2 + size * 0.1, y - size * 0.34, size * 0.13, 0, 7); g.fill();
        g.fillStyle = '#2E9E54'; g.beginPath(); g.arc(x + w / 2 + size * 0.26, y - size * 0.17, size * 0.095, 0, 7); g.fill();
      };
      const side = ([x0, y0, w, h]: readonly number[], frontAtLeft: boolean) => {
        g.fillStyle = WHITE; g.fillRect(x0, y0, w, h);
        g.fillStyle = STRIPE; g.fillRect(x0, y0 + h - 18, w, 18); // the blue stripe…
        g.fillStyle = '#4CBB6C'; g.fillRect(x0, y0 + h - 22, w, 3); // …with a fine green line over it
        const seam = frontAtLeft ? x0 + w * 0.37 : x0 + w * 0.63; // the sliding door, behind the cab
        g.fillStyle = '#DCE2EE'; g.fillRect(seam - 1, y0 + 6, 2, h - 30);
        word(frontAtLeft ? x0 + w * 0.6 : x0 + w * 0.4, y0 + h * 0.42, 70);
      };
      side(SKIN.sideL, true);
      side(SKIN.sideR, false);
      {
        const [x0, y0, w, h] = SKIN.roof;
        g.fillStyle = WHITE; g.fillRect(x0, y0, w, h);
        g.strokeStyle = '#E3E8F3'; g.lineWidth = 6; g.strokeRect(x0 + 10, y0 + 10, w - 20, h - 20);
        word(x0 + w / 2 - 20, y0 + h / 2 + 8, 132);
      }
      {
        const [x0, y0, w, h] = SKIN.glass;
        const grad = g.createLinearGradient(x0, y0, x0 + w, y0 + h);
        grad.addColorStop(0, '#2A4583'); grad.addColorStop(0.55, '#15234D'); grad.addColorStop(1, '#0F1A3C');
        g.fillStyle = grad; g.fillRect(x0, y0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.16)'; // a glint
        g.beginPath(); g.moveTo(x0 + w * 0.2, y0); g.lineTo(x0 + w * 0.42, y0); g.lineTo(x0 + w * 0.22, y0 + h); g.lineTo(x0, y0 + h); g.fill();
      }
      {
        const [x0, y0, w, h] = SKIN.front;
        g.fillStyle = WHITE; g.fillRect(x0, y0, w, h);
        g.fillStyle = '#2A3348'; g.beginPath(); g.roundRect(x0 + w * 0.3, y0 + h * 0.2, w * 0.4, h * 0.5, 10); g.fill(); // grille
        g.fillStyle = '#FFF4CC';
        g.beginPath(); g.roundRect(x0 + 8, y0 + h * 0.18, w * 0.2, h * 0.34, 8); g.fill();
        g.beginPath(); g.roundRect(x0 + w - 8 - w * 0.2, y0 + h * 0.18, w * 0.2, h * 0.34, 8); g.fill();
        g.fillStyle = STRIPE; g.beginPath(); g.arc(x0 + w / 2, y0 + h * 0.45, h * 0.13, 0, 7); g.fill(); // badge
        g.fillStyle = STRIPE; g.fillRect(x0, y0 + h - 12, w, 12);
      }
      {
        const [x0, y0, w, h] = SKIN.back;
        g.fillStyle = WHITE; g.fillRect(x0, y0, w, h);
        g.fillStyle = '#DCE2EE'; g.fillRect(x0 + w / 2 - 1, y0 + 8, 2, h - 30); // the doors' split
        g.fillStyle = '#E8584A'; g.fillRect(x0 + 6, y0 + h * 0.5, 12, h * 0.3); g.fillRect(x0 + w - 18, y0 + h * 0.5, 12, h * 0.3); // tail lights
        word(x0 + w / 2 - 8, y0 + h * 0.27, 36);
        g.fillStyle = STRIPE; g.fillRect(x0, y0 + h - 14, w, 14); // the stripe wraps round
      }
    });
    const uvTo = (geo: THREE.BufferGeometry, [x, y, w, h]: readonly number[]) => {
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      const u0 = (x + 0.5) / SKIN_W; const u1 = (x + w - 0.5) / SKIN_W;
      const v0 = 1 - (y + h - 0.5) / SKIN_H; const v1 = 1 - (y + 0.5) / SKIN_H;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      return geo;
    };
    // a cab side window: a trapezoid under the windshield's rake, wound to face outward on its side
    const cabWindow = (side: 1 | -1) => {
      const x = side * 0.0515;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([x, 0.082, 0.058, x, 0.118, 0.058, x, 0.118, 0.076, x, 0.082, 0.104], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
      geo.setIndex(side === 1 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
      geo.computeVertexNormals();
      return uvTo(geo, SKIN.glass);
    };
    const skinParts = [
      uvTo(new THREE.PlaneGeometry(0.199, 0.054).rotateY(Math.PI / 2).translate(0.0515, 0.097, -0.0455), SKIN.sideL),
      uvTo(new THREE.PlaneGeometry(0.199, 0.054).rotateY(-Math.PI / 2).translate(-0.0515, 0.097, -0.0455), SKIN.sideR),
      uvTo(new THREE.PlaneGeometry(0.197, 0.088).rotateX(-Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.1335, -0.0435), SKIN.roof),
      uvTo(new THREE.PlaneGeometry(0.086, 0.05).rotateX(-Math.atan2(0.036, 0.045)).translate(0, 0.1019, 0.0993), SKIN.glass),
      uvTo(new THREE.PlaneGeometry(0.092, 0.03).translate(0, 0.035, 0.1565), SKIN.front),
      uvTo(new THREE.PlaneGeometry(0.092, 0.104).rotateY(Math.PI).translate(0, 0.072, -0.1555), SKIN.back),
      cabWindow(1),
      cabWindow(-1),
    ];
    const vanSkinGeo = track(mergeGeometries(skinParts, false));
    skinParts.forEach((g) => g.dispose());
    const skinOpts = { map: vanSkinTex, flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
    const skinMat = track(lite ? new THREE.MeshLambertMaterial(skinOpts) : new THREE.MeshStandardMaterial({ ...skinOpts, roughness: 0.55 }));
    focusify(skinMat);

    // the whole fleet is TWO instanced meshes (body + skin): each van is a placement, not an object
    const FLEET = 12;
    const fleet = new THREE.InstancedMesh(vanGeo, M.van, FLEET);
    const fleetSkin = new THREE.InstancedMesh(vanSkinGeo, skinMat, FLEET);
    fleet.castShadow = !staticShadows;
    fleet.receiveShadow = true; fleetSkin.receiveShadow = true;
    // the vans roam the whole map; one bounding sphere can't follow them
    fleet.frustumCulled = false; fleetSkin.frustumCulled = false;
    scene.add(fleet, fleetSkin);
    let fleetN = 0;
    const vanModel = (): THREE.Object3D => {
      const o = new THREE.Object3D();
      o.userData.vi = fleetN++;
      return o;
    };
    const placeVan = (g: THREE.Object3D, x: number, z: number, hx: number, hz: number) => {
      const hl = Math.hypot(hx, hz) || 1;
      const ux = hx / hl; const uz = hz / hl;
      // the ground under each axle sets the pitch; 0.03 is the road ribbon's own lift, so the tyres
      // sit on the tarmac (every van drives its road's exact curve)
      const yF = surfaceY(x + ux * 0.094, z + uz * 0.094); const yB = surfaceY(x - ux * 0.094, z - uz * 0.094);
      g.position.set(x, (yF + yB) / 2 + 0.03, z);
      g.rotation.set(0, Math.atan2(ux, uz), 0);
      g.rotateX(-Math.atan2(yF - yB, 0.188));
      g.updateMatrix();
      fleet.setMatrixAt(g.userData.vi as number, g.matrix);
      fleetSkin.setMatrixAt(g.userData.vi as number, g.matrix);
    };
    interface Leg { stop: boolean; u0: number; u1: number; dur: number; ping: number; start: number }
    const schedule = (curve: THREE.CatmullRomCurve3, stops: number[], speed: number) => {
      const len = curve.getLength();
      const seq = [...stops, ...stops.slice(1, -1).reverse()];
      const legs: Leg[] = [];
      let tAcc = 0;
      seq.forEach((su, k) => {
        const next = seq[(k + 1) % seq.length];
        const forward = k < stops.length - 1;
        const ping = su === 1 ? 2 : su === 0 ? 1 : forward ? 2 : 1;
        legs.push({ stop: true, u0: su, u1: su, dur: 1.1, ping, start: tAcc }); tAcc += 1.1;
        const dur = (Math.abs(next - su) * len) / speed;
        legs.push({ stop: false, u0: su, u1: next, dur, ping: 0, start: tAcc }); tAcc += dur;
      });
      return { legs, total: tAcc };
    };
    interface Runner { g: THREE.Object3D; curve: THREE.CatmullRomCurve3; legs: Leg[]; total: number; off: number; leg: number; hx: number; hz: number; hops?: P2[] }
    const runners: Runner[] = [];
    const addRunner = (key: string, stops: number[], off: number, speed = 0.9, hops?: P2[]) => {
      const curve = roadCurves[key];
      const { legs, total } = schedule(curve, stops, speed);
      runners.push({ g: vanModel(), curve, legs, total, off: off * total, leg: -1, hx: 1, hz: 0, hops });
    };
    addRunner('a1', [0, 0.5, 1], 0.2);
    addRunner('a2', [0, 0.35, 0.6, 1], 0.05);
    addRunner('a2', [0, 0.35, 0.6, 1], 0.55);
    addRunner('a3', [0, 1], 0.6);
    addRunner('a4', [0, 0.55, 1], 0.3);
    addRunner('a4', [0, 0.55, 1], 0.8);
    addRunner('a6', [0, 0.5, 1], 0.45);
    addRunner('ap7', [0, 1], 0.15);
    addRunner('a92', [0, 1], 0.7);
    // the pickup van works the shop street, stopping at each door
    const street = roadCurves.street;
    const nearestU = (x: number, z: number) => {
      let bu = 0; let bd = Infinity;
      for (let k = 0; k <= 200; k++) { street.getPointAt(k / 200, tmpV); const d = Math.hypot(tmpV.x - x, tmpV.z - z); if (d < bd) { bd = d; bu = k / 200; } }
      return bu;
    };
    addRunner('street', [0, ...shopDoors.map(([x, z]) => nearestU(x, z)), 1], 0.1, 0.35, shopDoors);
    // your order's van: docked until the road chapter, then the scroll drives it to the buyer
    const hero = vanModel();
    fleet.count = fleetN; fleetSkin.count = fleetN; // only the vans that exist — a spare would sit at the origin
    const dock1 = DOCKS[0];
    // your order's van eases off the dock onto the A-3 and then drives the road's OWN curve, so it
    // never leaves the tarmac; the ramp meets the road at the road's own heading (no kink to follow)
    const a3 = roadCurves.a3;
    const uJoin = 0.03;
    const joinPt = a3.getPointAt(uJoin, new THREE.Vector3());
    const joinTan = a3.getTangentAt(uJoin, new THREE.Vector3());
    const ramp = new THREE.QuadraticBezierCurve3(new THREE.Vector3(dock1.x, 0, dock1.z + 0.2), joinPt.clone().addScaledVector(joinTan, -0.25), joinPt);
    const rampLen = ramp.getLength(); const roadLen = (1 - uJoin) * a3.getLength();
    const heroPath = {
      getPointAt: (u: number, out: THREE.Vector3) => {
        const d = u * (rampLen + roadLen);
        return d < rampLen ? ramp.getPointAt(d / rampLen, out) : a3.getPointAt(uJoin + (1 - uJoin) * Math.min(1, (d - rampLen) / roadLen), out);
      },
      getTangentAt: (u: number, out: THREE.Vector3) => {
        const d = u * (rampLen + roadLen);
        return d < rampLen ? ramp.getTangentAt(d / rampLen, out) : a3.getTangentAt(uJoin + (1 - uJoin) * Math.min(1, (d - rampLen) / roadLen), out);
      },
    };
    const heroStart = heroPath.getTangentAt(0, new THREE.Vector3());

    // ── parcels hopping, pings on the ground ──
    const parcelGeo = track(new THREE.BoxGeometry(0.045, 0.04, 0.045));
    const hops = Array.from({ length: 10 }, () => {
      const mesh = new THREE.Mesh(parcelGeo, M.kraft);
      mesh.castShadow = !staticShadows; mesh.visible = false;
      scene.add(mesh);
      return { mesh, t0: -1, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 };
    });
    const hop = (ax: number, az: number, bx: number, bz: number, t: number) => {
      const h = hops.find((q) => q.t0 < 0);
      if (!h) return;
      Object.assign(h, { t0: t, ax, az, bx, bz, ay: surfaceY(ax, az) + 0.05, by: surfaceY(bx, bz) + 0.1 });
    };
    const ringGeo = track(new THREE.RingGeometry(0.82, 1, 36));
    const pings = Array.from({ length: 12 }, () => {
      const m = track(new THREE.MeshBasicMaterial({ color: 0x2f6bff, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
      const mesh = new THREE.Mesh(ringGeo, m);
      mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 5; mesh.visible = false;
      scene.add(mesh);
      return { mesh, m, t0: -1 };
    });
    const ping = (x: number, z: number, kind: number, t: number) => {
      const q = pings.find((r) => r.t0 < 0);
      if (!q) return;
      q.t0 = t;
      q.m.color.set(kind === 2 ? 0x22b573 : 0x2f6bff);
      q.mesh.position.set(x, surfaceY(x, z) + 0.06, z);
      q.mesh.visible = true;
    };

    // ── people: walkers in the plazas, crew, owners, hikers ──
    const bodyGeo = track(new THREE.CapsuleGeometry(0.019, 0.045, 2, 6)); bodyGeo.translate(0, 0.0415, 0);
    const headGeo = track(new THREE.IcosahedronGeometry(0.019, 1)); headGeo.translate(0, 0.105, 0);
    const PEOPLE = 64;
    const bodies = new THREE.InstancedMesh(bodyGeo, M.person, PEOPLE);
    const heads = new THREE.InstancedMesh(headGeo, M.skin, PEOPLE);
    bodies.castShadow = !staticShadows; heads.castShadow = !staticShadows;
    scene.add(bodies, heads);
    interface Person { kind: 'loop' | 'fixed' | 'trail' | 'carrier'; x: number; z: number; r: number; sp: number; ph: number; yaw: number; trail?: THREE.CatmullRomCurve3 }
    const people: Person[] = [];
    const SHIRTS = [0xf2675a, 0x2bb3a6, 0xf2b53a, 0xffffff, 0x7c6fe0, 0xe8823a, 0x3e8ef0];
    const addPerson = (pp: Person, color: number) => { bodies.setColorAt(people.length, cTmp.setHex(color)); people.push(pp); };
    for (const c of CITIES) {
      for (let k = 0; k < 4; k++) {
        const a = rnd() * Math.PI * 2; const rr = c.r * (0.3 + rnd() * 0.6);
        addPerson({ kind: 'loop', x: c.x + Math.cos(a) * rr, z: c.z + Math.sin(a) * rr, r: 0.08 + rnd() * 0.14, sp: (0.25 + rnd() * 0.25) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * 7, yaw: 0 }, SHIRTS[Math.floor(rnd() * SHIRTS.length)]);
      }
    }
    addPerson({ kind: 'fixed', x: DOCKS[1].x - 0.06, z: DOCKS[1].z + 0.12, r: 0, sp: 0, ph: 1, yaw: 0.4 }, 0x1f5bea);
    addPerson({ kind: 'fixed', x: DOCKS[2].x + 0.1, z: DOCKS[2].z + 0.16, r: 0, sp: 0, ph: 2, yaw: -0.6 }, 0x1f5bea);
    shopDoors.forEach(([x, z], k) => addPerson({ kind: 'fixed', x: x + 0.07, z: z + 0.02, r: 0, sp: 0, ph: k, yaw: 0.2 }, 0x2e9e54));
    const ownerIdx = people.length;
    addPerson({ kind: 'fixed', x: doorX + Math.cos(BUYER.yaw) * 0.08, z: doorZ - Math.sin(BUYER.yaw) * 0.08, r: 0, sp: 0, ph: 0, yaw: BUYER.yaw }, 0x2e9e54);
    addPerson({ kind: 'carrier', x: 0, z: 0, r: 0, sp: 0, ph: 0, yaw: 0 }, 0x1f5bea);
    // hikers on dotted trails, like the reference's climbers
    const dotsGeo = track(new THREE.IcosahedronGeometry(0.011, 0));
    const trailDefs: P2[][] = [[[9.4, -8.0], [9.7, -8.45], [10.05, -8.75], [10.35, -9.2]], [[-1.45, 9.15], [-1.1, 9.45], [-0.95, 9.7], [-0.72, 9.98]], [[-4.6, -9.6], [-4.35, -9.95], [-4.2, -10.25]]];
    const dots = new THREE.InstancedMesh(dotsGeo, M.dots, 200);
    let nDot = 0;
    trailDefs.forEach((td, k) => {
      const tc = curveOf(td);
      const len = tc.getLength();
      for (let s = 0; s * 0.055 < len && nDot < 200; s++) {
        tc.getPointAt((s * 0.055) / len, tmpV);
        dots.setMatrixAt(nDot++, mtx.compose(pv.set(tmpV.x, surfaceY(tmpV.x, tmpV.z) + 0.015, tmpV.z), qtn.identity(), scl.set(1, 1, 1)));
      }
      for (let h = 0; h < 3; h++) addPerson({ kind: 'trail', x: 0, z: 0, r: 0, sp: 0.022 + k * 0.004, ph: h * 0.11, yaw: 0, trail: tc }, [0xf2675a, 0x2bb3a6, 0xf2b53a][h]);
    });
    dots.count = nDot; dots.instanceMatrix.needsUpdate = true;
    scene.add(dots);
    bodies.count = people.length; heads.count = people.length;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    const carried = new THREE.Mesh(parcelGeo, M.kraft);
    carried.castShadow = !staticShadows; carried.visible = false;
    scene.add(carried);

    // ── leaves (or snow, or petals) falling past the lens ──
    const leafGeo = track(new THREE.CircleGeometry(1, 7));
    const leafMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthWrite: false }));
    const LEAVES = 90;
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, LEAVES);
    leaves.frustumCulled = false;
    leaves.renderOrder = 6;
    camera.add(leaves);
    const leafEuler = new THREE.Euler();
    const leafData = Array.from({ length: LEAVES }, () => ({ sx: rnd() * 2 - 1, sy: rnd() * 2.4 - 1.2, depth: 1.4 + rnd() * 6, sp: 0.05 + rnd() * 0.07, ph: rnd() * 7, size: 0.011 + rnd() * 0.009, spin: 1 + rnd() * 3 }));

    // ── pins: real DOM, so the type stays crisp ──
    const pinRoot = document.createElement('div');
    pinRoot.className = 'absolute inset-0 pointer-events-none overflow-hidden z-[2]';
    host.appendChild(pinRoot);
    interface Pin { el: HTMLDivElement; x: number; y: number; z: number; id: string; sx: number; sy: number; vis: boolean }
    let hoverCity = '';
    const mkPin = (text: string, variant: string, x: number, y: number, z: number, opts: { city?: string; icon?: string } = {}): Pin => {
      const el = document.createElement('div');
      el.className = `biz-pin ${variant}`;
      if (opts.city) el.dataset.city = opts.city;
      const body = document.createElement('div'); body.className = 'biz-pin-body';
      const label = document.createElement('span'); label.className = 'biz-pin-label';
      if (opts.icon) label.insertAdjacentHTML('afterbegin', opts.icon);
      label.appendChild(document.createTextNode(text));
      const stem = document.createElement('span'); stem.className = 'biz-pin-stem';
      const dot = document.createElement('span'); dot.className = 'biz-pin-dot';
      body.append(label, stem, dot);
      el.appendChild(body);
      pinRoot.appendChild(el);
      if (opts.city) {
        const id = opts.city;
        label.addEventListener('mouseenter', () => { hoverCity = id; });
        label.addEventListener('mouseleave', () => { if (hoverCity === id) hoverCity = ''; });
      }
      return { el, x, y, z, id: opts.city ?? variant, sx: 0, sy: 0, vis: false };
    };
    const cityPins = CITIES.map((c) => mkPin(c.name, 'is-city', c.x, surfaceY(c.x, c.z) + 0.05, c.z, { city: c.id }));
    const depotPin = mkPin(words.brand, 'is-brand', DEPOT.x, depotY + 0.3, DEPOT.z, { icon: LEAF_SVG });
    const storesPin = mkPin(words.stores, 'is-city', -2.95, surfaceY(-2.95, -0.7) + 0.16, -0.7);
    const shopPin = mkPin(words.shop, 'is-city', BUYER.x, by + 0.2, BUYER.z);
    const donePin = mkPin(words.delivered, 'is-done', BUYER.x, by + 0.2, BUYER.z, { icon: CHECK_SVG });
    const tagPin = mkPin(words.yourOrder, 'is-brand is-tag', 0, 0, 0);
    const priorityPins = [depotPin, storesPin, shopPin, donePin, tagPin];
    const pinRank = [tagPin, donePin, shopPin, storesPin, depotPin];
    const allPins = [...cityPins, ...priorityPins];

    // ── theme ──
    const applyTheme = () => {
      const dark = document.documentElement.getAttribute('data-sales-theme') === 'dark';
      sun.intensity = dark ? 1.1 : 2.5;
      sun.color.set(dark ? 0xc4d2ff : 0xfff0d4);
      hemi.intensity = dark ? 0.45 : 0.62;
      fillLight.intensity = lite ? (dark ? 0.7 : 1.2) : 0;
      scene.environmentIntensity = dark ? 0.2 : 0.35;
      fog.color.set(dark ? 0x172b68 : 0xd4defa);
      M.window.emissiveIntensity = dark ? 1.9 : 0;
      renderer.toneMappingExposure = (dark ? 0.95 : 1.02) * (lite ? 1.07 : 1);
    };
    applyTheme();
    const themeWatch = new MutationObserver(applyTheme);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-sales-theme'] });

    // ── seasons ──
    // the seasons turn by themselves (user, 2026-11-01: "seasons should change automatically and
    // that season pill should not be there"): each holds the land a while, then fades into the next
    const SEASON_ORDER: Season[] = ['autumn', 'winter', 'spring', 'summer'];
    const SEASON_HOLD = 8;   // seconds a season holds the land
    const SEASON_FADE = 3.5; // seconds it takes to become the next
    let season: Season = firstSeason;
    let seasonT0 = -1;
    let seasonAge = 0;
    let shown: 0 | 1 = 0; // which colour set the land shows: 0 = color/instanceColor, 1 = colorTo/instanceColorTo
    let fadeFrom = 0; let fadeTo = 0;
    const nextSeason = () => SEASON_ORDER[(SEASON_ORDER.indexOf(season) + 1) % SEASON_ORDER.length];
    // the next season is painted into the hidden set a slice per frame and uploaded once, while
    // nothing shows it — so the fade itself is just one number moving on the GPU
    let prepFor: Season | null = null; let prepAt = 0; let prepped = false;
    const PREP_SLICE = 700; // faces per frame: ~20 frames to paint the next season, light enough for a phone
    const prepStep = () => {
      const next = nextSeason();
      if (prepFor !== next) { prepFor = next; prepAt = 0; prepped = false; }
      if (prepped) return;
      const pal = PALETTES[next];
      const end = Math.min(faceCount, prepAt + PREP_SLICE);
      fillColors(pal, shown === 0 ? colB : colA, prepAt, end);
      prepAt = end;
      if (prepAt < faceCount) return;
      if (shown === 0) {
        fillTrees(pal, coneB, ballB);
        colToAttr.needsUpdate = true; coneToAttr.needsUpdate = true; ballToAttr.needsUpdate = true;
      } else {
        fillTrees(pal, coneA, ballA);
        colAttr.needsUpdate = true; coneAttr.needsUpdate = true; ballAttr.needsUpdate = true;
      }
      prepped = true;
    };
    // the falling leaves (or snow, or petals) and the rivers fade with the land
    let leafFrom = PALETTES[season]; let leafTo = PALETTES[season]; let leafMix = 1;
    const leafCol = new THREE.Color();
    const paintLeaves = () => {
      for (let k = 0; k < LEAVES; k++) {
        cTmp.setHex(leafFrom.leaf[k % leafFrom.leaf.length]);
        leafCol.setHex(leafTo.leaf[k % leafTo.leaf.length]);
        leaves.setColorAt(k, cTmp.lerp(leafCol, leafMix));
      }
      if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    };
    const riverFrom = new THREE.Color(); const riverTo = new THREE.Color();
    fillColors(PALETTES[season], colA);
    colB.set(colA);
    fillTrees(PALETTES[season], coneA, ballA);
    coneB.set(coneA); ballB.set(ballA);
    leaves.count = LEAVES; // all of them, always: the ones a season doesn't use shrink away
    paintLeaves();
    riverMat.color.setHex(PALETTES[season].water[0]);
    const startSeason = (s: Season) => {
      leafFrom = PALETTES[season]; leafTo = PALETTES[s]; leafMix = 0;
      riverFrom.copy(riverMat.color); riverTo.setHex(PALETTES[s].water[0]);
      season = s;
      fadeFrom = shown; fadeTo = shown === 0 ? 1 : 0;
      seasonT0 = performance.now();
    };

    // ── sizing ──
    let narrow = false; let W = 1; let H = 1;
    const resize = () => {
      W = host.clientWidth || 1; H = host.clientHeight || 1;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      narrow = W / H < 0.85;
      camera.fov = narrow ? 46 : 36;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // ── the mouse ──
    let mx = 0; let my = 0; let tmx = 0; let tmy = 0; let pointerIn = false;
    const glowAt = new THREE.Vector3(999, 0, 999);
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.7);
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = host.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { onLeave(); return; }
      tmx = ((e.clientX - r.left) / r.width) * 2 - 1;
      tmy = ((e.clientY - r.top) / r.height) * 2 - 1;
      ndc.set(tmx, -tmy);
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(ground, tmpV)) { glowAt.copy(tmpV); pointerIn = true; }
    };
    function onLeave() { tmx = 0; tmy = 0; pointerIn = false; }
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);

    // ── the story ──
    let latestP = 0;
    let smoothP = 0;
    let awake = true;
    let topInset = 0;
    register({
      apply: (p, snap) => { latestP = p; if (snap) smoothP = p; },
      setAwake: (on) => { awake = on; },
      setTopInset: (px) => { topInset = px; },
    });
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
    io.observe(host);

    const roadIdx = places.indexOf('road');
    const roadStartCh = roadIdx >= 0 ? roadIdx : Math.max(0, n - 2);
    interface Key { x: number; y: number; z: number; d: number; yaw: number; pitch: number; fx: number; fz: number; fr: number; fa: number; ring: number; wob: number }
    const kA: Key = { x: 0, y: 0.2, z: 0, d: 1, yaw: 0, pitch: 0, fx: 0, fz: 0, fr: 1, fa: 0, ring: 0x2f6bff, wob: 0 };
    const kB: Key = { ...kA };
    let heroX = dock1.x; let heroZ = dock1.z + 0.2; let heroHx = heroStart.x; let heroHz = heroStart.z; let heroRaw = 0;
    /** where your order's van is for a given story progress — a pure function of p */
    const heroAt = (p: number) => {
      heroRaw = seg(p, roadStartCh / n, (n - 1 + 0.35) / n);
      if (heroRaw <= 0) {
        heroX = dock1.x; heroZ = dock1.z + 0.2; heroHx = heroStart.x; heroHz = heroStart.z;
      } else {
        const hu = smooth01(heroRaw);
        heroPath.getPointAt(hu, tmpV); heroX = tmpV.x; heroZ = tmpV.z;
        heroPath.getTangentAt(Math.min(0.999, hu), tmpV); heroHx = tmpV.x; heroHz = tmpV.z;
      }
    };
    const keyFor = (pl: MapPlace, out: Key): Key => {
      out.fa = 0; out.ring = 0x2f6bff; out.wob = pl === 'wide' ? 1 : 0;
      switch (pl) {
        case 'depot': Object.assign(out, { x: DEPOT.x, z: DEPOT.z, d: 6.0, yaw: 0.5, pitch: 0.62, fx: DEPOT.x, fz: DEPOT.z, fr: 1.15, fa: 0.6 }); break;
        case 'stores': Object.assign(out, { x: -2.95, z: -0.65, d: 5.4, yaw: -0.28, pitch: 0.6, fx: -2.95, fz: -0.68, fr: 0.9, fa: 0.6 }); break;
        case 'road': Object.assign(out, { x: heroX + heroHx * 0.45, z: heroZ + heroHz * 0.45, d: 5.2, yaw: -0.95, pitch: 0.48, fx: heroX, fz: heroZ, fr: 1.5, fa: 0.55 }); break;
        case 'network': Object.assign(out, { x: 1.6, z: -0.8, d: 17.5, yaw: 0.3, pitch: 0.84, fx: 0, fz: 0, fr: 1 }); break;
        case 'south': Object.assign(out, { x: -4.4, z: 9.3, d: 10.5, yaw: -0.12, pitch: 0.62, fx: -5.6, fz: 9.5, fr: 3.6, fa: 0.35 }); break;
        case 'delivery': Object.assign(out, { x: BUYER.x - 0.35, z: BUYER.z + 0.05, d: 4.6, yaw: 0.22, pitch: 0.5, fx: BUYER.x - 0.25, fz: BUYER.z, fr: 0.95, fa: 0.6, ring: 0x22b573 }); break;
        // the whole peninsula, north coast clear of the header, Catalonia in, Algarve under the words
        default: Object.assign(out, { x: 0.6, z: 0.8, d: 37.5, yaw: 0.06, pitch: 0.98, fx: 0, fz: 0, fr: 1 });
      }
      if (narrow) {
        // a tall screen: pull back and look straight down so the whole peninsula fits its width
        if (pl === 'wide') Object.assign(out, { x: 0.6, z: 3.4, d: 74, pitch: 1.18 });
        else out.d *= 1.3;
      }
      // the camera looks at the subject's own ground — never at whatever the flight passes over
      out.y = Math.max(0.2, surfaceY(out.x, out.z));
      // frame the subject right of centre (the words live bottom-left); on phones, above them
      const right = narrow || pl === 'wide' ? 0 : out.d * 0.09;
      const up = pl === 'wide' ? 0 : narrow ? out.d * 0.13 : out.d * 0.08;
      out.x += -Math.cos(out.yaw) * right + Math.sin(out.yaw) * up;
      out.z += Math.sin(out.yaw) * right + Math.cos(out.yaw) * up;
      return out;
    };

    const camPos = new THREE.Vector3();
    const camLook = new THREE.Vector3();
    let camDist = 1;
    /** the camera for a story progress: every term is continuous in p, so the flight can't jump */
    const cameraAt = (p: number, t: number, pmx: number, pmy: number): number => {
      const f = p * n;
      const ch = Math.min(n - 1, Math.floor(f));
      const u = Math.min(1, f - ch);
      heroAt(p);
      keyFor(ch > 0 ? places[ch - 1] : places[ch], kA);
      keyFor(places[ch], kB);
      const fk = Math.min(1, u / 0.7);
      const s = ch === 0 ? 1 : fk * fk * fk * (fk * (fk * 6 - 15) + 10);
      const tx = kA.x + (kB.x - kA.x) * s; const tz = kA.z + (kB.z - kA.z) * s;
      const ty = kA.y + (kB.y - kA.y) * s;
      const dist = Math.exp(Math.log(kA.d) + (Math.log(kB.d) - Math.log(kA.d)) * s) * (1 + 0.1 * Math.sin(Math.PI * s));
      // the wide shot's slow drift fades out with the flight instead of switching off
      const wob = kA.wob + (kB.wob - kA.wob) * s;
      const yaw = lerpAngle(kA.yaw, kB.yaw, s) + pmx * 0.1 + wob * Math.sin(t * 0.12) * 0.03;
      const pitch = kA.pitch + (kB.pitch - kA.pitch) * s - pmy * 0.04;
      camPos.set(tx + Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, tz + Math.cos(yaw) * Math.cos(pitch) * dist);
      camLook.set(tx, ty, tz);
      camDist = dist;
      return s;
    };
    // dev hook (localStorage cesto-map-debug=1): sweep the whole story and report the worst camera step
    let debugOn = false;
    try { debugOn = localStorage.getItem('cesto-map-debug') === '1'; } catch { /* no hook */ }
    // frame cost, for the dev hook: script time in the frame body and in renderer.render
    const perfStat = { frames: 0, js: 0, render: 0, interval: 0 };
    interface MapStats { calls: number; tris: number; frames: number; avgJs: number; avgRender: number; avgInterval: number; dpr: number; staticShadows: boolean }
    // art direction: hold the camera anywhere (dev hook only)
    let camHold: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
    const debugWin = window as unknown as { __bizMapDebug?: {
      sweep: (steps?: number) => { worst: number; at: number };
      stats: () => MapStats;
      resetStats: () => void;
      hero: () => { x: number; y: number; z: number; hx: number; hz: number };
      hold: (px: number, py: number, pz: number, lx: number, ly: number, lz: number) => void;
      release: () => void;
    } };
    if (debugOn) {
      debugWin.__bizMapDebug = {
        stats: () => ({
          calls: renderer.info.render.calls,
          tris: renderer.info.render.triangles,
          frames: perfStat.frames,
          avgJs: perfStat.frames ? perfStat.js / perfStat.frames : 0,
          avgRender: perfStat.frames ? perfStat.render / perfStat.frames : 0,
          avgInterval: perfStat.frames ? perfStat.interval / perfStat.frames : 0,
          dpr: renderer.getPixelRatio(),
          staticShadows,
        }),
        resetStats: () => { perfStat.frames = 0; perfStat.js = 0; perfStat.render = 0; perfStat.interval = 0; },
        hero: () => ({ x: heroX, y: surfaceY(heroX, heroZ) + 0.03, z: heroZ, hx: heroHx, hz: heroHz }),
        hold: (px, py, pz, lx, ly, lz) => { camHold = { pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz) }; },
        release: () => { camHold = null; },
        sweep: (steps = 20000) => {
          const prevPos = new THREE.Vector3();
          let worst = 0; let at = 0;
          for (let i = 0; i <= steps; i++) {
            const pp = i / steps;
            cameraAt(pp, Math.PI / 2 / 0.12, 0, 0);
            if (i > 0) {
              const step = camPos.distanceTo(prevPos) / camDist;
              if (step > worst) { worst = step; at = pp; }
            }
            prevPos.copy(camPos);
          }
          return { worst, at };
        },
      };
    }

    const cRing = new THREE.Color();
    const cRingB = new THREE.Color();
    // the dataset is the test rig's window: write only what changed
    const dataCache: Record<string, string> = {};
    const setData = (k: string, v: string) => { if (dataCache[k] !== v) { dataCache[k] = v; renderer.domElement.dataset[k] = v; } };
    let reportedCh = -1;
    let perfFrames = 0; let perfTime = 0; let perfDone = false;
    let lastT = performance.now() / 1000;
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || !awake || document.hidden) return;
      const tf0 = debugOn ? performance.now() : 0;
      const t = now / 1000;
      const rawDt = Math.max(0, t - lastT);
      const dt = Math.min(0.05, rawDt);
      lastT = t;
      U.uTime.value = t;
      // a device that can't hold ~45fps (touch) / ~34fps (mouse) drops to one pixel per point, once —
      // measured after a warm-up, so first-frame shader compiles don't decide it
      if (!perfDone && rawDt > 0 && rawDt < 0.5) {
        perfFrames++;
        if (perfFrames > 40) perfTime += rawDt;
        if (perfFrames >= 130) {
          perfDone = true;
          if (perfTime / 90 > (coarse ? 1 / 45 : 1 / 34) && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); resize(); }
        }
      }
      if (debugOn) perfStat.interval += rawDt * 1000;
      // the camera chases the scroll instead of jumping with every wheel notch; a finger already
      // scrolls smoothly, so on touch it follows closer and never feels like it's dragging behind
      smoothP += (latestP - smoothP) * (1 - Math.exp(-Math.min(0.25, rawDt) * (coarse ? 7 : 3.2)));
      if (Math.abs(latestP - smoothP) < 1e-4) smoothP = latestP;
      const p = smoothP;
      const f = p * n;
      const ch = Math.min(n - 1, Math.floor(f));
      const u = Math.min(1, f - ch);
      const place = places[ch];
      const lastU = ch === n - 1 ? u : 0;
      if (ch !== reportedCh) { reportedCh = ch; onChapterRef.current?.(ch); }

      // the seasons: hold (preparing the next one in the background), then fade on the GPU
      if (seasonT0 >= 0) {
        const k = smooth01((now - seasonT0) / (SEASON_FADE * 1000));
        U.uSeasonMix.value = fadeFrom + (fadeTo - fadeFrom) * k;
        leafMix = k;
        paintLeaves();
        riverMat.color.copy(riverFrom).lerp(riverTo, k);
        if (k >= 1) { seasonT0 = -1; seasonAge = 0; shown = fadeTo as 0 | 1; }
      } else {
        prepStep();
        seasonAge += Math.min(rawDt, 0.25); // real seconds, however slow the frames
        if (seasonAge > SEASON_HOLD && prepped) startSeason(nextSeason());
      }

      // the camera and your order's van, both from p
      mx += (tmx - mx) * 0.05; my += (tmy - my) * 0.05;
      const s = cameraAt(p, t, mx, my);
      if (camHold) { camPos.copy(camHold.pos); camLook.copy(camHold.look); camDist = camPos.distanceTo(camLook); }
      placeVan(hero, heroX, heroZ, heroHx, heroHz);
      if (heroRaw <= 0 && (t % 1.6) < dt) hop(dock1.x, dock1.z - 0.02, heroX, heroZ - 0.08, t);

      // the network at work
      for (const r of runners) {
        const tl = (t + r.off) % r.total;
        let li = 0;
        while (li < r.legs.length - 1 && r.legs[li + 1].start <= tl) li++;
        const leg = r.legs[li];
        const lu = leg.stop ? leg.u0 : leg.u0 + (leg.u1 - leg.u0) * smooth01((tl - leg.start) / leg.dur);
        r.curve.getPointAt(lu, tmpV);
        const x = tmpV.x; const z = tmpV.z;
        if (!leg.stop) {
          r.curve.getTangentAt(Math.min(0.999, Math.max(0.001, lu)), tmpV);
          const sgn = leg.u1 >= leg.u0 ? 1 : -1;
          r.hx = tmpV.x * sgn; r.hz = tmpV.z * sgn;
        }
        placeVan(r.g, x, z, r.hx, r.hz);
        if (li !== r.leg) {
          r.leg = li;
          if (leg.stop) {
            ping(x, z, leg.ping, t);
            if (r.hops) {
              const door = r.hops.find(([hx, hz]) => Math.hypot(hx - x, hz - z) < 0.3);
              if (door) hop(door[0], door[1], x, z, t);
            }
          }
        }
      }
      for (const h of hops) {
        if (h.t0 < 0) continue;
        const k = (t - h.t0) / 0.55;
        if (k >= 1) { h.t0 = -1; h.mesh.visible = false; continue; }
        h.mesh.visible = true;
        h.mesh.position.set(h.ax + (h.bx - h.ax) * k, h.ay + (h.by - h.ay) * k + Math.sin(k * Math.PI) * 0.12, h.az + (h.bz - h.az) * k);
        h.mesh.rotation.y = k * 2;
      }
      for (const q of pings) {
        if (q.t0 < 0) continue;
        const k = (t - q.t0) / 1.4;
        if (k >= 1) { q.t0 = -1; q.mesh.visible = false; continue; }
        q.mesh.scale.setScalar(0.05 + k * 0.42);
        q.m.opacity = (1 - k) * 0.9;
      }

      // the delivery, scrubbed by the last chapter
      const walk = seg(lastU, 0.4, 0.74);
      const hand = seg(lastU, 0.74, 0.8);
      const done = lastU >= 0.8;
      const rx = -heroHz; const rz = heroHx; const rl = Math.hypot(rx, rz) || 1;
      const sx0 = heroX + (rx / rl) * 0.1 - heroHx * 0.06; const sz0 = heroZ + (rz / rl) * 0.1 - heroHz * 0.06;
      const ex = doorX + Math.sin(BUYER.yaw) * 0.08 - Math.cos(BUYER.yaw) * 0.05; const ez = doorZ + Math.cos(BUYER.yaw) * 0.08 + Math.sin(BUYER.yaw) * 0.05;
      const carrierOn = ch === n - 1 && lastU >= 0.38;
      const cX = sx0 + (ex - sx0) * walk; const cZ = sz0 + (ez - sz0) * walk;

      // people
      for (let k = 0; k < people.length; k++) {
        const pp = people[k];
        let x = pp.x; let z = pp.z; let yaw = pp.yaw; let moving = false; let show = true;
        if (pp.kind === 'loop') {
          const a = pp.ph + t * pp.sp;
          x = pp.x + Math.cos(a) * pp.r; z = pp.z + Math.sin(a) * pp.r;
          yaw = Math.atan2(-Math.sin(a) * Math.sign(pp.sp), Math.cos(a) * Math.sign(pp.sp));
          moving = true;
        } else if (pp.kind === 'trail' && pp.trail) {
          const cyc = ((t * pp.sp + pp.ph) % 2 + 2) % 2;
          const tu = cyc < 1 ? cyc : 2 - cyc;
          pp.trail.getPointAt(tu, tmpV); x = tmpV.x; z = tmpV.z;
          pp.trail.getTangentAt(Math.min(0.999, tu), tmpV);
          yaw = Math.atan2(tmpV.x * (cyc < 1 ? 1 : -1), tmpV.z * (cyc < 1 ? 1 : -1));
          moving = true;
        } else if (pp.kind === 'carrier') {
          show = carrierOn;
          x = cX; z = cZ; yaw = walk < 1 ? Math.atan2(ex - sx0, ez - sz0) : BUYER.yaw + Math.PI;
          moving = walk > 0 && walk < 1;
        } else if (k === ownerIdx) {
          yaw = carrierOn ? Math.atan2(cX - x, cZ - z) : BUYER.yaw;
        }
        const y = surfaceY(x, z) + (moving ? Math.abs(Math.sin(t * 9 + pp.ph)) * 0.008 : 0);
        qtn.setFromAxisAngle(YAXIS, yaw);
        mtx.compose(pv.set(x, y, z), qtn, scl.setScalar(show ? 1 : 0.0001));
        bodies.setMatrixAt(k, mtx); heads.setMatrixAt(k, mtx);
      }
      bodies.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
      carried.visible = carrierOn || done;
      if (carried.visible) {
        const ox = people[ownerIdx].x; const oz = people[ownerIdx].z;
        const hx = cX + Math.sin(Math.atan2(ex - sx0, ez - sz0)) * 0.035; const hz = cZ + Math.cos(Math.atan2(ex - sx0, ez - sz0)) * 0.035;
        const k = done ? 1 : hand;
        carried.position.set(hx + (ox - hx) * k, surfaceY(hx, hz) + 0.075, hz + (oz - hz) * k);
      }

      // leaves fall
      const hh = Math.tan((camera.fov * Math.PI) / 360);
      const ysFrom = leafFrom.round ? 0.32 : 0.2; const ysTo = leafTo.round ? 0.32 : 0.2;
      const leafYs = ysFrom + (ysTo - ysFrom) * leafMix;
      for (let k = 0; k < LEAVES; k++) {
        const L = leafData[k];
        L.sy -= dt * L.sp;
        L.sx += Math.sin(t * 0.8 + L.ph) * dt * 0.025;
        if (L.sy < -1.2) { L.sy = 1.2; L.sx = rnd() * 2 - 1; }
        const yy = L.sy * hh * L.depth; const xx = L.sx * hh * camera.aspect * L.depth;
        qtn.setFromEuler(leafEuler.set(t * L.spin + L.ph, t * L.spin * 0.7, L.ph));
        const want = (k < leafFrom.leafCount ? 1 - leafMix : 0) + (k < leafTo.leafCount ? leafMix : 0);
        const sz = L.size * L.depth * Math.max(0.0001, want);
        mtx.compose(pv.set(xx, yy, -L.depth), qtn, scl.set(sz * 0.32, sz * leafYs, 1));
        leaves.setMatrixAt(k, mtx);
      }
      leaves.instanceMatrix.needsUpdate = true;

      // the camera flight
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      const dist = camDist;
      fog.near = dist * 0.8; fog.far = dist * 2.6 + 12;
      if (!staticShadows) {
        const half = Math.min(24, Math.max(4.5, dist * 0.72));
        const sc = sun.shadow.camera;
        if (Math.abs(sc.right - half) > 0.05) {
          sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.updateProjectionMatrix();
          // the offset that keeps acne off the terrain scales with the shadow's reach: tight in a
          // close-up (or a van's shadow detaches from its tyres), generous over the whole country
          sun.shadow.normalBias = half * 0.0011;
        }
        sun.target.position.copy(camLook);
        sun.position.set(camLook.x + SUN_DIR.x * 30, camLook.y + SUN_DIR.y * 30, camLook.z + SUN_DIR.z * 30);
      }

      // the spotlight on the place the words are about
      U.uFocus.value.set(kA.fx + (kB.fx - kA.fx) * s, 0, kA.fz + (kB.fz - kA.fz) * s);
      U.uFocusR.value = kA.fr + (kB.fr - kA.fr) * s;
      U.uFocusAmt.value = kA.fa + (kB.fa - kA.fa) * s;
      cRing.setHex(kA.ring); cRingB.setHex(kB.ring);
      U.uRingCol.value.copy(cRing).lerp(cRingB, s).multiplyScalar(done ? 1.4 : 1);
      const hc = hoverCity ? CITIES.find((c) => c.id === hoverCity) : null;
      if (hc) { U.uGlow.value.lerp(tmpV.set(hc.x, 0, hc.z), 0.2); U.uGlowR.value += (1.3 - U.uGlowR.value) * 0.15; }
      else { U.uGlow.value.lerp(glowAt, 0.25); U.uGlowR.value += (0.9 - U.uGlowR.value) * 0.15; }
      U.uGlowAmt.value += ((hc || pointerIn ? 1 : 0) - U.uGlowAmt.value) * 0.08;

      // routes: the whole network glows wide, your order's road from the moment it leaves
      for (const o of overlays) {
        const want = place === 'wide' || place === 'network' ? 0.7 : o.key === 'a3' && (heroRaw > 0 || place === 'road' || place === 'delivery') ? 0.95 : 0;
        o.mat.opacity += (want - o.mat.opacity) * 0.06;
        o.mesh.visible = o.mat.opacity > 0.01; // a see-through ribbon is still a draw call
      }
      dashTex.offset.x = -t * 1.1;

      // pins: place them all, then the important ones win any overlap
      const focusing = U.uFocusAmt.value > 0.25;
      const showTag = (place === 'depot' || place === 'road' || place === 'network' || (place === 'delivery' && lastU < 0.4)) && !done;
      for (const pin of allPins) {
        let on = true;
        if (pin === storesPin) on = place === 'stores';
        else if (pin === shopPin) on = (heroRaw > 0 || place === 'delivery') && !done;
        else if (pin === donePin) on = done;
        else if (pin === tagPin) { on = showTag; pin.x = heroX; pin.y = surfaceY(heroX, heroZ) + 0.22; pin.z = heroZ; }
        pin.vis = false;
        if (on) {
          tmpV.set(pin.x, pin.y, pin.z).project(camera);
          if (tmpV.z <= 1 && tmpV.x > -1.2 && tmpV.x < 1.2 && tmpV.y > -1.25 && tmpV.y < 1.2) {
            pin.sx = ((tmpV.x + 1) / 2) * W;
            pin.sy = ((1 - tmpV.y) / 2) * H;
            // the label rises ~60px above its dot: keep it clear of the page's floating top,
            // and whole — a name cut by the screen's edge is worse than none
            pin.vis = pin.sy - 60 > topInset && pin.sx > (narrow ? 44 : 64) && pin.sx < W - (narrow ? 44 : 64);
          }
        }
      }
      // among the important ones, the story's own outrank the brand
      for (let i = 1; i < pinRank.length; i++) {
        const pin = pinRank[i];
        if (!pin.vis) continue;
        for (let j = 0; j < i; j++) {
          const q = pinRank[j];
          if (q.vis && Math.abs(q.sx - pin.sx) < 96 && Math.abs(q.sy - pin.sy) < 40) { pin.vis = false; break; }
        }
      }
      for (let i = 0; i < cityPins.length; i++) {
        const pin = cityPins[i];
        if (!pin.vis) continue;
        let clash = pin.sx < W * (narrow ? 1 : 0.5) && pin.sy > H * (narrow ? 0.52 : 0.6); // under the words
        for (const q of priorityPins) if (!clash && q.vis && Math.abs(q.sx - pin.sx) < 92 && Math.abs(q.sy - pin.sy) < 40) clash = true;
        for (let j = 0; j < i && !clash; j++) {
          const q = cityPins[j];
          if (q.vis && Math.abs(q.sx - pin.sx) < 92 && Math.abs(q.sy - pin.sy) < 36) clash = true;
        }
        if (clash) pin.vis = false;
      }
      for (const pin of allPins) {
        pin.el.classList.toggle('is-off', !pin.vis);
        if (pin.vis) pin.el.style.transform = `translate3d(${pin.sx.toFixed(1)}px, ${pin.sy.toFixed(1)}px, 0)`;
        const isFocus = (pin === depotPin && place === 'depot') || (pin === storesPin && place === 'stores') || pin === donePin || pin.id === hoverCity;
        pin.el.classList.toggle('is-focus', isFocus);
        pin.el.classList.toggle('is-dim', focusing && !isFocus && pin !== tagPin && pin !== shopPin);
      }

      setData('p', latestP.toFixed(3));
      setData('ps', p.toFixed(3));
      setData('chapter', String(ch));
      setData('key', place);
      setData('hover', hoverCity);
      setData('cam', `${camera.position.x.toFixed(2)},${camera.position.z.toFixed(2)}`);
      setData('phase', ch === 0 ? 'loading' : ch === n - 1 ? 'arrived' : 'driving');
      setData('season', season);
      setData('smix', U.uSeasonMix.value.toFixed(2));
      setData('focus', U.uFocusAmt.value.toFixed(2));
      setData('vanu', heroRaw.toFixed(3));
      fleet.instanceMatrix.needsUpdate = true;
      fleetSkin.instanceMatrix.needsUpdate = true;
      const tf1 = debugOn ? performance.now() : 0;
      renderer.render(scene, camera);
      if (debugOn) { perfStat.frames++; perfStat.js += tf1 - tf0; perfStat.render += performance.now() - tf1; }
    };
    if (staticShadows) renderer.shadowMap.needsUpdate = true;
    raf = requestAnimationFrame(frame);
    document.fonts?.ready.then(() => { if (!disposed) redraws.forEach((r) => r()); }).catch(() => {});

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      themeWatch.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      register(null);
      if (debugOn) delete debugWin.__bizMapDebug;
      [walls, roofs, wins, cones, balls, trunks, bodies, heads, dots, leaves, fleet, fleetSkin].forEach((im) => im.dispose());
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      host.removeChild(renderer.domElement);
      host.removeChild(pinRoot);
    };
    // register is stable-by-ref on purpose; the map rebuilds only for a new story or new words
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places.join(','), words.brand, words.stores, words.shop, words.delivered, words.yourOrder]);

  return <div ref={hostRef} className="absolute inset-0" aria-hidden="true" />;
}

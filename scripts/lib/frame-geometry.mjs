// Procedural eyeglass-frame geometry shared by scripts/gen-frames.mjs (GLB export)
// and src/platform/render/proceduralGlasses.ts (runtime fallback).
// Coordinate convention (docs/assets/glb-spec.md): mm, +Y up, +Z toward the camera,
// origin at the bridge / nose contact point, temples run toward −Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lensOutline } from './lens-outline.mjs';

export const RIM_RADIUS = 1.4;
export const TEMPLE_RADIUS = 1.1;

/** Lens outline (closed THREE.Shape) centred at the origin, w × h — from lens-outline.mjs. */
export function lensShape(kind, w, h, build = {}) {
  const pts = lensOutline(kind, w, h, build);
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  s.closePath();
  return s;
}

function tubeAlong(points, radius, closed = false, segments = 64) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, segments, radius, 10, closed);
}

/** Keeps only position/normal as non-indexed triangles. */
function strip(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  out.setAttribute('normal', g.getAttribute('normal'));
  return out;
}

/**
 * Builds the geometry of one frame.
 * @param {{shape: 'square'|'round'|'aviator'|'wellington', spec: {lens_width_mm:number, bridge_mm:number, temple_mm:number, lens_height_mm:number, frame_width_mm:number, nose_pad:'fixed'|'adjustable'}, build?: Partial<import('./frame-defs').FrameBuild>}} def
 */
export function buildFrameGeometry(def) {
  const { lens_width_mm: lw, bridge_mm: b, temple_mm: tl, lens_height_mm: lh, frame_width_mm: fw, nose_pad } = def.spec;
  const build = def.build ?? {};
  const frontZ = build.lens_plane_mm ?? (nose_pad === 'adjustable' ? 5 : 3); // lens plane in front of the nose contact
  const lensCenterY = build.lens_center_y_mm ?? -3; // pupil line sits ~3 mm above the lens centre
  const lensCenterX = b / 2 + lw / 2;
  const topY = lensCenterY + lh / 2;
  const bridgeY = lensCenterY + lh * (build.bridge_height_ratio ?? 0.3);
  const hingeY = build.hinge_y_mm ?? topY - 4;
  const hingeZ = build.hinge_z_mm ?? frontZ - 1;
  const hingeInset = build.hinge_inset_mm ?? 0;
  const bend = build.temple_bend_mm ?? Math.round(tl * 0.68);
  const drop = build.temple_drop_mm ?? 28;
  const hook = build.temple_hook_mm ?? 2;
  const padY = build.pad_center ? build.pad_center[1] : -3.5;
  const padZ = build.pad_center ? build.pad_center[2] : nose_pad === 'adjustable' ? 2.5 : 1.5;

  const front = [];
  const pads = [];
  let lensL = null, lensR = null, templeL = null, templeR = null;

  for (const side of [-1, 1]) {
    const shape = lensShape(def.shape, lw, lh, build);
    const pts = shape.getPoints(80).map((p) => new THREE.Vector3(side * p.x + side * lensCenterX, p.y + lensCenterY, frontZ));
    pts.pop(); // closed shapes repeat the first point
    front.push(tubeAlong(pts, RIM_RADIUS, true, 96));
    const lensGeo = new THREE.ShapeGeometry(shape, 24);
    lensGeo.scale(side, 1, 1);
    lensGeo.translate(side * lensCenterX, lensCenterY, frontZ - 0.5);
    if (side < 0) lensL = lensGeo; else lensR = lensGeo;
    const outerX = side * (lensCenterX + lw / 2);
    const hingeX = side * (fw / 2 - hingeInset);
    front.push(tubeAlong([new THREE.Vector3(outerX, hingeY, frontZ), new THREE.Vector3(side * (fw / 2 - RIM_RADIUS), hingeY, hingeZ)], RIM_RADIUS, false, 4));
    // Straight to the ear bend, then a smooth drop behind the ear with a slight inward hook.
    const rest = tl - bend;
    const temple = tubeAlong(
      [
        new THREE.Vector3(hingeX, hingeY, hingeZ),
        new THREE.Vector3(hingeX, hingeY, hingeZ - bend * 0.5),
        new THREE.Vector3(hingeX, hingeY, hingeZ - bend),
        new THREE.Vector3(hingeX, hingeY - drop * 0.25, hingeZ - bend - rest * 0.35),
        new THREE.Vector3(hingeX - side * hook * 0.5, hingeY - drop * 0.65, hingeZ - bend - rest * 0.55),
        new THREE.Vector3(hingeX - side * hook, hingeY - drop, hingeZ - bend - rest * 0.62),
      ],
      TEMPLE_RADIUS, false, 48,
    );
    if (side < 0) templeL = temple; else templeR = temple;
    const pad = new THREE.BoxGeometry(2, 9, nose_pad === 'adjustable' ? 5 : 3);
    pad.translate(side * (build.pad_center ? build.pad_center[0] : b / 2 - 1), padY, padZ);
    pads.push(pad);
    if (nose_pad === 'adjustable') {
      pads.push(tubeAlong([new THREE.Vector3(side * (lensCenterX - lw / 2 + 1), bridgeY - 4, frontZ), new THREE.Vector3(side * (b / 2 - 1), padY + 3, padZ + 1)], 0.6, false, 4));
    }
  }
  front.push(tubeAlong(
    [new THREE.Vector3(-b / 2, bridgeY, frontZ), new THREE.Vector3(0, bridgeY + 2.5, frontZ), new THREE.Vector3(b / 2, bridgeY, frontZ)],
    RIM_RADIUS, false, 16,
  ));

  return {
    frontZ, hingeY, hingeZ,
    front: mergeGeometries(front.map(strip), false),
    pads: mergeGeometries(pads.map(strip), false),
    lensL: strip(lensL), lensR: strip(lensR),
    templeL: strip(templeL), templeR: strip(templeR),
    anchors: {
      bridge: [0, 0, 0],
      temple_left: [-(fw / 2 - hingeInset), hingeY, hingeZ],
      temple_right: [fw / 2 - hingeInset, hingeY, hingeZ],
      nose_pad_offset: [build.pad_center ? build.pad_center[0] : 0, padY, padZ],
      lens_plane_mm: frontZ,
      rim_depth_mm: RIM_RADIUS * 2,
      rim_width_mm: RIM_RADIUS * 2,
      temple_bend_mm: bend,
      temple_drop_mm: drop,
    },
  };
}

// Procedural eyeglass-frame geometry shared by scripts/gen-frames.mjs (GLB export)
// and src/platform/render/proceduralGlasses.ts (runtime fallback).
// Coordinate convention (docs/assets/glb-spec.md): mm, +Y up, +Z toward the camera,
// origin at the bridge / nose contact point, temples run toward −Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const RIM_RADIUS = 1.4;
export const TEMPLE_RADIUS = 1.1;

/** Lens outline (closed THREE.Shape) centred at the origin, w × h. */
export function lensShape(kind, w, h) {
  const s = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  if (kind === 'round') {
    s.absellipse(0, 0, hw, hh, 0, Math.PI * 2, false, 0);
    return s;
  }
  if (kind === 'square') {
    const r = Math.min(6, hw * 0.3);
    s.moveTo(-hw + r, hh);
    s.lineTo(hw - r, hh);
    s.quadraticCurveTo(hw, hh, hw, hh - r);
    s.lineTo(hw, -hh + r);
    s.quadraticCurveTo(hw, -hh, hw - r, -hh);
    s.lineTo(-hw + r, -hh);
    s.quadraticCurveTo(-hw, -hh, -hw, -hh + r);
    s.lineTo(-hw, hh - r);
    s.quadraticCurveTo(-hw, hh, -hw + r, hh);
    return s;
  }
  // Aviator: wide flat top, tear-drop bottom.
  s.moveTo(-hw, hh * 0.55);
  s.bezierCurveTo(-hw, hh, -hw * 0.3, hh, 0, hh);
  s.bezierCurveTo(hw * 0.6, hh, hw, hh * 0.7, hw, hh * 0.2);
  s.bezierCurveTo(hw, -hh * 0.5, hw * 0.55, -hh, 0, -hh);
  s.bezierCurveTo(-hw * 0.7, -hh, -hw, -hh * 0.4, -hw, hh * 0.55);
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
 * @param {{shape: 'square'|'round'|'aviator', spec: {lens_width_mm:number, bridge_mm:number, temple_mm:number, lens_height_mm:number, frame_width_mm:number, nose_pad:'fixed'|'adjustable'}}} def
 */
export function buildFrameGeometry(def) {
  const { lens_width_mm: lw, bridge_mm: b, temple_mm: tl, lens_height_mm: lh, frame_width_mm: fw, nose_pad } = def.spec;
  const frontZ = nose_pad === 'adjustable' ? 5 : 3; // lens plane in front of the nose contact
  const lensCenterY = -3; // pupil line sits ~3 mm above the lens centre
  const lensCenterX = b / 2 + lw / 2;
  const topY = lensCenterY + lh / 2;
  const bridgeY = lensCenterY + lh * 0.3;
  const hingeY = topY - 4;
  const hingeZ = frontZ - 1;

  const front = [];
  const pads = [];
  let lensL = null, lensR = null, templeL = null, templeR = null;

  for (const side of [-1, 1]) {
    const shape = lensShape(def.shape, lw, lh);
    const pts = shape.getPoints(80).map((p) => new THREE.Vector3(side * p.x + side * lensCenterX, p.y + lensCenterY, frontZ));
    pts.pop(); // closed shapes repeat the first point
    front.push(tubeAlong(pts, RIM_RADIUS, true, 96));
    const lensGeo = new THREE.ShapeGeometry(shape, 24);
    lensGeo.scale(side, 1, 1);
    lensGeo.translate(side * lensCenterX, lensCenterY, frontZ - 0.5);
    if (side < 0) lensL = lensGeo; else lensR = lensGeo;
    const outerX = side * (lensCenterX + lw / 2);
    const hingeX = side * (fw / 2);
    front.push(tubeAlong([new THREE.Vector3(outerX, hingeY, frontZ), new THREE.Vector3(hingeX, hingeY, hingeZ)], RIM_RADIUS, false, 4));
    const temple = tubeAlong(
      [
        new THREE.Vector3(hingeX, hingeY, hingeZ),
        new THREE.Vector3(hingeX + side * 1.5, hingeY, hingeZ - tl * 0.55),
        new THREE.Vector3(hingeX + side * 1.5, hingeY - 3, hingeZ - tl * 0.75),
        new THREE.Vector3(hingeX, hingeY - 12, hingeZ - tl * 0.9),
        new THREE.Vector3(hingeX - side * 1, hingeY - 22, hingeZ - tl),
      ],
      TEMPLE_RADIUS, false, 48,
    );
    if (side < 0) templeL = temple; else templeR = temple;
    const pad = new THREE.BoxGeometry(2, 9, nose_pad === 'adjustable' ? 5 : 3);
    pad.translate(side * (b / 2 - 1), -3.5, nose_pad === 'adjustable' ? 2.5 : 1.5);
    pads.push(pad);
    if (nose_pad === 'adjustable') {
      pads.push(tubeAlong([new THREE.Vector3(side * (lensCenterX - lw / 2 + 1), bridgeY - 4, frontZ), new THREE.Vector3(side * (b / 2 - 1), 0, 2.5)], 0.6, false, 4));
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
      temple_left: [-fw / 2, hingeY, hingeZ],
      temple_right: [fw / 2, hingeY, hingeZ],
      nose_pad_offset: [0, -3.5, nose_pad === 'adjustable' ? 2.5 : 1.5],
    },
  };
}

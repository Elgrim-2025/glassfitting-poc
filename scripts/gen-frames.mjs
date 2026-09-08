// Generates three sample frames (square / round / aviator) as GLB files that follow
// docs/assets/glb-spec.md, plus the mock product-master API JSON under public/api/v1.
// Geometry is procedural (three.js in Node) and is written with a minimal glTF 2.0 writer.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrameGeometry } from './lib/frame-geometry.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assetDir = join(root, 'public', 'assets', 'frames');
const apiDir = join(root, 'public', 'api', 'v1');
mkdirSync(assetDir, { recursive: true });
mkdirSync(join(apiDir, 'frames'), { recursive: true });

/** Product definitions (spec §부록 B). Dimensions in mm. */
const FRAMES = [
  {
    frame_id: 'FR-0001', name: '샘플 사각 프레임 (아세테이트)', shape: 'square',
    spec: { lens_width_mm: 52, bridge_mm: 18, temple_mm: 140, lens_height_mm: 40, frame_width_mm: 138, nose_pad: 'fixed' },
    color: [0.08, 0.07, 0.07], metallic: 0.05, roughness: 0.45,
    fit_hints: { recommended_pd_range_mm: [58, 68] },
  },
  {
    frame_id: 'FR-0002', name: '샘플 라운드 프레임 (메탈)', shape: 'round',
    spec: { lens_width_mm: 47, bridge_mm: 21, temple_mm: 145, lens_height_mm: 45, frame_width_mm: 135, nose_pad: 'adjustable' },
    color: [0.83, 0.69, 0.22], metallic: 0.9, roughness: 0.3,
    fit_hints: { recommended_pd_range_mm: [56, 66] },
  },
  {
    frame_id: 'FR-0003', name: '샘플 보잉 프레임 (메탈)', shape: 'aviator',
    spec: { lens_width_mm: 58, bridge_mm: 14, temple_mm: 140, lens_height_mm: 50, frame_width_mm: 140, nose_pad: 'adjustable' },
    color: [0.75, 0.75, 0.78], metallic: 0.95, roughness: 0.25,
    fit_hints: { recommended_pd_range_mm: [60, 70] },
  },
];

// ---------------------------------------------------------------------------
// Minimal GLB writer.
// ---------------------------------------------------------------------------
function writeGlb(path, nodesSpec, materials) {
  const bin = [];
  let binLength = 0;
  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  const nodes = [];

  const align = (n) => (n + 3) & ~3;
  const pushBuffer = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = new Uint8Array(align(bytes.length));
    padded.set(bytes);
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.length, target });
    bin.push(padded);
    binLength += padded.length;
    return bufferViews.length - 1;
  };
  const addGeometry = (geo, materialIndex) => {
    const pos = geo.getAttribute('position').array;
    const nor = geo.getAttribute('normal').array;
    const count = pos.length / 3;
    const indexArray = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
    for (let i = 0; i < count; i++) indexArray[i] = i;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i * 3 + k]); max[k] = Math.max(max[k], pos[i * 3 + k]); }
    const posView = pushBuffer(new Float32Array(pos), 34962);
    const norView = pushBuffer(new Float32Array(nor), 34962);
    const idxView = pushBuffer(indexArray, 34963);
    accessors.push({ bufferView: posView, componentType: 5126, count, type: 'VEC3', min, max });
    accessors.push({ bufferView: norView, componentType: 5126, count, type: 'VEC3' });
    accessors.push({ bufferView: idxView, componentType: count > 65535 ? 5125 : 5123, count, type: 'SCALAR' });
    const base = accessors.length - 3;
    meshes.push({ primitives: [{ attributes: { POSITION: base, NORMAL: base + 1 }, indices: base + 2, material: materialIndex, mode: 4 }] });
    return meshes.length - 1;
  };
  const addNode = (spec) => {
    const node = { name: spec.name };
    if (spec.translation) node.translation = spec.translation;
    if (spec.geometry) node.mesh = addGeometry(spec.geometry, spec.material);
    if (spec.children) node.children = spec.children.map(addNode);
    nodes.push(node);
    return nodes.length - 1;
  };
  const rootIndex = addNode(nodesSpec);
  const json = {
    asset: { version: '2.0', generator: 'glassfitting-poc gen-frames.mjs', extras: { units: 'mm', origin: 'bridge (nose contact)' } },
    scene: 0,
    scenes: [{ nodes: [rootIndex] }],
    nodes, meshes, accessors, bufferViews, materials,
    buffers: [{ byteLength: binLength }],
  };
  let jsonText = JSON.stringify(json);
  while (jsonText.length % 4) jsonText += ' ';
  const jsonBytes = Buffer.from(jsonText, 'utf8');
  const binBytes = Buffer.concat(bin.map((b) => Buffer.from(b)));
  const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBytes.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([header, jsonHeader, jsonBytes, binHeader, binBytes]));
  return { bytes: total, triangles: meshes.reduce((n, m) => n + accessors[m.primitives[0].indices].count / 3, 0) };
}

const thumbnailSvg = (def) => {
  const { lens_width_mm: lw, bridge_mm: b, lens_height_mm: lh } = def.spec;
  const c = `rgb(${def.color.map((v) => Math.round(v * 255)).join(',')})`;
  const rx = def.shape === 'round' ? lw / 2 : 6;
  const lens = (x) => `<rect x="${x}" y="${30 - lh / 2}" width="${lw}" height="${lh}" rx="${rx}" fill="none" stroke="${c}" stroke-width="3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-80 0 160 60">${lens(-b / 2 - lw)}${lens(b / 2)}<line x1="${-b / 2}" y1="24" x2="${b / 2}" y2="24" stroke="${c}" stroke-width="3"/></svg>`;
};

const items = [];
for (const def of FRAMES) {
  const built = buildFrameGeometry(def);
  const materials = [
    { name: 'frame', pbrMetallicRoughness: { baseColorFactor: [...def.color, 1], metallicFactor: def.metallic, roughnessFactor: def.roughness }, doubleSided: true },
    { name: 'lens', pbrMetallicRoughness: { baseColorFactor: [0.85, 0.9, 1, 0.18], metallicFactor: 0, roughnessFactor: 0.05 }, alphaMode: 'BLEND', doubleSided: true },
    { name: 'pad', pbrMetallicRoughness: { baseColorFactor: [0.9, 0.9, 0.9, 0.6], metallicFactor: 0, roughnessFactor: 0.6 }, alphaMode: 'BLEND', doubleSided: true },
  ];
  const nodesSpec = {
    name: def.frame_id,
    children: [
      { name: 'frame_front', geometry: built.front, material: 0 },
      { name: 'nose_pads', geometry: built.pads, material: 2 },
      { name: 'lens_L', geometry: built.lensL, material: 1 },
      { name: 'lens_R', geometry: built.lensR, material: 1 },
      { name: 'temple_L', geometry: built.templeL, material: 0 },
      { name: 'temple_R', geometry: built.templeR, material: 0 },
      { name: 'anchor_bridge', translation: built.anchors.bridge },
      { name: 'anchor_temple_L', translation: built.anchors.temple_left },
      { name: 'anchor_temple_R', translation: built.anchors.temple_right },
    ],
  };
  const glbPath = join(assetDir, `${def.frame_id}.glb`);
  const info = writeGlb(glbPath, nodesSpec, materials);
  writeFileSync(join(assetDir, `${def.frame_id}.svg`), thumbnailSvg(def));

  // Dimension check against the spec (docs/assets/glb-spec.md: ≤ 1 mm).
  built.front.computeBoundingBox();
  const bb = built.front.boundingBox;
  const measuredWidth = bb.max.x - bb.min.x; // tube ends are centred on the hinge points
  const lensBox = built.lensL.boundingBox ?? (built.lensL.computeBoundingBox(), built.lensL.boundingBox);
  const measuredLens = lensBox.max.x - lensBox.min.x;
  const widthErr = Math.abs(measuredWidth - def.spec.frame_width_mm);
  const lensErr = Math.abs(measuredLens - def.spec.lens_width_mm);
  console.log(`[gen-frames] ${def.frame_id}: ${(info.bytes / 1024).toFixed(0)} KB, ${info.triangles} tris, width ${measuredWidth.toFixed(2)} (spec ${def.spec.frame_width_mm}, err ${widthErr.toFixed(2)}), lens ${measuredLens.toFixed(2)} (spec ${def.spec.lens_width_mm}, err ${lensErr.toFixed(2)})`);
  if (widthErr > 1 || lensErr > 1) throw new Error(`${def.frame_id}: dimension error exceeds 1 mm`);

  const item = {
    frame_id: def.frame_id,
    name: def.name,
    spec: def.spec,
    assets: {
      glb_url: `/assets/frames/${def.frame_id}.glb`,
      thumbnail_url: `/assets/frames/${def.frame_id}.svg`,
      anchor: built.anchors,
    },
    fit_hints: def.fit_hints,
    version: 1,
    updated_at: '2026-09-08T00:00:00Z',
  };
  items.push(item);
  writeFileSync(join(apiDir, 'frames', `${def.frame_id}.json`), JSON.stringify(item, null, 2));
}
writeFileSync(join(apiDir, 'frames.json'), JSON.stringify({ items, page: 1, size: items.length, total: items.length }, null, 2));
console.log(`[gen-frames] wrote ${items.length} frames + mock API to ${apiDir}`);

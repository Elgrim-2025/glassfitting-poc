// Builds the sample frame assets and the mock product-master API.
//
//   node scripts/gen-frames.mjs            Blender (if installed) models the frames + head occluder,
//                                          then the GLBs are post-processed and checked (glb-spec.md)
//   NO_BLENDER=1 node scripts/gen-frames.mjs   procedural three.js fallback geometry only
//   BLENDER=/path/to/blender ...           override the Blender binary
//
// Product definitions live in scripts/frames.json (see scripts/lib/frame-defs.mjs).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrameGeometry } from './lib/frame-geometry.mjs';
import { anchorFromDef, FRAMES_JSON, loadFrameDefs } from './lib/frame-defs.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assetDir = join(root, 'public', 'assets', 'frames');
const modelDir = join(root, 'public', 'models');
const apiDir = join(root, 'public', 'api', 'v1');
mkdirSync(assetDir, { recursive: true });
mkdirSync(join(apiDir, 'frames'), { recursive: true });

const FRAMES = loadFrameDefs();
const REQUIRED_NODES = ['frame_front', 'lens_L', 'lens_R', 'temple_L', 'temple_R', 'anchor_bridge', 'anchor_temple_L', 'anchor_temple_R'];
const MAX_TRIANGLES = 50000;

// ---------------------------------------------------------------------------
// Blender
// ---------------------------------------------------------------------------
function findBlender() {
  if (process.env.NO_BLENDER) return null;
  const candidates = [process.env.BLENDER, '/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', '/usr/local/bin/blender', 'C:/Program Files/Blender Foundation/Blender/blender.exe'].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function runBlender(blender, script, args) {
  const r = spawnSync(blender, ['-b', '--factory-startup', '--python', join(root, 'scripts', 'blender', script), '--', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const lines = (r.stdout + r.stderr).split('\n').filter((l) => l.startsWith('[frame_builder]') || l.startsWith('[head_builder]') || /Error|Traceback/.test(l));
  for (const l of lines) console.log(l);
  if (r.status !== 0) throw new Error(`${script} failed (exit ${r.status})\n${r.stderr.slice(-2000)}`);
}

// ---------------------------------------------------------------------------
// Minimal GLB I/O (fallback writer + post-processing of Blender output).
// ---------------------------------------------------------------------------
const align = (n) => (n + 3) & ~3;

function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binOff = 20 + jsonLen;
  let bin = Buffer.alloc(0);
  if (binOff < buf.length) {
    const binLen = buf.readUInt32LE(binOff);
    bin = buf.subarray(binOff + 8, binOff + 8 + binLen);
  }
  return { json, bin };
}

function packGlb(json, bin) {
  let jsonText = JSON.stringify(json);
  while (jsonText.length % 4) jsonText += ' ';
  const jsonBytes = Buffer.from(jsonText, 'utf8');
  const binPadded = Buffer.alloc(align(bin.length));
  bin.copy(binPadded);
  const total = 12 + 8 + jsonBytes.length + (bin.length ? 8 + binPadded.length : 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const parts = [header, jsonHeader, jsonBytes];
  if (bin.length) {
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binPadded.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
    parts.push(binHeader, binPadded);
  }
  return Buffer.concat(parts);
}

/** Procedural fallback (three.js in Node) with the same node convention. */
function writeProceduralGlb(path, def) {
  const built = buildFrameGeometry(def);
  const bin = [];
  let binLength = 0;
  const bufferViews = [], accessors = [], meshes = [], nodes = [];
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
    const pos = geo.getAttribute('position').array, nor = geo.getAttribute('normal').array;
    const count = pos.length / 3;
    const idx = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i * 3 + k]); max[k] = Math.max(max[k], pos[i * 3 + k]); }
    const posView = pushBuffer(new Float32Array(pos), 34962), norView = pushBuffer(new Float32Array(nor), 34962), idxView = pushBuffer(idx, 34963);
    accessors.push({ bufferView: posView, componentType: 5126, count, type: 'VEC3', min, max });
    accessors.push({ bufferView: norView, componentType: 5126, count, type: 'VEC3' });
    accessors.push({ bufferView: idxView, componentType: count > 65535 ? 5125 : 5123, count, type: 'SCALAR' });
    const base = accessors.length - 3;
    meshes.push({ name: 'mesh', primitives: [{ attributes: { POSITION: base, NORMAL: base + 1 }, indices: base + 2, material: materialIndex, mode: 4 }] });
    return meshes.length - 1;
  };
  const addNode = (spec) => {
    const node = { name: spec.name };
    if (spec.translation) node.translation = spec.translation;
    if (spec.geometry) { node.mesh = addGeometry(spec.geometry, spec.material); meshes[node.mesh].name = spec.name; }
    if (spec.children) node.children = spec.children.map(addNode);
    nodes.push(node);
    return nodes.length - 1;
  };
  const materials = [
    { name: 'frame', pbrMetallicRoughness: { baseColorFactor: [...def.color, 1], metallicFactor: def.metallic, roughnessFactor: def.roughness }, doubleSided: true },
    { name: 'lens', pbrMetallicRoughness: { baseColorFactor: [...def.lens_tint, def.lens_alpha], metallicFactor: 0, roughnessFactor: 0.05 }, alphaMode: 'BLEND', doubleSided: true },
    { name: 'pad', pbrMetallicRoughness: { baseColorFactor: [0.9, 0.9, 0.9, 0.6], metallicFactor: 0, roughnessFactor: 0.6 }, alphaMode: 'BLEND', doubleSided: true },
  ];
  const a = anchorFromDef(def);
  const rootIndex = addNode({
    name: def.frame_id,
    children: [
      { name: 'frame_front', geometry: built.front, material: 0 },
      { name: 'nose_pads', geometry: built.pads, material: 2 },
      { name: 'lens_L', geometry: built.lensL, material: 1 },
      { name: 'lens_R', geometry: built.lensR, material: 1 },
      { name: 'temple_L', geometry: built.templeL, material: 0 },
      { name: 'temple_R', geometry: built.templeR, material: 0 },
      { name: 'anchor_bridge', translation: a.bridge },
      { name: 'anchor_temple_L', translation: a.temple_left },
      { name: 'anchor_temple_R', translation: a.temple_right },
    ],
  });
  const json = { asset: { version: '2.0', generator: 'glassfitting-poc gen-frames.mjs (procedural)' }, scene: 0, scenes: [{ nodes: [rootIndex] }], nodes, meshes, accessors, bufferViews, materials, buffers: [{ byteLength: binLength }] };
  writeFileSync(path, packGlb(json, Buffer.concat(bin.map((b) => Buffer.from(b)))));
}

/** Adds spec extras and validates a GLB against docs/assets/glb-spec.md. */
function postprocess(path, def, source) {
  const { json, bin } = readGlb(path);
  json.asset = { ...json.asset, extras: { units: 'mm', origin: 'bridge (nose contact)', source, frame_id: def.frame_id } };
  const names = json.nodes.map((n) => n.name);
  const missing = REQUIRED_NODES.filter((n) => !names.includes(n));
  if (missing.length) throw new Error(`${def.frame_id}: missing nodes ${missing.join(', ')}`);
  const meshBounds = (nodeName) => {
    const node = json.nodes.find((n) => n.name === nodeName);
    if (!node || node.mesh === undefined) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of json.meshes[node.mesh].primitives) {
      const acc = json.accessors[p.attributes.POSITION];
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], acc.min[k]); max[k] = Math.max(max[k], acc.max[k]); }
    }
    const t = node.translation ?? [0, 0, 0];
    return { min: min.map((v, k) => v + t[k]), max: max.map((v, k) => v + t[k]) };
  };
  const front = meshBounds('frame_front');
  const lens = meshBounds('lens_L');
  const width = front.max[0] - front.min[0];
  const lensWidth = lens.max[0] - lens.min[0];
  const widthErr = Math.abs(width - def.spec.frame_width_mm);
  const lensErr = Math.abs(lensWidth - def.spec.lens_width_mm);
  const triangles = json.meshes.reduce((t, m) => t + m.primitives.reduce((s, p) => s + json.accessors[p.indices].count / 3, 0), 0);
  const hinge = json.nodes.find((n) => n.name === 'anchor_temple_R').translation ?? [0, 0, 0];
  const anchor = anchorFromDef(def);
  const hingeErr = Math.hypot(...hinge.map((v, k) => v - anchor.temple_right[k]));
  const out = packGlb(json, bin);
  writeFileSync(path, out);
  console.log(`[gen-frames] ${def.frame_id} (${source}): ${(out.length / 1024).toFixed(0)} KB, ${triangles} tris, width ${width.toFixed(2)} (spec ${def.spec.frame_width_mm}, err ${widthErr.toFixed(2)}), lens ${lensWidth.toFixed(2)} (spec ${def.spec.lens_width_mm}, err ${lensErr.toFixed(2)}), hinge err ${hingeErr.toFixed(2)}`);
  if (widthErr > 1 || lensErr > 1) throw new Error(`${def.frame_id}: dimension error exceeds 1 mm`);
  if (hingeErr > 0.01) throw new Error(`${def.frame_id}: anchor_temple_R ${hinge} ≠ frames.json anchor ${anchor.temple_right}`);
  if (triangles > MAX_TRIANGLES) throw new Error(`${def.frame_id}: ${triangles} triangles > ${MAX_TRIANGLES}`);
  return { triangles, bytes: out.length };
}

const thumbnailSvg = (def) => {
  const { lens_width_mm: lw, bridge_mm: b, lens_height_mm: lh } = def.spec;
  const c = `rgb(${def.color.map((v) => Math.round(v * 255)).join(',')})`;
  const rx = def.shape === 'round' ? lw / 2 : 6;
  const lens = (x) => `<rect x="${x}" y="${30 - lh / 2}" width="${lw}" height="${lh}" rx="${rx}" fill="none" stroke="${c}" stroke-width="3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-80 0 160 60">${lens(-b / 2 - lw)}${lens(b / 2)}<line x1="${-b / 2}" y1="24" x2="${b / 2}" y2="24" stroke="${c}" stroke-width="3"/></svg>`;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const blender = findBlender();
let source = 'procedural';
if (blender) {
  console.log(`[gen-frames] Blender: ${blender}`);
  runBlender(blender, 'frame_builder.py', ['--frames', FRAMES_JSON, '--out', assetDir]);
  runBlender(blender, 'head_builder.py', ['--face', join(modelDir, 'canonical_face_model.obj'), '--out', join(modelDir, 'head_occluder.glb')]);
  source = 'blender';
} else {
  console.log('[gen-frames] Blender not found (set BLENDER=/path or install it) — writing procedural fallback geometry');
  for (const def of FRAMES) writeProceduralGlb(join(assetDir, `${def.frame_id}.glb`), def);
}

const items = [];
for (const def of FRAMES) {
  const glbPath = join(assetDir, `${def.frame_id}.glb`);
  postprocess(glbPath, def, source);
  writeFileSync(join(assetDir, `${def.frame_id}.svg`), thumbnailSvg(def));
  const item = {
    frame_id: def.frame_id,
    name: def.name,
    spec: def.spec,
    assets: { glb_url: `/assets/frames/${def.frame_id}.glb`, thumbnail_url: `/assets/frames/${def.frame_id}.svg`, anchor: anchorFromDef(def) },
    fit_hints: { ...def.fit_hints, shape: def.shape },
    version: 2,
    updated_at: '2026-09-08T00:00:00Z',
  };
  items.push(item);
  writeFileSync(join(apiDir, 'frames', `${def.frame_id}.json`), JSON.stringify(item, null, 2));
}
writeFileSync(join(apiDir, 'frames.json'), JSON.stringify({ items, page: 1, size: items.length, total: items.length }, null, 2));
console.log(`[gen-frames] wrote ${items.length} frames + mock API to ${apiDir}`);

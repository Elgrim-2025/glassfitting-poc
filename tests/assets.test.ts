import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { anchorFromDef, loadFrameDefs } from '../scripts/lib/frame-defs.mjs';

const REQUIRED_NODES = ['anchor_bridge', 'anchor_temple_L', 'anchor_temple_R', 'lens_L', 'lens_R', 'temple_L', 'temple_R', 'frame_front'];

function readGlbJson(path: string) {
  const buf = readFileSync(path);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  expect(buf.readUInt32LE(4)).toBe(2);
  expect(buf.readUInt32LE(8)).toBe(buf.length);
  const jsonLen = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a); // JSON chunk
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

const pub = (rel: string) => new URL(`../public/${rel}`, import.meta.url).pathname;

describe('sample GLB frames', () => {
  const defs = loadFrameDefs();
  for (const def of defs) {
    const id = def.frame_id;
    it(`${id}.glb follows the asset spec (nodes, mm units, ≤ 50k triangles, hinge anchors)`, () => {
      const gltf = readGlbJson(pub(`assets/frames/${id}.glb`));
      const names = gltf.nodes.map((n: { name: string }) => n.name);
      for (const n of REQUIRED_NODES) expect(names).toContain(n);
      expect(gltf.asset.extras.units).toBe('mm');
      const tris = gltf.meshes.reduce((t: number, m: { primitives: { indices: number }[] }) => t + m.primitives.reduce((s, p) => s + gltf.accessors[p.indices].count / 3, 0), 0);
      expect(tris).toBeLessThan(50000);
      // Lens materials are separate and alpha-blended (spec §3).
      const lensNode = gltf.nodes.find((n: { name: string }) => n.name === 'lens_L');
      const lensMat = gltf.materials[gltf.meshes[lensNode.mesh].primitives[0].material];
      expect(lensMat.alphaMode).toBe('BLEND');
      // frame_front width matches the spec within 1 mm (spec §4).
      const front = gltf.nodes.find((n: { name: string }) => n.name === 'frame_front');
      const acc = gltf.accessors[gltf.meshes[front.mesh].primitives[0].attributes.POSITION];
      expect(Math.abs(acc.max[0] - acc.min[0] - def.spec.frame_width_mm)).toBeLessThanOrEqual(1);
      // Hinge empties match the product-master anchor derived from frames.json.
      const anchor = anchorFromDef(def);
      const item = JSON.parse(readFileSync(pub(`api/v1/frames/${id}.json`), 'utf8'));
      expect(item.assets.anchor.temple_right).toEqual(anchor.temple_right);
      expect(item.assets.anchor.temple_bend_mm).toBe(anchor.temple_bend_mm);
      const templeR = gltf.nodes.find((n: { name: string }) => n.name === 'anchor_temple_R');
      templeR.translation.forEach((v: number, k: number) => expect(v).toBeCloseTo(anchor.temple_right[k], 3));
      // The hinge sits just inside the frame's outer edge (temple flush with the end piece).
      expect(def.spec.frame_width_mm / 2 - anchor.temple_right[0]).toBeGreaterThanOrEqual(0);
      expect(def.spec.frame_width_mm / 2 - anchor.temple_right[0]).toBeLessThanOrEqual(3);
    });
  }
  it('the mock list endpoint returns all frames', () => {
    const list = JSON.parse(readFileSync(pub('api/v1/frames.json'), 'utf8'));
    expect(list.items.map((i: { frame_id: string }) => i.frame_id)).toEqual(defs.map((d) => d.frame_id));
  });
});

describe('head occluder', () => {
  it('head_occluder.glb is a single mesh with < 5k triangles', () => {
    const path = pub('models/head_occluder.glb');
    expect(existsSync(path)).toBe(true);
    const gltf = readGlbJson(path);
    expect(gltf.meshes.length).toBe(1);
    const tris = gltf.meshes[0].primitives.reduce((s: number, p: { indices: number }) => s + gltf.accessors[p.indices].count / 3, 0);
    expect(tris).toBeLessThan(5000);
    const acc = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
    // Skull + ears span roughly a head: ≥ 150 mm wide, ≥ 170 mm tall, and stays behind the nose (z ≤ 45).
    expect(acc.max[0] - acc.min[0]).toBeGreaterThan(150);
    expect(acc.max[1] - acc.min[1]).toBeGreaterThan(170);
    expect(acc.max[2]).toBeLessThan(45);
  });
});

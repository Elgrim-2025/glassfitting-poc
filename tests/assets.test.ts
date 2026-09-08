import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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

describe('sample GLB frames', () => {
  for (const id of ['FR-0001', 'FR-0002', 'FR-0003']) {
    it(`${id}.glb follows the asset spec (nodes, mm units, ≤ 50k triangles)`, () => {
      const gltf = readGlbJson(new URL(`../public/assets/frames/${id}.glb`, import.meta.url).pathname);
      const names = gltf.nodes.map((n: { name: string }) => n.name);
      for (const n of REQUIRED_NODES) expect(names).toContain(n);
      expect(gltf.asset.extras.units).toBe('mm');
      const tris = gltf.meshes.reduce((t: number, m: { primitives: { indices: number }[] }) => t + gltf.accessors[m.primitives[0].indices].count / 3, 0);
      expect(tris).toBeLessThan(50000);
      const item = JSON.parse(readFileSync(new URL(`../public/api/v1/frames/${id}.json`, import.meta.url).pathname, 'utf8'));
      expect(item.assets.anchor.temple_right[0]).toBeCloseTo(item.spec.frame_width_mm / 2, 6);
      const templeR = gltf.nodes.find((n: { name: string }) => n.name === 'anchor_temple_R');
      expect(templeR.translation[0]).toBeCloseTo(item.spec.frame_width_mm / 2, 6);
    });
  }
  it('the mock list endpoint returns all frames', () => {
    const list = JSON.parse(readFileSync(new URL('../public/api/v1/frames.json', import.meta.url).pathname, 'utf8'));
    expect(list.items.map((i: { frame_id: string }) => i.frame_id)).toEqual(['FR-0001', 'FR-0002', 'FR-0003']);
  });
});

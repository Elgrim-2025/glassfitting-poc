import { describe, expect, it } from 'vitest';
import { CANONICAL_VERTICES_MM } from '../../src/core/fitting/canonical';
import { BROW_TRIS, CHEEK_L_TRIS, CHEEK_R_TRIS, NOSE_TRIS, surfaceZ } from '../../src/core/fitting/faceSurface';

/** Reference surface heights of the canonical model (mm), ray-cast through the full mesh. */
const REFERENCE: [number, number, number][] = [
  [0, 24.7, 57.9],   // landmark 6, nose bridge at pupil level
  [8, 20, 53.8],     // nose flank where an acetate pad rests
  [10, 10, 57.0],
  [6, 15, 60.7],
  [12, 5, 56.1],
  [-8, 20, 53.8],    // mirror
];

describe('faceSurface regions', () => {
  it('have enough triangles and the nose region spans the ridge', () => {
    expect(NOSE_TRIS.length / 3).toBeGreaterThan(60);
    expect(BROW_TRIS.length / 3).toBeGreaterThan(25);
    expect(CHEEK_L_TRIS.length).toBe(CHEEK_R_TRIS.length);
    expect(CHEEK_L_TRIS.length / 3).toBeGreaterThan(25);
  });
});

describe('surfaceZ', () => {
  it('interpolates the canonical nose surface within 0.6 mm of a full-mesh ray cast', () => {
    for (const [x, y, z] of REFERENCE) {
      const got = surfaceZ(CANONICAL_VERTICES_MM, NOSE_TRIS, x, y);
      expect(got, `z(${x}, ${y})`).not.toBeNull();
      expect(Math.abs(got! - z), `z(${x}, ${y}) = ${got}`).toBeLessThan(0.6);
    }
  });
  it('returns null outside the region', () => {
    expect(surfaceZ(CANONICAL_VERTICES_MM, NOSE_TRIS, 60, 0)).toBeNull();
    expect(surfaceZ(CANONICAL_VERTICES_MM, BROW_TRIS, 0, -40)).toBeNull();
  });
  it('follows the user points, not the canonical ones', () => {
    const shifted = new Float32Array(CANONICAL_VERTICES_MM);
    for (let i = 0; i < shifted.length; i += 3) shifted[i + 2] -= 5;
    expect(surfaceZ(shifted, NOSE_TRIS, 8, 20)!).toBeCloseTo(surfaceZ(CANONICAL_VERTICES_MM, NOSE_TRIS, 8, 20)! - 5, 6);
  });
});

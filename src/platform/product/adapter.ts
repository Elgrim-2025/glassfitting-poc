/** Read-only client for the product-master API (docs/api/openapi.yaml). Mock = static JSON under /api/v1. */
import type { AssetAnchor, FrameSpec } from '../../core/types';

export interface ProductFrame {
  frame_id: string;
  name: string;
  spec: FrameSpec;
  assets: { glb_url: string; thumbnail_url: string; anchor: AssetAnchor };
  fit_hints?: { recommended_pd_range_mm: [number, number]; shape?: 'square' | 'round' | 'aviator' | 'wellington' };
  version: number;
  updated_at: string;
}

export interface FitSessionPayload {
  frame_id: string | null;
  pd_far: number;
  pd_near: number;
  pd_mono_left: number;
  pd_mono_right: number;
  confidence: number;
  sample_count: number;
  device: string;
  consent: true;
}

export class ProductAdapter {
  constructor(private baseUrl = '/api/v1') {}

  async list(): Promise<ProductFrame[]> {
    // Mock: static file. Real API: GET /v1/frames?page=&size=&updated_after=
    const candidates = [`${this.baseUrl}/frames.json`, `${this.baseUrl}/frames?page=1&size=100`];
    let lastErr: unknown = null;
    for (const url of candidates) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        const body = (await res.json()) as { items: ProductFrame[] };
        return body.items;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('product list unavailable');
  }

  async get(frameId: string): Promise<ProductFrame> {
    const res = await fetch(`${this.baseUrl}/frames/${encodeURIComponent(frameId)}.json`);
    if (!res.ok) throw new Error(`frame ${frameId}: HTTP ${res.status}`);
    return (await res.json()) as ProductFrame;
  }

  /** Optional numeric-only session log (spec §부록 B). No server in the PoC: logged to console. */
  async postFitSession(payload: FitSessionPayload): Promise<void> {
    console.info('[product-adapter] POST /v1/fit-sessions (mock)', payload);
  }
}

export function inferShape(item: ProductFrame): 'square' | 'round' | 'aviator' | 'wellington' {
  if (item.fit_hints?.shape) return item.fit_hints.shape;
  const n = item.name.toLowerCase();
  if (n.includes('라운드') || n.includes('round')) return 'round';
  if (n.includes('보잉') || n.includes('aviator')) return 'aviator';
  return 'square';
}

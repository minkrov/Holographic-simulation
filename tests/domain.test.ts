import { describe, expect, it } from 'vitest';
import {
  applyProposal,
  availableDistances,
  chooseRevision,
  createWorkspace,
  getAsset,
  length,
  makeDistance,
  reviewEvidence,
  revise,
  undoProject,
  type PointRef,
  type Revision,
} from '../src/core/domain';
import { localPlan, safePlan } from '../src/core/intent';
import { preflightGlb, preflightStl } from '../src/core/verify';
import { describeVisual, disposeModel, readVisual } from '../src/scene/model';

const context = () => {
  const s = createWorkspace();
  return { p: s.projects[0], v: s.sessions[s.active].view, draft: s.sessions[s.active].proposal! };
};

describe('project and geometry contracts', () => {
  it('derives the 42/44 mm fixture from immutable points, not from a display offset', () => {
    const { p, v } = context();
    for (const explode of [0, 18, 30]) {
      const result = reviewEvidence(p, { ...v, explode }, true)!;
      expect(result.baseline?.mm).toBeCloseTo(42, 8);
      expect(result.current.mm).toBeCloseTo(44, 8);
      expect(length(result.current.mm - result.baseline!.mm, 'mm', true)).toBe('+2.0 mm');
    }
  });
  it('rejects cross-revision and coincident points', () => {
    const a: PointRef = { revisionId: 'a', partId: 'p', label: 'A', point: [0, 0, 0] };
    expect(() => makeDistance(a, { ...a, revisionId: 'b', point: [0, 1, 3] }, 'mesh')).toThrow(
      /same revision/,
    );
    expect(() => makeDistance(a, { ...a, label: 'B' }, 'entered')).toThrow(/distinct/);
    expect(() => makeDistance(a, { ...a, point: [NaN, 0, 0] }, 'entered')).toThrow(/finite/);
    expect(makeDistance(a, { ...a, label: 'B', point: [0.003, 0.004, 0] }, 'entered').mm).toBeCloseTo(
      5,
      8,
    );
  });
  it('does not treat mesh picks and authored features as comparable without matching point pairs', () => {
    const { p, v } = context(),
      e = reviewEvidence(p, v, true)!;
    const fallback = { ...e.current, method: 'mesh' as const };
    expect(reviewEvidence(p, { ...v, distances: { [v.revisionId!]: fallback } }, true)).toBeUndefined();
  });
  it('links the exact confirmed pairs the user reviewed, never a replacement pair', () => {
    const { p, v } = context(),
      { current, baseline } = availableDistances(p, v);
    const one = { ...current!, id: 'first', method: 'mesh' as const },
      two = { ...baseline!, id: 'second', method: 'entered' as const };
    const distances = { [v.revisionId!]: one, [v.baselineId!]: two };
    expect(reviewEvidence(p, { ...v, distances }, true)).toBeUndefined();
    const linked = { ...v, distances, linkedPair: { currentId: one.id, baselineId: two.id } };
    expect(reviewEvidence(p, linked, true)?.title).toBe('Point distance');
    expect(
      reviewEvidence(
        p,
        { ...linked, distances: { ...distances, [v.baselineId!]: { ...two, id: 'replacement' } } },
        true,
      ),
    ).toBeUndefined();
    expect(reviewEvidence(p, { ...linked, partId: 'base' }, true)).toBeUndefined();
  });
  it('keeps project revision and files separate from presentation state and undo', () => {
    const { p, draft } = context();
    const { project: next, saved } = applyProposal(p, draft);
    expect(next.version).toBe(1);
    expect(next.assets).toBe(p.assets);
    expect(saved.view.explode).toBe(18);
    expect(saved.evidence?.id).toBe('M-014');
    expect(() => applyProposal(next, draft)).toThrow(/already/);
    const undone = undoProject(next)!;
    expect(undone.views).toEqual(p.views);
    expect(undone.version).toBe(next.version + 1);
    expect(() => applyProposal(undone, draft)).toThrow(/changed/);
  });
  it('won’t apply a stale preview or compare a revision to itself', () => {
    const { p, v, draft } = context();
    expect(() => applyProposal(revise(p, 'rename', { name: 'Updated project' }), draft)).toThrow(
      /changed/,
    );
    const a = getAsset(p, v)!;
    expect(chooseRevision(v, a, a.revisions[1]).baselineId).toBe(null);
  });
});

describe('bounded intent', () => {
  it('recognizes a review and ignores out-of-scope actions', () => {
    expect(localPlan('Compare both revisions and save a review view.')).toEqual({ action: 'review' });
    expect(localPlan('What changed from the previous revision?')).toEqual({ action: 'compare' });
    expect(localPlan('Show front view')).toEqual({ action: 'view', preset: 'front' });
    expect(safePlan({ action: 'execute', command: 'anything' })).toBeNull();
    expect(safePlan({ action: 'view', preset: 'unknown' })).toBeNull();
    expect(safePlan({ action: 'review', file: 'ignored' })).toEqual({ action: 'review' });
  });
});

function binaryGlb(doc: object, data = new Uint8Array(36)) {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const length = (json.byteLength + 3) & ~3;
  const out = new ArrayBuffer(28 + length + data.byteLength),
    v = new DataView(out),
    bytes = new Uint8Array(out);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.byteLength, true);
  v.setUint32(12, length, true);
  v.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + length);
  bytes.set(json, 20);
  v.setUint32(20 + length, data.byteLength, true);
  v.setUint32(24 + length, 0x004e4942, true);
  bytes.set(data, 28 + length);
  return out;
}
const manifest = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [
    { count: 3, type: 'VEC3', componentType: 5126, bufferView: 0, min: [0, 0, 0], max: [0.04, 0.02, 0] },
  ],
  bufferViews: [{ buffer: 0, byteLength: 36 }],
  buffers: [{ byteLength: 36 }],
};
describe('file validation limits', () => {
  it('accepts a small embedded manifest and rejects incomplete files', () => {
    const valid = binaryGlb(manifest);
    expect(preflightGlb(valid)).toEqual({ triangles: 1 });
    expect(() => preflightGlb(valid.slice(0, -1))).toThrow(/complete/);
  });
  it('rejects network references, unsupported geometry and oversized decoded buffers before parsing', () => {
    expect(() =>
      preflightGlb(binaryGlb({ ...manifest, images: [{ uri: 'https://example.invalid/x.png' }] })),
    ).toThrow(/self-contained/);
    expect(() =>
      preflightGlb(binaryGlb({ ...manifest, extensionsRequired: ['KHR_draco_mesh_compression'] })),
    ).toThrow(/Unsupported/);
    expect(() =>
      preflightGlb(binaryGlb({ ...manifest, accessors: [{ count: 500_000_000, type: 'VEC3' }] })),
    ).toThrow(/decoded/);
    expect(() => preflightGlb(binaryGlb({ ...manifest, nodes: [{ mesh: 0, children: [0] }] }))).toThrow(
      /hierarchy/,
    );
  });
  it('recognizes bounded binary STL and rejects invalid ASCII STL', () => {
    const stl = new ArrayBuffer(134);
    new DataView(stl).setUint32(80, 1, true);
    expect(preflightStl(stl)).toEqual({ triangles: 1 });
    new DataView(stl).setFloat32(96, Infinity, true);
    expect(() => preflightStl(stl)).toThrow(/finite/);
    expect(() => preflightStl(new TextEncoder().encode('not a valid stl file').buffer)).toThrow(
      /not a complete/,
    );
  });
});

it('keeps transformed GLB instances distinct and reads bounds in canonical model space', async () => {
  const coordinates = new Float32Array([0, 0, 0, 0.04, 0, 0, 0, 0.02, 0]);
  const doc = {
    ...manifest,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'Bracket', mesh: 0, translation: [0.1, 0, 0] },
      {
        name: 'Bracket',
        mesh: 0,
        translation: [-0.1, 0, 0],
        rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        scale: [2, 1, 1],
      },
    ],
  };
  const rev: Revision = {
    id: 'test',
    label: 'r01',
    fileName: 'brackets.glb',
    format: 'glb',
    parts: [],
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    confirmed: true,
    multiplier: 1,
    imported: '2026-11-18',
  };
  const model = await readVisual(rev, binaryGlb(doc, new Uint8Array(coordinates.buffer)));
  try {
    const meta = describeVisual(model);
    expect(meta.parts.map((part) => [part.id, part.name])).toEqual([
      ['node-0', 'Bracket'],
      ['node-1', 'Bracket'],
    ]);
    expect(meta.parts[1].bounds.min[0]).toBeCloseTo(-0.12, 7);
    expect(meta.parts[1].bounds.max[1]).toBeCloseTo(0.08, 7);
    expect(meta.bounds.max[0]).toBeCloseTo(0.14, 7);
  } finally {
    disposeModel(model);
  }
});

export type Vec3 = [number, number, number];
export type Bounds = { min: Vec3; max: Vec3 };
export type Units = 'mm' | 'cm' | 'in' | 'm';
export type Look = 'solid' | 'edges' | 'xray';
export type Preset = 'iso' | 'front' | 'top' | 'right' | 'back';
export type Projection = 'ortho' | 'perspective';
export type Axis = 'x' | 'y' | 'z';
export type Format = 'sample' | 'glb' | 'stl';

export interface Part {
  id: string;
  name: string;
  bounds: Bounds;
  datums?: readonly { id: string; point: Vec3 }[];
}
export interface Revision {
  id: string;
  label: string;
  fileName: string;
  format: Format;
  key?: string;
  parts: Part[];
  bounds: Bounds;
  triangles?: number;
  confirmed: boolean;
  multiplier: number;
  up?: 'y' | 'z';
  imported: string;
  source?: string;
  author?: string;
  license?: string;
  warnings?: string[];
}
export interface Asset {
  id: string;
  name: string;
  revisions: Revision[];
}
export interface PointRef {
  revisionId: string;
  partId: string;
  point: Vec3;
  label: string;
}
export interface Distance {
  id: string;
  mm: number;
  method: 'authored' | 'mesh' | 'entered';
  a: PointRef;
  b: PointRef;
}
export interface DistancePair {
  current?: Distance;
  baseline?: Distance;
}
export interface Evidence {
  id: string;
  title: string;
  current: Distance;
  baseline?: Distance;
}
export interface CameraPose {
  position: Vec3;
  target: Vec3;
  height: number;
  up?: Vec3;
}
export interface View {
  assetId: string | null;
  revisionId: string | null;
  baselineId: string | null;
  compare: 'split' | 'overlay';
  partId: string | null;
  hidden: string[];
  isolate: boolean;
  look: Look;
  projection: Projection;
  preset: Preset;
  explode: number;
  section: { enabled: boolean; axis: Axis; percent: number; flip: boolean };
  distances: Record<string, Distance>;
  linkedPair?: { currentId: string; baselineId: string };
  labels: boolean;
}
export interface SavedView {
  id: string;
  name: string;
  view: View;
  pose?: CameraPose;
  evidence?: Evidence;
  created: string;
}
export interface Proposal {
  id: string;
  base: number;
  name: string;
  view: View;
  pose?: CameraPose;
  evidence?: Evidence;
  sample?: boolean;
}
export interface Session {
  view: View;
  pose?: CameraPose;
  proposal?: Proposal;
  savedId?: string;
}
interface Previous {
  assets: Asset[];
  views: SavedView[];
  name: string;
  label: string;
}
export interface Project {
  id: string;
  name: string;
  assets: Asset[];
  views: SavedView[];
  version: number;
  undo: Previous[];
}
export interface Workspace {
  schema: 1;
  active: string;
  projects: Project[];
  sessions: Record<string, Session>;
  preferences: { units: Units; shortcuts: boolean; connectorDestination?: string };
}

export const SAMPLE_PROJECT = 'bench-enclosure';
export const SAMPLE_ASSET = 'enclosure';
export const SAMPLE_ACTIVE = 'bench-r07';
export const SAMPLE_PREVIOUS = 'bench-r06';
export const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const stamp = () => new Date().toISOString();
export const EPS = 1e-8;
export const isoDirection: Vec3 = [0.50383, 0.515038, 0.693414];
export const SAMPLE_POSE: CameraPose = {
  position: [0.50383 * 0.48, 0.0238 + 0.515038 * 0.48, 0.693414 * 0.48],
  target: [0, 0.0238, 0],
  height: 0.135,
};
export const DEFAULT_VIEW: View = {
  assetId: null,
  revisionId: null,
  baselineId: null,
  compare: 'split',
  partId: null,
  hidden: [],
  isolate: false,
  look: 'edges',
  projection: 'ortho',
  preset: 'iso',
  explode: 0,
  section: { enabled: false, axis: 'x', percent: 0, flip: false },
  distances: {},
  labels: true,
};

const box = (x: number, z: number, low: number, high: number): Bounds => ({
  min: [-x, low, -z],
  max: [x, high, z],
});
const date = '2026-11-18T00:00:00.000Z';
export function sampleRevision(id: string): Revision {
  const isOld = id === SAMPLE_PREVIOUS;
  return {
    id,
    label: isOld ? 'r06' : 'r07',
    fileName: 'bench-enclosure.glb',
    format: 'sample',
    multiplier: 1,
    bounds: box(0.0595, 0.041, 0, 0.024),
    confirmed: true,
    imported: date,
    source: 'Orion reference fixture · generated in this app',
    author: 'Orion Workbench',
    parts: [
      { id: 'cover', name: 'Cover', bounds: box(0.0595, 0.041, 0.019, 0.024) },
      {
        id: 'mount',
        name: 'Mount plate',
        bounds: box(0.056, 0.0375, 0.013, 0.017),
        datums: [
          { id: 'A', point: [-0.022, 0.017, -0.005] },
          { id: 'B', point: [isOld ? 0.02 : 0.022, 0.017, -0.005] },
        ],
      },
      { id: 'base', name: 'Base', bounds: box(0.0595, 0.041, 0, 0.011) },
    ],
  };
}

export function createProject(name: string): Project {
  return { id: uid(), name, assets: [], views: [], version: 0, undo: [] };
}

export function createWorkspace(): Workspace {
  const demoView: View = {
    ...DEFAULT_VIEW,
    assetId: SAMPLE_ASSET,
    revisionId: SAMPLE_ACTIVE,
    baselineId: SAMPLE_PREVIOUS,
    partId: 'mount',
    compare: 'overlay',
    explode: 18,
  };
  const asset: Asset = {
    id: SAMPLE_ASSET,
    name: 'Enclosure',
    revisions: [sampleRevision(SAMPLE_ACTIVE), sampleRevision(SAMPLE_PREVIOUS)],
  };
  const project: Project = {
    id: SAMPLE_PROJECT,
    name: 'Bench enclosure',
    assets: [asset],
    version: 0,
    undo: [],
    views: [
      {
        id: 'overview',
        name: 'Overview',
        view: { ...demoView, baselineId: null, partId: null, explode: 0, look: 'solid' },
        created: date,
      },
      {
        id: 'assembly',
        name: 'Assembly check',
        view: { ...demoView, baselineId: null },
        pose: SAMPLE_POSE,
        created: date,
      },
    ],
  };
  const evidence = reviewEvidence(project, demoView, true, 'M-014');
  const proposal: Proposal = {
    id: 'sample-review',
    name: 'Hole spacing',
    base: 0,
    view: demoView,
    pose: SAMPLE_POSE,
    evidence,
    sample: true,
  };
  return {
    schema: 1,
    active: project.id,
    projects: [project],
    sessions: { [project.id]: { view: demoView, pose: SAMPLE_POSE, proposal } },
    preferences: { units: 'mm', shortcuts: true },
  };
}

export function getAsset(project: Project, view: View): Asset | undefined {
  return project.assets.find((item) => item.id === view.assetId);
}
export function getRevision(project: Project, view: View, baseline = false): Revision | undefined {
  return getAsset(project, view)?.revisions.find(
    (rev) => rev.id === (baseline ? view.baselineId : view.revisionId),
  );
}
export function chooseRevision(view: View, asset: Asset, revision: Revision): View {
  const same = view.assetId === asset.id;
  const baselineId = same && view.baselineId !== revision.id ? view.baselineId : null;
  return {
    ...view,
    assetId: asset.id,
    revisionId: revision.id,
    baselineId,
    partId: same && revision.parts.some((part) => part.id === view.partId) ? view.partId : null,
    hidden: [],
    isolate: false,
    compare:
      revision.format === 'sample' &&
      asset.revisions.find((r) => r.id === baselineId)?.format === 'sample'
        ? 'overlay'
        : 'split',
    explode: same ? view.explode : 0,
    section: { ...view.section, enabled: false },
  };
}
export function reconcileView(project: Project, view: View): View {
  const asset = getAsset(project, view) ?? project.assets[0];
  const revision = asset?.revisions.find((r) => r.id === view.revisionId) ?? asset?.revisions[0];
  if (!asset || !revision) return { ...DEFAULT_VIEW, look: view.look, labels: view.labels };
  if (revision.id !== view.revisionId || asset.id !== view.assetId)
    return chooseRevision(view, asset, revision);
  if (
    view.baselineId &&
    !asset.revisions.some((r) => r.id === view.baselineId && r.id !== view.revisionId)
  )
    return { ...view, baselineId: null };
  return view;
}

export function unitsValue(mm: number, unit: Units) {
  return mm / { mm: 1, cm: 10, in: 25.4, m: 1000 }[unit];
}
export function mmValue(value: number, unit: Units) {
  return value * { mm: 1, cm: 10, in: 25.4, m: 1000 }[unit];
}
export function length(mm: number, unit: Units, signed = false) {
  const value = unitsValue(mm, unit);
  const precision =
    unit === 'mm' ? (Math.abs(value) < 0.1 && value !== 0 ? 3 : 1) : unit === 'm' ? 4 : 3;
  const rounded = Math.round(Math.abs(value) * 10 ** precision) / 10 ** precision;
  return `${value < 0 && rounded !== 0 ? '−' : signed && value > 0 && rounded !== 0 ? '+' : ''}${rounded.toFixed(precision)} ${unit}`;
}
export function spans(b: Bounds): Vec3 {
  return b.min.map((x, i) => b.max[i] - x) as Vec3;
}
export function centre(b: Bounds): Vec3 {
  return b.min.map((x, i) => (b.max[i] + x) / 2) as Vec3;
}
export function validPoint(point: Vec3) {
  return point.length === 3 && point.every((x) => Number.isFinite(x) && Math.abs(x) <= 1_000_000);
}

export function makeDistance(
  a: PointRef,
  b: PointRef,
  method: Distance['method'],
  id = uid(),
): Distance {
  if (a.revisionId !== b.revisionId) throw new Error('Both points must be on the same revision.');
  if (!validPoint(a.point) || !validPoint(b.point))
    throw new Error('Enter three finite coordinates for each point.');
  const mm = Math.hypot(...a.point.map((x, i) => x - b.point[i])) * 1000;
  if (mm < 1e-7) throw new Error('Choose two distinct points.');
  return { id, a, b, method, mm };
}
export function authoredDistance(
  revision: Revision | undefined,
  partId: string | null,
): Distance | undefined {
  const part = revision?.parts.find((p) => p.id === partId);
  if (!revision?.confirmed || !part || !part.datums || part.datums.length < 2) return;
  const [a, b] = part.datums;
  return makeDistance(
    { revisionId: revision.id, partId: part.id, label: a.id, point: a.point },
    { revisionId: revision.id, partId: part.id, label: b.id, point: b.point },
    'authored',
    `${revision.id}-${part.id}`,
  );
}
export function availableDistances(project: Project, view: View): DistancePair {
  const rev = getRevision(project, view);
  const old = getRevision(project, view, true);
  const chosen = rev?.confirmed ? view.distances[rev.id] : undefined;
  const current =
    chosen && (!view.partId || chosen.a.partId === view.partId || chosen.b.partId === view.partId)
      ? chosen
      : authoredDistance(rev, view.partId);
  const baseline = old?.confirmed
    ? (view.distances[old.id] ?? authoredDistance(old, view.partId))
    : undefined;
  return { current, baseline };
}

export function reviewEvidence(
  project: Project,
  view: View,
  compare = false,
  id?: string,
): Evidence | undefined {
  const { current, baseline } = availableDistances(project, view);
  if (!current) return;
  if (compare) {
    if (!baseline) return;
    // Only the named datums of the same fixture are known to correspond by design.
    const nominal =
      current.method === 'authored' &&
      baseline.method === 'authored' &&
      current.a.partId === baseline.a.partId;
    const linked =
      view.linkedPair?.currentId === current.id && view.linkedPair.baselineId === baseline.id;
    if (!nominal && !linked) return;
  }
  const authored = current.method === 'authored' && (!compare || baseline?.method === 'authored');
  return {
    id: id ?? (authored ? 'M-014' : `M-${current.id.slice(0, 5).toUpperCase()}`),
    title: authored ? 'Hole spacing' : 'Point distance',
    current,
    baseline: compare ? baseline : undefined,
  };
}

export function revise(
  project: Project,
  label: string,
  patch: Partial<Pick<Project, 'assets' | 'views' | 'name'>>,
): Project {
  const previous = { assets: project.assets, views: project.views, name: project.name, label };
  return {
    ...project,
    ...patch,
    version: project.version + 1,
    undo: [...project.undo.slice(-15), previous],
  };
}
export function undoProject(project: Project): Project | undefined {
  const previous = project.undo.at(-1);
  if (!previous) return;
  return {
    ...project,
    assets: previous.assets,
    views: previous.views,
    name: previous.name,
    version: project.version + 1,
    undo: project.undo.slice(0, -1),
  };
}
export function newSavedView(
  name: string,
  view: View,
  pose?: CameraPose,
  evidence?: Evidence,
): SavedView {
  return {
    id: uid(),
    name: name.trim().slice(0, 64) || 'Inspection view',
    view: structuredClone(view),
    pose: pose && structuredClone(pose),
    evidence,
    created: stamp(),
  };
}
export function applyProposal(
  project: Project,
  proposal: Proposal,
): { project: Project; saved: SavedView } {
  if (project.views.some((v) => v.id === proposal.id))
    throw new Error('This review has already been saved.');
  if (proposal.base !== project.version)
    throw new Error('Project changed. Refresh the review before saving.');
  if (
    !getRevision(project, proposal.view) ||
    (proposal.view.baselineId && !getRevision(project, proposal.view, true))
  )
    throw new Error('A referenced revision is no longer available.');
  const saved = {
    ...newSavedView(proposal.name, proposal.view, proposal.pose, proposal.evidence),
    id: proposal.id,
  };
  return { project: revise(project, 'save review', { views: [...project.views, saved] }), saved };
}

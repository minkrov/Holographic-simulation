import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Box,
  Check,
  Command,
  Download,
  Image as ImageIcon,
  Layers2,
  PanelLeft,
  PanelRight,
  Plus,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  applyProposal,
  authoredDistance,
  availableDistances,
  chooseRevision,
  createProject,
  createWorkspace,
  DEFAULT_VIEW,
  getAsset,
  getRevision,
  length,
  makeDistance,
  newSavedView,
  reconcileView,
  reviewEvidence,
  revise,
  SAMPLE_PROJECT,
  spans,
  stamp,
  uid,
  undoProject,
  type Asset,
  type CameraPose,
  type PointRef,
  type Preset,
  type Project,
  type Proposal,
  type Revision,
  type SavedView,
  type Session,
  type View,
  type Workspace,
} from './core/domain';
import { prepareImport, type ImportOptions } from './core/import';
import { LOCAL, localPlan, PRESETS, safePlan, type Connector } from './core/intent';
import {
  download,
  fileStem,
  readBytes,
  readWorkspace,
  storeWorkspace,
  type StorageStatus,
} from './core/storage';
import { exportSample } from './scene/model';
import type { MeasureTool } from './scene/engine';
import {
  BaselineDialog,
  CoordinatesDialog,
  EvidenceDialog,
  ImportDialog,
  KeysDialog,
  ModelDetails,
  NameDialog,
  PairDialog,
  Palette,
  SettingsDialog,
  type PaletteItem,
} from './ui/dialogs';
import {
  ConsoleDock,
  Inspector,
  ProjectTree,
  StatusBar,
  type ActivityEntry,
  type ConsoleEntry,
} from './ui/panels';
import { Dialog, IconButton, Key, MenuRow, Popover, ResizeRail } from './ui/primitives';
import { Viewport, type ViewportHandle } from './ui/Viewport';

const STATIC_DEMO = import.meta.env.MODE === 'pages';
const ORION_MARK = `${import.meta.env.BASE_URL}orion.svg`;
const SAMPLE_INTENT = 'Compare these two revisions. Flag the hole spacing and save a review view.';
const DEFAULT_SESSION: Session = { view: DEFAULT_VIEW };
const time = () =>
  new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'The operation failed. Try again.';
const projectIn = (state: Workspace) =>
  state.projects.find((p) => p.id === state.active) ?? state.projects[0];
const sessionIn = (state: Workspace, id = state.active) => state.sessions[id] ?? DEFAULT_SESSION;

function seeded(session: Session): { entries: ConsoleEntry[]; events: ActivityEntry[] } {
  if (!session.proposal?.sample) return { entries: [], events: [] };
  const value = session.proposal.evidence;
  const delta = value?.baseline ? value.current.mm - value.baseline.mm : 0;
  return {
    entries: [
      { id: 'sample-input', role: 'you', text: SAMPLE_INTENT, scope: 'Mount plate · r06 → r07' },
      {
        id: 'sample-answer',
        role: 'engine',
        text: `Preview ready. Hole centres are ${length(delta, 'mm')} farther apart in r07.`,
      },
    ],
    events: [
      { id: 'sample-1', type: 'info', when: 'Sample', text: 'Reference fixture loaded · r06 and r07' },
      {
        id: 'sample-2',
        type: 'ok',
        when: 'Sample',
        text: 'M-014 · Compared two authored datums in both revisions',
      },
      {
        id: 'sample-3',
        type: 'run',
        when: 'Sample',
        text: 'Review preview ready · no project changes applied',
      },
    ],
  };
}

type Modal =
  | {
      kind:
        | 'palette'
        | 'keys'
        | 'settings'
        | 'baseline'
        | 'evidence'
        | 'pair'
        | 'coordinates'
        | 'save'
        | 'export';
    }
  | { kind: 'import'; file?: File; asRevision?: boolean }
  | { kind: 'project-name'; rename: boolean }
  | { kind: 'rename-view' | 'remove-view'; saved: SavedView }
  | { kind: 'details' | 'scale'; rev: Revision };

export default function App() {
  const [initial, setInitial] = useState<{ value: Workspace; available: boolean }>();
  useEffect(() => {
    let live = true;
    void readWorkspace().then(async (result) => {
      const value = result.value ?? createWorkspace();
      const available =
        result.available && (!!result.value || (await storeWorkspace(value)) === 'saved');
      if (live) setInitial({ value, available });
    });
    return () => {
      live = false;
    };
  }, []);
  if (!initial)
    return (
      <div className="boot">
        <img src={ORION_MARK} alt="" />
        <div>ORION</div>
        <span>Opening local workbench</span>
      </div>
    );
  return <Workbench initial={initial.value} available={initial.available} />;
}

function Workbench({ initial, available }: { initial: Workspace; available: boolean }) {
  const [data, setData] = useState(initial);
  const state = useRef(data);
  const [persistence, setPersistence] = useState<StorageStatus | 'saving'>(
    available ? 'saved' : 'memory',
  );
  const [connector, setConnector] = useState<Connector>(LOCAL);
  const [connectorError, setConnectorError] = useState(false);
  const [modal, setModal] = useState<Modal>();
  const [entries, setEntries] = useState(() => seeded(sessionIn(initial)).entries);
  const [events, setEvents] = useState(() => seeded(sessionIn(initial)).events);
  const [running, setRunning] = useState(false);
  const [runState, setRunState] = useState('');
  const [tool, setTool] = useState<MeasureTool>();
  const [busyImport, setBusyImport] = useState('');
  const [importError, setImportError] = useState('');
  const [toast, setToast] = useState<{ text: string; bad: boolean; id: string }>();
  const [restores, setRestores] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [smallPanel, setSmallPanel] = useState<'project' | 'inspect' | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({ w: innerWidth, h: innerHeight }));
  const [paneSize, setPaneSize] = useState<{ left?: number; right?: number; dock?: number }>({});
  const shell = useRef<HTMLDivElement>(null);
  const lastDrawer = useRef<typeof smallPanel>(null);
  const [focusConsole, setFocusConsole] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const viewport = useRef<ViewportHandle>(null);
  const activeRun = useRef<AbortController | null>(null);
  const activeImport = useRef<AbortController | null>(null);
  const poseTimer = useRef<number>(0);
  const persistenceRequest = useRef(0);
  const project = projectIn(data),
    session = sessionIn(data, project.id),
    view = session.view;
  const asset = getAsset(project, view),
    revision = getRevision(project, view),
    baseline = getRevision(project, view, true);
  const selected = revision?.parts.find((p) => p.id === view.partId);
  const { units } = data.preferences;
  const evidence = useMemo(
    () => reviewEvidence(project, view, !!view.baselineId) ?? reviewEvidence(project, view),
    [project, view],
  );
  const distances = useMemo(() => availableDistances(project, view), [project, view]);
  const { proposal, savedId } = session;
  const pin = proposal?.view,
    pinAsset = pin && getAsset(project, pin),
    pinRev = pin && getRevision(project, pin),
    pinOld = pin && getRevision(project, pin, true);
  const pinPart = pinRev?.parts.find((part) => part.id === pin?.partId);
  const missingPinnedRevision = !!pin && (!pinRev || (!!pin.baselineId && !pinOld));
  const proposalTarget = pinRev
    ? `${pinPart?.name ?? pinAsset?.name} · ${pinOld ? `${pinOld.label} → ` : ''}${pinRev.label}`
    : undefined;
  const reviewMatches = !!pin && JSON.stringify(pin) === JSON.stringify(view);
  const useConnector =
    !STATIC_DEMO &&
    connector.mode === 'connector' &&
    !!connector.destination &&
    data.preferences.connectorDestination === connector.destination;
  const { w, h } = windowSize,
    compact = w <= 964;
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const maxLeft = Math.min(360, Math.round(w * 0.26)),
    maxRight = Math.min(450, Math.round(w * 0.3)),
    maxDock = Math.max(150, Math.round(h * 0.47));
  const panelLeft = clamp(paneSize.left ?? Math.round(w * 0.1695), 177, paneSize.left ? maxLeft : 244);
  const panelRight = clamp(
    paneSize.right ?? Math.round(w * 0.2278),
    266,
    paneSize.right ? maxRight : 328,
  );
  const dockHeight = clamp(
    paneSize.dock ?? Math.round(h * 0.2156),
    paneSize.dock ? 111 : 151,
    paneSize.dock ? maxDock : 194,
  );
  const paneStyle = {
    ...(paneSize.left && !compact ? { '--left': `${panelLeft}px` } : {}),
    ...(paneSize.right && !compact ? { '--right': `${panelRight}px` } : {}),
    ...(paneSize.dock && !collapsed && w > 620 && h > 500 ? { '--dock': `${dockHeight}px` } : {}),
  } as CSSProperties;
  const sizePane = (key: keyof typeof paneSize, next?: number) =>
    setPaneSize((s) => ({ ...s, [key]: next }));

  useEffect(() => {
    const resize = () => setWindowSize({ w: innerWidth, h: innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!compact && smallPanel) {
      setSmallPanel(null);
      return;
    }
    if (smallPanel === lastDrawer.current) return;
    const previous = lastDrawer.current;
    lastDrawer.current = smallPanel;
    if (modal) return;
    const label =
      smallPanel === 'project'
        ? 'Close project panel'
        : smallPanel === 'inspect'
          ? 'Close inspector panel'
          : previous === 'project'
            ? 'Toggle project panel'
            : 'Toggle inspector';
    shell.current
      ?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?.focus({ preventScroll: true });
  }, [compact, smallPanel, modal]);

  useEffect(() => {
    if (STATIC_DEMO) return;
    const control = new AbortController();
    void fetch('/api/orion', { signal: control.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (
          value &&
          (value.mode === 'connector' || value.mode === 'local') &&
          typeof value.label === 'string'
        )
          setConnector(value);
      })
      .catch(() => undefined);
    return () => control.abort();
  }, []);
  useEffect(() => {
    if (modal?.kind !== 'export') setExportError('');
  }, [modal?.kind]);
  useEffect(() => {
    if (toast) {
      const stop = window.setTimeout(() => setToast(undefined), 3700);
      return () => clearTimeout(stop);
    }
  }, [toast]);
  useEffect(
    () => () => {
      clearTimeout(poseTimer.current);
      activeRun.current?.abort();
      activeImport.current?.abort();
    },
    [],
  );
  useEffect(() => {
    // A dropped file outside the viewport must not replace the workbench page.
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const notice = (text: string, bad = false) => setToast({ text, bad, id: uid() });
  function log(text: string, type: ActivityEntry['type'] = 'info') {
    setEvents((old) => [...old.slice(-99), { id: uid(), text, when: time(), type }]);
  }
  function say(text: string, role: ConsoleEntry['role'] = 'engine', scope?: string, label?: string) {
    setEntries((old) => [...old.slice(-79), { id: uid(), text, role, scope, label }]);
  }
  function write(next: Workspace, file?: { key: string; blob: Blob }) {
    const durable = next.projects !== state.current.projects;
    state.current = next;
    setData(next);
    const number = ++persistenceRequest.current;
    if (durable) setPersistence((s) => (s === 'saved' ? 'saving' : s));
    return storeWorkspace(next, file).then((result) => {
      if (number === persistenceRequest.current) setPersistence(result);
      return result;
    });
  }
  function alter(make: (value: Workspace) => Workspace, file?: { key: string; blob: Blob }) {
    return write(make(state.current), file);
  }
  function patchSession(patch: Partial<Session>, id = state.current.active) {
    alter((w) => ({ ...w, sessions: { ...w.sessions, [id]: { ...sessionIn(w, id), ...patch } } }));
  }
  function configure(patch: Partial<View>) {
    const active = sessionIn(state.current);
    const baselineChanged =
      patch.baselineId !== undefined && active.view.baselineId !== patch.baselineId;
    if (baselineChanged) clearTimeout(poseTimer.current);
    if (baselineChanged || (patch.compare === 'overlay' && tool?.revisionId === active.view.baselineId))
      setTool(undefined);
    patchSession({
      view: { ...active.view, ...patch },
      savedId: undefined,
      ...(baselineChanged ? { pose: undefined } : {}),
    });
  }
  function updateProject(next: Project, patch?: Partial<Session>, file?: { key: string; blob: Blob }) {
    return alter(
      (w) => ({
        ...w,
        projects: w.projects.map((p) => (p.id === next.id ? next : p)),
        sessions: patch
          ? { ...w.sessions, [next.id]: { ...sessionIn(w, next.id), ...patch } }
          : w.sessions,
      }),
      file,
    );
  }
  function newPose(pose: CameraPose) {
    clearTimeout(poseTimer.current);
    const id = state.current.active;
    poseTimer.current = window.setTimeout(() => {
      if (state.current.active === id) patchSession({ pose }, id);
    }, 160);
  }
  function setViewed(next: View, pose?: CameraPose, id?: string) {
    clearTimeout(poseTimer.current);
    setTool(undefined);
    patchSession({ view: next, pose, savedId: id });
    setRestores((n) => n + 1);
  }
  function orient(preset: Preset) {
    if (sessionIn(state.current).view.preset === preset) viewport.current?.orient(preset);
    else configure({ preset });
  }
  function openImport(file?: File, asRevision = false) {
    setImportError('');
    setBusyImport('');
    setModal({ kind: 'import', file, asRevision });
  }
  function closeModal() {
    if (modal?.kind === 'import' && activeImport.current) {
      activeImport.current.abort();
      activeImport.current = null;
      setBusyImport('');
      log('Import cancelled. No model was added.', 'warn');
    }
    setModal(undefined);
  }
  async function performImport(options: ImportOptions, asRevision: boolean, name: string) {
    if (activeImport.current) return;
    const controller = new AbortController();
    activeImport.current = controller;
    const p = projectIn(state.current),
      originAsset = getAsset(p, sessionIn(state.current).view),
      origin = p.id;
    setImportError('');
    log(`Importing ${options.file.name}`, 'run');
    try {
      const result = await prepareImport(options, controller.signal, setBusyImport);
      controller.signal.throwIfAborted();
      const current = state.current,
        pNow = current.projects.find((x) => x.id === origin);
      if (!pNow) throw new Error('The destination project is no longer available.');
      const target = asRevision ? pNow.assets.find((x) => x.id === originAsset?.id) : undefined;
      if (asRevision && !target) throw new Error('The destination asset is no longer available.');
      const maxRevision = target
        ? Math.max(...target.revisions.map((r) => Number(r.label.slice(1)) || 0))
        : 0;
      const newRev = { ...result.revision, label: `r${String(maxRevision + 1).padStart(2, '0')}` };
      const newAsset: Asset = target
        ? { ...target, revisions: [newRev, ...target.revisions] }
        : { id: uid(), name: name.slice(0, 100), revisions: [newRev] };
      const newAssets = target
        ? pNow.assets.map((a) => (a.id === newAsset.id ? newAsset : a))
        : [...pNow.assets, newAsset];
      const destView = sessionIn(current, origin).view;
      const newView = chooseRevision(destView, newAsset, newRev);
      if (target) {
        newView.baselineId = target.revisions[0]?.id ?? null;
        newView.compare = 'split';
      } else {
        newView.projection = 'ortho';
        newView.preset = 'iso';
        newView.look = 'solid';
      }
      updateProject(
        revise(pNow, `import ${newRev.label}`, { assets: newAssets }),
        { view: newView, pose: undefined, savedId: undefined },
        result.file,
      );
      clearTimeout(poseTimer.current);
      setTool(undefined);
      setModal(undefined);
      notice(`${newAsset.name} · ${newRev.label} imported`);
      log(
        `${newRev.label} ready · ${newRev.parts.length} ${newRev.parts.length === 1 ? 'part' : 'parts'}`,
        'ok',
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setImportError(errorText(error));
        log(`Import rejected · ${errorText(error)}`, 'warn');
      }
    } finally {
      if (activeImport.current === controller) {
        activeImport.current = null;
        setBusyImport('');
      }
    }
  }
  function selectAsset(a: Asset) {
    const rev = a.revisions[0];
    if (!rev) return;
    setViewed(chooseRevision(sessionIn(state.current).view, a, rev));
    setSmallPanel(null);
  }
  function selectRevision(rev: Revision) {
    if (!asset) return;
    setViewed(chooseRevision(view, asset, rev));
    setSmallPanel(null);
  }
  function pinRevision(rev: Revision) {
    if (!revision || rev.id === revision.id) return;
    const enable = view.baselineId !== rev.id;
    configure({
      baselineId: enable ? rev.id : null,
      compare: rev.format === 'sample' && revision.format === 'sample' ? 'overlay' : 'split',
    });
    setTool(undefined);
    setModal(undefined);
    log(enable ? `Pinned ${rev.label} as baseline` : 'Cleared baseline');
  }
  function toggleHidden(id: string) {
    const now = sessionIn(state.current).view;
    configure({
      hidden: now.hidden.includes(id) ? now.hidden.filter((x) => x !== id) : [...now.hidden, id],
    });
  }
  function isolate() {
    const now = sessionIn(state.current).view;
    if (!now.partId) {
      notice('Select a part before isolating it.');
      return;
    }
    configure({
      isolate: !now.isolate,
      hidden: now.isolate ? now.hidden : now.hidden.filter((h) => h !== now.partId),
    });
  }
  function compareDialog() {
    if (asset) setModal({ kind: 'baseline' });
    else notice('Import a model before comparing revisions.');
  }

  function storeDistance(a: PointRef, b: PointRef, method: 'mesh' | 'entered') {
    const live = state.current,
      p = projectIn(live),
      current = sessionIn(live).view;
    const rev = getAsset(p, current)?.revisions.find((r) => r.id === a.revisionId);
    if (
      !rev?.confirmed ||
      !rev.parts.some((x) => x.id === a.partId) ||
      !rev.parts.some((x) => x.id === b.partId)
    )
      return 'Points are not on a verified, available revision.';
    try {
      const distance = makeDistance(a, b, method);
      const distances = { ...current.distances, [a.revisionId]: distance };
      configure({
        distances,
        linkedPair: undefined,
        ...(a.revisionId === current.revisionId ? { partId: a.partId } : {}),
      });
      setModal(undefined);
      setTool(undefined);
      const value = length(distance.mm, live.preferences.units);
      say(
        `${rev.label} · ${method === 'mesh' ? 'Approx. ' : ''}${value} between points A and B.`,
        'system',
      );
      log(`Measured ${rev.label} · ${value}`, 'ok');
      notice(`Measured ${value}`);
    } catch (error) {
      return errorText(error);
    }
  }
  function onPick(point: PointRef) {
    if (tool) {
      if (tool.revisionId !== point.revisionId) return;
      if (!tool.first) setTool({ ...tool, first: point });
      else {
        const error = storeDistance(tool.first, point, 'mesh');
        if (error) notice(error, true);
      }
      return;
    }
    if (point.revisionId === revision?.id) configure({ partId: point.partId });
  }
  function startMeasure(mode: 'pick' | 'coordinates' | 'baseline' | 'datum' | 'clear' = 'pick') {
    const r = mode === 'baseline' ? baseline : revision;
    if (!r) {
      notice('Import or select a revision to measure it.');
      return;
    }
    if (mode === 'clear') {
      const distances = { ...view.distances };
      delete distances[r.id];
      configure({ distances, linkedPair: undefined });
      setTool(undefined);
      return;
    }
    if (!r.confirmed) {
      setModal({ kind: 'scale', rev: r });
      return;
    }
    if (mode === 'coordinates') {
      setTool(undefined);
      setModal({ kind: 'coordinates' });
      return;
    }
    if (mode === 'datum') {
      if (!authoredDistance(r, view.partId)) {
        notice('This part has no authored reference points.');
        return;
      }
      const distances = { ...view.distances };
      delete distances[r.id];
      if (baseline?.format === 'sample') delete distances[baseline.id];
      configure({ distances, linkedPair: undefined });
      setTool(undefined);
      log('Restored authored datums');
      return;
    }
    if (!viewport.current?.ready()) {
      notice('Point picking needs a rendered model. You can still enter coordinates.', true);
      return;
    }
    if (mode === 'baseline' && view.compare !== 'split') configure({ compare: 'split' });
    setTool({ revisionId: r.id });
    setSmallPanel(null);
    notice('Pick two points on the model. Esc cancels.');
  }
  function confirmScale(rev: Revision) {
    const p = projectIn(state.current);
    const next = p.assets.map((a) => ({
      ...a,
      revisions: a.revisions.map((r) => (r.id === rev.id ? { ...r, confirmed: true } : r)),
    }));
    updateProject(revise(p, `verify ${rev.label} scale`, { assets: next }));
    setModal(undefined);
    log(`${rev.label} scale confirmed by user`, 'ok');
    notice('Source scale confirmed. Measurements are enabled.');
  }

  function storeNamedView(name: string) {
    const current = state.current,
      p = projectIn(current),
      s = sessionIn(current);
    if (!getRevision(p, s.view)) return;
    const proof = reviewEvidence(p, s.view, !!s.view.baselineId) ?? reviewEvidence(p, s.view);
    const saved = newSavedView(name, s.view, viewport.current?.pose() ?? s.pose, proof);
    const commit = updateProject(revise(p, 'save view', { views: [...p.views, saved] }), {
      savedId: saved.id,
    });
    setModal(undefined);
    void commit.then((status) => {
      notice(
        status === 'saved' ? `Saved “${saved.name}”` : `“${saved.name}” is kept for this session only.`,
        status !== 'saved',
      );
      log(`View kept · ${saved.name}`, 'ok');
    });
  }
  function openSaved(saved: SavedView) {
    const p = projectIn(state.current);
    if (!getRevision(p, saved.view)) {
      notice('This saved view refers to a missing revision.', true);
      return;
    }
    setViewed(reconcileView(p, saved.view), saved.pose, saved.id);
    setSmallPanel(null);
    log(`Opened view · ${saved.name}`);
  }
  function finishReview() {
    const w = state.current,
      p = projectIn(w),
      draft = sessionIn(w).proposal;
    if (!draft) return;
    try {
      const { project: next, saved } = applyProposal(p, draft);
      void updateProject(next, {
        proposal: undefined,
        savedId: reviewMatches ? saved.id : sessionIn(w).savedId,
      }).then((status) => {
        const savedLocally = status === 'saved';
        say(
          `${savedLocally ? 'Saved' : 'Kept for this session only:'} “${saved.name}”. Original model files are unchanged.`,
          'system',
        );
        log(`Applied ${draft.name} · project v${next.version}`, 'ok');
        notice(
          savedLocally
            ? 'Review saved to this project.'
            : 'Review kept for this session only. Export it before closing.',
          !savedLocally,
        );
      });
    } catch (error) {
      notice(errorText(error), true);
    }
  }
  function inspectReview() {
    const w = state.current,
      p = projectIn(w),
      draft = sessionIn(w).proposal;
    if (
      !draft ||
      !getRevision(p, draft.view) ||
      (draft.view.baselineId && !getRevision(p, draft.view, true))
    ) {
      notice('A pinned revision is missing. Discard the review and prepare a new one.', true);
      return;
    }
    setViewed(draft.view, draft.pose);
    setSmallPanel(null);
    notice('Showing the pinned review. Nothing has been applied.');
  }
  function discardReview() {
    if (!sessionIn(state.current).proposal) return;
    patchSession({ proposal: undefined });
    setRunState('');
    log('Review discarded · no project changes', 'info');
    notice('Preview discarded.');
  }
  function refreshReview() {
    const p = projectIn(state.current),
      draft = sessionIn(state.current).proposal;
    if (!draft) return;
    if (!getRevision(p, draft.view) || (draft.view.baselineId && !getRevision(p, draft.view, true))) {
      notice('A pinned revision no longer exists. Discard and rebuild this review.', true);
      return;
    }
    const calculated = draft.evidence
      ? reviewEvidence(p, draft.view, !!draft.evidence.baseline)
      : undefined;
    if (draft.evidence && !calculated) {
      notice('The original evidence is no longer available.', true);
      return;
    }
    patchSession({ proposal: { ...draft, base: p.version, evidence: calculated, sample: false } });
    log('Refreshed the pinned review against the current project version');
  }
  function undo() {
    const p = projectIn(state.current),
      previous = undoProject(p);
    if (!previous) {
      notice('No project changes to undo.');
      return;
    }
    const what = p.undo.at(-1)?.label ?? 'project edit';
    const last = sessionIn(state.current),
      next = reconcileView(previous, last.view);
    clearTimeout(poseTimer.current);
    updateProject(previous, {
      view: next,
      pose: next === last.view ? last.pose : undefined,
      savedId: undefined,
    });
    setTool(undefined);
    notice(`Undid ${what}.`);
    log(`Undo · ${what} · project v${previous.version}`, 'ok');
  }
  function switchProject(id: string) {
    const w = state.current;
    if (id === w.active) {
      setSmallPanel(null);
      return;
    }
    activeRun.current?.abort();
    activeRun.current = null;
    setRunning(false);
    setRunState('');
    clearTimeout(poseTimer.current);
    // Retain the actual camera at departure even if a debounced update is pending.
    const pose = viewport.current?.pose() ?? sessionIn(w).pose;
    write({ ...w, active: id, sessions: { ...w.sessions, [w.active]: { ...sessionIn(w), pose } } });
    const trace = seeded(sessionIn(w, id));
    setEntries(trace.entries);
    setEvents(trace.events);
    setTool(undefined);
    setSmallPanel(null);
    setRestores((n) => n + 1);
  }
  function createOrRename(name: string, rename: boolean) {
    const w = state.current,
      p = projectIn(w);
    if (rename) {
      updateProject(revise(p, 'rename project', { name }));
      setModal(undefined);
      return;
    }
    const target = createProject(name);
    activeRun.current?.abort();
    activeRun.current = null;
    clearTimeout(poseTimer.current);
    setRunning(false);
    setRunState('');
    setTool(undefined);
    setEntries([]);
    setEvents([]);
    write({
      ...w,
      active: target.id,
      projects: [...w.projects, target],
      sessions: { ...w.sessions, [target.id]: { view: DEFAULT_VIEW } },
    });
    setModal(undefined);
    setSmallPanel(null);
  }
  function exportRecord(saved?: SavedView) {
    const p = projectIn(state.current),
      s = sessionIn(state.current),
      shot = saved?.view ?? s.view;
    const a = getAsset(p, shot);
    if (!a) {
      notice('Import a model before exporting a review.');
      return;
    }
    const record = {
      schema: 1,
      exported: stamp(),
      project: { id: p.id, name: p.name, version: p.version },
      name: saved?.name ?? selected?.name ?? a.name,
      view: shot,
      pose: saved?.pose ?? viewport.current?.pose() ?? s.pose,
      units,
      evidence: saved?.evidence ?? reviewEvidence(p, shot, !!shot.baselineId) ?? reviewEvidence(p, shot),
      sources: a.revisions
        .filter((r) => r.id === shot.revisionId || r.id === shot.baselineId)
        .map((r) => ({
          id: r.id,
          revision: r.label,
          name: r.fileName,
          sha256: r.key?.length === 64 ? r.key : undefined,
          format: r.format,
          scaleConfirmed: r.confirmed,
          metresPerSourceUnit: r.multiplier,
          sourceUp: r.up ?? 'y',
          source: r.source,
          author: r.author,
          license: r.license,
        })),
    };
    download(
      new Blob([JSON.stringify(record, null, 2) + '\n'], { type: 'application/json' }),
      `${fileStem(record.name)}-review.json`,
    );
    notice('Review record exported.');
    log('Exported local review metadata');
  }
  async function exportImage() {
    if (!viewport.current || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const blob = await viewport.current.capture();
      download(blob, `${fileStem(selected?.name ?? asset?.name ?? project.name)}-viewport.png`);
      notice('Viewport PNG exported.');
      log('Exported annotated viewport PNG');
    } catch (error) {
      if (modal?.kind === 'export') setExportError(errorText(error));
      else notice(errorText(error), true);
    } finally {
      setExporting(false);
    }
  }
  async function exportSource(rev: Revision) {
    if (exporting) return;
    setExporting(true);
    try {
      const contents =
        rev.format === 'sample'
          ? await exportSample(rev)
          : new Blob([await readBytes(rev.key!)], { type: 'application/octet-stream' });
      download(contents, rev.format === 'sample' ? `bench-enclosure-${rev.label}.glb` : rev.fileName);
      notice('Model source exported.');
    } catch (error) {
      notice(errorText(error), true);
    } finally {
      setExporting(false);
    }
  }
  function stopRun() {
    if (!activeRun.current) return;
    activeRun.current.abort();
    activeRun.current = null;
    setRunning(false);
    setRunState('Stopped');
    say('Run stopped. No changes were made.', 'system');
    log('Run cancelled', 'warn');
  }

  // Registry-backed commands stay local. Free text is either normalized by the local
  // grammar or translated remotely into the same small set of allowlisted plans.
  function direct(value: string) {
    const text = value.trim().toLowerCase();
    const match = text === 'view angled' ? 'iso' : PRESETS.find((p) => text === `view ${p}`);
    if (match) {
      orient(match);
      return true;
    }
    const offset = /^explode(?:\s+([0-9]+(?:\.[0-9]+)?)\s*(?:mm)?)?$/.exec(text);
    if (offset) {
      const max = Math.max(
        30,
        Math.ceil(Math.max(...(revision ? spans(revision.bounds) : [0.12])) * 950),
      );
      configure({
        explode:
          offset[1] === undefined
            ? view.explode
              ? 0
              : Math.min(max, 18)
            : Math.min(max, Number(offset[1])),
      });
      return true;
    }
    switch (text) {
      case 'fit':
        viewport.current?.fit();
        return true;
      case 'fit all':
        viewport.current?.fit(false);
        return true;
      case 'isolate':
        isolate();
        return true;
      case 'show all':
        configure({ hidden: [], isolate: false });
        return true;
      case 'edges':
      case 'solid':
      case 'xray':
      case 'x-ray':
        configure({ look: text === 'x-ray' ? 'xray' : text });
        return true;
      case 'section':
        configure({ section: { ...view.section, enabled: !view.section.enabled } });
        return true;
      case 'measure':
        startMeasure();
        return true;
      case 'compare revisions':
        compareDialog();
        return true;
      case 'save view':
        if (revision) setModal({ kind: 'save' });
        else notice('Import a model before saving a view.');
        return true;
      case 'export png':
        void exportImage();
        return true;
      case 'export review':
        exportRecord();
        return true;
      case 'undo':
        undo();
        return true;
      case 'help':
        setModal({ kind: 'keys' });
        return true;
      case 'import':
        openImport();
        return true;
      case 'clear':
        setEntries([]);
        return true;
      default:
        return false;
    }
  }

  async function submit(input: string) {
    if (direct(input)) {
      if (input.toLowerCase().trim() !== 'clear') say(input, 'you');
      return;
    }
    if (activeRun.current) {
      notice('Stop the current Orion request before starting another.');
      return;
    }
    const bound = state.current,
      p = projectIn(bound),
      s = sessionIn(bound, p.id);
    const a = getAsset(p, s.view),
      r = getRevision(p, s.view),
      part = r?.parts.find((x) => x.id === s.view.partId);
    let scope = structuredClone(s.view);
    const wantComparison = /\b(compare|difference|diff|changed|delta|baseline)\b/i.test(input);
    const mentioned = [...new Set((input.match(/\br\d{1,4}\b/gi) ?? []).map((x) => x.toLowerCase()))];
    const invalidRevision = mentioned.find(
      (name) => !a?.revisions.some((v) => v.label.toLowerCase() === name),
    );
    const oldRef = mentioned.filter((name) => name !== r?.label.toLowerCase());
    const pinnedBaselines = a?.revisions.filter((rev) => rev.id !== r?.id) ?? [];
    const previous = r && a ? a.revisions[a.revisions.findIndex((x) => x.id === r.id) + 1] : undefined;
    if (wantComparison && !invalidRevision) {
      const requested =
        oldRef.length === 1
          ? pinnedBaselines.find((x) => x.label.toLowerCase() === oldRef[0])
          : undefined;
      const chosen =
        requested ??
        (/\bprevious\b/i.test(input)
          ? previous
          : scope.baselineId
            ? pinnedBaselines.find((x) => x.id === scope.baselineId)
            : undefined);
      if (chosen)
        scope = {
          ...scope,
          baselineId: chosen.id,
          compare:
            scope.baselineId === chosen.id
              ? scope.compare
              : r?.format === 'sample' && chosen.format === 'sample'
                ? 'overlay'
                : 'split',
        };
      else if (/\bprevious\b/i.test(input)) scope = { ...scope, baselineId: null };
    }
    const old = getRevision(p, scope, true);
    say(
      input,
      'you',
      `${part?.name ?? a?.name ?? p.name}${r ? ` · ${old ? `${old.label} → ` : ''}${r.label}` : ''}`,
    );
    if (invalidRevision || oldRef.length > 1) {
      say(
        invalidRevision
          ? `${invalidRevision} isn’t a revision of the active asset.`
          : 'Pin one baseline and choose one current revision first.',
      );
      return;
    }
    const namedOther = r?.parts.find(
      (d) =>
        d.id !== part?.id &&
        d.name.toLowerCase() !== part?.name.toLowerCase() &&
        d.name.length > 3 &&
        new RegExp(`\\b${d.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(input),
    );
    if (namedOther && part) {
      say(
        `The current target is ${part.name}. Select ${namedOther.name} to route a request to that part.`,
      );
      return;
    }
    const controller = new AbortController();
    activeRun.current = controller;
    setRunning(true);
    setRunState('Reading request');
    log(`Run started · ${part?.name ?? a?.name ?? 'project'}`, 'run');
    const pose = viewport.current?.pose() ?? s.pose;
    let label: string | undefined;
    try {
      let plan = localPlan(input);
      if (useConnector) {
        label = 'ORION';
        setRunState('Waiting for Orion');
        const response = await fetch('/api/orion/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            schema: 1,
            intent: input,
            scope: {
              asset: a?.name,
              part: part?.name,
              current: r?.label,
              baseline: old?.label,
              hasMeasurement: !!reviewEvidence(p, scope),
              scaleConfirmed: r?.confirmed,
            },
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Orion is unavailable.');
        const checked = safePlan(payload);
        if (!checked) throw new Error('Orion returned an unsupported action.');
        plan = checked;
        setConnectorError(false);
      }
      if (controller.signal.aborted || state.current.active !== p.id) return;
      const message = (text: string) => say(text, 'engine', undefined, label);
      if (plan.action === 'help') {
        message(
          'I can inspect a selected part, measure two points, compare revisions or prepare a saved review. Try “compare this to the previous revision.”',
        );
        return;
      }
      if (!r) {
        message('Import a 3D model first. Then select the part you want to inspect.');
        return;
      }
      if (plan.action === 'view') {
        const live = sessionIn(state.current).view;
        if (live.partId !== scope.partId || live.revisionId !== scope.revisionId) {
          message('The selection changed; I did not change the current camera.');
          return;
        }
        orient(plan.preset);
        message(`Showing the ${plan.preset === 'iso' ? 'angled' : plan.preset} view.`);
        return;
      }
      if (plan.action === 'inspect') {
        const size = spans(part?.bounds ?? r.bounds)
          .map((x) => length(x * 1000, bound.preferences.units))
          .join(' × ');
        message(
          `${part?.name ?? a?.name} · ${r.label}. ${r.confirmed ? 'Bounds' : 'Declared bounds'}: ${size} (X × Y × Z). ${r.confirmed ? 'Scale confirmed.' : 'Verify scale before measuring.'}`,
        );
        log(`Read source metadata · ${r.label}`, 'ok');
        return;
      }
      const compare =
        plan.action === 'compare' || (plan.action === 'review' && (wantComparison || !!old));
      if (compare && !old) {
        message('Pin a baseline in Revisions first, or import another revision of this asset.');
        return;
      }
      if (
        (plan.action === 'compare' || plan.action === 'measure' || wantComparison) &&
        (!r.confirmed || (compare && !old?.confirmed))
      ) {
        message(
          'Confirm the source scale of each measured revision in the inspector before calculating a distance.',
        );
        return;
      }
      const proof = reviewEvidence(p, scope, compare);
      const pairs = availableDistances(p, scope);
      if (
        !proof &&
        (plan.action === 'measure' ||
          plan.action === 'compare' ||
          (plan.action === 'review' && wantComparison))
      ) {
        message(
          compare
            ? pairs.current && pairs.baseline
              ? 'Use Compare A/B pairs in the inspector to confirm that the points mark matching features.'
              : 'Measure matching point pairs on both revisions, then link them with Compare A/B pairs in the inspector.'
            : 'I need two reference points. Use Measurement tools to pick two points or enter model coordinates.',
        );
        if (
          compare &&
          old &&
          sessionIn(state.current).view.revisionId === r.id &&
          sessionIn(state.current).view.baselineId !== old.id
        )
          configure({ baselineId: old.id, compare: scope.compare });
        return;
      }
      if (plan.action === 'review') {
        const live = sessionIn(state.current);
        if (live.proposal) {
          message('A review is already pending. Save or discard it before staging another one.');
          return;
        }
        const next: Proposal = {
          id: uid(),
          name: proof?.title ?? `${part?.name ?? a?.name ?? 'Model'} review`,
          base: p.version,
          view: scope,
          pose:
            scope.compare === s.view.compare && scope.baselineId === s.view.baselineId
              ? pose
              : undefined,
          evidence: proof,
        };
        const stillOnTarget =
          live.view.revisionId === scope.revisionId && live.view.partId === scope.partId;
        if (
          stillOnTarget &&
          (live.view.baselineId !== scope.baselineId || live.view.compare !== scope.compare)
        )
          configure({ baselineId: scope.baselineId, compare: scope.compare });
        patchSession({ proposal: next }, p.id);
        if (proof?.baseline) {
          const delta = proof.current.mm - proof.baseline.mm;
          const interesting = Math.abs(delta) > 0.00000001;
          message(
            `Preview ready. ${proof.title === 'Hole spacing' ? 'Hole centres' : 'Point distance'} ${interesting ? `${delta < 0 ? 'decreased' : 'increased'} by ${length(Math.abs(delta), bound.preferences.units)} in ${r.label}.` : `did not change in ${r.label}.`}`,
          );
        } else message(`Preview ready. Review “${next.name}” in the inspector. No files were changed.`);
        log('Review preview ready · waiting for user approval', 'ok');
        return;
      }
      if (proof) {
        if (
          old &&
          compare &&
          sessionIn(state.current).view.revisionId === r.id &&
          sessionIn(state.current).view.partId === scope.partId
        )
          configure({ baselineId: old.id, compare: scope.compare });
        message(
          proof.baseline
            ? `${proof.title}: ${length(proof.baseline.mm, bound.preferences.units)} → ${length(proof.current.mm, bound.preferences.units)} (${length(proof.current.mm - proof.baseline.mm, bound.preferences.units, true)}).`
            : `${proof.title}: ${proof.current.method === 'mesh' ? 'approx. ' : ''}${length(proof.current.mm, bound.preferences.units)}.`,
        );
        log(`${proof.id} · Read measured evidence`, 'ok');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setConnectorError(true);
        say(errorText(error), 'system');
        log('Orion could not complete the request. No changes applied.', 'warn');
        setRunState('Request failed');
      }
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null;
        setRunning(false);
      }
    }
  }

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      const editing = !!target?.closest('input,textarea,select,[contenteditable="true"]');
      const modified = event.ctrlKey || event.metaKey;
      if (modal) return;
      if (modified && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setModal({ kind: 'palette' });
        return;
      }
      if (editing) return;
      if (event.key === 'Escape') {
        if (tool) {
          setTool(undefined);
          return;
        }
        if (smallPanel) {
          setSmallPanel(null);
          return;
        }
        if (focusMode) {
          setFocusMode(false);
          return;
        }
      }
      if (modified && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (!data.preferences.shortcuts || modified || event.altKey) return;
      switch (event.key.toLowerCase()) {
        case 'f':
          event.preventDefault();
          viewport.current?.fit();
          break;
        case 'i':
          event.preventDefault();
          isolate();
          break;
        case 'm':
          event.preventDefault();
          startMeasure();
          break;
        case '?':
          event.preventDefault();
          setModal({ kind: 'keys' });
          break;
        case '/':
          event.preventDefault();
          setFocusConsole((x) => x + 1);
          break;
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });

  const palette: PaletteItem[] = [
    {
      label: 'Fit selection',
      group: 'Viewport',
      detail: 'Frame the target without changing model scale',
      key: 'F',
      disabled: !revision,
      action: () => viewport.current?.fit(),
    },
    {
      label: 'Import 3D model',
      group: 'Project',
      detail: 'Choose a GLB or STL file',
      action: () => openImport(),
    },
    {
      label: 'Save current view',
      group: 'Review',
      detail: 'Keep camera, visibility and evidence',
      disabled: !revision,
      action: () => setModal({ kind: 'save' }),
    },
    {
      label: 'Measure point distance',
      group: 'Viewport',
      detail: 'Pick two source-space points',
      key: 'M',
      disabled: !revision,
      action: () => startMeasure(),
    },
    {
      label: 'Enter measure coordinates',
      group: 'Viewport',
      detail: 'Keyboard-accessible source point entry',
      disabled: !revision,
      action: () => startMeasure('coordinates'),
    },
    {
      label: view.isolate ? 'Unisolate parts' : 'Isolate selection',
      group: 'Viewport',
      detail: 'Toggle visibility of neighbouring parts',
      key: 'I',
      disabled: !selected,
      action: isolate,
    },
    {
      label: 'Compare revisions',
      group: 'Review',
      detail: 'Pin or change the baseline',
      disabled: !revision,
      action: compareDialog,
    },
    {
      label: 'Prepare a revision review',
      group: 'Orion',
      detail: 'Compute evidence, preview proposed changes',
      disabled: !baseline,
      action: () => void submit('Compare the pinned revisions and prepare a review view.'),
    },
    {
      label: 'Show pinned review',
      group: 'Review',
      detail: 'Restore the staged camera and evidence',
      disabled: !proposal,
      action: inspectReview,
    },
    {
      label: 'Focus command line',
      group: 'Orion',
      detail: 'Type an instruction about the selection',
      key: '/',
      action: () => setFocusConsole((x) => x + 1),
    },
    {
      label: 'Export review',
      group: 'Review',
      detail: 'Download a PNG or revision-aware JSON record',
      disabled: !revision,
      action: () => setModal({ kind: 'export' }),
    },
    {
      label: 'New project',
      group: 'Project',
      detail: 'Create an empty local workspace',
      action: () => setModal({ kind: 'project-name', rename: false }),
    },
    {
      label: 'Undo project change',
      group: 'Project',
      detail: 'Reverse the last durable edit',
      key: 'Ctrl Z',
      disabled: !project.undo.length,
      action: undo,
    },
    {
      label: 'Workbench settings',
      group: 'Project',
      detail: 'Units, shortcuts and Orion connector',
      action: () => setModal({ kind: 'settings' }),
    },
    {
      label: 'Keyboard shortcuts',
      group: 'Orion',
      detail: 'Show keys and pointer controls',
      key: '?',
      action: () => setModal({ kind: 'keys' }),
    },
    ...PRESETS.map((preset) => ({
      label: `View ${preset === 'iso' ? 'angled' : preset}`,
      group: 'Viewport' as const,
      detail: 'Switch camera orientation',
      disabled: !revision,
      action: () => orient(preset),
    })),
    ...(revision?.parts.map((part) => ({
      label: `Select ${part.name}`,
      group: 'Viewport' as const,
      detail: `Part · ${revision.label}`,
      action: () => configure({ partId: part.id }),
    })) ?? []),
    ...project.views.map((saved) => ({
      label: `Open ${saved.name}`,
      group: 'Review' as const,
      detail: 'Restore saved view',
      action: () => openSaved(saved),
    })),
  ];

  return (
    <div
      ref={shell}
      style={paneStyle}
      className={`workbench ${focusMode ? 'focus-mode' : ''} ${collapsed ? 'dock-collapsed' : ''} ${smallPanel ? `show-${smallPanel}` : ''}`}
    >
      <header className="topbar">
        <div className="brand">
          <img src={ORION_MARK} alt="" />
          <span>ORION</span>
        </div>
        <i className="brand-rule" />
        <div className="project-path">
          <Popover
            label={<span>{project.name}</span>}
            ariaLabel="Switch project"
            className="project-switch"
            chevron={false}
          >
            {(close) => (
              <>
                <div className="menu-heading">Local projects</div>
                {data.projects.map((p) => (
                  <MenuRow
                    key={p.id}
                    selected={p.id === project.id}
                    onClick={() => {
                      switchProject(p.id);
                      close();
                    }}
                  >
                    <Box size={14} />
                    {p.name}
                  </MenuRow>
                ))}
                <div className="menu-line" />
                <MenuRow
                  onClick={() => {
                    setModal({ kind: 'project-name', rename: false });
                    close();
                  }}
                >
                  <Plus size={14} /> New project
                </MenuRow>
                <MenuRow
                  onClick={() => {
                    setModal({ kind: 'project-name', rename: true });
                    close();
                  }}
                >
                  Rename this project
                </MenuRow>
              </>
            )}
          </Popover>
          <span className="path-slash">/</span>
          <span className="path-page">{proposal ? 'Review' : 'Inspect'}</span>
        </div>
        <div className="header-actions">
          <div className="small-toggles">
            <IconButton
              label="Toggle project panel"
              active={smallPanel === 'project'}
              onClick={() => setSmallPanel((x) => (x === 'project' ? null : 'project'))}
            >
              <PanelLeft size={16} />
            </IconButton>
            <IconButton
              label="Toggle inspector"
              className={`inspector-toggle ${proposal ? 'has-preview' : ''}`}
              active={smallPanel === 'inspect'}
              onClick={() => setSmallPanel((x) => (x === 'inspect' ? null : 'inspect'))}
            >
              <PanelRight size={16} />
            </IconButton>
          </div>
          <button
            className="engine-status"
            onClick={() => setModal({ kind: 'settings' })}
            title="Orion mode and privacy"
          >
            <i className={`square ${connectorError ? 'amber' : ''}`} />
            <span>
              {connectorError ? 'Orion offline' : useConnector ? connector.label : 'Local engine'}
            </span>
          </button>
          <button
            type="button"
            className="button commands-btn"
            aria-label="Commands"
            onClick={() => setModal({ kind: 'palette' })}
          >
            <span>Commands</span>
            <Command className="command-icon" size={15} />
            <Key>Ctrl K</Key>
          </button>
          <button
            type="button"
            className="button import-btn"
            aria-label="Import model"
            onClick={() => openImport()}
          >
            <Plus size={15} />
            <span>Import…</span>
          </button>
        </div>
      </header>
      <main className="work-area" aria-label="Orion workspace">
        <ProjectTree
          project={project}
          asset={asset}
          revision={revision}
          view={view}
          activeSaved={savedId}
          chooseAsset={selectAsset}
          chooseRevision={selectRevision}
          pinBaseline={pinRevision}
          selectPart={(id) => {
            configure({ partId: id });
            setSmallPanel(null);
          }}
          hidePart={toggleHidden}
          openView={openSaved}
          addView={() => setModal({ kind: 'save' })}
          deleteView={(saved) => setModal({ kind: 'remove-view', saved })}
          renameView={(saved) => setModal({ kind: 'rename-view', saved })}
          exportView={exportRecord}
          onImport={() => openImport()}
          close={() => setSmallPanel(null)}
        />
        <Viewport
          ref={viewport}
          revision={revision}
          baseline={baseline}
          view={view}
          units={units}
          evidence={evidence}
          baselineDistance={distances.baseline}
          tool={tool}
          inert={compact && !!smallPanel}
          pose={session.pose}
          restore={restores}
          configure={configure}
          onPose={newPose}
          onPick={onPick}
          onImport={openImport}
          onMeasure={startMeasure}
          onCancelMeasure={() => setTool(undefined)}
          selectBaseline={compareDialog}
          focusMode={focusMode}
          toggleFocus={() => {
            setFocusMode((x) => !x);
            setSmallPanel(null);
          }}
          onSample={() => switchProject(SAMPLE_PROJECT)}
        />
        <Inspector
          asset={asset}
          revision={revision}
          baseline={baseline}
          part={selected}
          view={view}
          units={units}
          evidence={evidence}
          distances={distances}
          proposal={proposal}
          version={project.version}
          missingPinnedRevision={missingPinnedRevision}
          proposalTarget={proposalTarget}
          reviewMatches={reviewMatches}
          inspectReview={inspectReview}
          linkPoints={() => setModal({ kind: 'pair' })}
          verifyBaseline={() => baseline && setModal({ kind: 'scale', rev: baseline })}
          onEvidence={() => setModal({ kind: 'evidence' })}
          verifyScale={() => revision && setModal({ kind: 'scale', rev: revision })}
          measure={() => startMeasure()}
          isolate={isolate}
          close={() => setSmallPanel(null)}
          apply={finishReview}
          discard={discardReview}
          refresh={refreshReview}
          saveCurrent={() => setModal({ kind: 'save' })}
          details={() => revision && setModal({ kind: 'details', rev: revision })}
        />
        <ResizeRail
          label="Resize project panel"
          className="resize-left"
          orientation="vertical"
          edge="leading"
          value={panelLeft}
          min={177}
          max={Math.max(177, maxLeft)}
          onChange={(n) => sizePane('left', n)}
          onReset={() => sizePane('left')}
        />
        <ResizeRail
          label="Resize inspector"
          className="resize-right"
          orientation="vertical"
          edge="trailing"
          value={panelRight}
          min={266}
          max={Math.max(266, maxRight)}
          onChange={(n) => sizePane('right', n)}
          onReset={() => sizePane('right')}
        />
        {smallPanel && (
          <button
            className="panel-scrim"
            tabIndex={-1}
            aria-label="Close side panel"
            onClick={() => setSmallPanel(null)}
          />
        )}
      </main>
      <ResizeRail
        label="Resize console"
        className="resize-dock"
        orientation="horizontal"
        edge="trailing"
        value={dockHeight}
        min={111}
        max={maxDock}
        onChange={(n) => sizePane('dock', n)}
        onReset={() => sizePane('dock')}
      />
      <ConsoleDock
        entries={entries}
        activity={events}
        pending={!!proposal}
        running={running}
        collapsed={collapsed}
        status={
          running
            ? runState
            : proposal
              ? proposal.base !== project.version || missingPinnedRevision
                ? 'Review out of date'
                : proposal.sample
                  ? 'Sample · Awaiting review'
                  : 'Awaiting review'
              : runState === 'Stopped'
                ? 'Run stopped'
                : runState === 'Request failed'
                  ? 'Request failed'
                  : ''
        }
        changeCollapsed={() => setCollapsed((x) => !x)}
        onSubmit={(value) => void submit(value)}
        onCancel={stopRun}
        openKeys={() => setModal({ kind: 'keys' })}
        focusToken={focusConsole}
      />
      <StatusBar
        persistence={persistence}
        proposal={proposal}
        asset={asset}
        units={units}
        settings={() => setModal({ kind: 'settings' })}
        keys={() => setModal({ kind: 'keys' })}
        exportReview={() => setModal({ kind: 'export' })}
      />
      {toast && (
        <div className={`toast ${toast.bad ? 'toast-error' : ''}`} role="status">
          {toast.bad ? <TriangleAlert size={15} /> : <Check size={15} />}
          <span>{toast.text}</span>
          <IconButton label="Dismiss message" onClick={() => setToast(undefined)}>
            <X size={13} />
          </IconButton>
        </div>
      )}

      {modal?.kind === 'palette' && <Palette items={palette} onClose={closeModal} />}
      {modal?.kind === 'keys' && <KeysDialog onClose={closeModal} />}
      {modal?.kind === 'settings' && (
        <SettingsDialog
          units={units}
          shortcuts={data.preferences.shortcuts}
          onUnits={(units) => alter((w) => ({ ...w, preferences: { ...w.preferences, units } }))}
          onShortcuts={(shortcuts) =>
            alter((w) => ({ ...w, preferences: { ...w.preferences, shortcuts } }))
          }
          connector={connector}
          useConnector={useConnector}
          onConnector={(enabled) => {
            setConnectorError(false);
            if (!enabled) stopRun();
            alter((w) => ({
              ...w,
              preferences: {
                ...w.preferences,
                connectorDestination: enabled ? connector.destination : undefined,
              },
            }));
          }}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'import' && (
        <ImportDialog
          asset={asset}
          projectName={project.name}
          initial={modal.file}
          revisionFirst={modal.asRevision}
          onClose={closeModal}
          onImport={performImport}
          busy={busyImport}
          error={importError}
        />
      )}
      {modal?.kind === 'project-name' && (
        <NameDialog
          title={modal.rename ? 'Rename project' : 'New project'}
          kicker="Local workspace"
          value={modal.rename ? project.name : ''}
          label="Project name"
          submit={modal.rename ? 'Save name' : 'Create project'}
          onClose={closeModal}
          onSubmit={(name) => createOrRename(name, modal.rename)}
        />
      )}
      {modal?.kind === 'save' && revision && (
        <NameDialog
          title="Save this view"
          kicker="Review / Saved views"
          value={evidence?.title ?? (selected ? `${selected.name} inspection` : 'Inspection view')}
          label="View name"
          submit="Save view"
          onClose={closeModal}
          onSubmit={storeNamedView}
        />
      )}
      {modal?.kind === 'rename-view' && (
        <NameDialog
          title="Rename saved view"
          kicker="Review / Saved views"
          value={modal.saved.name}
          label="View name"
          submit="Save name"
          onClose={closeModal}
          onSubmit={(name) => {
            updateProject(
              revise(project, 'rename saved view', {
                views: project.views.map((v) => (v.id === modal.saved.id ? { ...v, name } : v)),
              }),
            );
            setModal(undefined);
          }}
        />
      )}
      {modal?.kind === 'remove-view' && (
        <Dialog
          title="Remove saved view?"
          kicker="Review / Saved views"
          onClose={closeModal}
          className="narrow-dialog"
        >
          <div className="dialog-body">
            <p className="helper">
              Remove “{modal.saved.name}” from this project? No model files are affected. You can undo
              this change.
            </p>
          </div>
          <div className="dialog-actions">
            <button className="button" onClick={closeModal}>
              Cancel
            </button>
            <button
              className="button danger"
              onClick={() => {
                updateProject(
                  revise(project, 'remove saved view', {
                    views: project.views.filter((v) => v.id !== modal.saved.id),
                  }),
                  { savedId: savedId === modal.saved.id ? undefined : savedId },
                );
                setModal(undefined);
                notice('Saved view removed.');
              }}
            >
              Remove view
            </button>
          </div>
        </Dialog>
      )}
      {modal?.kind === 'baseline' && asset && revision && (
        <BaselineDialog
          asset={asset}
          active={revision.id}
          baseline={view.baselineId}
          onChoose={(rev) => {
            if (view.baselineId === rev.id) setModal(undefined);
            else pinRevision(rev);
          }}
          onImport={() => openImport(undefined, true)}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'evidence' && evidence && asset && (
        <EvidenceDialog
          evidence={evidence}
          asset={asset}
          units={units}
          onClose={closeModal}
          onFocus={() => {
            closeModal();
            setSmallPanel(null);
            viewport.current?.fit();
          }}
        />
      )}
      {modal?.kind === 'pair' && asset && distances.current && distances.baseline && (
        <PairDialog
          asset={asset}
          current={distances.current}
          baseline={distances.baseline}
          units={units}
          onClose={closeModal}
          onLink={() => {
            configure({
              linkedPair: { currentId: distances.current!.id, baselineId: distances.baseline!.id },
            });
            setModal(undefined);
            log('Linked matching point pairs for this comparison', 'ok');
          }}
        />
      )}
      {modal?.kind === 'details' && (
        <ModelDetails
          revision={modal.rev}
          part={modal.rev.id === revision?.id ? selected : undefined}
          units={units}
          onClose={closeModal}
          onConfirm={() => setModal({ kind: 'scale', rev: modal.rev })}
          onDownload={() => void exportSource(modal.rev)}
        />
      )}
      {modal?.kind === 'coordinates' && revision && (
        <CoordinatesDialog
          revision={revision}
          baseline={baseline}
          part={selected}
          units={units}
          distances={view.distances}
          onClose={closeModal}
          onSubmit={(a, b) => storeDistance(a, b, 'entered')}
        />
      )}
      {modal?.kind === 'scale' && (
        <Dialog
          title="Verify source scale"
          kicker={`Units / ${modal.rev.label}`}
          onClose={closeModal}
          className="narrow-dialog"
        >
          <div className="dialog-body">
            <p className="helper">
              Compare these declared extents with a known dimension in your source design. This action
              confirms the scale; it does not resize the model.
            </p>
            <div className="reading">
              <span className="eyebrow">X × Y × Z</span>
              {spans(modal.rev.bounds)
                .map((x) => length(x * 1000, units))
                .join(' × ')}
            </div>
            <p className="helper">If any dimension is wrong, reimport with the correct source units.</p>
          </div>
          <div className="dialog-actions">
            <button className="button" onClick={closeModal}>
              Cancel
            </button>
            <button className="button bright" onClick={() => confirmScale(modal.rev)}>
              <Check size={14} /> Confirm scale
            </button>
          </div>
        </Dialog>
      )}
      {modal?.kind === 'export' && (
        <Dialog
          title="Export inspection"
          kicker="Review / Download"
          onClose={closeModal}
          className="narrow-dialog"
        >
          <div className="dialog-body export-body">
            <button className="asset-choice" disabled={exporting} onClick={() => void exportImage()}>
              <ImageIcon size={18} />
              <span>
                <strong>Viewport PNG</strong>
                <small>Current geometry and annotations</small>
              </span>
              <Download size={15} />
            </button>
            <button className="asset-choice" onClick={() => exportRecord()}>
              <Layers2 size={18} />
              <span>
                <strong>Review JSON</strong>
                <small>View, evidence, and source metadata</small>
              </span>
              <Download size={15} />
            </button>
            {exportError && (
              <p className="dialog-error" role="alert">
                {exportError}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button className="button bright" onClick={closeModal}>
              Done
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Focus,
  Layers2,
  Maximize2,
  Minimize2,
  MoveVertical,
  Ruler,
  Scissors,
  TriangleAlert,
  Upload,
  View as ViewIcon,
  X,
  Box,
} from 'lucide-react';
import {
  length,
  type CameraPose,
  type Distance,
  type Evidence,
  type PointRef,
  type Preset,
  type Revision,
  type Units,
  type View,
} from '../core/domain';
import { SceneEngine, type MeasureTool } from '../scene/engine';
import { disposeModel, readVisual, type VisualModel } from '../scene/model';
import { IconButton, Key, MenuRow, Popover } from './primitives';

export interface ViewportHandle {
  pose: () => CameraPose | undefined;
  ready: () => boolean;
  orient: (preset: Preset) => void;
  fit: (part?: boolean) => void;
  nudge: (key: 'left' | 'right' | 'up' | 'down' | 'in' | 'out') => void;
  capture: () => Promise<Blob>;
}
interface Props {
  revision?: Revision;
  baseline?: Revision;
  view: View;
  units: Units;
  evidence?: Evidence;
  baselineDistance?: Distance;
  tool?: MeasureTool;
  pose?: CameraPose;
  restore: number;
  configure: (patch: Partial<View>) => void;
  onPose: (pose: CameraPose) => void;
  onPick: (point: PointRef) => void;
  onImport: (file?: File) => void;
  onMeasure: (mode: 'pick' | 'coordinates' | 'baseline' | 'datum' | 'clear') => void;
  onCancelMeasure: () => void;
  selectBaseline: () => void;
  inert: boolean;
  focusMode: boolean;
  toggleFocus: () => void;
  onSample: () => void;
}
const presets: [Preset, string][] = [
  ['iso', 'Angled'],
  ['front', 'Front'],
  ['top', 'Top'],
  ['right', 'Right'],
  ['back', 'Back'],
];

export const Viewport = forwardRef<ViewportHandle, Props>(function Viewport(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  const host = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<SceneEngine>();
  const [retry, setRetry] = useState(0);
  const [issue, setIssue] = useState('');
  const [readyKey, setReadyKey] = useState('');
  const [drag, setDrag] = useState(false);
  const models = useRef<{ current?: VisualModel; baseline?: VisualModel }>({});
  const loaded = useRef<{ current?: string; baseline?: string }>({});
  const dragDepth = useRef(0);
  const { revision, baseline, view, units, evidence, baselineDistance, tool, configure } = props;
  const sceneKey = revision ? `${revision.id}:${baseline?.id ?? ''}` : '';
  const rendered = !!sceneKey && !issue && sceneKey === readyKey;

  useLayoutEffect(() => {
    if (!host.current) return;
    let instance: SceneEngine | undefined;
    setIssue('');
    setReadyKey('');
    try {
      instance = new SceneEngine(host.current, {
        pick: (p) => {
          if (
            loaded.current.current === latest.current.revision?.id &&
            loaded.current.baseline === latest.current.baseline?.id
          )
            latest.current.onPick(p);
        },
        pose: (p) => {
          if (
            loaded.current.current &&
            loaded.current.current === latest.current.revision?.id &&
            loaded.current.baseline === latest.current.baseline?.id
          )
            latest.current.onPose(p);
        },
        frame: (id, old) => setReadyKey(`${id}:${old ?? ''}`),
        context: (lost) => {
          if (lost) setReadyKey('');
          setIssue(lost ? 'The graphics context was interrupted. Your project is still open.' : '');
        },
      });
      setEngine(instance);
    } catch {
      setEngine(undefined);
      setIssue('WebGL2 is not available. Enable hardware acceleration, then retry.');
    }
    return () => {
      instance?.dispose();
      models.current = {};
      loaded.current = {};
    };
  }, [retry]);

  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    const newModels: VisualModel[] = [];
    const reuse = (rev: Revision | undefined, model: VisualModel | undefined) => {
      if (!rev) return Promise.resolve(undefined);
      if (rev.id === model?.revision.id) {
        model.revision = rev;
        return Promise.resolve(model);
      }
      return readVisual(rev).then((result) => {
        newModels.push(result);
        return result;
      });
    };
    if (!revision) {
      engine.setModels();
      models.current = {};
      loaded.current = {};
      setReadyKey('');
      return;
    }
    setReadyKey('');
    setIssue('');
    void Promise.allSettled([
      reuse(revision, models.current.current),
      reuse(baseline, models.current.baseline),
    ]).then(([one, two]) => {
      if (cancelled) {
        newModels.forEach(disposeModel);
        return;
      }
      if (one.status === 'rejected' || two.status === 'rejected') {
        newModels.forEach(disposeModel);
        const reason =
          one.status === 'rejected' ? one.reason : two.status === 'rejected' ? two.reason : undefined;
        setIssue(reason instanceof Error ? reason.message : 'The selected model could not be loaded.');
        return;
      }
      models.current = { current: one.value, baseline: two.value };
      loaded.current = { current: revision.id, baseline: baseline?.id };
      engine.setModels(one.value, two.value);
      engine.configure(latest.current);
      if (latest.current.pose) engine.restore(latest.current.pose);
      else engine.fit(latest.current.view.preset, false, false);
    });
    return () => {
      cancelled = true;
    };
    // The bytes are immutable for an ID. Scale verification only updates the metadata below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision?.id, baseline?.id]);

  useEffect(() => {
    if (!engine || loaded.current.current !== revision?.id || loaded.current.baseline !== baseline?.id)
      return;
    if (revision && models.current.current) models.current.current.revision = revision;
    if (baseline && models.current.baseline) models.current.baseline.revision = baseline;
    engine.configure({ view, units, evidence, baselineDistance, tool });
  }, [engine, view, units, evidence, baselineDistance, tool, revision, baseline]);
  useEffect(() => {
    if (
      engine &&
      revision &&
      loaded.current.current === revision.id &&
      loaded.current.baseline === baseline?.id
    ) {
      if (props.pose) engine.restore(props.pose);
      else engine.fit(view.preset, false, false);
    }
    // Restores are explicit; publishing a pose during orbit does not feed it back into the engine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.restore, engine]);

  useImperativeHandle(
    ref,
    () => ({
      pose: () => (rendered && engine?.haveFrame ? engine.pose() : undefined),
      ready: () => rendered && !!engine?.haveFrame,
      fit: (part = true) => {
        if (rendered) engine?.fit(undefined, part);
      },
      orient: (preset) => {
        if (rendered) engine?.fit(preset, false, true);
      },
      nudge: (key) => {
        if (rendered) engine?.nudge(key);
      },
      capture: () =>
        !rendered || !engine
          ? Promise.reject(new Error('No rendered model is available.'))
          : engine.capture(),
    }),
    [engine, rendered],
  );
  const maxExplode = Math.max(
    30,
    Math.ceil(
      Math.max(...(revision?.bounds.max.map((n, i) => n - revision.bounds.min[i]) ?? [0.12])) * 950,
    ),
  );
  const axisIx = { x: 0, y: 1, z: 2 }[view.section.axis];
  const sectionMm = revision
    ? (revision.bounds.max[axisIx] - revision.bounds.min[axisIx]) * view.section.percent * 5
    : 0;
  const measure = (mode: 'pick' | 'coordinates' | 'datum' | 'baseline' | 'clear') =>
    props.onMeasure(mode);
  return (
    <section
      className={`viewport ${tool ? 'is-measuring' : ''}`}
      aria-label="Viewport"
      inert={props.inert}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          dragDepth.current++;
          setDrag(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDrag(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        dragDepth.current = 0;
        const file = e.dataTransfer.files[0];
        if (file) props.onImport(file);
      }}
    >
      <div className="view-tools" aria-label="Viewport tools">
        <Popover
          label={view.projection === 'ortho' ? 'ORTHO' : 'PERSP'}
          ariaLabel="Camera and view presets"
          className="camera-menu"
          chevron
        >
          {(close) => (
            <>
              <div className="menu-heading">Projection</div>
              <MenuRow
                selected={view.projection === 'ortho'}
                onClick={() => {
                  configure({ projection: 'ortho' });
                  close();
                }}
              >
                Orthographic
              </MenuRow>
              <MenuRow
                selected={view.projection === 'perspective'}
                onClick={() => {
                  configure({ projection: 'perspective' });
                  close();
                }}
              >
                Perspective
              </MenuRow>
              <div className="menu-heading">Orientation</div>
              {presets.map(([id, name]) => (
                <MenuRow
                  key={id}
                  selected={view.preset === id}
                  onClick={() => {
                    configure({ preset: id });
                    if (view.preset === id) engine?.fit(id, false, true);
                    close();
                  }}
                >
                  {name}
                </MenuRow>
              ))}
              <div className="menu-heading">Precision navigation</div>
              <div className="nudge-grid">
                {(['left', 'right', 'up', 'down', 'in', 'out'] as const).map((n) => (
                  <button
                    className="button mini"
                    key={n}
                    aria-label={n === 'in' || n === 'out' ? `Zoom ${n}` : `Orbit ${n}`}
                    onClick={() => engine?.nudge(n)}
                  >
                    {{ left: '←', right: '→', up: '↑', down: '↓', in: '+', out: '−' }[n]}
                  </button>
                ))}
              </div>
            </>
          )}
        </Popover>
        <span className="tool-rule" />
        <Popover
          label={{ edges: 'Edges', solid: 'Solid', xray: 'X-ray' }[view.look]}
          ariaLabel="Display style"
        >
          {(close) => (
            <>
              <div className="menu-heading">Display style</div>
              {(['solid', 'edges', 'xray'] as const).map((look) => (
                <MenuRow
                  key={look}
                  selected={view.look === look}
                  onClick={() => {
                    configure({ look });
                    close();
                  }}
                >
                  {{ solid: 'Solid', edges: 'Edges', xray: 'X-ray' }[look]}
                </MenuRow>
              ))}
              <div className="menu-line" />
              <MenuRow
                selected={view.labels}
                onClick={() => {
                  configure({ labels: !view.labels });
                  close();
                }}
              >
                Part labels
              </MenuRow>
            </>
          )}
        </Popover>
        <span className="tool-rule optional-tool" />
        {revision && (
          <Popover
            label={
              <>
                <MoveVertical className="explode-icon" size={14} />
                <span className="explode-word">Explode</span>
                {view.explode > 0 && (
                  <span className="explode-value"> · {Number(view.explode.toFixed(1))} mm</span>
                )}
              </>
            }
            ariaLabel="Explode assembly"
            selected={view.explode > 0}
            className="explode-menu"
          >
            {(close) => (
              <div className="tool-form">
                <div className="menu-heading">Explode assembly</div>
                <label>
                  Offset per step <output>{view.explode.toFixed(1)} mm</output>
                </label>
                <input
                  type="range"
                  aria-label="Explode offset"
                  min={0}
                  max={maxExplode}
                  step={0.5}
                  value={view.explode}
                  onChange={(e) => configure({ explode: +e.target.value })}
                />
                <div className="form-inline">
                  <input
                    aria-label="Explode offset in millimetres"
                    type="number"
                    min="0"
                    max={maxExplode}
                    step=".5"
                    value={view.explode}
                    onChange={(e) =>
                      configure({
                        explode: Math.max(0, Math.min(maxExplode, Number(e.target.value) || 0)),
                      })
                    }
                  />
                  <span>mm</span>
                  <button className="button mini" onClick={() => configure({ explode: 0 })}>
                    Reset
                  </button>
                  <button className="button mini" onClick={close}>
                    Done
                  </button>
                </div>
                <p>Presentation only. Dimensions use the original mesh.</p>
              </div>
            )}
          </Popover>
        )}
        {baseline && (
          <Popover
            label={
              <>
                <i className="line-key dashed" />
                <span className="baseline-word">Baseline</span> {baseline.label}
              </>
            }
            className="baseline-menu"
            ariaLabel="Baseline comparison"
            chevron={false}
          >
            {(close) => (
              <>
                <div className="menu-heading">
                  Compare {baseline.label} → {revision?.label}
                </div>
                <MenuRow
                  selected={view.compare === 'split'}
                  onClick={() => {
                    configure({ compare: 'split' });
                    close();
                  }}
                >
                  Side by side
                </MenuRow>
                <MenuRow
                  selected={view.compare === 'overlay'}
                  onClick={() => {
                    configure({ compare: 'overlay' });
                    close();
                  }}
                >
                  Overlay shared origin
                </MenuRow>
                <p className="menu-note">
                  Use overlay only when both files have the same origin and orientation.
                </p>
                <div className="menu-line" />
                <MenuRow
                  onClick={() => {
                    props.selectBaseline();
                    close();
                  }}
                >
                  Change baseline
                </MenuRow>
                <MenuRow
                  onClick={() => {
                    configure({ baselineId: null });
                    close();
                  }}
                >
                  Clear baseline
                </MenuRow>
              </>
            )}
          </Popover>
        )}
        <div className="view-tools-tail">
          {revision && (
            <>
              {!baseline && (
                <IconButton label="Compare revisions" onClick={props.selectBaseline}>
                  <Layers2 size={15} />
                </IconButton>
              )}
              <Popover
                label={<Scissors size={14} />}
                ariaLabel="Section plane"
                selected={view.section.enabled}
                align="right"
                chevron={false}
                className="tool-icon"
              >
                {(close) => (
                  <div className="tool-form">
                    <div className="menu-heading">Section plane</div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={view.section.enabled}
                        onChange={(e) =>
                          configure({ section: { ...view.section, enabled: e.target.checked } })
                        }
                      />{' '}
                      Enable section
                    </label>
                    <div className="segmented" aria-label="Section axis">
                      {(['x', 'y', 'z'] as const).map((axis) => (
                        <button
                          type="button"
                          key={axis}
                          aria-pressed={view.section.axis === axis}
                          onClick={() =>
                            configure({ section: { ...view.section, axis, enabled: true } })
                          }
                        >
                          {axis.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <label>
                      Offset from centre <output>{length(sectionMm, units, true)}</output>
                    </label>
                    <input
                      type="range"
                      aria-label="Section offset"
                      min="-100"
                      max="100"
                      step="1"
                      value={view.section.percent}
                      onChange={(e) =>
                        configure({
                          section: { ...view.section, percent: +e.target.value, enabled: true },
                        })
                      }
                    />
                    <div className="form-inline">
                      <button
                        className="button mini"
                        onClick={() =>
                          configure({
                            section: { ...view.section, flip: !view.section.flip, enabled: true },
                          })
                        }
                      >
                        Flip side
                      </button>
                      <button className="button mini" onClick={close}>
                        Done
                      </button>
                    </div>
                    <p>Clip only · no source geometry changes.</p>
                  </div>
                )}
              </Popover>
              <Popover
                label={<Ruler size={15} />}
                ariaLabel="Measurement tools"
                selected={!!tool}
                align="right"
                chevron={false}
                className="tool-icon"
              >
                {(close) => (
                  <>
                    <div className="menu-heading">Measure</div>
                    <MenuRow
                      disabled={!rendered}
                      onClick={() => {
                        measure('pick');
                        close();
                      }}
                    >
                      Pick two points
                    </MenuRow>
                    <MenuRow
                      onClick={() => {
                        measure('coordinates');
                        close();
                      }}
                    >
                      Enter coordinates
                    </MenuRow>
                    <MenuRow
                      disabled={!revision.parts.find((p) => p.id === view.partId)?.datums}
                      onClick={() => {
                        measure('datum');
                        close();
                      }}
                    >
                      Use authored datums
                    </MenuRow>
                    {view.distances[revision.id] && (
                      <MenuRow
                        onClick={() => {
                          measure('clear');
                          close();
                        }}
                      >
                        Clear current measurement
                      </MenuRow>
                    )}
                    {baseline && (
                      <MenuRow
                        disabled={!rendered}
                        onClick={() => {
                          measure('baseline');
                          close();
                        }}
                      >
                        Pick points on {baseline.label}
                      </MenuRow>
                    )}
                  </>
                )}
              </Popover>
            </>
          )}
          <IconButton
            label={props.focusMode ? 'Restore panels' : 'Focus viewport'}
            onClick={props.toggleFocus}
            className="focus-tool"
          >
            {props.focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </IconButton>
          <button
            className="fit-btn"
            type="button"
            disabled={!rendered}
            aria-label="Fit selection"
            onClick={() => engine?.fit(undefined, true)}
            title="Fit selection (F)"
          >
            <span>Fit</span>
            <span className="fit-icon">
              <Focus size={15} />
            </span>
            <Key>F</Key>
          </button>
        </div>
      </div>
      <div
        className="model-stage"
        ref={host}
        tabIndex={0}
        role="region"
        aria-label="Interactive 3D model"
        data-ready={String(rendered)}
        data-comparison={baseline ? view.compare : 'single'}
        aria-busy={!!revision && !rendered && !issue}
        onKeyDown={(e) => {
          const map: Record<string, 'left' | 'right' | 'up' | 'down' | 'in' | 'out'> = {
            ArrowLeft: 'left',
            ArrowRight: 'right',
            ArrowUp: 'up',
            ArrowDown: 'down',
            '+': 'in',
            '-': 'out',
          };
          if (rendered && e.target === host.current && map[e.key]) {
            e.preventDefault();
            engine?.nudge(map[e.key], e.shiftKey);
          }
        }}
      >
        {!revision && (
          <div className="viewport-placeholder">
            <Box size={32} strokeWidth={1.1} />
            <span className="eyebrow">Project empty</span>
            <h2>Drop a model here</h2>
            <p>Self-contained GLB or STL, up to 75 MiB.</p>
            <button className="button bright" onClick={() => props.onImport()}>
              <Upload size={14} /> Choose file
            </button>
            <button className="quiet-btn" onClick={props.onSample}>
              Open sample project <ChevronRight size={12} />
            </button>
          </div>
        )}
        {revision && issue && (
          <div className="viewport-placeholder issue">
            <TriangleAlert size={28} strokeWidth={1.4} />
            <span className="eyebrow">Viewport unavailable</span>
            <h2>Model not rendered</h2>
            <p>{issue}</p>
            <button className="button" onClick={() => setRetry((n) => n + 1)}>
              Retry viewport
            </button>
          </div>
        )}
        {revision && !rendered && !issue && (
          <div className="stage-loading" role="status">
            <i className="spinner" /> Rendering model
          </div>
        )}
        {baseline && rendered && (
          <p className="sr-only">
            {view.compare === 'split'
              ? `Baseline ${baseline.label} left. Current ${revision?.label} right. At the same scale.`
              : `Baseline ${baseline.label} overlaid on current ${revision?.label} at the shared model origin.`}
          </p>
        )}
        {tool && rendered && (
          <div className="canvas-mode" role="status">
            <Ruler size={14} />
            <span>
              {tool.first ? 'Pick point B' : 'Pick point A'}
              {baseline?.id === tool.revisionId ? ` · ${baseline.label} (left)` : ''}
            </span>
            <IconButton label="Cancel measurement" onClick={props.onCancelMeasure}>
              <X size={14} />
            </IconButton>
          </div>
        )}
        {drag && (
          <div className="drop-mask">
            <Upload size={25} />
            <span>Drop to import model</span>
            <small>GLB / STL</small>
          </div>
        )}
        {view.section.enabled && !tool && (
          <div className="stage-chip">
            <ViewIcon size={13} /> Section · {view.section.axis.toUpperCase()}{' '}
            {length(sectionMm, units, true)}
          </div>
        )}
      </div>
    </section>
  );
});

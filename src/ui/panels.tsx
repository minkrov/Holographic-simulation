import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Eye,
  EyeOff,
  FileDown,
  Focus,
  Info,
  Keyboard,
  Link2,
  Monitor,
  MoreHorizontal,
  Pin,
  Plus,
  Ruler,
  X,
} from 'lucide-react';
import {
  length,
  spans,
  type Asset,
  type DistancePair,
  type Evidence,
  type Part,
  type Project,
  type Proposal,
  type Revision,
  type SavedView,
  type Units,
  type View,
} from '../core/domain';
import { IconButton, Key, MenuRow, Popover } from './primitives';
import type { StorageStatus } from '../core/storage';

interface TreeProps {
  project: Project;
  asset?: Asset;
  revision?: Revision;
  view: View;
  activeSaved?: string;
  chooseAsset: (asset: Asset) => void;
  chooseRevision: (rev: Revision) => void;
  pinBaseline: (rev: Revision) => void;
  selectPart: (id: string) => void;
  hidePart: (id: string) => void;
  openView: (saved: SavedView) => void;
  addView: () => void;
  deleteView: (view: SavedView) => void;
  renameView: (view: SavedView) => void;
  exportView: (view: SavedView) => void;
  onImport: () => void;
  close: () => void;
}
export function ProjectTree(p: TreeProps) {
  const [expanded, setExpanded] = useState(true);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => setExpanded(true), [p.asset?.id]);
  const partKeys = (evt: KeyboardEvent<HTMLButtonElement>, part: string) => {
    const step = evt.key === 'ArrowUp' ? -1 : evt.key === 'ArrowDown' ? 1 : 0;
    if (!step || !p.revision) return;
    const i = p.revision.parts.findIndex((q) => q.id === part);
    const next = p.revision.parts[i + step];
    if (next) {
      evt.preventDefault();
      buttons.current.get(next.id)?.focus();
    }
  };
  return (
    <aside className="pane tree-pane" aria-label="Project">
      <div className="pane-head">
        <span className="eyebrow">Project</span>
        <div className="mobile-close">
          <IconButton label="Close project panel" onClick={p.close}>
            <X size={15} />
          </IconButton>
        </div>
      </div>
      <div className="tree-scroll">
        <section className="tree-group asset-tree" aria-label="Assets">
          <div className="group-heading">
            <span className="eyebrow">Assets</span>
            {p.project.assets.length > 1 && (
              <IconButton label="Import another asset" onClick={p.onImport}>
                <Plus size={13} />
              </IconButton>
            )}
          </div>
          {p.project.assets.length === 0 && (
            <button className="empty-row" onClick={p.onImport}>
              <Plus size={14} /> Import an asset
            </button>
          )}
          {p.project.assets.map((asset) => {
            const active = asset.id === p.asset?.id;
            return (
              <div className="asset-branch" key={asset.id}>
                <button
                  className={`tree-root ${active ? 'current-asset' : ''}`}
                  aria-expanded={active ? expanded : false}
                  title={asset.name}
                  onClick={() => {
                    if (active) setExpanded((x) => !x);
                    else {
                      p.chooseAsset(asset);
                      setExpanded(true);
                    }
                  }}
                >
                  {active && expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <Box size={15} />
                  <span>{asset.name}</span>
                  <small>{active ? p.revision?.label : asset.revisions[0]?.label}</small>
                </button>
                {active && expanded && (
                  <div className="part-branches" aria-label={`${asset.name} parts`}>
                    {p.revision?.parts.map((part) => {
                      const isHidden = p.view.hidden.includes(part.id);
                      const muted = isHidden || (p.view.isolate && p.view.partId !== part.id);
                      const selected = part.id === p.view.partId;
                      return (
                        <div
                          key={part.id}
                          className={`part-row ${selected ? 'is-selected' : ''} ${muted ? 'is-muted' : ''}`}
                        >
                          <button
                            type="button"
                            ref={(el) => {
                              if (el) buttons.current.set(part.id, el);
                              else buttons.current.delete(part.id);
                            }}
                            className="part-name"
                            onKeyDown={(e) => partKeys(e, part.id)}
                            onClick={() => p.selectPart(part.id)}
                            aria-pressed={selected}
                            title={part.name}
                          >
                            <Box size={15} />
                            <span>{part.name}</span>
                          </button>
                          <button
                            type="button"
                            className="tree-eye"
                            aria-label={`${isHidden ? 'Show' : 'Hide'} ${part.name}`}
                            title={`${isHidden ? 'Show' : 'Hide'} ${part.name}`}
                            aria-pressed={!isHidden}
                            onClick={() => p.hidePart(part.id)}
                          >
                            {isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>
        <section className="tree-group revisions" aria-label="Revisions">
          <div className="group-heading">
            <span className="eyebrow">Revisions</span>
          </div>
          {!p.asset && <span className="subtle-row">No versions yet</span>}
          {p.asset?.revisions.map((rev) => {
            const current = rev.id === p.view.revisionId,
              baseline = rev.id === p.view.baselineId;
            return (
              <div
                className={`revision-row ${current ? 'current-rev' : ''} ${baseline ? 'pinned-rev' : ''}`}
                key={rev.id}
              >
                <button
                  className="revision-name"
                  title={`Open ${rev.label} · ${rev.fileName}`}
                  aria-label={`Open revision ${rev.label}`}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => {
                    if (!current) p.chooseRevision(rev);
                  }}
                >
                  <i className={`line-key ${current ? 'solid' : baseline ? 'dashed' : 'dim'}`} />
                  <span>{rev.label}</span>
                </button>
                {current ? (
                  <span className="revision-state">Current</span>
                ) : (
                  <button
                    className="pin-btn"
                    aria-label={`${baseline ? 'Unpin' : 'Pin'} ${rev.label} baseline`}
                    aria-pressed={baseline}
                    title={baseline ? 'Clear baseline' : 'Pin as baseline'}
                    onClick={() => p.pinBaseline(rev)}
                  >
                    {baseline ? (
                      <span>Baseline</span>
                    ) : (
                      <>
                        <Pin size={12} />
                        <span>Set baseline</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </section>
        <section className="tree-group saved-views" aria-label="Saved views">
          <div className="group-heading">
            <span className="eyebrow">Saved views</span>
            <IconButton label="Save current view" onClick={p.addView} disabled={!p.revision}>
              <Plus size={14} />
            </IconButton>
          </div>
          {!p.project.views.length && <span className="subtle-row">No saved views</span>}
          {p.project.views.map((saved) => (
            <div
              key={saved.id}
              className={`saved-row ${p.activeSaved === saved.id ? 'is-saved-active' : ''}`}
            >
              <button
                type="button"
                className="saved-name"
                title={`Open ${saved.name}`}
                aria-current={p.activeSaved === saved.id ? 'true' : undefined}
                onClick={() => p.openView(saved)}
              >
                <Monitor size={14} />
                <span>{saved.name}</span>
              </button>
              <Popover
                label={<MoreHorizontal size={14} />}
                ariaLabel={`Actions for ${saved.name}`}
                className="saved-menu"
                chevron={false}
                align="right"
              >
                {(close) => (
                  <>
                    <MenuRow
                      onClick={() => {
                        p.renameView(saved);
                        close();
                      }}
                    >
                      Rename view
                    </MenuRow>
                    <MenuRow
                      onClick={() => {
                        p.exportView(saved);
                        close();
                      }}
                    >
                      <FileDown size={13} /> Export record
                    </MenuRow>
                    <MenuRow
                      onClick={() => {
                        p.deleteView(saved);
                        close();
                      }}
                    >
                      Remove view
                    </MenuRow>
                  </>
                )}
              </Popover>
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}

interface InspectProps {
  asset?: Asset;
  revision?: Revision;
  baseline?: Revision;
  part?: Part;
  view: View;
  units: Units;
  evidence?: Evidence;
  distances: DistancePair;
  linkPoints: () => void;
  verifyBaseline: () => void;
  proposal?: Proposal;
  version: number;
  missingPinnedRevision: boolean;
  proposalTarget?: string;
  reviewMatches: boolean;
  inspectReview: () => void;
  onEvidence: () => void;
  verifyScale: () => void;
  measure: () => void;
  isolate: () => void;
  close: () => void;
  apply: () => void;
  discard: () => void;
  refresh: () => void;
  saveCurrent: () => void;
  details: () => void;
}
export function Inspector(p: InspectProps) {
  const { revision, baseline, part, asset, units, evidence, proposal, view } = p;
  const stale = !!proposal && (proposal.base !== p.version || p.missingPinnedRevision);
  const other = !!proposal && !p.reviewMatches;
  const old = evidence?.baseline;
  const approx = evidence?.current.method === 'mesh' || old?.method === 'mesh';
  const revName = (id: string) => asset?.revisions.find((r) => r.id === id)?.label ?? 'Revision';
  return (
    <aside className="pane inspector-pane" aria-label="Inspector">
      <div className="pane-head">
        <span className="eyebrow">Inspector</span>
        <div className="mobile-close">
          <IconButton label="Close inspector panel" onClick={p.close}>
            <X size={15} />
          </IconButton>
        </div>
      </div>
      <div className="inspector-scroll">
        {revision ? (
          <>
            <header className="inspect-title">
              <h1>{part?.name ?? asset?.name ?? 'Model'}</h1>
              <button type="button" onClick={p.details} className="file-info" title="View model details">
                {revision.fileName} <span>·</span> {revision.label}
              </button>
            </header>
            {evidence ? (
              <section className="measure-block" aria-label="Measurement evidence">
                <div className="section-title">
                  <h2 className="eyebrow">{evidence.title}</h2>
                  <button
                    type="button"
                    className="evidence-id"
                    aria-label={`Open evidence ${evidence.id}`}
                    title="Inspect measurement evidence"
                    onClick={p.onEvidence}
                  >
                    {evidence.id}
                  </button>
                </div>
                {old && (
                  <div className="metric">
                    <i className="line-key dashed" />
                    <span>
                      {revName(old.a.revisionId)} <small>baseline</small>
                    </span>
                    <output>{length(old.mm, units)}</output>
                  </div>
                )}
                <div className="metric current-metric">
                  <i className="line-key solid" />
                  <span>
                    {revName(evidence.current.a.revisionId)} <small>current</small>
                  </span>
                  <output>{length(evidence.current.mm, units)}</output>
                </div>
                {old && (
                  <div className="delta">
                    <span className="eyebrow">{approx ? 'Approx. change' : 'Change'}</span>
                    <output>{length(evidence.current.mm - old.mm, units, true)}</output>
                  </div>
                )}
                <div className="measure-note">
                  <p>
                    {evidence.current.method === 'authored'
                      ? 'Nominal · authored datums A–B'
                      : evidence.current.method === 'mesh'
                        ? 'Approx. · two mesh surface points'
                        : 'Entered · model coordinates A–B'}
                  </p>
                  <p>
                    {old ? (view.compare === 'overlay' ? 'Shared origin' : 'Side by side') + ' · ' : ''}
                    scale confirmed
                  </p>
                </div>
              </section>
            ) : (
              <section className="measure-block quiet-measure">
                <div className="section-title">
                  <h2 className="eyebrow">{baseline ? 'Revision comparison' : 'Geometry'}</h2>
                  {baseline && (
                    <span className="display-tag">
                      {baseline.label} → {revision.label}
                    </span>
                  )}
                </div>
                <div className="geometry-size">
                  {spans(part?.bounds ?? revision.bounds)
                    .map((n) => length(n * 1000, units).replace(` ${units}`, ''))
                    .join(' × ')}{' '}
                  {units}
                </div>
                <p className="helper">
                  {revision.confirmed
                    ? baseline
                      ? 'Pick matching point pairs in both revisions to compare a distance.'
                      : 'Pick two points or enter coordinates to measure a distance.'
                    : 'Declared dimensions. Confirm the source scale before measuring.'}
                </p>
                <div className="inspect-tools">
                  <button
                    className="button mini"
                    type="button"
                    onClick={revision.confirmed ? p.measure : p.verifyScale}
                  >
                    {revision.confirmed ? <Ruler size={13} /> : <Check size={13} />}{' '}
                    {revision.confirmed ? 'Measure' : 'Confirm scale'}
                  </button>
                  {part && (
                    <button className="button mini" type="button" onClick={p.isolate}>
                      {view.isolate ? 'Show all' : 'Isolate'}
                    </button>
                  )}
                </div>
              </section>
            )}
            {baseline && !old && !baseline.confirmed && (
              <div className="compare-next">
                <p>{baseline.label} has unverified scale.</p>
                <button className="button mini" onClick={p.verifyBaseline}>
                  <Check size={13} /> Verify {baseline.label} scale
                </button>
              </div>
            )}
            {baseline && !old && p.distances.baseline && (
              <div className="compare-next">
                <div className="metric">
                  <i className="line-key dashed" />
                  <span>
                    {baseline.label} <small>unpaired</small>
                  </span>
                  <output>
                    {p.distances.baseline.method === 'mesh' ? '≈ ' : ''}
                    {length(p.distances.baseline.mm, units)}
                  </output>
                </div>
                {p.distances.current ? (
                  <button className="button mini" onClick={p.linkPoints}>
                    <Link2 size={13} /> Compare A/B pairs
                  </button>
                ) : (
                  <p>Measure two matching points on {revision.label}.</p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="inspector-empty">
            <Info size={21} />
            <h3>Nothing to inspect</h3>
            <p>Import a model to see its parts and measurements.</p>
          </div>
        )}
        {proposal ? (
          <section
            className={`review-block ${stale ? 'stale-review' : ''}`}
            aria-label="Pending review"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !stale) {
                e.preventDefault();
                e.stopPropagation();
                p.apply();
              }
            }}
          >
            <div className="review-kicker eyebrow">
              <i className="square amber" />
              {stale ? 'Review out of date' : 'Review required'}
            </div>
            <h2>Save “{proposal.name}”</h2>
            {other && !p.missingPinnedRevision && (
              <div className="review-scope">
                <p>
                  Pinned to {p.proposalTarget ?? 'another revision'}. This review keeps its original view
                  and evidence.
                </p>
                <button className="quiet-btn" onClick={p.inspectReview}>
                  <Focus size={13} /> Show pinned preview
                </button>
              </div>
            )}
            <ul className="review-diff">
              <li>
                <span>+</span> 1 saved view
              </li>
              {proposal.evidence && (
                <li>
                  <span>+</span> 1 annotation
                </li>
              )}
              <li className="no-diff">0 source files changed</li>
            </ul>
            {stale && (
              <p className="helper">
                {p.missingPinnedRevision
                  ? 'A pinned revision no longer exists. Discard this preview to start a new one.'
                  : 'The project changed. Refresh the pinned review before saving.'}
              </p>
            )}
            <div className="review-buttons">
              <button className="button" onClick={p.discard}>
                Discard
              </button>
              {stale ? (
                p.missingPinnedRevision ? null : (
                  <button className="button bright" onClick={p.refresh}>
                    Refresh review
                  </button>
                )
              ) : (
                <button className="button bright approve-btn" onClick={p.apply}>
                  <span>Save review</span>
                  <span className="approve-key">Ctrl Enter</span>
                </button>
              )}
            </div>
          </section>
        ) : (
          revision && (
            <section className="review-block idle-review" aria-label="Review actions">
              <div className="eyebrow">Review</div>
              <h2>Keep this inspection</h2>
              <p className="helper">
                Save the camera, visibility, section, and measurement without changing the model.
              </p>
              <button className="button" onClick={p.saveCurrent}>
                <Plus size={14} /> Save view
              </button>
            </section>
          )
        )}
      </div>
    </aside>
  );
}

export interface ConsoleEntry {
  id: string;
  role: 'you' | 'engine' | 'system';
  text: string;
  scope?: string;
  label?: string;
}
export interface ActivityEntry {
  id: string;
  text: string;
  when: string;
  type: 'run' | 'ok' | 'warn' | 'info';
}
interface ConsoleProps {
  entries: ConsoleEntry[];
  activity: ActivityEntry[];
  status: string;
  pending: boolean;
  running: boolean;
  collapsed: boolean;
  changeCollapsed: () => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  openKeys: () => void;
  focusToken: number;
}
export function ConsoleDock(p: ConsoleProps) {
  const [tab, setTab] = useState<'console' | 'activity'>('console');
  const [text, setText] = useState('');
  const [arrow, setArrow] = useState(-1);
  const list = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (p.focusToken) input.current?.focus();
  }, [p.focusToken]);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [p.entries, p.activity, tab, p.collapsed]);
  const history = p.entries
    .filter((r) => r.role === 'you')
    .map((r) => r.text)
    .reverse();
  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    p.onSubmit(value);
    setText('');
    setArrow(-1);
    setTab('console');
  }
  return (
    <section
      className={`console ${p.collapsed ? 'console-closed' : ''}`}
      aria-label="Orion command console"
    >
      {!p.collapsed && (
        <>
          <div className="console-head">
            <div
              className="console-tabs"
              ref={tabs}
              role="tablist"
              aria-label="Console panels"
              onKeyDown={(e) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                e.preventDefault();
                const next =
                  e.key === 'Home'
                    ? 'console'
                    : e.key === 'End'
                      ? 'activity'
                      : tab === 'console'
                        ? 'activity'
                        : 'console';
                setTab(next);
                tabs.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
              }}
            >
              <button
                role="tab"
                data-tab="console"
                tabIndex={tab === 'console' ? 0 : -1}
                aria-selected={tab === 'console'}
                aria-controls="console-log"
                onClick={() => setTab('console')}
              >
                Console
              </button>
              <button
                role="tab"
                data-tab="activity"
                tabIndex={tab === 'activity' ? 0 : -1}
                aria-selected={tab === 'activity'}
                aria-controls="activity-log"
                onClick={() => setTab('activity')}
              >
                Activity
              </button>
            </div>
            <span
              className={`run-state ${p.pending || p.running ? 'amber-text' : ''}`}
              aria-live="polite"
            >
              {p.running && <i className="spinner" />}
              {p.status}
            </span>
            <IconButton label="Collapse console" onClick={p.changeCollapsed}>
              <ChevronDown size={14} />
            </IconButton>
          </div>
          <div
            className={`console-scroller log-${tab}`}
            role="tabpanel"
            id={tab === 'console' ? 'console-log' : 'activity-log'}
            aria-label={tab === 'console' ? 'Console log' : 'Activity log'}
            ref={list}
            tabIndex={0}
          >
            {tab === 'console' ? (
              p.entries.length ? (
                p.entries.map((entry) => (
                  <div className={`console-entry entry-${entry.role}`} key={entry.id}>
                    <div className="entry-line">
                      <span className="entry-marker">
                        {entry.role === 'you'
                          ? '›'
                          : (entry.label ?? (entry.role === 'engine' ? 'ORION' : 'SYSTEM'))}
                      </span>
                      <div>{entry.text}</div>
                    </div>
                    {entry.scope && <div className="entry-scope">Target: {entry.scope}</div>}
                  </div>
                ))
              ) : (
                <div className="console-empty">
                  <span>›</span> Ready. Type <button onClick={p.openKeys}>help</button> or ask about the
                  selected part.
                </div>
              )
            ) : p.activity.length ? (
              p.activity.map((event) => (
                <div className={`activity-row event-${event.type}`} key={event.id}>
                  <span className="activity-time">{event.when}</span>
                  <i className="square" />
                  <span>{event.text}</span>
                </div>
              ))
            ) : (
              <div className="console-empty">No activity yet. Import a model or run a command.</div>
            )}
          </div>
        </>
      )}
      <form className="command-dock" onSubmit={submit}>
        {p.collapsed && (
          <IconButton label="Expand console" onClick={p.changeCollapsed}>
            <ChevronDown className="flipped" size={15} />
          </IconButton>
        )}
        <label className="command-line">
          <span className="command-caret" aria-hidden="true">
            ›
          </span>
          <input
            aria-label="Command or ask Orion"
            ref={input}
            spellCheck={false}
            autoComplete="off"
            placeholder="Command or ask Orion…"
            value={text}
            maxLength={800}
            onChange={(e) => {
              setText(e.target.value);
              setArrow(-1);
            }}
            onKeyDown={(e) => {
              if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && history.length) {
                e.preventDefault();
                const next = Math.max(
                  -1,
                  Math.min(history.length - 1, arrow + (e.key === 'ArrowUp' ? 1 : -1)),
                );
                setArrow(next);
                setText(next === -1 ? '' : history[next]);
              }
            }}
          />
          <button type="submit" title="Run command" aria-label="Run command">
            <Key>Enter</Key>
          </button>
        </label>
        {p.running && (
          <button className="button mini" type="button" onClick={p.onCancel}>
            <X size={14} /> Stop
          </button>
        )}
      </form>
    </section>
  );
}

export function StatusBar({
  persistence,
  proposal,
  asset,
  units,
  settings,
  keys,
  exportReview,
}: {
  persistence: StorageStatus | 'saving';
  proposal?: Proposal;
  asset?: Asset;
  units: Units;
  settings: () => void;
  keys: () => void;
  exportReview: () => void;
}) {
  return (
    <footer className="status-bar">
      <span
        role="status"
        className={
          persistence === 'memory' || persistence === 'conflict'
            ? 'amber-text persistence-warning'
            : undefined
        }
        title={
          persistence === 'conflict'
            ? 'Another tab saved a newer version. Export this tab’s work before reopening.'
            : persistence === 'memory'
              ? 'Browser storage is unavailable. Export before closing.'
              : undefined
        }
      >
        {persistence === 'saving'
          ? 'Saving…'
          : persistence === 'saved'
            ? 'Local project'
            : persistence === 'conflict'
              ? 'Other tab saved · Session only'
              : 'Session only'}
      </span>
      <i />
      {proposal ? (
        <span className="amber-text">Preview not saved</span>
      ) : (
        <span className="status-secondary">{asset ? 'Source files unchanged' : 'No model loaded'}</span>
      )}
      <div className="status-tail">
        <button
          onClick={exportReview}
          type="button"
          title="Export current review"
          aria-label="Export current review"
          disabled={!asset}
        >
          <Clipboard size={12} />
          <span>Export</span>
        </button>
        <i />
        <button
          onClick={settings}
          type="button"
          title="Workbench settings"
          aria-label="Workbench settings"
        >
          <span>{units}</span>
        </button>
        <i />
        <button onClick={keys} type="button" title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
          <Keyboard size={13} />
          <span>? Keys</span>
        </button>
      </div>
    </footer>
  );
}

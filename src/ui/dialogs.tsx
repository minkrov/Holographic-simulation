import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Box,
  Check,
  Command,
  Download,
  FileBox,
  Focus,
  HardDrive,
  Info,
  Layers2,
  Search,
  Upload,
} from 'lucide-react';
import {
  length,
  mmValue,
  spans,
  unitsValue,
  type Asset,
  type Distance,
  type Evidence,
  type Part,
  type PointRef,
  type Revision,
  type Units,
  type Vec3,
} from '../core/domain';
import type { ImportOptions } from '../core/import';
import type { Connector } from '../core/intent';
import { Dialog, Key } from './primitives';

const unitsList: Units[] = ['mm', 'cm', 'in', 'm'];
export function NameDialog({
  title,
  kicker,
  value,
  label,
  submit,
  onClose,
  onSubmit,
}: {
  title: string;
  kicker: string;
  value: string;
  label: string;
  submit: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(value);
  return (
    <Dialog title={title} kicker={kicker} onClose={onClose} className="narrow-dialog">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <div className="dialog-body">
          <label className="field">
            {label}
            <input
              data-initial-focus
              required
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button bright" type="submit" disabled={!name.trim()}>
            {submit}
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function ImportDialog({
  asset,
  projectName,
  initial,
  revisionFirst,
  onClose,
  onImport,
  busy,
  error,
}: {
  asset?: Asset;
  projectName: string;
  initial?: File;
  revisionFirst?: boolean;
  onClose: () => void;
  onImport: (options: ImportOptions, asRevision: boolean, name: string) => void;
  busy: string;
  error: string;
}) {
  const [file, setFile] = useState(initial);
  const [asRevision, setAsRevision] = useState(!!asset && !!revisionFirst);
  const [unit, setUnit] = useState<Units>('mm');
  const [up, setUp] = useState<'y' | 'z'>('z');
  const [confirmed, setConfirmed] = useState(false);
  const [name, setName] = useState(initial?.name.replace(/\.(glb|stl)$/i, '') ?? '');
  const [source, setSource] = useState(''),
    [author, setAuthor] = useState(''),
    [license, setLicense] = useState('');
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const stl = file?.name.toLowerCase().endsWith('.stl');
  function choose(item?: File) {
    if (!item) return;
    setFile(item);
    setName(item.name.replace(/\.[^.]+$/i, ''));
    setConfirmed(false);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (file && !busy)
      onImport(
        { file, units: unit, up, confirmed, source, author, license },
        asRevision,
        name.trim() || 'Imported model',
      );
  }
  return (
    <Dialog title="Import 3D model" kicker={`Project / ${projectName}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="dialog-body">
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept=".glb,.stl"
            aria-label="Choose a GLB or STL file"
            tabIndex={-1}
            disabled={!!busy}
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <button
            data-initial-focus
            type="button"
            className={`import-drop ${drag ? 'on-drag' : ''}`}
            disabled={!!busy}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (!busy) choose(e.dataTransfer.files?.[0]);
            }}
          >
            {file ? <FileBox size={22} /> : <Upload size={22} />}
            <span>
              <strong>{file?.name ?? 'Drop a file or browse'}</strong>
              <small>
                {file
                  ? `${(file.size / 1024).toFixed(1)} KiB · Click to replace`
                  : 'Self-contained GLB or STL · 75 MiB limit'}
              </small>
            </span>
          </button>
          <fieldset disabled={!!busy} className="import-fields">
            {asset && (
              <label className="field">
                Import as
                <select
                  value={asRevision ? 'revision' : 'asset'}
                  onChange={(e) => setAsRevision(e.target.value === 'revision')}
                >
                  <option value="asset">New asset</option>
                  <option value="revision">New revision of {asset.name}</option>
                </select>
              </label>
            )}
            {!asRevision && (
              <label className="field">
                Asset name
                <input
                  value={name}
                  maxLength={100}
                  placeholder="Uses the filename by default"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            {stl && (
              <div className="two-fields">
                <label className="field">
                  STL source units
                  <select
                    value={unit}
                    onChange={(e) => {
                      setUnit(e.target.value as Units);
                      setConfirmed(false);
                    }}
                  >
                    {unitsList.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Source up axis
                  <select value={up} onChange={(e) => setUp(e.target.value as 'y' | 'z')}>
                    <option value="z">Z up (CAD)</option>
                    <option value="y">Y up</option>
                  </select>
                </label>
              </div>
            )}
            {file && (
              <label className="check scale-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  I know the source scale is correct{' '}
                  <small>
                    {stl
                      ? `One STL unit is ${1} ${unit}.`
                      : 'GLB declares metres. You can confirm later against a known dimension.'}
                  </small>
                </span>
              </label>
            )}
            <details className="details-box">
              <summary>
                Source & attribution <span>Optional</span>
              </summary>
              <div className="details-fields">
                <label className="field">
                  Source URL or note
                  <input
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="Downloaded from…"
                    maxLength={300}
                  />
                </label>
                <div className="two-fields">
                  <label className="field">
                    Creator
                    <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={100} />
                  </label>
                  <label className="field">
                    Licence
                    <input
                      value={license}
                      onChange={(e) => setLicense(e.target.value)}
                      placeholder="e.g. CC BY 4.0"
                      maxLength={100}
                    />
                  </label>
                </div>
              </div>
            </details>
          </fieldset>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          {busy && (
            <div className="busy-line" role="status">
              <i className="spinner" /> {busy}…
            </div>
          )}
          {!busy && (
            <p className="local-note">
              <HardDrive size={13} /> The original is stored in this browser. Not uploaded.
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            {busy ? 'Cancel import' : 'Cancel'}
          </button>
          <button className="button bright" type="submit" disabled={!file || !!busy}>
            <Box size={14} /> {asRevision ? 'Import revision' : 'Import model'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export interface PaletteItem {
  label: string;
  detail: string;
  key?: string;
  keywords?: string;
  action: () => void;
  group: 'Project' | 'Viewport' | 'Orion' | 'Review';
  disabled?: boolean;
}
export function Palette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const id = 'command-palette-options';
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const matches = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return items
      .filter(
        (i) =>
          !i.disabled &&
          terms.every((term) =>
            `${i.label} ${i.detail} ${i.group} ${i.keywords ?? ''}`.toLowerCase().includes(term),
          ),
      )
      .slice(0, 16);
  }, [query, items]);
  useEffect(() => {
    itemRefs.current.get(active)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  function invoke(item?: PaletteItem) {
    if (!item) return;
    onClose();
    item.action();
  }
  return (
    <Dialog title="Run a command" kicker="Command palette" onClose={onClose} className="palette-dialog">
      <label className="palette-search">
        <Search size={17} />
        <input
          data-initial-focus
          value={query}
          placeholder="Search commands…"
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls={id}
          aria-autocomplete="list"
          aria-activedescendant={matches[active] ? `${id}-${active}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (matches.length)
                setActive(
                  (n) => (n + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length,
                );
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              invoke(matches[active]);
            }
          }}
        />
        <Key>Esc</Key>
      </label>
      <div className="palette-results" id={id} role="listbox" aria-label="Available commands">
        {matches.map((item, i) => (
          <button
            type="button"
            key={item.label}
            role="option"
            id={`${id}-${i}`}
            aria-selected={i === active}
            tabIndex={-1}
            ref={(el) => {
              if (el) itemRefs.current.set(i, el);
              else itemRefs.current.delete(i);
            }}
            className={`palette-item ${i === active ? 'highlight' : ''}`}
            onPointerMove={() => setActive(i)}
            onClick={() => invoke(item)}
          >
            <span className="palette-icon">
              {item.group === 'Viewport' ? (
                <Focus size={16} />
              ) : item.group === 'Orion' ? (
                <Command size={16} />
              ) : item.group === 'Review' ? (
                <Check size={16} />
              ) : (
                <Box size={16} />
              )}
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
            {item.key && <Key>{item.key}</Key>}
          </button>
        ))}
        {!matches.length && <p className="palette-empty">No match. Try a part, action, or view name.</p>}
      </div>
      <div className="palette-footer">
        <span>
          <Key>↑</Key>
          <Key>↓</Key> Navigate
        </span>
        <span>
          <Key>Enter</Key> Run
        </span>
        <span>
          <Key>Esc</Key> Close
        </span>
      </div>
    </Dialog>
  );
}

export function CoordinatesDialog({
  revision,
  baseline,
  part,
  units,
  distances,
  onClose,
  onSubmit,
}: {
  revision: Revision;
  baseline?: Revision;
  part?: Part;
  units: Units;
  distances: Record<string, Distance>;
  onClose: () => void;
  onSubmit: (a: PointRef, b: PointRef) => string | undefined;
}) {
  const [target, setTarget] = useState(revision.id);
  const rev = baseline?.id === target ? baseline : revision;
  const pointValues = (r: Revision) => {
    const d = distances[r.id];
    return d?.method === 'entered'
      ? [...d.a.point, ...d.b.point].map((n) =>
          String(Number(unitsValue(n * 1000, units).toPrecision(12))),
        )
      : ['0', '0', '0', '', '', ''];
  };
  const [partId, setPart] = useState(
    distances[revision.id]?.a.partId ?? part?.id ?? revision.parts[0]?.id ?? '',
  );
  const [values, setValues] = useState(() => pointValues(revision));
  const [error, setError] = useState('');
  return (
    <Dialog title="Enter measurement points" kicker="Measurement / Model space" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!rev.confirmed) {
            setError('Confirm this revision’s scale before measuring.');
            return;
          }
          const numbers = values.map((value) =>
            value.trim() ? mmValue(Number(value), units) / 1000 : NaN,
          );
          if (numbers.some((n) => !Number.isFinite(n))) {
            setError('Enter X, Y, and Z for both points.');
            return;
          }
          const id = rev.parts.find((p) => p.id === partId)?.id;
          if (!id) {
            setError('Select a part for the measurement.');
            return;
          }
          const pts = (i: number, label: string): PointRef => ({
            revisionId: rev.id,
            partId: id,
            point: numbers.slice(i, i + 3) as Vec3,
            label,
          });
          setError(onSubmit(pts(0, 'A'), pts(3, 'B')) ?? '');
        }}
      >
        <div className="dialog-body">
          <p className="helper">
            Enter canonical model coordinates in <strong>{units}</strong>. The explode offset is not part
            of the measurement.
          </p>
          <div className="two-fields">
            <label className="field">
              Revision
              <select
                value={target}
                onChange={(e) => {
                  const next = e.target.value === baseline?.id ? baseline : revision;
                  setTarget(next.id);
                  setPart(distances[next.id]?.a.partId ?? next.parts[0]?.id ?? '');
                  setValues(pointValues(next));
                  setError('');
                }}
              >
                <option value={revision.id}>{revision.label} · Current</option>
                {baseline && <option value={baseline.id}>{baseline.label} · Baseline</option>}
              </select>
            </label>
            <label className="field">
              Part
              <select value={partId} onChange={(e) => setPart(e.target.value)}>
                {rev.parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {[0, 3].map((i) => (
            <fieldset className="point-fields" key={i}>
              <legend>Point {i === 0 ? 'A' : 'B'}</legend>
              {['X', 'Y', 'Z'].map((axis, j) => (
                <label className="field" key={axis}>
                  {axis}
                  <input
                    required
                    type="number"
                    step="any"
                    value={values[i + j]}
                    aria-label={`Point ${i === 0 ? 'A' : 'B'} ${axis}`}
                    onChange={(e) =>
                      setValues((arr) => arr.map((v, k) => (k === i + j ? e.target.value : v)))
                    }
                  />
                </label>
              ))}
            </fieldset>
          ))}
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button bright" type="submit">
            Measure points
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function PointRecord({ value, asset, units }: { value: Distance; asset: Asset; units: Units }) {
  const rev = asset.revisions.find((r) => r.id === value.a.revisionId);
  return (
    <section className="datum-record" aria-label={`${rev?.label ?? 'Revision'} distance`}>
      <div>
        <span className="eyebrow">
          {rev?.label ?? 'Revision'} ·{' '}
          {value.method === 'authored'
            ? 'Authored datums'
            : value.method === 'mesh'
              ? 'Approx. mesh points'
              : 'Entered coordinates'}
        </span>
        <output>{length(value.mm, units)}</output>
      </div>
      {[value.a, value.b].map((point) => (
        <div key={point.label}>
          <span>
            {point.label} · {rev?.parts.find((x) => x.id === point.partId)?.name ?? 'Part'}
          </span>
          <code>{point.point.map((n) => length(n * 1000, units)).join(' / ')}</code>
        </div>
      ))}
    </section>
  );
}

export function PairDialog({
  current,
  baseline,
  asset,
  units,
  onClose,
  onLink,
}: {
  current: Distance;
  baseline: Distance;
  asset: Asset;
  units: Units;
  onClose: () => void;
  onLink: () => void;
}) {
  return (
    <Dialog title="Compare A/B point pairs" kicker="Measurement / Revision comparison" onClose={onClose}>
      <div className="dialog-body">
        <p className="helper">
          Link these pairs only if A and B mark the <strong>same features</strong> in both revisions.
          Orion compares the distances; it does not infer matching features.
        </p>
        <PointRecord value={baseline} asset={asset} units={units} />
        <PointRecord value={current} asset={asset} units={units} />
      </div>
      <div className="dialog-actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button className="button bright" onClick={onLink}>
          <Check size={14} /> Compare matching points
        </button>
      </div>
    </Dialog>
  );
}

export function EvidenceDialog({
  evidence,
  asset,
  units,
  onClose,
  onFocus,
}: {
  evidence: Evidence;
  asset: Asset;
  units: Units;
  onClose: () => void;
  onFocus: () => void;
}) {
  return (
    <Dialog title={evidence.title} kicker={`Measurement / ${evidence.id}`} onClose={onClose}>
      <div className="dialog-body">
        <p className="helper">
          Euclidean distance between two points in model coordinates. Presentation offsets are excluded.
        </p>
        {evidence.baseline && <PointRecord value={evidence.baseline} asset={asset} units={units} />}
        <PointRecord value={evidence.current} asset={asset} units={units} />
        {evidence.baseline && (
          <div className="delta">
            <span className="eyebrow">
              {evidence.current.method === 'mesh' || evidence.baseline.method === 'mesh'
                ? 'Approx. change'
                : 'Change'}{' '}
              (current − baseline)
            </span>
            <output>{length(evidence.current.mm - evidence.baseline.mm, units, true)}</output>
          </div>
        )}
        <p className="local-note">
          <Info size={13} /> A dimension in a review is not a manufacturing tolerance or a fit check.
        </p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
        <button type="button" className="button bright" onClick={onFocus}>
          <Focus size={14} /> Focus in viewport
        </button>
      </div>
    </Dialog>
  );
}

export function BaselineDialog({
  asset,
  active,
  baseline,
  onChoose,
  onImport,
  onClose,
}: {
  asset: Asset;
  active: string;
  baseline: string | null;
  onChoose: (revision: Revision) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const candidates = asset.revisions.filter((r) => r.id !== active);
  return (
    <Dialog
      title="Choose a baseline"
      kicker={`Compare / ${asset.name}`}
      onClose={onClose}
      className="narrow-dialog"
    >
      <div className="dialog-body">
        {candidates.length ? (
          <>
            <p className="helper">
              Pin a previous revision. Imported revisions start side by side at the same scale.
            </p>
            <div className="baseline-list">
              {candidates.map((r) => (
                <button className="asset-choice" type="button" key={r.id} onClick={() => onChoose(r)}>
                  <Layers2 size={16} />
                  <span>
                    <strong>{r.label}</strong>
                    <small>{r.fileName}</small>
                  </span>
                  {r.id === baseline ? <Check size={14} /> : <ArrowRight size={14} />}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="helper">
            This asset has one revision. Import another model as a revision of{' '}
            <strong>{asset.name}</strong> to compare.
          </p>
        )}
      </div>
      <div className="dialog-actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button className="button bright" onClick={onImport}>
          <Upload size={14} /> Import revision
        </button>
      </div>
    </Dialog>
  );
}

export function ModelDetails({
  revision,
  part,
  units,
  onClose,
  onConfirm,
  onDownload,
}: {
  revision: Revision;
  part?: Part;
  units: Units;
  onClose: () => void;
  onConfirm: () => void;
  onDownload: () => void;
}) {
  return (
    <Dialog
      title={part?.name ?? revision.fileName}
      kicker={`Source / ${revision.label}`}
      onClose={onClose}
    >
      <div className="dialog-body">
        <dl className="metadata">
          <div>
            <dt>Source file</dt>
            <dd>{revision.fileName}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>
              {revision.format === 'sample'
                ? 'Reference fixture · exportable GLB'
                : revision.format.toUpperCase()}
            </dd>
          </div>
          <div>
            <dt>Source scale</dt>
            <dd>{revision.confirmed ? 'Confirmed' : 'Unverified'}</dd>
          </div>
          <div>
            <dt>Extents (X × Y × Z)</dt>
            <dd>
              {spans(part?.bounds ?? revision.bounds)
                .map((n) => length(n * 1000, units))
                .join(' × ')}
            </dd>
          </div>
          <div>
            <dt>Parts</dt>
            <dd>{revision.parts.length}</dd>
          </div>
          {revision.triangles !== undefined && (
            <div>
              <dt>Triangles</dt>
              <dd>{revision.triangles.toLocaleString()}</dd>
            </div>
          )}
          {revision.source && (
            <div>
              <dt>Provenance</dt>
              <dd>{revision.source}</dd>
            </div>
          )}
          {revision.author && (
            <div>
              <dt>Creator</dt>
              <dd>{revision.author}</dd>
            </div>
          )}
          {revision.license && (
            <div>
              <dt>Licence</dt>
              <dd>{revision.license}</dd>
            </div>
          )}
          {revision.key && (
            <div>
              <dt>Content ID</dt>
              <dd>
                <code title={revision.key}>{revision.key.slice(0, 16)}…</code>
              </dd>
            </div>
          )}
        </dl>
        {revision.warnings?.length ? (
          <details className="details-box">
            <summary>Import warnings ({revision.warnings.length})</summary>
            <ul className="warnings-list">
              {revision.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
        {!revision.confirmed && (
          <button type="button" className="button" onClick={onConfirm}>
            Verify scale
          </button>
        )}
        <button type="button" className="button bright" onClick={onDownload}>
          <Download size={14} /> Download source
        </button>
      </div>
    </Dialog>
  );
}

export function SettingsDialog({
  units,
  shortcuts,
  onUnits,
  onShortcuts,
  connector,
  useConnector,
  onConnector,
  onClose,
}: {
  units: Units;
  shortcuts: boolean;
  onUnits: (u: Units) => void;
  onShortcuts: (b: boolean) => void;
  connector: Connector;
  useConnector: boolean;
  onConnector: (b: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title="Workbench settings" kicker="Local preferences" onClose={onClose}>
      <div className="dialog-body settings-body">
        <label className="field">
          Display units
          <select value={units} onChange={(e) => onUnits(e.target.value as Units)}>
            {unitsList.map((u) => (
              <option key={u} value={u}>
                {{ mm: 'Millimetres', cm: 'Centimetres', in: 'Inches', m: 'Metres' }[u]} ({u})
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={shortcuts} onChange={(e) => onShortcuts(e.target.checked)} />{' '}
          Enable single-key shortcuts outside text inputs
        </label>
        <section className="connector-settings">
          <h3>Orion runtime</h3>
          {connector.mode === 'local' ? (
            <>
              <span className="display-tag">Local engine</span>
              <p>
                The built-in engine interprets a small set of project intents. No AI service is
                connected, and no project data leaves this browser.
              </p>
              <p>
                To connect your own runtime, configure <code>ORION_ENDPOINT</code> on the workbench
                server.
              </p>
            </>
          ) : (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={useConnector}
                  onChange={(e) => onConnector(e.target.checked)}
                />{' '}
                Send plain-language requests to {connector.label}
              </label>
              <p>
                Destination: <code>{connector.destination}</code>. Sends your prompt, part and revision
                labels, and capability flags. Never sends model files, screenshots or credentials. Direct
                commands stay local.
              </p>
            </>
          )}
        </section>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button bright" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

const keyLines = [
  ['Ctrl / ⌘ K', 'Command palette'],
  ['F', 'Fit selected part or assembly'],
  ['I', 'Toggle isolate'],
  ['M', 'Measure two points'],
  ['/', 'Focus the console'],
  ['?', 'Shortcut help'],
  ['Ctrl / ⌘ Z', 'Undo a project edit'],
  ['Esc', 'Close a tool or cancel picking'],
  ['Ctrl / ⌘ Enter', 'Save from inside a pending review'],
  ['← ↑ ↓ →', 'Orbit while the viewport has focus'],
  ['Shift + arrows', 'Pan while the viewport has focus'],
  ['+ / −', 'Zoom while the viewport has focus'],
];
export function KeysDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" kicker="Workbench / Reference" onClose={onClose}>
      <div className="dialog-body">
        <div className="shortcut-list">
          {keyLines.map(([key, what]) => (
            <div key={key}>
              <span>{what}</span>
              <Key>{key}</Key>
            </div>
          ))}
        </div>
        <p className="local-note">
          Pointer: drag to orbit, secondary drag to pan, scroll to zoom. Drag a panel divider or use its
          arrow keys to resize; Enter resets it.
        </p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button bright" onClick={onClose}>
          Back to workbench
        </button>
      </div>
    </Dialog>
  );
}

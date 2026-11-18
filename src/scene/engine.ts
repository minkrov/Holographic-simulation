import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  length,
  unitsValue,
  isoDirection,
  type CameraPose,
  type Distance,
  type Evidence,
  type PointRef,
  type Preset,
  type Units,
  type View,
} from '../core/domain';
import {
  array,
  boreColour,
  disposeModel,
  partColours,
  toBox,
  vector,
  type Surface,
  type VisualModel,
  type VisualPart,
} from './model';

export interface MeasureTool {
  revisionId: string;
  first?: PointRef;
}
export interface SceneSettings {
  view: View;
  units: Units;
  evidence?: Evidence;
  baselineDistance?: Distance;
  tool?: MeasureTool;
}
interface Hooks {
  pick: (point: PointRef) => void;
  pose: (value: CameraPose) => void;
  frame: (current: string, baseline?: string) => void;
  context: (lost: boolean) => void;
}
type Camera = T.OrthographicCamera | T.PerspectiveCamera;
const DARK = '#0b1116',
  INK = '#e4ebef',
  MUTED = '#9aadb7',
  CYAN = '#80d7d2';
const FRONT: Record<Preset, [number, number, number]> = {
  iso: isoDirection,
  front: [0, 0, 1],
  top: [0, 1, 0.00001],
  right: [1, 0, 0],
  back: [0, 0, -1],
};
const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
const FADE = '.55';

export class SceneEngine {
  readonly renderer: T.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private readonly scene = new T.Scene();
  private orthographic = new T.OrthographicCamera(-1, 1, 1, -1, 0.0001, 100);
  private perspective = new T.PerspectiveCamera(36, 1, 0.0001, 100);
  private camera: Camera = this.orthographic;
  private readonly controls: OrbitControls;
  private readonly overlay: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly ray = new T.Raycaster();
  private readonly guide = new T.Group();
  private readonly ghosts = new T.Group();
  private readonly clipPlane = new T.Plane();
  private clipping: T.Plane[] = [];
  private readonly baselinePlane = new T.Plane();
  private baselineClipping: T.Plane[] = [];
  private settings?: SceneSettings;
  private current?: VisualModel;
  private baseline?: VisualModel;
  private grid?: T.LineSegments<T.BufferGeometry, T.LineBasicMaterial>;
  private gridId = '';
  private guideId = '';
  private ghostId = '';
  private scheduled = 0;
  private destroyed = false;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private frameHeight = 0.135;
  private down?: { x: number; y: number };
  private shift = new T.Vector3();
  private baselineCamera?: Camera;
  private bounds = new T.Box3();
  private move?: { timestamp: number; from: CameraPose; to: CameraPose };
  haveFrame = false;

  constructor(
    readonly host: HTMLElement,
    readonly hooks: Hooks,
  ) {
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: true,
    });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(DARK);
    this.scene.background = new T.Color(DARK);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'model-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'scene-labels';
    this.overlay.setAttribute('aria-hidden', 'true');
    host.append(this.canvas, this.overlay);
    this.scene.add(this.guide, this.ghosts, new T.HemisphereLight(0xe5f5ff, 0x465465, 2.15));
    const key = new T.DirectionalLight(0xf0fbff, 2.1);
    key.position.set(-1, 2, 2);
    this.scene.add(key);
    const fill = new T.DirectionalLight(0x9ed5db, 0.72);
    fill.position.set(2, 0.5, -1);
    this.scene.add(fill);
    this.camera.position.set(0.24, 0.27, 0.33);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.minPolarAngle = 0.00003;
    this.controls.maxPolarAngle = Math.PI - 0.00003;
    this.controls.zoomSpeed = 1.03;
    this.controls.rotateSpeed = 0.83;
    this.controls.panSpeed = 1;
    this.controls.target.set(0, 0.024, 0);
    this.controls.update();
    this.controls.addEventListener('change', this.invalidate);
    this.controls.addEventListener('start', this.interact);
    this.controls.addEventListener('end', this.end);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.canvas.addEventListener('pointerdown', this.pointerDown);
    this.canvas.addEventListener('pointerup', this.pointerUp);
    this.canvas.addEventListener('pointercancel', this.pointerCancel);
    this.canvas.addEventListener('webglcontextlost', this.lost);
    this.canvas.addEventListener('webglcontextrestored', this.restored);
    this.resize();
    void document.fonts.ready.then(this.invalidate);
  }

  private interact = () => {
    this.move = undefined;
  };
  private end = () => {
    if (this.haveFrame) this.hooks.pose(this.pose());
  };
  private lost = (event: Event) => {
    event.preventDefault();
    this.haveFrame = false;
    this.hooks.context(true);
  };
  private restored = () => {
    this.hooks.context(false);
    this.invalidate();
  };
  private pointerDown = (event: PointerEvent) => {
    this.down =
      event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY } : undefined;
  };
  private pointerCancel = () => {
    this.down = undefined;
  };
  private pointerUp = (event: PointerEvent) => {
    const start = this.down;
    this.down = undefined;
    if (
      !start ||
      !event.isPrimary ||
      Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5 ||
      !this.current ||
      !this.haveFrame
    )
      return;
    const box = this.canvas.getBoundingClientRect();
    const x = event.clientX - box.left,
      y = event.clientY - box.top;
    const split = this.isSplit();
    const old = split && x < this.width / 2;
    const width = split ? this.width / 2 : this.width;
    const camera = old ? this.baselineCamera : this.camera;
    const model = old ? this.baseline : this.current;
    const tool = this.settings?.tool;
    if (!camera || !model || (tool && model.revision.id !== tool.revisionId) || (old && !tool)) return;
    const p = new T.Vector2(
      ((split && !old ? x - width : x) / width) * 2 - 1,
      1 - (y / this.height) * 2,
    );
    this.ray.setFromCamera(p, camera);
    const hovered = new Map<T.Object3D, VisualPart>();
    for (const part of model.parts)
      if (part.group.visible) for (const s of part.surfaces) hovered.set(s.mesh, part);
    const clipping = old ? this.baselineClipping : this.clipping;
    const hits = this.ray
      .intersectObjects([...hovered.keys()], false)
      .filter((h) => !clipping.length || clipping[0].distanceToPoint(h.point) >= 0);
    let hit = hits[0];
    const view = this.settings?.view;
    if (
      !old &&
      hit &&
      view?.look === 'edges' &&
      view.explode > 0 &&
      view.partId !== 'cover' &&
      model.revision.format === 'sample' &&
      hovered.get(hit.object)?.id === 'cover'
    ) {
      hit = hits.find((h) => hovered.get(h.object)?.id === view.partId) ?? hit;
    }
    if (!hit) return;
    const part = hovered.get(hit.object)!;
    this.hooks.pick({
      revisionId: model.revision.id,
      partId: part.id,
      point: array(hit.point.sub(part.group.position)),
      label: tool?.first ? 'B' : 'A',
    });
  };

  private resize = () => {
    if (this.destroyed) return;
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.ratio = Math.min(window.devicePixelRatio || 1, 1.8);
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.setSize(this.width, this.height, false);
    this.overlay.width = Math.round(this.width * this.ratio);
    this.overlay.height = Math.round(this.height * this.ratio);
    this.lens();
    this.invalidate();
  };
  private isSplit() {
    return !!this.baseline && this.settings?.view.compare === 'split';
  }
  private lens() {
    const aspect = (this.isSplit() ? this.width / 2 : this.width) / this.height;
    const margin = this.isSplit() ? 1.0 : 1.19;
    const half = (this.frameHeight / 2) * Math.max(1, margin / Math.max(0.1, aspect));
    this.orthographic.top = half;
    this.orthographic.bottom = -half;
    this.orthographic.left = -half * aspect;
    this.orthographic.right = half * aspect;
    this.orthographic.updateProjectionMatrix();
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
  }
  pose(): CameraPose {
    return {
      position: array(this.camera.position),
      target: array(this.controls.target),
      height: this.frameHeight / this.orthographic.zoom,
    };
  }
  restore(pose: CameraPose) {
    this.move = undefined;
    this.moveTo(pose);
    this.invalidate();
  }
  private moveTo(pose: CameraPose) {
    this.frameHeight = Math.max(0.00001, pose.height);
    this.orthographic.zoom = 1;
    this.camera.position.copy(vector(pose.position));
    this.controls.target.copy(vector(pose.target));
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.lens();
  }
  private switchProjection(proj: View['projection']) {
    const next = proj === 'ortho' ? this.orthographic : this.perspective;
    if (next === this.camera) return;
    const from = this.pose();
    const heading = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera = next;
    this.controls.object = next;
    if (next instanceof T.PerspectiveCamera)
      from.position = array(
        vector(from.target).addScaledVector(
          heading,
          from.height / (2 * Math.tan(T.MathUtils.degToRad(next.fov / 2))),
        ),
      );
    else
      from.height =
        vector(from.position).distanceTo(vector(from.target)) *
        2 *
        Math.tan(T.MathUtils.degToRad(this.perspective.fov / 2));
    this.restore(from);
  }

  setModels(current?: VisualModel, baseline?: VisualModel) {
    if (current !== this.current) {
      if (this.current) disposeModel(this.current);
      this.current = current;
      if (current) this.scene.add(current.group);
    }
    if (baseline !== this.baseline) {
      if (this.baseline) disposeModel(this.baseline);
      this.baseline = baseline;
      if (baseline) this.scene.add(baseline.group);
    }
    this.ghostId = '';
    this.guideId = '';
    this.haveFrame = false;
    if (!current) {
      this.clearLines(this.ghosts);
      this.clearLines(this.guide);
    }
    this.invalidate();
  }
  configure(settings: SceneSettings) {
    const previous = this.settings;
    this.settings = settings;
    const { view } = settings;
    this.switchProjection(view.projection);
    if (!this.current) {
      this.invalidate();
      return;
    }
    const sceneRange = toBox(this.current.revision.bounds);
    const diagonal = sceneRange.getSize(v(0, 0, 0)).length();
    const { section } = view;
    if (section.enabled) {
      const axis = section.axis;
      const value = T.MathUtils.lerp(
        sceneRange.min[axis],
        sceneRange.max[axis],
        (section.percent + 100) / 200,
      );
      const normal = new T.Vector3();
      normal[axis] = section.flip ? 1 : -1;
      this.clipPlane.set(normal, -value * normal[axis]);
      this.clipping = [this.clipPlane];
    } else this.clipping = [];
    this.current.group.visible = true;
    const split = this.isSplit();
    if (this.baseline) {
      this.baseline.group.visible = split;
      this.shift
        .copy(toBox(this.baseline.revision.bounds).getCenter(v(0, 0, 0)))
        .sub(sceneRange.getCenter(v(0, 0, 0)));
    }
    this.baselineClipping =
      split && this.clipping.length
        ? [this.baselinePlane.copy(this.clipPlane).translate(this.shift)]
        : this.clipping;
    this.layout(this.current, false, diagonal);
    if (this.baseline) this.layout(this.baseline, true, diagonal);
    this.bounds = this.visibleBounds(this.current);
    const side = Math.max(
      diagonal,
      split && this.baseline
        ? toBox(this.baseline.revision.bounds)
            .getSize(v(0, 0, 0))
            .length()
        : 0,
      0.0001,
    );
    const range = Math.max(side, this.bounds.getSize(v(0, 0, 0)).length(), 0.0001);
    this.camera.near = Math.max(0.000001, range / 12_000);
    this.camera.far = Math.max(10, range * 90);
    this.controls.minDistance = Math.max(0.00001, range * 0.018);
    this.controls.maxDistance = Math.max(1, range * 140);
    this.controls.minZoom = 0.07;
    this.controls.maxZoom = 75;
    this.ensureGrid(range);
    this.ensureGuides();
    this.ensureGhost();
    this.lens();
    if (previous?.view.preset && previous.view.preset !== view.preset)
      this.fit(view.preset, false, true);
    else if (this.baseline && previous && previous.view.compare !== view.compare)
      this.fit(undefined, false, true);
    this.invalidate();
  }

  private visibleBounds(model: VisualModel, selected?: boolean) {
    const result = new T.Box3().makeEmpty();
    for (const part of model.parts) {
      if (part.group.visible && (!selected || this.settings?.view.partId === part.id))
        result.union(toBox(part.bounds).translate(part.group.position));
    }
    return result.isEmpty() ? toBox(model.revision.bounds) : result;
  }
  fit(preset?: Preset, selected = false, animate = true) {
    if (!this.current) return;
    const split = this.isSplit();
    const bounds = this.visibleBounds(this.current, selected && !split);
    if (split && this.baseline)
      bounds.union(this.visibleBounds(this.baseline).translate(this.shift.clone().negate()));
    const size = bounds.getSize(v(0, 0, 0));
    const dir = preset
      ? vector(FRONT[preset])
      : this.camera.position.clone().sub(this.controls.target).normalize();
    const target = bounds.getCenter(v(0, 0, 0));
    const up = new T.Vector3(0, 1, 0);
    const side = up.clone().cross(dir).normalize();
    const vertical = dir.clone().cross(side).normalize();
    const span = (basis: T.Vector3) =>
      Math.abs(basis.x * size.x) + Math.abs(basis.y * size.y) + Math.abs(basis.z * size.z);
    const ratio = (split ? this.width / 2 : this.width) / this.height;
    const visibleHeight = Math.max(0.00002, span(vertical), span(side) / Math.max(ratio, 0.1)) * 1.2;
    const height = visibleHeight / Math.max(1, (split ? 1 : 1.19) / Math.max(0.1, ratio));
    const radius = Math.max(0.0001, size.length());
    const radiusCam =
      this.camera instanceof T.PerspectiveCamera
        ? visibleHeight / (2 * Math.tan(T.MathUtils.degToRad(this.perspective.fov / 2))) +
          span(dir) * 0.5
        : radius * 3.2;
    const pose = {
      position: array(target.clone().addScaledVector(dir, radiusCam)),
      target: array(target),
      height,
    };
    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches && this.haveFrame) {
      this.move = { timestamp: performance.now(), from: this.pose(), to: pose };
      this.invalidate();
    } else {
      this.restore(pose);
      this.hooks.pose(this.pose());
    }
  }
  nudge(key: 'left' | 'right' | 'up' | 'down' | 'in' | 'out', pan = false) {
    if (pan && key !== 'in' && key !== 'out') {
      const height =
        this.camera instanceof T.OrthographicCamera
          ? (this.camera.top - this.camera.bottom) / this.camera.zoom
          : this.camera.position.distanceTo(this.controls.target) *
            2 *
            Math.tan(T.MathUtils.degToRad(this.perspective.fov / 2));
      const dir =
        key === 'left'
          ? v(-1, 0, 0)
          : key === 'right'
            ? v(1, 0, 0)
            : key === 'up'
              ? v(0, 1, 0)
              : v(0, -1, 0);
      const shift = dir.applyQuaternion(this.camera.quaternion).multiplyScalar(height * 0.06);
      const pose = this.pose();
      this.restore({
        ...pose,
        position: array(this.camera.position.clone().add(shift)),
        target: array(this.controls.target.clone().add(shift)),
      });
      this.hooks.pose(this.pose());
      return;
    }
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (key === 'in' || key === 'out') {
      const factor = key === 'in' ? 0.82 : 1.22;
      if (this.camera instanceof T.OrthographicCamera) this.frameHeight *= factor;
      else offset.multiplyScalar(factor);
    } else {
      const s = new T.Spherical().setFromVector3(offset);
      if (key === 'left' || key === 'right') s.theta += key === 'left' ? -0.18 : 0.18;
      else s.phi += key === 'up' ? -0.15 : 0.15;
      s.makeSafe();
      offset.setFromSpherical(s);
    }
    this.restore({
      height: this.frameHeight / this.orthographic.zoom,
      target: array(this.controls.target),
      position: array(offset.add(this.controls.target)),
    });
    this.hooks.pose(this.pose());
  }

  private layout(model: VisualModel, baseline: boolean, diagonal: number) {
    const { view } = this.settings!;
    const core = toBox(model.revision.bounds).getCenter(v(0, 0, 0));
    const sample = model.revision.format === 'sample';
    for (const part of model.parts) {
      const chosen = view.partId === part.id && !baseline;
      part.group.visible = baseline
        ? true
        : !view.hidden.includes(part.id) && (!view.isolate || !view.partId || chosen);
      if (sample)
        part.group.position.set(
          0,
          (part.id === 'cover' ? 2 : part.id === 'mount' ? 1 : 0) * view.explode * 0.001,
          0,
        );
      else {
        const dir = toBox(part.bounds)
          .getCenter(v(0, 0, 0))
          .sub(core);
        part.group.position.copy(dir.normalize().multiplyScalar(view.explode * 0.001));
      }
      for (const s of part.surfaces) this.style(s, view, chosen, sample, baseline, diagonal);
    }
    model.group.updateMatrixWorld(true);
  }
  private style(
    s: Surface,
    view: View,
    chosen: boolean,
    sample: boolean,
    baseline: boolean,
    diagonal: number,
  ) {
    const transparentCover =
      sample && s.tone === 'cover' && !chosen && view.explode > 0 && view.look === 'edges';
    const signature = [view.look, chosen, transparentCover, baseline].join(':');
    if (s.signature !== signature) {
      s.replacement?.forEach((m) => m.dispose());
      s.replacement = undefined;
      if (view.look === 'solid') {
        s.mesh.material = s.original;
      } else {
        const palette = sample
          ? partColours[s.tone]
          : chosen
            ? ['#385e67', '#2d505a']
            : partColours.generic;
        const ghost = view.look === 'xray';
        const colours = Array.isArray(s.original)
          ? s.original.map((_, i) =>
              sample && s.tone === 'plate' && i === 2 ? boreColour : palette[i % 2],
            )
          : [palette[0]];
        s.replacement = colours.map((color) =>
          sample
            ? new T.MeshBasicMaterial({
                color,
                transparent: ghost || transparentCover,
                opacity: ghost ? (chosen ? 0.23 : 0.115) : transparentCover ? 0.4 : 1,
                depthWrite: !(ghost || transparentCover),
                polygonOffset: true,
                polygonOffsetFactor: 2,
                polygonOffsetUnits: 3,
                side: T.FrontSide,
              })
            : new T.MeshLambertMaterial({
                color,
                transparent: ghost,
                opacity: ghost ? (chosen ? 0.23 : 0.12) : 1,
                depthWrite: !ghost,
                polygonOffset: true,
                polygonOffsetFactor: 1,
                polygonOffsetUnits: 1,
              }),
        );
        s.mesh.material = Array.isArray(s.original) ? s.replacement : s.replacement[0];
      }
      s.signature = signature;
    }
    const stencil =
      sample && view.look === 'edges' && view.explode > 0 && chosen && s.tone !== 'cover' && !baseline;
    // The contextual, transparent cover must not drown out the inspected part.
    // Stencil only the focus surface; actual holes still reveal the assembly.
    const contextual = transparentCover && !baseline;
    const planes = baseline ? this.baselineClipping : this.clipping;
    for (const mat of Array.isArray(s.mesh.material) ? s.mesh.material : [s.mesh.material]) {
      mat.clippingPlanes = planes;
      mat.stencilWrite = stencil || contextual;
      mat.stencilRef = 1;
      mat.stencilWriteMask = stencil ? 0xff : 0;
      mat.stencilFunc = contextual ? T.NotEqualStencilFunc : T.AlwaysStencilFunc;
      mat.stencilZPass = stencil ? T.ReplaceStencilOp : T.KeepStencilOp;
    }
    const outlined = view.look !== 'solid' || chosen;
    if (outlined && !s.lines) {
      const edges = new T.EdgesGeometry(s.mesh.geometry, sample ? 19 : diagonal > 1 ? 32 : 27);
      s.lines = new T.LineSegments(
        edges,
        new T.LineBasicMaterial({ transparent: true, depthWrite: false }),
      );
      s.mesh.add(s.lines);
    }
    if (s.lines) {
      s.lines.visible = outlined;
      const mat = s.lines.material;
      mat.color.set(
        chosen ? (sample ? '#84c9c9' : '#86dbd6') : s.tone === 'cover' ? '#658693' : '#708a95',
      );
      mat.opacity = chosen ? 0.88 : s.tone === 'cover' ? 0.54 : 0.68;
      mat.stencilWrite = contextual;
      mat.stencilRef = 1;
      mat.stencilWriteMask = 0;
      mat.stencilFunc = contextual ? T.NotEqualStencilFunc : T.AlwaysStencilFunc;
      if (view.look === 'xray') {
        mat.opacity = chosen ? 0.86 : 0.38;
        mat.depthTest = false;
      } else mat.depthTest = true;
      mat.clippingPlanes = planes;
      s.lines.renderOrder = 2;
    }
  }

  private ensureGrid(range: number) {
    const current = this.current!;
    const sample = current.revision.format === 'sample';
    const ideal = range / 15;
    const power = 10 ** Math.floor(Math.log10(ideal));
    const step = sample ? 0.01 : power * ([1, 2, 5, 10].find((n) => n * power >= ideal) ?? 1);
    const id = String(step);
    if (this.gridId !== id) {
      if (this.grid) {
        this.grid.geometry.dispose();
        this.grid.material.dispose();
        this.grid.removeFromParent();
      }
      const positions: number[] = [],
        colors: number[] = [];
      const faint = new T.Color('#18242c'),
        strong = new T.Color('#24323b');
      const reps = 34;
      for (let i = -reps; i <= reps; i++) {
        const p = i * step,
          d = reps * step;
        positions.push(p, 0, -d, p, 0, d, -d, 0, p, d, 0, p);
        for (let j = 0; j < 4; j++) colors.push(...(i % 4 === 0 ? strong : faint).toArray());
      }
      const geo = new T.BufferGeometry()
        .setAttribute('position', new T.Float32BufferAttribute(positions, 3))
        .setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      this.grid = new T.LineSegments(
        geo,
        new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.74 }),
      );
      this.scene.add(this.grid);
      this.gridId = id;
    }
    this.placeGrid(current);
  }
  private placeGrid(model: VisualModel) {
    if (!this.grid) return;
    const b = toBox(model.revision.bounds);
    const c = b.getCenter(v(0, 0, 0));
    this.grid.position.set(c.x, b.min.y - 0.0002, c.z);
  }
  private clearLines(group: T.Group) {
    for (const child of [...group.children]) {
      const line = child as T.LineSegments | T.Line;
      line.geometry.dispose();
      (line.material as T.Material).dispose();
      group.remove(line);
    }
  }
  private ensureGuides() {
    const model = this.current!;
    const { view } = this.settings!;
    const id = [
      model.revision.id,
      view.explode,
      view.hidden.join(','),
      view.isolate,
      view.section.enabled,
    ].join(':');
    if (id === this.guideId) return;
    this.guideId = id;
    this.clearLines(this.guide);
    if (
      model.revision.format !== 'sample' ||
      view.explode === 0 ||
      view.isolate ||
      view.section.enabled ||
      view.hidden.length
    )
      return;
    const positions: number[] = [];
    for (const [x, z] of [
      [0.053, -0.029],
      [0.053, 0.028],
      [-0.051, 0.03],
      [-0.05, -0.03],
    ])
      positions.push(x, 0.011, z, x, 0.019 + view.explode * 0.002, z);
    const g = new T.BufferGeometry().setAttribute(
      'position',
      new T.Float32BufferAttribute(positions, 3),
    );
    const lines = new T.LineSegments(
      g,
      new T.LineDashedMaterial({
        color: '#7998a4',
        dashSize: 0.001,
        scale: 1,
        gapSize: 0.0016,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    lines.computeLineDistances();
    this.guide.add(lines);
  }
  private ensureGhost() {
    const { view } = this.settings!;
    const model = this.baseline;
    const current = this.current!;
    const id = [
      model?.revision.id,
      current.revision.id,
      view.compare,
      view.explode,
      view.isolate,
      view.partId,
      view.hidden.join(','),
      view.section.enabled,
      view.section.axis,
      view.section.percent,
      view.section.flip,
    ].join(':');
    if (id === this.ghostId) return;
    this.ghostId = id;
    this.clearLines(this.ghosts);
    if (!model || view.compare !== 'overlay') return;
    if (model.revision.format === 'sample' && current.revision.format === 'sample') {
      if ((view.isolate && view.partId !== 'mount') || view.hidden.includes('mount')) return;
      const centre = model.revision.parts.find((p) => p.id === 'mount')?.datums?.[1]?.point;
      if (!centre) return;
      const positions: T.Vector3[] = [];
      for (let i = 0; i <= 48; i++) {
        const angle = (i * Math.PI) / 24;
        positions.push(
          v(
            centre[0] + 0.0058 * Math.cos(angle),
            centre[1] + view.explode * 0.001 + 0.00009,
            centre[2] + 0.0058 * Math.sin(angle),
          ),
        );
      }
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints(positions),
        new T.LineDashedMaterial({
          color: '#e0ebed',
          dashSize: 0.00075,
          gapSize: 0.00065,
          transparent: true,
          opacity: 0.82,
          depthWrite: false,
          depthTest: true,
          clippingPlanes: this.clipping,
        }),
      );
      line.computeLineDistances();
      line.renderOrder = 6;
      this.ghosts.add(line);
      return;
    }
    const scale = toBox(model.revision.bounds)
      .getSize(v(0, 0, 0))
      .length();
    for (const p of model.parts)
      for (const s of p.surfaces) {
        const geometry = new T.EdgesGeometry(s.mesh.geometry, 29);
        geometry.applyMatrix4(s.mesh.matrixWorld);
        const line = new T.LineSegments(
          geometry,
          new T.LineDashedMaterial({
            color: '#bdcbd1',
            dashSize: scale * 0.006,
            gapSize: scale * 0.004,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            depthTest: false,
            clippingPlanes: this.clipping,
          }),
        );
        line.computeLineDistances();
        line.renderOrder = 6;
        this.ghosts.add(line);
      }
  }

  invalidate = () => {
    if (!this.destroyed && this.scheduled === 0) this.scheduled = requestAnimationFrame(this.draw);
  };
  private draw = (now: number) => {
    this.scheduled = 0;
    if (this.destroyed) return;
    if (this.move) {
      const duration = (now - this.move.timestamp) / 170;
      const t = 1 - Math.pow(1 - T.MathUtils.clamp(duration, 0, 1), 3);
      const { from, to } = this.move;
      const target = vector(from.target).lerp(vector(to.target), t);
      // Slerp direction rather than passing through the target for a 180° view change.
      const a = vector(from.position).sub(vector(from.target)),
        b = vector(to.position).sub(vector(to.target));
      const q = new T.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
      const direction = a.clone().normalize().applyQuaternion(new T.Quaternion().slerp(q, t));
      const position = target
        .clone()
        .addScaledVector(direction, T.MathUtils.lerp(a.length(), b.length(), t));
      this.moveTo({
        position: array(position),
        target: array(target),
        height: T.MathUtils.lerp(from.height, to.height, t),
      });
      if (duration >= 1) {
        this.move = undefined;
        this.hooks.pose(this.pose());
      } else this.invalidate();
    }
    this.render();
  };
  private render() {
    const { renderer, width, height } = this;
    this.camera.updateMatrixWorld(true);
    const split = this.isSplit();
    const baseline = this.baseline;
    const current = this.current;
    if (split && baseline && current) {
      const old = this.camera.clone();
      old.position.add(this.shift);
      old.updateMatrixWorld(true);
      this.baselineCamera = old;
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, Math.floor(width / 2), height);
      renderer.setScissor(0, 0, Math.floor(width / 2), height);
      current.group.visible = false;
      baseline.group.visible = true;
      this.guide.visible = false;
      this.placeGrid(baseline);
      renderer.render(this.scene, old);
      renderer.setViewport(Math.floor(width / 2), 0, Math.ceil(width / 2), height);
      renderer.setScissor(Math.floor(width / 2), 0, Math.ceil(width / 2), height);
      current.group.visible = true;
      baseline.group.visible = false;
      this.guide.visible = true;
      this.placeGrid(current);
      renderer.render(this.scene, this.camera);
      renderer.setScissorTest(false);
    } else {
      if (baseline) baseline.group.visible = false;
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.render(this.scene, this.camera);
    }
    const wasReady = this.haveFrame;
    this.haveFrame = !!current && !renderer.getContext().isContextLost();
    this.paint();
    if (!wasReady && this.haveFrame && current)
      this.hooks.frame(current.revision.id, baseline?.revision.id);
  }

  private project(point: T.Vector3, old = false): [number, number] | undefined {
    const split = this.isSplit();
    const camera = old && split ? this.baselineCamera : this.camera;
    if (!camera) return;
    const q = point.clone().project(camera);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || q.z < -1 || q.z > 1) return;
    const w = split ? this.width / 2 : this.width;
    return [(q.x + 1) * w * 0.5 + (split && !old ? w : 0), (1 - q.y) * this.height * 0.5];
  }
  private point(ref: PointRef, model: VisualModel) {
    const part = model.parts.find((p) => p.id === ref.partId);
    if (!part || !part.group.visible) return;
    const world = vector(ref.point).add(part.group.position);
    const clipping = model === this.baseline ? this.baselineClipping : this.clipping;
    if (clipping.length && clipping[0].distanceToPoint(world) < 0) return;
    return world;
  }
  private stroke(
    ctx: CanvasRenderingContext2D,
    pts: [number, number][],
    color: string,
    dash: number[] = [],
  ) {
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  private text(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    col = MUTED,
    weight = 400,
    size = 12,
  ) {
    ctx.font = `${weight} ${size}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = col;
    ctx.fillText(text, x, y);
  }
  private paint() {
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const model = this.current;
    const settings = this.settings;
    if (!model || !settings) return;
    const split = this.isSplit();
    if (split) {
      ctx.fillStyle = '#2a3842';
      ctx.fillRect(Math.round(this.width / 2), 0, 1, this.height);
      ctx.fillStyle = DARK;
      ctx.fillRect(7, 9, 136, 25);
      ctx.fillRect(this.width / 2 + 8, 9, 131, 25);
      this.text(ctx, `${this.baseline?.revision.label ?? ''}  BASELINE`, 15, 26, MUTED, 500, 11);
      this.text(ctx, `${model.revision.label}  CURRENT`, this.width / 2 + 16, 26, CYAN, 500, 11);
    }
    this.paintScale(ctx);
    if (settings.view.labels && !settings.view.section.enabled && !settings.tool) {
      if (
        !split &&
        model.revision.format === 'sample' &&
        this.width >= 480 &&
        settings.view.preset === 'iso' &&
        !settings.view.isolate &&
        settings.view.explode >= 6
      )
        this.paintPartLabels(ctx, model);
      else if (model.revision.format !== 'sample') this.paintSelection(ctx, model);
    }
    const evidence = settings.evidence;
    if (evidence?.current.a.revisionId === model.revision.id)
      this.paintDimension(
        ctx,
        model,
        evidence.current.a,
        evidence.current.b,
        evidence.current.mm,
        evidence.current.method === 'mesh',
        false,
      );
    const oldDistance = settings.baselineDistance;
    if (split && this.baseline && oldDistance?.a.revisionId === this.baseline.revision.id)
      this.paintDimension(
        ctx,
        this.baseline,
        oldDistance.a,
        oldDistance.b,
        oldDistance.mm,
        oldDistance.method === 'mesh',
        true,
      );
    if (settings.tool?.first) {
      const old = settings.tool.revisionId === this.baseline?.revision.id;
      const m = old ? this.baseline : model;
      if (m) {
        const at = this.point(settings.tool.first, m);
        const pin = at && this.project(at, old);
        if (pin) this.marker(ctx, pin, 'A');
      }
    }
  }
  private marker(ctx: CanvasRenderingContext2D, p: [number, number], name: string) {
    const [x, y] = p;
    this.stroke(
      ctx,
      [
        [x - 6, y],
        [x + 6, y],
      ],
      CYAN,
    );
    this.stroke(
      ctx,
      [
        [x, y - 6],
        [x, y + 6],
      ],
      CYAN,
    );
    ctx.beginPath();
    ctx.strokeStyle = CYAN;
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#172830';
    ctx.fillRect(x + 8, y + 7, 19, 18);
    this.text(ctx, name, x + 14, y + 20, INK, 500, 11);
  }
  private paintDimension(
    ctx: CanvasRenderingContext2D,
    model: VisualModel,
    a: PointRef,
    b: PointRef,
    mm: number,
    approx: boolean,
    old: boolean,
  ) {
    const worldA = this.point(a, model),
      worldB = this.point(b, model);
    const pa = worldA && this.project(worldA, old),
      pb = worldB && this.project(worldB, old);
    if (!pa || !pb) return;
    const paneWidth = this.isSplit() ? this.width / 2 : this.width;
    const start = this.isSplit() && !old ? paneWidth : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(start, 0, paneWidth, this.height);
    ctx.clip();
    const [ax, ay] = pa,
      [bx, by] = pb;
    const offset = Math.max(17, Math.min(91, this.height * 0.157, Math.min(ay, by) - 28));
    const qa: [number, number] = [ax, ay - offset],
      qb: [number, number] = [bx, by - offset];
    this.stroke(ctx, [pa, [qa[0], qa[1] - 6]], '#a9d4d4', [3, 4]);
    this.stroke(ctx, [pb, [qb[0], qb[1] - 6]], '#a9d4d4', [3, 4]);
    this.stroke(ctx, [qa, qb], CYAN);
    for (const [x, y] of [qa, qb])
      this.stroke(
        ctx,
        [
          [x - 3, y + 6],
          [x + 3, y - 6],
        ],
        CYAN,
      );
    this.marker(ctx, pa, a.label);
    this.marker(ctx, pb, b.label);
    const mx = (ax + bx) / 2,
      my = Math.max(this.isSplit() ? 52 : 17, (ay + by) / 2 - offset);
    const value = (approx ? '≈ ' : '') + length(mm, this.settings!.units);
    ctx.font = '600 15px "IBM Plex Mono", monospace';
    const w = ctx.measureText(value).width + 30;
    const left = Math.max(start + 3, Math.min(start + paneWidth - w - 3, mx - w / 2));
    ctx.fillStyle = '#13282f';
    ctx.strokeStyle = '#659395';
    ctx.lineWidth = 1;
    ctx.fillRect(left, my - 14, w, 27);
    ctx.strokeRect(left + 0.5, my - 13.5, w - 1, 26);
    this.text(ctx, value, left + 15, my + 4, CYAN, 600, 15);
    ctx.restore();
  }
  private paintSelection(ctx: CanvasRenderingContext2D, model: VisualModel) {
    const part = model.parts.find((p) => p.id === this.settings?.view.partId && p.group.visible);
    if (!part) return;
    const hit = this.project(
      toBox(part.bounds)
        .getCenter(v(0, 0, 0))
        .add(part.group.position),
    );
    if (!hit) return;
    const split = this.isSplit(),
      start = split ? this.width / 2 : 0;
    const [x, y] = hit;
    if (x < start + 5 || x >= this.width - 5 || y < 20 || y > this.height - 36) return;
    const max = this.width - start - 28;
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    let label = part.name;
    while (label.length > 1 && ctx.measureText(label).width > max) label = label.slice(0, -2) + '…';
    const w = ctx.measureText(label).width + 16;
    const left = Math.min(this.width - w - 8, Math.max(start + 8, x + 21));
    const top = Math.min(this.height - 63, Math.max(split ? 38 : 9, y + 29));
    this.stroke(
      ctx,
      [
        [x, y],
        [left + 7, top + 10],
      ],
      '#759da4',
    );
    ctx.fillStyle = '#13252d';
    ctx.fillRect(left, top, w, 20);
    this.text(ctx, label, left + 8, top + 14, CYAN, 500, 11);
  }
  private paintPartLabels(ctx: CanvasRenderingContext2D, model: VisualModel) {
    const labels = [
      { id: 'cover', point: v(-0.0595, 0.024, 0.012), right: false, name: 'COVER' },
      { id: 'mount', point: v(-0.036, 0.017, 0.036), right: false, name: 'MOUNT PLATE' },
      { id: 'base', point: v(0.0595, 0.006, -0.009), right: true, name: 'BASE' },
    ];
    for (const item of labels) {
      const part = model.parts.find((p) => p.id === item.id);
      if (!part?.group.visible) continue;
      const ends = this.project(item.point.add(part.group.position));
      if (!ends) continue;
      const [x, y] = ends;
      if (x < 65 || x > this.width - 53 || y < 22 || y > this.height - 40) continue;
      const sel = this.settings?.view.partId === item.id;
      const edge = item.right ? this.width - 61 : 34;
      const yy = Math.min(
        this.height - 52,
        Math.max(31, y + (item.id === 'mount' ? 62 : item.id === 'cover' ? -15 : -53)),
      );
      const dock = item.right
        ? Math.max(x + 9, edge - 50)
        : Math.max(edge + 52, Math.min(x - 20, edge + 92));
      this.stroke(
        ctx,
        [
          [edge, yy],
          [dock, yy],
          [x + (item.right ? 18 : -16), y],
          [x, y],
        ],
        sel ? '#77a8ab' : '#68838d',
      );
      ctx.fillStyle = sel ? CYAN : MUTED;
      ctx.fillRect(edge - 1, yy - 1, 3, 3);
      ctx.beginPath();
      ctx.fillStyle = '#15242b';
      ctx.strokeStyle = sel ? CYAN : '#839da7';
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      this.text(
        ctx,
        item.name,
        item.right ? edge - item.name.length * 7 : edge,
        yy - 12,
        sel ? CYAN : MUTED,
        600,
        11,
      );
    }
  }
  private paintScale(ctx: CanvasRenderingContext2D) {
    if (this.camera instanceof T.OrthographicCamera && this.current?.revision.confirmed) {
      const pixelPerMetre = (this.height * this.camera.zoom) / (this.camera.top - this.camera.bottom);
      const desired = 86 / pixelPerMetre;
      const power = 10 ** Math.floor(Math.log10(desired));
      let ideal = power;
      for (const factor of [1, 2, 5, 10])
        if (Math.abs(factor * power - desired) < Math.abs(ideal - desired)) ideal = factor * power;
      const bar = ideal * pixelPerMetre,
        unit = this.settings!.units;
      const value = Number(unitsValue(ideal * 1000, unit).toPrecision(3));
      const x = 28,
        y = this.height - 32;
      ctx.globalAlpha = +FADE;
      ctx.fillStyle = DARK;
      ctx.fillRect(x - 8, y - 28, bar + 16, 37);
      ctx.globalAlpha = 1;
      this.text(ctx, `${value} ${unit}`, x, y - 12, MUTED, 400, 11);
      this.stroke(
        ctx,
        [
          [x, y],
          [x + bar, y],
        ],
        '#b4c6cc',
      );
      for (const pos of [0, 0.5, 1])
        this.stroke(
          ctx,
          [
            [x + bar * pos, y - 3],
            [x + bar * pos, y + 4],
          ],
          '#b4c6cc',
        );
    } else if (this.current?.revision && !this.current.revision.confirmed) {
      this.text(ctx, 'Scale unverified', 25, this.height - 27, MUTED, 400, 11);
    }
    const q = this.camera.quaternion.clone().invert();
    const ox = this.width - 60,
      oy = this.height - 36;
    ctx.globalAlpha = +FADE;
    ctx.fillStyle = DARK;
    ctx.fillRect(ox - 37, oy - 42, 78, 73);
    ctx.globalAlpha = 1;
    for (const [p, name] of [
      [v(1, 0, 0), 'X'],
      [v(0, 1, 0), 'Y'],
      [v(0, 0, 1), 'Z'],
    ] as const) {
      p.applyQuaternion(q);
      const ex = ox + p.x * 26,
        ey = oy - p.y * 26;
      if (Math.hypot(ex - ox, ey - oy) < 5) continue;
      this.stroke(
        ctx,
        [
          [ox, oy],
          [ex, ey],
        ],
        '#a1b1ba',
      );
      this.text(ctx, name, ex + p.x * 7 - 3, ey - p.y * 8 + 4, INK, 500, 10);
    }
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(ox, oy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  async capture(): Promise<Blob> {
    if (!this.haveFrame) throw new Error('Wait for a rendered model before exporting a snapshot.');
    this.render();
    const target = document.createElement('canvas');
    target.width = this.canvas.width;
    target.height = this.canvas.height;
    const ctx = target.getContext('2d');
    if (!ctx) throw new Error('Could not create a snapshot canvas.');
    ctx.drawImage(this.canvas, 0, 0);
    ctx.drawImage(this.overlay, 0, 0, target.width, target.height);
    return new Promise((resolve, reject) =>
      target.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not export the snapshot.'))),
        'image/png',
      ),
    );
  }

  dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.scheduled);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.canvas.removeEventListener('pointerdown', this.pointerDown);
    this.canvas.removeEventListener('pointerup', this.pointerUp);
    this.canvas.removeEventListener('pointercancel', this.pointerCancel);
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    this.canvas.removeEventListener('webglcontextrestored', this.restored);
    if (this.current) disposeModel(this.current);
    if (this.baseline) disposeModel(this.baseline);
    this.clearLines(this.guide);
    this.clearLines(this.ghosts);
    this.grid?.material.dispose();
    this.grid?.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.overlay.remove();
  }
}

import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { SAMPLE_PREVIOUS, type Bounds, type Revision, type Part, type Vec3 } from '../core/domain';
import { readBytes } from '../core/storage';

export type Tone = 'cover' | 'plate' | 'base' | 'wall' | 'boss' | 'generic';
export interface Surface {
  mesh: T.Mesh<T.BufferGeometry, T.Material | T.Material[]>;
  original: T.Material | T.Material[];
  tone: Tone;
  lines?: T.LineSegments<T.EdgesGeometry, T.LineBasicMaterial>;
  replacement?: T.Material[];
  signature?: string;
}
export interface VisualPart {
  id: string;
  name: string;
  group: T.Group;
  surfaces: Surface[];
  bounds: Bounds;
}
export interface VisualModel {
  group: T.Group;
  parts: VisualPart[];
  revision: Revision;
}
export const vector = (p: Vec3) => new T.Vector3(...p);
export const array = (v: T.Vector3): Vec3 => [v.x, v.y, v.z];
export const toBounds = (box: T.Box3): Bounds => ({ min: array(box.min), max: array(box.max) });
export const toBox = (b: Bounds) => new T.Box3(vector(b.min), vector(b.max));

const m = 0.001;
const profile = (width: number, depth: number, corner: number): [number, number][] => [
  [-width / 2 + corner, -depth / 2],
  [width / 2 - corner, -depth / 2],
  [width / 2, -depth / 2 + corner],
  [width / 2, depth / 2 - corner],
  [width / 2 - corner, depth / 2],
  [-width / 2 + corner, depth / 2],
  [-width / 2, depth / 2 - corner],
  [-width / 2, -depth / 2 + corner],
];
function draw<TPath extends T.Path>(path: TPath, points: [number, number][]) {
  path.moveTo(points[0][0] * m, -points[0][1] * m);
  for (const [x, z] of points.slice(1)) path.lineTo(x * m, -z * m);
  path.closePath();
  return path;
}
function circle(cx: number, cz: number, r: number) {
  const a = new T.Path();
  a.absarc(cx * m, -cz * m, r * m, 0, Math.PI * 2, true);
  return a;
}
function slot(cx: number, z: number, h: number, r: number) {
  const x = cx * m,
    y = -z * m,
    k = h * m,
    radius = r * m;
  const p = new T.Path();
  p.moveTo(x + radius, y + k);
  p.absarc(x, y + k, radius, 0, Math.PI, false);
  p.lineTo(x - radius, y - k);
  p.absarc(x, y - k, radius, Math.PI, 2 * Math.PI, false);
  p.closePath();
  return p;
}

function extrusion(shape: T.Shape, y: number, height: number) {
  const g = new T.ExtrudeGeometry(shape, {
    depth: height * m,
    steps: 1,
    curveSegments: 20,
    bevelEnabled: false,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y * m, 0);
  return g;
}
export const boreColour = '#142c35';
export const partColours: Record<Tone, [string, string]> = {
  cover: ['#263d48', '#20323c'],
  plate: ['#355863', '#264752'],
  base: ['#213741', '#273941'],
  wall: ['#304851', '#243640'],
  boss: ['#38515a', '#29404a'],
  generic: ['#324b55', '#243841'],
};
function surface(geometry: T.BufferGeometry, tone: Tone) {
  if (tone === 'plate') {
    const group = geometry.groups.find((g) => g.materialIndex === 1),
      positions = geometry.getAttribute('position');
    if (group) {
      geometry.groups = geometry.groups.filter((g) => g !== group);
      let from = group.start,
        last = -1;
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const x = Math.abs((positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3);
        const z = Math.abs((positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3);
        const material = x > 0.0559 || z > 0.0374 || x + z > 0.0874 ? 1 : 2;
        if (material !== last) {
          if (i > from) geometry.addGroup(from, i - from, last);
          from = i;
          last = material;
        }
      }
      geometry.addGroup(from, group.start + group.count - from, last);
    }
  }
  const colours = tone === 'plate' ? [...partColours[tone], boreColour] : partColours[tone];
  const material = colours.map(
    (color) =>
      new T.MeshBasicMaterial({
        color,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
  );
  const mesh = new T.Mesh(geometry, material);
  return { mesh, original: material, tone } satisfies Surface;
}
function add(part: VisualPart, s: Surface) {
  part.surfaces.push(s);
  part.group.add(s.mesh);
}

export function makeSample(revision: Revision): VisualModel {
  const group = new T.Group();
  group.name = 'Bench enclosure';
  const parts = revision.parts.map(
    (p) =>
      ({
        id: p.id,
        name: p.name,
        bounds: p.bounds,
        group: new T.Group(),
        surfaces: [],
      }) satisfies VisualPart,
  );
  for (const p of parts) {
    p.group.name = p.name;
    group.add(p.group);
  }
  const [cover, plate, base] = parts;
  const cap = draw(new T.Shape(), profile(119, 82, 6));
  const capHoles = [];
  for (const x of [-48, 48]) for (const z of [-29, 29]) capHoles.push(circle(x, z, 2.6));
  for (const x of [-30, -20, -10, 0, 10, 20, 30]) capHoles.push(slot(x, -3, 12, 1.8));
  cap.holes = capHoles;
  add(cover, surface(extrusion(cap, 19, 5), 'cover'));

  const tray = draw(new T.Shape(), profile(112, 75, 6));
  const holes = [];
  for (const x of [-43, 43]) for (const z of [-25, 25]) holes.push(circle(x, z, 3.3));
  holes.push(circle(-22, -5, 5.8), circle(revision.id === SAMPLE_PREVIOUS ? 20 : 22, -5, 5.8));
  for (const x of [-27, -18, -9, 0, 9, 18, 27]) holes.push(slot(x, 17, 6.2, 1.85));
  tray.holes = holes;
  add(plate, surface(extrusion(tray, 13, 4), 'plate'));

  const floor = draw(new T.Shape(), profile(119, 82, 6));
  add(base, surface(extrusion(floor, 0, 3), 'base'));
  const rim = draw(new T.Shape(), profile(119, 82, 6));
  rim.holes = [draw(new T.Path(), profile(105, 68, 5))];
  add(base, surface(extrusion(rim, 3, 8), 'wall'));
  for (const x of [-43, 43])
    for (const z of [-24, 24]) {
      const boss = new T.Shape();
      boss.absarc(x * m, -z * m, 5.3 * m, 0, Math.PI * 2, false);
      boss.holes = [circle(x, z, 2.1)];
      add(base, surface(extrusion(boss, 3, 5), 'boss'));
    }
  group.updateMatrixWorld(true);
  return { group, parts, revision };
}

function assemble(
  group: T.Group,
  nodes: T.Object3D,
  names: ReadonlyMap<T.Object3D | T.Material | T.Texture, { nodes?: number }>,
  revision: Revision,
  nodeNames?: readonly { name?: string }[],
) {
  nodes.updateMatrixWorld(true);
  const parts = new Map<string, VisualPart>();
  let n = 0;
  nodes.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    let origin: T.Object3D | null = object;
    while (origin && names.get(origin)?.nodes === undefined) origin = origin.parent;
    if (origin && nodeNames && !nodeNames[names.get(origin)?.nodes ?? -1]?.name) {
      let parent = origin.parent;
      while (parent && parent !== nodes) {
        if (nodeNames[names.get(parent)?.nodes ?? -1]?.name) {
          origin = parent;
          break;
        }
        parent = parent.parent;
      }
    }
    const key = origin ? `node-${names.get(origin)?.nodes}` : `mesh-${n++}`;
    let p = parts.get(key);
    if (!p) {
      const index = origin ? names.get(origin)?.nodes : undefined;
      const name = (
        (index !== undefined ? nodeNames?.[index]?.name : undefined) ||
        origin?.name ||
        object.name ||
        `Part ${parts.size + 1}`
      )
        .replace(/[\x00-\x1F]/g, ' ')
        .slice(0, 100);
      p = {
        id: key,
        name,
        group: new T.Group(),
        surfaces: [],
        bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      };
      p.group.name = name;
      parts.set(key, p);
      group.add(p.group);
    }
    const mesh = new T.Mesh(object.geometry, object.material);
    mesh.name = object.name;
    mesh.matrix.copy(object.matrixWorld);
    mesh.matrixAutoUpdate = false;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = 1;
      mat.polygonOffsetUnits = 1;
    }
    add(p, { mesh, original: mesh.material, tone: 'generic' });
  });
  group.updateMatrixWorld(true);
  const result = { group, parts: [...parts.values()], revision };
  try {
    if (!result.parts.length) throw new Error('The active scene contains no mesh parts.');
    for (const part of result.parts) {
      part.bounds = toBounds(new T.Box3().setFromObject(part.group, true));
      const xyz = [...part.bounds.min, ...part.bounds.max];
      if (!xyz.every((n) => Number.isFinite(n) && Math.abs(n) < 10000))
        throw new Error('Model coordinates are non-finite or too large. Check the source units.');
    }
    const size = new T.Box3().setFromObject(group, true).getSize(new T.Vector3()).length();
    if (size < 1e-7) throw new Error('This model has no usable spatial extent. Check the source units.');
  } catch (error) {
    disposeModel(result);
    throw error;
  }
  return result;
}

export async function readVisual(revision: Revision, bytes?: ArrayBuffer): Promise<VisualModel> {
  if (revision.format === 'sample') return makeSample(revision);
  if (!bytes && !revision.key) throw new Error('The source file is unavailable.');
  const data = bytes ?? (await readBytes(revision.key!));
  if (revision.format === 'stl') {
    const geom = new STLLoader().parse(data);
    const scale = revision.multiplier;
    // Rotate Z-up CAD into the Y-up workbench exactly; flat faces stay flat.
    if (revision.up === 'z')
      geom.applyMatrix4(
        new T.Matrix4().set(scale, 0, 0, 0, 0, 0, scale, 0, 0, -scale, 0, 0, 0, 0, 0, 1),
      );
    else geom.scale(scale, scale, scale);
    geom.computeVertexNormals();
    const root = new T.Group();
    const mesh = new T.Mesh(
      geom,
      new T.MeshStandardMaterial({ color: '#7796a0', metalness: 0.08, roughness: 0.65 }),
    );
    mesh.name = revision.fileName.replace(/\.stl$/i, '');
    root.add(mesh);
    return assemble(new T.Group(), root, new Map(), revision);
  }
  const manager = new T.LoadingManager();
  manager.setURLModifier((url) => {
    if (!url.startsWith('blob:')) throw new Error('External resources are not allowed in GLB imports.');
    return url;
  });
  const content = await new GLTFLoader(manager).parseAsync(data, '');
  return assemble(
    new T.Group(),
    content.scene,
    content.parser.associations,
    revision,
    content.parser.json.nodes,
  );
}
export function describeVisual(model: VisualModel): { bounds: Bounds; parts: Part[] } {
  const bounds = new T.Box3().makeEmpty();
  for (const p of model.parts) bounds.union(toBox(p.bounds));
  return {
    bounds: toBounds(bounds),
    parts: model.parts.map((p) => ({ id: p.id, name: p.name, bounds: p.bounds })),
  };
}

export function disposeModel(model: VisualModel) {
  const geometries = new Set<T.BufferGeometry>(),
    mats = new Set<T.Material>(),
    textures = new Set<T.Texture>(),
    images = new Set<ImageBitmap>();
  for (const part of model.parts)
    for (const s of part.surfaces) {
      geometries.add(s.mesh.geometry);
      for (const mat of Array.isArray(s.original) ? s.original : [s.original]) {
        mats.add(mat);
        for (const value of Object.values(mat)) if (value instanceof T.Texture) textures.add(value);
      }
      s.replacement?.forEach((mat) => mats.add(mat));
      if (s.lines) {
        geometries.add(s.lines.geometry);
        mats.add(s.lines.material);
      }
    }
  textures.forEach((tex) => {
    if (typeof ImageBitmap !== 'undefined' && tex.image instanceof ImageBitmap) images.add(tex.image);
    tex.dispose();
  });
  images.forEach((image) => image.close());
  geometries.forEach((g) => g.dispose());
  mats.forEach((mat) => mat.dispose());
  model.group.removeFromParent();
}

export async function exportSample(revision: Revision): Promise<Blob> {
  const model = makeSample(revision);
  try {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const result = await new GLTFExporter().parseAsync(model.group, {
      binary: true,
      onlyVisible: false,
    });
    if (!(result instanceof ArrayBuffer)) throw new Error('Could not create GLB.');
    return new Blob([result], { type: 'model/gltf-binary' });
  } finally {
    disposeModel(model);
  }
}

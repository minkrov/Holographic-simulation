export const MAX_FILE = 75 * 1024 * 1024;
export const MAX_TRIANGLES = 500_000;
const MAX_TEXTURE_BYTES = 128 * 1024 * 1024;
const MAX_GEOMETRY_BYTES = 120 * 1024 * 1024;
const MAX_MESHES = 250;
const staticExtensions = new Set([
  'KHR_materials_unlit',
  'KHR_texture_transform',
  'KHR_mesh_quantization',
  'KHR_materials_clearcoat',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_volume',
  'KHR_materials_iridescence',
  'KHR_materials_anisotropy',
]);

function integer(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(message);
  return value;
}
function dimensions(bytes: Uint8Array, mime: string): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    mime === 'image/png' &&
    bytes.length >= 24 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(12) === 0x49484452
  )
    return [view.getUint32(16), view.getUint32(20)];
  if (mime === 'image/jpeg' && bytes.length >= 10 && view.getUint16(0) === 0xffd8) {
    for (let i = 2; i + 8 < bytes.length; ) {
      if (bytes[i++] !== 0xff) break;
      while (bytes[i] === 0xff) i++;
      const tag = bytes[i++];
      if (tag === 0xd9 || tag === 0xda || i + 2 > bytes.length) break;
      const len = view.getUint16(i);
      if (len < 2 || i + len > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(tag) &&
        len >= 8
      )
        return [view.getUint16(i + 5), view.getUint16(i + 3)];
      i += len;
    }
  }
  throw new Error('Textures must be valid embedded PNG or JPEG images.');
}

export function preflightGlb(data: ArrayBuffer) {
  if (data.byteLength > MAX_FILE || data.byteLength < 20)
    throw new Error('GLB must be between 20 bytes and 75 MiB.');
  const dv = new DataView(data);
  if (
    dv.getUint32(0, true) !== 0x46546c67 ||
    dv.getUint32(4, true) !== 2 ||
    dv.getUint32(8, true) !== data.byteLength
  )
    throw new Error('This is not a complete glTF 2.0 Binary (.glb) file.');
  const jsonLength = dv.getUint32(12, true);
  if (
    !jsonLength ||
    jsonLength > 4 * 1024 * 1024 ||
    jsonLength % 4 ||
    20 + jsonLength > data.byteLength ||
    dv.getUint32(16, true) !== 0x4e4f534a
  )
    throw new Error('Invalid or oversized GLB manifest.');
  let doc;
  try {
    doc = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(data, 20, jsonLength)),
    );
  } catch {
    throw new Error('Invalid GLB manifest JSON.');
  }
  if (!doc || doc.asset?.version !== '2.0') throw new Error('Export as glTF 2.0 Binary (.glb).');
  const tables = [
    'nodes',
    'scenes',
    'buffers',
    'bufferViews',
    'images',
    'accessors',
    'meshes',
    'extensionsRequired',
    'extensionsUsed',
    'animations',
    'skins',
    'materials',
    'textures',
    'cameras',
  ];
  for (const key of tables)
    if (doc[key] !== undefined && !Array.isArray(doc[key])) throw new Error(`Invalid ${key} table.`);
  if (
    doc.skins?.length ||
    doc.animations?.length ||
    doc.meshes?.some((m: { weights?: unknown }) => m?.weights)
  )
    throw new Error(
      'This workbench imports static geometry. Export without rigs, morph targets or animations.',
    );
  const extensions = new Set<string>([...(doc.extensionsUsed ?? []), ...(doc.extensionsRequired ?? [])]);
  const requiredUnknown = (doc.extensionsRequired ?? []).find(
    (name: string) => !staticExtensions.has(name),
  );
  if (
    requiredUnknown ||
    [
      'KHR_draco_mesh_compression',
      'EXT_meshopt_compression',
      'KHR_texture_basisu',
      'EXT_texture_webp',
      'EXT_mesh_gpu_instancing',
    ].some((n) => extensions.has(n))
  )
    throw new Error(
      `Unsupported GLB encoding${requiredUnknown ? ` (${String(requiredUnknown).slice(0, 64)})` : ''}. Export static triangles with uncompressed GLB buffers and PNG/JPEG textures.`,
    );
  if (
    doc.buffers?.length !== 1 ||
    doc.buffers[0]?.uri !== undefined ||
    doc.images?.some((im: { uri?: unknown }) => im?.uri !== undefined)
  )
    throw new Error('The GLB must be self-contained, with embedded buffers and textures.');
  const binStart = 20 + jsonLength + 8;
  if (binStart > data.byteLength || dv.getUint32(binStart - 4, true) !== 0x004e4942)
    throw new Error('The GLB is missing its embedded geometry.');
  const binLength = dv.getUint32(binStart - 8, true);
  const usable = integer(doc.buffers[0]?.byteLength, 'Invalid geometry length.');
  if (binStart + binLength !== data.byteLength || usable > binLength || binLength - usable > 3)
    throw new Error('The embedded GLB buffer is inconsistent.');
  if (
    (doc.bufferViews?.length ?? 0) > 4096 ||
    (doc.accessors?.length ?? 0) > 4096 ||
    (doc.nodes?.length ?? 0) > 1200 ||
    (doc.meshes?.length ?? 0) > MAX_MESHES ||
    (doc.images?.length ?? 0) > 64
  )
    throw new Error('This model has too many nodes, meshes, or textures. Export a smaller assembly.');
  for (const buf of doc.bufferViews ?? []) {
    const start = integer(buf?.byteOffset ?? 0, 'Invalid buffer range.');
    const size = integer(buf?.byteLength, 'Invalid buffer size.');
    if (buf?.buffer !== 0 || start + size > usable)
      throw new Error('The model points outside its embedded buffer.');
  }
  let textureBudget = 0;
  for (const image of doc.images ?? []) {
    const span =
      doc.bufferViews?.[integer(image?.bufferView, 'Textures must use embedded buffer views.')];
    if (!span) throw new Error('Missing texture data.');
    const bytes = new Uint8Array(data, binStart + (span.byteOffset ?? 0), span.byteLength);
    const [w, h] = dimensions(bytes, image.mimeType);
    if (!w || !h || w > 4096 || h > 4096)
      throw new Error('Texture dimensions must not exceed 4096 × 4096.');
    textureBudget += w * h * 4;
    if (textureBudget > MAX_TEXTURE_BYTES)
      throw new Error('Decoded textures exceed 128 MiB. Reduce texture size.');
  }
  let geometryBudget = 0;
  const widths: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16,
  };
  for (const accessor of doc.accessors ?? []) {
    const count = integer(accessor?.count, 'Invalid accessor size.');
    if (!widths[accessor?.type]) throw new Error('Invalid attribute type.');
    geometryBudget += count * widths[accessor.type] * 4;
    if (geometryBudget > MAX_GEOMETRY_BYTES)
      throw new Error('Model geometry is too large once decoded. Simplify the source mesh.');
  }
  const totals = (doc.meshes ?? []).map((mesh: { primitives: Record<string, unknown>[] }) => {
    if (!Array.isArray(mesh?.primitives)) throw new Error('Invalid mesh primitives.');
    return mesh.primitives.reduce((total, raw) => {
      const p = raw as {
        mode?: number;
        targets?: unknown;
        indices?: number;
        attributes?: { POSITION?: number };
      };
      if ((p.mode ?? 4) !== 4 || p.targets) throw new Error('Export triangulated static meshes only.');
      const count = doc.accessors?.[p.indices ?? p.attributes?.POSITION ?? -1]?.count;
      return total + integer(count, 'Missing mesh geometry.') / 3;
    }, 0);
  });
  const active = doc.scene ?? 0;
  if (!Array.isArray(doc.scenes?.[active]?.nodes)) throw new Error('The GLB has no active scene.');
  if (doc.scenes.length > 12)
    throw new Error('Export a single review scene, not a complete scene library.');
  let triangles = 0,
    drawCalls = 0,
    visits = 0;
  const stack = new Set<number>();
  const visit = (idx: number, depth: number) => {
    if (stack.has(idx) || depth > 96 || ++visits > 2500)
      throw new Error('The scene hierarchy is invalid or too complex.');
    const node = doc.nodes?.[idx];
    if (
      !node ||
      node.skin !== undefined ||
      (node.children !== undefined && !Array.isArray(node.children))
    )
      throw new Error('Invalid node or unsupported skinned mesh.');
    if (node.mesh !== undefined) {
      if (!Number.isFinite(totals[node.mesh])) throw new Error('Invalid mesh reference.');
      triangles += totals[node.mesh];
      drawCalls += doc.meshes[node.mesh].primitives.length;
      if (triangles > MAX_TRIANGLES || drawCalls > 650)
        throw new Error('The GLB exceeds the geometry budget (500,000 triangles or 650 primitives).');
    }
    stack.add(idx);
    for (const child of node.children ?? []) visit(integer(child, 'Invalid child index.'), depth + 1);
    stack.delete(idx);
  };
  let activeTriangles = 0;
  for (const [i, scene] of doc.scenes.entries()) {
    if (!Array.isArray(scene?.nodes)) throw new Error('Invalid scene nodes.');
    const previous = triangles;
    for (const idx of scene.nodes) visit(integer(idx, 'Invalid scene index.'), 0);
    if (i === active) activeTriangles = triangles - previous;
  }
  if (!activeTriangles) throw new Error('No triangles were found in the active scene.');
  return { triangles: activeTriangles };
}

export function preflightStl(data: ArrayBuffer) {
  if (data.byteLength < 15 || data.byteLength > MAX_FILE)
    throw new Error('This STL is empty or exceeds 75 MiB.');
  if (data.byteLength >= 84) {
    const dv = new DataView(data),
      count = dv.getUint32(80, true);
    if (84 + count * 50 === data.byteLength) {
      if (!count || count > MAX_TRIANGLES) throw new Error('STL must contain 1–500,000 triangles.');
      for (let face = 84; face < data.byteLength; face += 50)
        for (let v = face + 12; v < face + 48; v += 4) {
          if (!Number.isFinite(dv.getFloat32(v, true)))
            throw new Error('STL vertices must use finite coordinates.');
        }
      return { triangles: count };
    }
  }
  if (data.byteLength > 40 * 1024 * 1024)
    throw new Error('This ASCII STL is too large. Try binary STL.');
  const text = new TextDecoder().decode(new Uint8Array(data));
  if (!/^\s*solid(?:\s|$)/i.test(text) || !/endsolid[^\r\n]*\s*$/i.test(text))
    throw new Error('This is not a complete binary or ASCII STL.');
  const vertex = /^[ \t]*vertex[ \t]+([^\s]+)[ \t]+([^\s]+)[ \t]+([^\s]+)[ \t]*\r?$/gm;
  const numeric = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
  let count = 0;
  for (const match of text.matchAll(vertex)) {
    if (match.slice(1).some((n) => !numeric.test(n) || !Number.isFinite(Number(n))))
      throw new Error('STL vertices must use finite coordinates.');
    if (++count > MAX_TRIANGLES * 3) throw new Error('STL exceeds 500,000 triangles.');
  }
  const faces = [...text.matchAll(/^[ \t]*endfacet[ \t]*\r?$/gm)].length;
  if (!count || count !== faces * 3)
    throw new Error('The ASCII STL does not contain complete triangular faces.');
  return { triangles: count / 3 };
}

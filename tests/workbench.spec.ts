import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const evidence = (page: Page) => page.getByRole('region', { name: 'Measurement evidence' });
const viewport = (page: Page) => page.getByRole('region', { name: 'Interactive 3D model' });
const pending = (page: Page) => page.getByRole('region', { name: 'Pending review' });
async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mount plate', exact: true })).toBeVisible();
  await expect(viewport(page)).toHaveAttribute('data-ready', 'true');
}
async function command(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Command or ask Orion' });
  await input.fill(text);
  await input.press('Enter');
}

test('live 3D, evidence, snapshot, applied review, and undo survive a reload', async ({ page }) => {
  await boot(page);
  await expect(evidence(page)).toContainText('42.0 mm');
  await expect(evidence(page)).toContainText('44.0 mm');
  await expect(evidence(page)).toContainText('+2.0 mm');
  await page.getByRole('button', { name: 'Open evidence M-014' }).click();
  await expect(page.getByRole('dialog', { name: 'Hole spacing' })).toContainText('Euclidean distance');
  await page.keyboard.press('Escape');
  const canvas = page.locator('.model-canvas');
  const rect = await canvas.boundingBox();
  expect(rect).toBeTruthy();
  const before = await canvas.screenshot();
  await page.mouse.move(rect!.x + rect!.width * 0.48, rect!.y + rect!.height * 0.48);
  await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width * 0.61, rect!.y + rect!.height * 0.54, { steps: 6 });
  await page.mouse.up();
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole('button', { name: 'Export current review' }).click();
  const snapshot = page.waitForEvent('download');
  await page.getByRole('button', { name: /Viewport PNG/ }).click();
  const picture = await snapshot;
  const png = await readFile((await picture.path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.length).toBeGreaterThan(10_000);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const save = pending(page).getByRole('button', { name: /Save review/ });
  await save.focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Review saved to this project.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hole spacing', exact: true })).toBeVisible();
  await expect(pending(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Hole spacing', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hole spacing', exact: true }).click();
  await expect(evidence(page)).toContainText('+2.0 mm');
  await command(page, 'undo');
  await expect(page.getByRole('button', { name: 'Hole spacing', exact: true })).toHaveCount(0);
});

test('the console stages a real scoped review and blocks stale writes', async ({ page }) => {
  await boot(page);
  await pending(page).getByRole('button', { name: 'Discard' }).click();
  await command(page, 'Compare this to the previous revision and save a review view.');
  await expect(pending(page)).toContainText('Review required');
  await expect(page.getByRole('tabpanel', { name: 'Console log' })).toContainText('increased by 2.0 mm');
  await page.getByRole('button', { name: 'Base', exact: true }).click();
  await expect(pending(page)).toContainText('Pinned to Mount plate · r06 → r07');
  await command(page, 'save view');
  await page.getByRole('textbox', { name: 'View name' }).fill('Base inspection');
  await page.getByRole('dialog').getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(pending(page)).toContainText('Review out of date');
  await expect(pending(page).getByRole('button', { name: /Save review/ })).toHaveCount(0);
  await pending(page).getByRole('button', { name: 'Show pinned preview' }).click();
  await expect(page.getByRole('heading', { name: 'Mount plate', exact: true })).toBeVisible();
  await expect(evidence(page)).toContainText('44.0 mm');
  await pending(page).getByRole('button', { name: 'Refresh review' }).click();
  await pending(page)
    .getByRole('button', { name: /Save review/ })
    .click();
  await page.getByRole('button', { name: 'Hole spacing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mount plate' })).toBeVisible();
  await expect(evidence(page)).toContainText('44.0 mm');
});

test('imports a real GLB, rejects a malformed model, and persists inspection data', async ({
  page,
}, testInfo) => {
  await boot(page);
  await page.getByRole('button', { name: /bench-enclosure.glb/ }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download source' }).click();
  const file = testInfo.outputPath('instrument.glb');
  await (await downloaded).saveAs(file);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Switch project' }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Test bench');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Drop a model here' })).toBeVisible();
  await page.getByRole('button', { name: 'Import model', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import 3D model' });
  const fileInput = dialog.locator('input[type=file]');
  await fileInput.setInputFiles({
    name: 'bad.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from('invalid GLB file contents'),
  });
  await dialog.getByRole('button', { name: 'Import model', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('not a complete glTF');
  await fileInput.setInputFiles(file);
  await dialog.getByRole('button', { name: 'Import model', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'instrument', exact: true })).toBeVisible();
  await expect(viewport(page)).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('button', { name: 'Confirm scale', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm scale', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm scale' }).click();
  await page.getByRole('button', { name: 'Measurement tools' }).click();
  await page.getByRole('button', { name: 'Enter coordinates' }).click();
  await page.getByRole('spinbutton', { name: 'Point B X' }).fill('30');
  await page.getByRole('spinbutton', { name: 'Point B Y' }).fill('40');
  await page.getByRole('spinbutton', { name: 'Point B Z' }).fill('0');
  await page.getByRole('button', { name: 'Measure points' }).click();
  await expect(evidence(page)).toContainText('50.0 mm');
  await command(page, 'save view');
  await page.getByRole('textbox', { name: 'View name' }).fill('Measured import');
  await page.getByRole('dialog').getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Measured import', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Measured import', exact: true })).toBeVisible();
  await expect(viewport(page)).toHaveAttribute('data-ready', 'true');
  await expect(evidence(page)).toContainText('50.0 mm');
  await page.getByRole('button', { name: /instrument.glb/ }).click();
  const original = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download source' }).click();
  expect(await readFile((await (await original).path())!)).toEqual(await readFile(file));
});

test('orthographic controls, sectioning and palette are usable by keyboard', async ({ page }) => {
  await boot(page);
  const trigger = page.getByRole('button', { name: 'Commands', exact: true });
  await trigger.focus();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('combobox', { name: 'Search commands' });
  await expect(palette).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+k');
  await palette.fill('view top');
  await palette.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Display style' }).click();
  await page.getByRole('button', { name: 'X-ray', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Display style' })).toHaveText('X-ray');
  await page.getByRole('button', { name: 'Section plane' }).click();
  await page.getByRole('checkbox', { name: 'Enable section' }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(viewport(page).getByText(/Section · X/)).toBeVisible();
  await page.getByRole('button', { name: 'Explode assembly' }).click();
  await page.getByRole('spinbutton', { name: 'Explode offset in millimetres' }).fill('28');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Explode assembly' })).toContainText('28 mm');
  await page.getByRole('button', { name: 'Focus viewport' }).click();
  await expect(page.getByLabel('Inspector', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Restore panels' }).click();
  await expect(page.getByLabel('Inspector', { exact: true })).toBeVisible();
  const resize = page.getByRole('separator', { name: 'Resize inspector' });
  await resize.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(resize).toHaveAttribute('aria-valuenow', '336');
  await page.keyboard.press('Enter');
  await expect(resize).toHaveAttribute('aria-valuenow', '328');
  await page.getByRole('tab', { name: 'Console', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Activity' })).toBeFocused();
});

test('mobile viewport stays within the device and exposes both panels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(viewport(page)).toHaveAttribute('data-ready', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: 'Toggle inspector' }).click();
  await expect(evidence(page)).toContainText('44.0 mm');
  await expect(page.getByRole('button', { name: 'Close inspector panel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Toggle inspector' })).toBeFocused();
  await page.getByRole('button', { name: 'Toggle project panel' }).click();
  await expect(page.getByRole('button', { name: 'Mount plate', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close project panel' }).click();
  await expect(viewport(page)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 690 });
  await page.getByRole('button', { name: 'Baseline comparison' }).click();
  const items = await page.getByRole('button', { name: 'Overlay shared origin' }).boundingBox();
  expect(items && items.x >= 0 && items.x + items.width <= 320).toBeTruthy();
  await page.getByRole('button', { name: 'Side by side', exact: true }).click();
  await expect(viewport(page)).toHaveAttribute('data-comparison', 'split');
  const fit = await page.getByRole('button', { name: 'Fit selection', exact: true }).boundingBox();
  expect(fit && fit.x + fit.width <= 320).toBeTruthy();
});

test('inspection metadata stays available when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    // Emulate an unsupported graphics stack without changing any workbench code.
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...opts: unknown[]
    ) {
      if (kind.startsWith('webgl')) return null;
      return Reflect.apply(original, this, [kind, ...opts]);
    } as typeof original;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Model not rendered' })).toBeVisible();
  await expect(evidence(page)).toContainText('44.0 mm');
  await expect(page.getByRole('button', { name: 'Retry viewport' })).toBeVisible();
});

// An independent binary STL fixture, with known canonical extents after Z→Y rotation.
function slab(width: number) {
  const bytes = Buffer.alloc(84 + 2 * 50);
  bytes.writeUInt32LE(2, 80);
  const p = [
    [-width / 2, -15, 0],
    [width / 2, -15, 0],
    [width / 2, 15, 0],
    [-width / 2, 15, 0],
  ];
  for (const [index, triangle] of [
    [0, 1, 2],
    [0, 2, 3],
  ].entries()) {
    const start = 84 + 50 * index;
    bytes.writeFloatLE(1, start + 8);
    triangle.flatMap((i) => p[i]).forEach((n, i) => bytes.writeFloatLE(n, start + 12 + 4 * i));
  }
  return bytes;
}
async function importSlab(page: Page, name: string, width: number, asRevision = false) {
  await page.getByRole('button', { name: 'Import model', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import 3D model' });
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: `${name}.stl`, mimeType: 'model/stl', buffer: slab(width) });
  if (asRevision) await dialog.getByLabel('Import as').selectOption('revision');
  await dialog.getByLabel('STL source units').selectOption('cm');
  await dialog.getByRole('checkbox', { name: /know the source scale/ }).check();
  await dialog
    .getByRole('button', { name: asRevision ? 'Import revision' : 'Import model', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(viewport(page)).toHaveAttribute('data-ready', 'true');
}
async function enterDistance(page: Page, bX: string, baseline = false) {
  await page.getByRole('button', { name: 'Measurement tools' }).click();
  await page.getByRole('button', { name: 'Enter coordinates' }).click();
  const dialog = page.getByRole('dialog', { name: 'Enter measurement points' });
  if (baseline)
    await dialog
      .getByRole('combobox', { name: 'Revision', exact: true })
      .selectOption({ label: 'r01 · Baseline' });
  await dialog.getByRole('spinbutton', { name: 'Point B X' }).fill(bX);
  await dialog.getByRole('spinbutton', { name: 'Point B Y' }).fill('0');
  await dialog.getByRole('spinbutton', { name: 'Point B Z' }).fill('0');
  await dialog.getByRole('button', { name: 'Measure points' }).click();
}
async function reviewJson(page: Page) {
  await page.getByRole('button', { name: 'Export current review' }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: /Review JSON/ }).click();
  const data = JSON.parse(await readFile((await (await event).path())!, 'utf8'));
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  return data;
}

test('normalizes STL units and axis, ray-picks points, then compares and reopens two revisions', async ({
  page,
}) => {
  await boot(page);
  await pending(page).getByRole('button', { name: 'Discard' }).click();
  await importSlab(page, 'Datum slab', 40);
  await expect(page.getByRole('heading', { name: 'Datum slab', exact: true })).toBeVisible();
  await expect(page.locator('.geometry-size')).toContainText('400.0 × 0.0 × 300.0 mm');
  const canvas = page.locator('.model-canvas');
  await command(page, 'view top');
  await page.getByRole('button', { name: 'Measurement tools' }).click();
  await page.getByRole('button', { name: 'Pick two points' }).click();
  const bounds = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: bounds.width * 0.43, y: bounds.height * 0.5 } });
  await expect(viewport(page).getByText('Pick point B')).toBeVisible();
  await canvas.click({ position: { x: bounds.width * 0.56, y: bounds.height * 0.5 } });
  await expect(evidence(page)).toContainText('Approx. · two mesh surface points');
  const picked = await reviewJson(page);
  expect(picked.evidence.current.mm).toBeGreaterThan(8);
  expect(picked.evidence.current.mm).toBeLessThan(400);
  expect(picked.evidence.current.a.point[1]).toBeCloseTo(0, 7);
  expect(picked.sources[0]).toMatchObject({
    metresPerSourceUnit: 0.01,
    sourceUp: 'z',
    revision: 'r01',
    scaleConfirmed: true,
  });
  await importSlab(page, 'Datum slab updated', 44, true);
  await expect(viewport(page)).toHaveAttribute('data-comparison', 'split');
  await expect(page.getByRole('button', { name: 'Unpin r01 baseline' })).toBeVisible();
  await enterDistance(page, '44');
  await enterDistance(page, '40', true);
  await expect(evidence(page)).not.toContainText('Change');
  await page.getByRole('button', { name: 'Compare A/B pairs' }).click();
  await page.getByRole('button', { name: 'Compare matching points' }).click();
  await expect(evidence(page)).toContainText('40.0 mm');
  await expect(evidence(page)).toContainText('44.0 mm');
  await expect(evidence(page)).toContainText('+4.0 mm');
  await page.getByRole('button', { name: 'Baseline comparison' }).click();
  await page.getByRole('button', { name: 'Overlay shared origin' }).click();
  await expect(viewport(page)).toHaveAttribute('data-comparison', 'overlay');
  await page.getByRole('button', { name: 'Baseline comparison' }).click();
  await page.getByRole('button', { name: 'Side by side', exact: true }).click();
  await expect(viewport(page)).toHaveAttribute('data-comparison', 'split');
  await viewport(page).focus();
  await page.keyboard.press('ArrowUp');
  await command(page, 'Compare these revisions and save a review.');
  await expect(pending(page)).toContainText('Point distance');
  await pending(page)
    .getByRole('button', { name: /Save review/ })
    .click();
  await expect(page.getByText('Review saved to this project.', { exact: true })).toBeVisible();
  const saved = await reviewJson(page);
  await page.reload();
  await page.getByRole('button', { name: 'Point distance', exact: true }).click();
  await expect(viewport(page)).toHaveAttribute('data-ready', 'true');
  await expect(viewport(page)).toHaveAttribute('data-comparison', 'split');
  await expect(evidence(page)).toContainText('+4.0 mm');
  const reopened = await reviewJson(page);
  expect(reopened.pose.height).toBeCloseTo(saved.pose.height, 9);
  for (const key of ['position', 'target'])
    for (let i = 0; i < 3; i++) expect(reopened.pose[key][i]).toBeCloseTo(saved.pose[key][i], 9);
  expect(reopened.evidence).toEqual(saved.evidence);
  expect(reopened.sources.map((source: { revision: string }) => source.revision)).toEqual([
    'r02',
    'r01',
  ]);
});

test('a cancelled file read never publishes an asset', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function (this: Blob) {
      if (this instanceof File && this.name === 'cancel.stl')
        return new Promise((resolve) => setTimeout(() => resolve(original.call(this)), 400));
      return original.call(this);
    };
  });
  await boot(page);
  await page.getByRole('button', { name: 'Import model', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import 3D model' });
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'cancel.stl', mimeType: 'model/stl', buffer: slab(40) });
  await dialog.getByRole('button', { name: 'Import model', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel import' }).click();
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Activity log' })).toContainText(
    'Import cancelled. No model was added.',
  );
  await importSlab(page, 'Valid after cancel', 40);
  await expect(page.getByRole('region', { name: 'Assets' })).not.toContainText('cancel r01');
  await expect(page.getByRole('heading', { name: 'Valid after cancel', exact: true })).toBeVisible();
});

test('a stale browser tab cannot overwrite an applied review', async ({ page, context }) => {
  await boot(page);
  const other = await context.newPage();
  await boot(other);
  await pending(page)
    .getByRole('button', { name: /Save review/ })
    .click();
  await expect(page.getByText('Review saved to this project.', { exact: true })).toBeVisible();
  await pending(other).getByRole('button', { name: 'Discard' }).click();
  await expect(other.getByText('Other tab saved · Session only', { exact: true })).toBeVisible();
  await other.reload();
  await expect(other.getByRole('button', { name: 'Hole spacing', exact: true })).toBeVisible();
  await expect(pending(other)).toHaveCount(0);
  await other.close();
});

test('connector opt-in is explicit, requests are scoped, and cancel and disconnect leave manual tools on', async ({
  page,
}) => {
  const capability = {
    mode: 'connector',
    label: 'Test connector',
    destination: 'https://orion.example.invalid',
  };
  await page.route('**/api/orion', (route) => route.fulfill({ json: capability }));
  const requests: unknown[] = [];
  let release: (() => void) | undefined;
  await page.route('**/api/orion/plan', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ json: { action: 'review' } }).catch(() => undefined);
    } else await route.fulfill({ status: 502, json: { error: 'The test runtime is unavailable.' } });
  });
  await boot(page);
  await pending(page).getByRole('button', { name: 'Discard' }).click();
  await command(page, 'Inspect this part.');
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Workbench settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Send plain-language requests to Test connector' }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await command(page, 'Compare these revisions and prepare a review.');
  await expect(page.getByText('Waiting for Orion', { exact: true })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    schema: 1,
    intent: 'Compare these revisions and prepare a review.',
    scope: {
      asset: 'Enclosure',
      part: 'Mount plate',
      current: 'r07',
      baseline: 'r06',
      hasMeasurement: true,
      scaleConfirmed: true,
    },
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  release?.();
  await expect(pending(page)).toHaveCount(0);
  await command(page, 'Inspect this part.');
  await expect(page.getByRole('button', { name: 'Orion offline', exact: true })).toBeVisible();
  await expect(evidence(page)).toContainText('44.0 mm');
  await command(page, 'view front');
  expect(requests).toHaveLength(2);
  await page.unroute('**/api/orion');
  await page.route('**/api/orion', (route) =>
    route.fulfill({ json: { ...capability, destination: 'https://new-orion.example.invalid' } }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Workbench settings', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Send plain-language requests to Test connector' }),
  ).not.toBeChecked();
});

test('denied browser storage is clearly session-only', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new DOMException('Unavailable', 'SecurityError');
      },
    }),
  );
  await boot(page);
  await expect(page.getByText('Session only', { exact: true })).toBeVisible();
  await pending(page)
    .getByRole('button', { name: /Save review/ })
    .click();
  await expect(
    page.getByText('Review kept for this session only. Export it before closing.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hole spacing', exact: true })).toBeVisible();
  await page.reload();
  await expect(pending(page)).toContainText('Review required');
});

test('viewport retry restores rendering after a WebGL context loss', async ({ page }) => {
  await boot(page);
  const support = await page.locator('.model-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('webgl2');
    const extension = context?.getExtension('WEBGL_lose_context');
    extension?.loseContext();
    return !!extension;
  });
  expect(support).toBe(true);
  await expect(page.getByRole('heading', { name: 'Model not rendered' })).toBeVisible();
  await expect(evidence(page)).toContainText('44.0 mm');
  await page.getByRole('button', { name: 'Retry viewport' }).click();
  await expect(viewport(page)).toHaveAttribute('data-ready', 'true');
});

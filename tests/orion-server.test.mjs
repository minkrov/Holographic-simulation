import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { orionMiddleware } from '../server/orion.mjs';

const servers = [];
async function serve(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});
function app(settings) {
  const middleware = orionMiddleware(settings);
  return serve(
    (req, res) =>
      void middleware(req, res, () => {
        res.writeHead(404);
        res.end();
      }),
  );
}
const plan = (base, body, headers = {}) =>
  fetch(`${base}/api/orion/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('Orion HTTP connector', () => {
  it('runs locally by default, with no configured external route', async () => {
    const base = await app({});
    expect(await (await fetch(`${base}/api/orion`)).json()).toEqual({
      mode: 'local',
      label: 'Local engine',
    });
    expect((await plan(base, { schema: 1, intent: 'Compare' })).status).toBe(503);
  });
  it('rejects a mismatched origin and forwards only typed context and approved actions', async () => {
    const seen = [];
    const runtime = await serve(async (req, res) => {
      const pieces = [];
      for await (const chunk of req) pieces.push(chunk);
      seen.push({
        payload: JSON.parse(Buffer.concat(pieces).toString()),
        authorization: req.headers.authorization,
      });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ action: 'view', preset: 'top', projectWrite: 'ignored' }));
    });
    const base = await app({ ORION_ENDPOINT: runtime + '/plan', ORION_TOKEN: 'test-configured-secret' });
    expect(await (await fetch(`${base}/api/orion`)).json()).toEqual({
      mode: 'connector',
      label: 'Orion connector',
      destination: runtime,
    });
    const request = {
      schema: 1,
      intent: 'Top view of this',
      scope: {
        part: 'Cover',
        current: 'r07',
        hasMeasurement: false,
        scaleConfirmed: true,
        geometry: 'not forwarded',
      },
    };
    expect((await plan(base, request, { Origin: 'https://different.example.invalid' })).status).toBe(
      403,
    );
    expect(seen).toHaveLength(0);
    const response = await plan(base, { ...request, modelBytes: 'not forwarded' }, { Origin: base });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ action: 'view', preset: 'top' });
    expect(seen[0]).toEqual({
      authorization: 'Bearer test-configured-secret',
      payload: {
        schema: 1,
        intent: request.intent,
        scope: {
          asset: '',
          part: 'Cover',
          current: 'r07',
          baseline: '',
          hasMeasurement: false,
          scaleConfirmed: true,
        },
        allowedActions: ['inspect', 'measure', 'compare', 'review', 'view', 'help'],
      },
    });
  });
  it('does not accept a plan that tries to bypass the supported action set', async () => {
    const runtime = await serve((_req, res) =>
      res.end(JSON.stringify({ action: 'save', scope: 'arbitrary' })),
    );
    const base = await app({ ORION_ENDPOINT: runtime });
    expect((await plan(base, { schema: 1, intent: 'Save this' })).status).toBe(422);
  });
});

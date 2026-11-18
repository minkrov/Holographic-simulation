// Only the server can address Orion. Browsers never receive its URL path or secret.
const ACTIONS = new Set(['inspect', 'measure', 'compare', 'review', 'view', 'help']);
const PRESETS = new Set(['iso', 'front', 'top', 'right', 'back']);
const LIMIT = 16_384;
const local = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function normalizePlan(value) {
  if (!value || typeof value !== 'object' || !ACTIONS.has(value.action)) return null;
  if (value.action === 'view' && !PRESETS.has(value.preset)) return null;
  return value.action === 'view' ? { action: 'view', preset: value.preset } : { action: value.action };
}

async function readBounded(stream, limit) {
  const pieces = [];
  let size = 0;
  for await (const item of stream) {
    const chunk = Buffer.isBuffer(item) ? item : Buffer.from(item);
    size += chunk.length;
    if (size > limit) throw new Error('Message is too large.');
    pieces.push(chunk);
  }
  return JSON.parse(Buffer.concat(pieces).toString('utf-8'));
}

export function orionMiddleware(env = process.env) {
  let endpoint = null;
  if (env.ORION_ENDPOINT) {
    try {
      const url = new URL(env.ORION_ENDPOINT);
      if (
        (url.protocol === 'https:' || (url.protocol === 'http:' && local(url.hostname))) &&
        !url.username &&
        !url.password
      )
        endpoint = url;
    } catch {
      /* An invalid connector is not enabled. */
    }
  }
  const label = clean(env.ORION_LABEL, 48) || 'Orion connector';
  const token = env.ORION_TOKEN;
  const isPublic = env.ORION_ALLOW_NONLOCAL === '1';
  let inFlight = 0;
  return async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (path !== '/api/orion' && path !== '/api/orion/plan') return next();
    const send = (status, body) => {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(body));
    };
    let host;
    try {
      host = new URL(`http://${req.headers.host}`);
    } catch {
      return send(400, { error: 'Invalid host.' });
    }
    const origin = req.headers.origin;
    if (origin) {
      let parsed;
      try {
        parsed = new URL(origin);
      } catch {
        return send(403, { error: 'Invalid origin.' });
      }
      if (parsed.host !== host.host || !['https:', 'http:'].includes(parsed.protocol))
        return send(403, { error: 'Use the workbench origin.' });
    }
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return send(403, { error: 'Use the workbench origin.' });
    const directLocal =
      local(host.hostname) &&
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const enabled = !!endpoint && (directLocal || isPublic);
    if (path === '/api/orion' && req.method === 'GET') {
      return send(
        200,
        enabled
          ? { mode: 'connector', label, destination: endpoint.origin }
          : { mode: 'local', label: 'Local engine' },
      );
    }
    if (path !== '/api/orion/plan' || req.method !== 'POST')
      return send(405, { error: 'Method not allowed.' });
    if (!enabled) return send(503, { error: 'No Orion connector is configured for this origin.' });
    if (!req.headers['content-type']?.startsWith('application/json'))
      return send(415, { error: 'Send an application/json request.' });
    if (inFlight >= 2)
      return send(429, { error: 'The connector is busy. Try again after the active run.' });
    if (Number(req.headers['content-length']) > LIMIT)
      return send(413, { error: 'Request is too large.' });
    inFlight++;
    const abort = new AbortController();
    const close = () => {
      if (!res.writableEnded) abort.abort();
    };
    res.on('close', close);
    try {
      let data;
      try {
        data = await readBounded(req, LIMIT);
      } catch {
        return send(400, { error: 'Invalid request JSON.' });
      }
      if (data?.schema !== 1 || !clean(data?.intent, 800))
        return send(422, { error: 'A nonempty intent and schema 1 are required.' });
      const scope = {
        asset: clean(data.scope?.asset, 100),
        part: clean(data.scope?.part, 100),
        current: clean(data.scope?.current, 40),
        baseline: clean(data.scope?.baseline, 40),
        hasMeasurement: data.scope?.hasMeasurement === true,
        scaleConfirmed: data.scope?.scaleConfirmed === true,
      };
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          schema: 1,
          intent: clean(data.intent, 800),
          scope,
          allowedActions: [...ACTIONS],
        }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok || !response.body)
        return send(502, { error: 'Orion did not return a plan. Local commands are still available.' });
      const plan = normalizePlan(await readBounded(response.body, LIMIT));
      if (!plan)
        return send(422, { error: 'Orion returned an unsupported action. No changes were applied.' });
      send(200, plan);
    } catch {
      send(502, {
        error: 'Orion did not respond in time or returned invalid data. No changes were applied.',
      });
    } finally {
      inFlight--;
      res.removeListener('close', close);
    }
  };
}

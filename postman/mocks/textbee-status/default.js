// Local fixture from TextBee's 2026-10-25 public API reference and status docs.
// Own mock: no connected vendor workspace was available. Never sends a real SMS.
const http = require('node:http');
const key = 'textbee-status-state';
const fresh = () => ({ sends: 0, checks: 0, mode: 'sent', devices: [] });
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const state = await pm.state.get(key) || fresh();
  const json = (code, data, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/__test/reset') { await pm.state.set(key, fresh()); return json(200, {}); }
  if (url.pathname === '/__test/mode') { state.mode = url.searchParams.get('value'); await pm.state.set(key, state); return json(200, {}); }
  if (url.pathname === '/__test/counts') return json(200, state);
  if (req.method === 'POST' && url.pathname === '/api/v1/gateway/send-sms') {
    if (req.body?.deviceId !== 'original-device' || !Array.isArray(req.body?.recipients)) return json(400, {});
    state.sends++; await pm.state.set(key, state);
    return json(200, { data: { success: true, smsBatchId: 'fixture-batch-' + state.sends } });
  }
  const match = /^\/api\/v1\/gateway\/devices\/([^/]+)\/sms-batch\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && match) {
    state.checks++; state.devices.push(match[1]); await pm.state.set(key, state);
    if (state.mode === 'authentication_failed') return json(401, {});
    if (state.mode === 'not_found') return json(404, {});
    if (state.mode === 'rate_limited') return json(429, {}, { 'Retry-After': '17' });
    if (state.mode === 'server_error') { res.writeHead(503, { 'Content-Type': 'text/html' }); return res.end('<html>fixture failure</html>'); }
    if (state.mode === 'timeout') { setTimeout(() => json(200, {}), 1000); return; }
    if (state.mode === 'malformed_response') return json(200, { data: { unexpected: true } });
    return json(200, { data: { batch: { status: 'completed' }, messages: [{ status: state.mode, errorCode: state.mode === 'failed' ? '4' : undefined }] } });
  }
  return json(501, {});
}).listen(process.env.PORT);

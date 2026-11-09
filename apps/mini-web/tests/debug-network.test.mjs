import assert from 'node:assert/strict';
import { it } from 'node:test';
import { boundedDebugValue, debugHeaders, debugQueryParams, debugResponseDetails } from '../src/lib/debug-network.ts';

it('redacts credentials and tracking identifiers from request details', () => {
  const url = new URL('https://example.test/api/home?albumId=42&ttclid=private-click&click_id=private-id');
  assert.deepEqual(debugQueryParams(url), { albumId: '42', ttclid: '[REDACTED]', click_id: '[REDACTED]' });
  const headers = new Headers({ Authorization: 'Bearer private-token', Accept: 'application/json' });
  assert.deepEqual(debugHeaders(headers), { accept: 'application/json', authorization: '[REDACTED]' });
  assert.deepEqual(debugHeaders(new Headers({ 'Access-Control-Allow-Origin': 'https://minis.example.test' })), { 'access-control-allow-origin': 'https://minis.example.test' });
  assert.deepEqual(boundedDebugValue(debugHeaders(new Headers({ 'Access-Control-Allow-Origin': 'https://minis.example.test' }))), { 'access-control-allow-origin': 'https://minis.example.test' });
  assert.deepEqual(boundedDebugValue({ episodeId: 'episode-1', password: 'secret', nested: { userId: 'private-user', status: 'ok' } }), {
    episodeId: 'episode-1', password: '[REDACTED]', nested: { userId: '[REDACTED]', status: 'ok' }
  });
});

it('bounds large request and response previews', () => {
  const result = boundedDebugValue(Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`field${index}`, 'x'.repeat(900)])));
  assert.equal(result.truncated, true);
  assert.ok(result.preview.length <= 4_096);
});

it('keeps response correlation and retry headers while redacting credentials', () => {
  const response = new Response('{"error":{"code":"SERVER_BUSY"}}', {
    status: 503,
    headers: {
      'X-Request-ID': 'req-123', 'Retry-After': '2', 'Server-Timing': 'db;dur=12.5, app;dur=18.3',
      'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://minis.example.test',
      'Set-Cookie': 'session=private'
    }
  });
  const details = debugResponseDetails(response, { error: { code: 'SERVER_BUSY', token: 'private' } });
  assert.equal(details.requestId, 'req-123');
  assert.equal(details.retryAfter, '2');
  assert.equal(details.serverTiming, 'db;dur=12.5, app;dur=18.3');
  assert.equal(details.errorCode, 'SERVER_BUSY');
  assert.equal(details.responseHeaders['set-cookie'], '[REDACTED]');
  assert.deepEqual(details.responseBody, { error: { code: 'SERVER_BUSY', token: '[REDACTED]' } });
});

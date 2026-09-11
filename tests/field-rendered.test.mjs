import assert from 'node:assert/strict';
import test from 'node:test';

test('the built application serves the fog entrance', async () => {
  const { default: worker } = await import('../dist/server/index.js');
  const response = await worker.fetch(new Request('http://localhost/', { headers: { accept: 'text/html' } }), { ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /fog-shell/);
  assert.match(html, /ariadne-title-background\.png/);
  assert.match(html, />Enter<\/button>/);
  assert.doesNotMatch(html, /Go back in|pixel-button|\/story\//);
});

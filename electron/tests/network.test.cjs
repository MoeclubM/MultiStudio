const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { desktopFetch } = require('../network.cjs');
const { hfFetch } = require('../hub.cjs');
test('Electron manual redirect fallback probes HEAD, validates host, drops token and streams final response', async () => {
  const calls = [], probes = [];
  const net = {
    async fetch(url, init) { calls.push({ url, init }); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); if (url.includes('huggingface.co')) throw new Error('Redirect was cancelled'); return new Response('final body'); },
    request(options) { probes.push(options); assert.equal(options.method, 'HEAD'); assert.equal(options.redirect, 'manual'); const request = new EventEmitter(); request.setHeader = () => {}; request.abort = () => request.emit('error', new Error('aborted')); request.end = () => queueMicrotask(() => request.emit('redirect', 302, 'GET', 'https://cdn.hf.co/file')); return request; },
  };
  const response = await hfFetch('https://huggingface.co/file', { token: 'private-fixture', fetcher: desktopFetch(net) });
  assert.equal(await response.text(), 'final body'); assert.equal(probes.length, 1); assert.equal(calls[0].init.headers.Authorization, 'Bearer private-fixture'); assert.equal(calls[1].init.headers.Authorization, undefined);
  net.request = () => { const req = new EventEmitter(); req.setHeader = () => {}; req.abort = () => {}; req.end = () => queueMicrotask(() => req.emit('redirect', 302, 'GET', 'https://evil.example/file')); return req; };
  await assert.rejects(hfFetch('https://huggingface.co/file', { fetcher: desktopFetch(net) }), /官方 HTTPS/);
});
test('non-redirect network failures and API redirect errors are not retried', async () => {
  let probes = 0; const net = { fetch: async () => { throw new Error('certificate invalid'); }, request: () => { probes++; } };
  await assert.rejects(desktopFetch(net)('https://huggingface.co/file', { redirect: 'manual' }), /certificate/);
  net.fetch = async () => { throw new Error('Redirect was cancelled'); };
  await assert.rejects(desktopFetch(net)('https://speech.example/v1', { redirect: 'error' }), /Redirect/); assert.equal(probes, 0);
});

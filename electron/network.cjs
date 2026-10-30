// Electron fetch rejects manual redirects instead of exposing a 3xx response.
// Fetch with redirect:error first; on a redirect, use a HEAD-only native request
// to recover Location. ModelHub validates it before making the next request.
// Binary bodies always use Chromium fetch streams, not unbounded IPC buffers.
function redirectProbe(net, url, init, originalError) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'HEAD', redirect: 'manual', useSessionCookies: false, credentials: 'omit' });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true;
      init.signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
      request.abort();
    };
    const abort = () => finish(init.signal.reason ?? new Error('请求已取消'));
    request.on('redirect', (status, _method, target) => finish(null, new Response(null, { status, headers: { Location: target } })));
    request.on('response', () => finish(originalError)); // No redirect on HEAD: don't infer a safe GET destination.
    request.on('error', error => finish(error));
    for (const [name, value] of Object.entries(init.headers ?? {})) request.setHeader(name, value);
    if (init.signal?.aborted) { abort(); return; }
    init.signal?.addEventListener('abort', abort, { once: true });
    request.end();
  });
}
function desktopFetch(net) {
  return async (url, init = {}) => {
    try { return await net.fetch(url, { ...init, credentials: 'omit', redirect: init.redirect === 'manual' ? 'error' : init.redirect }); }
    catch (error) {
      if (init.redirect !== 'manual' || !/redirect/i.test(error.message) || init.signal?.aborted) throw error;
      return redirectProbe(net, url, init, error);
    }
  };
}
module.exports = { desktopFetch };

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

/**
 * @param {import('http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} error
 * @param {string} message
 */
function sendProxyError(res, statusCode, error, message) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error, message }));
}

/** @param {string | undefined} origin */
function isValidTargetOrigin(origin) {
  if (!origin?.trim()) return false;
  try {
    const u = new URL(origin.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** @param {string | undefined} reqUrl */
function parseIncomingUrl(reqUrl) {
  try {
    return new URL(reqUrl || '/', 'http://localhost');
  } catch {
    return null;
  }
}

/**
 * @param {string} origin
 * @param {string} pathname
 * @param {string} search
 */
function buildTargetUrl(origin, pathname, search) {
  try {
    return new URL(`${pathname}${search}`, origin);
  } catch {
    return null;
  }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ targetOrigin: string; stripPrefix: string; setProxyTargetHeader?: boolean }} route
 */
export function proxyHttpRequest(req, res, route) {
  const origin = route.targetOrigin?.trim();
  if (!isValidTargetOrigin(origin)) {
    sendProxyError(
      res,
      500,
      'misconfigured_proxy',
      `invalid targetOrigin: ${origin || '(empty)'}`
    );
    return;
  }

  const incoming = parseIncomingUrl(req.url);
  if (!incoming) {
    sendProxyError(res, 400, 'bad_request', `invalid request url: ${req.url || '(empty)'}`);
    return;
  }

  let pathname = incoming.pathname;
  if (route.stripPrefix && pathname.startsWith(route.stripPrefix)) {
    pathname = pathname.slice(route.stripPrefix.length) || '/';
  }

  const target = buildTargetUrl(origin, pathname, incoming.search);
  if (!target) {
    sendProxyError(
      res,
      502,
      'bad_gateway',
      `could not resolve upstream URL (origin=${origin}, path=${pathname})`
    );
    return;
  }

  const isHttps = target.protocol === 'https:';
  const lib = isHttps ? https : http;

  const headers = { ...req.headers };
  if (route.setProxyTargetHeader) {
    // Express app.use(mount) 已剥掉 mount 前缀，须用改写后的 path，不能对 req.url 再 slice stripPrefix
    const raw = pathname + incoming.search;
    if (raw && raw !== '/') {
      headers['x-proxy-target'] = raw.startsWith('/') ? raw : `/${raw}`;
    }
  }
  headers.host = target.host;

  const proxyReq = lib.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendProxyError(res, 502, 'bad_gateway', err.message);
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq);
}

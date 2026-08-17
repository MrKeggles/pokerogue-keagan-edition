/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const path = require("node:path");

const APP_SCHEME = "pokerogue";
const APP_HOST = "app";
const APP_URL = `${APP_SCHEME}://${APP_HOST}/`;
const API_PREFIX = "/api";
const API_BASE_URL = "https://api.pokerogue.net";
const API_ORIGIN = "https://pokerogue.net";
const API_REFERER = `${API_ORIGIN}/`;
const API_PROXY_TIMEOUT_MS = 20_000;
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["https:"]);
const ALLOWED_APP_PERMISSIONS = new Set(["notifications"]);
const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join("; ");

class ApiProxyTimeoutError extends Error {
  /** @param {number} timeoutMs */
  constructor(timeoutMs) {
    super(`The upstream API did not finish responding within ${timeoutMs} ms.`);
    this.name = "ApiProxyTimeoutError";
    this.code = "ETIMEDOUT";
  }
}

/**
 * @typedef {Omit<RequestInit, "headers"> & { headers: Headers, bypassCustomProtocolHandlers?: boolean }} ProxyRequestInit
 */

/** @param {URL} requestUrl */
function isAppUrl(requestUrl) {
  return requestUrl.protocol === `${APP_SCHEME}:` && requestUrl.hostname === APP_HOST;
}

/** @param {string} pathname */
function isApiPath(pathname) {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

/**
 * @param {string} distRoot
 * @param {string} pathname
 * @returns {string | null}
 */
function resolveAppPath(distRoot, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decodedPath.includes("\0")) {
    return null;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(distRoot, relativePath);
  const relativeToRoot = path.relative(distRoot, filePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  return filePath;
}

/**
 * @param {URL} requestUrl
 * @returns {URL}
 */
function createApiTarget(requestUrl) {
  const apiPath = requestUrl.pathname.slice(API_PREFIX.length) || "/";
  const target = new URL(API_BASE_URL);

  // Assigning pathname instead of resolving a relative URL prevents a path such
  // as "//other-host" from changing the configured API host.
  target.pathname = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  target.search = requestUrl.search;
  return target;
}

/**
 * @param {Pick<Request, "method" | "headers" | "arrayBuffer">} request
 * @param {AbortSignal} [signal]
 * @returns {Promise<ProxyRequestInit>}
 */
async function buildProxyRequestInit(request, signal) {
  const headers = new Headers(request.headers);

  // These values belong to the renderer's custom origin (or describe the old
  // request body) and must not be forwarded to the upstream API.
  for (const header of ["host", "content-length", "origin", "referer", "user-agent"]) {
    headers.delete(header);
  }
  for (const header of [...headers.keys()]) {
    if (header.startsWith("sec-fetch-") || header.startsWith("sec-ch-ua")) {
      headers.delete(header);
    }
  }

  headers.set("Origin", API_ORIGIN);
  headers.set("Referer", API_REFERER);
  headers.set("User-Agent", DESKTOP_USER_AGENT);

  /** @type {ProxyRequestInit} */
  const init = {
    method: request.method,
    headers,
    redirect: "follow",
    credentials: "omit",
    bypassCustomProtocolHandlers: true,
  };

  if (signal) {
    init.signal = signal;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  return init;
}

/**
 * Fetch an upstream API response and buffer it before returning it to the
 * custom protocol handler. Buffering is intentional: it keeps the same
 * deadline active while the upstream response body is being downloaded.
 *
 * @param {Pick<Request, "method" | "headers" | "arrayBuffer"> & { signal?: AbortSignal }} request
 * @param {URL} requestUrl
 * @param {(url: string, init: ProxyRequestInit) => Promise<Response>} fetchImpl
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchProxiedApiResponse(request, requestUrl, fetchImpl, timeoutMs = API_PROXY_TIMEOUT_MS) {
  const target = createApiTarget(requestUrl);
  const controller = new AbortController();
  const timeoutError = new ApiProxyTimeoutError(timeoutMs);
  let timeoutId;
  let removeCallerAbortListener = () => {};

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      // Reject first so a fetch implementation that synchronously reacts to
      // abort cannot replace the explicit timeout error with a generic one.
      reject(timeoutError);
      controller.abort(timeoutError);
    }, timeoutMs);
  });

  /** @type {Promise<never> | undefined} */
  let callerAbortPromise;
  const callerSignal = request.signal;
  if (callerSignal) {
    callerAbortPromise = new Promise((_, reject) => {
      const rejectForCallerAbort = () => {
        const reason = callerSignal.reason;
        const abortError = reason instanceof Error ? reason : new Error("The API request was aborted.");
        abortError.name = reason instanceof Error ? reason.name : "AbortError";
        reject(abortError);
        controller.abort(abortError);
      };

      if (callerSignal.aborted) {
        rejectForCallerAbort();
        return;
      }

      callerSignal.addEventListener("abort", rejectForCallerAbort, { once: true });
      removeCallerAbortListener = () => callerSignal.removeEventListener("abort", rejectForCallerAbort);
    });
  }

  const fetchAndBuffer = async () => {
    const init = await buildProxyRequestInit(request, controller.signal);
    const upstreamResponse = await fetchImpl(target.toString(), init);
    const responseHasBody = request.method !== "HEAD" && ![204, 205, 304].includes(upstreamResponse.status);
    const body = responseHasBody ? await upstreamResponse.arrayBuffer() : null;
    const responseHeaders = new Headers(upstreamResponse.headers);

    // Fetch exposes a decoded body. Forwarding transport headers from the
    // encoded upstream payload can make Chromium decode it again or trust a
    // stale byte length when the custom protocol response is reconstructed.
    responseHeaders.delete("Content-Encoding");
    responseHeaders.delete("Content-Length");
    responseHeaders.delete("Transfer-Encoding");

    return new Response(body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  };

  try {
    const pending = [fetchAndBuffer(), timeoutPromise];
    if (callerAbortPromise) {
      pending.push(callerAbortPromise);
    }
    return await Promise.race(pending);
  } finally {
    clearTimeout(timeoutId);
    removeCallerAbortListener();
  }
}

/**
 * Format a privacy-safe API proxy diagnostic. Only the HTTP method and path
 * are accepted; query strings, headers and bodies are intentionally omitted.
 *
 * @param {string} method
 * @param {string} pathname
 * @param {string | number} outcome
 * @param {number} durationMs
 */
function formatApiProxyLog(method, pathname, outcome, durationMs) {
  const safePath = pathname.split(/[?#]/, 1)[0] || "/";
  return `API proxy ${method.toUpperCase()} ${safePath} -> ${outcome} (${Math.max(0, Math.round(durationMs))} ms)`;
}

/**
 * @param {string} url
 * @returns {URL | null}
 */
function parseAllowedExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @param {string | undefined} devStartUrl
 * @param {boolean} isDev
 */
function isTrustedInAppNavigation(url, devStartUrl, isDev) {
  try {
    const parsed = new URL(url);
    if (isAppUrl(parsed)) {
      return true;
    }

    if (isDev && devStartUrl) {
      return parsed.origin === new URL(devStartUrl).origin;
    }
  } catch {
    // Invalid URLs are never trusted for in-app navigation.
  }

  return false;
}

/**
 * @param {string} permission
 * @param {string | undefined} requestingUrl
 * @param {string | undefined} devStartUrl
 * @param {boolean} isDev
 */
function isAllowedAppPermission(permission, requestingUrl, devStartUrl, isDev) {
  return (
    ALLOWED_APP_PERMISSIONS.has(permission)
    && requestingUrl != null
    && isTrustedInAppNavigation(requestingUrl, devStartUrl, isDev)
  );
}

module.exports = {
  ALLOWED_APP_PERMISSIONS,
  API_BASE_URL,
  API_ORIGIN,
  API_PREFIX,
  API_PROXY_TIMEOUT_MS,
  API_REFERER,
  ApiProxyTimeoutError,
  APP_HOST,
  APP_CONTENT_SECURITY_POLICY,
  APP_SCHEME,
  APP_URL,
  DESKTOP_USER_AGENT,
  buildProxyRequestInit,
  createApiTarget,
  fetchProxiedApiResponse,
  formatApiProxyLog,
  isApiPath,
  isAllowedAppPermission,
  isAppUrl,
  isTrustedInAppNavigation,
  parseAllowedExternalUrl,
  resolveAppPath,
};

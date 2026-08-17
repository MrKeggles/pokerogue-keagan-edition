/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const {
  API_BASE_URL,
  APP_CONTENT_SECURITY_POLICY,
  DESKTOP_USER_AGENT,
  ApiProxyTimeoutError,
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
} = require("./protocol-helpers.cjs");

async function runTests() {
  assert.equal(isAppUrl(new URL("pokerogue://app/")), true);
  assert.equal(isAppUrl(new URL("pokerogue://other/")), false);
  assert.equal(isAppUrl(new URL("https://app/")), false);
  assert.equal(isApiPath("/api"), true);
  assert.equal(isApiPath("/api/account/login"), true);
  assert.equal(isApiPath("/api-elsewhere"), false);

  const distRoot = path.resolve("C:/example/dist");
  assert.equal(resolveAppPath(distRoot, "/"), path.join(distRoot, "index.html"));
  assert.equal(resolveAppPath(distRoot, "/assets/app.js"), path.join(distRoot, "assets", "app.js"));
  assert.equal(resolveAppPath(distRoot, "/%2e%2e/package.json"), null);
  assert.equal(resolveAppPath(distRoot, "/%2F..%2Fpackage.json"), null);
  assert.equal(resolveAppPath(distRoot, "/%00.js"), null);
  assert.equal(resolveAppPath(distRoot, "/%E0%A4%A"), null);

  const target = createApiTarget(new URL("pokerogue://app/api//evil.example/account?slot=1"));
  assert.equal(target.origin, API_BASE_URL);
  assert.equal(target.pathname, "//evil.example/account");
  assert.equal(target.search, "?slot=1");

  const body = new TextEncoder().encode("username=keagan&password=test");
  const request = {
    method: "POST",
    headers: new Headers({
      Authorization: "session-token",
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": "999",
      Origin: "pokerogue://app",
      Referer: "pokerogue://app/",
      "Sec-CH-UA": "Electron",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": "Electron",
    }),
    arrayBuffer: async () => body.buffer,
  };

  const init = await buildProxyRequestInit(request);
  assert.equal(init.method, "POST");
  assert.ok(init.body instanceof ArrayBuffer);
  assert.equal(new TextDecoder().decode(init.body), "username=keagan&password=test");
  assert.equal(init.headers.get("Authorization"), "session-token");
  assert.equal(init.headers.get("Content-Type"), "application/x-www-form-urlencoded");
  assert.equal(init.headers.get("Content-Length"), null);
  assert.equal(init.headers.get("Sec-CH-UA"), null);
  assert.equal(init.headers.get("Sec-Fetch-Site"), null);
  assert.equal(init.headers.get("Origin"), "https://pokerogue.net");
  assert.equal(init.headers.get("Referer"), "https://pokerogue.net/");
  assert.equal(init.headers.get("User-Agent"), DESKTOP_USER_AGENT);
  assert.match(DESKTOP_USER_AGENT, /Chrome\/150\.0\.0\.0/);
  assert.equal(init.credentials, "omit");

  const bufferedResponse = await fetchProxiedApiResponse(
    { ...request, method: "GET" },
    new URL("pokerogue://app/api/game/titlestats?token=do-not-log"),
    async (_url, proxyInit) => {
      assert.equal(proxyInit.signal?.aborted, false);
      return new Response("buffered response", {
        status: 201,
        headers: {
          "Content-Encoding": "gzip",
          "Content-Length": "999",
          "Transfer-Encoding": "chunked",
          "X-Test": "yes",
        },
      });
    },
    100,
  );
  assert.equal(bufferedResponse.status, 201);
  assert.equal(bufferedResponse.headers.get("X-Test"), "yes");
  assert.equal(bufferedResponse.headers.get("Content-Encoding"), null);
  assert.equal(bufferedResponse.headers.get("Content-Length"), null);
  assert.equal(bufferedResponse.headers.get("Transfer-Encoding"), null);
  assert.equal(await bufferedResponse.text(), "buffered response");

  /** @type {{ signal: AbortSignal | null | undefined }} */
  const pendingFetch = { signal: undefined };
  await assert.rejects(
    fetchProxiedApiResponse(
      { ...request, method: "GET" },
      new URL("pokerogue://app/api/savedata/system/verify?clientSessionId=secret"),
      (_url, proxyInit) => {
        pendingFetch.signal = proxyInit.signal;
        return new Promise(() => {});
      },
      5,
    ),
    ApiProxyTimeoutError,
  );
  assert.ok(pendingFetch.signal);
  assert.equal(pendingFetch.signal.aborted, true);

  /** @type {{ signal: AbortSignal | null | undefined }} */
  const pendingBody = { signal: undefined };
  await assert.rejects(
    fetchProxiedApiResponse(
      { ...request, method: "GET" },
      new URL("pokerogue://app/api/savedata/session/get?slot=1&clientSessionId=secret"),
      (_url, proxyInit) => {
        pendingBody.signal = proxyInit.signal;
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start() {
                // Deliberately never close: this models an upstream response
                // that sent headers and then stalled while sending its body.
              },
            }),
            { status: 200 },
          ),
        );
      },
      5,
    ),
    ApiProxyTimeoutError,
  );
  assert.ok(pendingBody.signal);
  assert.equal(pendingBody.signal.aborted, true);

  const callerAbortController = new AbortController();
  const abortedRequest = fetchProxiedApiResponse(
    { ...request, method: "GET", signal: callerAbortController.signal },
    new URL("pokerogue://app/api/account/info"),
    () => new Promise(() => {}),
    100,
  );
  callerAbortController.abort();
  await assert.rejects(abortedRequest, err => err instanceof Error && err.name === "AbortError");

  const safeLog = formatApiProxyLog("post", "/savedata/updateall?clientSessionId=secret", 504, 19.6);
  assert.equal(safeLog, "API proxy POST /savedata/updateall -> 504 (20 ms)");
  assert.doesNotMatch(safeLog, /secret|clientSessionId|\?/);

  assert.equal(parseAllowedExternalUrl("https://wiki.pokerogue.net/")?.protocol, "https:");
  assert.equal(parseAllowedExternalUrl("http://wiki.pokerogue.net/"), null);
  assert.equal(parseAllowedExternalUrl("javascript:alert(1)"), null);
  assert.equal(parseAllowedExternalUrl("file:///C:/Windows/System32/calc.exe"), null);

  assert.equal(isTrustedInAppNavigation("pokerogue://app/", undefined, false), true);
  assert.equal(isTrustedInAppNavigation("pokerogue://other/", undefined, false), false);
  assert.equal(isTrustedInAppNavigation("https://example.com/", undefined, false), false);
  assert.equal(isTrustedInAppNavigation("http://localhost:8000/play", "http://localhost:8000", true), true);
  assert.equal(isTrustedInAppNavigation("http://localhost:9000/play", "http://localhost:8000", true), false);

  assert.equal(isAllowedAppPermission("notifications", "pokerogue://app/", undefined, false), true);
  assert.equal(isAllowedAppPermission("media", "pokerogue://app/", undefined, false), false);
  assert.equal(isAllowedAppPermission("notifications", "https://attacker.example/", undefined, false), false);
  assert.equal(isAllowedAppPermission("notifications", "http://localhost:8000/", "http://localhost:8000", true), true);
  assert.match(APP_CONTENT_SECURITY_POLICY, /script-src 'self'/);
  assert.doesNotMatch(APP_CONTENT_SECURITY_POLICY, /unsafe-eval|script-src[^;]*unsafe-inline/);

  console.log("Electron protocol helper checks passed.");
}

runTests().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

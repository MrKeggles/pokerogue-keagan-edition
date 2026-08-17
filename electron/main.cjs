/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const { app, BrowserWindow, dialog, net, protocol, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  APP_SCHEME,
  APP_CONTENT_SECURITY_POLICY,
  APP_URL,
  ApiProxyTimeoutError,
  DESKTOP_USER_AGENT,
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
const { startAutoUpdates } = require("./updater.cjs");

const PRODUCT_NAME = "PokéRogue Keagan Edition";
const APP_ID = "net.pokerogue.keagan";
const STARTUP_LOG = path.join(os.tmpdir(), "PokeRogue-Keagan-Startup.log");
const IS_DEV = !app.isPackaged;
const IS_SMOKE_TEST = process.env.POKEROGUE_DESKTOP_SMOKE === "1";
const SMOKE_PROFILE_PREFIX = "pokerogue-keagan-smoke-";
const SMOKE_GAME_BOOT_TIMEOUT_MS = 45_000;
const REQUESTED_SMOKE_USER_DATA_PATH = process.env.POKEROGUE_DESKTOP_SMOKE_USER_DATA;
const IS_SMOKE_PROFILE_MANAGED_EXTERNALLY = IS_SMOKE_TEST && Boolean(REQUESTED_SMOKE_USER_DATA_PATH);
const SMOKE_USER_DATA_PATH = IS_SMOKE_TEST
  ? REQUESTED_SMOKE_USER_DATA_PATH
    ? path.resolve(REQUESTED_SMOKE_USER_DATA_PATH)
    : fs.mkdtempSync(path.join(os.tmpdir(), SMOKE_PROFILE_PREFIX))
  : null;

if (SMOKE_USER_DATA_PATH) {
  if (!isExpectedSmokeProfilePath(SMOKE_USER_DATA_PATH)) {
    throw new Error(`Invalid isolated smoke profile path: ${SMOKE_USER_DATA_PATH}`);
  }

  fs.mkdirSync(SMOKE_USER_DATA_PATH, { recursive: true });
  // Never let smoke automation read settings, saves or login state from the
  // user's real Electron profile.
  app.setPath("userData", SMOKE_USER_DATA_PATH);
}

// A standard, secure scheme gives the packaged app a stable web origin. That is
// required for relative assets, Fetch, localStorage and IndexedDB persistence.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

app.setName(PRODUCT_NAME);
app.userAgentFallback = DESKTOP_USER_AGENT;

/** @param {string} message */
function logStartup(message) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(STARTUP_LOG, `[${timestamp}] ${message}\n`, "utf8");
  } catch {
    // Logging must never stop the application from starting.
  }
}

/**
 * @param {number} status
 * @param {string} message
 */
function errorResponse(status, message) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function getDistRoot() {
  return path.resolve(__dirname, "..", "dist");
}

/**
 * @param {Response} response
 * @param {string} method
 */
function addAppDocumentSecurityHeaders(response, method) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", APP_CONTENT_SECURITY_POLICY);
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function configureSessionPermissions() {
  const defaultSession = session.defaultSession;
  const devStartUrl = process.env.ELECTRON_START_URL;

  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(isAllowedAppPermission(permission, requestingUrl, devStartUrl, IS_DEV));
  });

  defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const requestingUrl = details.requestingUrl || requestingOrigin || webContents?.getURL();
    return isAllowedAppPermission(permission, requestingUrl, devStartUrl, IS_DEV);
  });
}

/** @param {unknown} err */
function formatError(err) {
  return err instanceof Error ? err.stack || err.message : String(err);
}

/** @param {string} filePath */
function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** @param {string} profilePath */
function isExpectedSmokeProfilePath(profilePath) {
  const tempRoot = path.resolve(os.tmpdir());
  const profileRoot = path.resolve(profilePath);
  return path.dirname(profileRoot) === tempRoot && path.basename(profileRoot).startsWith(SMOKE_PROFILE_PREFIX);
}

function cleanupSmokeProfile() {
  if (!SMOKE_USER_DATA_PATH || IS_SMOKE_PROFILE_MANAGED_EXTERNALLY) {
    return;
  }

  const profileRoot = path.resolve(SMOKE_USER_DATA_PATH);
  if (!isExpectedSmokeProfilePath(profileRoot)) {
    logStartup(`Refused to clean unexpected smoke profile: ${profileRoot}`);
    return;
  }

  try {
    fs.rmSync(profileRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) {
    logStartup(`Smoke profile cleanup error: ${formatError(err)}`);
  }
}

/**
 * @param {Request} request
 * @param {URL} requestUrl
 */
async function proxyApiRequest(request, requestUrl) {
  const target = createApiTarget(requestUrl);
  const startedAt = Date.now();

  try {
    const response = await fetchProxiedApiResponse(request, requestUrl, net.fetch);
    logStartup(formatApiProxyLog(request.method, target.pathname, response.status, Date.now() - startedAt));
    return response;
  } catch (err) {
    const outcome =
      err instanceof ApiProxyTimeoutError
        ? "timeout"
        : err instanceof Error && err.name === "AbortError"
          ? "aborted"
          : "failed";
    logStartup(formatApiProxyLog(request.method, target.pathname, outcome, Date.now() - startedAt));
    throw err;
  }
}

/** @param {Request} request */
async function handleAppRequest(request) {
  let requestUrl;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return errorResponse(400, "Invalid URL");
  }

  if (!isAppUrl(requestUrl)) {
    return errorResponse(404, "Not Found");
  }

  if (isApiPath(requestUrl.pathname)) {
    try {
      return await proxyApiRequest(request, requestUrl);
    } catch (err) {
      if (err instanceof ApiProxyTimeoutError) {
        return errorResponse(504, "NET04: The PokeRogue API request timed out.");
      }
      return errorResponse(502, "NET01: The PokeRogue API could not be reached.");
    }
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(405, "Method Not Allowed");
  }

  const filePath = resolveAppPath(getDistRoot(), requestUrl.pathname);
  if (!filePath || !isFile(filePath)) {
    return errorResponse(404, "Not Found");
  }

  try {
    const response = await net.fetch(pathToFileURL(filePath).toString(), {
      method: request.method,
      bypassCustomProtocolHandlers: true,
    });
    return path.extname(filePath).toLowerCase() === ".html"
      ? addAppDocumentSecurityHeaders(response, request.method)
      : response;
  } catch (err) {
    logStartup(`App asset error: ${formatError(err)}`);
    return errorResponse(500, "The application asset could not be loaded.");
  }
}

/** @param {string} url */
async function openExternalUrl(url) {
  const parsed = parseAllowedExternalUrl(url);
  if (!parsed) {
    logStartup(`Blocked external URL: ${url}`);
    return;
  }

  try {
    await shell.openExternal(parsed.toString());
  } catch (err) {
    logStartup(`External URL error: ${formatError(err)}`);
  }
}

async function createWindow() {
  logStartup("Creating browser window");
  const mainWindow = new BrowserWindow({
    show: false,
    title: PRODUCT_NAME,
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 576,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      devTools: IS_DEV,
    },
  });
  mainWindow.webContents.setUserAgent(DESKTOP_USER_AGENT);

  mainWindow.webContents.on("console-message", details => {
    if (details.level === "error") {
      logStartup(
        `Renderer console error: ${details.message.slice(0, 2_000)} (${details.sourceId}:${details.lineNumber})`,
      );
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (isMainFrame) {
      logStartup(`Renderer load error ${errorCode}: ${errorDescription} (${validatedUrl})`);
    }
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logStartup(`Renderer process exited: ${details.reason} (exit code ${details.exitCode})`);
  });

  if (!IS_SMOKE_TEST) {
    mainWindow.once("ready-to-show", () => {
      mainWindow.show();
      mainWindow.focus();
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url).catch(err => logStartup(`External window error: ${formatError(err)}`));
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedInAppNavigation(url, process.env.ELECTRON_START_URL, IS_DEV)) {
      return;
    }

    event.preventDefault();
    openExternalUrl(url).catch(err => logStartup(`External navigation error: ${formatError(err)}`));
  });

  const startUrl =
    !IS_SMOKE_TEST && IS_DEV && process.env.ELECTRON_START_URL ? process.env.ELECTRON_START_URL : APP_URL;
  logStartup(`Loading URL: ${startUrl}`);

  try {
    await mainWindow.loadURL(startUrl);
  } catch (err) {
    logStartup(`Window load error: ${formatError(err)}`);
    mainWindow.show();
    throw err;
  }

  return mainWindow;
}

/** @param {BrowserWindow} mainWindow */
async function waitForGameCanvas(mainWindow) {
  const canvasState = await mainWindow.webContents.executeJavaScript(
    `new Promise((resolve, reject) => {
      const deadline = Date.now() + ${SMOKE_GAME_BOOT_TIMEOUT_MS};
      const poll = () => {
        const canvas = document.querySelector("#app canvas");
        if (canvas) {
          resolve({ width: canvas.width, height: canvas.height });
          return;
        }

        if (Date.now() >= deadline) {
          reject(new Error(
            "The Phaser canvas did not start within ${SMOKE_GAME_BOOT_TIMEOUT_MS / 1_000} seconds " +
              "(document state: " + document.readyState + ", app children: " +
              (document.querySelector("#app")?.childElementCount ?? "missing") + ")",
          ));
          return;
        }

        setTimeout(poll, 100);
      };

      poll();
    })`,
    true,
  );

  if (
    !canvasState
    || typeof canvasState.width !== "number"
    || typeof canvasState.height !== "number"
    || canvasState.width <= 0
    || canvasState.height <= 0
  ) {
    throw new Error("The desktop renderer created an invalid Phaser canvas");
  }
}

async function runSmokeTest() {
  const mainWindow = await createWindow();
  const storageKey = "pokerogue.desktop.smoke-test";
  const storageValue = `smoke-${Date.now()}`;
  const serializedStorageKey = JSON.stringify(storageKey);
  const serializedStorageValue = JSON.stringify(storageValue);

  try {
    await mainWindow.webContents.executeJavaScript(
      `localStorage.setItem(${serializedStorageKey}, ${serializedStorageValue})`,
      true,
    );
    await mainWindow.loadURL(APP_URL);

    const persistedValue = await mainWindow.webContents.executeJavaScript(
      `localStorage.getItem(${serializedStorageKey})`,
      true,
    );
    if (persistedValue !== storageValue) {
      throw new Error("localStorage did not persist after reloading the stable desktop origin");
    }

    await mainWindow.webContents.executeJavaScript(`localStorage.removeItem(${serializedStorageKey})`, true);
    const documentTitle = await mainWindow.webContents.executeJavaScript("document.title", true);
    if (documentTitle !== PRODUCT_NAME) {
      throw new Error(`Unexpected document title: ${String(documentTitle)}`);
    }

    await waitForGameCanvas(mainWindow);

    const documentResponse = await net.fetch(APP_URL, { bypassCustomProtocolHandlers: false });
    const contentSecurityPolicy = documentResponse.headers.get("Content-Security-Policy");
    await documentResponse.body?.cancel();
    if (contentSecurityPolicy !== APP_CONTENT_SECURITY_POLICY) {
      throw new Error("The desktop document did not receive the expected Content Security Policy");
    }

    // Exercise the same renderer Fetch path used by account and save requests,
    // rather than calling the protocol handler only from Electron's main process.
    const apiResponse = await mainWindow.webContents.executeJavaScript(
      `(async () => {
        const response = await fetch(${JSON.stringify(`${APP_URL}api/game/titlestats`)}, { credentials: "omit" });
        return { ok: response.ok, status: response.status, text: await response.text() };
      })()`,
      true,
    );
    const responseText = apiResponse.text;

    if (!apiResponse.ok) {
      throw new Error(`API smoke request failed with HTTP ${apiResponse.status}: ${responseText.slice(0, 200)}`);
    }

    const titleStats = JSON.parse(responseText);
    if (!titleStats || typeof titleStats !== "object") {
      throw new Error("API smoke request did not return a JSON object");
    }

    const message = `Desktop smoke test passed (${APP_URL}, Phaser canvas, persistent localStorage, CSP, branded title, renderer API HTTP ${apiResponse.status})`;
    logStartup(message);
    console.log(message);
  } finally {
    if (!mainWindow.isDestroyed()) {
      try {
        await mainWindow.webContents.executeJavaScript(`localStorage.removeItem(${serializedStorageKey})`, true);
      } catch {
        // Best-effort cleanup if navigation failed during the smoke test.
      }
    }
    mainWindow.destroy();
  }
}

process.on("uncaughtException", err => {
  logStartup(`Uncaught exception: ${err?.stack || err}`);
});

process.on("unhandledRejection", reason => {
  logStartup(`Unhandled rejection: ${reason}`);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    logStartup("App ready");
    app.setAppUserModelId(APP_ID);
    configureSessionPermissions();
    protocol.handle(APP_SCHEME, handleAppRequest);

    if (IS_SMOKE_TEST) {
      try {
        await runSmokeTest();
        app.exit(0);
      } catch (err) {
        logStartup(`Desktop smoke test failed: ${formatError(err)}`);
        console.error(`Desktop smoke test failed: ${formatError(err)}`);
        app.exit(1);
      }
      return;
    }

    try {
      const mainWindow = await createWindow();
      try {
        startAutoUpdates({
          app,
          autoUpdater,
          dialog,
          mainWindow,
          isSmokeTest: IS_SMOKE_TEST,
          log: logStartup,
        });
      } catch (err) {
        logStartup(`Automatic updater could not start: ${formatError(err)}`);
      }
    } catch {
      // The detailed error has already been written to the startup log.
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().catch(err => logStartup(`Window activation error: ${formatError(err)}`));
      }
    });
  });
} else {
  if (IS_SMOKE_TEST) {
    console.error("Desktop smoke test could not start because the app is already running.");
    process.exitCode = 1;
  }
  app.quit();
}

app.on("window-all-closed", () => {
  logStartup("All windows closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("quit", cleanupSmokeProfile);

/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { getAutoUpdateSupportReason, startAutoUpdates } = require("./updater.cjs");

function supportedState(overrides = {}) {
  return {
    isPackaged: true,
    platform: "win32",
    isSmokeTest: false,
    isPortable: false,
    isDisabled: false,
    hasConfiguration: true,
    ...overrides,
  };
}

async function runTests() {
  assert.equal(getAutoUpdateSupportReason(supportedState()), null);
  assert.equal(getAutoUpdateSupportReason(supportedState({ isPackaged: false })), "development build");
  assert.equal(getAutoUpdateSupportReason(supportedState({ platform: "linux" })), "unsupported platform");
  assert.equal(getAutoUpdateSupportReason(supportedState({ isSmokeTest: true })), "desktop smoke test");
  assert.equal(getAutoUpdateSupportReason(supportedState({ isPortable: true })), "portable build");
  assert.equal(getAutoUpdateSupportReason(supportedState({ isDisabled: true })), "disabled by environment");
  assert.equal(
    getAutoUpdateSupportReason(supportedState({ hasConfiguration: false })),
    "no release repository configured when the installer was built",
  );

  /** @type {any} */
  const updater = new EventEmitter();
  let checkCount = 0;
  let downloadCount = 0;
  let installCount = 0;
  updater.checkForUpdates = async () => {
    checkCount++;
    return null;
  };
  updater.downloadUpdate = async () => {
    downloadCount++;
    return [];
  };
  updater.quitAndInstall = () => {
    installCount++;
  };

  const dialogResponses = [0, 0];
  /** @type {number[]} */
  const progressValues = [];
  /** @type {string[]} */
  const logs = [];
  const controller = startAutoUpdates({
    /** @type {any} */
    app: { isPackaged: true },
    autoUpdater: updater,
    /** @type {any} */
    dialog: {
      showMessageBox: async () => ({ response: dialogResponses.shift() ?? 1 }),
    },
    /** @type {any} */
    mainWindow: {
      isDestroyed: () => false,
      setProgressBar: (/** @type {number} */ value) => progressValues.push(value),
    },
    checkDelayMs: -1,
    supportState: supportedState(),
    log: message => logs.push(message),
  });

  await controller.checkNow();
  assert.equal(checkCount, 1);

  updater.emit("update-available", { version: "1.12.3" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(downloadCount, 1);

  updater.emit("download-progress", { percent: 42 });
  assert.equal(progressValues.at(-1), 0.42);

  updater.emit("update-downloaded", { version: "1.12.3" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(installCount, 1);
  assert.ok(logs.some(message => message.includes("Automatic updates enabled")));

  controller.dispose();
  assert.equal(updater.listenerCount("update-available"), 0);

  console.log("Electron updater checks passed.");
}

runTests().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

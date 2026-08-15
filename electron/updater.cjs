/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_UPDATE_CHECK_DELAY_MS = 15_000;

/**
 * @param {{
 *   isPackaged: boolean,
 *   platform: string,
 *   isSmokeTest: boolean,
 *   isPortable: boolean,
 *   isDisabled: boolean,
 *   hasConfiguration: boolean,
 * }} state
 */
function getAutoUpdateSupportReason(state) {
  if (!state.isPackaged) {
    return "development build";
  }
  if (state.platform !== "win32") {
    return "unsupported platform";
  }
  if (state.isSmokeTest) {
    return "desktop smoke test";
  }
  if (state.isPortable) {
    return "portable build";
  }
  if (state.isDisabled) {
    return "disabled by environment";
  }
  if (!state.hasConfiguration) {
    return "no release repository configured when the installer was built";
  }
  return null;
}

/**
 * @param {{
 *   app: import("electron").App,
 *   autoUpdater: import("electron-updater").AppUpdater,
 *   dialog: typeof import("electron").dialog,
 *   mainWindow: import("electron").BrowserWindow,
 *   isSmokeTest?: boolean,
 *   checkDelayMs?: number | null,
 *   supportState?: Parameters<typeof getAutoUpdateSupportReason>[0],
 *   log: (message: string) => void,
 * }} options
 */
function startAutoUpdates(options) {
  const supportState = options.supportState ?? {
    isPackaged: options.app.isPackaged,
    platform: process.platform,
    isSmokeTest: options.isSmokeTest === true,
    isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    isDisabled: process.env.POKEROGUE_DISABLE_UPDATES === "1",
    hasConfiguration: fs.existsSync(path.join(process.resourcesPath, "app-update.yml")),
  };
  const supportReason = getAutoUpdateSupportReason(supportState);

  if (supportReason) {
    options.log(`Automatic updates inactive: ${supportReason}`);
    return { checkNow: async () => null, dispose: () => {} };
  }

  const updater = options.autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;

  let disposed = false;
  let downloadStarted = false;
  let promptOpen = false;

  /** @param {import("electron-updater").UpdateInfo} info */
  const showUpdateAvailable = async info => {
    if (disposed || promptOpen || downloadStarted || options.mainWindow.isDestroyed()) {
      return;
    }

    promptOpen = true;
    try {
      const result = await options.dialog.showMessageBox(options.mainWindow, {
        type: "info",
        title: "Update available",
        message: `PokéRogue Keagan Edition ${info.version} is available.`,
        detail: "Download it now? You can keep playing while the installer downloads.",
        buttons: ["Download update", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response !== 0 || disposed) {
        options.log(`Update ${info.version} postponed by the user`);
        return;
      }

      downloadStarted = true;
      options.log(`Downloading update ${info.version}`);
      await updater.downloadUpdate();
    } catch (err) {
      downloadStarted = false;
      options.log(`Update download could not start: ${formatError(err)}`);
    } finally {
      promptOpen = false;
    }
  };

  /** @param {import("electron-updater").UpdateInfo} info */
  const showUpdateDownloaded = async info => {
    if (disposed || promptOpen || options.mainWindow.isDestroyed()) {
      return;
    }

    options.mainWindow.setProgressBar(-1);
    promptOpen = true;
    try {
      const result = await options.dialog.showMessageBox(options.mainWindow, {
        type: "info",
        title: "Update ready",
        message: `PokéRogue Keagan Edition ${info.version} is ready to install.`,
        detail: "Restart now to finish updating. Choosing Later installs it automatically when you close the game.",
        buttons: ["Restart and install", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response === 0 && !disposed) {
        options.log(`Restarting to install update ${info.version}`);
        updater.quitAndInstall(false, true);
      } else {
        options.log(`Update ${info.version} will install when the app closes`);
      }
    } catch (err) {
      options.log(`Update restart prompt failed: ${formatError(err)}`);
    } finally {
      promptOpen = false;
    }
  };

  const onCheckingForUpdate = () => options.log("Checking GitHub Releases for an update");
  /** @param {import("electron-updater").UpdateInfo} info */
  const onUpdateAvailable = info => {
    options.log(`Update available: ${info.version}`);
    showUpdateAvailable(info).catch(err => options.log(`Update prompt failed: ${formatError(err)}`));
  };
  /** @param {import("electron-updater").UpdateInfo} info */
  const onUpdateNotAvailable = info => options.log(`Application is current (${info.version})`);
  /** @param {{ percent: number }} progress */
  const onDownloadProgress = progress => {
    const normalizedProgress = Math.max(0, Math.min(1, Number(progress.percent) / 100));
    if (!options.mainWindow.isDestroyed()) {
      options.mainWindow.setProgressBar(normalizedProgress);
    }
  };
  /** @param {import("electron-updater").UpdateInfo} info */
  const onUpdateDownloaded = info => {
    options.log(`Update downloaded: ${info.version}`);
    showUpdateDownloaded(info).catch(err => options.log(`Update restart prompt failed: ${formatError(err)}`));
  };
  /** @param {unknown} err */
  const onError = err => {
    downloadStarted = false;
    if (!options.mainWindow.isDestroyed()) {
      options.mainWindow.setProgressBar(-1);
    }
    options.log(`Automatic update error: ${formatError(err)}`);
  };

  updater.on("checking-for-update", onCheckingForUpdate);
  updater.on("update-available", onUpdateAvailable);
  updater.on("update-not-available", onUpdateNotAvailable);
  updater.on("download-progress", onDownloadProgress);
  updater.on("update-downloaded", onUpdateDownloaded);
  updater.on("error", onError);

  const checkNow = async () => {
    if (disposed) {
      return null;
    }
    try {
      return await updater.checkForUpdates();
    } catch (err) {
      onError(err);
      return null;
    }
  };

  const checkDelayMs = options.checkDelayMs ?? DEFAULT_UPDATE_CHECK_DELAY_MS;
  const checkTimer = checkDelayMs >= 0 ? setTimeout(checkNow, checkDelayMs) : null;
  checkTimer?.unref();

  const dispose = () => {
    disposed = true;
    if (checkTimer) {
      clearTimeout(checkTimer);
    }
    updater.removeListener("checking-for-update", onCheckingForUpdate);
    updater.removeListener("update-available", onUpdateAvailable);
    updater.removeListener("update-not-available", onUpdateNotAvailable);
    updater.removeListener("download-progress", onDownloadProgress);
    updater.removeListener("update-downloaded", onUpdateDownloaded);
    updater.removeListener("error", onError);
  };

  options.log("Automatic updates enabled for this installed build");
  return { checkNow, dispose };
}

/** @param {unknown} err */
function formatError(err) {
  return err instanceof Error ? err.stack || err.message : String(err);
}

module.exports = {
  DEFAULT_UPDATE_CHECK_DELAY_MS,
  getAutoUpdateSupportReason,
  startAutoUpdates,
};

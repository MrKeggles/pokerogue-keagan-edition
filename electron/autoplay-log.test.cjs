/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  AUTOPLAY_LOG_FILENAME,
  AUTOPLAY_LOG_MAX_BYTES,
  AUTOPLAY_LOG_MESSAGE_MAX_BYTES,
  appendAutoplayLog,
  formatAutoplayLogEntry,
  shouldPersistRendererLog,
} = require("./autoplay-log.cjs");

function runTests() {
  assert.equal(AUTOPLAY_LOG_FILENAME, "Autoplay.log");
  assert.equal(AUTOPLAY_LOG_MAX_BYTES, 1024 * 1024);
  assert.equal(AUTOPLAY_LOG_MESSAGE_MAX_BYTES, 4 * 1024);

  assert.equal(shouldPersistRendererLog({ message: "[Autoplay] battle stalled" }), true);
  assert.equal(shouldPersistRendererLog({ message: "[Battle recovery] move animation timed out" }), true);
  assert.equal(shouldPersistRendererLog({ message: "ordinary renderer warning" }), false);
  assert.equal(shouldPersistRendererLog({ message: 42 }), false);
  assert.equal(shouldPersistRendererLog(null), false);

  const now = new Date("2026-08-21T05:06:07.890Z");
  const formatted = formatAutoplayLogEntry(
    {
      level: "warning",
      message: "[Autoplay] first line\r\nsecond line\rthird line\nfourth line\0end",
      sourceId: "pokerogue://app/assets/index-abc.js?session=secret",
      lineNumber: 321,
    },
    now,
  );
  assert.equal(
    formatted,
    "[2026-08-21T05:06:07.890Z] [WARNING] [index-abc.js:321] [Autoplay] first line\\nsecond line\\nthird line\\nfourth line\\0end",
  );
  assert.equal(formatted.includes("secret"), false);
  assert.equal(/[\r\n\0]/.test(formatted), false);

  const unicodeMessage = `[Autoplay] ${"🎮".repeat(2_000)}`;
  const truncated = formatAutoplayLogEntry({ level: "error", message: unicodeMessage }, now);
  const loggedMessage = truncated.slice(truncated.indexOf("] ", truncated.indexOf("[renderer]")) + 2);
  assert.ok(Buffer.byteLength(loggedMessage, "utf8") <= AUTOPLAY_LOG_MESSAGE_MAX_BYTES);
  assert.match(loggedMessage, /\.\.\. \[truncated\]$/);
  assert.equal(loggedMessage.includes("�"), false);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pokerogue-autoplay-log-test-"));
  try {
    const logPath = path.join(tempRoot, "nested", AUTOPLAY_LOG_FILENAME);
    assert.equal(appendAutoplayLog(logPath, formatted), true);
    assert.equal(fs.readFileSync(logPath, "utf8"), `${formatted}\n`);

    const smallLimit = Buffer.byteLength(`${formatted}\n`, "utf8") + 8;
    assert.equal(appendAutoplayLog(logPath, "next entry", smallLimit), true);
    assert.equal(fs.readFileSync(`${logPath}.1`, "utf8"), `${formatted}\n`);
    assert.equal(fs.readFileSync(logPath, "utf8"), "next entry\n");

    assert.equal(appendAutoplayLog(logPath, "replacement backup entry", smallLimit), true);
    assert.equal(appendAutoplayLog(logPath, "forces another rotation", 32), true);
    assert.equal(fs.existsSync(`${logPath}.2`), false);
    assert.equal(fs.statSync(logPath).size <= 32, true);
    assert.match(fs.readFileSync(`${logPath}.1`, "utf8"), /replacement backup entry/);

    assert.equal(appendAutoplayLog(logPath, "raw\r\nmultiline", 128), true);
    assert.match(fs.readFileSync(logPath, "utf8"), /raw\\nmultiline\n$/);

    assert.equal(appendAutoplayLog("", "message"), false);
    assert.equal(appendAutoplayLog(logPath, /** @type {any} */ (null)), false);

    const directoryAsLog = path.join(tempRoot, "not-a-file");
    fs.mkdirSync(directoryAsLog);
    assert.doesNotThrow(() => appendAutoplayLog(directoryAsLog, "[Autoplay] cannot append"));
    assert.equal(appendAutoplayLog(directoryAsLog, "[Autoplay] cannot append"), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log("Electron autoplay log checks passed.");
}

runTests();

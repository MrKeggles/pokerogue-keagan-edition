/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const fs = require("node:fs");
const path = require("node:path");

const AUTOPLAY_LOG_FILENAME = "Autoplay.log";
const AUTOPLAY_LOG_MAX_BYTES = 1024 * 1024;
const AUTOPLAY_LOG_MESSAGE_MAX_BYTES = 4 * 1024;
const AUTOPLAY_LOG_SOURCE_MAX_BYTES = 512;
const AUTOPLAY_LOG_PREFIXES = ["[Autoplay]", "[Battle recovery]"];

/**
 * Truncates text without splitting a multi-byte UTF-8 character.
 *
 * @param {string} value
 * @param {number} maxBytes
 */
function truncateUtf8(value, maxBytes) {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }

  const suffix = "... [truncated]";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const contentLimit = Math.max(0, maxBytes - suffixBytes);
  let result = "";
  let resultBytes = 0;

  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (resultBytes + characterBytes > contentLimit) {
      break;
    }
    result += character;
    resultBytes += characterBytes;
  }

  if (suffixBytes > maxBytes) {
    return result;
  }
  return result + suffix;
}

/** @param {string} value */
function sanitizeSingleLine(value) {
  return value.replace(/\r\n|\r|\n/g, "\\n").replaceAll("\0", "\\0");
}

/** @param {unknown} level */
function normalizeSeverity(level) {
  switch (level) {
    case "debug":
    case "info":
    case "warning":
    case "error":
      return level.toUpperCase();
    default:
      return "INFO";
  }
}

/** @param {unknown} sourceId */
function getSourceName(sourceId) {
  if (typeof sourceId !== "string" || sourceId.length === 0) {
    return "renderer";
  }

  const withoutQuery = sourceId.split(/[?#]/, 1)[0].replace(/[\\/]+$/, "");
  const segments = withoutQuery.split(/[\\/]/);
  const sourceName = segments.at(-1) || "renderer";
  return truncateUtf8(sanitizeSingleLine(sourceName), AUTOPLAY_LOG_SOURCE_MAX_BYTES);
}

/**
 * @param {unknown} details
 * @returns {boolean}
 */
function shouldPersistRendererLog(details) {
  if (!details || typeof details !== "object" || !("message" in details)) {
    return false;
  }

  const { message } = details;
  return typeof message === "string" && AUTOPLAY_LOG_PREFIXES.some(prefix => message.startsWith(prefix));
}

/**
 * @param {{ message?: unknown, level?: unknown, sourceId?: unknown, lineNumber?: unknown }} details
 * @param {Date} [now]
 * @returns {string}
 */
function formatAutoplayLogEntry(details, now = new Date()) {
  const safeNow = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const rawMessage = typeof details?.message === "string" ? details.message : String(details?.message ?? "");
  const message = truncateUtf8(sanitizeSingleLine(rawMessage), AUTOPLAY_LOG_MESSAGE_MAX_BYTES);
  const sourceName = getSourceName(details?.sourceId);
  const lineNumber =
    typeof details?.lineNumber === "number" && Number.isSafeInteger(details.lineNumber) && details.lineNumber > 0
      ? `:${details.lineNumber}`
      : "";

  return `[${safeNow.toISOString()}] [${normalizeSeverity(details?.level)}] [${sourceName}${lineNumber}] ${message}`;
}

/**
 * Appends one entry to a bounded log, rotating the previous file to `<logPath>.1` when needed.
 * Logging is best-effort and never throws into application code.
 *
 * @param {string} logPath
 * @param {string} line
 * @param {number} [maxBytes]
 * @returns {boolean} Whether the entry was written.
 */
function appendAutoplayLog(logPath, line, maxBytes = AUTOPLAY_LOG_MAX_BYTES) {
  try {
    if (typeof logPath !== "string" || logPath.length === 0 || typeof line !== "string") {
      return false;
    }

    const byteLimit = Number.isSafeInteger(maxBytes) && maxBytes > 1 ? maxBytes : AUTOPLAY_LOG_MAX_BYTES;
    const singleLine = sanitizeSingleLine(line);
    const boundedLine = truncateUtf8(singleLine, byteLimit - 1);
    const entry = `${boundedLine}\n`;
    const entryBytes = Buffer.byteLength(entry, "utf8");
    const backupPath = `${logPath}.1`;

    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    let currentBytes = 0;
    try {
      const stats = fs.statSync(logPath);
      if (stats.isFile()) {
        currentBytes = stats.size;
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        return false;
      }
    }

    if (currentBytes > 0 && currentBytes + entryBytes > byteLimit) {
      fs.rmSync(backupPath, { force: true });
      fs.renameSync(logPath, backupPath);
    }

    fs.appendFileSync(logPath, entry, "utf8");
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  AUTOPLAY_LOG_FILENAME,
  AUTOPLAY_LOG_MAX_BYTES,
  AUTOPLAY_LOG_MESSAGE_MAX_BYTES,
  appendAutoplayLog,
  formatAutoplayLogEntry,
  shouldPersistRendererLog,
};

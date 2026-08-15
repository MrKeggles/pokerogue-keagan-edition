/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @typedef {{
 *   name: string,
 *   browser_download_url: string,
 *   size: number,
 *   download_count?: number,
 * }} ReleaseAsset
 */

/**
 * @typedef {{
 *   tag_name: string,
 *   name: string | null,
 *   body: string | null,
 *   html_url: string,
 *   published_at: string | null,
 *   assets: ReleaseAsset[],
 * }} GitHubRelease
 */

/**
 * @param {string} owner
 * @param {string} repository
 */
export function getRepositoryUrls(owner, repository) {
  const normalizedOwner = owner.trim();
  const normalizedRepository = repository.trim();
  const validSegment = /^[A-Za-z0-9_.-]+$/;
  if (!validSegment.test(normalizedOwner) || !validSegment.test(normalizedRepository)) {
    return null;
  }

  const repositoryUrl = `https://github.com/${normalizedOwner}/${normalizedRepository}`;
  return {
    repositoryUrl,
    latestReleaseUrl: `${repositoryUrl}/releases/latest`,
    latestReleaseApiUrl: `https://api.github.com/repos/${normalizedOwner}/${normalizedRepository}/releases/latest`,
  };
}

/** @param {ReleaseAsset[]} assets */
export function selectReleaseAssets(assets) {
  return {
    installer: assets.find(asset => /-nsis\.exe$/i.test(asset.name)) ?? null,
    portable: assets.find(asset => /-portable\.exe$/i.test(asset.name)) ?? null,
    source: assets.find(asset => /-source\.zip$/i.test(asset.name)) ?? null,
  };
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "Unknown";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

/** @param {string} tag */
export function versionFromTag(tag) {
  return tag.trim().replace(/^v/i, "") || "Unknown";
}

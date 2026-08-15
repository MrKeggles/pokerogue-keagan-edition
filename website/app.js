/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { formatBytes, getRepositoryUrls, selectReleaseAssets, versionFromTag } from "./release-client.js";
import { siteConfig } from "./site-config.js";

/** @param {string} id */
function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Landing page element is missing: ${id}`);
  }
  return element;
}

/**
 * @param {HTMLAnchorElement} anchor
 * @param {string} href
 */
function setExternalLink(anchor, href) {
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.removeAttribute("aria-disabled");
}

/** @param {string | null} dateValue */
function formatReleaseDate(dateValue) {
  if (!dateValue) {
    return "Unknown";
  }
  const date = new Date(dateValue);
  if (Number.isNaN(date.valueOf())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Render a deliberately small, text-only Markdown subset. GitHub release text
 * is never inserted as HTML, so release notes cannot inject page content.
 * @param {HTMLElement} container
 * @param {string} markdown
 */
function renderReleaseNotes(container, markdown) {
  const fragment = document.createDocumentFragment();
  let list = null;
  let insideComment = false;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("<!--")) {
      insideComment = true;
    }
    if (insideComment) {
      if (line.endsWith("-->")) {
        insideComment = false;
      }
      continue;
    }
    if (!line) {
      list = null;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      list = null;
      const level = Math.min(4, Math.max(3, heading[1].length + 1));
      const element = document.createElement(`h${level}`);
      element.textContent = heading[2];
      fragment.append(element);
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!list) {
        list = document.createElement("ul");
        fragment.append(list);
      }
      const item = document.createElement("li");
      item.textContent = bullet[1].replaceAll("**", "");
      list.append(item);
      continue;
    }

    list = null;
    const paragraph = document.createElement("p");
    paragraph.textContent = line.replaceAll("**", "");
    fragment.append(paragraph);
  }

  if (fragment.childNodes.length > 0) {
    container.replaceChildren(fragment);
  }
}

const heroDownload = /** @type {HTMLAnchorElement} */ (requireElement("hero-download"));
const installerDownload = /** @type {HTMLAnchorElement} */ (requireElement("installer-download"));
const releasePageLink = /** @type {HTMLAnchorElement} */ (requireElement("release-page-link"));
const allReleasesLink = /** @type {HTMLAnchorElement} */ (requireElement("all-releases-link"));
const headerReleaseLink = /** @type {HTMLAnchorElement} */ (requireElement("header-release-link"));
const sourceDownload = /** @type {HTMLAnchorElement} */ (requireElement("source-download"));
const portableDownload = /** @type {HTMLAnchorElement} */ (requireElement("portable-download"));
const releaseNotes = requireElement("release-notes");

function showRepositorySetup() {
  requireElement("release-status").textContent = "Repository setup needed";
  requireElement("download-size").textContent = "Available after setup";
  requireElement("download-date").textContent = "Available after setup";
  requireElement("download-help").textContent =
    "Add your public GitHub owner and repository to website/site-config.js to activate downloads.";
  requireElement("setup-message").textContent =
    "The page is built and ready. Add the public GitHub username and release repository in website/site-config.js; no token or secret is required.";
  installerDownload.setAttribute("aria-disabled", "true");
}

async function loadLatestRelease() {
  const urls = getRepositoryUrls(siteConfig.githubOwner, siteConfig.githubRepository);
  if (!urls) {
    showRepositorySetup();
    return;
  }

  for (const anchor of [releasePageLink, allReleasesLink, headerReleaseLink]) {
    setExternalLink(anchor, urls.latestReleaseUrl);
  }
  requireElement("setup-message").textContent =
    "Downloads and patch notes are connected to the public GitHub Release feed. Publishing a new stable release updates this page automatically.";

  try {
    const response = await fetch(urls.latestReleaseApiUrl, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      throw new Error(`GitHub Releases returned HTTP ${response.status}`);
    }

    /** @type {import("./release-client.js").GitHubRelease} */
    const release = await response.json();
    const version = versionFromTag(release.tag_name);
    const assets = selectReleaseAssets(release.assets ?? []);
    const publishedDate = formatReleaseDate(release.published_at);

    requireElement("hero-version").textContent = `Version ${version}`;
    requireElement("download-version").textContent = version;
    requireElement("download-date").textContent = publishedDate;
    requireElement("notes-version").textContent = `VERSION ${version}`;
    requireElement("notes-date").textContent = publishedDate.toUpperCase();
    requireElement("release-status").textContent = "Latest release online";

    if (assets.installer) {
      setExternalLink(heroDownload, assets.installer.browser_download_url);
      setExternalLink(installerDownload, assets.installer.browser_download_url);
      requireElement("download-size").textContent = formatBytes(assets.installer.size);
      requireElement("download-help").textContent = `${assets.installer.name} · Hosted securely on GitHub Releases`;
    } else {
      setExternalLink(heroDownload, release.html_url);
      setExternalLink(installerDownload, release.html_url);
      requireElement("download-size").textContent = "See release";
      requireElement("download-help").textContent = "The release is online, but no NSIS installer asset was found.";
    }

    if (assets.source) {
      setExternalLink(sourceDownload, assets.source.browser_download_url);
      sourceDownload.hidden = false;
    }
    if (assets.portable) {
      setExternalLink(portableDownload, assets.portable.browser_download_url);
      portableDownload.hidden = false;
    }
    if (release.body?.trim()) {
      renderReleaseNotes(releaseNotes, release.body);
    }
  } catch (err) {
    setExternalLink(heroDownload, urls.latestReleaseUrl);
    setExternalLink(installerDownload, urls.latestReleaseUrl);
    requireElement("release-status").textContent = "Release check unavailable";
    requireElement("download-size").textContent = "See GitHub";
    requireElement("download-date").textContent = "See GitHub";
    requireElement("download-help").textContent =
      "The live release check could not load. The download button opens the latest GitHub Release instead.";
    console.warn("Could not load the latest Keagan Edition release", err);
  }
}

requireElement("download-version").textContent = siteConfig.fallbackVersion;
loadLatestRelease().catch(err => console.error("Landing page initialization failed", err));

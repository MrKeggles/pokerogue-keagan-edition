/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const assert = require("node:assert/strict");

async function runTests() {
  const { formatBytes, getRepositoryUrls, selectReleaseAssets, versionFromTag } = await import("./release-client.js");

  assert.equal(getRepositoryUrls("", "repo"), null);
  assert.equal(getRepositoryUrls("owner", "bad/repo"), null);
  assert.deepEqual(getRepositoryUrls("keagan", "pokerogue-keagan-edition"), {
    repositoryUrl: "https://github.com/keagan/pokerogue-keagan-edition",
    latestReleaseUrl: "https://github.com/keagan/pokerogue-keagan-edition/releases/latest",
    latestReleaseApiUrl: "https://api.github.com/repos/keagan/pokerogue-keagan-edition/releases/latest",
  });

  const assets = selectReleaseAssets([
    { name: "PokeRogue-Keagan-Edition-1.12.3-nsis.exe.blockmap", browser_download_url: "blockmap", size: 10 },
    { name: "PokeRogue-Keagan-Edition-1.12.3-source.zip", browser_download_url: "source", size: 20 },
    { name: "PokeRogue-Keagan-Edition-1.12.3-nsis.exe", browser_download_url: "installer", size: 30 },
  ]);
  assert.equal(assets.installer?.browser_download_url, "installer");
  assert.equal(assets.source?.browser_download_url, "source");
  assert.equal(assets.portable, null);

  assert.equal(formatBytes(609_138_892), "581 MB");
  assert.equal(formatBytes(-1), "Unknown");
  assert.equal(versionFromTag("v1.12.3"), "1.12.3");

  console.log("Landing page release client checks passed.");
}

runTests().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

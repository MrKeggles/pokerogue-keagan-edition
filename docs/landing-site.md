<!--
SPDX-FileCopyrightText: 2026 Pagefault Games
SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# PokéRogue Keagan Edition Landing Site

The `website/` directory is a standalone static landing page designed for Synology Web Station. It has no server-side code, database, access token, or cookies.

The page reads the latest public GitHub Release and automatically displays:

- The latest version and publication date
- The direct NSIS installer link and file size
- Optional portable and corresponding-source links when those assets exist
- The GitHub Release patch notes

If the GitHub API is temporarily unavailable, the download button falls back to the repository's `/releases/latest` page.

## Connect the Release Repository

Edit `website/site-config.js`:

```js
export const siteConfig = Object.freeze({
  githubOwner: "YOUR-GITHUB-USERNAME",
  githubRepository: "pokerogue-keagan-edition",
  fallbackVersion: "1.12.3",
});
```

The repository must be public. Do not add a GitHub token to the page; anything shipped in browser JavaScript is visible to every visitor.

## Preview and Build Locally

Run the development server:

```powershell
corepack pnpm site:dev
```

Open `http://localhost:5173`. To create an optimized copy under `release/site/`, run:

```powershell
corepack pnpm site:test
corepack pnpm site:build
```

Either the raw `website/` directory or the generated `release/site/` directory can be served as a static site. The generated build is recommended when uploading files manually.

## Host with Synology Web Station

1. Install **Web Station** from Synology Package Center.
2. Create a folder such as `/volume1/web/pokerogue-keagan`.
3. Copy everything inside `release/site/` into that folder.
4. In Web Station, create a **Static Website** web service with that folder as its document root.
5. Create a Web Portal for the service and attach the chosen hostname and HTTPS certificate.
6. Visit the public URL from a device outside the home network before sharing it.

Only expose HTTPS for the website. Do not expose DSM administration, SMB, SSH, or the Git checkout to the public internet.

## Let Synology Pull Site Changes from GitHub

For a Git-linked deployment, keep a private checkout outside the web root and let Web Station serve only its `website/` folder. A Synology Task Scheduler job can update the checkout without accepting inbound GitHub connections:

```sh
#!/bin/sh
set -eu

REPOSITORY_DIR="/volume1/git/pokerogue-keagan-edition"

git -C "$REPOSITORY_DIR" pull --ff-only origin main
```

Point the Web Station document root at:

```text
/volume1/git/pokerogue-keagan-edition/website
```

Run the task as a dedicated low-privilege account with read access to the checkout and document root. Use a read-only GitHub deploy key if the source repository is private; a public repository can be cloned without credentials.

The static site links large installer downloads to GitHub Releases, so the NAS does not need to store or serve each 600 MB installer. Publishing through **Publish Keagan Edition for Windows** updates the landing page automatically.

## Updating the Website

For each game release:

1. Increase `package.json` and update `PATCH_NOTES.md`.
2. Commit and push the source.
3. Run the GitHub **Publish Keagan Edition for Windows** workflow with the matching version tag.
4. Let the Synology scheduled task pull any landing-page design changes.

New installer links and release notes require no website commit because they come from the GitHub Releases API.

<!--
SPDX-FileCopyrightText: 2026 Pagefault Games
SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# PokéRogue Keagan Edition: AFK Mode and Windows Deployment

PokéRogue Keagan Edition ships as an Electron desktop application for 64-bit Windows. The supported package includes both an installer and a portable executable; the old localhost/static zip is not a supported deployment target.

## AFK Bot Controls

- Sign in manually before enabling AFK mode; account and login screens are not automated.
- At the title screen, `F8` starts AFK mode. It resumes an existing save when available or starts continuous Classic runs.
- On a fresh automatic run, the default party is Bulbasaur, Charmander, and Squirtle.
- `F9` cycles the `FAST_FARM`, `SAFE_CLIMB`, and `BOSS_PUSH` safety profiles.
- Any normal player input immediately disables AFK mode so the player can take over.
- Press `F8` again to resume after a manual takeover.
- The title screen's `AFK Bot Help` option shows the controls without interrupting normal title startup.

The status badge reports runs started and ended, wipes, average wave reached, elapsed AFK time, the selected template, and any safety pause.

## Safety and Optional Features

- Smart stop rules can stop after a number of completed runs, within a wave range, or when a target species appears.
- Save-slot rotation is disabled by default. When explicitly enabled, it selects empty slots only and pauses instead of overwriting an existing run.
- `FAST_FARM` can run uninterrupted and may defeat a shiny rather than pause or catch it.
- `SAFE_CLIMB` and `BOSS_PUSH` pause for shiny encounters, but low team health never disables autoplay; tactical switching and normal wipe recovery remain active.
- Browser notifications are enabled by default when permission is granted. Webhook delivery is optional and disabled until a URL is configured.
- Lures and rewards that require a multi-step move or fusion choice are skipped. A Mystery Encounter gift is declined when the party is already full so the run can continue.
- Every built-in Mystery Encounter has a deliberately reviewed unattended route; any future unreviewed encounter option pauses instead of being selected blindly.
- AFK mode does not automatically capture wild Pokémon or use the Egg Gacha.
- Unsupported or ambiguous party-selection screens pause the bot for manual input.

Advanced stop, notification, and rotation settings are stored locally in the desktop profile. They do not leave the computer except for a webhook URL the user explicitly configures.

## Account Support

The Windows app supports account registration and username/password login through its built-in API proxy. Login state and local save data persist between launches.

Discord and Google OAuth sign-in remain browser-only because those providers return their callbacks to the public PokéRogue web origin. Use a PokéRogue username and password in the desktop app, or use the browser version for OAuth sign-in.

Detailed `NETxx` and `CFxx` errors are shown intact when the app cannot reach the account service. Known account validation errors are translated into the normal in-game messages.

## Build the Windows Package

Requirements:

- 64-bit Windows 10 or 11
- The Node.js version in `.nvmrc`
- pnpm through Corepack

From the repository root, run:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm package:windows
```

The packaging command builds the app-mode assets and creates both of these under `release/windows/`:

- An NSIS installer with install-location and shortcut options
- A portable `.exe` that runs without installation
- A matching `-source.zip` snapshot of the exact non-ignored working tree used for the build

The installer and portable app also contain that source snapshot, the project license,
the license collection, README, and distribution notice under their packaged resources.

Generated `release/` contents are intentionally ignored by Git and development tooling.

The package is unsigned unless a Windows code-signing certificate is supplied through
`CSC_LINK` (or `WIN_CSC_LINK`) and `CSC_KEY_PASSWORD`. Unsigned downloads can trigger a
Microsoft Defender SmartScreen warning on other computers; sign public releases with a
trusted certificate before distribution.

## Publish Downloads and Updates with GitHub Releases

Use your own **public** GitHub repository. Do not publish Keagan Edition releases from the upstream `pagefaultgames/pokerogue` repository.

The repository includes the **Publish Keagan Edition for Windows** workflow. On its first successful run it builds and publishes:

- The NSIS installer friends should download
- `latest.yml` and the matching blockmap used for incremental updates
- The corresponding-source archive required alongside the distributed build
- The current `PATCH_NOTES.md` as the GitHub Release notes

To publish a version:

1. Commit and push the complete source to your own public GitHub repository.
2. Increase `package.json` to a new version such as `1.12.3.0` and update `PATCH_NOTES.md`.
3. In GitHub, open **Actions** > **Publish Keagan Edition for Windows** > **Run workflow**.
4. Enter the matching tag, such as `v1.12.3`.
5. When it finishes, share `https://github.com/YOUR-NAME/YOUR-REPOSITORY/releases/latest`.

The workflow refuses private repositories because normal desktop installations cannot safely carry a personal GitHub access token. It also refuses the upstream PokéRogue repository and an already-published version tag.

The installed NSIS build checks that release page shortly after launch. It asks before downloading and asks again before restarting. The portable build intentionally does not self-update.

Version 1.12.3 is the first updater-enabled installer, so users of 1.12.2 must install 1.12.3 manually. Later versions can update from inside the installed app.

For signed releases, add repository Actions secrets named `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. Without them, the workflow still publishes an unsigned test installer that may trigger SmartScreen.

## Validate Before Distribution

Run the desktop smoke test:

```powershell
corepack pnpm desktop:smoke
```

For a previously built `dist/`, use:

```powershell
corepack pnpm desktop:smoke:skip-build
```

The automated smoke uses a temporary isolated profile. It verifies persistent localStorage,
the restrictive desktop Content Security Policy, exact branding, and a live renderer-side
request through `pokerogue://app/api`; it never reads or changes the normal desktop profile.

Then verify the packaged application manually:

1. Launch the installer build and the portable build.
2. Register or sign in with a username and password.
3. Close and reopen the app; confirm the login and save data remain available.
4. From the title screen, press `F8`; confirm that an existing save resumes or a fresh Classic run selects Bulbasaur, Charmander, and Squirtle.
5. Confirm normal player input immediately stops AFK mode.
6. Open `AFK Bot Help` from the title menu and return to the title screen.

If startup fails, inspect `%TEMP%\PokeRogue-Keagan-Startup.log`. Do not share session tokens, cookies, or browser-profile data when sending logs.

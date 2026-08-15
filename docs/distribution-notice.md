<!--
SPDX-FileCopyrightText: 2026 Pagefault Games
SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# Distribution and Corresponding Source Notice

PokéRogue Keagan Edition is based on the PokéRogue project. The application code is distributed under the GNU Affero General Public License, version 3 only. Other files, including game assets and third-party components, may use different licenses. Refer to `LICENSE`, the files under `LICENSES`, `README.md`, `CREDITS.md`, and the source tree's SPDX declarations for the applicable terms and attribution.

Each canonical Windows package created by `scripts/package-exe.ps1` contains:

- `LICENSE`, `LICENSES/*`, this notice, the patch notes, and the project README in the application's `resources` directory;
- a `PokeRogue-Keagan-Edition-<version>-source.zip` archive in that same directory; and
- an identical source archive next to the installer and portable executable in `release/windows`.

The source ZIP snapshots the current main-repository working tree at packaging time. It contains every existing regular file reported by `git ls-files --cached --others --exclude-standard`, so tracked modifications and untracked, non-ignored source files are included. Git-ignored/generated files, dependency installations, Git administrative data, and submodule working-tree contents are excluded.

`SOURCE-METADATA.txt` inside the ZIP records the main repository's base commit, configured remotes, working-tree status, recursive submodule revisions, omitted tracked paths, and a SHA-256 manifest of archived files. Submodule source can be obtained from the URLs in `.gitmodules` at the recorded revisions. Review `git status --short --untracked-files=all` before distributing a build because untracked, non-ignored files intentionally become part of the corresponding-source archive.

The Windows executables are unsigned unless packaging is supplied an explicit code-signing certificate through `CSC_LINK` or `WIN_CSC_LINK`. An unsigned build may trigger a Microsoft Defender SmartScreen warning.

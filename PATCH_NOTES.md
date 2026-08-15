<!--
SPDX-FileCopyrightText: 2026 Pagefault Games
SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# PokéRogue Keagan Edition Patch Notes

## Version 1.12.3 - 16 August 2026

### Easier installs and updates

- Installed builds can now check a configured public GitHub Releases page for newer versions.
- Updates are never installed silently: the game asks before downloading and again before restarting.
- Choosing **Later** after a download keeps the current game open and installs the update when the app closes.
- Update errors are recorded in the desktop startup log without interrupting gameplay.
- Portable builds remain manual-update builds so they never replace files unexpectedly.

### Updating from 1.12.2

Install version 1.12.3 manually over the existing copy. This is the first updater-enabled installer; releases after 1.12.3 can then be offered inside the game. Login, saves, settings, and AFK statistics remain in the existing desktop profile.

## Version 1.12.2 - 16 August 2026

### Smarter battles

- Autoplay now compares real predicted damage instead of judging moves mainly by their listed base power.
- Decisions account for type matchups and immunities, the current levels and stats of both Pokémon, physical versus special defence, stat stages, accuracy, priority, multi-hit moves, weather, screens, and other live battle effects.
- The bot estimates the strongest attack an opponent can use and values reliable knockouts or priority moves when the team is threatened.
- Double battles use legal targets, retain the chosen target, value spread damage, and penalize friendly fire.
- Unsafe self-destruct and unreliable one-hit-knockout choices are avoided during unattended farming.

### Better moves as the team levels

- Fixed an issue that rejected every new level-up move after a Pokémon already knew four moves.
- The bot now compares the complete old and proposed movesets, replaces the weakest move when the new move is a genuine improvement, and keeps useful type coverage.
- It avoids leaving a Pokémon with an all-status moveset and uses the Pokémon's stronger attacking stat when judging physical and special upgrades.

### Unattended farming

- Lure, Super Lure, and Max Lure rewards are skipped in favour of another supported reward or Continue.
- Critically low team health no longer disables AFK mode. Tactical switching remains active, and a wipe follows the normal automatic restart flow.
- Battle previews now restore deterministic battle state and do not accidentally activate abilities, consume battle randomness, or alter the real turn.

### Updating from 1.12.1

Install the 1.12.2 installer over the existing copy. The desktop profile is retained, including login, saves, settings, and AFK statistics. Because this test build is unsigned, Windows may display a SmartScreen warning.

These notes are also available from **Patch Notes** on the game's title menu.

<!--
SPDX-FileCopyrightText: 2026 Pagefault Games
SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# PokéRogue Keagan Edition Patch Notes

## Version 1.12.8 - 22 August 2026

### Egg-hatch progression

- Fixed runs freezing in `EggLapsePhase` immediately after an EXP message when two or more eggs were ready and **Egg Skip** was set to **Never**.
- The **Never** setting now queues the normal egg-hatching sequence and advances the phase instead of leaving the previous message onscreen indefinitely.
- Alt+Tab, screenshots, and the reserved F8/F9 hotkeys no longer masquerade as gameplay input and disable AFK mode while checking another window.

### Updating from 1.12.7

Close a running 1.12.7 copy, then install version 1.12.8 over the existing copy. Login, saves, settings, AFK statistics, and the desktop profile remain in place.

## Version 1.12.7 - 21 August 2026

### Battle freeze recovery

- Fixed silent battle stalls when a move animation, charge animation, or dynamically loaded animation never finishes. Battle-owned completion guards now recover safely after a bounded wait and ignore stale late callbacks.
- Charge-animation assets now share one in-flight load and fall back cleanly when a file is missing, corrupt, or rejected, instead of leaving every waiting battle unresolved.
- AFK mode now detects command, target-selection, and message loops that make no real turn progress. Background suspension and legitimate post-battle reward, evolution, and move-learning progress do not count as battle stalls.
- Autoplay filters restricted move targets before scoring them, including a Heal Blocked ally for Pollen Puff, and matchup planning no longer queues real Strong Winds battle messages.
- Desktop rendering is allowed to keep ticking while minimized so unattended runs are not paused by Electron background throttling.

### Retained diagnostics

- The desktop app now keeps timestamped autoplay and battle-recovery diagnostics in `%APPDATA%\PokéRogue Keagan Edition\logs\Autoplay.log`.
- The log rotates at 1 MiB and retains one backup as `Autoplay.log.1`, making a future silent stall reportable without allowing unbounded disk usage.

### Updating from 1.12.6

Accept the update prompt in an installed 1.12.6 build, or install version 1.12.7 over the existing copy. Login, saves, settings, AFK statistics, and the desktop profile remain in place.

## Version 1.12.6 - 20 August 2026

### AFK/autoplay reliability

- Fixed AFK mode stopping or appearing frozen at battle starts. Ordinary encounter saves now continue after the local snapshot instead of waiting for remote verification, while scheduled sync checkpoints still perform full verification.
- Repeated keyboard, controller, and touch input is no longer mistaken for fresh manual input, so a held or stale button cannot randomly switch AFK mode off.
- Battle-planning errors and rejected commands now use bounded retries and a targeted Struggle fallback instead of leaving the same command phase stuck forever.
- Added exception containment and a phase-aware watchdog with clear badge reasons for genuine stalls, while loading and automatic reconnect screens remain free to recover on their own.
- Improved unattended navigation through title, starter, save-slot, reward, confirmation, evolution, and move-learning screens, including safe F8 resume behavior for persisted stop rules.

### Updating from 1.12.5

Accept the update prompt in an installed 1.12.5 build, or install version 1.12.6 over the existing copy. Login, saves, settings, and AFK statistics remain in the existing desktop profile.

## Version 1.12.5 - 17 August 2026

### Battle stability

- Fixed the battle freeze shown on **"The sandstorm rages."** after Sand Stream activated and a Pokémon fainted.
- Cosmetic battle animations now reject invalid audio timing values and have a bounded completion fallback, so a broken effect cannot hold the battle phase forever.
- The fix applies to weather and other common battle effects rather than special-casing one Pokémon or one encounter.

### Login and connection reliability

- Account and save requests now have bounded timeouts instead of being able to leave the login screen or a new encounter loading forever.
- Temporary API, Cloudflare, or server failures no longer erase a newly accepted login. Stored login details are removed only when the server confirms that the session is unauthorized.
- Login now waits for the account save to load successfully; a temporary save-download failure opens the retry screen instead of starting with blank data.
- Encounter setup now recovers cleanly when save verification fails. An uncertain upload is not retried immediately, and its newer local snapshot remains protected across restarts until a later scheduled sync succeeds.
- Desktop diagnostics record request completion status and duration without logging passwords, tokens, request bodies, or query values.

### Cleaner upgrades

- The installer removes the obsolete unaccented **PokeRogue Keagan Edition** shortcuts left by early test builds. It does not remove either desktop profile, saves, settings, or login data.

### Updating from 1.12.4

Accept the update prompt in an installed 1.12.4 build, or install version 1.12.5 over the existing copy. Login, saves, settings, and AFK statistics remain in the existing desktop profile.

## Version 1.12.4 - 16 August 2026

### Evolution autoplay fix

- Fixed an AFK-mode freeze that could happen when an evolved Pokémon tried to learn a new move before returning to the run.
- Move-learning choices are now submitted only once while the evolution screen changes, preventing duplicate callbacks from corrupting the battle phase queue.
- If the move summary is still animating, the bot waits and retries instead of immediately switching AFK mode off.
- If the move-summary screen cannot accept a choice for ten seconds, the bot stops safely and displays a clear reason on the AFK status badge. Once accepted, the handoff is allowed to finish without duplicate input or a suspend-related timeout.
- Player form-change confirmations follow the same safe unattended policy as normal evolutions.

### Updating from 1.12.3

Install version 1.12.4 over the existing copy, or accept the update prompt in an installed 1.12.3 build. Login, saves, settings, and AFK statistics remain in the existing desktop profile.

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

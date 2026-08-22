/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene, initGlobalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import type { Egg } from "#data/egg";
import { EggSkipPreference } from "#enums/egg-skip-preference";
import { EggLapsePhase } from "#phases/egg-lapse-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

describe("EggLapsePhase", () => {
  beforeAll(() => {
    const phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    new GameManager(phaserGame);
  });

  it("regularly hatches multiple ready eggs when skipping is disabled", () => {
    const previousScene = globalScene;
    const previousPreference = settings.general.eggSkipPreference;
    const eggs = [
      { id: 1, hatchWaves: 1 },
      { id: 2, hatchWaves: 1 },
    ] as Egg[];
    const queueMessage = vi.fn();
    const unshiftNew = vi.fn();
    const shiftPhase = vi.fn();

    initGlobalScene({
      gameData: { eggs },
      phaseManager: { queueMessage, shiftPhase, unshiftNew },
    } as unknown as Parameters<typeof initGlobalScene>[0]);
    settings.general.eggSkipPreference = EggSkipPreference.NEVER;

    try {
      const phase = new EggLapsePhase();
      phase.start();

      expect(queueMessage).toHaveBeenCalledOnce();
      expect(unshiftNew).toHaveBeenNthCalledWith(1, "EggHatchPhase", phase, eggs[0], 2);
      expect(unshiftNew).toHaveBeenNthCalledWith(2, "EggHatchPhase", phase, eggs[1], 1);
      expect(shiftPhase).toHaveBeenCalledOnce();
    } finally {
      settings.general.eggSkipPreference = previousPreference;
      initGlobalScene(previousScene);
    }
  });
});

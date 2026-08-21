/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { TurnCommand } from "#app/battle";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { SelectTargetPhase } from "#phases/select-target-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

describe("SelectTargetPhase", () => {
  beforeAll(() => {
    const phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    new GameManager(phaserGame);
  });

  it("rejects a restricted target whose battler index is zero", () => {
    const previousScene = globalScene;
    const selectionDeniedText = "That target is blocked";
    const restrictingTag = { selectionDeniedText: vi.fn(() => selectionDeniedText) };
    const target = {
      getBattlerIndex: () => BattlerIndex.PLAYER,
      isFainted: () => false,
    } as unknown as Pokemon;
    const user = {
      getAlly: () => target,
      getTargetRestrictingTag: vi.fn(() => restrictingTag),
    } as unknown as Pokemon;
    const command: TurnCommand = {
      command: Command.FIGHT,
      move: {
        move: MoveId.POLLEN_PUFF,
        targets: [],
        useMode: MoveUseMode.NORMAL,
      },
    };
    const turnCommands = [null, command];
    let selectTarget: ((targets: BattlerIndex[]) => void) | undefined;
    const setMode = vi.fn((mode: UiMode, ...args: unknown[]) => {
      if (mode === UiMode.TARGET_SELECT) {
        selectTarget = args[2] as (targets: BattlerIndex[]) => void;
      }
      return Promise.resolve();
    });
    const queueMessage = vi.fn();
    const unshiftNew = vi.fn();

    initGlobalScene({
      currentBattle: { double: true, turnCommands },
      getField: () => [target, user],
      phaseManager: { queueMessage, unshiftNew },
      ui: { setMode },
    } as unknown as Parameters<typeof initGlobalScene>[0]);

    try {
      const phase = new SelectTargetPhase(BattlerIndex.PLAYER_2);
      const end = vi.spyOn(phase, "end").mockImplementation(() => {});
      phase.start();

      expect(selectTarget).toBeTypeOf("function");
      selectTarget?.([BattlerIndex.PLAYER]);

      expect(user.getTargetRestrictingTag).toHaveBeenCalledWith(MoveId.POLLEN_PUFF, target);
      expect(queueMessage).toHaveBeenCalledWith(selectionDeniedText);
      expect(turnCommands[1]).toBeNull();
      expect(unshiftNew).toHaveBeenCalledWith("CommandPhase", 1);
      expect(end).toHaveBeenCalledOnce();
    } finally {
      initGlobalScene(previousScene);
    }
  });
});

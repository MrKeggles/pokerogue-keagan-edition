import type { BattleScene } from "#app/battle-scene";
import { EncounterPhase } from "#phases/encounter-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("EncounterPhase save failure recovery", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    scene = game.scene;
  });

  it("does not request remote verification for an ordinary local encounter save", async () => {
    const phase = new EncounterPhase();
    const testPhase = phase as unknown as {
      doEncounter: () => void;
      saveAndContinueEncounter: (sync: boolean) => Promise<void>;
    };
    const saveAll = vi.spyOn(scene.gameData, "saveAll").mockResolvedValue(true);
    const doEncounter = vi.spyOn(testPhase, "doEncounter").mockImplementation(() => {});
    const resetSeed = vi.spyOn(scene, "resetSeed").mockImplementation(() => {});

    await testPhase.saveAndContinueEncounter(false);

    expect(saveAll).toHaveBeenCalledWith(true, false, false, false, false);
    expect(doEncounter).toHaveBeenCalledTimes(1);
    expect(resetSeed).toHaveBeenCalledTimes(1);
  });

  it("retains normal verification and reconciliation behavior for scheduled syncs", async () => {
    const phase = new EncounterPhase();
    const testPhase = phase as unknown as {
      doEncounter: () => void;
      saveAndContinueEncounter: (sync: boolean) => Promise<void>;
    };
    const saveAll = vi.spyOn(scene.gameData, "saveAll").mockResolvedValue(true);
    vi.spyOn(testPhase, "doEncounter").mockImplementation(() => {});
    vi.spyOn(scene, "resetSeed").mockImplementation(() => {});

    await testPhase.saveAndContinueEncounter(true);

    expect(saveAll).toHaveBeenCalledWith(true, true, false, false, true);
  });

  it("releases saving state and returns safely when saveAll rejects", async () => {
    const phase = new EncounterPhase();
    const testPhase = phase as unknown as {
      doEncounter: () => void;
      saveAndContinueEncounter: (sync: boolean) => Promise<void>;
    };
    vi.spyOn(scene.gameData, "saveAll").mockRejectedValue(new Error("save failed"));
    const hideSavingIcon = vi.spyOn(scene.ui.savingIcon, "hide");
    const reset = vi.spyOn(scene, "reset").mockImplementation(() => {});
    const doEncounter = vi.spyOn(testPhase, "doEncounter");
    vi.spyOn(console, "error").mockImplementation(() => {});
    scene.disableMenu = true;

    await testPhase.saveAndContinueEncounter(true);

    expect(scene.disableMenu).toBe(false);
    expect(hideSavingIcon).toHaveBeenCalled();
    expect(reset).toHaveBeenCalledWith(true);
    expect(doEncounter).not.toHaveBeenCalled();
  });
});

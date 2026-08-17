import { pokerogueApi } from "#api/api";
import * as account from "#app/account";
import * as appConstants from "#constants/app-constants";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { GameData } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import type { SessionSaveData } from "#types/save-data";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("System - Game Data", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame, false);
    game.override
      .moveset([MoveId.SPLASH])
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  describe("tryClearSession", () => {
    beforeEach(() => {
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
      vi.spyOn(game.scene.gameData, "getSessionSaveData").mockReturnValue({} as SessionSaveData);
      vi.spyOn(account, "updateUserInfo").mockImplementation(async () => [true, 1]);
    });

    it("should return [true, true] if bypassLogin is true", async () => {
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(true);

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([true, true]);
    });

    it("should return [true, true] if successful", async () => {
      vi.spyOn(pokerogueApi.savedata.session, "clear").mockResolvedValue({
        success: true,
      });

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([true, true]);
      expect(account.updateUserInfo).toHaveBeenCalled();
    });

    it("should return [true, false] if not successful", async () => {
      vi.spyOn(pokerogueApi.savedata.session, "clear").mockResolvedValue({
        success: false,
      });

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([true, false]);
      expect(account.updateUserInfo).toHaveBeenCalled();
    });

    it("should return [false, false] session is out of date", async () => {
      vi.spyOn(pokerogueApi.savedata.session, "clear").mockResolvedValue({
        error: "session out of date",
      });

      const result = await game.scene.gameData.tryClearSession(0);

      expect(result).toEqual([false, false]);
      expect(account.updateUserInfo).toHaveBeenCalled();
    });
  });

  describe("save availability", () => {
    beforeEach(() => {
      vi.mocked(game.scene.gameData.saveAll).mockRestore();
      vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
      // The full suite intentionally shares the BattleScene between files and
      // other tests can leave it on the title-screen sentinel slot (-1).
      game.scene.sessionSlotId = 0;
    });

    it("allows gameplay to continue when read-only verification is unavailable", async () => {
      vi.spyOn(pokerogueApi.savedata.system, "verify").mockRejectedValue(new Error("API unavailable"));
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(game.scene.gameData.verify()).resolves.toBe(true);
    });

    it("protects a local snapshot until a later remote sync succeeds", async () => {
      expect(appConstants.bypassLogin).toBe(false);
      vi.spyOn(game.scene.gameData, "getSessionSaveData").mockReturnValue({} as SessionSaveData);
      vi.spyOn(pokerogueApi.savedata, "updateAll")
        .mockResolvedValueOnce("NET04: The PokeRogue API request timed out.")
        .mockResolvedValueOnce("");
      const verifyRemote = vi.spyOn(pokerogueApi.savedata.system, "verify").mockResolvedValue(null);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(game.scene.gameData.saveAll(true, true)).resolves.toBe(true);
      expect(pokerogueApi.savedata.updateAll).toHaveBeenCalledTimes(1);

      // Recreate GameData to model an application restart. The persisted
      // marker must still prevent comparison against an older remote copy.
      const restartedGameData = new GameData();
      vi.spyOn(restartedGameData, "getSessionSaveData").mockReturnValue({} as SessionSaveData);
      game.scene.gameData = restartedGameData;
      await expect(restartedGameData.saveAll(true, false)).resolves.toBe(true);
      expect(verifyRemote).not.toHaveBeenCalled();

      // The next normal scheduled sync retries once and definitively succeeds.
      await expect(restartedGameData.saveAll(true, true)).resolves.toBe(true);
      expect(pokerogueApi.savedata.updateAll).toHaveBeenCalledTimes(2);

      // Read-only verification resumes after the uncertainty has cleared.
      const resynchronizedGameData = new GameData();
      vi.spyOn(resynchronizedGameData, "getSessionSaveData").mockReturnValue({} as SessionSaveData);
      game.scene.gameData = resynchronizedGameData;
      await expect(resynchronizedGameData.saveAll(true, false)).resolves.toBe(true);
      expect(verifyRemote).toHaveBeenCalledTimes(1);
    });

    it("persists uncertainty before an in-flight POST can settle", async () => {
      vi.spyOn(game.scene.gameData, "getSessionSaveData").mockReturnValue({} as SessionSaveData);
      let settleUpdate!: (value: string) => void;
      vi.spyOn(pokerogueApi.savedata, "updateAll").mockImplementation(
        () =>
          new Promise<string>(resolve => {
            settleUpdate = resolve;
          }),
      );
      const verifyRemote = vi.spyOn(pokerogueApi.savedata.system, "verify").mockResolvedValue(null);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const pendingSave = game.scene.gameData.saveAll(true, true);
      expect(pokerogueApi.savedata.updateAll).toHaveBeenCalledTimes(1);

      const restartedGameData = new GameData();
      await expect(restartedGameData.verify()).resolves.toBe(true);
      expect(verifyRemote).not.toHaveBeenCalled();

      settleUpdate("HTTP 500: Internal Server Error");
      await expect(pendingSave).resolves.toBe(true);
    });

    it.each([408, 429, 503])("keeps gameplay available after transient HTTP %d save failures", async status => {
      vi.spyOn(game.scene.gameData, "getSessionSaveData").mockReturnValue({} as SessionSaveData);
      vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue(`HTTP ${status}: temporary failure`);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(game.scene.gameData.saveAll(true, true)).resolves.toBe(true);
    });

    it.each([401, 403])("does not report HTTP %d authentication failures as successful saves", async status => {
      vi.spyOn(game.scene.gameData, "getSessionSaveData").mockReturnValue({} as SessionSaveData);
      vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue(`HTTP ${status}: authentication failed`);
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(game.scene.gameData.saveAll(true, true)).resolves.toBe(false);
    });

    it("recognizes a status-prefixed out-of-date response and clears uncertainty after reinitializing", async () => {
      vi.spyOn(game.scene.gameData, "getSessionSaveData").mockReturnValue({} as SessionSaveData);
      vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue("HTTP 409: session out of date");
      const loadSystem = vi.spyOn(game.scene.gameData, "loadSystem").mockResolvedValue(true);
      const verifyRemote = vi.spyOn(pokerogueApi.savedata.system, "verify").mockResolvedValue(null);
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(game.scene.gameData.saveAll(true, true)).resolves.toBe(false);
      expect(loadSystem).toHaveBeenCalledTimes(1);
      expect(loadSystem).toHaveBeenCalledWith(false);

      const reinitializedGameData = new GameData();
      await expect(reinitializedGameData.verify()).resolves.toBe(true);
      expect(verifyRemote).toHaveBeenCalledTimes(1);
    });

    it("restores every local save when an out-of-date response cannot be reinitialized", async () => {
      localStorage.clear();
      game.scene.sessionSlotId = 0;
      vi.spyOn(game.scene.gameData, "getSessionSaveData").mockReturnValue({} as SessionSaveData);

      const localSaveKeys = [
        `data_${account.loggedInUser?.username}`,
        ...Array.from({ length: 5 }, (_, slotId) => account.getSessionDataLocalStorageKey(slotId)),
      ];
      for (const [index, key] of localSaveKeys.entries()) {
        localStorage.setItem(key, `previous-local-save-${index}`);
      }

      let snapshotBeforeReinitialize!: Map<string, string | null>;
      vi.spyOn(pokerogueApi.savedata, "updateAll").mockImplementation(async () => {
        snapshotBeforeReinitialize = new Map(localSaveKeys.map(key => [key, localStorage.getItem(key)]));
        return "HTTP 409: session out of date";
      });
      const loadSystem = vi.spyOn(game.scene.gameData, "loadSystem").mockResolvedValue(false);
      const verifyRemote = vi.spyOn(pokerogueApi.savedata.system, "verify").mockResolvedValue(null);
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(game.scene.gameData.saveAll(true, true)).resolves.toBe(false);
      expect(loadSystem).toHaveBeenCalledWith(false);

      for (const [key, value] of snapshotBeforeReinitialize) {
        expect(localStorage.getItem(key)).toBe(value);
      }

      // The unresolved remote write marker must survive the failed reload so a
      // restart cannot compare the preserved snapshot with an older server copy.
      const restartedGameData = new GameData();
      await expect(restartedGameData.verify()).resolves.toBe(true);
      expect(verifyRemote).not.toHaveBeenCalled();
    });
  });
});

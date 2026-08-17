import { pokerogueApi } from "#api/api";
import type { BattleScene } from "#app/battle-scene";
import * as appConstants from "#constants/app-constants";
import { LoginPhase } from "#phases/login-phase";
import { GameManager } from "#test/framework/game-manager";
import { sessionIdKey } from "#utils/common";
import { getCookie, setCookie } from "#utils/cookies";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface LoginPhaseTestHarness {
  checkUserInfo(): Promise<boolean>;
  loadSystemAndContinue(): Promise<boolean>;
}

const validAccountInfo = {
  username: "desktop-user",
  lastSessionSlot: 0,
  discordId: "",
  googleId: "",
  hasAdminRole: false,
};

describe("LoginPhase authentication resilience", () => {
  let phaserGame: Phaser.Game;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    scene = new GameManager(phaserGame, false).scene;
    vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
    vi.spyOn(appConstants, "isApp", "get").mockReturnValue(true);
    localStorage.clear();
  });

  function createPhaseHarness(): LoginPhaseTestHarness {
    return new LoginPhase() as unknown as LoginPhaseTestHarness;
  }

  function setDesktopSession(): void {
    setCookie(sessionIdKey, "desktop-session-token");
    expect(getCookie(sessionIdKey)).toBe("desktop-session-token");
  }

  it("clears a newly-issued token when account info definitively returns 401", async () => {
    setDesktopSession();
    vi.spyOn(pokerogueApi.account, "getInfo").mockResolvedValue([null, 401]);
    const resetSpy = vi.spyOn(scene, "reset").mockImplementation(() => undefined);
    const unavailableSpy = vi.spyOn(scene.phaseManager, "unshiftNew").mockImplementation(() => undefined);
    const shiftSpy = vi.spyOn(scene.phaseManager, "shiftPhase").mockImplementation(() => undefined);

    const success = await createPhaseHarness().checkUserInfo();

    expect(success).toBe(false);
    expect(getCookie(sessionIdKey)).toBeFalsy();
    expect(resetSpy).toHaveBeenCalledWith(true, true);
    expect(unavailableSpy).not.toHaveBeenCalled();
    expect(shiftSpy).not.toHaveBeenCalled();
  });

  it.each([403, 500])("keeps a newly-issued token and opens retry UI after temporary status %i", async statusCode => {
    setDesktopSession();
    vi.spyOn(pokerogueApi.account, "getInfo").mockResolvedValue([null, statusCode]);
    const resetSpy = vi.spyOn(scene, "reset").mockImplementation(() => undefined);
    const unavailableSpy = vi.spyOn(scene.phaseManager, "unshiftNew").mockImplementation(() => undefined);
    const shiftSpy = vi.spyOn(scene.phaseManager, "shiftPhase").mockImplementation(() => undefined);

    const success = await createPhaseHarness().checkUserInfo();

    expect(success).toBe(false);
    expect(getCookie(sessionIdKey)).toBe("desktop-session-token");
    expect(resetSpy).not.toHaveBeenCalled();
    expect(unavailableSpy).toHaveBeenCalledWith("UnavailablePhase");
    expect(shiftSpy).toHaveBeenCalledOnce();
  });

  it("clears a restored startup token only after a 401 response", async () => {
    setDesktopSession();
    vi.spyOn(pokerogueApi.account, "getInfo").mockResolvedValue([null, 401]);
    const resetSpy = vi.spyOn(scene, "reset").mockImplementation(() => undefined);
    const unavailableSpy = vi.spyOn(scene.phaseManager, "unshiftNew").mockImplementation(() => undefined);

    await new LoginPhase().start();

    expect(getCookie(sessionIdKey)).toBeFalsy();
    expect(resetSpy).toHaveBeenCalledWith(true, true);
    expect(unavailableSpy).not.toHaveBeenCalled();
  });

  it("keeps a restored startup token while retrying a 500 or network failure", async () => {
    setDesktopSession();
    vi.spyOn(pokerogueApi.account, "getInfo").mockResolvedValue([null, 500]);
    const resetSpy = vi.spyOn(scene, "reset").mockImplementation(() => undefined);
    const unavailableSpy = vi.spyOn(scene.phaseManager, "unshiftNew").mockImplementation(() => undefined);
    const shiftSpy = vi.spyOn(scene.phaseManager, "shiftPhase").mockImplementation(() => undefined);

    await new LoginPhase().start();

    expect(getCookie(sessionIdKey)).toBe("desktop-session-token");
    expect(resetSpy).not.toHaveBeenCalled();
    expect(unavailableSpy).toHaveBeenCalledWith("UnavailablePhase");
    expect(shiftSpy).toHaveBeenCalledOnce();
  });

  it("does not leave startup with uninitialized game data after account info succeeds", async () => {
    setDesktopSession();
    vi.spyOn(pokerogueApi.account, "getInfo").mockResolvedValue([validAccountInfo, 200]);
    const loadSystemSpy = vi.spyOn(scene.gameData, "loadSystem").mockResolvedValue(false);
    const unavailableSpy = vi.spyOn(scene.phaseManager, "unshiftNew").mockImplementation(() => undefined);
    const shiftSpy = vi.spyOn(scene.phaseManager, "shiftPhase").mockImplementation(() => undefined);
    const phase = new LoginPhase();
    const endSpy = vi.spyOn(phase, "end");

    await phase.start();

    expect(loadSystemSpy).toHaveBeenCalledOnce();
    expect(endSpy).not.toHaveBeenCalled();
    expect(getCookie(sessionIdKey)).toBe("desktop-session-token");
    expect(unavailableSpy).toHaveBeenCalledWith("UnavailablePhase");
    expect(shiftSpy).toHaveBeenCalledOnce();
  });

  it("does not leave an accepted login form with uninitialized game data", async () => {
    setDesktopSession();
    vi.spyOn(scene.gameData, "loadSystem").mockResolvedValue(false);
    const unavailableSpy = vi.spyOn(scene.phaseManager, "unshiftNew").mockImplementation(() => undefined);
    const shiftSpy = vi.spyOn(scene.phaseManager, "shiftPhase").mockImplementation(() => undefined);
    const phase = new LoginPhase();
    const endSpy = vi.spyOn(phase, "end");

    const loaded = await (phase as unknown as LoginPhaseTestHarness).loadSystemAndContinue();

    expect(loaded).toBe(false);
    expect(endSpy).not.toHaveBeenCalled();
    expect(getCookie(sessionIdKey)).toBe("desktop-session-token");
    expect(unavailableSpy).toHaveBeenCalledWith("UnavailablePhase");
    expect(shiftSpy).toHaveBeenCalledOnce();
  });
});

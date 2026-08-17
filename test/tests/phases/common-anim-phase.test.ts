import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import {
  CommonBattleAnim,
  getBattleAnimAudioDurationFrames,
  MAX_BATTLE_ANIM_AUDIO_DURATION_SECONDS,
} from "#data/battle-anims";
import { CommonAnim } from "#enums/move-anims-common";
import type { Pokemon } from "#field/pokemon";
import { COMMON_ANIM_PHASE_TIMEOUT_MS, CommonAnimPhase } from "#phases/common-anim-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("CommonAnimPhase", () => {
  beforeAll(() => {
    const phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    new GameManager(phaserGame);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    // The regular test harness disables animations for speed. These regressions intentionally exercise the setting
    // used by production builds.
    settings.update("display", "enableMoveAnimations", true);
  });

  afterEach(() => {
    settings.update("display", "enableMoveAnimations", false);
    vi.useRealTimers();
  });

  function createPhase(): CommonAnimPhase {
    const phase = Object.create(CommonAnimPhase.prototype) as CommonAnimPhase;
    Object.assign(phase, {
      anim: CommonAnim.SANDSTORM,
      player: true,
      targetIndex: undefined,
    });
    vi.spyOn(phase, "getPokemon").mockReturnValue({} as Pokemon);
    vi.spyOn(globalScene.phaseManager, "getCurrentPhase").mockReturnValue(phase);
    vi.spyOn(globalScene.phaseManager, "getStandbyPhase").mockReturnValue(null);
    return phase;
  }

  it("clears its watchdog and ends exactly once after normal animation completion", () => {
    vi.spyOn(CommonBattleAnim.prototype, "play").mockImplementation((_onSubstitute, callback) => callback?.());
    const phase = createPhase();
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();
    vi.advanceTimersByTime(COMMON_ANIM_PHASE_TIMEOUT_MS * 2);

    expect(settings.display.enableMoveAnimations).toBe(true);
    expect(end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers when starting the cosmetic animation throws synchronously", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(CommonBattleAnim.prototype, "play").mockImplementation(() => {
      throw new Error("animation failed");
    });
    const phase = createPhase();
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});

    expect(() => phase.start()).not.toThrow();

    expect(end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a missing animation callback without ending twice if it arrives late", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let animationComplete: (() => void) | undefined;
    vi.spyOn(CommonBattleAnim.prototype, "play").mockImplementation((_onSubstitute, callback) => {
      animationComplete = callback;
    });
    const phase = createPhase();
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();
    vi.advanceTimersByTime(COMMON_ANIM_PHASE_TIMEOUT_MS - 1);
    expect(end).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(end).toHaveBeenCalledTimes(1);

    animationComplete?.();
    vi.advanceTimersByTime(COMMON_ANIM_PHASE_TIMEOUT_MS);
    expect(end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let a stale timeout advance an unrelated current phase", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(CommonBattleAnim.prototype, "play").mockImplementation(() => {});
    const phase = createPhase();
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();
    vi.mocked(globalScene.phaseManager.getCurrentPhase).mockReturnValue({} as CommonAnimPhase);
    vi.advanceTimersByTime(COMMON_ANIM_PHASE_TIMEOUT_MS);

    expect(end).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defers completion while on standby and ends exactly once after restoration", () => {
    let animationComplete: (() => void) | undefined;
    vi.spyOn(CommonBattleAnim.prototype, "play").mockImplementation((_onSubstitute, callback) => {
      animationComplete = callback;
    });
    const phase = createPhase();
    const end = vi.spyOn(phase, "end").mockImplementation(() => {});
    const overridingPhase = {} as CommonAnimPhase;

    phase.start();
    vi.mocked(globalScene.phaseManager.getCurrentPhase).mockReturnValue(overridingPhase);
    vi.mocked(globalScene.phaseManager.getStandbyPhase).mockReturnValue(phase);
    animationComplete?.();

    expect(end).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    vi.mocked(globalScene.phaseManager.getCurrentPhase).mockReturnValue(phase);
    vi.mocked(globalScene.phaseManager.getStandbyPhase).mockReturnValue(null);
    vi.runOnlyPendingTimers();

    expect(end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    animationComplete?.();
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe("getBattleAnimAudioDurationFrames", () => {
  it("converts valid audio metadata to 30 FPS animation frames", () => {
    expect(getBattleAnimAudioDurationFrames(1.059)).toBe(32);
    expect(getBattleAnimAudioDurationFrames(MAX_BATTLE_ANIM_AUDIO_DURATION_SECONDS)).toBe(300);
  });

  it.each([
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["negative", -1],
    ["unreasonably long", MAX_BATTLE_ANIM_AUDIO_DURATION_SECONDS + 0.001],
  ])("rejects %s audio duration metadata", (_description, duration) => {
    expect(getBattleAnimAudioDurationFrames(duration)).toBe(0);
  });
});

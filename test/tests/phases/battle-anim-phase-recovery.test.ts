import { globalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import type { MoveAnim } from "#data/battle-anims";
import * as battleAnims from "#data/battle-anims";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ChargeAnim } from "#enums/move-anims-common";
import { MoveEffectTrigger } from "#enums/move-effect-trigger";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { PokemonMove } from "#moves/pokemon-move";
import { LOAD_MOVE_ANIM_PHASE_TIMEOUT_MS, LoadMoveAnimPhase } from "#phases/load-move-anim-phase";
import { MOVE_ANIM_PHASE_TIMEOUT_MS, MoveAnimPhase } from "#phases/move-anim-phase";
import { MoveChargePhase } from "#phases/move-charge-phase";
import { MoveEffectPhase } from "#phases/move-effect-phase";
import { BATTLE_ANIM_PHASE_TIMEOUT_MS } from "#phases/phase-completion-guard";
import { GameManager } from "#test/framework/game-manager";
import type { ChargingMove } from "#types/move-types";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Battle animation phase recovery", () => {
  beforeAll(() => {
    const phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    new GameManager(phaserGame);
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function watchPhase(phase: Phase) {
    vi.spyOn(globalScene.phaseManager, "getCurrentPhase").mockReturnValue(phase);
    vi.spyOn(globalScene.phaseManager, "getStandbyPhase").mockReturnValue(null);
    return vi.spyOn(phase, "end").mockImplementation(() => {});
  }

  async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  describe("LoadMoveAnimPhase", () => {
    it("recovers from a rejected dynamic animation load", async () => {
      const loadError = new Error("animation config unavailable");
      vi.spyOn(battleAnims, "initMoveAnim").mockRejectedValue(loadError);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const phase = new LoadMoveAnimPhase(MoveId.METRONOME);
      const end = watchPhase(phase);

      phase.start();
      await flushPromises();

      expect(consoleError).toHaveBeenCalledWith(
        "[Battle recovery] Move animation loading failed; continuing the battle.",
        loadError,
      );
      expect(end).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("times out a never-settled load and ignores its late completion", async () => {
      let resolveInit: (() => void) | undefined;
      vi.spyOn(battleAnims, "initMoveAnim").mockReturnValue(
        new Promise<void>(resolve => {
          resolveInit = resolve;
        }),
      );
      vi.spyOn(battleAnims, "loadMoveAnimAssets").mockResolvedValue();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const phase = new LoadMoveAnimPhase(MoveId.METRONOME);
      const end = watchPhase(phase);

      phase.start();
      vi.advanceTimersByTime(LOAD_MOVE_ANIM_PHASE_TIMEOUT_MS);
      expect(end).toHaveBeenCalledOnce();

      resolveInit?.();
      await flushPromises();

      expect(end).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not let a stale load callback advance an unrelated phase", async () => {
      let resolveInit: (() => void) | undefined;
      vi.spyOn(battleAnims, "initMoveAnim").mockReturnValue(
        new Promise<void>(resolve => {
          resolveInit = resolve;
        }),
      );
      vi.spyOn(battleAnims, "loadMoveAnimAssets").mockResolvedValue();
      const phase = new LoadMoveAnimPhase(MoveId.METRONOME);
      const end = watchPhase(phase);

      phase.start();
      vi.mocked(globalScene.phaseManager.getCurrentPhase).mockReturnValue({} as Phase);
      resolveInit?.();
      await flushPromises();

      expect(end).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("MoveAnimPhase", () => {
    it("recovers when starting a move animation throws", () => {
      const animationError = new Error("animation failed");
      const anim = {
        play: vi.fn(() => {
          throw animationError;
        }),
      } as unknown as MoveAnim;
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const phase = new MoveAnimPhase(anim);
      const end = watchPhase(phase);

      expect(() => phase.start()).not.toThrow();

      expect(consoleError).toHaveBeenCalledWith(
        "[Battle recovery] Move animation failed; continuing the battle.",
        animationError,
      );
      expect(end).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("times out a missing callback and ends exactly once if it arrives late", () => {
      let animationComplete: (() => void) | undefined;
      const anim = {
        play: vi.fn((_onSubstitute, callback) => {
          animationComplete = callback;
        }),
      } as unknown as MoveAnim;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const phase = new MoveAnimPhase(anim);
      const end = watchPhase(phase);

      phase.start();
      vi.advanceTimersByTime(MOVE_ANIM_PHASE_TIMEOUT_MS - 1);
      expect(end).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(end).toHaveBeenCalledOnce();

      animationComplete?.();
      expect(end).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("discards a stale animation callback without advancing the new current phase", () => {
      let animationComplete: (() => void) | undefined;
      const anim = {
        play: vi.fn((_onSubstitute, callback) => {
          animationComplete = callback;
        }),
      } as unknown as MoveAnim;
      const phase = new MoveAnimPhase(anim);
      const end = watchPhase(phase);

      phase.start();
      vi.mocked(globalScene.phaseManager.getCurrentPhase).mockReturnValue({} as Phase);
      animationComplete?.();

      expect(end).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("move execution phases", () => {
    it("applies charge semantics once when the charge animation callback is lost", () => {
      let animationComplete: (() => void) | undefined;
      vi.spyOn(battleAnims.MoveChargeAnim.prototype, "play").mockImplementation((_onSubstitute, callback) => {
        animationComplete = callback;
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const user = {
        id: 42,
        isPlayer: () => true,
        addTag: vi.fn(),
      } as unknown as Pokemon;
      const target = {} as Pokemon;
      const move = {
        id: MoveId.FLY,
        chargeAnim: ChargeAnim.FLY_CHARGING,
        chargeAttrs: [],
        isChargingMove: () => true,
        showChargeText: vi.fn(),
      } as unknown as ChargingMove;
      const moveWrapper = {
        moveId: MoveId.FLY,
        getMove: () => move,
      } as unknown as PokemonMove;
      const phase = new MoveChargePhase(BattlerIndex.PLAYER, BattlerIndex.ENEMY, moveWrapper, MoveUseMode.NORMAL);
      vi.spyOn(phase, "getUserPokemon").mockReturnValue(user);
      vi.spyOn(phase, "getTargetPokemon").mockReturnValue(target);
      const end = watchPhase(phase);

      phase.start();
      vi.advanceTimersByTime(BATTLE_ANIM_PHASE_TIMEOUT_MS);

      expect(move.showChargeText).toHaveBeenCalledOnce();
      expect(user.addTag).toHaveBeenCalledWith(BattlerTagType.CHARGING, 1, MoveId.FLY, user.id);
      expect(end).toHaveBeenCalledOnce();

      animationComplete?.();
      expect(move.showChargeText).toHaveBeenCalledOnce();
      expect(user.addTag).toHaveBeenCalledOnce();
      expect(end).toHaveBeenCalledOnce();
    });

    it("applies move effects once when a target animation callback is lost", () => {
      let animationComplete: (() => void) | undefined;
      vi.spyOn(battleAnims.MoveAnim.prototype, "play").mockImplementation((_onSubstitute, callback) => {
        animationComplete = callback;
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const user = {
        isPlayer: () => true,
        lapseTags: vi.fn(),
        turnData: { hitCount: 1, hitsLeft: 1 },
      } as unknown as Pokemon;
      const target = {
        getBattlerIndex: () => BattlerIndex.ENEMY,
      } as Pokemon;
      const move = {
        id: MoveId.TACKLE,
        attrs: [],
        moveTarget: MoveTarget.NEAR_ENEMY,
        getAttrs: () => [{ trigger: MoveEffectTrigger.POST_TARGET }],
        hitsSubstitute: () => false,
      } as unknown as Move;
      const phase = new MoveEffectPhase(BattlerIndex.PLAYER, [BattlerIndex.ENEMY], move, MoveUseMode.NORMAL);
      vi.spyOn(phase, "getUserPokemon").mockReturnValue(user);
      vi.spyOn(phase, "getTargets").mockReturnValue([target]);

      const phaseInternals = phase as unknown as {
        conductHitChecks: (user: Pokemon, fieldMove: boolean) => Pokemon[];
        postAnimCallback: (user: Pokemon, targets: Pokemon[]) => void;
      };
      vi.spyOn(phaseInternals, "conductHitChecks").mockReturnValue([target]);
      const postAnimCallback = vi.spyOn(phaseInternals, "postAnimCallback").mockImplementation(() => {});
      watchPhase(phase);

      const previousBattle = globalScene.currentBattle;
      globalScene.currentBattle = {
        lastPlayerInvolved: BattlerIndex.PLAYER,
        mysteryEncounter: undefined,
      } as unknown as typeof globalScene.currentBattle;

      try {
        phase.start();
        vi.advanceTimersByTime(BATTLE_ANIM_PHASE_TIMEOUT_MS);

        expect(postAnimCallback).toHaveBeenCalledOnce();
        expect(postAnimCallback).toHaveBeenCalledWith(user, [target]);

        animationComplete?.();
        expect(postAnimCallback).toHaveBeenCalledOnce();
      } finally {
        globalScene.currentBattle = previousBattle;
      }
    });
  });
});

/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  calculateMoveExecution,
  type LearnedMoveProfile,
  normalizeMoveAccuracy,
  planLearnMoveReplacement,
  scoreDamagingMove,
  scoreLearnedMove,
  scoreLearnedMoveset,
} from "#app/autoplay-battle-evaluator";
import {
  AutoplayController,
  coerceNotificationSettings,
  coerceSaveSlotRotation,
  coerceSessionStats,
  coerceStopRules,
  combineMoveBenefitScores,
  DEFAULT_AUTOPLAY_STARTER_IDS,
  DEFAULT_SAVE_SLOT_ROTATION,
  findNextEmptySaveSlot,
  getFightCursor,
  hasReachedCompletedRunLimit,
  isAutoplayAvoidedRewardType,
  isAutoplaySupportedPartyMode,
  isEligibleReserve,
  isExpectedStarterAddOption,
  isFullPartyDiscardConfirmation,
  isSafeOptionSelectContext,
  planAutoplayConfirmation,
  planClassicStarterSelection,
  planModifierSelection,
  planStarterFlowTransition,
  planSwitchAttempt,
  planTitleSelection,
  resolveAutoplayTemplate,
  resolveSwitchAttempt,
  scoreDamageForTargetSide,
  scoreLegalMoveTargets,
  shouldHandleAutoplayHotkey,
  shouldScoreMoveAsFailure,
  summarizeMoveTargetScores,
} from "#app/autoplay-controller";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { allMysteryEncounters, initMysteryEncounters } from "#data/mystery-encounters/mystery-encounter-biomes";
import { MoveCategory } from "#enums/move-category";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PokemonType } from "#enums/pokemon-type";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { MysteryEncounterAutoplayPolicy } from "#mystery-encounters/mystery-encounter-option";
import type { LearnMovePhase } from "#phases/learn-move-phase";
import {
  findFirstAutoplaySafeMysteryOptionIndex,
  findFirstEnabledMysteryOptionIndex,
} from "#ui/mystery-encounter-ui-handler";
import type { SummaryUiHandler } from "#ui/summary-ui-handler";
import { describe, expect, it, vi } from "vitest";

describe("Autoplay controller policies", () => {
  describe("battle scoring", () => {
    it("treats the always-hit accuracy sentinel as 100 percent", () => {
      expect(normalizeMoveAccuracy(-1)).toBe(1);
      expect(normalizeMoveAccuracy(50)).toBe(0.5);
      expect(normalizeMoveAccuracy(0)).toBe(0);
    });

    it("reverses target benefit scores for opposing targets", () => {
      expect(combineMoveBenefitScores(3, -10, false)).toBe(13);
      expect(combineMoveBenefitScores(3, 10, false)).toBe(-7);
      expect(combineMoveBenefitScores(3, 10, true)).toBe(13);
    });

    it("rejects known failures and weather or terrain cancellations", () => {
      const baseInput = {
        conditionsMet: true,
        isConditionallyUsable: false,
        isUnimplemented: false,
        terrainCancelled: false,
        weatherCancelled: false,
      };

      expect(shouldScoreMoveAsFailure(baseInput)).toBe(false);
      expect(shouldScoreMoveAsFailure({ ...baseInput, conditionsMet: false })).toBe(true);
      expect(shouldScoreMoveAsFailure({ ...baseInput, conditionsMet: false, isConditionallyUsable: true })).toBe(false);
      expect(shouldScoreMoveAsFailure({ ...baseInput, weatherCancelled: true })).toBe(true);
      expect(shouldScoreMoveAsFailure({ ...baseInput, terrainCancelled: true })).toBe(true);
    });

    it("keeps zero-damage forecasts at the failure score and gives always-hit moves full accuracy", () => {
      const baseInput = {
        accuracy: -1,
        actsBeforeThreat: true,
        expectedDamage: 80,
        incomingDamage: 0,
        isDelayed: false,
        priority: 0,
        removesThreat: false,
        secondaryBenefit: 0,
        successfulDamage: 80,
        targetHp: 100,
        userHp: 100,
      };

      expect(scoreDamagingMove({ ...baseInput, expectedDamage: 0, successfulDamage: 0 })).toBe(-20);
      expect(scoreDamagingMove(baseInput)).toBe(scoreDamagingMove({ ...baseInput, accuracy: 100 }));
      expect(scoreDamagingMove(baseInput)).toBeGreaterThan(
        scoreDamagingMove({ ...baseInput, accuracy: 50, expectedDamage: 40 }),
      );
    });

    it("uses native forecast damage so type, level, and physical-special stats decide the move", () => {
      const baseInput = {
        accuracy: 100,
        actsBeforeThreat: true,
        incomingDamage: 0,
        isDelayed: false,
        priority: 0,
        removesThreat: false,
        secondaryBenefit: 0,
        targetHp: 120,
        userHp: 100,
      };

      const basicNeutral = scoreDamagingMove({
        ...baseInput,
        expectedDamage: 34,
        successfulDamage: 34,
      });
      const typedCounter = scoreDamagingMove({
        ...baseInput,
        expectedDamage: 82,
        successfulDamage: 82,
      });
      expect(typedCounter).toBeGreaterThan(basicNeutral);

      const weakSpecialForecast = scoreDamagingMove({
        ...baseInput,
        expectedDamage: 25,
        successfulDamage: 25,
      });
      const physicalForecast = scoreDamagingMove({
        ...baseInput,
        expectedDamage: 60,
        successfulDamage: 60,
      });
      expect(physicalForecast).toBeGreaterThan(weakSpecialForecast);
    });

    it("models multi-hit throughput, accuracy, and charge or recharge commitment", () => {
      expect(
        calculateMoveExecution({
          baseAccuracy: 100,
          basePower: 25,
          battleAccuracy: 100,
          effectivePower: 75,
          turnCost: 1,
        }),
      ).toEqual({ expectedMultiplier: 3, hitChance: 1, successfulMultiplier: 3 });
      expect(
        calculateMoveExecution({
          baseAccuracy: 80,
          basePower: 100,
          battleAccuracy: 100,
          effectivePower: 40,
          turnCost: 2,
        }),
      ).toEqual({ expectedMultiplier: 0.5, hitChance: 1, successfulMultiplier: 1 });
    });

    it("prefers a priority KO when the predicted opponent attack would otherwise KO first", () => {
      const threatenedInput = {
        accuracy: 100,
        actsBeforeThreat: true,
        expectedDamage: 100,
        incomingDamage: 120,
        isDelayed: false,
        removesThreat: true,
        secondaryBenefit: 0,
        successfulDamage: 100,
        targetHp: 90,
        userHp: 100,
      };
      const priorityKo = scoreDamagingMove({ ...threatenedInput, priority: 1 });
      const tooSlowKo = scoreDamagingMove({ ...threatenedInput, actsBeforeThreat: false, priority: 0 });
      expect(priorityKo).toBeGreaterThan(tooSlowKo);
    });

    it("selects a real exhausted move so CommandPhase substitutes Struggle", () => {
      expect(getFightCursor(-1, 4)).toBe(0);
      expect(getFightCursor(2, 4)).toBe(2);
      expect(getFightCursor(-1, 0)).toBe(-1);
    });

    it("uses the best legal single target but totals spread damage and friendly fire", () => {
      expect(scoreDamageForTargetSide(80, false)).toBe(80);
      expect(scoreDamageForTargetSide(80, true)).toBe(-80);
      expect(
        summarizeMoveTargetScores(
          [
            { score: 10, targetIndex: 2 },
            { score: 30, targetIndex: 3 },
          ],
          false,
        ),
      ).toEqual({ score: 30, targetIndex: 3 });
      expect(
        summarizeMoveTargetScores(
          [
            { score: 100, targetIndex: 2 },
            { score: -80, targetIndex: 1 },
          ],
          true,
        ),
      ).toEqual({ score: 20, targetIndex: undefined });
      expect(summarizeMoveTargetScores([], false)).toEqual({ score: -20, targetIndex: undefined });
    });

    it("evaluates only indexes supplied by the native legal-target set", () => {
      const evaluated: number[] = [];
      const result = scoreLegalMoveTargets([0, 2], false, targetIndex => {
        evaluated.push(targetIndex);
        return targetIndex === 0 ? 5 : 25;
      });

      expect(evaluated).toEqual([0, 2]);
      expect(result).toEqual({ score: 25, targetIndex: 2 });
    });
  });

  describe("level-up move learning", () => {
    const moveProfile = (overrides: Partial<LearnedMoveProfile> = {}): LearnedMoveProfile => ({
      category: MoveCategory.PHYSICAL,
      hasStab: false,
      id: 1,
      isUnimplemented: false,
      moveType: PokemonType.NORMAL,
      offensiveStatRatio: 1,
      power: 40,
      pp: 20,
      priority: 0,
      utility: 0,
      ...overrides,
    });

    it("replaces the weakest basic move with a stronger level-up attack", () => {
      const current = [
        moveProfile({ id: 1, power: 40 }),
        moveProfile({ category: MoveCategory.STATUS, id: 2, power: 0, utility: 12 }),
        moveProfile({ hasStab: true, id: 3, moveType: PokemonType.FIRE, power: 40 }),
        moveProfile({ id: 4, power: 20 }),
      ];
      const flamethrower = moveProfile({ hasStab: true, id: 5, moveType: PokemonType.FIRE, power: 90 });

      expect(planLearnMoveReplacement(current, flamethrower)).toEqual({ index: 3, kind: "REPLACE" });
      expect(scoreLearnedMove(flamethrower)).toBeGreaterThan(scoreLearnedMove(current[3]));
    });

    it("values new coverage and rejects weaker redundant moves", () => {
      const current = [
        moveProfile({ hasStab: true, id: 1, moveType: PokemonType.WATER, power: 40 }),
        moveProfile({ hasStab: true, id: 2, moveType: PokemonType.WATER, power: 40, utility: 1 }),
        moveProfile({ id: 3, power: 50 }),
        moveProfile({ category: MoveCategory.STATUS, id: 4, power: 0, utility: 20 }),
      ];
      const bite = moveProfile({ id: 5, moveType: PokemonType.DARK, power: 60 });
      const weakerWaterMove = moveProfile({ hasStab: true, id: 6, moveType: PokemonType.WATER, power: 25 });

      expect(planLearnMoveReplacement(current, bite)).toEqual({ index: 0, kind: "REPLACE" });
      expect(planLearnMoveReplacement(current, weakerWaterMove)).toEqual({ kind: "REJECT" });
      expect(scoreLearnedMoveset([...current.slice(1), bite])).toBeGreaterThan(scoreLearnedMoveset(current));
    });

    it("never turns the moveset into an all-status set", () => {
      const onlyAttack = moveProfile({ hasStab: true, id: 1, power: 50 });
      const current = [
        onlyAttack,
        moveProfile({ category: MoveCategory.STATUS, id: 2, power: 0, utility: 30 }),
        moveProfile({ category: MoveCategory.STATUS, id: 3, power: 0, utility: 30 }),
        moveProfile({ category: MoveCategory.STATUS, id: 4, power: 0, utility: 30 }),
      ];
      const statusMove = moveProfile({ category: MoveCategory.STATUS, id: 5, power: 0, utility: 100 });

      expect(planLearnMoveReplacement(current, statusMove)).not.toEqual({ index: 0, kind: "REPLACE" });
    });
  });

  describe("battle navigation", () => {
    it("distinguishes a legal bench reserve from on-field and fainted Pokemon", () => {
      const pokemonState = (alive: boolean, onField: boolean): Pick<Pokemon, "isActive"> =>
        ({
          isActive: ((fieldOnly = false) => (fieldOnly ? onField : alive)) as Pokemon["isActive"],
        }) satisfies Pick<Pokemon, "isActive">;

      expect(isEligibleReserve(pokemonState(true, false))).toBe(true);
      expect(isEligibleReserve(pokemonState(true, true))).toBe(false);
      expect(isEligibleReserve(pokemonState(false, false))).toBe(false);
    });

    it("returns after every switch attempt and suppresses exactly one retry after failure", () => {
      expect(planSwitchAttempt(false, 3)).toEqual({ kind: "ATTEMPT", switchIndex: 3 });
      expect(resolveSwitchAttempt(false)).toEqual({ returnImmediately: true, suppressNextSwitch: true });
      expect(planSwitchAttempt(true, 3)).toEqual({ kind: "FIGHT_WITHOUT_SWITCH" });
      expect(resolveSwitchAttempt(true)).toEqual({ returnImmediately: true, suppressNextSwitch: false });
      expect(planSwitchAttempt(false, null)).toEqual({ kind: "FIGHT" });
    });
  });

  describe("reward and option safety", () => {
    const potion = { modifierTypeOption: { type: { group: "healing", name: "Potion" } } };
    const voucher = { modifierTypeOption: { type: { group: "voucher", name: "Egg Voucher" } } };
    const lure = { ...potion, autoplayAvoid: true };

    it("enters the free row before rewards or Continue and never selects shop controls", () => {
      expect(planModifierSelection(0, 0, [])).toEqual({ kind: "SET_ROW", row: 1 });
      expect(planModifierSelection(0, 0, [potion, voucher])).toEqual({ kind: "SET_ROW", row: 1 });
      expect(planModifierSelection(1, 0, [])).toEqual({ kind: "ACTION" });
      expect(planModifierSelection(1, 0, [potion, voucher])).toEqual({ cursor: 1, kind: "SET_CURSOR" });
      expect(planModifierSelection(1, 1, [potion, voucher])).toEqual({ kind: "ACTION" });
      expect(planModifierSelection(1, 2, [potion])).toEqual({ cursor: 0, kind: "SET_CURSOR" });
    });

    it("skips a reward screen when every option needs an unsupported multi-step target", () => {
      const unsafe = { ...potion, autoplayUnsafe: true };
      expect(planModifierSelection(1, 0, [unsafe])).toEqual({ kind: "CANCEL" });
      expect(planModifierSelection(1, 0, [unsafe, voucher])).toEqual({ cursor: 1, kind: "SET_CURSOR" });
    });

    it("avoids Lures when another reward or Continue is available", () => {
      expect(isAutoplayAvoidedRewardType(modifierTypes.LURE())).toBe(true);
      expect(isAutoplayAvoidedRewardType(modifierTypes.SUPER_LURE())).toBe(true);
      expect(isAutoplayAvoidedRewardType(modifierTypes.MAX_LURE())).toBe(true);
      expect(isAutoplayAvoidedRewardType(modifierTypes.POTION())).toBe(false);
      expect(planModifierSelection(1, 0, [lure, potion])).toEqual({ cursor: 1, kind: "SET_CURSOR" });
      expect(planModifierSelection(1, 0, [lure])).toEqual({ kind: "CANCEL" });
    });

    it("allows only authorized or known-gameplay option menus", () => {
      expect(isSafeOptionSelectContext(UiMode.OPTION_SELECT, "SelectBiomePhase", false)).toBe(true);
      expect(isSafeOptionSelectContext(UiMode.OPTION_SELECT, "LoginPhase", false)).toBe(false);
      expect(isSafeOptionSelectContext(UiMode.OPTION_SELECT, "SelectStarterPhase", false)).toBe(false);
      expect(isSafeOptionSelectContext(UiMode.OPTION_SELECT, "TitlePhase", false)).toBe(false);
      expect(isSafeOptionSelectContext(UiMode.OPTION_SELECT, "TitlePhase", true)).toBe(true);
      expect(isSafeOptionSelectContext(UiMode.MENU_OPTION_SELECT, "TitlePhase", false)).toBe(false);
      expect(isSafeOptionSelectContext(UiMode.MENU_OPTION_SELECT, "TitlePhase", true)).toBe(true);
    });
  });

  describe("continuous Classic navigation", () => {
    it("builds the default Kanto trio one starter at a time and then submits", () => {
      let buildingDefaultTeam = false;
      for (let count = 0; count < DEFAULT_AUTOPLAY_STARTER_IDS.length; count++) {
        const plan = planClassicStarterSelection(DEFAULT_AUTOPLAY_STARTER_IDS.slice(0, count), buildingDefaultTeam);
        expect(plan).toEqual({ buildingDefaultTeam: true, cursor: count, kind: "SELECT_STARTER" });
        buildingDefaultTeam = plan.buildingDefaultTeam;
      }

      expect(planClassicStarterSelection(DEFAULT_AUTOPLAY_STARTER_IDS, buildingDefaultTeam)).toEqual({
        buildingDefaultTeam: true,
        kind: "SUBMIT_TEAM",
      });
    });

    it("preserves a manually prepared non-default partial team", () => {
      expect(planClassicStarterSelection([25], false)).toEqual({
        buildingDefaultTeam: false,
        kind: "SUBMIT_TEAM",
      });
    });

    it("authorizes only the exact starter option opened by the planner", () => {
      expect(
        isExpectedStarterAddOption("SelectStarterPhase", "ADD_DEFAULT_STARTER", "Add to Party", "Add to Party"),
      ).toBe(true);
      expect(
        isExpectedStarterAddOption("SelectStarterPhase", "ADD_DEFAULT_STARTER", "Use Candies", "Add to Party"),
      ).toBe(false);
      expect(isExpectedStarterAddOption("LoginPhase", "ADD_DEFAULT_STARTER", "Add to Party", "Add to Party")).toBe(
        false,
      );
      expect(isExpectedStarterAddOption("SelectStarterPhase", null, "Add to Party", "Add to Party")).toBe(false);
    });

    it("resumes a saved run and authorizes the Classic menu only for New Game", () => {
      expect(planTitleSelection(true)).toEqual({ authorizeGameModeOption: false, cursor: 0 });
      expect(planTitleSelection(false)).toEqual({ authorizeGameModeOption: true, cursor: 0 });
    });

    it("has an explicit safe action for every gameplay confirmation phase", () => {
      expect(planAutoplayConfirmation("SelectStarterPhase", true)).toBe("ACTION");
      expect(planAutoplayConfirmation("SelectStarterPhase", false)).toBe("PAUSE");
      expect(planAutoplayConfirmation("EggLapsePhase", false)).toBe("ACTION");
      expect(planAutoplayConfirmation("LearnMovePhase", false)).toBe("ACTION");
      expect(planAutoplayConfirmation("SelectModifierPhase", false)).toBe("ACTION");
      expect(planAutoplayConfirmation("AttemptCapturePhase", false)).toBe("CANCEL");
      expect(planAutoplayConfirmation("CheckSwitchPhase", false)).toBe("CANCEL");
      expect(planAutoplayConfirmation("EvolutionPhase", false)).toBe("CANCEL");
      expect(planAutoplayConfirmation("FormChangePhase", false)).toBe("CANCEL");
      expect(planAutoplayConfirmation("GameOverPhase", false)).toBe("CANCEL");
      expect(planAutoplayConfirmation("ScanIvsPhase", false)).toBe("CANCEL");
      expect(planAutoplayConfirmation("AccountPhase", false)).toBe("PAUSE");
    });

    it("retries a transient move-learning UI failure and submits the choice only once", () => {
      const controller = Object.create(AutoplayController.prototype) as {
        learnMoveSelectionSubmitted: boolean;
        pendingLearnMovePhase: LearnMovePhase | null;
        pendingLearnMoveSelectionStartedAt: number;
        pauseForSafety: (reason: string) => void;
        submitLearnMoveSelectionOnce: (phase: LearnMovePhase, handler: SummaryUiHandler, selectedIndex: number) => void;
      };
      const phase = {} as LearnMovePhase;
      const nextPhase = {} as LearnMovePhase;
      const selectMoveForLearning = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
      const handler = { selectMoveForLearning } as unknown as SummaryUiHandler;
      const pauseForSafety = vi.fn();
      controller.pendingLearnMovePhase = null;
      controller.pendingLearnMoveSelectionStartedAt = 0;
      controller.learnMoveSelectionSubmitted = false;
      controller.pauseForSafety = pauseForSafety;
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);

      try {
        controller.submitLearnMoveSelectionOnce(phase, handler, 2);
        controller.submitLearnMoveSelectionOnce(phase, handler, 2);
        controller.submitLearnMoveSelectionOnce(phase, handler, 2);

        expect(selectMoveForLearning).toHaveBeenCalledTimes(2);
        expect(selectMoveForLearning).toHaveBeenNthCalledWith(1, 2);
        expect(selectMoveForLearning).toHaveBeenNthCalledWith(2, 2);
        expect(pauseForSafety).not.toHaveBeenCalled();

        now.mockReturnValue(20_000);
        controller.submitLearnMoveSelectionOnce(phase, handler, 2);
        expect(selectMoveForLearning).toHaveBeenCalledTimes(2);
        expect(pauseForSafety).not.toHaveBeenCalled();

        controller.submitLearnMoveSelectionOnce(nextPhase, handler, 1);
        expect(selectMoveForLearning).toHaveBeenCalledTimes(3);
        expect(selectMoveForLearning).toHaveBeenLastCalledWith(1);
      } finally {
        now.mockRestore();
      }
    });

    it("pauses only after a move-learning selection remains busy for ten seconds", () => {
      const controller = Object.create(AutoplayController.prototype) as {
        learnMoveSelectionSubmitted: boolean;
        pendingLearnMovePhase: LearnMovePhase | null;
        pendingLearnMoveSelectionStartedAt: number;
        pauseForSafety: (reason: string) => void;
        submitLearnMoveSelectionOnce: (phase: LearnMovePhase, handler: SummaryUiHandler, selectedIndex: number) => void;
      };
      const phase = {} as LearnMovePhase;
      const selectMoveForLearning = vi.fn().mockReturnValue(false);
      const handler = { selectMoveForLearning } as unknown as SummaryUiHandler;
      const pauseForSafety = vi.fn();
      controller.pendingLearnMovePhase = null;
      controller.pendingLearnMoveSelectionStartedAt = 0;
      controller.learnMoveSelectionSubmitted = false;
      controller.pauseForSafety = pauseForSafety;
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);

      try {
        controller.submitLearnMoveSelectionOnce(phase, handler, 0);
        expect(pauseForSafety).not.toHaveBeenCalled();
        now.mockReturnValue(11_000);
        controller.submitLearnMoveSelectionOnce(phase, handler, 0);
        expect(selectMoveForLearning).toHaveBeenCalledTimes(1);
        expect(pauseForSafety).toHaveBeenCalledWith("MOVE LEARNING SELECTION TIMED OUT");
      } finally {
        now.mockRestore();
      }
    });

    it("declines only the exact full-party mystery gift prompt", () => {
      const labels = ["Summary", "Pokedex", "Yes", "No"];
      expect(isFullPartyDiscardConfirmation("MysteryEncounterOptionSelectedPhase", labels, labels)).toBe(true);
      expect(isFullPartyDiscardConfirmation("MysteryEncounterOptionSelectedPhase", ["Yes", "No"], labels)).toBe(false);
      expect(isFullPartyDiscardConfirmation("AccountPhase", labels, labels)).toBe(false);
    });

    it("consumes starter submission and confirmation authorization exactly once", () => {
      let intent: Parameters<typeof planStarterFlowTransition>[0] = null;

      const submit = planStarterFlowTransition(intent, "SUBMIT_TEAM");
      expect(submit).toEqual({ kind: "SUBMIT", nextIntent: "CONFIRM_STARTER_TEAM" });
      intent = submit.nextIntent;

      expect(planStarterFlowTransition(intent, "SUBMIT_TEAM")).toEqual({
        kind: "WAIT",
        nextIntent: "CONFIRM_STARTER_TEAM",
      });
      expect(planStarterFlowTransition(intent, "STARTER_SELECT")).toEqual({
        kind: "WAIT",
        nextIntent: "CONFIRM_STARTER_TEAM",
      });

      const confirm = planStarterFlowTransition(intent, "CONFIRM");
      expect(confirm).toEqual({ kind: "ACTION", nextIntent: "AWAIT_SAVE_SLOT" });
      intent = confirm.nextIntent;

      expect(planStarterFlowTransition(intent, "CONFIRM")).toEqual({
        kind: "WAIT",
        nextIntent: "AWAIT_SAVE_SLOT",
      });
      expect(planStarterFlowTransition(intent, "STARTER_SELECT")).toEqual({
        kind: "WAIT",
        nextIntent: "AWAIT_SAVE_SLOT",
      });

      const saveSlot = planStarterFlowTransition(intent, "SAVE_SLOT");
      expect(saveSlot).toEqual({ kind: "CONTINUE", nextIntent: null });
      intent = saveSlot.nextIntent;
      expect(intent).toBeNull();
    });

    it("never authorizes an unsolicited starter confirmation", () => {
      expect(planStarterFlowTransition(null, "CONFIRM")).toEqual({ kind: "PAUSE", nextIntent: null });
      expect(planStarterFlowTransition("ADD_DEFAULT_STARTER", "CONFIRM")).toEqual({
        kind: "PAUSE",
        nextIntent: "ADD_DEFAULT_STARTER",
      });
    });

    it("clears starter authorization before inspecting save slots", () => {
      const previousScene = globalScene;
      const controller = Object.create(AutoplayController.prototype) as {
        handleSaveSlotMode: () => void;
        pendingStarterIntent: Parameters<typeof planStarterFlowTransition>[0];
        pendingStarterIntentStartedAt: number;
      };
      controller.pendingStarterIntent = "AWAIT_SAVE_SLOT";
      controller.pendingStarterIntentStartedAt = 123;

      let intentSeenBySlotHandler = "not-called";
      let startedAtSeenBySlotHandler = -1;
      initGlobalScene({
        ui: {
          getHandler: () => {
            intentSeenBySlotHandler = controller.pendingStarterIntent ?? "cleared";
            startedAtSeenBySlotHandler = controller.pendingStarterIntentStartedAt;
          },
        },
      } as Parameters<typeof initGlobalScene>[0]);

      try {
        controller.handleSaveSlotMode();
      } finally {
        initGlobalScene(previousScene);
      }

      expect(intentSeenBySlotHandler).toBe("cleared");
      expect(startedAtSeenBySlotHandler).toBe(0);
    });

    it("supports routine single-target reward and encounter party modes", () => {
      expect(isAutoplaySupportedPartyMode(PartyUiMode.MODIFIER)).toBe(true);
      expect(isAutoplaySupportedPartyMode(PartyUiMode.TM_MODIFIER)).toBe(true);
      expect(isAutoplaySupportedPartyMode(PartyUiMode.REMEMBER_MOVE_MODIFIER)).toBe(true);
      expect(isAutoplaySupportedPartyMode(PartyUiMode.SELECT)).toBe(true);
      expect(isAutoplaySupportedPartyMode(PartyUiMode.MOVE_MODIFIER)).toBe(false);
      expect(isAutoplaySupportedPartyMode(PartyUiMode.SPLICE)).toBe(false);
      expect(isAutoplaySupportedPartyMode(PartyUiMode.RELEASE)).toBe(false);
    });

    it("skips disabled mystery choices instead of looping on cursor zero", () => {
      expect(
        findFirstEnabledMysteryOptionIndex(
          [MysteryEncounterOptionMode.DISABLED_OR_DEFAULT, MysteryEncounterOptionMode.DEFAULT_OR_SPECIAL],
          [false, false],
        ),
      ).toBe(1);
      expect(
        findFirstEnabledMysteryOptionIndex(
          [MysteryEncounterOptionMode.DISABLED_OR_DEFAULT, MysteryEncounterOptionMode.DISABLED_OR_SPECIAL],
          [false, false],
        ),
      ).toBeNull();
    });

    it("selects only an enabled mystery choice explicitly reviewed for autoplay", () => {
      const modes = [MysteryEncounterOptionMode.DISABLED_OR_DEFAULT, MysteryEncounterOptionMode.DEFAULT];
      expect(
        findFirstAutoplaySafeMysteryOptionIndex(
          modes,
          [false, true],
          [MysteryEncounterAutoplayPolicy.SAFE, MysteryEncounterAutoplayPolicy.REQUIRE_REVIEW],
        ),
      ).toBeNull();
      expect(
        findFirstAutoplaySafeMysteryOptionIndex(
          modes,
          [false, true],
          [MysteryEncounterAutoplayPolicy.SAFE, MysteryEncounterAutoplayPolicy.SAFE],
        ),
      ).toBe(1);
    });

    it("defines at least one reviewed autoplay route for every mystery encounter", () => {
      initMysteryEncounters();
      const encounterTypes = Object.values(MysteryEncounterType).filter(
        (value): value is MysteryEncounterType => typeof value === "number",
      );
      const missingSafeRoute = encounterTypes.filter(encounterType =>
        allMysteryEncounters[encounterType].options.every(
          option => option.autoplayPolicy !== MysteryEncounterAutoplayPolicy.SAFE,
        ),
      );
      expect(missingSafeRoute).toEqual([]);
    });
  });

  describe("save-slot safety", () => {
    it("keeps rotation opt-in", () => {
      expect(DEFAULT_SAVE_SLOT_ROTATION.enabled).toBe(false);
    });

    it("only chooses slots confirmed to be empty and wraps from the preference", () => {
      expect(findNextEmptySaveSlot([true, undefined, false, true, false], 3)).toBe(4);
      expect(findNextEmptySaveSlot([true, undefined, false, true, true], 3)).toBe(2);
      expect(findNextEmptySaveSlot([true, undefined, true], 0)).toBeNull();
      expect(findNextEmptySaveSlot([true, true, true], 0)).toBeNull();
    });
  });

  describe("run stopping", () => {
    it("stops after the requested number of completed session runs", () => {
      expect(hasReachedCompletedRunLimit(1, 2)).toBe(false);
      expect(hasReachedCompletedRunLimit(2, 2)).toBe(true);
      expect(hasReachedCompletedRunLimit(100, 0)).toBe(false);
    });
  });

  describe("stored configuration", () => {
    it("uses FAST_FARM for fresh or unreadable profiles while preserving explicit choices", () => {
      expect(resolveAutoplayTemplate(null, null)).toBe("FAST_FARM");
      expect(resolveAutoplayTemplate(undefined, "AGGRESSIVE")).toBe("FAST_FARM");
      expect(resolveAutoplayTemplate(undefined, "SAFE")).toBe("SAFE_CLIMB");
      expect(resolveAutoplayTemplate("BOSS_PUSH", null)).toBe("BOSS_PUSH");
      expect(resolveAutoplayTemplate("not-valid", "not-valid")).toBe("FAST_FARM");
    });

    it("coerces null and malformed stop rules into safe values", () => {
      expect(coerceStopRules(null)).toEqual({
        enabled: false,
        stopAfterRuns: 0,
        targetSpeciesIds: [],
        waveRangeEnd: 0,
        waveRangeStart: 0,
      });
      expect(
        coerceStopRules({
          enabled: true,
          stopAfterRuns: 2.9,
          targetSpeciesIds: [25, "bad", 25, -1],
          waveRangeEnd: Number.POSITIVE_INFINITY,
          waveRangeStart: 10.8,
        }),
      ).toEqual({
        enabled: true,
        stopAfterRuns: 2,
        targetSpeciesIds: [25],
        waveRangeEnd: 0,
        waveRangeStart: 10,
      });
    });

    it("coerces rotation, notifications, and statistics without trusting stored types", () => {
      expect(coerceSaveSlotRotation({ enabled: "yes", nextSlot: 99 })).toEqual({ enabled: false, nextSlot: 0 });
      expect(coerceSaveSlotRotation({ enabled: true, nextSlot: 3.8 })).toEqual({ enabled: true, nextSlot: 3 });
      expect(coerceNotificationSettings({ browserNotifications: null, webhookUrl: null })).toEqual({
        browserNotifications: true,
        webhookUrl: "",
      });
      expect(coerceNotificationSettings({ browserNotifications: false, webhookUrl: " https://example.test " })).toEqual(
        {
          browserNotifications: false,
          webhookUrl: "https://example.test",
        },
      );
      expect(coerceSessionStats({ runsStarted: "bad", runsEnded: 2.7, wipes: null })).toEqual({
        runsStarted: 0,
        runsEnded: 2,
        wipes: 0,
        waveTotal: 0,
        totalAfkMs: 0,
      });
    });
  });

  describe("hotkeys", () => {
    it("ignores repeat events for both autoplay function keys", () => {
      expect(shouldHandleAutoplayHotkey({ code: "F8", repeat: false })).toBe(true);
      expect(shouldHandleAutoplayHotkey({ code: "F8", repeat: true })).toBe(false);
      expect(shouldHandleAutoplayHotkey({ code: "F9", repeat: false })).toBe(true);
      expect(shouldHandleAutoplayHotkey({ code: "F9", repeat: true })).toBe(false);
      expect(shouldHandleAutoplayHotkey({ code: "KeyA", repeat: false })).toBe(false);
    });
  });
});

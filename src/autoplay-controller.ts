import {
  calculateMoveExecution,
  type DamageMoveScoreInput,
  type LearnedMoveProfile,
  MOVE_FAILURE_SCORE,
  normalizeMoveAccuracy,
  planLearnMoveReplacement,
  scoreDamagingMove,
} from "#app/autoplay-battle-evaluator";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PartyUiMode } from "#enums/party-ui-mode";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import {
  DoubleBattleChanceBoosterModifierType,
  FusePokemonModifierType,
  PokemonMoveModifierType,
  RememberMoveModifierType,
  TmModifierType,
} from "#modifiers/modifier-type";
import type { Move } from "#moves/move";
import { getMoveTargets } from "#moves/move-utils";
import { CommandPhase } from "#phases/command-phase";
import { LearnMovePhase } from "#phases/learn-move-phase";
import type { BaseOptionSelectUiHandler } from "#ui/base-option-select-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import { SaveSlotUiMode } from "#ui/save-slot-select-ui-handler";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import { SummaryUiHandler } from "#ui/summary-ui-handler";
import type { UiHandler } from "#ui/ui-handler";
import i18next from "i18next";

const TOGGLE_KEY = "F8";
const TOGGLE_TEMPLATE_KEY = "F9";
const STORAGE_KEY = "pokerogue.afkAutoplay.enabled";
const LEGACY_PROFILE_STORAGE_KEY = "pokerogue.afkAutoplay.profile";
const TEMPLATE_STORAGE_KEY = "pokerogue.afkAutoplay.template";
const STATS_STORAGE_KEY = "pokerogue.afkAutoplay.stats";
const STOP_RULES_STORAGE_KEY = "pokerogue.afkAutoplay.stopRules";
const SAVE_SLOT_ROTATION_STORAGE_KEY = "pokerogue.afkAutoplay.saveSlotRotation";
const NOTIFICATION_STORAGE_KEY = "pokerogue.afkAutoplay.notifications";
const SAVE_SLOT_COUNT = 5;
const STARTER_TRANSITION_TIMEOUT_MS = 10_000;
const MYSTERY_OPTION_TIMEOUT_MS = 10_000;

export const DEFAULT_AUTOPLAY_STARTER_IDS = [SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE] as const;

const ONE_HIT_KO_MOVES = new Set<MoveId>([MoveId.GUILLOTINE, MoveId.HORN_DRILL, MoveId.FISSURE, MoveId.SHEER_COLD]);

const SELF_DESTRUCT_MOVES = new Set<MoveId>([
  MoveId.SELF_DESTRUCT,
  MoveId.EXPLOSION,
  MoveId.MIND_BLOWN,
  MoveId.MISTY_EXPLOSION,
]);

const TARGET_HALF_HP_MOVES = new Set<MoveId>([MoveId.SUPER_FANG, MoveId.NATURES_MADNESS, MoveId.RUINATION]);

export type AfkTemplateName = "FAST_FARM" | "SAFE_CLIMB" | "BOSS_PUSH";

export type PendingStarterIntent = "ADD_DEFAULT_STARTER" | "CONFIRM_STARTER_TEAM" | "AWAIT_SAVE_SLOT";

export type StarterFlowEvent = "SUBMIT_TEAM" | "CONFIRM" | "STARTER_SELECT" | "SAVE_SLOT";

export interface StarterFlowTransition {
  kind: "ACTION" | "CONTINUE" | "PAUSE" | "SUBMIT" | "WAIT";
  nextIntent: PendingStarterIntent | null;
}

interface AfkTemplateSettings {
  actionDelayMs: number;
  switchMinImprovementRatio: number;
  lowHpRatio: number;
  criticalHpRatio: number;
  moveScoreSwitchFloor: number;
  lowPpMultiplier: number;
  autoPauseOnShiny: boolean;
}

interface AfkSessionStats {
  runsStarted: number;
  runsEnded: number;
  wipes: number;
  waveTotal: number;
  totalAfkMs: number;
}

interface AfkStopRules {
  enabled: boolean;
  stopAfterRuns: number;
  waveRangeStart: number;
  waveRangeEnd: number;
  targetSpeciesIds: number[];
}

interface SaveSlotRotationSettings {
  enabled: boolean;
  nextSlot: number;
}

interface AfkNotificationSettings {
  browserNotifications: boolean;
  webhookUrl: string;
}

const TEMPLATE_ORDER: AfkTemplateName[] = ["FAST_FARM", "SAFE_CLIMB", "BOSS_PUSH"];

const AFK_TEMPLATE_SETTINGS: Record<AfkTemplateName, AfkTemplateSettings> = {
  FAST_FARM: {
    actionDelayMs: 170,
    switchMinImprovementRatio: 1.4,
    lowHpRatio: 0.18,
    criticalHpRatio: 0.1,
    moveScoreSwitchFloor: 35,
    lowPpMultiplier: 0.95,
    autoPauseOnShiny: false,
  },
  SAFE_CLIMB: {
    actionDelayMs: 320,
    switchMinImprovementRatio: 1.12,
    lowHpRatio: 0.5,
    criticalHpRatio: 0.32,
    moveScoreSwitchFloor: 72,
    lowPpMultiplier: 0.78,
    autoPauseOnShiny: true,
  },
  BOSS_PUSH: {
    actionDelayMs: 250,
    switchMinImprovementRatio: 1.1,
    lowHpRatio: 0.4,
    criticalHpRatio: 0.24,
    moveScoreSwitchFloor: 60,
    lowPpMultiplier: 0.85,
    autoPauseOnShiny: true,
  },
};

const DEFAULT_STATS: AfkSessionStats = {
  runsStarted: 0,
  runsEnded: 0,
  wipes: 0,
  waveTotal: 0,
  totalAfkMs: 0,
};

const DEFAULT_STOP_RULES: AfkStopRules = {
  enabled: false,
  stopAfterRuns: 0,
  waveRangeStart: 0,
  waveRangeEnd: 0,
  targetSpeciesIds: [],
};

export const DEFAULT_SAVE_SLOT_ROTATION: SaveSlotRotationSettings = {
  enabled: false,
  nextSlot: 0,
};

const DEFAULT_NOTIFICATIONS: AfkNotificationSettings = {
  browserNotifications: true,
  webhookUrl: "",
};

interface MoveChoice {
  index: number;
  score: number;
  targetIndex: number | undefined;
}

interface SwitchChoice {
  index: number;
  score: number;
}

interface ModifierOptionLike {
  autoplayAvoid?: boolean;
  autoplayUnsafe?: boolean;
  modifierTypeOption?: {
    type?: object & {
      name?: string;
      group?: string;
    };
  };
}

interface MoveFailureInput {
  conditionsMet: boolean;
  isConditionallyUsable: boolean;
  isUnimplemented: boolean;
  terrainCancelled: boolean;
  weatherCancelled: boolean;
}

interface ScoredMoveTarget {
  score: number;
  targetIndex: number;
}

interface MoveTargetScoreSummary {
  score: number;
  targetIndex: number | undefined;
}

interface IncomingThreat {
  damage: number;
  priority: number;
  source: Pokemon | null;
}

interface IncomingMoveCandidate {
  move: Move;
  queued: boolean;
  targets: readonly BattlerIndex[];
}

export type ModifierSelectionPlan =
  | { kind: "ACTION" }
  | { kind: "CANCEL" }
  | { cursor: number; kind: "SET_CURSOR" }
  | { kind: "SET_ROW"; row: 1 };

export type ClassicStarterSelectionPlan =
  | { buildingDefaultTeam: true; cursor: number; kind: "SELECT_STARTER" }
  | { buildingDefaultTeam: boolean; kind: "SUBMIT_TEAM" };

export type AutoplayConfirmAction = "ACTION" | "CANCEL" | "PAUSE";

export interface TitleSelectionPlan {
  authorizeGameModeOption: boolean;
  cursor: 0;
}

export type SwitchAttemptPlan =
  | { kind: "ATTEMPT"; switchIndex: number }
  | { kind: "FIGHT" }
  | { kind: "FIGHT_WITHOUT_SWITCH" };

export interface SwitchAttemptOutcome {
  returnImmediately: true;
  suppressNextSwitch: boolean;
}

/**
 * Combines native move benefit scores from the player's perspective.
 * A negative target score harms the target, so it benefits us only when the target is an opponent.
 */
export function combineMoveBenefitScores(userBenefit: number, targetBenefit: number, targetIsAlly: boolean): number {
  return userBenefit + targetBenefit * (targetIsAlly ? 1 : -1);
}

/** Returns whether a move is already known to fail before damage is estimated. */
export function shouldScoreMoveAsFailure(input: MoveFailureInput): boolean {
  return (
    input.isUnimplemented
    || (input.conditionsMet === false && input.isConditionallyUsable === false)
    || input.weatherCancelled
    || input.terrainCancelled
  );
}

/** Finds a confirmed-empty slot, starting at `preferredStart` and wrapping once. */
export function findNextEmptySaveSlot(
  slotHasData: readonly (boolean | undefined)[],
  preferredStart: number,
): number | null {
  if (slotHasData.length === 0) {
    return null;
  }

  const normalizedStart = ((preferredStart % slotHasData.length) + slotHasData.length) % slotHasData.length;
  for (let offset = 0; offset < slotHasData.length; offset++) {
    const slotIndex = (normalizedStart + offset) % slotHasData.length;
    if (slotHasData[slotIndex] === false) {
      return slotIndex;
    }
  }
  return null;
}

/** Stop limits apply to completed runs in the current autoplay session, not lifetime statistics. */
export function hasReachedCompletedRunLimit(completedRuns: number, stopAfterRuns: number): boolean {
  return stopAfterRuns > 0 && completedRuns >= stopAfterRuns;
}

/** Lures create extra double battles, so unattended farming skips them in favor of another reward or Continue. */
export function isAutoplayAvoidedRewardType(type: object | undefined): boolean {
  return type instanceof DoubleBattleChanceBoosterModifierType;
}

/** Selecting an unusable real move lets CommandPhase correctly substitute Struggle. */
export function getFightCursor(moveIndex: number, movesetLength: number): number {
  return moveIndex >= 0 ? moveIndex : movesetLength > 0 ? 0 : -1;
}

/** Damaging an ally is a penalty; an immune ally contributes neither damage nor a false benefit. */
export function scoreDamageForTargetSide(damageScore: number, targetIsAlly: boolean): number {
  return targetIsAlly ? -damageScore : damageScore;
}

/**
 * Single-target moves use their best legal target. Spread moves sum every legal target so friendly fire is accounted for.
 */
export function summarizeMoveTargetScores(
  targetScores: readonly ScoredMoveTarget[],
  multiple: boolean,
): MoveTargetScoreSummary {
  if (targetScores.length === 0) {
    return { score: MOVE_FAILURE_SCORE, targetIndex: undefined };
  }

  if (multiple) {
    return {
      score: targetScores.reduce((total, target) => total + target.score, 0),
      targetIndex: undefined,
    };
  }

  return targetScores.reduce((best, target) => (target.score > best.score ? target : best));
}

/** Evaluates only target indexes returned by the native move-target resolver. */
export function scoreLegalMoveTargets(
  legalTargetIndexes: readonly number[],
  multiple: boolean,
  scoreTarget: (targetIndex: number) => number | undefined,
): MoveTargetScoreSummary {
  const targetScores: ScoredMoveTarget[] = [];
  for (const targetIndex of legalTargetIndexes) {
    const score = scoreTarget(targetIndex);
    if (score != null) {
      targetScores.push({ score, targetIndex });
    }
  }
  return summarizeMoveTargetScores(targetScores, multiple);
}

/** Always enters the free-reward row before selecting a reward or the no-reward Continue button. */
export function planModifierSelection(
  rowCursor: number | undefined,
  cursor: number | undefined,
  rewardOptions: readonly ModifierOptionLike[],
): ModifierSelectionPlan {
  if (rowCursor !== 1) {
    return { kind: "SET_ROW", row: 1 };
  }

  if (rewardOptions.length === 0) {
    return { kind: "ACTION" };
  }

  const supportedIndexes = rewardOptions
    .map((option, index) => (option.autoplayUnsafe || option.autoplayAvoid ? -1 : index))
    .filter(index => index >= 0);
  if (supportedIndexes.length === 0) {
    return { kind: "CANCEL" };
  }

  const preferredIndex =
    supportedIndexes.find(index => {
      const option = rewardOptions[index];
      const type = option.modifierTypeOption?.type;
      const group = type?.group?.toLowerCase() ?? "";
      const name = type?.name?.toLowerCase() ?? "";
      return group === "voucher" || name.includes("voucher") || name.includes("egg");
    }) ?? supportedIndexes[0];
  if (cursor !== preferredIndex) {
    return { cursor: preferredIndex, kind: "SET_CURSOR" };
  }
  return { kind: "ACTION" };
}

/** A failed switch consumes the current tick and suppresses exactly the next switch evaluation. */
export function planSwitchAttempt(suppressNextSwitch: boolean, switchIndex: number | null): SwitchAttemptPlan {
  if (suppressNextSwitch) {
    return { kind: "FIGHT_WITHOUT_SWITCH" };
  }
  if (switchIndex != null) {
    return { kind: "ATTEMPT", switchIndex };
  }
  return { kind: "FIGHT" };
}

export function resolveSwitchAttempt(switchAccepted: boolean): SwitchAttemptOutcome {
  return { returnImmediately: true, suppressNextSwitch: !switchAccepted };
}

const SAFE_GAMEPLAY_OPTION_PHASES = new Set(["MysteryEncounterPhase", "SelectBiomePhase", "SelectGenderPhase"]);

/** Arbitrary option menus may contain account, admin, deletion, or spending actions. */
export function isSafeOptionSelectContext(
  mode: UiMode.OPTION_SELECT | UiMode.MENU_OPTION_SELECT,
  phaseName: string | undefined,
  explicitlyAuthorized: boolean,
): boolean {
  if (explicitlyAuthorized) {
    return true;
  }
  return mode === UiMode.OPTION_SELECT && phaseName != null && SAFE_GAMEPLAY_OPTION_PHASES.has(phaseName);
}

/** Plans a deterministic Kanto starter trio while preserving a non-default manually prepared partial team. */
export function planClassicStarterSelection(
  partyStarterIds: readonly number[],
  buildingDefaultTeam: boolean,
): ClassicStarterSelectionPlan {
  const normalizedCount = Math.min(partyStarterIds.length, DEFAULT_AUTOPLAY_STARTER_IDS.length);
  const matchesDefaultPrefix = partyStarterIds.every(
    (starterId, index) => starterId === DEFAULT_AUTOPLAY_STARTER_IDS[index],
  );
  const shouldBuildDefaultTeam = buildingDefaultTeam || partyStarterIds.length === 0 || matchesDefaultPrefix;
  if (shouldBuildDefaultTeam && normalizedCount < 3) {
    return { buildingDefaultTeam: true, cursor: normalizedCount, kind: "SELECT_STARTER" };
  }
  return { buildingDefaultTeam: shouldBuildDefaultTeam, kind: "SUBMIT_TEAM" };
}

/**
 * Consumes the one-shot starter flow authorization while UI prompts animate
 * between starter selection, confirmation, and save-slot selection.
 */
export function planStarterFlowTransition(
  pendingIntent: PendingStarterIntent | null,
  event: StarterFlowEvent,
): StarterFlowTransition {
  switch (event) {
    case "SUBMIT_TEAM":
      return pendingIntent == null
        ? { kind: "SUBMIT", nextIntent: "CONFIRM_STARTER_TEAM" }
        : { kind: "WAIT", nextIntent: pendingIntent };
    case "CONFIRM":
      if (pendingIntent === "CONFIRM_STARTER_TEAM") {
        return { kind: "ACTION", nextIntent: "AWAIT_SAVE_SLOT" };
      }
      return pendingIntent === "AWAIT_SAVE_SLOT"
        ? { kind: "WAIT", nextIntent: pendingIntent }
        : { kind: "PAUSE", nextIntent: pendingIntent };
    case "STARTER_SELECT":
      return pendingIntent == null
        ? { kind: "CONTINUE", nextIntent: null }
        : { kind: "WAIT", nextIntent: pendingIntent };
    case "SAVE_SLOT":
      return { kind: "CONTINUE", nextIntent: null };
  }
}

/** Only the exact Add to Party option opened by the starter planner is authorized. */
export function isExpectedStarterAddOption(
  phaseName: string | undefined,
  pendingIntent: PendingStarterIntent | null,
  selectedLabel: string | undefined,
  expectedLabel: string,
): boolean {
  return (
    phaseName === "SelectStarterPhase" && pendingIntent === "ADD_DEFAULT_STARTER" && selectedLabel === expectedLabel
  );
}

/** Every confirmation currently used by a gameplay phase has an explicit unattended policy. */
export function planAutoplayConfirmation(
  phaseName: string | undefined,
  starterTeamAuthorized: boolean,
): AutoplayConfirmAction {
  switch (phaseName) {
    case "SelectStarterPhase":
      return starterTeamAuthorized ? "ACTION" : "PAUSE";
    case "EggLapsePhase":
    case "LearnMovePhase":
    case "SelectModifierPhase":
      return "ACTION";
    case "AttemptCapturePhase":
    case "CheckSwitchPhase":
    case "EvolutionPhase":
    case "GameOverPhase":
    case "ScanIvsPhase":
      return "CANCEL";
    default:
      return "PAUSE";
  }
}

/** Identifies the four-choice full-party prompt whose final option safely discards the new Pokemon. */
export function isFullPartyDiscardConfirmation(
  phaseName: string | undefined,
  optionLabels: readonly string[],
  expectedLabels: readonly string[],
): boolean {
  return (
    phaseName === "MysteryEncounterOptionSelectedPhase"
    && optionLabels.length === expectedLabels.length
    && optionLabels.every((label, index) => label === expectedLabels[index])
  );
}

/** Continue is first when a run exists; otherwise New Game is first and opens the Classic-mode menu. */
export function planTitleSelection(hasSavedRun: boolean): TitleSelectionPlan {
  return { authorizeGameModeOption: !hasSavedRun, cursor: 0 };
}

/** Existing valid choices are preserved; a fresh or unreadable profile starts in continuous mode. */
export function resolveAutoplayTemplate(storedTemplate: unknown, legacyProfile: unknown): AfkTemplateName {
  if (storedTemplate === "FAST_FARM" || storedTemplate === "SAFE_CLIMB" || storedTemplate === "BOSS_PUSH") {
    return storedTemplate;
  }
  if (legacyProfile === "SAFE") {
    return "SAFE_CLIMB";
  }
  if (legacyProfile === "AGGRESSIVE") {
    return "FAST_FARM";
  }
  return "FAST_FARM";
}

/** Party modes whose first filtered target and first contextual action are deterministic and non-destructive. */
export function isAutoplaySupportedPartyMode(mode: PartyUiMode): boolean {
  const supportedModes: readonly PartyUiMode[] = [
    PartyUiMode.SWITCH,
    PartyUiMode.FAINT_SWITCH,
    PartyUiMode.REVIVAL_BLESSING,
    PartyUiMode.MODIFIER,
    PartyUiMode.TM_MODIFIER,
    PartyUiMode.REMEMBER_MOVE_MODIFIER,
    PartyUiMode.SELECT,
  ];
  return supportedModes.includes(mode);
}

/** Repeated function-key events must not toggle autoplay twice or race through templates. */
export function shouldHandleAutoplayHotkey(event: Pick<KeyboardEvent, "code" | "repeat">): boolean {
  return (event.code === TOGGLE_KEY || event.code === TOGGLE_TEMPLATE_KEY) && !event.repeat;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export function coerceStopRules(value: unknown): AfkStopRules {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_STOP_RULES);
  }
  const speciesIds = Array.isArray(value.targetSpeciesIds)
    ? [...new Set(value.targetSpeciesIds.map(id => toNonNegativeInteger(id, -1)).filter(id => id > 0))]
    : [];
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_STOP_RULES.enabled,
    stopAfterRuns: toNonNegativeInteger(value.stopAfterRuns),
    waveRangeStart: toNonNegativeInteger(value.waveRangeStart),
    waveRangeEnd: toNonNegativeInteger(value.waveRangeEnd),
    targetSpeciesIds: speciesIds,
  };
}

export function coerceSaveSlotRotation(value: unknown): SaveSlotRotationSettings {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_SAVE_SLOT_ROTATION);
  }
  const storedSlot = toNonNegativeInteger(value.nextSlot, -1);
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SAVE_SLOT_ROTATION.enabled,
    nextSlot: storedSlot >= 0 && storedSlot < SAVE_SLOT_COUNT ? storedSlot : DEFAULT_SAVE_SLOT_ROTATION.nextSlot,
  };
}

export function coerceNotificationSettings(value: unknown): AfkNotificationSettings {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_NOTIFICATIONS);
  }
  return {
    browserNotifications:
      typeof value.browserNotifications === "boolean"
        ? value.browserNotifications
        : DEFAULT_NOTIFICATIONS.browserNotifications,
    webhookUrl: typeof value.webhookUrl === "string" ? value.webhookUrl.trim() : DEFAULT_NOTIFICATIONS.webhookUrl,
  };
}

export function coerceSessionStats(value: unknown): AfkSessionStats {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_STATS);
  }
  return {
    runsStarted: toNonNegativeInteger(value.runsStarted),
    runsEnded: toNonNegativeInteger(value.runsEnded),
    wipes: toNonNegativeInteger(value.wipes),
    waveTotal: toNonNegativeInteger(value.waveTotal),
    totalAfkMs: toNonNegativeInteger(value.totalAfkMs),
  };
}

/** A reserve must be battle-legal, alive, and not one of the Pokémon currently on the field. */
export function isEligibleReserve(pokemon: Pick<Pokemon, "isActive">): boolean {
  return pokemon.isActive() && !pokemon.isActive(true);
}

function getMoveLearningUtility(move: Move): number {
  let utility = 0;
  if (move.category === MoveCategory.STATUS) {
    utility += (normalizeMoveAccuracy(move.accuracy) - 1) * 20;
    if (move.hasAttr("HealAttr")) {
      utility += 28;
    }
    if (move.hasAttr("PartyStatusCureAttr")) {
      utility += 24;
    }
    if (move.hasAttr("StatusEffectAttr")) {
      utility += 14;
    }
    if (move.hasAttr("LeechSeedAttr")) {
      utility += 18;
    } else if (move.hasAttr("AddBattlerTagAttr") || move.hasAttr("ConfuseAttr")) {
      utility += 8;
    }
    if (move.hasAttr("StatStageChangeAttr")) {
      utility += 12;
    }
    if (move.hasAttr("ProtectAttr")) {
      utility += 8;
    }
    if (move.hasAttr("WeatherChangeAttr") || move.hasAttr("TerrainChangeAttr")) {
      utility += 4;
    }
  } else {
    if (move.chance > 0) {
      utility += Math.min(move.chance, 100) * 0.05;
    }
    if (move.hasAttr("HitHealAttr")) {
      utility += 10;
    }
    if (move.hasAttr("RecoilAttr")) {
      utility -= 8;
    }
    if (move.hasAttr("SacrificialAttr") || move.hasAttr("SacrificialAttrOnHit")) {
      utility -= 80;
    }
  }
  return utility;
}

function getMoveLearningPower(move: Move): number {
  if (move.category === MoveCategory.STATUS) {
    return 0;
  }

  const effectivePower = move.calculateEffectivePower();
  if (effectivePower > 0) {
    return effectivePower;
  }

  const hitChance = normalizeMoveAccuracy(move.accuracy);
  if (move.hasAttr("OneHitKOAttr")) {
    return 100 * hitChance;
  }
  if (move.hasAttr("FixedDamageAttr")) {
    return 70 * hitChance;
  }
  // Variable-power moves need a useful neutral estimate when there is no live target.
  return 55 * hitChance;
}

function createLearnedMoveProfile(pokemon: PlayerPokemon, move: Move): LearnedMoveProfile {
  const attack = pokemon.getStat(Stat.ATK, false);
  const specialAttack = pokemon.getStat(Stat.SPATK, false);
  const strongestOffense = Math.max(1, attack, specialAttack);
  const relevantOffense = move.category === MoveCategory.PHYSICAL ? attack : specialAttack;
  const moveType = pokemon.getMoveType(move);

  return {
    category: move.category,
    hasStab: pokemon.isOfType(moveType),
    id: move.id,
    isUnimplemented: move.isUnimplemented,
    moveType,
    offensiveStatRatio: move.category === MoveCategory.STATUS ? 1 : relevantOffense / strongestOffense,
    power: getMoveLearningPower(move),
    pp: move.pp,
    priority: move.priority,
    utility: getMoveLearningUtility(move),
  };
}

/**
 * Local-only AFK autoplay that drives the same phase/UI APIs as normal player input.
 *
 * It can be interrupted by any manual input and resumed with the toggle key.
 */
export class AutoplayController {
  private enabled = false;
  private template: AfkTemplateName = "FAST_FARM";
  private readonly stopRules: AfkStopRules;
  private readonly saveSlotRotation: SaveSlotRotationSettings;
  private readonly notificationSettings: AfkNotificationSettings;
  private stats: AfkSessionStats;
  private manualOverride = false;
  private statusNote = "";
  private nextActionAt = 0;
  private lastUpdateTime = 0;
  private lastStatsPersistAt = 0;
  private inRun = false;
  private currentRunMaxWave = 0;
  private currentRunOutcome: "victory" | "wipe" | null = null;
  private completedRunsThisSession = 0;
  private pendingTargetIndex: number | null = null;
  private suppressNextSwitchAttempt = false;
  private allowNextOptionSelectAction = false;
  private allowNextMenuOptionSelectAction = false;
  private pendingStarterIntent: PendingStarterIntent | null = null;
  private pendingStarterIntentStartedAt = 0;
  private buildingDefaultStarterTeam = false;
  private pendingMysteryOptionIndex: number | null = null;
  private pendingMysteryOptionStartedAt = 0;
  private mysteryOptionAccepted = false;
  private readonly shinySeenThisRun = new Set<number>();
  private readonly badge: HTMLDivElement;
  private readonly keydownHandler = (event: KeyboardEvent): void => {
    if ((event.code === TOGGLE_KEY || event.code === TOGGLE_TEMPLATE_KEY) && !shouldHandleAutoplayHotkey(event)) {
      event.preventDefault();
      return;
    }

    if (event.code === TOGGLE_KEY) {
      event.preventDefault();
      this.setEnabled(!this.enabled, false);
      return;
    }

    if (event.code === TOGGLE_TEMPLATE_KEY) {
      event.preventDefault();
      this.cycleTemplate();
      return;
    }

    if (event.code !== TOGGLE_KEY && event.code !== TOGGLE_TEMPLATE_KEY && this.enabled) {
      this.setEnabled(false, true);
    }
  };
  private readonly manualInputHandler = (): void => {
    if (!this.enabled) {
      return;
    }
    this.setEnabled(false, true);
  };

  constructor() {
    this.enabled = this.readStoredEnabled();
    this.template = this.readStoredTemplate();
    this.stats = this.readStoredJson(STATS_STORAGE_KEY, DEFAULT_STATS, coerceSessionStats);
    this.stopRules = this.readStoredJson(STOP_RULES_STORAGE_KEY, DEFAULT_STOP_RULES, coerceStopRules);
    this.saveSlotRotation = this.readStoredJson(
      SAVE_SLOT_ROTATION_STORAGE_KEY,
      DEFAULT_SAVE_SLOT_ROTATION,
      coerceSaveSlotRotation,
    );
    this.notificationSettings = this.readStoredJson(
      NOTIFICATION_STORAGE_KEY,
      DEFAULT_NOTIFICATIONS,
      coerceNotificationSettings,
    );
    this.badge = document.createElement("div");
    this.badge.id = "autoplay-status";
    Object.assign(this.badge.style, {
      position: "fixed",
      top: "8px",
      right: "8px",
      zIndex: "10000",
      padding: "6px 9px",
      borderRadius: "4px",
      color: "white",
      background: "rgba(0, 0, 0, 0.75)",
      font: "12px monospace",
      pointerEvents: "none",
    });
    document.body.appendChild(this.badge);
    this.updateBadge();

    window.addEventListener("keydown", this.keydownHandler);
    window.addEventListener("pointerdown", this.manualInputHandler);
    globalScene.inputController.events.on("input_down", this.manualInputHandler);
    globalScene.events.once("shutdown", this.destroy, this);
  }

  update(time: number): void {
    if (!globalScene.ui) {
      return;
    }

    if (this.enabled) {
      this.accumulateAfkTime(time);
      this.observeRunLifecycle();
      this.maybeNotifyShinyEncounter();

      const autoPauseReason = this.getAutoPauseReason();
      if (autoPauseReason) {
        this.setEnabled(false, false, autoPauseReason);
        return;
      }

      if (time >= this.nextActionAt) {
        this.nextActionAt = time + this.getTemplateSettings().actionDelayMs;
        this.act();
      }

      if (time - this.lastStatsPersistAt >= 5000) {
        this.storeStats();
        this.lastStatsPersistAt = time;
      }
    }

    this.lastUpdateTime = time;
  }

  private act(): void {
    const phase = globalScene.phaseManager.getCurrentPhase();
    const mode = globalScene.ui.getMode();

    if (phase.phaseName !== "SelectStarterPhase") {
      this.pendingStarterIntent = null;
      this.pendingStarterIntentStartedAt = 0;
      this.buildingDefaultStarterTeam = false;
    }
    if (mode !== UiMode.MYSTERY_ENCOUNTER) {
      this.pendingMysteryOptionIndex = null;
      this.pendingMysteryOptionStartedAt = 0;
      this.mysteryOptionAccepted = false;
    }

    if (phase instanceof CommandPhase && (mode === UiMode.COMMAND || mode === UiMode.FIGHT)) {
      this.allowNextOptionSelectAction = false;
      this.allowNextMenuOptionSelectAction = false;
      const playerPokemon = phase.getPokemon();
      const opponents = this.getActiveOpponents();
      const bestMove = this.chooseMove(playerPokemon);
      const switchChoice = this.suppressNextSwitchAttempt
        ? null
        : this.chooseSwitch(playerPokemon, opponents, bestMove.score);
      const switchPlan = planSwitchAttempt(this.suppressNextSwitchAttempt, switchChoice?.index ?? null);

      if (switchPlan.kind === "FIGHT_WITHOUT_SWITCH") {
        this.suppressNextSwitchAttempt = false;
      } else if (switchPlan.kind === "ATTEMPT") {
        const switchAccepted = phase.handleCommand(Command.POKEMON, switchPlan.switchIndex, false);
        const switchOutcome = resolveSwitchAttempt(switchAccepted);
        this.suppressNextSwitchAttempt = switchOutcome.suppressNextSwitch;
        this.pendingTargetIndex = null;
        return;
      }

      this.pendingTargetIndex = bestMove.targetIndex ?? opponents[0]?.getBattlerIndex() ?? null;
      const movesetLength = playerPokemon.getMoveset().length;
      const fightCursor = getFightCursor(bestMove.index, movesetLength);

      let commandAccepted: boolean;
      if (fightCursor === -1) {
        const targets = this.pendingTargetIndex == null ? [] : [this.pendingTargetIndex];
        commandAccepted = phase.handleCommand(Command.FIGHT, -1, MoveUseMode.IGNORE_PP, {
          move: MoveId.STRUGGLE,
          targets,
          useMode: MoveUseMode.IGNORE_PP,
        });
      } else {
        commandAccepted = phase.handleCommand(Command.FIGHT, fightCursor);
      }

      if (!commandAccepted) {
        this.pendingTargetIndex = null;
      }
      return;
    }

    switch (mode) {
      case UiMode.TITLE:
        this.handleTitleMode();
        break;
      case UiMode.SAVE_SLOT:
        this.handleSaveSlotMode();
        break;
      case UiMode.MESSAGE:
        globalScene.ui.processInput(Button.ACTION);
        break;
      case UiMode.MODIFIER_SELECT:
        this.handleModifierSelectMode();
        break;
      case UiMode.TARGET_SELECT:
        this.handleTargetSelectMode();
        break;
      case UiMode.OPTION_SELECT:
      case UiMode.MENU_OPTION_SELECT:
        this.handleOptionSelectMode(mode, phase.phaseName);
        break;
      case UiMode.CHALLENGE_SELECT:
      case UiMode.EVOLUTION_SCENE:
      case UiMode.EGG_HATCH_SCENE:
      case UiMode.EGG_HATCH_SUMMARY:
        globalScene.ui.processInput(Button.ACTION);
        break;
      case UiMode.MYSTERY_ENCOUNTER:
        this.handleMysteryEncounterMode();
        break;
      case UiMode.CONFIRM:
        this.handleConfirmMode();
        break;
      case UiMode.ALERT_MODAL:
        this.pauseForSafety("ALERT REQUIRES REVIEW");
        break;
      case UiMode.LOGIN_OR_REGISTER:
      case UiMode.LOGIN_FORM:
      case UiMode.REGISTRATION_FORM:
      case UiMode.CHANGE_PASSWORD_FORM:
      case UiMode.AUTO_COMPLETE:
      case UiMode.ADMIN:
        this.pauseForSafety("ACCOUNT INPUT REQUIRED");
        break;
      case UiMode.STARTER_SELECT:
        this.handleStarterSelectMode();
        break;
      case UiMode.PARTY:
        this.choosePartyMember(globalScene.ui.getHandler());
        break;
      case UiMode.MENU:
      case UiMode.SETTINGS_GENERAL:
      case UiMode.SETTINGS_DISPLAY:
      case UiMode.SETTINGS_AUDIO:
      case UiMode.SETTINGS_GAMEPAD:
      case UiMode.SETTINGS_KEYBOARD:
      case UiMode.GAMEPAD_BINDING:
      case UiMode.KEYBOARD_BINDING:
      case UiMode.ACHIEVEMENTS:
      case UiMode.GAME_STATS:
      case UiMode.EGG_LIST:
      case UiMode.EGG_GACHA:
      case UiMode.POKEDEX:
      case UiMode.POKEDEX_SCAN:
      case UiMode.POKEDEX_PAGE:
      case UiMode.RENAME_POKEMON:
      case UiMode.RENAME_RUN:
      case UiMode.RUN_HISTORY:
      case UiMode.RUN_INFO:
        globalScene.ui.processInput(Button.CANCEL);
        break;
      case UiMode.SUMMARY:
        if (phase instanceof LearnMovePhase) {
          this.handleLearnMoveSummary(phase);
        } else {
          globalScene.ui.processInput(Button.CANCEL);
        }
        break;
    }
  }

  private handleLearnMoveSummary(phase: LearnMovePhase): void {
    const handler = globalScene.ui.getHandler();
    if (!(handler instanceof SummaryUiHandler)) {
      this.pauseForSafety("MOVE LEARNING UI UNAVAILABLE");
      return;
    }

    const pokemon = phase.getPlayerPokemon();
    const incomingMove = phase.getMoveToLearn();
    const currentProfiles = pokemon
      .getMoveset()
      .map(pokemonMove => createLearnedMoveProfile(pokemon, pokemonMove.getMove()));
    const incomingProfile = createLearnedMoveProfile(pokemon, incomingMove);
    const plan = planLearnMoveReplacement(currentProfiles, incomingProfile);
    const selectedIndex = plan.kind === "REPLACE" ? plan.index : 4;

    if (!handler.selectMoveForLearning(selectedIndex)) {
      this.pauseForSafety("MOVE LEARNING SELECTION FAILED");
    }
  }

  private handleTargetSelectMode(): void {
    const handler = globalScene.ui.getHandler() as unknown as { setCursor?: (cursor: number) => boolean } | undefined;
    if (this.pendingTargetIndex != null) {
      handler?.setCursor?.(this.pendingTargetIndex);
    }
    this.pendingTargetIndex = null;
    globalScene.ui.processInput(Button.ACTION);
  }

  private handleMysteryEncounterMode(): void {
    const handler = globalScene.ui.getHandler() as MysteryEncounterUiHandler;
    const targetIndex = handler.getFirstAutoplaySafeOptionIndex();
    if (targetIndex == null) {
      this.pauseForSafety("ENCOUNTER REVIEW REQUIRED");
      return;
    }

    if (this.pendingMysteryOptionIndex !== targetIndex) {
      this.pendingMysteryOptionIndex = targetIndex;
      this.pendingMysteryOptionStartedAt = Date.now();
      this.mysteryOptionAccepted = false;
    }

    if (this.mysteryOptionAccepted) {
      if (Date.now() - this.pendingMysteryOptionStartedAt >= MYSTERY_OPTION_TIMEOUT_MS) {
        this.pauseForSafety("ENCOUNTER TRANSITION TIMED OUT");
      }
      return;
    }

    if (handler.getCursor() !== targetIndex) {
      handler.setCursor(targetIndex);
      return;
    }
    if (globalScene.ui.processInput(Button.ACTION)) {
      this.mysteryOptionAccepted = true;
      this.pendingMysteryOptionStartedAt = Date.now();
    } else if (Date.now() - this.pendingMysteryOptionStartedAt >= MYSTERY_OPTION_TIMEOUT_MS) {
      this.pauseForSafety("ENCOUNTER OPTION TIMED OUT");
    }
  }

  private handleOptionSelectMode(
    mode: UiMode.OPTION_SELECT | UiMode.MENU_OPTION_SELECT,
    phaseName: string | undefined,
  ): void {
    if (mode === UiMode.OPTION_SELECT && this.pendingStarterIntent === "ADD_DEFAULT_STARTER") {
      const handler = globalScene.ui.getHandler() as BaseOptionSelectUiHandler;
      const selectedLabel = handler.getOptionsWithScroll()[handler.getCursor()]?.label;
      if (
        isExpectedStarterAddOption(
          phaseName,
          this.pendingStarterIntent,
          selectedLabel,
          i18next.t("starterSelectUiHandler:addToParty"),
        )
      ) {
        this.pendingStarterIntent = null;
        this.pendingStarterIntentStartedAt = 0;
        globalScene.ui.processInput(Button.ACTION);
        return;
      }

      this.pendingStarterIntent = null;
      this.pendingStarterIntentStartedAt = 0;
      this.pauseForSafety("DEFAULT STARTER UNAVAILABLE");
      return;
    }

    const authorized =
      mode === UiMode.OPTION_SELECT ? this.allowNextOptionSelectAction : this.allowNextMenuOptionSelectAction;
    if (mode === UiMode.OPTION_SELECT) {
      this.allowNextOptionSelectAction = false;
    } else {
      this.allowNextMenuOptionSelectAction = false;
    }

    if (isSafeOptionSelectContext(mode, phaseName, authorized)) {
      globalScene.ui.processInput(Button.ACTION);
      return;
    }
    this.pauseForSafety("OPTION REVIEW REQUIRED");
  }

  private handleConfirmMode(): void {
    const phase = globalScene.phaseManager.getCurrentPhase() as unknown as { phaseName?: string } | undefined;

    if (phase?.phaseName === "SelectStarterPhase") {
      const transition = planStarterFlowTransition(this.pendingStarterIntent, "CONFIRM");
      this.pendingStarterIntent = transition.nextIntent;

      if (transition.kind === "WAIT") {
        this.waitForPendingStarterTransition();
        return;
      }
      if (transition.kind !== "ACTION") {
        this.pauseForSafety("CONFIRMATION REQUIRED");
        return;
      }

      this.pendingStarterIntentStartedAt = Date.now();
      this.buildingDefaultStarterTeam = false;
      globalScene.ui.processInput(Button.ACTION);
      return;
    }

    const confirmHandler = globalScene.ui.getHandler() as BaseOptionSelectUiHandler;
    if (
      isFullPartyDiscardConfirmation(
        phase?.phaseName,
        confirmHandler.getOptionsWithScroll().map(option => option.label),
        [
          i18next.t("partyUiHandler:summary"),
          i18next.t("partyUiHandler:pokedex"),
          i18next.t("menu:yes"),
          i18next.t("menu:no"),
        ],
      )
    ) {
      globalScene.ui.processInput(Button.CANCEL);
      return;
    }

    const starterTeamAuthorized = this.pendingStarterIntent === "CONFIRM_STARTER_TEAM";
    const action = planAutoplayConfirmation(phase?.phaseName, starterTeamAuthorized);

    if (action === "PAUSE") {
      this.pauseForSafety("CONFIRMATION REQUIRED");
      return;
    }

    globalScene.ui.processInput(action === "ACTION" ? Button.ACTION : Button.CANCEL);
  }

  private handleModifierSelectMode(): void {
    const handler = globalScene.ui.getHandler() as unknown as
      | {
          options?: ModifierOptionLike[];
          rowCursor?: number;
          cursor?: number;
          setRowCursor?: (row: number) => boolean;
          setCursor?: (cursor: number) => boolean;
        }
      | undefined;

    const rewardOptions = Array.isArray(handler?.options)
      ? handler.options.map(option => {
          const type = option.modifierTypeOption?.type;
          return {
            ...option,
            autoplayUnsafe:
              type instanceof FusePokemonModifierType
              || type instanceof PokemonMoveModifierType
              || type instanceof RememberMoveModifierType
              || type instanceof TmModifierType,
            autoplayAvoid: isAutoplayAvoidedRewardType(type),
          };
        })
      : [];
    const plan = planModifierSelection(handler?.rowCursor, handler?.cursor, rewardOptions);
    if (plan.kind === "SET_ROW") {
      handler?.setRowCursor?.(plan.row);
      return;
    }
    if (plan.kind === "SET_CURSOR") {
      handler?.setCursor?.(plan.cursor);
      return;
    }

    if (plan.kind === "CANCEL") {
      globalScene.ui.processInput(Button.CANCEL);
      return;
    }

    globalScene.ui.processInput(Button.ACTION);
  }

  private chooseMove(pokemon: PlayerPokemon): MoveChoice {
    const template = this.getTemplateSettings();
    const moves = pokemon.getMoveset();
    const incomingThreat = this.getStrongestIncomingThreat(pokemon);
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestTargetIndex: number | undefined;

    for (const [index, pokemonMove] of moves.entries()) {
      if (!pokemonMove.isUsable(pokemon, false, true)[0]) {
        continue;
      }

      const moveTargets = this.getMoveTargetsForScoring(pokemon, pokemonMove.moveId);
      const targetSummary = scoreLegalMoveTargets(moveTargets.targets, moveTargets.multiple, targetIndex => {
        const target = targetIndex === BattlerIndex.ATTACKER ? pokemon : globalScene.getField()[targetIndex];
        if (!target) {
          return;
        }
        const targetIsAlly = target.isPlayer() === pokemon.isPlayer();
        return this.scoreMoveForTarget(pokemon, target, index, targetIsAlly, incomingThreat);
      });
      let score = targetSummary.score;

      // Gradually conserve depleted moves while still allowing a decisive attack to win on merit.
      const ppRatio = pokemonMove.getPpRatio();
      if (score > 0 && ppRatio < 0.3) {
        const conservationRatio = Math.max(0, ppRatio / 0.3);
        score *= template.lowPpMultiplier + (1 - template.lowPpMultiplier) * conservationRatio;
      }

      // Stable final tie-breaker: prefer the move with more remaining PP.
      score += ppRatio * 0.01;

      if (bestIndex === -1 || score > bestScore) {
        bestScore = score;
        bestIndex = index;
        bestTargetIndex = targetSummary.targetIndex;
      }
    }

    if (bestIndex === -1) {
      return { index: -1, score: 0, targetIndex: undefined };
    }

    return { index: bestIndex, score: bestScore, targetIndex: bestTargetIndex };
  }

  private chooseSwitch(pokemon: PlayerPokemon, opponents: Pokemon[], bestMoveScore: number): SwitchChoice | null {
    const template = this.getTemplateSettings();
    if (opponents.length === 0 || !this.hasHealthyReserve()) {
      return null;
    }

    const currentMatchupScore = this.getAverageMatchupScore(pokemon, opponents);
    const bestSwitch = this.getBestSwitchCandidate(opponents);
    if (!bestSwitch) {
      return null;
    }

    const shouldEmergencySwitch =
      pokemon.getHpRatio() <= template.criticalHpRatio && bestSwitch.score > currentMatchupScore;
    if (shouldEmergencySwitch) {
      return bestSwitch;
    }

    const shouldLowHpSwitch =
      pokemon.getHpRatio() <= template.lowHpRatio
      && bestSwitch.score > currentMatchupScore * template.switchMinImprovementRatio;
    if (shouldLowHpSwitch) {
      return bestSwitch;
    }

    const shouldPressureSwitch =
      bestMoveScore < template.moveScoreSwitchFloor
      && bestSwitch.score > currentMatchupScore * template.switchMinImprovementRatio;
    return shouldPressureSwitch ? bestSwitch : null;
  }

  private getBestSwitchCandidate(opponents: Pokemon[]): SwitchChoice | null {
    const template = this.getTemplateSettings();
    const party = globalScene.getPlayerParty();
    let best: SwitchChoice | null = null;

    for (const [index, candidate] of party.entries()) {
      if (!isEligibleReserve(candidate)) {
        continue;
      }

      let score = this.getAverageMatchupScore(candidate, opponents);
      const hpRatio = candidate.getHpRatio();

      if (hpRatio <= template.lowHpRatio) {
        score *= 0.8;
      } else if (hpRatio >= 0.75) {
        score *= 1.05;
      }

      if (!best || score > best.score) {
        best = { index, score };
      }
    }

    return best;
  }

  private getAverageMatchupScore(candidate: Pokemon, opponents: Pokemon[]): number {
    if (opponents.length === 0) {
      return 0;
    }

    const total = opponents.reduce((sum, opponent) => sum + candidate.getMatchupScore(opponent), 0);
    return total / opponents.length;
  }

  private simulateWithBattleRng<T>(source: Pokemon, target: Pokemon, move: Move, callback: () => T): T {
    let result: T | undefined;
    let callbackError: unknown;
    let callbackThrew = false;
    const battlePokemon = [
      ...globalScene.getPlayerParty(),
      ...globalScene.getEnemyParty(),
      ...globalScene.getField(),
    ].filter((pokemon): pokemon is Pokemon => pokemon != null);
    const pokemonSnapshots = [...new Set(battlePokemon)].map(pokemon => ({
      pokemon,
      summonAbilitiesApplied: new Set(pokemon.summonData.abilitiesApplied),
      waveAbilitiesApplied: new Set(pokemon.waveData.abilitiesApplied),
      hitCount: pokemon.turnData.hitCount,
      hitsLeft: pokemon.turnData.hitsLeft,
      moveEffectiveness: pokemon.turnData.moveEffectiveness,
    }));
    const offset = Math.abs((source.id * 131 + target.id * 17 + move.id * 7) | 0);
    try {
      globalScene.executeWithSeedOffset(() => {
        try {
          result = callback();
        } catch (error) {
          callbackThrew = true;
          callbackError = error;
        }
      }, offset);
    } finally {
      for (const snapshot of pokemonSnapshots) {
        snapshot.pokemon.summonData.abilitiesApplied.clear();
        snapshot.summonAbilitiesApplied.forEach(ability => snapshot.pokemon.summonData.abilitiesApplied.add(ability));
        snapshot.pokemon.waveData.abilitiesApplied.clear();
        snapshot.waveAbilitiesApplied.forEach(ability => snapshot.pokemon.waveData.abilitiesApplied.add(ability));
        snapshot.pokemon.turnData.hitCount = snapshot.hitCount;
        snapshot.pokemon.turnData.hitsLeft = snapshot.hitsLeft;
        snapshot.pokemon.turnData.moveEffectiveness = snapshot.moveEffectiveness;
      }
    }
    if (callbackThrew) {
      throw callbackError;
    }
    return result as T;
  }

  private getMoveTargetsForScoring(pokemon: Pokemon, moveId: MoveId): ReturnType<typeof getMoveTargets> {
    const move = allMoves[moveId];
    return this.simulateWithBattleRng(pokemon, pokemon, move, () => getMoveTargets(pokemon, moveId));
  }

  private getAdjustedMoveAccuracy(user: Pokemon, target: Pokemon, move: Move): number {
    const battleAccuracy = move.calculateBattleAccuracy(user, target, true);
    return battleAccuracy === -1 ? -1 : battleAccuracy * user.getAccuracyMultiplier(target, move, true);
  }

  private getExpectedDamageRollMultiplier(move: Move): number {
    return move.hasAttr("FixedDamageAttr") || move.hasAttr("OneHitKOAttr") ? 1 : 0.925;
  }

  private getMoveTurnCost(move: Move): number {
    let turnCost = 1;
    if (move.hasAttr("DelayedAttackAttr")) {
      turnCost += 2;
    }
    if (move.hasAttr("RechargeAttr")) {
      turnCost++;
    }
    if (move.isChargingMove()) {
      turnCost++;
    }
    return turnCost;
  }

  private getSafeForecastDamage(source: Pokemon, target: Pokemon, move: Move): number {
    // Present's power preview mutates turn data and can queue a healing phase, even during simulation.
    if (move.id === MoveId.PRESENT) {
      return 0;
    }
    // Psywave's native fixed-damage preview consumes battle RNG; its expected roll equals the user's level.
    if (move.id === MoveId.PSYWAVE) {
      return source.level;
    }
    if (TARGET_HALF_HP_MOVES.has(move.id)) {
      return Math.max(1, Math.floor(target.hp / 2));
    }
    // An unattended farming profile should never trade away its active Pokemon for a large forecast number.
    if (move.id === MoveId.BEAT_UP || ONE_HIT_KO_MOVES.has(move.id) || SELF_DESTRUCT_MOVES.has(move.id)) {
      return 0;
    }

    const isCritical = move.hasAttr("CritOnlyAttr") || Boolean(source.getTag(BattlerTagType.ALWAYS_CRIT));
    const forecast = target.getAttackDamage({
      source,
      move,
      isCritical,
      simulated: true,
    });
    return forecast.cancelled ? 0 : forecast.damage;
  }

  private getMoveSecondaryBenefit(move: Move): number {
    let benefit = move.chance > 0 ? Math.min(move.chance, 100) * 0.05 : 0;
    if (move.hasAttr("HitHealAttr")) {
      benefit += 10;
    }
    if (move.hasAttr("RecoilAttr")) {
      benefit -= 8;
    }
    if (move.hasAttr("SacrificialAttr") || move.hasAttr("SacrificialAttrOnHit")) {
      benefit -= 80;
    }
    return benefit;
  }

  private getStrongestIncomingThreat(defender: PlayerPokemon): IncomingThreat {
    let strongest: IncomingThreat = { damage: 0, priority: 0, source: null };
    const defenderIndex = defender.getBattlerIndex();

    for (const opponent of this.getActiveOpponents()) {
      const queuedMove = opponent.getMoveQueue()[0];
      const candidates: IncomingMoveCandidate[] = queuedMove
        ? [{ move: allMoves[queuedMove.move], queued: true, targets: queuedMove.targets }]
        : opponent
            .getMoveset()
            .filter(pokemonMove => pokemonMove.isUsable(opponent, false, true)[0])
            .map(pokemonMove => ({
              move: pokemonMove.getMove(),
              queued: false,
              targets: this.getMoveTargetsForScoring(opponent, pokemonMove.moveId).targets,
            }));

      for (const candidate of candidates) {
        const { move } = candidate;
        if (move.category === MoveCategory.STATUS || !candidate.targets.includes(defenderIndex)) {
          continue;
        }

        const expectedDamage = this.simulateWithBattleRng(opponent, defender, move, () =>
          this.getIncomingThreatDamage(opponent, defender, candidate),
        );
        if (expectedDamage > strongest.damage) {
          strongest = {
            damage: expectedDamage,
            priority: move.getPriority(opponent, true),
            source: opponent,
          };
        }
      }
    }

    return strongest;
  }

  private getIncomingThreatDamage(
    opponent: Pokemon,
    defender: PlayerPokemon,
    candidate: IncomingMoveCandidate,
  ): number {
    const { move } = candidate;
    // Move conditions are arbitrary callbacks; never execute them during a read-only forecast.
    const conditionsMet = true;
    if (
      shouldScoreMoveAsFailure({
        conditionsMet,
        isConditionallyUsable: true,
        isUnimplemented: move.isUnimplemented,
        terrainCancelled: globalScene.arena.isMoveTerrainCancelled(opponent, [defender.getBattlerIndex()], move),
        weatherCancelled: globalScene.arena.isMoveWeatherCancelled(opponent, move),
      })
      || defender.getMoveEffectiveness(opponent, move, false, true) <= 0
    ) {
      return 0;
    }

    const forecastDamage = this.getSafeForecastDamage(opponent, defender, move);
    const battleAccuracy = this.getAdjustedMoveAccuracy(opponent, defender, move);
    const execution = calculateMoveExecution({
      baseAccuracy: move.accuracy,
      basePower: move.power,
      battleAccuracy,
      effectivePower: move.calculateEffectivePower(),
      turnCost: this.getMoveTurnCost(move),
    });
    return forecastDamage * this.getExpectedDamageRollMultiplier(move) * execution.expectedMultiplier;
  }

  private actsBeforeThreat(
    user: PlayerPokemon,
    move: Move,
    target: Pokemon,
    threat: IncomingThreat,
    isDelayed: boolean,
  ): boolean {
    if (isDelayed) {
      return false;
    }
    if (!threat.source) {
      return true;
    }

    const priority = move.getPriority(user, true);
    if (priority !== threat.priority) {
      return priority > threat.priority;
    }

    const userSpeed = user.getEffectiveStat(Stat.SPD, { opponent: target, simulated: true });
    const threatSpeed = threat.source.getEffectiveStat(Stat.SPD, { opponent: user, simulated: true });
    return userSpeed >= threatSpeed;
  }

  private scoreMoveForTarget(
    user: PlayerPokemon,
    target: Pokemon,
    moveIndex: number,
    targetIsAlly: boolean,
    incomingThreat: IncomingThreat,
  ): number {
    const pokemonMove = user.getMoveset()[moveIndex];
    const move = pokemonMove.getMove();
    return this.simulateWithBattleRng(user, target, move, () =>
      this.scoreMoveForTargetForecast(user, target, move, targetIsAlly, incomingThreat),
    );
  }

  private scoreMoveForTargetForecast(
    user: PlayerPokemon,
    target: Pokemon,
    move: Move,
    targetIsAlly: boolean,
    incomingThreat: IncomingThreat,
  ): number {
    const terrainTargets = target === user ? [] : [target.getBattlerIndex()];
    const weatherCancelled = globalScene.arena.isMoveWeatherCancelled(user, move);
    const terrainCancelled = globalScene.arena.isMoveTerrainCancelled(user, terrainTargets, move);
    // The real move phase remains authoritative for contextual failure conditions.
    const conditionsMet = true;

    if (
      shouldScoreMoveAsFailure({
        conditionsMet,
        isConditionallyUsable: true,
        isUnimplemented: move.isUnimplemented,
        terrainCancelled,
        weatherCancelled,
      })
    ) {
      return targetIsAlly ? 0 : MOVE_FAILURE_SCORE;
    }

    const effectiveness = target.getMoveEffectiveness(user, move, false, true);
    if (effectiveness <= 0) {
      return targetIsAlly ? 0 : MOVE_FAILURE_SCORE;
    }

    if (move.category === MoveCategory.STATUS) {
      const userBenefit = move.getUserBenefitScore(user, target, move);
      const targetBenefit = move.getTargetBenefitScore(user, target, move);
      let statusScore = 12 + combineMoveBenefitScores(userBenefit, targetBenefit, targetIsAlly);
      if (!targetIsAlly && incomingThreat.damage >= user.hp) {
        statusScore -= 45;
      }
      if (move.getPriority(user, true) > 0) {
        statusScore += 4;
      }
      return statusScore;
    }

    const forecastDamage = this.getSafeForecastDamage(user, target, move);
    const battleAccuracy = this.getAdjustedMoveAccuracy(user, target, move);
    const turnCost = this.getMoveTurnCost(move);
    const execution = calculateMoveExecution({
      baseAccuracy: move.accuracy,
      basePower: move.power,
      battleAccuracy,
      effectivePower: move.calculateEffectivePower(),
      turnCost,
    });
    const priority = move.getPriority(user, true);
    const isDelayed = move.hasAttr("DelayedAttackAttr") || move.isChargingMove();
    const damageInput: DamageMoveScoreInput = {
      accuracy: battleAccuracy,
      actsBeforeThreat: this.actsBeforeThreat(user, move, target, incomingThreat, isDelayed),
      expectedDamage: forecastDamage * this.getExpectedDamageRollMultiplier(move) * execution.expectedMultiplier,
      incomingDamage: incomingThreat.damage,
      isDelayed,
      priority,
      removesThreat: incomingThreat.source === target,
      secondaryBenefit: this.getMoveSecondaryBenefit(move),
      successfulDamage: forecastDamage * execution.successfulMultiplier,
      targetHp: target.hp,
      userHp: user.hp,
    };
    const damageScore = scoreDamagingMove(damageInput);
    if (damageScore === MOVE_FAILURE_SCORE) {
      return targetIsAlly ? 0 : MOVE_FAILURE_SCORE;
    }
    return scoreDamageForTargetSide(damageScore, targetIsAlly);
  }

  private getAutoPauseReason(): string | null {
    const stopReason = this.getSmartStopReason();
    if (stopReason) {
      return stopReason;
    }

    const template = this.getTemplateSettings();
    const opponents = this.getActiveOpponents();

    if (template.autoPauseOnShiny && opponents.some(opponent => opponent.isShiny(true))) {
      return "SHINY PAUSE";
    }

    return null;
  }

  private getSmartStopReason(): string | null {
    if (!this.stopRules.enabled) {
      return null;
    }

    const wave = globalScene.currentBattle?.waveIndex ?? 0;

    if (hasReachedCompletedRunLimit(this.completedRunsThisSession, this.stopRules.stopAfterRuns)) {
      return "STOP RULE: MAX RUNS";
    }

    if (this.stopRules.waveRangeStart > 0) {
      const rangeEnd = this.stopRules.waveRangeEnd > 0 ? this.stopRules.waveRangeEnd : this.stopRules.waveRangeStart;
      if (wave >= this.stopRules.waveRangeStart && wave <= rangeEnd) {
        return `STOP RULE: WAVE ${wave}`;
      }
    }

    if (this.stopRules.targetSpeciesIds.length > 0) {
      const hasTarget = this.getActiveOpponents().some(opponent =>
        this.stopRules.targetSpeciesIds.includes(opponent.species.speciesId),
      );
      if (hasTarget) {
        return "STOP RULE: TARGET SPECIES";
      }
    }

    return null;
  }

  private hasHealthyReserve(): boolean {
    const template = this.getTemplateSettings();
    return globalScene
      .getPlayerParty()
      .some(pokemon => isEligibleReserve(pokemon) && pokemon.getHpRatio() > template.lowHpRatio);
  }

  private getActiveOpponents(): Pokemon[] {
    return globalScene.getEnemyField().filter(opponent => opponent?.isActive(true));
  }

  private handleTitleMode(): void {
    const titleHandler = globalScene.ui.getHandler();
    const plan = planTitleSelection(globalScene.sessionSlotId >= 0);
    titleHandler.setCursor(plan.cursor);

    this.allowNextOptionSelectAction = plan.authorizeGameModeOption;
    this.pendingStarterIntent = null;
    this.pendingStarterIntentStartedAt = 0;
    this.buildingDefaultStarterTeam = false;
    globalScene.ui.processInput(Button.ACTION);
  }

  private handleSaveSlotMode(): void {
    const starterTransition = planStarterFlowTransition(this.pendingStarterIntent, "SAVE_SLOT");
    this.pendingStarterIntent = starterTransition.nextIntent;
    if (this.pendingStarterIntent == null) {
      this.pendingStarterIntentStartedAt = 0;
    }

    const handler = globalScene.ui.getHandler() as unknown as
      | {
          cursor?: number;
          scrollCursor?: number;
          sessionSlots?: Array<{ hasData?: boolean; malformed?: boolean }>;
          uiMode?: SaveSlotUiMode;
        }
      | undefined;
    const slots = handler?.sessionSlots;
    if (!slots || slots.length === 0 || handler?.uiMode == null) {
      return;
    }

    const currentSlot = (handler?.cursor ?? 0) + (handler?.scrollCursor ?? 0);
    const slotStates = slots.map(slot => slot.hasData);
    let target: number | null;

    if (handler.uiMode === SaveSlotUiMode.LOAD) {
      target = slots.findIndex(slot => slot.hasData === true && !slot.malformed);
      if (target < 0) {
        if (!slotStates.includes(undefined)) {
          this.pauseForSafety("NO SAVED RUN TO LOAD");
        }
        return;
      }
    } else {
      const preferredStart = this.saveSlotRotation.enabled ? this.saveSlotRotation.nextSlot : 0;
      target = findNextEmptySaveSlot(slotStates, preferredStart);
      if (target == null) {
        if (!slotStates.includes(undefined)) {
          this.pauseForSafety("NO EMPTY SAVE SLOT");
        }
        return;
      }
    }

    if (currentSlot < target) {
      globalScene.ui.processInput(Button.DOWN);
      return;
    }

    if (currentSlot > target) {
      globalScene.ui.processInput(Button.UP);
      return;
    }

    if (handler.uiMode === SaveSlotUiMode.LOAD) {
      this.allowNextMenuOptionSelectAction = true;
    }
    globalScene.ui.processInput(Button.ACTION);
  }

  private handleStarterSelectMode(): void {
    const starterHandler = globalScene.ui.getHandler() as StarterSelectUiHandler;
    const starterTransition = planStarterFlowTransition(this.pendingStarterIntent, "STARTER_SELECT");
    if (starterTransition.kind === "WAIT") {
      this.waitForPendingStarterTransition();
      return;
    }

    const partyStarterIds = Array.isArray(starterHandler.partyStarterIds) ? starterHandler.partyStarterIds : [];
    const plan = planClassicStarterSelection(partyStarterIds, this.buildingDefaultStarterTeam);
    this.buildingDefaultStarterTeam = plan.buildingDefaultTeam;

    if (plan.kind === "SELECT_STARTER") {
      starterHandler.prepareDefaultStarterSelection(plan.cursor);
      this.pendingStarterIntent = "ADD_DEFAULT_STARTER";
      this.pendingStarterIntentStartedAt = Date.now();
      globalScene.ui.processInput(Button.ACTION);
      return;
    }

    const submitTransition = planStarterFlowTransition(this.pendingStarterIntent, "SUBMIT_TEAM");
    if (submitTransition.kind !== "SUBMIT") {
      this.waitForPendingStarterTransition();
      return;
    }

    this.pendingStarterIntent = submitTransition.nextIntent;
    this.pendingStarterIntentStartedAt = Date.now();
    globalScene.ui.processInput(Button.SUBMIT);
  }

  private waitForPendingStarterTransition(): void {
    if (
      this.pendingStarterIntent == null
      || Date.now() - this.pendingStarterIntentStartedAt < STARTER_TRANSITION_TIMEOUT_MS
    ) {
      return;
    }

    const reason =
      this.pendingStarterIntent === "ADD_DEFAULT_STARTER"
        ? "STARTER OPTION TIMED OUT"
        : this.pendingStarterIntent === "CONFIRM_STARTER_TEAM"
          ? "STARTER CONFIRMATION TIMED OUT"
          : "SAVE SLOT TRANSITION TIMED OUT";
    this.pauseForSafety(reason);
  }

  private choosePartyMember(handler: UiHandler): void {
    const partyHandler = handler as unknown as {
      optionsMode?: boolean;
      partyUiMode?: PartyUiMode;
      processInput: (button: Button) => boolean;
      selectFilter?: (pokemon: PlayerPokemon) => string | null;
      setCursor: (index: number) => boolean;
    };
    const mode = partyHandler.partyUiMode;

    if (mode == null) {
      this.pauseForSafety("UNKNOWN PARTY CHOICE");
      return;
    }

    if (!isAutoplaySupportedPartyMode(mode)) {
      if (mode === PartyUiMode.POST_BATTLE_SWITCH) {
        partyHandler.processInput(Button.CANCEL);
        return;
      }
      this.pauseForSafety("PARTY CHOICE REQUIRED");
      return;
    }

    if (partyHandler.optionsMode) {
      // The supported modes put their context action (Send Out, Revive, or Apply) first.
      partyHandler.processInput(Button.ACTION);
      return;
    }

    const party = globalScene.getPlayerParty();
    const passesFilter = (pokemon: PlayerPokemon): boolean => {
      try {
        return partyHandler.selectFilter?.(pokemon) == null;
      } catch {
        return false;
      }
    };
    let selectedIndex = -1;

    if (mode === PartyUiMode.SWITCH || mode === PartyUiMode.FAINT_SWITCH) {
      selectedIndex = party.findIndex(pokemon => isEligibleReserve(pokemon) && passesFilter(pokemon));
    } else if (mode === PartyUiMode.REVIVAL_BLESSING) {
      selectedIndex = party.findIndex(pokemon => pokemon.isFainted() && passesFilter(pokemon));
    } else if (
      mode === PartyUiMode.MODIFIER
      || mode === PartyUiMode.TM_MODIFIER
      || mode === PartyUiMode.REMEMBER_MOVE_MODIFIER
      || mode === PartyUiMode.SELECT
    ) {
      selectedIndex = party.findIndex(passesFilter);
    }

    if (selectedIndex < 0) {
      this.pauseForSafety("NO VALID PARTY TARGET");
      return;
    }

    partyHandler.setCursor(selectedIndex);
    partyHandler.processInput(Button.ACTION);
  }

  private updateBadge(): void {
    const state = this.enabled ? "ON" : "OFF";
    const overrideState = this.manualOverride ? " [MANUAL OVERRIDE]" : "";
    const noteState = this.statusNote ? ` [${this.statusNote}]` : "";
    this.badge.textContent = `AFK BOT ${state} [${this.template}] R:${this.stats.runsStarted}/${this.stats.runsEnded} W:${this.stats.wipes} AVG:${this.getAverageWave().toFixed(1)} T:${this.formatAfkTime()}${overrideState}${noteState} (${TOGGLE_KEY}/${TOGGLE_TEMPLATE_KEY})`;
    this.badge.style.background = this.enabled ? "rgba(142, 36, 36, 0.9)" : "rgba(0, 0, 0, 0.75)";
  }

  private pauseForSafety(reason: string): void {
    this.setEnabled(false, false, reason);
  }

  private setEnabled(enabled: boolean, manualOverride = false, statusNote = ""): void {
    const wasEnabled = this.enabled;
    this.enabled = enabled;
    if (enabled && !wasEnabled) {
      this.completedRunsThisSession = 0;
    } else if (!enabled) {
      this.allowNextOptionSelectAction = false;
      this.allowNextMenuOptionSelectAction = false;
      this.suppressNextSwitchAttempt = false;
      this.pendingStarterIntent = null;
      this.pendingStarterIntentStartedAt = 0;
      this.buildingDefaultStarterTeam = false;
      this.pendingMysteryOptionIndex = null;
      this.pendingMysteryOptionStartedAt = 0;
      this.mysteryOptionAccepted = false;
    }
    this.manualOverride = manualOverride;
    this.statusNote = enabled ? "" : manualOverride ? "MANUAL" : statusNote;
    this.nextActionAt = 0;
    this.storeEnabled();
    this.storeStats();
    this.updateBadge();

    if (manualOverride) {
      this.emitNotification("Manual takeover", "AFK bot disabled by direct user input.");
    }

    if (enabled) {
      this.ensureNotificationPermission();
    }

    console.info(
      `[Autoplay] ${this.enabled ? "enabled" : "disabled"}${manualOverride ? " (manual override)" : ""}${statusNote ? ` (${statusNote})` : ""}`,
    );
  }

  private readStoredEnabled(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  private readStoredTemplate(): AfkTemplateName {
    try {
      const storedTemplate = localStorage.getItem(TEMPLATE_STORAGE_KEY);
      const legacyProfile = localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY);
      return resolveAutoplayTemplate(storedTemplate, legacyProfile);
    } catch {
      return resolveAutoplayTemplate(null, null);
    }
  }

  private readStoredJson<T>(key: string, fallback: T, coerce: (value: unknown) => T): T {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return structuredClone(fallback);
      }

      return coerce(JSON.parse(raw) as unknown);
    } catch {
      return structuredClone(fallback);
    }
  }

  private storeEnabled(): void {
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? "1" : "0");
    } catch {
      // Ignore storage failures (private browsing, disabled storage, etc.)
    }
  }

  private storeTemplate(): void {
    try {
      localStorage.setItem(TEMPLATE_STORAGE_KEY, this.template);
    } catch {
      // Ignore storage failures (private browsing, disabled storage, etc.)
    }
  }

  private storeStats(): void {
    try {
      localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(this.stats));
    } catch {
      // Ignore storage failures (private browsing, disabled storage, etc.)
    }
  }

  private storeSaveSlotRotation(): void {
    try {
      localStorage.setItem(SAVE_SLOT_ROTATION_STORAGE_KEY, JSON.stringify(this.saveSlotRotation));
    } catch {
      // Ignore storage failures (private browsing, disabled storage, etc.)
    }
  }

  private cycleTemplate(): void {
    const currentIndex = TEMPLATE_ORDER.indexOf(this.template);
    const nextIndex = (currentIndex + 1) % TEMPLATE_ORDER.length;
    this.template = TEMPLATE_ORDER[nextIndex];
    this.storeTemplate();
    this.statusNote = "";
    this.updateBadge();
    console.info(`[Autoplay] template set to ${this.template}`);
  }

  private getTemplateSettings(): AfkTemplateSettings {
    return AFK_TEMPLATE_SETTINGS[this.template];
  }

  private observeRunLifecycle(): void {
    const mode = globalScene.ui.getMode();
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const isRunState = mode !== UiMode.TITLE && wave > 0;
    const currentPhase = globalScene.phaseManager.getCurrentPhase() as unknown as
      | { isVictory?: boolean; phaseName?: string }
      | undefined;

    if (!this.inRun && isRunState) {
      this.inRun = true;
      this.currentRunMaxWave = wave;
      this.currentRunOutcome = null;
      this.suppressNextSwitchAttempt = false;
      this.shinySeenThisRun.clear();
      this.stats.runsStarted++;
      this.updateBadge();
      return;
    }

    if (!this.inRun) {
      return;
    }

    this.currentRunMaxWave = Math.max(this.currentRunMaxWave, wave);

    if (currentPhase?.phaseName === "GameOverPhase") {
      if (currentPhase.isVictory === true) {
        this.currentRunOutcome = "victory";
      } else if (currentPhase.isVictory === false) {
        this.currentRunOutcome = "wipe";
      }
    }

    const party = globalScene.getPlayerParty();
    if (this.currentRunOutcome !== "victory" && party.length > 0 && party.every(pokemon => pokemon.isFainted())) {
      this.currentRunOutcome = "wipe";
    }

    if (mode === UiMode.TITLE) {
      this.inRun = false;
      this.stats.runsEnded++;
      this.completedRunsThisSession++;
      this.stats.waveTotal += this.currentRunMaxWave;

      const wasWipe = this.currentRunOutcome === "wipe";
      if (wasWipe) {
        this.stats.wipes++;
      }

      this.emitNotification(
        "Run ended",
        `Wave ${this.currentRunMaxWave} | ${wasWipe ? "wipe" : "run complete"} | totals ${this.stats.runsStarted}/${this.stats.runsEnded}`,
      );

      if (this.saveSlotRotation.enabled) {
        this.saveSlotRotation.nextSlot = (this.saveSlotRotation.nextSlot + 1) % SAVE_SLOT_COUNT;
        this.storeSaveSlotRotation();
      }

      this.currentRunMaxWave = 0;
      this.currentRunOutcome = null;
      this.storeStats();
      this.updateBadge();
    }
  }

  private maybeNotifyShinyEncounter(): void {
    for (const opponent of this.getActiveOpponents()) {
      if (!opponent.isShiny(true)) {
        continue;
      }

      const speciesId = opponent.species.speciesId;
      if (this.shinySeenThisRun.has(speciesId)) {
        continue;
      }

      this.shinySeenThisRun.add(speciesId);
      this.emitNotification(
        "Shiny spotted",
        `${opponent.species.name} (ID ${speciesId}) on wave ${globalScene.currentBattle?.waveIndex ?? 0}`,
      );
    }
  }

  private accumulateAfkTime(time: number): void {
    if (this.lastUpdateTime > 0) {
      const delta = Math.max(0, time - this.lastUpdateTime);
      this.stats.totalAfkMs += delta;
    }
  }

  private getAverageWave(): number {
    if (this.stats.runsEnded <= 0) {
      return 0;
    }
    return this.stats.waveTotal / this.stats.runsEnded;
  }

  private formatAfkTime(): string {
    const totalSeconds = Math.floor(this.stats.totalAfkMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h${minutes.toString().padStart(2, "0")}m`;
  }

  private ensureNotificationPermission(): void {
    if (!this.notificationSettings.browserNotifications || !("Notification" in window)) {
      return;
    }

    if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }

  private emitNotification(event: string, details: string): void {
    if (
      this.notificationSettings.browserNotifications
      && "Notification" in window
      && Notification.permission === "granted"
    ) {
      new Notification(`[AFK Bot] ${event}`, { body: details });
    }

    const webhook = this.notificationSettings.webhookUrl?.trim();
    if (!webhook) {
      return;
    }

    void fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        details,
        template: this.template,
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {
      // Ignore webhook failures to avoid interrupting autoplay
    });
  }

  private destroy(): void {
    window.removeEventListener("keydown", this.keydownHandler);
    window.removeEventListener("pointerdown", this.manualInputHandler);
    globalScene.inputController.events.off("input_down", this.manualInputHandler);
    this.badge.remove();
  }
}

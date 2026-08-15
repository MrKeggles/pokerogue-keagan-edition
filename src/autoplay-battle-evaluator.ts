import { MoveCategory } from "#enums/move-category";
import type { PokemonType } from "#enums/pokemon-type";

export const MOVE_FAILURE_SCORE = -20;

export interface MoveExecutionInput {
  baseAccuracy: number;
  basePower: number;
  battleAccuracy: number;
  effectivePower: number;
  turnCost: number;
}

export interface MoveExecutionForecast {
  /** Expected damage multiplier after accuracy, multi-hit behavior, and turn commitment. */
  expectedMultiplier: number;
  /** Probability that the move begins dealing damage. */
  hitChance: number;
  /** Approximate damage multiplier on a successful use, including expected multi-hit count. */
  successfulMultiplier: number;
}

export interface DamageMoveScoreInput {
  accuracy: number;
  actsBeforeThreat: boolean;
  expectedDamage: number;
  incomingDamage: number;
  isDelayed: boolean;
  priority: number;
  removesThreat: boolean;
  secondaryBenefit: number;
  successfulDamage: number;
  targetHp: number;
  userHp: number;
}

export interface LearnedMoveProfile {
  category: MoveCategory;
  hasStab: boolean;
  id: number;
  isUnimplemented: boolean;
  moveType: PokemonType;
  offensiveStatRatio: number;
  power: number;
  pp: number;
  priority: number;
  utility: number;
}

export type LearnMoveReplacementPlan = { index: number; kind: "REPLACE" } | { kind: "REJECT" };

/** Converts the game's `-1` always-hit sentinel into a hit probability. */
export function normalizeMoveAccuracy(accuracy: number): number {
  if (accuracy === -1) {
    return 1;
  }
  if (!Number.isFinite(accuracy)) {
    return 0;
  }
  return Math.max(0, Math.min(1, accuracy / 100));
}

/**
 * Converts the move database's effective-power forecast into live damage multipliers.
 * Effective power already models accuracy, multi-hit count, charge turns, and recharge turns.
 */
export function calculateMoveExecution(input: MoveExecutionInput): MoveExecutionForecast {
  const hitChance = normalizeMoveAccuracy(input.battleAccuracy);
  if (hitChance <= 0) {
    return { expectedMultiplier: 0, hitChance: 0, successfulMultiplier: 0 };
  }

  const turnCost = Math.max(1, input.turnCost);
  const baseHitChance = normalizeMoveAccuracy(input.baseAccuracy);
  if (input.basePower > 0 && input.effectivePower > 0 && baseHitChance > 0) {
    const successfulMultiplier = Math.max(0, (input.effectivePower / input.basePower) * (turnCost / baseHitChance));
    return {
      expectedMultiplier: (successfulMultiplier * hitChance) / turnCost,
      hitChance,
      successfulMultiplier,
    };
  }

  // Fixed- and variable-damage moves cannot expose a useful static power ratio.
  return {
    expectedMultiplier: hitChance / turnCost,
    hitChance,
    successfulMultiplier: 1,
  };
}

function getKnockoutBonus(canKoOnHit: boolean, reliableKo: boolean, hitChance: number): number {
  return (canKoOnHit ? 45 * hitChance : 0) + (reliableKo ? 25 * hitChance : 0);
}

function getPriorityAdjustment(priority: number, incomingIsLethal: boolean): number {
  if (priority > 0) {
    return 8;
  }
  return priority < 0 && incomingIsLethal ? -25 : 0;
}

function getThreatAdjustment(input: {
  actsBeforeThreat: boolean;
  canKoOnHit: boolean;
  incomingIsLethal: boolean;
  removesThreat: boolean;
}): number {
  const preventsDamage = input.canKoOnHit && input.removesThreat && input.actsBeforeThreat;
  if (input.incomingIsLethal) {
    return preventsDamage ? 85 : -45;
  }
  return preventsDamage ? 15 : 0;
}

/** Scores a live native damage forecast as a percentage of the target's current HP. */
export function scoreDamagingMove(input: DamageMoveScoreInput): number {
  const hitChance = normalizeMoveAccuracy(input.accuracy);
  if (hitChance <= 0 || input.expectedDamage <= 0 || input.successfulDamage <= 0) {
    return MOVE_FAILURE_SCORE;
  }

  const targetHp = Math.max(1, input.targetHp);
  const expectedPressure = Math.min(input.expectedDamage / targetHp, 2.5) * 100;
  const canKoOnHit = !input.isDelayed && input.successfulDamage >= targetHp;
  const reliableKo = canKoOnHit && input.successfulDamage * 0.85 >= targetHp;
  const incomingIsLethal = input.incomingDamage >= Math.max(1, input.userHp);

  return (
    expectedPressure
    + getKnockoutBonus(canKoOnHit, reliableKo, hitChance)
    + getPriorityAdjustment(input.priority, incomingIsLethal)
    + getThreatAdjustment({
      actsBeforeThreat: input.actsBeforeThreat,
      canKoOnHit,
      incomingIsLethal,
      removesThreat: input.removesThreat,
    })
    + Math.max(-30, Math.min(30, input.secondaryBenefit))
  );
}

/** Static value used when deciding whether a newly learned move improves a four-move set. */
export function scoreLearnedMove(profile: LearnedMoveProfile): number {
  if (profile.isUnimplemented) {
    return -1000;
  }

  const ppBonus = Math.min(Math.max(profile.pp, 0), 20) * 0.15;
  if (profile.category === MoveCategory.STATUS) {
    return 34 + profile.utility + Math.max(0, profile.priority) * 4 + ppBonus;
  }

  const statFit = Math.max(0.35, Math.min(1.2, profile.offensiveStatRatio));
  const stabMultiplier = profile.hasStab ? 1.3 : 1;
  return profile.power * statFit * stabMultiplier + profile.utility + profile.priority * 4 + ppBonus;
}

/** Values a complete moveset, rewarding useful coverage while preventing all-status sets. */
export function scoreLearnedMoveset(profiles: readonly LearnedMoveProfile[]): number {
  const damagingMoves = profiles.filter(profile => profile.category !== MoveCategory.STATUS);
  if (damagingMoves.length === 0) {
    return -1000;
  }

  const damagingTypes = new Set(damagingMoves.map(profile => profile.moveType));
  const stabTypes = new Set(damagingMoves.filter(profile => profile.hasStab).map(profile => profile.moveType));
  const statusCount = profiles.length - damagingMoves.length;
  const excessStatusPenalty = Math.max(0, statusCount - 2) * 20;

  return (
    profiles.reduce((total, profile) => total + scoreLearnedMove(profile), 0)
    + damagingTypes.size * 8
    + stabTypes.size * 12
    - excessStatusPenalty
  );
}

/** Chooses the deterministic old slot whose replacement produces the best four-move set. */
export function planLearnMoveReplacement(
  currentProfiles: readonly LearnedMoveProfile[],
  incomingProfile: LearnedMoveProfile,
): LearnMoveReplacementPlan {
  if (currentProfiles.length < 4 || incomingProfile.isUnimplemented) {
    return { kind: "REJECT" };
  }

  let bestScore = scoreLearnedMoveset(currentProfiles);
  let bestIndex = -1;
  for (let index = 0; index < currentProfiles.length; index++) {
    const candidateProfiles = currentProfiles.map((profile, candidateIndex) =>
      candidateIndex === index ? incomingProfile : profile,
    );
    const candidateScore = scoreLearnedMoveset(candidateProfiles);
    if (candidateScore > bestScore + 1) {
      bestScore = candidateScore;
      bestIndex = index;
    }
  }

  return bestIndex >= 0 ? { index: bestIndex, kind: "REPLACE" } : { kind: "REJECT" };
}

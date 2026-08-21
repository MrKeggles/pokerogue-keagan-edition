import { globalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";

export const BATTLE_ANIM_PHASE_TIMEOUT_MS = 20_000;
const PHASE_COMPLETION_STANDBY_RECHECK_MS = 50;

/**
 * Creates an exactly-once completion callback for asynchronous phases.
 *
 * A late callback from a phase that has already timed out is ignored. If the phase was replaced by a queue reset,
 * its callback is discarded instead of advancing the unrelated current phase. A temporarily overridden phase waits
 * until it is restored before ending.
 */
export function createPhaseCompletionGuard(
  phase: Phase,
  timeoutMs: number,
  timeoutMessage: string,
  onComplete: () => void = () => phase.end(),
): () => void {
  let completed = false;
  let completionTimer: ReturnType<typeof setTimeout> | undefined;

  const clearCompletionTimer = () => {
    if (completionTimer !== undefined) {
      clearTimeout(completionTimer);
      completionTimer = undefined;
    }
  };

  const complete = () => {
    if (completed) {
      return;
    }

    const phaseManager = globalScene.phaseManager;
    if (phaseManager.getCurrentPhase() === phase) {
      completed = true;
      clearCompletionTimer();
      onComplete();
      return;
    }

    if (phaseManager.getStandbyPhase() === phase) {
      clearCompletionTimer();
      completionTimer = setTimeout(complete, PHASE_COMPLETION_STANDBY_RECHECK_MS);
      return;
    }

    completed = true;
    clearCompletionTimer();
  };

  completionTimer = setTimeout(() => {
    console.warn(`[Battle recovery] ${timeoutMessage}`);
    complete();
  }, timeoutMs);

  return complete;
}

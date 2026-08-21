import { Phase } from "#app/phase";
import { initMoveAnim, loadMoveAnimAssets } from "#data/battle-anims";
import type { MoveId } from "#enums/move-id";
import { createPhaseCompletionGuard } from "#phases/phase-completion-guard";

/** Dynamic move animation assets must never prevent the battle phase queue from advancing indefinitely. */
export const LOAD_MOVE_ANIM_PHASE_TIMEOUT_MS = 30_000;

/**
 * Phase for synchronous move animation loading.
 * Should be used when a move invokes another move that
 * isn't already loaded (e.g. for Metronome)
 */
export class LoadMoveAnimPhase extends Phase {
  public readonly phaseName = "LoadMoveAnimPhase";
  constructor(protected moveId: MoveId) {
    super();
  }

  public override start(): void {
    const complete = createPhaseCompletionGuard(
      this,
      LOAD_MOVE_ANIM_PHASE_TIMEOUT_MS,
      `Move animation loading timed out after ${LOAD_MOVE_ANIM_PHASE_TIMEOUT_MS}ms; continuing the battle.`,
    );

    try {
      void initMoveAnim(this.moveId)
        .then(() => loadMoveAnimAssets([this.moveId], true))
        .then(complete)
        .catch(error => {
          console.error("[Battle recovery] Move animation loading failed; continuing the battle.", error);
          complete();
        });
    } catch (error) {
      console.error("[Battle recovery] Move animation loading failed; continuing the battle.", error);
      complete();
    }
  }
}

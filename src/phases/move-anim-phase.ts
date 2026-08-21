import { Phase } from "#app/phase";
import type { MoveAnim } from "#data/battle-anims";
import { BATTLE_ANIM_PHASE_TIMEOUT_MS, createPhaseCompletionGuard } from "#phases/phase-completion-guard";

/** Move animations are cosmetic and must not hold the battle phase queue indefinitely. */
export const MOVE_ANIM_PHASE_TIMEOUT_MS = BATTLE_ANIM_PHASE_TIMEOUT_MS;

/**
 * Plays the given {@linkcode MoveAnim} sequentially.
 */
export class MoveAnimPhase<Anim extends MoveAnim> extends Phase {
  public readonly phaseName = "MoveAnimPhase";

  constructor(
    protected anim: Anim,
    protected onSubstitute = false,
  ) {
    super();
  }

  public override start(): void {
    super.start();

    const complete = createPhaseCompletionGuard(
      this,
      MOVE_ANIM_PHASE_TIMEOUT_MS,
      `Move animation timed out after ${MOVE_ANIM_PHASE_TIMEOUT_MS}ms; continuing the battle.`,
    );

    try {
      this.anim.play(this.onSubstitute, complete);
    } catch (error) {
      console.error("[Battle recovery] Move animation failed; continuing the battle.", error);
      complete();
    }
  }
}

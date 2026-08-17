import { globalScene } from "#app/global-scene";
import { CommonBattleAnim } from "#data/battle-anims";
import type { BattlerIndex } from "#enums/battler-index";
import type { CommonAnim } from "#enums/move-anims-common";
import { PokemonPhase } from "#phases/pokemon-phase";

/**
 * Common animations are cosmetic and should never be able to stop battle progression indefinitely.
 * The longest shipped animation completes comfortably within this limit, including its audio tail.
 */
export const COMMON_ANIM_PHASE_TIMEOUT_MS = 20_000;
const COMMON_ANIM_STANDBY_RECHECK_MS = 50;

export class CommonAnimPhase extends PokemonPhase {
  // PokemonHealPhase extends CommonAnimPhase, and to make typescript happy,
  // we need to allow phaseName to be a union of the two
  public readonly phaseName: "CommonAnimPhase" | "PokemonHealPhase" | "WeatherEffectPhase" = "CommonAnimPhase";
  private anim: CommonAnim | null;
  private targetIndex?: BattlerIndex | undefined;

  // TODO: Why can common anim be null?
  // TODO: Pass in pokemon directly instead of operating with unsafe indices
  constructor(battlerIndex?: BattlerIndex, targetIndex?: BattlerIndex, anim: CommonAnim | null = null) {
    super(battlerIndex);

    this.anim = anim;
    this.targetIndex = targetIndex;
  }

  setAnimation(anim: CommonAnim) {
    this.anim = anim;
  }

  start(): void {
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
      if (phaseManager.getCurrentPhase() === this) {
        completed = true;
        clearCompletionTimer();
        this.end();
        return;
      }

      if (phaseManager.getStandbyPhase() === this) {
        // An overriding phase is temporarily active. It will restore this phase without restarting it, so defer
        // completion until that restoration occurs while retaining a single timer.
        clearCompletionTimer();
        completionTimer = setTimeout(complete, COMMON_ANIM_STANDBY_RECHECK_MS);
        return;
      }

      // The queue was reset while the animation was running. Discard its stale callback without advancing the newer
      // phase that is active now.
      completed = true;
      clearCompletionTimer();
    };

    completionTimer = setTimeout(() => {
      console.warn(`Common battle animation timed out after ${COMMON_ANIM_PHASE_TIMEOUT_MS}ms; continuing the battle.`);
      complete();
    }, COMMON_ANIM_PHASE_TIMEOUT_MS);

    try {
      const pokemon = this.getPokemon();
      const target =
        this.targetIndex === undefined
          ? pokemon
          : (this.player ? globalScene.getEnemyField() : globalScene.getPlayerField())[this.targetIndex];
      new CommonBattleAnim(this.anim, pokemon, target).play(false, complete);
    } catch (error) {
      console.error("Common battle animation failed; continuing the battle.", error);
      complete();
    }
  }
}

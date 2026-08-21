import { globalScene } from "#app/global-scene";
import { CommonBattleAnim } from "#data/battle-anims";
import type { BattlerIndex } from "#enums/battler-index";
import type { CommonAnim } from "#enums/move-anims-common";
import { BATTLE_ANIM_PHASE_TIMEOUT_MS, createPhaseCompletionGuard } from "#phases/phase-completion-guard";
import { PokemonPhase } from "#phases/pokemon-phase";

/**
 * Common animations are cosmetic and should never be able to stop battle progression indefinitely.
 * The longest shipped animation completes comfortably within this limit, including its audio tail.
 */
export const COMMON_ANIM_PHASE_TIMEOUT_MS = BATTLE_ANIM_PHASE_TIMEOUT_MS;

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
    const complete = createPhaseCompletionGuard(
      this,
      COMMON_ANIM_PHASE_TIMEOUT_MS,
      `Common battle animation timed out after ${COMMON_ANIM_PHASE_TIMEOUT_MS}ms; continuing the battle.`,
    );

    try {
      const pokemon = this.getPokemon();
      const target =
        this.targetIndex === undefined
          ? pokemon
          : (this.player ? globalScene.getEnemyField() : globalScene.getPlayerField())[this.targetIndex];
      new CommonBattleAnim(this.anim, pokemon, target).play(false, complete);
    } catch (error) {
      console.error("[Battle recovery] Common battle animation failed; continuing the battle.", error);
      complete();
    }
  }
}

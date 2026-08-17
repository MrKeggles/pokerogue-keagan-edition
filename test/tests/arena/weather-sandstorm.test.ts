import { settings } from "#app/global-settings-manager";
import { CommonBattleAnim } from "#data/battle-anims";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Weather - Sandstorm", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .weather(WeatherType.SANDSTORM)
      .battleStyle("single")
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP);
  });

  afterEach(() => {
    settings.update("display", "enableMoveAnimations", false);
  });

  it("inflicts damage equal to 1/16 of Pokemon's max HP at turn end", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    game.move.select(MoveId.SPLASH);

    await game.phaseInterceptor.to("TurnEndPhase");

    game.scene.getField(true).forEach(pokemon => {
      expect(pokemon.hp).toBe(pokemon.getMaxHp() - Math.max(Math.floor(pokemon.getMaxHp() / 16), 1));
    });
  });

  it("does not inflict damage to a Pokemon that is underwater (Dive) or underground (Dig)", async () => {
    game.override.moveset([MoveId.DIVE]);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    game.move.select(MoveId.DIVE);

    await game.phaseInterceptor.to("TurnEndPhase");

    const playerPokemon = game.field.getPlayerPokemon();
    const enemyPokemon = game.field.getEnemyPokemon();

    expect(playerPokemon.hp).toBe(playerPokemon.getMaxHp());
    expect(enemyPokemon.hp).toBe(enemyPokemon.getMaxHp() - Math.max(Math.floor(enemyPokemon.getMaxHp() / 16), 1));
  });

  it("does not inflict damage to Rock, Ground and Steel type Pokemon", async () => {
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.SANDSHREW)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH);

    await game.classicMode.startBattle(SpeciesId.ROCKRUFF, SpeciesId.KLINK);

    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);

    await game.phaseInterceptor.to("TurnEndPhase");

    game.scene.getField(true).forEach(pokemon => {
      expect(pokemon.hp).toBe(pokemon.getMaxHp());
    });
  });

  it("increases Rock type Pokemon Sp.Def by 50%", async () => {
    await game.classicMode.startBattle(SpeciesId.ROCKRUFF);

    const playerPokemon = game.field.getPlayerPokemon();
    const playerSpdef = playerPokemon.getStat(Stat.SPDEF);
    expect(playerPokemon.getEffectiveStat(Stat.SPDEF)).toBe(Math.floor(playerSpdef * 1.5));

    const enemyPokemon = game.field.getEnemyPokemon();
    const enemySpdef = enemyPokemon.getStat(Stat.SPDEF);
    expect(enemyPokemon.getEffectiveStat(Stat.SPDEF)).toBe(enemySpdef);
  });

  it("progresses past Sandstorm after Sand Stream's user KOs the opponent with animations enabled", async () => {
    settings.update("display", "enableMoveAnimations", true);
    const animationPlay = vi.spyOn(CommonBattleAnim.prototype, "play");
    game.override
      .weather(WeatherType.NONE)
      .ability(AbilityId.NO_GUARD)
      .passiveAbility(AbilityId.SAND_STREAM)
      .moveset(MoveId.SHEER_COLD)
      .startingLevel(100)
      .enemySpecies(SpeciesId.SURSKIT)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SANDSHREW);

    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.SANDSTORM);
    const animationsBeforeAttack = animationPlay.mock.calls.length;
    const enemy = game.field.getEnemyPokemon();

    game.move.select(MoveId.SHEER_COLD);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(enemy.isFainted()).toBe(true);
    expect(animationPlay.mock.calls.length).toBeGreaterThan(animationsBeforeAttack);
    expect(game.phaseInterceptor.log).toContain("WeatherEffectPhase");
    expect(game.phaseInterceptor.log.indexOf("WeatherEffectPhase")).toBeLessThan(
      game.phaseInterceptor.log.indexOf("TurnEndPhase"),
    );
  });
});

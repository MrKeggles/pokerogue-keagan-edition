/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AutoplayController } from "#app/autoplay-controller";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface AutoplayBattleHarness {
  chooseMove: (pokemon: PlayerPokemon) => { index: number; score: number; targetIndex: number | undefined };
  template: "FAST_FARM";
}

describe("Autoplay live battle selection", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("uses live physical and special stats instead of blindly choosing the higher-power move", async () => {
    game.override
      .moveset([MoveId.TACKLE, MoveId.SWIFT])
      .enemySpecies(SpeciesId.MEW)
      .enemyMoveset([MoveId.TACKLE])
      .startingLevel(50)
      .enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.RAMPARDOS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const tackleDamage = enemy.getAttackDamage({
      source: player,
      move: allMoves[MoveId.TACKLE],
      simulated: true,
    }).damage;
    const swiftDamage = enemy.getAttackDamage({ source: player, move: allMoves[MoveId.SWIFT], simulated: true }).damage;
    expect(tackleDamage).toBeGreaterThan(swiftDamage);

    const controller = Object.create(AutoplayController.prototype) as AutoplayBattleHarness;
    controller.template = "FAST_FARM";
    const choice = controller.chooseMove(player);
    expect(player.getMoveset()[choice.index].moveId).toBe(MoveId.TACKLE);
  });

  it("selects a lower-base-power typed counter when its real forecast is stronger", async () => {
    game.override
      .moveset([MoveId.HEADBUTT, MoveId.WATER_GUN])
      .enemySpecies(SpeciesId.CHARMANDER)
      .enemyMoveset([MoveId.SCRATCH])
      .startingLevel(20)
      .enemyLevel(20);
    await game.classicMode.startBattle(SpeciesId.SQUIRTLE);

    const player = game.field.getPlayerPokemon();
    const controller = Object.create(AutoplayController.prototype) as AutoplayBattleHarness;
    controller.template = "FAST_FARM";
    const choice = controller.chooseMove(player);
    expect(player.getMoveset()[choice.index].moveId).toBe(MoveId.WATER_GUN);
  });

  it("does not cache Tera Shell effectiveness while comparing candidate moves", async () => {
    game.override
      .moveset([MoveId.TACKLE, MoveId.WATER_GUN])
      .enemySpecies(SpeciesId.TERAPAGOS)
      .enemyAbility(AbilityId.TERA_SHELL)
      .enemyMoveset([MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.SQUIRTLE);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.turnData.moveEffectiveness).toBeNull();

    expect(enemy.getMoveEffectiveness(player, allMoves[MoveId.WATER_GUN], false, true)).toBe(0.5);
    expect(enemy.turnData.moveEffectiveness).toBeNull();
    expect(
      enemy.getAttackDamage({ source: player, move: allMoves[MoveId.WATER_GUN], simulated: true }).damage,
    ).toBeGreaterThan(0);
    expect(enemy.turnData.moveEffectiveness).toBeNull();

    const controller = Object.create(AutoplayController.prototype) as AutoplayBattleHarness;
    controller.template = "FAST_FARM";
    controller.chooseMove(player);
    expect(enemy.turnData.moveEffectiveness).toBeNull();
  });

  it.each([
    { blockedMove: MoveId.EXPLOSION, defenderAbility: AbilityId.DAMP },
    { blockedMove: MoveId.FISSURE, defenderAbility: AbilityId.STURDY },
  ])("previews $blockedMove without firing defensive abilities or queueing messages", async testCase => {
    game.override
      .moveset([testCase.blockedMove, MoveId.TACKLE])
      .enemyAbility(testCase.defenderAbility)
      .enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.SQUIRTLE);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const queueMessage = vi.spyOn(game.scene.phaseManager, "queueMessage");
    const queueAbilityDisplay = vi.spyOn(game.scene.phaseManager, "queueAbilityDisplay");
    const applyConditions = vi.spyOn(allMoves[testCase.blockedMove], "applyConditions");
    const waveAbilities = new Set(enemy.waveData.abilitiesApplied);
    const summonAbilities = new Set(enemy.summonData.abilitiesApplied);

    const controller = Object.create(AutoplayController.prototype) as AutoplayBattleHarness;
    controller.template = "FAST_FARM";
    const choice = controller.chooseMove(player);

    expect(player.getMoveset()[choice.index].moveId).toBe(MoveId.TACKLE);
    expect(queueMessage).not.toHaveBeenCalled();
    expect(queueAbilityDisplay).not.toHaveBeenCalled();
    expect(applyConditions).not.toHaveBeenCalled();
    expect(enemy.waveData.abilitiesApplied).toEqual(waveAbilities);
    expect(enemy.summonData.abilitiesApplied).toEqual(summonAbilities);
  });

  it("never runs Present's stateful damage preview", async () => {
    game.override.moveset([MoveId.PRESENT, MoveId.TACKLE]).enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.SQUIRTLE);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const getAttackDamage = vi.spyOn(enemy, "getAttackDamage");
    const hitCount = player.turnData.hitCount;
    const hitsLeft = player.turnData.hitsLeft;
    const queueMessage = vi.spyOn(game.scene.phaseManager, "queueMessage");

    const controller = Object.create(AutoplayController.prototype) as AutoplayBattleHarness;
    controller.template = "FAST_FARM";
    const choice = controller.chooseMove(player);

    expect(player.getMoveset()[choice.index].moveId).toBe(MoveId.TACKLE);
    expect(getAttackDamage.mock.calls.some(([input]) => input.move.id === MoveId.PRESENT)).toBe(false);
    expect(queueMessage).not.toHaveBeenCalled();
    expect(player.turnData.hitCount).toBe(hitCount);
    expect(player.turnData.hitsLeft).toBe(hitsLeft);
  });

  it("restores deterministic battle RNG after random-target forecasting", async () => {
    game.override.battleStyle("double").moveset([MoveId.THRASH, MoveId.TACKLE]).enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.TAUROS, SpeciesId.SQUIRTLE);

    const player = game.field.getPlayerPokemon();
    const battle = game.scene.currentBattle;
    const seedState = battle.captureSeedState();
    const controller = Object.create(AutoplayController.prototype) as AutoplayBattleHarness;
    controller.template = "FAST_FARM";
    controller.chooseMove(player);
    expect(battle.captureSeedState()).toBe(seedState);
  });
});

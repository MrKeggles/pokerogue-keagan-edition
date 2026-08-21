/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { pokerogueApi } from "#api/api";
import { AutoplayController } from "#app/autoplay-controller";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface AutoplayBattleHarness {
  chooseMove: (pokemon: PlayerPokemon) => { index: number; score: number; targetIndex: number | undefined };
  scoreMoveForTarget: (
    user: PlayerPokemon,
    target: Pokemon,
    moveIndex: number,
    targetIsAlly: boolean,
    incomingThreat: { damage: number; priority: number; source: Pokemon | null },
  ) => number;
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

  it("keeps matchup forecasting simulated so it cannot queue real battle messages", async () => {
    game.override.moveset([MoveId.TACKLE]).enemySpecies(SpeciesId.BULBASAUR).enemyMoveset([MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.SQUIRTLE);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const getAttackTypeEffectiveness = vi.spyOn(player, "getAttackTypeEffectiveness");

    player.getMatchupScore(enemy);

    expect(getAttackTypeEffectiveness).toHaveBeenCalledTimes(enemy.getTypes({ useIllusion: true }).length);
    expect(getAttackTypeEffectiveness.mock.calls.every(([, params]) => params?.simulated === true)).toBe(true);
  });

  it("does not score a move target that the battle engine will reject", async () => {
    game.override.battleStyle("double").moveset([MoveId.POLLEN_PUFF]).enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.BUTTERFREE, SpeciesId.BULBASAUR);

    const [player, ally] = game.scene.getPlayerField();
    const controller = Object.create(AutoplayController.prototype) as AutoplayBattleHarness;
    controller.template = "FAST_FARM";
    ally.addTag(BattlerTagType.HEAL_BLOCK);
    const scoreMoveForTarget = vi.spyOn(controller, "scoreMoveForTarget");

    const choice = controller.chooseMove(player);

    expect(player.isMoveTargetRestricted(MoveId.POLLEN_PUFF, ally)).toBe(true);
    expect(choice.targetIndex).toBeGreaterThanOrEqual(2);
    expect(scoreMoveForTarget.mock.calls.some(([, target]) => target === ally)).toBe(false);
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

  it("submits deterministic Struggle through the real command phase when native forecasting throws", async () => {
    game.override.moveset([MoveId.TACKLE]).enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.SQUIRTLE);

    const enemy = game.field.getEnemyPokemon();
    const getAttackDamage = enemy.getAttackDamage.bind(enemy);
    vi.spyOn(enemy, "getAttackDamage").mockImplementation(input => {
      if (input.simulated) {
        throw new Error("forecast failed");
      }
      return getAttackDamage(input);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const controller = (game.scene as unknown as { autoplayController: { act: () => void } }).autoplayController;
    expect(() => controller.act()).not.toThrow();

    expect(game.scene.currentBattle.turnCommands[0]).toMatchObject({
      command: Command.FIGHT,
      cursor: -1,
      move: {
        move: MoveId.STRUGGLE,
        targets: [enemy.getBattlerIndex()],
        useMode: MoveUseMode.IGNORE_PP,
      },
    });
    await game.phaseInterceptor.to("EnemyCommandPhase");
  });

  it("crosses an ordinary encounter boundary without remote verification and commands the next battle", async () => {
    game.override.moveset([MoveId.TACKLE]).enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.SQUIRTLE);

    const controller = (
      game.scene as unknown as {
        autoplayController: { enabled: boolean; nextActionAt: number; update: (time: number) => void };
      }
    ).autoplayController;
    const verifyRemote = vi.spyOn(pokerogueApi.savedata.system, "verify");
    game.field.getEnemyPokemon().hp = 1;
    const runAutoplayTick = (time: number) => {
      controller.enabled = true;
      controller.nextActionAt = 0;
      controller.update(time);
      controller.enabled = false;
    };

    runAutoplayTick(1_000);
    await game.phaseInterceptor.to("SelectModifierPhase");
    game.doSelectModifier();
    await game.phaseInterceptor.to("CommandPhase");

    expect(game.scene.currentBattle.waveIndex).toBe(2);
    expect(verifyRemote).not.toHaveBeenCalled();
    runAutoplayTick(2_000);
    await game.phaseInterceptor.to("EnemyCommandPhase");
  }, 60_000);
});

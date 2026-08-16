import { AutoplayController } from "#app/autoplay-controller";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { LearnMovePhase } from "#phases/learn-move-phase";
import { GameManager } from "#test/framework/game-manager";
import { SummaryUiHandler, SummaryUiMode } from "#ui/summary-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Learn Move Phase", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override //
      .xpMultiplier(50)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("consumes a learn-move summary callback only once during an asynchronous screen transition", () => {
    const moveSelectFunction = vi.fn();
    const handlers: { active: boolean }[] = [];
    handlers[UiMode.PARTY] = { active: false };
    const ui = { handlers, playError: vi.fn(), playSelect: vi.fn() };
    const handler = Object.create(SummaryUiHandler.prototype) as {
      getUi: () => typeof ui;
      moveCursor: number;
      moveSelect: boolean;
      moveSelectFunction: ((moveIndex: number) => void) | null;
      pokemon: { moveset: object[] };
      processInput: (button: Button) => boolean;
      summaryUiMode: SummaryUiMode;
      transitioning: boolean;
    };
    handler.getUi = () => ui;
    handler.transitioning = false;
    handler.moveSelect = true;
    handler.moveCursor = 0;
    handler.pokemon = { moveset: [{}] };
    handler.summaryUiMode = SummaryUiMode.LEARN_MOVE;
    handler.moveSelectFunction = moveSelectFunction;

    expect(handler.processInput(Button.ACTION)).toBe(true);
    expect(handler.processInput(Button.ACTION)).toBe(true);
    expect(moveSelectFunction).toHaveBeenCalledTimes(1);
    expect(moveSelectFunction).toHaveBeenCalledWith(0);
  });

  it("If Pokemon has less than 4 moves, its newest move will be added to the lowest empty index", async () => {
    game.override.moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const pokemon = game.field.getPlayerPokemon();
    const newMovePos = pokemon.getMoveset().length;
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();
    await game.phaseInterceptor.to("LearnMovePhase");
    const levelMove = pokemon.getLevelMoves({ startingLevel: 5 })[0];
    const levelReq = levelMove[0];
    const levelMoveId = levelMove[1];
    expect(pokemon.level).toBeGreaterThanOrEqual(levelReq);
    expect(pokemon.moveset[newMovePos]?.moveId).toBe(levelMoveId);
  });

  it("If a pokemon has 4 move slots filled, the chosen move will be deleted and replaced", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const bulbasaur = game.field.getPlayerPokemon();
    const prevMoveset = [MoveId.SPLASH, MoveId.ABSORB, MoveId.ACID, MoveId.VINE_WHIP];
    const moveSlotNum = 3;

    game.move.changeMoveset(bulbasaur, prevMoveset);
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();

    // queue up inputs to confirm dialog boxes
    game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
      game.scene.ui.processInput(Button.ACTION);
    });
    game.onNextPrompt("LearnMovePhase", UiMode.SUMMARY, () => {
      game.scene.ui.setCursor(moveSlotNum);
      game.scene.ui.processInput(Button.ACTION);
    });
    await game.phaseInterceptor.to("LearnMovePhase");

    const levelMove = bulbasaur.getLevelMoves({ startingLevel: 5 })[0];
    const levelReq = levelMove[0];
    const levelMoveId = levelMove[1];
    expect(bulbasaur.level).toBeGreaterThanOrEqual(levelReq);
    // Check each of mr mime's moveslots to make sure the changed move (and ONLY the changed move) is different
    bulbasaur.getMoveset().forEach((move, index) => {
      const expectedMove: MoveId = index === moveSlotNum ? levelMoveId : prevMoveset[index];
      expect(move.moveId).toBe(expectedMove);
    });
  });

  it("autoplay retries a busy summary once, submits once, and learns the better move", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const bulbasaur = game.field.getPlayerPokemon();
    const previousMoves = [MoveId.SPLASH, MoveId.ABSORB, MoveId.ACID, MoveId.VINE_WHIP];
    game.move.changeMoveset(bulbasaur, previousMoves);
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();

    game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
      game.scene.ui.processInput(Button.ACTION);
    });
    game.onNextPrompt("LearnMovePhase", UiMode.SUMMARY, () => {
      const phase = game.scene.phaseManager.getCurrentPhase() as LearnMovePhase;
      const handler = game.scene.ui.getHandler() as SummaryUiHandler;
      const originalSelectMoveForLearning = handler.selectMoveForLearning.bind(handler);
      const selectMoveForLearning = vi
        .spyOn(handler, "selectMoveForLearning")
        .mockImplementationOnce(() => false)
        .mockImplementation(originalSelectMoveForLearning);
      const pauseForSafety = vi.fn();
      const controller = Object.create(AutoplayController.prototype) as {
        handleLearnMoveSummary: (phase: LearnMovePhase) => void;
        pauseForSafety: (reason: string) => void;
      };
      controller.pauseForSafety = pauseForSafety;

      controller.handleLearnMoveSummary(phase);
      controller.handleLearnMoveSummary(phase);
      controller.handleLearnMoveSummary(phase);

      expect(selectMoveForLearning).toHaveBeenCalledTimes(2);
      expect(pauseForSafety).not.toHaveBeenCalled();
    });
    await game.phaseInterceptor.to("LearnMovePhase");

    const learnedMove = bulbasaur.getLevelMoves({ startingLevel: 5 })[0][1];
    expect(bulbasaur.getMoveset().map(move => move.moveId)).toContain(learnedMove);
    expect(bulbasaur.getMoveset().map(move => move.moveId)).not.toContain(MoveId.SPLASH);
  });

  it("selecting the newly deleted move will reject it and keep old moveset", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const bulbasaur = game.field.getPlayerPokemon();
    const prevMoveset = [MoveId.SPLASH, MoveId.ABSORB, MoveId.ACID, MoveId.VINE_WHIP];

    game.move.changeMoveset(bulbasaur, [MoveId.SPLASH, MoveId.ABSORB, MoveId.ACID, MoveId.VINE_WHIP]);
    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();

    // queue up inputs to confirm dialog boxes
    game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
      game.scene.ui.processInput(Button.ACTION);
    });
    game.onNextPrompt("LearnMovePhase", UiMode.SUMMARY, () => {
      game.scene.ui.setCursor(4);
      game.scene.ui.processInput(Button.ACTION);
    });
    game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
      game.scene.ui.processInput(Button.ACTION);
    });
    await game.phaseInterceptor.to("LearnMovePhase");

    const levelReq = bulbasaur.getLevelMoves({ startingLevel: 5 })[0][0];
    expect(bulbasaur.level).toBeGreaterThanOrEqual(levelReq);
    expect(bulbasaur.getMoveset().map(m => m.moveId)).toEqual(prevMoveset);
  });

  it("pressing cancel multiple times will stop learning move when level move confirmation is disabled", async () => {
    game.settings.levelMoveConfirmation(false);
    game.override.levelCap(9);

    await game.classicMode.startBattle(SpeciesId.BULBASAUR);

    const bulbasaur = game.field.getPlayerPokemon();
    const prevMoveset = [MoveId.SPLASH, MoveId.ABSORB, MoveId.ACID, MoveId.VINE_WHIP];

    game.move.changeMoveset(bulbasaur, prevMoveset);

    game.move.select(MoveId.SPLASH);
    await game.doKillOpponents();

    // queue up inputs to confirm dialog boxes
    game.onNextPrompt("LearnMovePhase", UiMode.CONFIRM, () => {
      game.scene.ui.processInput(Button.CANCEL);
    });
    game.onNextPrompt("LearnMovePhase", UiMode.MESSAGE, () => {
      game.scene.ui.processInput(Button.CANCEL);
    });

    await game.phaseInterceptor.to("LearnMovePhase");

    const levelReq = bulbasaur.getLevelMoves({ startingLevel: 5 })[0][0];
    expect(bulbasaur.level).toBeGreaterThanOrEqual(levelReq);
    expect(bulbasaur.getMoveset().map(m => m.moveId)).toEqual(prevMoveset);
  });
});

import { shouldIgnoreGameplayKeyboardEvent } from "#app/inputs-controller";
import { Button } from "#enums/buttons";
import { CFG_KEYBOARD_QWERTY } from "#inputs/cfg-keyboard-qwerty";
import { PAD_XBOX360 } from "#inputs/pad-xbox360";
import { GameManager } from "#test/framework/game-manager";
import { InputsHandler } from "#test/framework/inputs-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Inputs", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let originalDocument: Document;

  beforeAll(() => {
    originalDocument = window.document;
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "document", {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.inputsHandler = new InputsHandler(game.scene);
  });

  it("Mobile - test touch holding for 1ms - 1 input", async () => {
    await game.inputsHandler.pressTouch("dpadUp", 1);
    expect(game.inputsHandler.log.length).toBe(1);
  });

  it("Mobile - test touch holding for 200ms - 1 input", async () => {
    await game.inputsHandler.pressTouch("dpadUp", 200);
    expect(game.inputsHandler.log.length).toBe(1);
  });

  it("Mobile - test touch holding for 300ms - 2 input", async () => {
    await game.inputsHandler.pressTouch("dpadUp", 300);
    expect(game.inputsHandler.log.length).toBe(2);
    expect(game.inputsHandler.log.map(event => event.repeat)).toEqual([false, true]);
  });

  it("Mobile - test touch holding for 1000ms - 4 input", async () => {
    await game.inputsHandler.pressTouch("dpadUp", 1050);
    expect(game.inputsHandler.log.length).toBe(5);
  });

  it("keyboard - test input holding for 200ms - 1 input", async () => {
    await game.inputsHandler.pressKeyboardKey(CFG_KEYBOARD_QWERTY.deviceMapping.KEY_ARROW_UP, 200);
    expect(game.inputsHandler.log.length).toBe(1);
  });

  it("keyboard - test input holding for 300ms - 2 input", async () => {
    await game.inputsHandler.pressKeyboardKey(CFG_KEYBOARD_QWERTY.deviceMapping.KEY_ARROW_UP, 300);
    expect(game.inputsHandler.log.length).toBe(2);
    expect(game.inputsHandler.log.map(event => event.repeat)).toEqual([false, true]);
  });

  it("keyboard - test input holding for 1000ms - 4 input", async () => {
    await game.inputsHandler.pressKeyboardKey(CFG_KEYBOARD_QWERTY.deviceMapping.KEY_ARROW_UP, 1050);
    expect(game.inputsHandler.log.length).toBe(5);
  });

  it("keyboard - ignores a stray keyup without unlocking another held button", () => {
    const inputController = game.scene.inputController as unknown as { buttonLock: Button[] };
    game.scene.input.keyboard?.emit("keydown", { keyCode: CFG_KEYBOARD_QWERTY.deviceMapping.KEY_ARROW_UP });

    expect(inputController.buttonLock).toEqual([Button.UP]);

    game.scene.input.keyboard?.emit("keyup", { keyCode: CFG_KEYBOARD_QWERTY.deviceMapping.KEY_ARROW_DOWN });
    expect(inputController.buttonLock).toEqual([Button.UP]);

    game.scene.input.keyboard?.emit("keyup", { keyCode: CFG_KEYBOARD_QWERTY.deviceMapping.KEY_ARROW_UP });
  });

  it("keyboard - ignores a native repeat after pressed state is cleared", () => {
    const inputController = game.scene.inputController as unknown as {
      buttonLock: Button[];
      deactivatePressedKey: () => void;
    };

    game.scene.input.keyboard?.emit("keydown", {
      keyCode: CFG_KEYBOARD_QWERTY.deviceMapping.KEY_ARROW_UP,
      repeat: false,
    });
    inputController.deactivatePressedKey();
    game.scene.input.keyboard?.emit("keydown", {
      keyCode: CFG_KEYBOARD_QWERTY.deviceMapping.KEY_ARROW_UP,
      repeat: true,
    });

    expect(game.inputsHandler.log).toHaveLength(1);
    expect(game.inputsHandler.log[0].repeat).toBe(false);
    expect(inputController.buttonLock).toEqual([]);
    game.scene.input.keyboard?.emit("keyup", { keyCode: CFG_KEYBOARD_QWERTY.deviceMapping.KEY_ARROW_UP });
  });

  it("keyboard - keeps OS shortcuts and autoplay hotkeys out of gameplay input", () => {
    expect(
      shouldIgnoreGameplayKeyboardEvent({
        altKey: true,
        code: "Tab",
        ctrlKey: false,
        isComposing: false,
        metaKey: false,
        repeat: false,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreGameplayKeyboardEvent({
        altKey: false,
        code: "KeyS",
        ctrlKey: false,
        isComposing: false,
        metaKey: true,
        repeat: false,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreGameplayKeyboardEvent({
        altKey: false,
        code: "F8",
        ctrlKey: false,
        isComposing: false,
        metaKey: false,
        repeat: false,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreGameplayKeyboardEvent({
        altKey: false,
        code: "ArrowUp",
        ctrlKey: false,
        isComposing: false,
        metaKey: false,
        repeat: false,
      }),
    ).toBe(false);

    game.scene.input.keyboard?.emit("keydown", {
      code: "ShiftLeft",
      keyCode: CFG_KEYBOARD_QWERTY.deviceMapping.KEY_SHIFT,
      metaKey: true,
      repeat: false,
    });
    expect(game.inputsHandler.log).toHaveLength(0);
  });

  it("gamepad - test input holding for 1ms - 1 input", async () => {
    await game.inputsHandler.pressGamepadButton(PAD_XBOX360.deviceMapping.RC_S, 1);
    expect(game.inputsHandler.log.length).toBe(1);
  });

  it("gamepad - test input holding for 200ms - 1 input", async () => {
    await game.inputsHandler.pressGamepadButton(PAD_XBOX360.deviceMapping.RC_S, 200);
    expect(game.inputsHandler.log.length).toBe(1);
  });

  it("gamepad - test input holding for 300ms - 2 input", async () => {
    await game.inputsHandler.pressGamepadButton(PAD_XBOX360.deviceMapping.RC_S, 300);
    expect(game.inputsHandler.log.length).toBe(2);
    expect(game.inputsHandler.log.map(event => event.repeat)).toEqual([false, true]);
  });

  it("gamepad - test input holding for 1000ms - 4 input", async () => {
    await game.inputsHandler.pressGamepadButton(PAD_XBOX360.deviceMapping.RC_S, 1050);
    expect(game.inputsHandler.log.length).toBe(5);
  });
});

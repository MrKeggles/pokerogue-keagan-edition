/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { validateDailySeedSchema } from "#data/daily-seed/schema-validator.generated";
import { describe, expect, it } from "vitest";

describe("daily-seed schema validator", () => {
  it("accepts a representative custom daily-run configuration", () => {
    const config = {
      seed: "standalone-validator-test",
      starters: [
        {
          speciesId: 1,
          formIndex: 0,
          variant: 2,
          moveset: [1, 2, 3, 4],
          nature: 24,
          ability: 1,
          passive: 1,
        },
      ],
      boss: {
        speciesId: 1024,
        segments: 3,
        catchable: false,
      },
      biome: 0,
      luck: 14,
      startingMoney: 0,
      forcedWaves: [
        { waveIndex: 1, speciesId: 25, hiddenAbility: true },
        { waveIndex: 49, tier: 8 },
      ],
      trainerManipulations: [{ waveIndex: 1, isTrainer: false }],
      challenges: [{ id: 0, value: 1 }],
      mysteryEncounters: [{ waveIndex: 49, type: 0 }],
    };

    expect(validateDailySeedSchema(config)).toBe(true);
    expect(validateDailySeedSchema.errors).toBeNull();
  });

  it.each([
    ["a missing seed", {}],
    ["an unknown top-level property", { seed: "test", unknown: true }],
    ["too many luck points", { seed: "test", luck: 15 }],
    ["an empty starter list", { seed: "test", starters: [] }],
    ["a non-integer species ID", { seed: "test", starters: [{ speciesId: 1.5 }] }],
    ["a forced wave with neither a species nor a tier", { seed: "test", forcedWaves: [{ waveIndex: 1 }] }],
    [
      "a forced wave with both a species and a tier",
      { seed: "test", forcedWaves: [{ waveIndex: 1, speciesId: 25, tier: 1 }] },
    ],
  ])("rejects %s", (_description, config) => {
    expect(validateDailySeedSchema(config)).toBe(false);
    expect(validateDailySeedSchema.errors).not.toBeNull();
  });

  it("reports every independent validation failure", () => {
    expect(validateDailySeedSchema({ seed: 42, luck: 15, unknown: true })).toBe(false);

    expect(validateDailySeedSchema.errors?.map(error => error.instancePath)).toEqual(
      expect.arrayContaining(["", "/luck", "/seed"]),
    );
  });
});

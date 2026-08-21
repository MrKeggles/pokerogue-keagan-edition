import { AnimConfig, chargeAnims, initMoveChargeAnim } from "#data/battle-anims";
import { ChargeAnim } from "#enums/move-anims-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("move charge animation loading", () => {
  const fetchFailureChargeAnim = 900_001 as ChargeAnim;
  const jsonFailureChargeAnim = 900_002 as ChargeAnim;
  const testChargeAnimNames = new Map<ChargeAnim, string>([
    [fetchFailureChargeAnim, "TEST_FETCH_FAILURE_CHARGING"],
    [jsonFailureChargeAnim, "TEST_JSON_FAILURE_CHARGING"],
  ]);
  const testChargeAnims = [...testChargeAnimNames.keys()];

  const clearTestChargeAnims = () => {
    for (const chargeAnim of testChargeAnims) {
      chargeAnims.delete(chargeAnim);
    }
  };

  beforeAll(() => {
    for (const [chargeAnim, name] of testChargeAnimNames) {
      Object.defineProperty(ChargeAnim, chargeAnim, { configurable: true, value: name });
    }
  });

  afterAll(() => {
    for (const chargeAnim of testChargeAnims) {
      Reflect.deleteProperty(ChargeAnim, chargeAnim);
    }
  });

  // Vitest runs this project with `isolate: false`, so another test file may have
  // active animation loads. Synthetic IDs keep this suite independent from them,
  // while symmetric cleanup prevents these entries from leaking into later files.
  beforeEach(clearTestChargeAnims);
  afterEach(clearTestChargeAnims);

  it("settles with an empty animation when fetching the config fails", async () => {
    const fetchError = new Error("charge animation unavailable");
    const expectedUrl = "./battle-anims/test-fetch-failure-charging.json";
    const fetchAnim = vi.fn((_url: string, _init?: RequestInit): Promise<Response> => Promise.reject(fetchError));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(initMoveChargeAnim(fetchFailureChargeAnim, fetchAnim)).resolves.toBeUndefined();

    const fallback = chargeAnims.get(fetchFailureChargeAnim);
    expect(fallback).toBeInstanceOf(AnimConfig);
    expect((fallback as AnimConfig).frames).toEqual([]);
    expect(fetchAnim).toHaveBeenCalledOnce();
    expect(fetchAnim).toHaveBeenCalledWith(expectedUrl);
    expect(consoleWarn).toHaveBeenCalledWith(
      "[Battle recovery] Could not load charge animation file 'test-fetch-failure-charging'",
      fetchError,
    );
  });

  it("releases concurrent callers when parsing the config fails", async () => {
    const jsonError = new Error("invalid charge animation JSON");
    const expectedUrl = "./battle-anims/test-json-failure-charging.json";
    const json = vi.fn().mockRejectedValueOnce(jsonError);
    const fetchAnim = vi.fn((_url: string, _init?: RequestInit): Promise<Response> => {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json,
      } as unknown as Response);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const firstLoad = initMoveChargeAnim(jsonFailureChargeAnim, fetchAnim);
    const concurrentLoad = initMoveChargeAnim(jsonFailureChargeAnim);

    expect(concurrentLoad).toBe(firstLoad);
    await expect(Promise.all([firstLoad, concurrentLoad])).resolves.toEqual([undefined, undefined]);
    expect(fetchAnim).toHaveBeenCalledOnce();
    expect(fetchAnim).toHaveBeenCalledWith(expectedUrl);
    expect(json).toHaveBeenCalledOnce();

    const fallback = chargeAnims.get(jsonFailureChargeAnim);
    expect(fallback).toBeInstanceOf(AnimConfig);
    expect((fallback as AnimConfig).frames).toEqual([]);
  });
});

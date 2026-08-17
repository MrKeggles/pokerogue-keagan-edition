import { API_REQUEST_TIMEOUT_MS, ApiBase, ApiRequestTimeoutError } from "#api/api-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class TestApi extends ApiBase {
  public get(path: string, signal?: AbortSignal): Promise<Response> {
    return signal ? this.doFetch(path, { method: "GET", signal }) : this.doFetch(path, { method: "GET" });
  }
}

describe("ApiBase request deadlines", () => {
  const api = new TestApi("https://api.example.test");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("times out while waiting for response headers and aborts fetch", async () => {
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        fetchSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    );

    const request = api.get("/savedata/system/verify?clientSessionId=do-not-log");
    const rejection = expect(request).rejects.toBeInstanceOf(ApiRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    await rejection;

    expect(fetchSignal?.aborted).toBe(true);
    expect(console.debug).toHaveBeenCalledWith(
      expect.stringMatching(/^\[API\] GET \/savedata\/system\/verify -> timeout \(25000 ms\)$/),
    );
    expect(console.debug).not.toHaveBeenCalledWith(expect.stringContaining("clientSessionId"));
    expect(console.debug).not.toHaveBeenCalledWith(expect.stringContaining("do-not-log"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the deadline active while buffering the response body", async () => {
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        fetchSignal = init?.signal ?? undefined;
        return Promise.resolve({
          status: 200,
          statusText: "OK",
          headers: new Headers(),
          arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
        } as Response);
      }),
    );

    const request = api.get("/savedata/session/get?slot=1");
    const rejection = expect(request).rejects.toBeInstanceOf(ApiRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);
    await rejection;

    expect(fetchSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates a caller abort and removes its timeout", async () => {
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        fetchSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    );
    const callerController = new AbortController();
    const request = api.get("/account/info", callerController.signal);
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });

    callerController.abort();
    await rejection;

    expect(fetchSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a reusable buffered response without stale transport headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response('{"ok":true}', {
            status: 200,
            headers: {
              "Content-Encoding": "gzip",
              "Content-Length": "999",
              "Transfer-Encoding": "chunked",
            },
          }),
        ),
      ),
    );

    const response = await api.get("/game/titlestats");

    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("Transfer-Encoding")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

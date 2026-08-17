import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import { version } from "#package.json";
import { getCookie } from "#utils/cookies";

type DataType = "json" | "form-urlencoded";

/** Total deadline for receiving both API response headers and body data. */
export const API_REQUEST_TIMEOUT_MS = 25_000;

/** Raised when an API request exceeds {@linkcode API_REQUEST_TIMEOUT_MS}. */
export class ApiRequestTimeoutError extends Error {
  public readonly code = "ETIMEDOUT";

  constructor(method: string, pathname: string, timeoutMs: number) {
    super(`${method.toUpperCase()} ${pathname} timed out after ${timeoutMs} ms.`);
    this.name = "ApiRequestTimeoutError";
  }
}

/**
 * Configuration type for {@linkcode ApiBase.doFetch}.
 * @internal
 */
interface DoFetchConfig extends RequestInit {
  method: string;
}

export abstract class ApiBase {
  // TODO: Make constant in outer scope
  public readonly ERR_GENERIC: string = "There was an error";

  /** The base URL for HTTP requests. */
  protected readonly base: string;

  constructor(base: string) {
    this.base = base;
  }

  /**
   * Send an HTTP GET request.
   * @param path - The path to send the request to
   */
  protected async doGet(path: string): Promise<Response> {
    return this.doFetch(path, { method: "GET" });
  }

  /**
   * Send an HTTP POST request.
   * @param path - The path to send the request to
   * @param bodyData - The body-data to send; will be stringified if needed
   * @param dataType - (Default `"json"`) The type of data to send
   */
  protected async doPost(path: string, bodyData?: Record<string, any> | string, dataType?: "json"): Promise<Response>;
  /**
   * Send an HTTP POST request.
   * @param path - The path to send the request to
   * @param bodyData - The body-data to send; will be stringified if needed
   * @param dataType - (Default `"json"`) The type of data to send
   */
  protected async doPost(path: string, bodyData: Record<string, any>, dataType: "form-urlencoded"): Promise<Response>;
  protected async doPost(path: string, bodyData?: Record<string, any>, dataType: DataType = "json"): Promise<Response> {
    if (bodyData === undefined) {
      return this.doFetch(path, { method: "POST" });
    }

    let body: string;
    const headers: HeadersInit = {};

    switch (dataType) {
      case "json":
        body = typeof bodyData === "string" ? bodyData : JSON.stringify(bodyData);
        headers["Content-Type"] = "application/json";
        break;
      case "form-urlencoded":
        if (typeof bodyData !== "object" || Array.isArray(bodyData) || bodyData === null) {
          console.error(`Incorrect type of bodyData passed to form-urlencoded POST request!\nBodyData:${bodyData}`);
          return Promise.reject("Invalid bodyData for form-urlencoded POST request");
        }

        body = this.toUrlSearchParams(bodyData).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        break;
      default:
        console.error(`Unsupported data type: ${dataType}`);
        body = String(bodyData);
        headers["Content-Type"] = "text/plain";
        break;
    }
    return await this.doFetch(path, { method: "POST", body, headers });
  }

  /**
   * A generic request helper.
   * @param path - The path to send the request to
   * @param config - The request configuration
   */
  protected async doFetch(path: string, config: DoFetchConfig): Promise<Response> {
    const method = config.method.toUpperCase();
    const pathname = this.getSafePathname(path);
    const startedAt = Date.now();
    const headers = new Headers(config.headers as HeadersInit);
    const callerSignal = config.signal ?? undefined;
    const controller = new AbortController();
    const timeoutError = new ApiRequestTimeoutError(method, pathname, API_REQUEST_TIMEOUT_MS);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeCallerAbortListener = (): void => {};

    headers.set("Authorization", getCookie(SESSION_ID_COOKIE_NAME));
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    headers.set("PKR-Client-Version", version);

    const timeoutPromise = new Promise<Response>((_, reject) => {
      timeoutId = setTimeout(() => {
        // Reject before aborting so the caller receives a stable, explicit
        // timeout error even when fetch reacts to abort synchronously.
        reject(timeoutError);
        controller.abort(timeoutError);
      }, API_REQUEST_TIMEOUT_MS);
    });

    let callerAbortPromise: Promise<Response> | undefined;
    if (callerSignal) {
      callerAbortPromise = new Promise((_, reject) => {
        const rejectForCallerAbort = () => {
          const reason = callerSignal.reason;
          const abortError = reason instanceof Error ? reason : new Error("The API request was aborted.");
          if (!(reason instanceof Error)) {
            abortError.name = "AbortError";
          }
          reject(abortError);
          controller.abort(abortError);
        };

        if (callerSignal.aborted) {
          rejectForCallerAbort();
          return;
        }

        callerSignal.addEventListener("abort", rejectForCallerAbort, { once: true });
        removeCallerAbortListener = () => callerSignal.removeEventListener("abort", rejectForCallerAbort);
      });
    }

    const fetchAndBuffer = async (): Promise<Response> => {
      const response = await fetch(this.base + path, {
        ...(config as RequestInit),
        headers,
        signal: controller.signal,
      });
      const responseHasBody = method !== "HEAD" && ![204, 205, 304].includes(response.status);
      const body = responseHasBody ? await response.arrayBuffer() : null;
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete("Content-Encoding");
      responseHeaders.delete("Content-Length");
      responseHeaders.delete("Transfer-Encoding");

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    };

    try {
      const pending = [fetchAndBuffer(), timeoutPromise];
      if (callerAbortPromise) {
        pending.push(callerAbortPromise);
      }
      const response = await Promise.race(pending);
      this.logRequest(method, pathname, response.status, startedAt);
      return response;
    } catch (err) {
      const outcome = err instanceof ApiRequestTimeoutError ? "timeout" : callerSignal?.aborted ? "aborted" : "failed";
      this.logRequest(method, pathname, outcome, startedAt);
      throw err;
    } finally {
      clearTimeout(timeoutId);
      removeCallerAbortListener();
    }
  }

  /** Return only the request path, deliberately excluding query parameters. */
  private getSafePathname(path: string): string {
    try {
      return new URL(path, this.base).pathname;
    } catch {
      return path.split(/[?#]/, 1)[0] || "/";
    }
  }

  private logRequest(method: string, pathname: string, outcome: string | number, startedAt: number): void {
    const durationMs = Math.max(0, Date.now() - startedAt);
    console.debug(`[API] ${method} ${pathname} -> ${outcome} (${durationMs} ms)`);
  }

  /**
   * Helper to transform data to {@linkcode URLSearchParams}
   * Any key with a value of `undefined` will be ignored.
   * Any key with a value of `null` will be included.
   * @param data the data to transform to {@linkcode URLSearchParams}
   * @returns a {@linkcode URLSearchParams} representaton of {@linkcode data}
   */
  protected toUrlSearchParams(data: Record<string, any>): URLSearchParams {
    const arr = Object.entries(data)
      .map(([key, value]) => [key, value === undefined ? "" : String(value)])
      .filter(([, value]) => value !== "");

    return new URLSearchParams(arr);
  }
}

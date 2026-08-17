import { ApiBase } from "#api/api-base";
import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import type {
  AccountChangePwRequest,
  AccountInfoResponse,
  AccountLoginRequest,
  AccountLoginResponse,
  AccountRegisterRequest,
} from "#types/api";
import { removeCookie, setCookie } from "#utils/cookies";

/** A wrapper for PokéRogue account API requests. */
export class PokerogueAccountApi extends ApiBase {
  private parseThrownAccountError(err: unknown, fallback: string): string {
    const message = err instanceof Error ? err.message : String(err);
    const normalized = message.toLowerCase();
    const errorCode =
      typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : null;

    if (errorCode === "ETIMEDOUT" || normalized.includes("timed out") || normalized.includes("timeout")) {
      return `NET04: ${fallback} timed out while waiting for the API. Please try again.`;
    }

    if (
      normalized.includes("failed to fetch")
      || normalized.includes("networkerror")
      || normalized.includes("load failed")
    ) {
      return `NET01: ${fallback} failed to reach the API (${message})`;
    }

    if (normalized.includes("cors")) {
      return `NET02: ${fallback} blocked by CORS (${message})`;
    }

    if (normalized.includes("ssl") || normalized.includes("tls") || normalized.includes("certificate")) {
      return `NET03: ${fallback} failed due to TLS/SSL validation (${message})`;
    }

    return `NET99: ${fallback} failed before receiving a server response (${message})`;
  }

  private async parseAccountError(response: Response, fallback: string): Promise<string> {
    const statusFallback = `${fallback} (${response.status})`;

    try {
      const body = (await response.text())?.trim();
      if (!body) {
        return statusFallback;
      }

      const lowerBody = body.toLowerCase();
      const isHtmlResponse = lowerBody.includes("<!doctype html") || lowerBody.includes("<html");
      const isCloudflareChallenge =
        lowerBody.includes("cloudflare")
        || lowerBody.includes("attention required")
        || lowerBody.includes("cf-chl")
        || lowerBody.includes("challenge-platform");

      if (isHtmlResponse && isCloudflareChallenge) {
        return "CF01: Account requests are being blocked by Cloudflare in this desktop build. Use the browser version for register/login for now.";
      }

      return body;
    } catch (err) {
      console.warn("Could not parse account error response!", err);
      return statusFallback;
    }
  }

  /**
   * Request the {@linkcode AccountInfoResponse | UserInfo} of the logged in user.
   * The user is identified by the {@linkcode SESSION_ID_COOKIE_NAME | session cookie}.
   */
  public async getInfo(): Promise<[data: AccountInfoResponse | null, status: number]> {
    try {
      const response = await this.doGet("/account/info");

      if (response.ok) {
        const resData = (await response.json()) as AccountInfoResponse;
        return [resData, response.status];
      }
      console.warn("Could not get account info!", response.status, response.statusText);
      return [null, response.status];
    } catch (err) {
      console.warn("Could not get account info!", err);
      return [null, 500];
    }
  }

  /**
   * Register a new account.
   * @param registerData The {@linkcode AccountRegisterRequest} to send
   * @returns An error message if something went wrong
   */
  public async register(registerData: AccountRegisterRequest): Promise<string | null> {
    try {
      const response = await this.doPost("/account/register", registerData, "form-urlencoded");

      if (response.ok) {
        return null;
      }
      return await this.parseAccountError(response, "Registration failed");
    } catch (err) {
      console.warn("Register failed!", err);
      return this.parseThrownAccountError(err, "Registration");
    }
  }

  /**
   * Send a login request.
   * Sets the session cookie on success.
   * @param loginData The {@linkcode AccountLoginRequest} to send
   * @returns An error message if something went wrong
   */
  public async login(loginData: AccountLoginRequest): Promise<string | null> {
    try {
      const response = await this.doPost("/account/login", loginData, "form-urlencoded");

      if (response.ok) {
        const loginResponse = (await response.json()) as AccountLoginResponse;
        setCookie(SESSION_ID_COOKIE_NAME, loginResponse.token);
        return null;
      }
      console.warn("Login failed!", response.status, response.statusText);
      return await this.parseAccountError(response, "Login failed");
    } catch (err) {
      console.warn("Login failed!", err);
      return this.parseThrownAccountError(err, "Login");
    }
  }

  /**
   * Send a logout request.
   * @remarks
   * **Always** (no matter if failed or not) removes the session cookie.
   */
  public async logout(): Promise<void> {
    try {
      const response = await this.doGet("/account/logout");

      if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      console.warn("Log out failed!", err);
    }

    removeCookie(SESSION_ID_COOKIE_NAME); // we are always clearing the cookie.
  }

  public async changePassword(changePwData: AccountChangePwRequest): Promise<string | null> {
    try {
      const response = await this.doPost("/account/changepw", changePwData, "form-urlencoded");
      if (response.ok) {
        return null;
      }
      console.warn("Change password failed!", response.status, response.statusText);
      return await this.parseAccountError(response, "Change password failed");
    } catch (err) {
      console.warn("Change password failed!", err);
      return this.parseThrownAccountError(err, "Change password");
    }
  }
}

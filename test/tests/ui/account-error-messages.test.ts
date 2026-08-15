/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { LoginFormUiHandler } from "#ui/login-form-ui-handler";
import { RegistrationFormUiHandler } from "#ui/registration-form-ui-handler";
import i18next from "i18next";
import { describe, expect, it } from "vitest";

const loginHandler = Object.create(LoginFormUiHandler.prototype) as LoginFormUiHandler;
const registrationHandler = Object.create(RegistrationFormUiHandler.prototype) as RegistrationFormUiHandler;

describe("Account form error messages", () => {
  it("preserves detailed network and Cloudflare errors", () => {
    const networkError = "NET99: Login failed before receiving a server response (connection refused)";
    const cloudflareError = "CF01: Account requests are being blocked by Cloudflare";

    expect(loginHandler.getReadableErrorMessage(networkError)).toBe(networkError);
    expect(registrationHandler.getReadableErrorMessage(cloudflareError)).toBe(cloudflareError);
  });

  it("translates known login errors that include server detail", () => {
    expect(loginHandler.getReadableErrorMessage("account doesn't exist: database lookup failed")).toBe(
      i18next.t("menu:accountNonExistent"),
    );
    expect(loginHandler.getReadableErrorMessage("password doesn't match: supplied password rejected")).toBe(
      i18next.t("menu:unmatchingPassword"),
    );
  });

  it("translates known registration errors that include server detail", () => {
    expect(registrationHandler.getReadableErrorMessage("invalid username: too short")).toBe(
      i18next.t("menu:invalidRegisterUsername"),
    );
    expect(registrationHandler.getReadableErrorMessage("failed to add account record: duplicate username")).toBe(
      i18next.t("menu:usernameAlreadyUsed"),
    );
  });
});

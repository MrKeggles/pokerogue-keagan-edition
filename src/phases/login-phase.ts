import { updateUserInfo } from "#app/account";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { Phase } from "#app/phase";
import { handleTutorial, Tutorial } from "#app/tutorial";
import { bypassLogin } from "#constants/app-constants";
import { PlayerGender } from "#enums/player-gender";
import { UiMode } from "#enums/ui-mode";
import { executeIf, sessionIdKey } from "#utils/common";
import { getCookie, removeCookie } from "#utils/cookies";
import i18next from "i18next";

export class LoginPhase extends Phase {
  public readonly phaseName = "LoginPhase";

  /**
   * Whether to load the "login or register" text.
   * Only `true` the first time the phase runs, the text stays on screen after that.
   * @defaultValue `true`
   */
  private readonly showText: boolean;

  constructor(showText = true) {
    super();

    this.showText = showText;
  }

  public override async start(): Promise<void> {
    const { ui } = globalScene;

    super.start();

    const hasSession = !!getCookie(sessionIdKey);

    ui.setMode(UiMode.LOADING, { buttonActions: [] });

    const response = await executeIf(bypassLogin || hasSession, updateUserInfo);
    const success = response?.[0] ?? false;
    const statusCode = response ? response[1] : null;

    if (!success) {
      this.checkStatus(statusCode);
      return;
    }

    await this.loadSystemAndContinue();
  }

  public override async end(): Promise<void> {
    globalScene.ui.setMode(UiMode.MESSAGE);

    if (settings.general.playerGender === PlayerGender.UNSET) {
      globalScene.phaseManager.unshiftNew("SelectGenderPhase");
    }

    await handleTutorial(Tutorial.INTRO);
    super.end();
  }

  private checkStatus(statusCode: number | null): void {
    if (!statusCode || statusCode === 400) {
      this.showLoginRegister();
      return;
    }

    if (statusCode === 401) {
      removeCookie(sessionIdKey);
      globalScene.reset(true, true);
      return;
    }

    this.retryWhenAvailable();
  }

  /**
   * Load account save data before leaving the login flow. A successful account
   * check alone is not enough: continuing with an uninitialized GameData could
   * later upload defaults over an existing remote save.
   */
  private async loadSystemAndContinue(): Promise<boolean> {
    let loaded = false;
    try {
      loaded = await globalScene.gameData.loadSystem();
    } catch (err) {
      console.error("Could not load system save data after login.", err);
    }

    if (loaded || bypassLogin) {
      await this.end();
      return true;
    }

    // Keep the accepted session token and use the existing retry screen. A
    // transient timeout must not become either a logout or a blank new save.
    this.retryWhenAvailable();
    return false;
  }

  private retryWhenAvailable(): void {
    globalScene.phaseManager.unshiftNew("UnavailablePhase");
    super.end();
  }

  private showLoginRegister(): void {
    const { ui } = globalScene;

    const goToLoginButton = () => {
      this.goToLogin();
    };

    const goToRegistrationButton = () => {
      this.goToRegister();
    };

    if (this.showText) {
      ui.showText(i18next.t("menu:logInOrCreateAccount"));
    }

    audioManager.playSound("ui/menu_open");

    ui.setMode(UiMode.LOGIN_OR_REGISTER, { buttonActions: [goToLoginButton, goToRegistrationButton] });
  }

  private async checkUserInfo(): Promise<boolean> {
    globalScene.ui.playSelect();
    const [success, statusCode] = await updateUserInfo();
    if (!success && statusCode === 401) {
      removeCookie(sessionIdKey);
      globalScene.reset(true, true);
      return false;
    }

    if (!success) {
      // The credentials were accepted, but the follow-up account request could
      // not be completed. Keep the newly-issued token so a temporary outage,
      // timeout, or proxy/Cloudflare error does not log the player out. The
      // unavailable screen will retry and only clears the token if the server
      // later gives us a definitive unauthorized response.
      this.retryWhenAvailable();
      return false;
    }

    return true;
  }

  public goToLogin(): void {
    const { ui, phaseManager } = globalScene;

    const backButton = () => {
      phaseManager.unshiftNew("LoginPhase", false);
      this.end();
    };

    const loginButton = async () => {
      const success = await this.checkUserInfo();
      if (!success) {
        return;
      }
      await this.loadSystemAndContinue();
    };
    audioManager.playSound("ui/menu_open");

    ui.setMode(UiMode.LOGIN_FORM, { buttonActions: [loginButton, backButton] });
  }

  public goToRegister(): void {
    const { phaseManager, ui } = globalScene;

    const backButton = () => {
      phaseManager.unshiftNew("LoginPhase", false);
      this.end();
    };

    const registerButton = async () => {
      const success = await this.checkUserInfo();
      if (!success) {
        return;
      }
      this.end();
    };
    audioManager.playSound("ui/menu_open");

    ui.setMode(UiMode.REGISTRATION_FORM, { buttonActions: [registerButton, backButton] });
  }
}

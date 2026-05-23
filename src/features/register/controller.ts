import { fillEmailAndContinue, isChatGptLoginPage } from './chatgpt-auth-page';
import { fillOtpAndContinue, isEmailVerificationPage } from './openai-email-verification-page';
import { fillAboutYouAndCreate, fillAboutYouProfile, isAboutYouPage } from './openai-about-you-page';
import { parseAccountInput } from './account-input';
import { loadRegisterState, saveRegisterState } from '../../app/state';
import type {
  ActionResult,
  HimailCreateEmailResponse,
  HimailDomainsResponse,
  HimailFetchMessagesResponse,
  PageState,
  RegisterController,
  RegisterProvider,
} from './types';

let autoProfileStarted = false;
let autoHimailOtpStarted = false;

export function createRegisterController(): RegisterController {
  return {
    getPageState,
    loadState: loadRegisterState,
    saveProvider: async (provider: RegisterProvider) => {
      return saveRegisterState({ provider });
    },
    saveInput: async (rawInput: string) => {
      const parsed = parseAccountInput(rawInput);
      return saveRegisterState({
        rawInput,
        email: parsed.email,
        accountLine: parsed.accountLine,
        inputMode: parsed.mode,
        autoOtp: parsed.mode === 'outlook-line',
      });
    },
    saveHimailOptions: async (patch) => saveRegisterState(patch),
    fillEmailFromInput: async () => {
      const state = await loadRegisterState();
      const parsed = parseAccountInput(state.rawInput);
      if (!parsed.ok) {
        return fail(parsed.message);
      }
      if (!isChatGptLoginPage()) {
        return fail('当前页面不是 ChatGPT 登录页');
      }
      await saveRegisterState({
        email: parsed.email,
        accountLine: parsed.accountLine,
        inputMode: parsed.mode,
        autoOtp: parsed.mode === 'outlook-line',
        otpRequestedAt: Date.now(),
      });
      return fillEmailAndContinue(parsed.email);
    },
    fillOtp: async (code: string) => {
      if (!isEmailVerificationPage()) {
        return fail('当前页面不是邮箱验证码页');
      }
      return fillOtpAndContinue(code);
    },
    waitForOutlookOtp: async () => {
      if (!isEmailVerificationPage()) {
        return fail('当前页面不是邮箱验证码页');
      }
      const state = await loadRegisterState();
      if (!state.accountLine) {
        return fail('当前输入不是 Outlook 账号行，不能自动接收验证码');
      }

      const response = await browser.runtime.sendMessage({
        type: 'opx:wait-outlook-otp',
        accountLine: state.accountLine,
        apiBase: state.apiBase,
        since: state.otpRequestedAt || state.updatedAt || Date.now(),
        timeoutMs: 180_000,
        intervalMs: 5_000,
      });

      if (!isActionResult(response)) {
        return fail('Outlook API 没有返回有效结果');
      }

      if (!response.ok || !response.code) {
        return response;
      }

      const fillResult = await fillOtpAndContinue(response.code);
      return {
        ...fillResult,
        code: response.code,
        message: fillResult.ok ? `已收到并提交验证码：${response.code}` : fillResult.message,
      };
    },
    refreshHimailDomains: async () => {
      const response: HimailDomainsResponse = await browser.runtime.sendMessage({
        type: 'opx:himail-domains',
      });

      if (!isHimailDomainsResponse(response)) {
        return fail('himail 后缀接口返回无效');
      }

      const state = await loadRegisterState();
      const currentDomain = state.himailDomain && response.domains.includes(state.himailDomain)
        ? state.himailDomain
        : '';
      await saveRegisterState({
        himailDomains: response.domains,
        himailDomain: currentDomain || response.defaultDomain || response.domains[0] || '',
      });
      return {
        ok: response.ok,
        message: response.message,
        data: response,
      };
    },
    createHimailEmailAndContinue: async () => {
      if (!isChatGptLoginPage()) {
        return fail('当前页面不是 ChatGPT 登录页');
      }

      const state = await loadRegisterState();
      const prefix = normalizeHimailPrefix(state.himailPrefix) || randomHimailPrefix();
      const domain = state.himailDomain || state.himailDomains[0] || 'imail.edu.vn';
      const response: HimailCreateEmailResponse = await browser.runtime.sendMessage({
        type: 'opx:himail-create-email',
        prefix,
        domain,
      });

      if (!isHimailCreateEmailResponse(response)) {
        return fail('himail 创建邮箱返回无效');
      }

      if (!response.ok || !response.email) {
        return {
          ok: false,
          message: response.message || 'himail 创建邮箱失败',
          data: response,
        };
      }

      await saveRegisterState({
        provider: 'himail',
        himailPrefix: response.prefix || prefix,
        himailDomain: response.domain || domain,
        himailDomains: response.domains || state.himailDomains,
        himailEmail: response.email,
        himailMessages: [],
        himailLastCode: '',
        himailCreatedAt: Date.now(),
        himailLastFetchAt: 0,
        himailPollEnabled: true,
        email: response.email,
      });

      const fillResult = await fillEmailAndContinue(response.email);
      return {
        ...fillResult,
        data: response,
        message: fillResult.ok ? `已创建 ${response.email} 并提交` : fillResult.message,
      };
    },
    refreshHimailMessages: async (options = {}) => {
      const state = await loadRegisterState();
      if (!state.himailEmail) {
        return fail('请先创建 himail 邮箱');
      }

      const response: HimailFetchMessagesResponse = await browser.runtime.sendMessage({
        type: 'opx:himail-fetch-messages',
        email: state.himailEmail,
      });

      if (!isHimailFetchMessagesResponse(response)) {
        return fail('himail 邮件接口返回无效');
      }

      const code = response.code || response.messages.find((message) => message.code)?.code || '';
      await saveRegisterState({
        himailMessages: response.messages,
        himailLastCode: code,
        himailLastFetchAt: response.fetchedAt || Date.now(),
      });

      if (!response.ok) {
        return {
          ok: false,
          message: response.message,
          data: response,
        };
      }

      if (code && options.autoSubmit) {
        if (!isEmailVerificationPage()) {
          return {
            ok: true,
            code,
            message: `已收到验证码 ${code}，请切到验证码页后继续`,
            data: response,
          };
        }

        const fillResult = await fillOtpAndContinue(code);
        if (fillResult.ok) {
          void waitForAboutYouAndFillProfile();
        }
        return {
          ...fillResult,
          code,
          data: response,
          message: fillResult.ok ? `已收到并提交验证码：${code}` : fillResult.message,
        };
      }

      return {
        ok: true,
        code,
        message: code ? `已收到验证码：${code}` : response.message,
        data: response,
      };
    },
    fillProfile: async () => {
      if (!isAboutYouPage()) {
        return fail('当前页面不是资料填写页');
      }
      return fillAboutYouProfile();
    },
    fillProfileAndCreate: async () => {
      if (!isAboutYouPage()) {
        return fail('当前页面不是资料填写页');
      }
      return fillAboutYouAndCreate();
    },
    clearRegisterState: async () => {
      const state = await loadRegisterState();
      await saveRegisterState({
        rawInput: '',
        email: '',
        accountLine: '',
        inputMode: 'empty',
        autoOtp: false,
        himailPrefix: '',
        himailEmail: '',
        himailMessages: [],
        himailLastCode: '',
        himailCreatedAt: 0,
        himailLastFetchAt: 0,
        himailPollEnabled: false,
        otpRequestedAt: 0,
        provider: state.provider,
        himailDomain: state.himailDomain,
        himailDomains: state.himailDomains,
      });
      return { ok: true, message: '已清空注册输入和 himail 邮箱状态' };
    },
    autoRunForCurrentPage: async () => {
      if (isEmailVerificationPage()) {
        await autoRunHimailOtp();
        return;
      }

      if (!isAboutYouPage() || autoProfileStarted) {
        return;
      }
      autoProfileStarted = true;
      await waitForPageReady();
      await fillAboutYouProfile();
    },
  };
}

async function autoRunHimailOtp(): Promise<void> {
  if (autoHimailOtpStarted) {
    return;
  }

  const state = await loadRegisterState();
  if (state.provider !== 'himail' || !state.himailEmail || !state.himailPollEnabled) {
    return;
  }

  autoHimailOtpStarted = true;
  const deadline = Date.now() + 180_000;
  try {
    while (Date.now() <= deadline && isEmailVerificationPage()) {
      const response = await browser.runtime.sendMessage({
        type: 'opx:himail-fetch-messages',
        email: state.himailEmail,
      }) as HimailFetchMessagesResponse;

      if (isHimailFetchMessagesResponse(response)) {
        const code = response.code || response.messages.find((message) => message.code)?.code || '';
        await saveRegisterState({
          himailMessages: response.messages,
          himailLastCode: code,
          himailLastFetchAt: response.fetchedAt || Date.now(),
        });

        if (code) {
          const fillResult = await fillOtpAndContinue(code);
          if (fillResult.ok) {
            await waitForAboutYouAndFillProfile();
          }
          return;
        }
      }

      await delay(5_000);
    }
  } finally {
    autoHimailOtpStarted = false;
  }
}

function getPageState(): PageState {
  if (isChatGptLoginPage()) {
    return {
      kind: 'login',
      label: 'ChatGPT 登录页',
      canFillEmail: true,
      canFillOtp: false,
      canFillProfile: false,
    };
  }

  if (isEmailVerificationPage()) {
    return {
      kind: 'email-verification',
      label: '邮箱验证码页',
      canFillEmail: false,
      canFillOtp: true,
      canFillProfile: false,
    };
  }

  if (isAboutYouPage()) {
    return {
      kind: 'about-you',
      label: '资料填写页',
      canFillEmail: false,
      canFillOtp: false,
      canFillProfile: true,
    };
  }

  return {
    kind: 'unknown',
    label: '未识别页面',
    canFillEmail: false,
    canFillOtp: false,
    canFillProfile: false,
  };
}

function fail(message: string): ActionResult {
  return { ok: false, message };
}

function isActionResult(value: unknown): value is ActionResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ActionResult).ok === 'boolean' &&
      typeof (value as ActionResult).message === 'string',
  );
}

function isHimailDomainsResponse(value: unknown): value is HimailDomainsResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as HimailDomainsResponse).ok === 'boolean' &&
      typeof (value as HimailDomainsResponse).message === 'string' &&
      Array.isArray((value as HimailDomainsResponse).domains),
  );
}

function isHimailCreateEmailResponse(value: unknown): value is HimailCreateEmailResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as HimailCreateEmailResponse).ok === 'boolean' &&
      typeof (value as HimailCreateEmailResponse).message === 'string',
  );
}

function isHimailFetchMessagesResponse(value: unknown): value is HimailFetchMessagesResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as HimailFetchMessagesResponse).ok === 'boolean' &&
      typeof (value as HimailFetchMessagesResponse).message === 'string' &&
      Array.isArray((value as HimailFetchMessagesResponse).messages),
  );
}

function normalizeHimailPrefix(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 48);
}

function randomHimailPrefix(): string {
  return randomBase36(6);
}

function randomBase36(length: number): string {
  let value = '';
  while (value.length < length) {
    value += Math.random().toString(36).slice(2);
  }
  return value.slice(0, length);
}

function waitForPageReady(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 800));
}

async function waitForAboutYouAndFillProfile(): Promise<void> {
  if (autoProfileStarted) {
    return;
  }

  const deadline = Date.now() + 45_000;
  while (Date.now() <= deadline) {
    if (isAboutYouPage()) {
      autoProfileStarted = true;
      await waitForPageReady();
      await fillAboutYouProfile();
      return;
    }
    await delay(500);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

import type { FeaturePanelHandle } from '../../app/types';
import type { HimailEmailMessage, RegisterController, RegisterProvider } from './types';

const HIMAIL_POLL_INTERVAL_MS = 7_000;

export function createRegisterPanel(container: HTMLElement, controller: RegisterController): FeaturePanelHandle {
  const providerSelect = createSelect([
    ['default', '默认'],
    ['himail', 'himail.edu.vn'],
  ]);
  const providerField = createField('邮箱方案', providerSelect);

  const defaultSection = document.createElement('div');
  defaultSection.className = 'opx-register-section';

  const accountInput = document.createElement('textarea');
  accountInput.className = 'opx-textarea';
  accountInput.placeholder = '邮箱或 Outlook 行';
  accountInput.autocomplete = 'off';
  accountInput.spellcheck = false;

  const inputHint = document.createElement('div');
  inputHint.className = 'opx-hint';
  inputHint.textContent = '支持 user@example.com 或 email----password----client_id----refresh_token';

  const emailButton = createButton('填入邮箱并继续');

  const otp = document.createElement('input');
  otp.className = 'opx-input';
  otp.type = 'text';
  otp.inputMode = 'numeric';
  otp.placeholder = '验证码';
  otp.autocomplete = 'one-time-code';

  const otpButton = createButton('填入验证码并继续');
  const autoOtpButton = createButton('自动接收并填入验证码', 'opx-button opx-button-secondary');
  const profileButton = createButton('填写资料并创建');

  defaultSection.append(accountInput, inputHint, emailButton, otp, otpButton, autoOtpButton);

  const himailSection = document.createElement('div');
  himailSection.className = 'opx-register-section';

  const himailGrid = document.createElement('div');
  himailGrid.className = 'opx-grid opx-himail-grid';

  const himailPrefix = createInput('邮箱前缀，留空随机', 'text');
  himailPrefix.autocomplete = 'off';
  himailPrefix.spellcheck = false;
  const randomPrefixButton = createButton('随机', 'opx-button opx-button-secondary opx-compact-button');
  const prefixField = createField('前缀', himailPrefix);
  const randomField = createField(' ', randomPrefixButton);
  himailGrid.append(prefixField, randomField);

  const himailDomain = createSelect([]);
  const himailDomainField = createField('后缀', himailDomain);

  const himailHint = document.createElement('div');
  himailHint.className = 'opx-hint';
  himailHint.textContent = '创建后会自动提交邮箱，并轮询邮件验证码。';

  const himailCreateButton = createButton('创建并继续');
  const himailActions = document.createElement('div');
  himailActions.className = 'opx-button-row opx-himail-actions';
  const himailRefreshButton = createButton('手动刷新邮件', 'opx-button opx-button-secondary');
  const himailReloadDomainsButton = createButton('刷新后缀', 'opx-button opx-button-secondary');
  himailActions.append(himailRefreshButton, himailReloadDomainsButton);

  const himailSummary = document.createElement('div');
  himailSummary.className = 'opx-summary';

  const himailMessages = document.createElement('div');
  himailMessages.className = 'opx-himail-messages';

  himailSection.append(
    himailGrid,
    himailDomainField,
    himailHint,
    himailCreateButton,
    himailActions,
    himailSummary,
    himailMessages,
  );

  const status = document.createElement('div');
  status.className = 'opx-status';
  status.textContent = '等待操作';

  let domainFetchInFlight = false;
  let domainRequestedOnce = false;
  let mailFetchInFlight = false;
  let pollTimer: number | undefined;
  let lastDomainValues = '';

  const update = async () => {
    const page = controller.getPageState();
    const saved = await controller.loadState();
    providerSelect.value = saved.provider;

    if (accountInput.value !== saved.rawInput) {
      accountInput.value = saved.rawInput;
    }
    if (document.activeElement !== himailPrefix && himailPrefix.value !== saved.himailPrefix) {
      himailPrefix.value = saved.himailPrefix;
    }

    defaultSection.hidden = saved.provider !== 'default';
    himailSection.hidden = saved.provider !== 'himail';

    emailButton.disabled = saved.provider !== 'default' || !page.canFillEmail;
    otpButton.disabled = !page.canFillOtp;
    autoOtpButton.disabled = saved.provider !== 'default' || !page.canFillOtp || !saved.autoOtp;
    himailCreateButton.disabled = saved.provider !== 'himail' || !page.canFillEmail;
    himailRefreshButton.disabled = saved.provider !== 'himail' || !saved.himailEmail || mailFetchInFlight;
    himailReloadDomainsButton.disabled = saved.provider !== 'himail' || domainFetchInFlight;
    profileButton.disabled = !page.canFillProfile;
    inputHint.textContent = saved.autoOtp
      ? 'Outlook 行模式：验证码页会通过本地 API 自动收码'
      : '单邮箱模式：验证码需要手动输入';

    setDomainOptions(saved.himailDomains, saved.himailDomain);
    renderHimailSummary(saved.himailEmail, saved.himailLastCode, saved.himailLastFetchAt);
    renderHimailMessages(saved.himailMessages);
    ensureHimailPolling(saved.provider, saved.himailPollEnabled, saved.himailEmail);

    if (saved.provider === 'himail' && saved.himailDomains.length === 0 && !domainFetchInFlight && !domainRequestedOnce) {
      void refreshHimailDomains(false);
    }
  };

  providerSelect.addEventListener('change', async () => {
    const provider = providerSelect.value === 'himail' ? 'himail' : 'default';
    await controller.saveProvider(provider);
    if (provider === 'himail') {
      await refreshHimailDomains(false);
    }
    await update();
  });

  accountInput.addEventListener('input', async () => {
    const saved = await controller.saveInput(accountInput.value);
    inputHint.textContent = saved.autoOtp
      ? 'Outlook 行模式：验证码页会通过本地 API 自动收码'
      : '单邮箱模式：验证码需要手动输入';
  });

  himailPrefix.addEventListener('input', async () => {
    await controller.saveHimailOptions({ himailPrefix: himailPrefix.value });
  });

  randomPrefixButton.addEventListener('click', async () => {
    himailPrefix.value = randomPrefix();
    await controller.saveHimailOptions({ himailPrefix: himailPrefix.value });
    himailPrefix.focus();
    await update();
  });

  himailDomain.addEventListener('change', async () => {
    await controller.saveHimailOptions({ himailDomain: himailDomain.value });
    await update();
  });

  emailButton.addEventListener('click', async () => {
    setStatus(status, '正在提交邮箱...', 'pending');
    await controller.saveInput(accountInput.value);
    setResult(status, await controller.fillEmailFromInput());
    await update();
  });

  himailCreateButton.addEventListener('click', async () => {
    setStatus(status, '正在创建 himail 邮箱...', 'pending');
    await controller.saveHimailOptions({
      himailPrefix: himailPrefix.value,
      himailDomain: himailDomain.value,
    });
    try {
      const result = await controller.createHimailEmailAndContinue();
      setResult(status, result);
      await update();
      if (result.ok) {
        window.setTimeout(() => void refreshHimailMessages(true, false), 2500);
      }
    } catch (error) {
      setStatus(status, `创建 himail 邮箱失败：${String(error)}`, 'error');
      await update();
    }
  });

  himailRefreshButton.addEventListener('click', async () => {
    await refreshHimailMessages(true, true);
  });

  himailReloadDomainsButton.addEventListener('click', async () => {
    await refreshHimailDomains(true);
  });

  otpButton.addEventListener('click', async () => {
    setStatus(status, '正在提交验证码...', 'pending');
    setResult(status, await controller.fillOtp(otp.value));
    await update();
  });

  autoOtpButton.addEventListener('click', async () => {
    setStatus(status, '等待 Outlook 验证码...', 'pending');
    setResult(status, await controller.waitForOutlookOtp());
    await update();
  });

  profileButton.addEventListener('click', async () => {
    setStatus(status, '正在填写资料...', 'pending');
    setResult(status, await controller.fillProfileAndCreate());
    await update();
  });

  container.append(providerField, defaultSection, himailSection, profileButton, status);
  void update();
  return {
    update,
    onShow: async () => {
      const saved = await controller.loadState();
      if (saved.provider === 'himail' && saved.himailDomains.length === 0) {
        await refreshHimailDomains(false);
      }
      await update();
    },
  };

  async function refreshHimailDomains(showStatus: boolean): Promise<void> {
    if (domainFetchInFlight) {
      return;
    }
    domainRequestedOnce = true;
    domainFetchInFlight = true;
    if (showStatus) {
      setStatus(status, '正在读取 himail 后缀...', 'pending');
    }
    try {
      const result = await controller.refreshHimailDomains();
      if (showStatus || !result.ok) {
        setResult(status, result);
      }
    } catch (error) {
      setStatus(status, `读取 himail 后缀失败：${String(error)}`, 'error');
    } finally {
      domainFetchInFlight = false;
      await update();
    }
  }

  async function refreshHimailMessages(autoSubmit: boolean, showStatus: boolean): Promise<void> {
    if (mailFetchInFlight) {
      return;
    }
    mailFetchInFlight = true;
    if (showStatus) {
      setStatus(status, '正在刷新 himail 邮件...', 'pending');
    }
    try {
      const result = await controller.refreshHimailMessages({ autoSubmit });
      if (showStatus || result.code || !result.ok) {
        setResult(status, result);
      }
    } catch (error) {
      setStatus(status, `刷新 himail 邮件失败：${String(error)}`, 'error');
    } finally {
      mailFetchInFlight = false;
      await update();
    }
  }

  function ensureHimailPolling(provider: RegisterProvider, enabled: boolean, email: string): void {
    if (provider !== 'himail' || !enabled || !email || isEmailVerificationPage()) {
      stopHimailPolling();
      return;
    }
    if (pollTimer !== undefined) {
      return;
    }
    pollTimer = window.setInterval(() => {
      void refreshHimailMessages(true, false);
    }, HIMAIL_POLL_INTERVAL_MS);
  }

  function stopHimailPolling(): void {
    if (pollTimer === undefined) {
      return;
    }
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }

  function setDomainOptions(domains: string[], selected: string): void {
    const values = domains.length ? domains : (selected ? [selected] : []);
    const signature = `${values.join('|')}::${selected}`;
    if (signature === lastDomainValues) {
      if (selected && himailDomain.value !== selected) {
        himailDomain.value = selected;
      }
      return;
    }
    lastDomainValues = signature;
    himailDomain.replaceChildren();
    if (!values.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '后缀加载中';
      himailDomain.append(option);
      return;
    }
    for (const domain of values) {
      const option = document.createElement('option');
      option.value = domain;
      option.textContent = domain;
      himailDomain.append(option);
    }
    himailDomain.value = selected && values.includes(selected) ? selected : values[0];
  }

  function renderHimailSummary(email: string, code: string, fetchedAt: number): void {
    const lines = [
      email ? `当前邮箱：${email}` : '当前邮箱：未创建',
      code ? `验证码：${code}` : '验证码：未收到',
      fetchedAt ? `最后刷新：${new Date(fetchedAt).toLocaleTimeString()}` : '最后刷新：尚未刷新',
    ];
    himailSummary.textContent = lines.join('\n');
  }

  function renderHimailMessages(messages: HimailEmailMessage[]): void {
    himailMessages.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'opx-himail-empty';
      empty.textContent = '暂无邮件内容';
      himailMessages.append(empty);
      return;
    }

    for (const message of messages.slice(0, 5)) {
      const item = document.createElement('div');
      item.className = 'opx-himail-message';

      const title = document.createElement('div');
      title.className = 'opx-himail-message-title';
      title.textContent = message.subject || message.from || 'himail 邮件';

      const meta = document.createElement('div');
      meta.className = 'opx-himail-message-meta';
      meta.textContent = [message.from, message.date].filter(Boolean).join(' · ');

      const body = document.createElement('div');
      body.className = 'opx-himail-message-body';
      body.textContent = message.body || '';

      item.append(title);
      if (message.code) {
        const code = document.createElement('button');
        code.className = 'opx-mini-button opx-mini-button-secondary opx-himail-code';
        code.type = 'button';
        code.textContent = `验证码 ${message.code}`;
        code.addEventListener('click', () => navigator.clipboard.writeText(message.code));
        item.append(code);
      }
      if (meta.textContent) {
        item.append(meta);
      }
      item.append(body);
      himailMessages.append(item);
    }
  }
}

function createButton(label: string, className = 'opx-button'): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = label;
  return button;
}

function createInput(placeholder: string, type: string): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'opx-input';
  input.type = type;
  input.placeholder = placeholder;
  return input;
}

function createSelect(options: string[][]): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'opx-select';
  for (const [value, label] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  return select;
}

function createField(label: string, control: HTMLElement): HTMLElement {
  const field = document.createElement('label');
  field.className = 'opx-field';
  const caption = document.createElement('span');
  caption.className = 'opx-label';
  caption.textContent = label;
  field.append(caption, control);
  return field;
}

function setResult(element: HTMLElement, result: { ok: boolean; message: string }): void {
  setStatus(element, result.message, result.ok ? 'ok' : 'error');
}

function setStatus(element: HTMLElement, message: string, type: 'pending' | 'ok' | 'error'): void {
  element.textContent = message;
  element.dataset.type = type;
}

function randomPrefix(): string {
  return `opx${Math.random().toString(36).slice(2, 8)}${Date.now().toString().slice(-6)}`;
}

function isEmailVerificationPage(): boolean {
  return location.hostname === 'auth.openai.com' && location.pathname.startsWith('/email-verification');
}

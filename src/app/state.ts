import { DEFAULT_CHECKOUT_OPTIONS, normalizeCheckoutOptions } from '../features/link-extractor/checkout';
import type { FeatureTab } from './types';
import type { LinkExtractorState } from '../features/link-extractor/types';
import type { AccountInputMode, HimailEmailMessage, RegisterProvider, RegisterState } from '../features/register/types';
import type { SessionConverterState, SessionConvertFormat } from '../features/session-converter/types';
import type { SmsCodeRecord, SmsRelayState } from '../features/sms/types';

export const DEFAULT_API_BASE = 'http://127.0.0.1:8787';

const STORAGE_KEY = 'opx.registerAssist.state';

interface AppState {
  activeTab: FeatureTab;
  panelCollapsed: boolean;
  register: RegisterState;
  linkExtractor: LinkExtractorState;
  sessionConverter: SessionConverterState;
  smsRelay: SmsRelayState;
}

const DEFAULT_REGISTER_STATE: RegisterState = {
  provider: 'default',
  rawInput: '',
  email: '',
  accountLine: '',
  inputMode: 'empty',
  autoOtp: false,
  apiBase: DEFAULT_API_BASE,
  himailPrefix: '',
  himailDomain: 'imail.edu.vn',
  himailDomains: [],
  himailEmail: '',
  himailMessages: [],
  himailLastCode: '',
  himailCreatedAt: 0,
  himailLastFetchAt: 0,
  himailPollEnabled: false,
  otpRequestedAt: 0,
  updatedAt: 0,
};

const DEFAULT_LINK_STATE: LinkExtractorState = {
  checkoutOptions: DEFAULT_CHECKOUT_OPTIONS,
  updatedAt: 0,
};

const DEFAULT_SMS_RELAY_STATE: SmsRelayState = {
  rawInput: '',
  history: [],
  updatedAt: 0,
};

const DEFAULT_SESSION_CONVERTER_STATE: SessionConverterState = {
  format: 'sub2api',
  updatedAt: 0,
};

const DEFAULT_STATE: AppState = {
  activeTab: 'register',
  panelCollapsed: false,
  register: DEFAULT_REGISTER_STATE,
  linkExtractor: DEFAULT_LINK_STATE,
  sessionConverter: DEFAULT_SESSION_CONVERTER_STATE,
  smsRelay: DEFAULT_SMS_RELAY_STATE,
};

export async function loadAppState(): Promise<AppState> {
  const data = await browser.storage.local.get(STORAGE_KEY);
  return normalizeAppState(data[STORAGE_KEY]);
}

export async function saveActiveTab(activeTab: FeatureTab): Promise<AppState> {
  const current = await loadAppState();
  const next = normalizeAppState({ ...current, activeTab });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function savePanelCollapsed(panelCollapsed: boolean): Promise<AppState> {
  const current = await loadAppState();
  const next = normalizeAppState({ ...current, panelCollapsed });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function loadRegisterState(): Promise<RegisterState> {
  return (await loadAppState()).register;
}

export async function saveRegisterState(patch: Partial<RegisterState>): Promise<RegisterState> {
  const current = await loadAppState();
  const register = normalizeRegisterState({
    ...current.register,
    ...patch,
    updatedAt: Date.now(),
  });
  const next = normalizeAppState({ ...current, register });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next.register;
}

export async function loadLinkExtractorState(): Promise<LinkExtractorState> {
  return (await loadAppState()).linkExtractor;
}

export async function saveLinkExtractorState(patch: Partial<LinkExtractorState>): Promise<LinkExtractorState> {
  const current = await loadAppState();
  const linkExtractor = normalizeLinkExtractorState({
    ...current.linkExtractor,
    ...patch,
    updatedAt: Date.now(),
  });
  const next = normalizeAppState({ ...current, linkExtractor });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next.linkExtractor;
}

export async function loadSmsRelayState(): Promise<SmsRelayState> {
  return (await loadAppState()).smsRelay;
}

export async function loadSessionConverterState(): Promise<SessionConverterState> {
  return (await loadAppState()).sessionConverter;
}

export async function saveSessionConverterState(patch: Partial<SessionConverterState>): Promise<SessionConverterState> {
  const current = await loadAppState();
  const sessionConverter = normalizeSessionConverterState({
    ...current.sessionConverter,
    ...patch,
    updatedAt: Date.now(),
  });
  const next = normalizeAppState({ ...current, sessionConverter });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next.sessionConverter;
}

export async function saveSmsRelayState(patch: Partial<SmsRelayState>): Promise<SmsRelayState> {
  const current = await loadAppState();
  const smsRelay = normalizeSmsRelayState({
    ...current.smsRelay,
    ...patch,
    updatedAt: Date.now(),
  });
  const next = normalizeAppState({ ...current, smsRelay });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next.smsRelay;
}

export function isFeatureTab(value: string): value is FeatureTab {
  return value === 'register' || value === 'link' || value === 'session' || value === 'address' || value === 'sms';
}

function normalizeAppState(value: unknown): AppState {
  const source = isRecord(value) ? value : {};
  const registerSource = isRecord(source.register) ? source.register : source;
  const linkSource = isRecord(source.linkExtractor) ? source.linkExtractor : source;
  const sessionConverterSource = isRecord(source.sessionConverter) ? source.sessionConverter : DEFAULT_SESSION_CONVERTER_STATE;
  const smsRelaySource = isRecord(source.smsRelay) ? source.smsRelay : DEFAULT_SMS_RELAY_STATE;
  return {
    activeTab: isFeatureTab(String(source.activeTab || '')) ? source.activeTab as FeatureTab : DEFAULT_STATE.activeTab,
    panelCollapsed: Boolean(source.panelCollapsed),
    register: normalizeRegisterState(registerSource),
    linkExtractor: normalizeLinkExtractorState(linkSource),
    sessionConverter: normalizeSessionConverterState(sessionConverterSource),
    smsRelay: normalizeSmsRelayState(smsRelaySource),
  };
}

function normalizeRegisterState(value: unknown): RegisterState {
  const source = isRecord(value) ? value : {};
  const himailDomains = normalizeStringArray(source.himailDomains);
  return {
    provider: normalizeRegisterProvider(source.provider),
    rawInput: String(source.rawInput || DEFAULT_REGISTER_STATE.rawInput),
    email: String(source.email || DEFAULT_REGISTER_STATE.email),
    accountLine: String(source.accountLine || DEFAULT_REGISTER_STATE.accountLine),
    inputMode: normalizeInputMode(source.inputMode),
    autoOtp: Boolean(source.autoOtp),
    apiBase: String(source.apiBase || DEFAULT_REGISTER_STATE.apiBase),
    himailPrefix: String(source.himailPrefix || DEFAULT_REGISTER_STATE.himailPrefix),
    himailDomain: String(source.himailDomain || himailDomains[0] || DEFAULT_REGISTER_STATE.himailDomain),
    himailDomains,
    himailEmail: String(source.himailEmail || DEFAULT_REGISTER_STATE.himailEmail),
    himailMessages: normalizeHimailMessages(source.himailMessages),
    himailLastCode: String(source.himailLastCode || DEFAULT_REGISTER_STATE.himailLastCode),
    himailCreatedAt: Number(source.himailCreatedAt || DEFAULT_REGISTER_STATE.himailCreatedAt),
    himailLastFetchAt: Number(source.himailLastFetchAt || DEFAULT_REGISTER_STATE.himailLastFetchAt),
    himailPollEnabled: Boolean(source.himailPollEnabled),
    otpRequestedAt: Number(source.otpRequestedAt || DEFAULT_REGISTER_STATE.otpRequestedAt),
    updatedAt: Number(source.updatedAt || DEFAULT_REGISTER_STATE.updatedAt),
  };
}

function normalizeLinkExtractorState(value: unknown): LinkExtractorState {
  const source = isRecord(value) ? value : {};
  return {
    checkoutOptions: normalizeCheckoutOptions(source.checkoutOptions || DEFAULT_LINK_STATE.checkoutOptions),
    updatedAt: Number(source.updatedAt || DEFAULT_LINK_STATE.updatedAt),
  };
}

function normalizeSmsRelayState(value: unknown): SmsRelayState {
  const source = isRecord(value) ? value : {};
  const history = Array.isArray(source.history)
    ? source.history.map(normalizeSmsCodeRecord).filter((item): item is SmsCodeRecord => Boolean(item))
    : DEFAULT_SMS_RELAY_STATE.history;
  return {
    rawInput: String(source.rawInput || DEFAULT_SMS_RELAY_STATE.rawInput),
    history,
    updatedAt: Number(source.updatedAt || DEFAULT_SMS_RELAY_STATE.updatedAt),
  };
}

function normalizeSessionConverterState(value: unknown): SessionConverterState {
  const source = isRecord(value) ? value : {};
  return {
    format: normalizeSessionConvertFormat(source.format),
    updatedAt: Number(source.updatedAt || DEFAULT_SESSION_CONVERTER_STATE.updatedAt),
  };
}

function normalizeSmsCodeRecord(value: unknown): SmsCodeRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const phone = String(value.phone || '').trim();
  const code = String(value.code || '').trim();
  if (!phone || !code) {
    return null;
  }

  const receivedAt = Number(value.receivedAt || 0) || Date.now();
  return {
    id: String(value.id || `${phone}-${code}-${receivedAt}`),
    phone,
    code,
    message: String(value.message || '').trim(),
    receivedAt,
  };
}

function normalizeInputMode(value: unknown): AccountInputMode {
  return value === 'email' || value === 'outlook-line' || value === 'invalid' ? value : 'empty';
}

function normalizeRegisterProvider(value: unknown): RegisterProvider {
  return value === 'himail' ? 'himail' : 'default';
}

function normalizeSessionConvertFormat(value: unknown): SessionConvertFormat {
  return value === 'cpa' ||
    value === 'cockpit' ||
    value === '9router' ||
    value === 'axonhub' ||
    value === 'codexmanager'
    ? value
    : 'sub2api';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  ));
}

function normalizeHimailMessages(value: unknown): HimailEmailMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeHimailMessage(item))
    .filter((item): item is HimailEmailMessage => Boolean(item));
}

function normalizeHimailMessage(value: unknown): HimailEmailMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = String(value.id || '').trim();
  const body = String(value.body || '').trim();
  const subject = String(value.subject || '').trim();
  if (!id && !body && !subject) {
    return null;
  }

  return {
    id: id || `${subject}-${Number(value.receivedAt || 0) || Date.now()}`,
    from: String(value.from || '').trim(),
    to: String(value.to || '').trim(),
    subject,
    date: String(value.date || '').trim(),
    body,
    code: String(value.code || '').trim(),
    receivedAt: Number(value.receivedAt || 0) || Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

import { extractSmsCode } from '../sms/parser';
import type {
  HimailCreateEmailResponse,
  HimailDomainsResponse,
  HimailEmailMessage,
  HimailFetchMessagesResponse,
} from './types';

const HIMAIL_BASE_URL = 'https://imail.edu.vn';
const DEFAULT_DOMAIN = 'imail.edu.vn';
const SESSION_STORAGE_KEY = 'opx.himail.session';
const CREATE_TIMEOUT_MS = 20_000;
const FETCH_TIMEOUT_MS = 30_000;
const CHALLENGE_MAX_RETRIES = 2;
const CHALLENGE_RETRY_DELAY_MS = 5_500;
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

interface LivewireInitialData {
  fingerprint: Record<string, unknown>;
  effects?: Record<string, unknown>;
  serverMemo: Record<string, unknown>;
}

interface HimailSession {
  cookies: string;
  csrfToken: string;
  email: string;
  app?: LivewireInitialData;
  appServerMemo?: Record<string, unknown>;
  updatedAt: number;
}

let session: HimailSession | null = null;

export async function fetchHimailDomains(): Promise<HimailDomainsResponse> {
  try {
    return await fetchHimailDomainsUnsafe();
  } catch (error) {
    if (isHimailChallengeError(error)) {
      return {
        ok: false,
        message: error.message,
        domains: [],
        defaultDomain: DEFAULT_DOMAIN,
      };
    }
    throw error;
  }
}

async function fetchHimailDomainsUnsafe(): Promise<HimailDomainsResponse> {
  const page = await fetchPage(`${HIMAIL_BASE_URL}/`, '', CREATE_TIMEOUT_MS);
  const domains = extractDomains(page.html);
  if (!domains.length) {
    return {
      ok: false,
      message: '没有从 himail 页面读取到后缀',
      domains: [],
      defaultDomain: DEFAULT_DOMAIN,
    };
  }

  return {
    ok: true,
    message: `已读取 ${domains.length} 个后缀`,
    domains,
    defaultDomain: domains.includes(DEFAULT_DOMAIN) ? DEFAULT_DOMAIN : domains[0],
  };
}

export async function createHimailEmail(prefixInput: string, domainInput: string): Promise<HimailCreateEmailResponse> {
  try {
    return await createHimailEmailUnsafe(prefixInput, domainInput);
  } catch (error) {
    if (isHimailChallengeError(error)) {
      return {
        ok: false,
        message: error.message,
      };
    }
    throw error;
  }
}

async function createHimailEmailUnsafe(prefixInput: string, domainInput: string): Promise<HimailCreateEmailResponse> {
  const prefix = normalizePrefix(prefixInput) || randomPrefix();
  const home = await fetchPage(`${HIMAIL_BASE_URL}/`, '', CREATE_TIMEOUT_MS);
  const actions = findLivewireComponent(home.html, 'frontend.actions');
  if (!actions) {
    return {
      ok: false,
      message: '没有找到 himail 创建组件',
    };
  }

  const domains = extractDomains(home.html);
  const domain = normalizeDomain(domainInput, domains);
  if (!domain) {
    return {
      ok: false,
      message: '请选择有效的 himail 邮箱后缀',
      domains,
    };
  }

  const createPayload = {
    fingerprint: actions.fingerprint,
    serverMemo: actions.serverMemo,
    updates: [
      {
        type: 'syncInput',
        payload: {
          id: randomLivewireId(),
          name: 'user',
          value: prefix,
        },
      },
      {
        type: 'callMethod',
        payload: {
          id: randomLivewireId(),
          method: 'setDomain',
          params: [domain],
        },
      },
      {
        type: 'callMethod',
        payload: {
          id: randomLivewireId(),
          method: 'create',
          params: [],
        },
      },
    ],
  };

  const create = await postLivewire('frontend.actions', createPayload, home.csrfToken, home.cookies);
  const data = asRecord(asRecord(create.json.serverMemo).data);
  const email = stringValue(data.email) || `${prefix}@${domain}`;
  if (!isEmail(email)) {
    return {
      ok: false,
      message: 'himail 创建返回的邮箱无效',
      domains,
    };
  }

  const cookies = mergeCookies(home.cookies, create.cookies);
  const mailbox = await fetchPage(`${HIMAIL_BASE_URL}/mailbox`, cookies, FETCH_TIMEOUT_MS);
  const app = findLivewireComponent(mailbox.html, 'frontend.app');
  if (!app) {
    return {
      ok: false,
      message: '邮箱已创建，但没有进入 himail mailbox 页面',
      email,
      prefix,
      domain,
      domains,
    };
  }

  session = {
    cookies: mergeCookies(cookies, mailbox.cookies),
    csrfToken: mailbox.csrfToken || home.csrfToken,
    email,
    app,
    appServerMemo: cloneRecord(app.serverMemo),
    updatedAt: Date.now(),
  };
  await saveSession(session);

  return {
    ok: true,
    message: `已创建 ${email}`,
    email,
    prefix,
    domain,
    domains,
  };
}

export async function fetchHimailMessages(emailInput?: string): Promise<HimailFetchMessagesResponse> {
  try {
    return await fetchHimailMessagesUnsafe(emailInput);
  } catch (error) {
    if (isHimailChallengeError(error)) {
      return {
        ok: false,
        message: error.message,
        email: emailInput,
        messages: [],
        fetchedAt: Date.now(),
      };
    }
    throw error;
  }
}

async function fetchHimailMessagesUnsafe(emailInput?: string): Promise<HimailFetchMessagesResponse> {
  session ||= await loadSession();
  if (!session?.app) {
    return {
      ok: false,
      message: '请先创建 himail 邮箱',
      email: emailInput,
      messages: [],
      fetchedAt: Date.now(),
    };
  }

  if (emailInput && session.email && emailInput !== session.email) {
    return {
      ok: false,
      message: '当前后台会话和面板邮箱不一致，请重新创建邮箱',
      email: emailInput,
      messages: [],
      fetchedAt: Date.now(),
    };
  }

  const payload = {
    fingerprint: session.app.fingerprint,
    serverMemo: session.appServerMemo || session.app.serverMemo,
    updates: [
      {
        type: 'fireEvent',
        payload: {
          id: randomLivewireId(),
          event: 'fetchMessages',
          params: [],
        },
      },
    ],
  };

  const response = await postLivewire(
    'frontend.app',
    payload,
    session.csrfToken,
    session.cookies,
  );
  session.cookies = mergeCookies(session.cookies, response.cookies);
  session.updatedAt = Date.now();
  if (isRecord(response.json.serverMemo)) {
    session.appServerMemo = mergeServerMemo(session.appServerMemo || session.app.serverMemo, response.json.serverMemo);
    session.app.serverMemo = session.appServerMemo;
  }
  await saveSession(session);

  const html = stringValue(asRecord(response.json.effects).html);
  const responseWithFullMemo = {
    ...response.json,
    serverMemo: session.appServerMemo,
  };
  const messages = extractMessagesFromLivewireResponse(responseWithFullMemo, html, session.email);
  const code = messages.find((message) => message.code)?.code || extractSmsCode(stripHtml(html));

  return {
    ok: true,
    message: messages.length ? `收到 ${messages.length} 封邮件` : '暂无邮件',
    email: session.email,
    messages,
    code,
    fetchedAt: Date.now(),
  };
}

async function fetchPage(
  url: string,
  cookies: string,
  timeoutMs: number,
  attempt = 0,
): Promise<{ html: string; cookies: string; csrfToken: string }> {
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Accept: 'text/html, application/xhtml+xml',
    },
    redirect: 'follow',
    credentials: 'include',
    cache: 'no-store',
  }, timeoutMs);
  const html = await response.text();
  const nextCookies = mergeCookies(cookies, getSetCookies(response.headers));
  if (isHimailChallengePage(html)) {
    if (attempt < CHALLENGE_MAX_RETRIES) {
      await delay(CHALLENGE_RETRY_DELAY_MS);
      return fetchPage(url, nextCookies, timeoutMs, attempt + 1);
    }
    throw new HimailChallengeError();
  }
  return {
    html,
    cookies: nextCookies,
    csrfToken: extractCsrfToken(html),
  };
}

async function postLivewire(
  component: string,
  payload: Record<string, unknown>,
  csrfToken: string,
  cookies: string,
  attempt = 0,
): Promise<{ json: Record<string, unknown>; cookies: string }> {
  const response = await fetchWithTimeout(`${HIMAIL_BASE_URL}/livewire/message/${component}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/html, application/xhtml+xml',
      'X-Livewire': 'true',
      ...(csrfToken ? { 'X-CSRF-TOKEN': csrfToken } : {}),
    },
    body: JSON.stringify(payload),
    redirect: 'follow',
    credentials: 'include',
    cache: 'no-store',
  }, FETCH_TIMEOUT_MS);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`himail Livewire 返回 ${response.status}：${shorten(text || response.statusText)}`);
  }

  const nextCookies = getSetCookies(response.headers);
  if (isHimailChallengePage(text)) {
    if (attempt < CHALLENGE_MAX_RETRIES) {
      await delay(CHALLENGE_RETRY_DELAY_MS);
      return postLivewire(component, payload, csrfToken, mergeCookies(cookies, nextCookies), attempt + 1);
    }
    throw new HimailChallengeError();
  }

  const json = parseJsonObject(text);
  return {
    json,
    cookies: mergeCookies(cookies, nextCookies),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function findLivewireComponent(html: string, name: string): LivewireInitialData | null {
  const matches = html.matchAll(/wire:initial-data="([^"]+)"/g);
  for (const match of matches) {
    const parsed = parseLivewireInitialData(match[1]);
    if (stringValue(parsed?.fingerprint?.name) === name) {
      return parsed;
    }
  }
  return null;
}

function parseLivewireInitialData(value: string): LivewireInitialData | null {
  try {
    const parsed = JSON.parse(decodeHtml(value));
    if (!isRecord(parsed) || !isRecord(parsed.fingerprint) || !isRecord(parsed.serverMemo)) {
      return null;
    }
    return {
      fingerprint: parsed.fingerprint,
      effects: isRecord(parsed.effects) ? parsed.effects : undefined,
      serverMemo: parsed.serverMemo,
    };
  } catch {
    return null;
  }
}

function extractDomains(html: string): string[] {
  const domains = new Set<string>();
  for (const match of html.matchAll(/\$wire\.setDomain\('([^']+)'\)/g)) {
    const domain = match[1].trim();
    if (DOMAIN_RE.test(domain)) {
      domains.add(domain);
    }
  }

  const actions = findLivewireComponent(html, 'frontend.actions');
  const data = asRecord(asRecord(actions?.serverMemo).data);
  const componentDomains = Array.isArray(data.domains) ? data.domains : [];
  for (const value of componentDomains) {
    const domain = String(value || '').trim();
    if (DOMAIN_RE.test(domain)) {
      domains.add(domain);
    }
  }

  return [...domains];
}

function extractCsrfToken(html: string): string {
  return (
    html.match(/window\.livewire_token\s*=\s*'([^']+)'/)?.[1] ||
    html.match(/name="_token"\s+value="([^"]+)"/)?.[1] ||
    ''
  );
}

function extractMessagesFromLivewireResponse(json: Record<string, unknown>, html: string, email: string): HimailEmailMessage[] {
  const data = asRecord(asRecord(json.serverMemo).data);
  const rawMessages = Array.isArray(data.messages) ? data.messages : [];
  const messages = rawMessages
    .map((item, index) => normalizeMessageObject(item, index, email))
    .filter((item): item is HimailEmailMessage => Boolean(item));

  if (messages.length) {
    return dedupeMessages(messages);
  }

  return extractMessagesFromHtml(html, email);
}

function normalizeMessageObject(value: unknown, index: number, email: string): HimailEmailMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const body = stringValue(value.body) ||
    stringValue(value.text) ||
    stringValue(value.content) ||
    stringValue(value.html) ||
    stringValue(value.message);
  const subject = stringValue(value.subject);
  const from = stringValue(value.from);
  const to = stringValue(value.to) || email;
  const date = stringValue(value.date) || stringValue(value.received_at) || stringValue(value.created_at);
  const cleanSubject = stripHtml(subject);
  const cleanBody = stripHtml(body);
  const code = extractSmsCode(`${cleanSubject}\n${cleanBody}`);
  const receivedAt = Number(value.receivedAt || value.received_at || 0) || Date.now();
  const id = stringValue(value.id) || `${email}-${date}-${subject}-${index}`;

  if (!body && !subject) {
    return null;
  }

  return {
    id,
    from,
    to,
    subject: cleanSubject,
    date,
    body: cleanBody,
    code,
    receivedAt,
  };
}

function extractMessagesFromHtml(html: string, email: string): HimailEmailMessage[] {
  const cleaned = stripHtml(html);
  if (!cleaned || /Empty Inbox/i.test(cleaned)) {
    return [];
  }

  const code = extractSmsCode(cleaned);
  if (!code && cleaned.length < 8) {
    return [];
  }

  return [{
    id: `${email}-${hashText(cleaned)}`,
    from: '',
    to: email,
    subject: firstMeaningfulLine(cleaned),
    date: '',
    body: cleaned,
    code,
    receivedAt: Date.now(),
  }];
}

function dedupeMessages(messages: HimailEmailMessage[]): HimailEmailMessage[] {
  const seen = new Set<string>();
  const result: HimailEmailMessage[] = [];
  for (const message of messages) {
    const key = message.id || `${message.subject}\n${message.body}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(message);
  }
  return result;
}

function stripHtml(value: string): string {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstMeaningfulLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 120) || 'himail 邮件';
}

function normalizePrefix(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 48);
}

function normalizeDomain(value: string, domains: string[]): string {
  const domain = value.trim().toLowerCase();
  if (domain && domains.includes(domain)) {
    return domain;
  }
  if (domain && DOMAIN_RE.test(domain) && !domains.length) {
    return domain;
  }
  return domains.includes(DEFAULT_DOMAIN) ? DEFAULT_DOMAIN : domains[0] || '';
}

function randomPrefix(): string {
  return randomBase36(6);
}

function randomBase36(length: number): string {
  let value = '';
  while (value.length < length) {
    value += Math.random().toString(36).slice(2);
  }
  return value.slice(0, length);
}

function randomLivewireId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    if (isRecord(value)) {
      return value;
    }
  } catch {
    // Fall through to the error below.
  }
  throw new Error(`himail 返回不是有效 JSON：${shorten(text)}`);
}

class HimailChallengeError extends Error {
  constructor() {
    super('imail.edu.vn 正在验证当前请求，已自动等待重试但仍未通过。请在浏览器打开 https://imail.edu.vn/mailbox 完成验证后再刷新，或更换网络/IP。');
    this.name = 'HimailChallengeError';
  }
}

function isHimailChallengeError(error: unknown): error is HimailChallengeError {
  return error instanceof HimailChallengeError;
}

function isHimailChallengePage(text: string): boolean {
  const normalized = shorten(text, 1200).toLowerCase();
  return normalized.includes('<!doctype html') &&
    (
      normalized.includes('请稍候') ||
      normalized.includes('正在验证您的请求') ||
      normalized.includes('window.location.reload') ||
      normalized.includes('checking your browser') ||
      normalized.includes('just a moment')
    );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveSession(value: HimailSession): Promise<void> {
  try {
    await browser.storage.local.set({ [SESSION_STORAGE_KEY]: value });
  } catch {
    // The in-memory session is still usable while the background stays alive.
  }
}

async function loadSession(): Promise<HimailSession | null> {
  try {
    const data = await browser.storage.local.get(SESSION_STORAGE_KEY);
    const value = data[SESSION_STORAGE_KEY];
    if (!isRecord(value) || !isRecord(value.app)) {
      return null;
    }
    return {
      cookies: stringValue(value.cookies),
      csrfToken: stringValue(value.csrfToken),
      email: stringValue(value.email),
      app: value.app as unknown as LivewireInitialData,
      appServerMemo: isRecord(value.appServerMemo) ? value.appServerMemo : undefined,
      updatedAt: Number(value.updatedAt || 0),
    };
  } catch {
    return null;
  }
}

function mergeServerMemo(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = cloneRecord(current);
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'data') {
      next.data = {
        ...asRecord(next.data),
        ...asRecord(value),
      };
    } else {
      next[key] = value;
    }
  }
  return next;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function mergeCookies(current: string, next: string | string[]): string {
  const jar = new Map<string, string>();
  for (const cookie of splitCookieHeader(current)) {
    const index = cookie.indexOf('=');
    if (index > 0) {
      jar.set(cookie.slice(0, index), cookie.slice(index + 1));
    }
  }
  const incoming = Array.isArray(next) ? next : splitCookieHeader(next);
  for (const cookie of incoming) {
    const pair = cookie.split(';')[0].trim();
    const index = pair.indexOf('=');
    if (index > 0) {
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function getSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie();
  }

  const combined = headers.get('set-cookie');
  return combined ? splitCombinedSetCookie(combined) : [];
}

function splitCookieHeader(value: string): string[] {
  return value.split(/;\s*/).filter((item) => item.includes('='));
}

function splitCombinedSetCookie(value: string): string[] {
  return value.split(/,(?=\s*[^;,]+=)/g).map((item) => item.trim()).filter(Boolean);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return String(Math.abs(hash));
}

function shorten(text: string, limit = 320): string {
  return String(text || '').replace(/\s+/g, ' ').slice(0, limit);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

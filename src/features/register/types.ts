import type { ActionResult } from '../../app/types';

export type { ActionResult } from '../../app/types';

export interface PageState {
  kind: 'login' | 'email-verification' | 'about-you' | 'unknown';
  label: string;
  canFillEmail: boolean;
  canFillOtp: boolean;
  canFillProfile: boolean;
}

export interface RegisterController {
  getPageState(): PageState;
  loadState(): Promise<RegisterState>;
  saveInput(rawInput: string): Promise<RegisterState>;
  saveProvider(provider: RegisterProvider): Promise<RegisterState>;
  saveHimailOptions(patch: Partial<Pick<RegisterState, 'himailPrefix' | 'himailDomain'>>): Promise<RegisterState>;
  fillEmailFromInput(): Promise<ActionResult>;
  fillOtp(code: string): Promise<ActionResult>;
  waitForOutlookOtp(): Promise<ActionResult>;
  refreshHimailDomains(): Promise<ActionResult>;
  createHimailEmailAndContinue(): Promise<ActionResult>;
  refreshHimailMessages(options?: { autoSubmit?: boolean }): Promise<ActionResult>;
  fillProfileAndCreate(): Promise<ActionResult>;
  autoRunForCurrentPage(): Promise<void>;
}

export interface RegisterState {
  provider: RegisterProvider;
  rawInput: string;
  email: string;
  accountLine: string;
  inputMode: AccountInputMode;
  autoOtp: boolean;
  apiBase: string;
  himailPrefix: string;
  himailDomain: string;
  himailDomains: string[];
  himailEmail: string;
  himailMessages: HimailEmailMessage[];
  himailLastCode: string;
  himailCreatedAt: number;
  himailLastFetchAt: number;
  himailPollEnabled: boolean;
  otpRequestedAt: number;
  updatedAt: number;
}

export type RegisterProvider = 'default' | 'himail';

export type AccountInputMode = 'empty' | 'email' | 'outlook-line' | 'invalid';

export interface ParsedAccountInput {
  ok: boolean;
  mode: AccountInputMode;
  email: string;
  accountLine: string;
  message: string;
}

export interface OutlookOtpMessage {
  type: 'opx:wait-outlook-otp';
  accountLine: string;
  apiBase?: string;
  timeoutMs?: number;
  intervalMs?: number;
  since?: number;
}

export interface OutlookOtpResponse {
  ok: boolean;
  message: string;
  code?: string;
}

export interface HimailEmailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  code: string;
  receivedAt: number;
}

export interface HimailDomainsMessage {
  type: 'opx:himail-domains';
}

export interface HimailDomainsResponse {
  ok: boolean;
  message: string;
  domains: string[];
  defaultDomain?: string;
}

export interface HimailCreateEmailMessage {
  type: 'opx:himail-create-email';
  prefix: string;
  domain: string;
}

export interface HimailCreateEmailResponse {
  ok: boolean;
  message: string;
  email?: string;
  prefix?: string;
  domain?: string;
  domains?: string[];
}

export interface HimailFetchMessagesMessage {
  type: 'opx:himail-fetch-messages';
  email?: string;
}

export interface HimailFetchMessagesResponse {
  ok: boolean;
  message: string;
  email?: string;
  messages: HimailEmailMessage[];
  code?: string;
  fetchedAt: number;
}

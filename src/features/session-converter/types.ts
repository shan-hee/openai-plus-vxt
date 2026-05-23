export type SessionConvertFormat = 'cpa' | 'sub2api' | 'cockpit' | '9router' | 'axonhub' | 'codexmanager';

export interface SessionConverterState {
  format: SessionConvertFormat;
  updatedAt: number;
}

export interface ConvertedSession {
  sourceName: string;
  sourcePath?: string;
  email?: string;
  name?: string;
  expiresAt?: string;
  accessTokenExpiresAt?: number;
  cpa: unknown;
  cockpit: unknown;
  nineRouter: unknown;
  axonHub: unknown;
  codexManager: unknown;
  sub2apiAccount: unknown;
}

export interface SessionSource {
  value: Record<string, unknown>;
  sourceName: string;
  path: string;
}

export interface SessionConvertIssue {
  sourceName: string;
  path?: string;
  reason: string;
}

export interface SessionConvertResult {
  converted: ConvertedSession[];
  skipped: SessionConvertIssue[];
  sources: SessionSource[];
  output: string;
  document: unknown;
}

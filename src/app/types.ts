export type FeatureTab = 'register' | 'link' | 'session' | 'address' | 'sms';

export interface ActionResult {
  ok: boolean;
  message: string;
  code?: string;
  url?: string;
  data?: unknown;
}

export interface FeaturePanelHandle {
  update(): void | Promise<void>;
  onShow?(): void | Promise<void>;
}

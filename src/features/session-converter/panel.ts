import { loadSessionConverterState, saveSessionConverterState } from '../../app/state';
import type { FeaturePanelHandle } from '../../app/types';
import type { ChatGptSessionResponse } from '../link-extractor/types';
import {
  collectSessionLikeObjects,
  convertSessionRecords,
  convertSessionText,
  formatSessionDisplayDate,
  getSessionTimestampToken,
  sanitizeSessionFileToken,
  SESSION_EXAMPLE,
  SESSION_FORMAT_LABELS,
} from './converter';
import type { ConvertedSession, SessionConvertFormat, SessionConvertIssue, SessionSource } from './types';

const FORMAT_OPTIONS: Array<[SessionConvertFormat, string]> = [
  ['cpa', 'CPA'],
  ['sub2api', 'sub2api'],
  ['cockpit', 'Cockpit'],
  ['9router', '9router'],
  ['axonhub', 'AxonHub'],
  ['codexmanager', 'Codex-Manager'],
];

type InputSource = 'empty' | 'auto-session' | 'manual' | 'file' | 'example';

export function createSessionConverterPanel(container: HTMLElement): FeaturePanelHandle {
  const summary = document.createElement('div');
  summary.className = 'opx-summary';

  const sessionCard = document.createElement('div');
  sessionCard.className = 'opx-session-card';
  const emailValue = createSessionRow('邮箱', '未读取');
  const planValue = createSessionRow('套餐', '未读取');
  const tokenValue = createSessionRow('Token', '未读取');
  sessionCard.append(emailValue.row, planValue.row, tokenValue.row);

  const refreshSessionButton = createButton('读取 ChatGPT session', 'opx-button opx-button-secondary');

  const formatSelect = createSelect(FORMAT_OPTIONS);
  const formatField = createField('转换格式', formatSelect);

  const input = document.createElement('textarea');
  input.className = 'opx-textarea opx-session-converter-input';
  input.placeholder = '自动读取或粘贴 ChatGPT Web session / OAuth JSON';
  input.autocomplete = 'off';
  input.spellcheck = false;

  const inputActions = document.createElement('div');
  inputActions.className = 'opx-button-row opx-session-converter-actions';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.multiple = true;
  fileInput.hidden = true;
  const pickFileButton = createButton('选择文件', 'opx-button opx-button-secondary');
  const exampleButton = createButton('填入示例结构', 'opx-button opx-button-secondary');
  const clearButton = createButton('清空', 'opx-button opx-button-secondary');
  inputActions.append(pickFileButton, exampleButton, clearButton);

  const stats = document.createElement('div');
  stats.className = 'opx-session-converter-stats';
  const countStat = createStat('账号', '0');
  const errorStat = createStat('跳过', '0');
  const formatStat = createStat('格式', 'sub2api');
  stats.append(countStat.item, errorStat.item, formatStat.item);

  const accounts = document.createElement('div');
  accounts.className = 'opx-session-converter-accounts';

  const issues = document.createElement('div');
  issues.className = 'opx-session-converter-issues';
  issues.hidden = true;

  const output = document.createElement('textarea');
  output.className = 'opx-textarea opx-output opx-session-converter-output';
  output.placeholder = '转换后会显示 JSON';
  output.readOnly = true;
  output.spellcheck = false;

  const outputActions = document.createElement('div');
  outputActions.className = 'opx-button-row opx-session-converter-output-actions';
  const copyButton = createButton('复制输出', 'opx-button opx-button-secondary');
  const downloadButton = createButton('下载 JSON', 'opx-button opx-button-secondary');
  outputActions.append(copyButton, downloadButton);

  const status = document.createElement('div');
  status.className = 'opx-status';
  status.textContent = '等待输入。';

  let refreshInFlight = false;
  let converted: ConvertedSession[] = [];
  let skipped: SessionConvertIssue[] = [];
  let outputText = '';
  let inputSource: InputSource = 'empty';

  const update = async () => {
    const saved = await loadSessionConverterState();
    formatSelect.value = saved.format;
    renderOutput();
  };

  const onShow = async () => {
    await update();
    if (!refreshInFlight) {
      await refreshSession(false, inputSource === 'empty' || inputSource === 'auto-session');
    }
  };

  formatSelect.addEventListener('change', async () => {
    await saveSessionConverterState({ format: readFormat() });
    convertCurrentInput(false);
    await update();
  });

  refreshSessionButton.addEventListener('click', () => void refreshSession(true, true));

  input.addEventListener('input', () => {
    inputSource = input.value.trim() ? 'manual' : 'empty';
    convertCurrentInput(true);
  });

  pickFileButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    void readFiles(fileInput.files);
    fileInput.value = '';
  });

  exampleButton.addEventListener('click', () => {
    input.value = JSON.stringify(SESSION_EXAMPLE, null, 2);
    inputSource = 'example';
    convertCurrentInput(true);
  });

  clearButton.addEventListener('click', () => {
    input.value = '';
    inputSource = 'empty';
    converted = [];
    skipped = [];
    outputText = '';
    setSessionRows('', '', '');
    renderOutput();
    setStatus(status, '已清空。', 'ok');
  });

  copyButton.addEventListener('click', async () => {
    if (!outputText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(outputText);
      setStatus(status, '已复制输出。', 'ok');
    } catch {
      output.select();
      document.execCommand('copy');
      setStatus(status, '已复制输出。', 'ok');
    }
  });

  downloadButton.addEventListener('click', () => {
    if (!outputText) {
      return;
    }
    const first = converted[0];
    const base = sanitizeSessionFileToken(first?.email || first?.name || readFormat());
    const fileName = `${base}.${readFormat()}.${getSessionTimestampToken()}.json`;
    const blob = new Blob([outputText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  container.append(
    summary,
    sessionCard,
    refreshSessionButton,
    formatField,
    input,
    inputActions,
    fileInput,
    stats,
    accounts,
    issues,
    createField('转换结果', output),
    outputActions,
    status,
  );
  void update();
  return { update, onShow };

  async function refreshSession(showStatus: boolean, applyToInput: boolean): Promise<void> {
    if (refreshInFlight) {
      return;
    }
    refreshInFlight = true;
    refreshSessionButton.disabled = true;
    if (showStatus) {
      setStatus(status, '正在读取 https://chatgpt.com/api/auth/session ...', 'pending');
    }
    try {
      const response: ChatGptSessionResponse = await browser.runtime.sendMessage({
        type: 'opx:fetch-chatgpt-session',
      });
      if (!isChatGptSessionResponse(response)) {
        setStatus(status, 'session 返回结果无效', 'error');
        return;
      }

      const session = response.session;
      setSessionRows(session?.email || '', session?.planType || '', session?.accessToken || '');
      if (!response.ok || !session?.accessToken) {
        setStatus(status, response.message, response.ok ? 'ok' : 'error');
        return;
      }

      if (applyToInput) {
        input.value = JSON.stringify({
          user: {
            email: session.email,
          },
          account: {
            planType: session.planType,
          },
          accessToken: session.accessToken,
        }, null, 2);
        inputSource = 'auto-session';
        convertCurrentInput(false);
      }
      setStatus(status, applyToInput ? response.message : `${response.message}，当前输入保持不变。`, 'ok');
    } catch (error) {
      setStatus(status, `读取 session 失败：${String(error)}`, 'error');
    } finally {
      refreshSessionButton.disabled = false;
      refreshInFlight = false;
    }
  }

  function convertCurrentInput(updateStatus: boolean): void {
    const text = input.value;
    if (!text.trim()) {
      converted = [];
      skipped = [];
      outputText = '';
      renderOutput();
      if (updateStatus) {
        setStatus(status, '等待输入。', 'pending');
      }
      return;
    }

    try {
      const result = convertSessionText(text, readFormat());
      converted = result.converted;
      skipped = result.skipped;
      outputText = result.output;
      renderOutput();
      if (updateStatus) {
        setStatus(status, converted.length ? `解析完成：${converted.length} 个账号，跳过 ${skipped.length} 项。` : '没有可转换账号。', converted.length ? 'ok' : 'error');
      }
    } catch (error) {
      converted = [];
      skipped = [{
        sourceName: 'pasted-json',
        path: '$',
        reason: error instanceof Error ? error.message : 'JSON 解析失败',
      }];
      outputText = '';
      renderOutput();
      setStatus(status, error instanceof Error ? error.message : 'JSON 解析失败', 'error');
    }
  }

  async function readFiles(files: FileList | null): Promise<void> {
    const jsonFiles = Array.from(files || []).filter((file) => file.name.toLowerCase().endsWith('.json'));
    if (!jsonFiles.length) {
      setStatus(status, '没有选择 JSON 文件。', 'error');
      return;
    }

    const documents: SessionSource[] = [];
    const fileSkipped: SessionConvertIssue[] = [];
    for (const file of jsonFiles) {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const found = collectSessionLikeObjects(parsed, file.webkitRelativePath || file.name);
        if (!found.length) {
          fileSkipped.push({
            sourceName: file.webkitRelativePath || file.name,
            path: '$',
            reason: '未找到包含 accessToken 和 user/email 的 session 对象',
          });
        }
        documents.push(...found);
      } catch (error) {
        fileSkipped.push({
          sourceName: file.webkitRelativePath || file.name,
          path: '$',
          reason: error instanceof Error ? error.message : '无法读取文件',
        });
      }
    }

    const result = convertSessionRecords(documents, readFormat(), fileSkipped);
    converted = result.converted;
    skipped = result.skipped;
    outputText = result.output;
    input.value = documents.length === 1
      ? JSON.stringify(documents[0].value, null, 2)
      : JSON.stringify(documents.map((item) => item.value), null, 2);
    inputSource = documents.length ? 'file' : 'empty';
    renderOutput();
    setStatus(status, `读取 ${jsonFiles.length} 个文件，生成 ${converted.length} 个账号，跳过 ${skipped.length} 项。`, converted.length ? 'ok' : 'error');
  }

  function renderOutput(): void {
    output.value = outputText;
    copyButton.disabled = !outputText;
    downloadButton.disabled = !outputText;
    countStat.value.textContent = String(converted.length);
    errorStat.value.textContent = String(skipped.length);
    formatStat.value.textContent = SESSION_FORMAT_LABELS[readFormat()];
    summary.textContent = `${SESSION_FORMAT_LABELS[readFormat()]} · ${converted.length} 个账号 · ${skipped.length} 个跳过`;
    renderAccounts();
    renderIssues();
  }

  function renderAccounts(): void {
    accounts.replaceChildren();
    if (!converted.length) {
      const empty = document.createElement('div');
      empty.className = 'opx-himail-empty';
      empty.textContent = '暂无可转换账号。';
      accounts.append(empty);
      return;
    }

    for (const item of converted.slice(0, 6)) {
      const row = document.createElement('div');
      row.className = 'opx-session-converter-account';
      const title = document.createElement('strong');
      title.textContent = item.name || item.email || 'ChatGPT Account';
      const meta = document.createElement('span');
      meta.textContent = [
        item.email || '',
        formatSessionDisplayDate(item.expiresAt) || '',
        item.sourceName || '',
      ].filter(Boolean).join(' · ');
      row.append(title, meta);
      accounts.append(row);
    }
  }

  function renderIssues(): void {
    issues.replaceChildren();
    issues.hidden = skipped.length === 0;
    if (!skipped.length) {
      return;
    }
    for (const item of skipped.slice(0, 5)) {
      const row = document.createElement('div');
      row.textContent = `${item.sourceName || 'input'} ${item.path || ''}: ${item.reason}`;
      issues.append(row);
    }
  }

  function readFormat(): SessionConvertFormat {
    const value = formatSelect.value;
    return value === 'cpa' ||
      value === 'cockpit' ||
      value === '9router' ||
      value === 'axonhub' ||
      value === 'codexmanager'
      ? value
      : 'sub2api';
  }

  function setSessionRows(email: string, planType: string, accessToken: string): void {
    emailValue.value.textContent = email || '未读取';
    planValue.value.textContent = planType || '未读取';
    tokenValue.value.textContent = accessToken ? '已获取' : '未获取';
  }
}

function createSessionRow(label: string, initialValue: string): { row: HTMLElement; value: HTMLElement } {
  const row = document.createElement('div');
  row.className = 'opx-session-row';
  const labelElement = document.createElement('span');
  labelElement.textContent = label;
  const value = document.createElement('strong');
  value.textContent = initialValue;
  row.append(labelElement, value);
  return { row, value };
}

function createButton(label: string, className = 'opx-button'): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = label;
  return button;
}

function createSelect(options: Array<[string, string]>): HTMLSelectElement {
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

function createStat(label: string, initialValue: string): { item: HTMLElement; value: HTMLElement } {
  const item = document.createElement('div');
  item.className = 'opx-session-converter-stat';
  const caption = document.createElement('span');
  caption.textContent = label;
  const value = document.createElement('strong');
  value.textContent = initialValue;
  item.append(caption, value);
  return { item, value };
}

function setStatus(element: HTMLElement, message: string, type: 'pending' | 'ok' | 'error'): void {
  element.textContent = message;
  element.dataset.type = type;
}

function isChatGptSessionResponse(value: unknown): value is ChatGptSessionResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ChatGptSessionResponse).ok === 'boolean' &&
      typeof (value as ChatGptSessionResponse).message === 'string',
  );
}

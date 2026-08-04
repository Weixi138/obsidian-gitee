import { GiteeClient } from '../gitee/client';

export interface DiagnosticResult {
  dns: { status: 'ok' | 'fail'; detail: string };
  api: { status: 'ok' | 'fail'; detail: string; latencyMs?: number };
  auth: { status: 'ok' | 'fail'; detail: string };
}

export async function runDiagnostics(client: GiteeClient): Promise<DiagnosticResult> {
  const result: DiagnosticResult = {
    dns: { status: 'fail', detail: '' },
    api: { status: 'fail', detail: '' },
    auth: { status: 'fail', detail: '' },
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const dnsStart = Date.now();
    await fetch('https://gitee.com', { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    result.dns = { status: 'ok', detail: `连通 (${Date.now() - dnsStart}ms)` };
  } catch {
    result.dns = { status: 'fail', detail: '无法解析 gitee.com' };
    return result;
  }

  try {
    const apiStart = Date.now();
    await client.getBranchCommitSha();
    result.api = { status: 'ok', detail: 'API 正常', latencyMs: Date.now() - apiStart };
    result.auth = { status: 'ok', detail: '令牌有效' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    result.api = { status: 'fail', detail: `API 错误: ${msg}` };
    if (msg.includes('401')) {
      result.auth = { status: 'fail', detail: '令牌无效或已过期' };
    } else if (msg.includes('404')) {
      result.auth = { status: 'fail', detail: '仓库或分支不存在' };
    }
  }

  return result;
}
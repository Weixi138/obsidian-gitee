import { requestUrl } from 'obsidian';

const API_BASE = 'https://gitee.com/api/v5';
const REQUEST_DELAY = 200;
const MAX_REQUESTS_PER_MINUTE = 55;
const REQUEST_TIMEOUT = 30000;
const MAX_RETRIES = 1;

function sanitizeUrl(url: string): string {
  if (!url) return url;
  return url.replace(/access_token=[^&]+/g, 'access_token=***');
}

const requestTimestamps: number[] = [];

async function rateLimit(): Promise<void> {
  const now = Date.now();
  while (requestTimestamps.length > 0 && requestTimestamps[0]! < now - 60000) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    const oldest = requestTimestamps[0]!;
    const waitMs = oldest + 60000 - now + 100;
    await new Promise(resolve => window.setTimeout(resolve, waitMs));
  }
  if (requestTimestamps.length > 0) {
    const last = requestTimestamps[requestTimestamps.length - 1]!;
    const gap = now - last;
    if (gap < REQUEST_DELAY) {
      await new Promise(resolve => window.setTimeout(resolve, REQUEST_DELAY - gap));
    }
  }
  requestTimestamps.push(Date.now());
}

function requestWithTimeout(url: string, method: string, body: string | undefined, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('请求超时')), timeoutMs);
    try {
      requestUrl({ url, method, contentType: 'application/json', body, throw: false })
        .then(response => {
          window.clearTimeout(timer);
          resolve(response);
        })
        .catch(err => {
          window.clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    } catch (e) {
      window.clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

interface GiteeBranchData {
  commit: { sha: string };
}

interface GiteeTreeItem {
  path: string;
  sha: string;
  type: 'blob' | 'tree';
}

interface GiteeTreeData {
  sha: string;
  tree: GiteeTreeItem[];
}

interface GiteeContentData {
  type: string;
  encoding: string;
  content: string;
  sha: string;
}

interface GiteeFileResponse {
  content?: { sha: string };
  commit?: { sha: string };
}

export class GiteeClient {
  private owner: string;
  private repo: string;
  private token: string;
  private branch: string;

  constructor(owner: string, repo: string, token: string, branch: string) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.branch = branch;
  }

  private async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${API_BASE}${path}${separator}access_token=${this.token}`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await rateLimit();
        const response = await requestWithTimeout(url, method, body ? JSON.stringify(body) : undefined, REQUEST_TIMEOUT);
        if (response.status >= 400) {
          throw new Error(`Gitee API error ${response.status}: ${response.text}`);
        }
        return response.json as T;
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => window.setTimeout(resolve, 1000));
        }
      }
    }
    throw new Error(sanitizeUrl(lastError!.message));
  }

  async getBranchCommitSha(): Promise<string> {
    const data = await this.request<GiteeBranchData>('GET', `/repos/${this.owner}/${this.repo}/branches/${this.branch}`);
    return data.commit.sha;
  }

  async getTreeSha(commitSha: string): Promise<string> {
    const data = await this.request<GiteeTreeData>('GET', `/repos/${this.owner}/${this.repo}/git/trees/${commitSha}`);
    return data.sha;
  }

  async getRecursiveTree(treeSha: string): Promise<Map<string, { sha: string; type: 'blob' | 'tree' }>> {
    const data = await this.request<GiteeTreeData>('GET', `/repos/${this.owner}/${this.repo}/git/trees/${treeSha}?recursive=1`);
    const map = new Map<string, { sha: string; type: 'blob' | 'tree' }>();
    for (const item of data.tree) {
      map.set(item.path, { sha: item.sha, type: item.type });
    }
    return map;
  }

  async getFileContent(path: string): Promise<{ content: string; sha: string } | null> {
    try {
      const encodedPath = this.encodePath(path);
      const data = await this.request<GiteeContentData>('GET', `/repos/${this.owner}/${this.repo}/contents/${encodedPath}`);
      const raw = atob((data.content || '').replace(/\n/g, ''));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
      }
      const content = new TextDecoder().decode(bytes);
      return { content, sha: data.sha };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Gitee Client] getFileContent 错误:', msg, 'path:', path);
      if (msg.includes('404')) return null;
      throw e;
    }
  }

  async createOrUpdateFile(path: string, contentBase64: string, message: string, sha?: string): Promise<string> {
    const encodedPath = this.encodePath(path);
    const body: Record<string, unknown> = { message, content: contentBase64 };
    if (sha) body.sha = sha;
    const method = sha ? 'PUT' : 'POST';
    const data = await this.request<GiteeFileResponse>(method, `/repos/${this.owner}/${this.repo}/contents/${encodedPath}`, body);
    return data.content?.sha || data.commit?.sha || '';
  }

  async deleteFile(path: string, message: string, sha: string): Promise<void> {
    const encodedPath = this.encodePath(path);
    await this.request('DELETE', `/repos/${this.owner}/${this.repo}/contents/${encodedPath}`, { message, sha });
  }

  private encodePath(path: string): string {
    return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
  }
}
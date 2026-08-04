import { requestUrl } from 'obsidian';

const API_BASE = 'https://gitee.com/api/v5';
const REQUEST_DELAY = 200;

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
    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    try {
      const response = await requestUrl({
        url,
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        throw: false,
      });
      if (response.status >= 400) {
        throw new Error(`Gitee API error ${response.status}: ${response.text}`);
      }
      await this.delay(REQUEST_DELAY);
      return response.json as T;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, ms));
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
      const raw = atob(data.content.replace(/\n/g, ''));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
      }
      const content = new TextDecoder().decode(bytes);
      return { content, sha: data.sha };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('404')) return null;
      throw e;
    }
  }

  async createOrUpdateFile(path: string, contentBase64: string, message: string, sha?: string): Promise<string> {
    const encodedPath = this.encodePath(path);
    const body: Record<string, unknown> = { message, content: contentBase64 };
    if (sha) body.sha = sha;
    const data = await this.request<GiteeFileResponse>('PUT', `/repos/${this.owner}/${this.repo}/contents/${encodedPath}`, body);
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
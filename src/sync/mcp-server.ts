import { App, Notice, TFile } from 'obsidian';

const MCP_PORT = 3100;

interface HttpRequest {
  on: (event: string, handler: (...args: any[]) => void) => void;
}

interface HttpResponse {
  writeHead: (status: number, headers: Record<string, string | number>) => void;
  end: (data: string) => void;
  on: (event: string, handler: (...args: any[]) => void) => void;
}

interface HttpServer {
  listen: (port: number, callback: () => void) => void;
  on: (event: string, handler: (err: Error) => void) => void;
  close: () => void;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

const TOOLS: MCPTool[] = [
  {
    name: 'list_notes',
    description: '列出 vault 中所有笔记文件',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: '可选：按文件夹路径过滤' },
      },
    },
  },
  {
    name: 'read_note',
    description: '读取笔记内容',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '笔记路径' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_notes',
    description: '搜索笔记内容',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
  },
];

export class McpServer {
  private app: App;
  private server: HttpServer | null = null;
  private running = false;

  constructor(app: App) {
    this.app = app;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<boolean> {
    if (this.running) return true;

    try {
      const mod = (window as Record<string, any>).require('http');
      if (!mod) throw new Error('http module not available');

      this.server = mod.createServer((req: HttpRequest, res: HttpResponse) => {
        this.handleRequest(req, res);
      }) as HttpServer;

      return new Promise((resolve) => {
        this.server!.listen(MCP_PORT, () => {
          this.running = true;
          new Notice(`MCP 服务器已启动: http://localhost:${MCP_PORT}`);
          resolve(true);
        });
        this.server!.on('error', (err: Error) => {
          new Notice(`MCP 服务器启动失败: ${err.message}`);
          this.running = false;
          resolve(false);
        });
      });
    } catch {
      new Notice('MCP 服务器仅支持桌面端');
      return false;
    }
  }

  stop(): void {
    if (this.server) {
      try {
        this.server.close();
      } catch {
        // ignore
      }
      this.server = null;
    }
    this.running = false;
    new Notice('MCP 服务器已停止');
  }

  private async handleRequest(req: HttpRequest, res: HttpResponse): Promise<void> {
    const body = await this.readBody(req);
    let request: any;
    try {
      request = JSON.parse(body);
    } catch {
      this.sendError(res, null, -32700, 'Parse error');
      return;
    }

    const { method, params, id } = request;

    if (method === 'tools/list') {
      this.sendResult(res, id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      await this.handleToolCall(res, id, params);
    } else {
      this.sendError(res, id, -32601, `Method not found: ${method}`);
    }
  }

  private async handleToolCall(res: HttpResponse, id: any, params: any): Promise<void> {
    const { name, arguments: args } = params || {};

    try {
      switch (name) {
        case 'list_notes': {
          const files = this.app.vault.getFiles().filter(f => f.extension === 'md');
          const folder = args?.folder;
          const filtered = folder
            ? files.filter(f => f.path.startsWith(folder))
            : files;
          this.sendResult(res, id, {
            content: [{
              type: 'text',
              text: filtered.map(f => f.path).join('\n'),
            }],
          });
          break;
        }
        case 'read_note': {
          const path = args?.path;
          if (!path) {
            this.sendError(res, id, -32602, 'Missing required argument: path');
            return;
          }
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) {
            this.sendError(res, id, -32602, `File not found: ${path}`);
            return;
          }
          const content = await this.app.vault.read(file);
          this.sendResult(res, id, {
            content: [{ type: 'text', text: content }],
          });
          break;
        }
        case 'search_notes': {
          const query = args?.query?.toLowerCase();
          if (!query) {
            this.sendError(res, id, -32602, 'Missing required argument: query');
            return;
          }
          const files = this.app.vault.getFiles().filter(f => f.extension === 'md');
          const results: { path: string; snippet: string }[] = [];
          for (const f of files) {
            const content = await this.app.vault.read(f);
            if (content.toLowerCase().includes(query)) {
              const idx = content.toLowerCase().indexOf(query);
              const start = Math.max(0, idx - 50);
              const end = Math.min(content.length, idx + 100);
              results.push({ path: f.path, snippet: content.slice(start, end) });
            }
          }
          this.sendResult(res, id, {
            content: [{
              type: 'text',
              text: results.map(r => `${r.path}\n  ...${r.snippet}...`).join('\n\n') || '未找到匹配内容',
            }],
          });
          break;
        }
        default:
          this.sendError(res, id, -32601, `Tool not found: ${name}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.sendError(res, id, -32603, `Internal error: ${msg}`);
    }
  }

  private sendResult(res: HttpResponse, id: any, result: any): void {
    this.sendJson(res, 200, { jsonrpc: '2.0', id, result });
  }

  private sendError(res: HttpResponse, id: any, code: number, message: string): void {
    this.sendJson(res, 200, { jsonrpc: '2.0', id, error: { code, message } });
  }

  private sendJson(res: HttpResponse, status: number, data: any): void {
    const json = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': json.length });
    res.end(json);
  }

  private readBody(req: HttpRequest): Promise<string> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: string) => { body += chunk; });
      req.on('end', () => resolve(body));
    });
  }
}
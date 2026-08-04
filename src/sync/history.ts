import { Plugin } from 'obsidian';
import { getConfigDir } from '../types';

export interface HistoryRecord {
  timestamp: number;
  type: 'push' | 'pull' | 'auto_push' | 'auto_pull' | 'delete';
  uploaded: number;
  downloaded: number;
  deleted: number;
  errors: string[];
}

export class SyncHistoryManager {
  private plugin: Plugin;
  private records: HistoryRecord[] = [];
  private maxRecords = 200;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  private getHistoryPath(): string {
    const configDir = getConfigDir(this.plugin.app.vault);
    return `${configDir}/plugins/sync-gitee/data/sync-history.json`;
  }

  async load(): Promise<void> {
    try {
      const path = this.getHistoryPath();
      const exists = await this.plugin.app.vault.adapter.exists(path);
      if (exists) {
        const raw = await this.plugin.app.vault.adapter.read(path);
        this.records = JSON.parse(raw) as HistoryRecord[];
      }
    } catch {
      this.records = [];
    }
  }

  async addRecord(record: HistoryRecord): Promise<void> {
    this.records.unshift(record);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(0, this.maxRecords);
    }
    try {
      await this.save();
    } catch (e) {
      // 保存失败时记录仍在内存中，下次操作会重试
    }
  }

  async save(): Promise<void> {
    const path = this.getHistoryPath();
    const dir = path.substring(0, path.lastIndexOf('/'));
    const dirExists = await this.plugin.app.vault.adapter.exists(dir);
    if (!dirExists) {
      await this.plugin.app.vault.adapter.mkdir(dir);
    }
    await this.plugin.app.vault.adapter.write(path, JSON.stringify(this.records, null, 2));
  }

  getRecords(limit = 50): HistoryRecord[] {
    return this.records.slice(0, limit);
  }

  getStats(): { totalPushes: number; totalPulls: number; totalUploaded: number; totalDownloaded: number; totalDeleted: number; totalErrors: number } {
    let totalPushes = 0;
    let totalPulls = 0;
    let totalUploaded = 0;
    let totalDownloaded = 0;
    let totalDeleted = 0;
    let totalErrors = 0;
    for (const r of this.records) {
      if (r.type === 'push' || r.type === 'auto_push') totalPushes++;
      if (r.type === 'pull' || r.type === 'auto_pull') totalPulls++;
      totalUploaded += r.uploaded;
      totalDownloaded += r.downloaded;
      totalDeleted += r.deleted;
      totalErrors += r.errors.length;
    }
    return { totalPushes, totalPulls, totalUploaded, totalDownloaded, totalDeleted, totalErrors };
  }

  async exportLog(): Promise<string> {
    let md = `# Gitee Sync 操作日志\n\n`;
    md += `导出时间: ${new Date().toLocaleString()}\n\n`;
    md += `| 时间 | 类型 | 上传 | 下载 | 删除 | 错误 |\n`;
    md += `|------|------|------|------|------|------|\n`;
    for (const r of this.records.slice(0, 100)) {
      md += `| ${new Date(r.timestamp).toLocaleString()} | ${r.type} | ${r.uploaded} | ${r.downloaded} | ${r.deleted} | ${r.errors.length > 0 ? r.errors.join('; ') : '-'} |\n`;
    }
    return md;
  }
}
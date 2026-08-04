import { App, Menu, Modal, Notice, Plugin, TFile, requestUrl } from 'obsidian';
import { GiteeSyncSettings, DEFAULT_SETTINGS } from './types';
import { GiteeSyncSettingTab } from './settings';
import { GiteeClient } from './gitee/client';
import { SyncStateManager } from './sync/state';
import { PasswordManager } from './password-manager';
import { SyncEngine } from './sync/engine';
import { SyncHistoryManager } from './sync/history';
import { McpServer } from './sync/mcp-server';
import { openChangelogModal } from './ui/history-view';

export default class GiteeEncryptedSyncPlugin extends Plugin {
  settings!: GiteeSyncSettings;
  stateManager!: SyncStateManager;
  giteeClient!: GiteeClient;
  syncEngine!: SyncEngine;
  passwordManager!: PasswordManager;
  historyManager!: SyncHistoryManager;
  mcpServer!: McpServer;
  private autoPushTimers: Map<string, number> = new Map();
  private syncIntervalId: number | null = null;
  private statusBarItem!: HTMLElement;

  async onload() {
    await this.loadSettings();

    this.passwordManager = new PasswordManager(this.settings);
    this.stateManager = new SyncStateManager(this);
    this.historyManager = new SyncHistoryManager(this);
    await this.historyManager.load();
    this.mcpServer = new McpServer(this.app);
    this.giteeClient = new GiteeClient(
      this.settings.owner,
      this.settings.repo,
      this.settings.token,
      this.settings.branch,
    );
    this.syncEngine = new SyncEngine(
      this,
      this.settings,
      this.giteeClient,
      this.stateManager,
      this.app.vault,
      this.passwordManager,
    );

    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText('Gitee: 就绪');
    this.statusBarItem.addClass('gitee-status-bar');
    this.statusBarItem.addEventListener('click', () => {
      new Notice(`上次同步: ${this.stateManager.getState().lastSyncTime ? new Date(this.stateManager.getState().lastSyncTime).toLocaleString() : '从未'}`);
    });

    this.addCommand({
      id: 'gitee-push',
      name: '推送所有文件至 Gitee',
      callback: async () => {
        try {
          this.setStatusBarText('Gitee: 推送中...');
          const result = await this.syncEngine.pushAll();
          const parts: string[] = [];
          if (result.uploaded > 0) parts.push(`上传 ${result.uploaded} 个文件`);
          if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length} 个文件`);
          if (result.deleted > 0) parts.push(`删除 ${result.deleted} 个远程文件`);
          new Notice(`推送完成: ${parts.join(', ') || '无变更'}`);
          this.setStatusBarText(`Gitee: ${new Date().toLocaleTimeString()}`);
          await this.historyManager.addRecord({
            timestamp: Date.now(), type: 'push',
            uploaded: result.uploaded, downloaded: 0, deleted: result.deleted,
            errors: result.errors,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          new Notice(`推送失败: ${msg}`);
          this.setStatusBarText('Gitee: 失败');
        }
      },
    });

    this.addCommand({
      id: 'gitee-pull',
      name: '从 Gitee 拉取所有文件',
      callback: async () => {
        try {
          this.setStatusBarText('Gitee: 拉取中...');
          const result = await this.syncEngine.pullAll();
          const parts: string[] = [];
          if (result.downloaded > 0) parts.push(`下载 ${result.downloaded} 个文件`);
          if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length} 个文件`);
          if (result.errors.length > 0) parts.push(`错误 ${result.errors.length} 个`);
          new Notice(`拉取完成: ${parts.join(', ') || '无变更'}`);
          this.setStatusBarText(`Gitee: ${new Date().toLocaleTimeString()}`);
          await this.historyManager.addRecord({
            timestamp: Date.now(), type: 'pull',
            uploaded: 0, downloaded: result.downloaded, deleted: 0,
            errors: result.errors,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          new Notice(`拉取失败: ${msg}`);
          this.setStatusBarText('Gitee: 失败');
        }
      },
    });

    this.addRibbonIcon('cloud-upload', 'Gitee 同步', (evt: MouseEvent) => {
      const menu = new Menu();
      menu.addItem(item => item
        .setTitle('推送全部文件')
        .setIcon('upload')
        .onClick(async () => {
          try {
            this.setStatusBarText('Gitee: 推送中...');
            const result = await this.syncEngine.pushAll();
            const parts: string[] = [];
            if (result.uploaded > 0) parts.push(`上传 ${result.uploaded} 个文件`);
            if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length} 个文件`);
            if (result.deleted > 0) parts.push(`删除 ${result.deleted} 个远程文件`);
            new Notice(`推送完成: ${parts.join(', ') || '无变更'}`);
            this.setStatusBarText(`Gitee: ${new Date().toLocaleTimeString()}`);
            await this.historyManager.addRecord({
              timestamp: Date.now(), type: 'push',
              uploaded: result.uploaded, downloaded: 0, deleted: result.deleted,
              errors: result.errors,
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            new Notice(`推送失败: ${msg}`);
            this.setStatusBarText('Gitee: 失败');
          }
        }));
      menu.addItem(item => item
        .setTitle('选择文件推送')
        .setIcon('list')
        .onClick(async () => {
          new PushSelectModal(this.app, this.syncEngine).open();
        }));
      menu.addSeparator();
      menu.addItem(item => item
        .setTitle('从 Gitee 拉取全部')
        .setIcon('download')
        .onClick(async () => {
          try {
            this.setStatusBarText('Gitee: 拉取中...');
            const result = await this.syncEngine.pullAll();
            const parts: string[] = [];
            if (result.downloaded > 0) parts.push(`下载 ${result.downloaded} 个文件`);
            if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length} 个文件`);
            if (result.errors.length > 0) parts.push(`错误 ${result.errors.length} 个`);
            new Notice(`拉取完成: ${parts.join(', ') || '无变更'}`);
            this.setStatusBarText(`Gitee: ${new Date().toLocaleTimeString()}`);
            await this.historyManager.addRecord({
              timestamp: Date.now(), type: 'pull',
              uploaded: 0, downloaded: result.downloaded, deleted: 0,
              errors: result.errors,
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            new Notice(`拉取失败: ${msg}`);
            this.setStatusBarText('Gitee: 失败');
          }
        }));
      menu.showAtMouseEvent(evt);
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile)) return;
        menu.addItem(item => {
          item.setTitle('推送至 Gitee')
            .setIcon('upload')
            .onClick(async () => {
              try {
                await this.syncEngine.pushFile(file.path);
                new Notice(`推送成功: ${file.path}`);
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                new Notice(`推送失败: ${msg}`);
              }
            });
        });
        menu.addItem(item => {
          item.setTitle('从 Gitee 拉取')
            .setIcon('download')
            .onClick(async () => {
              try {
                await this.syncEngine.pullFile(file.path);
                new Notice(`拉取成功: ${file.path}`);
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                new Notice(`拉取失败: ${msg}`);
              }
            });
        });
      }),
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        this.syncEngine.onFileRenamed(oldPath, file.path).catch(() => {});
      }),
    );

    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!(file instanceof TFile) || !this.settings.autoPush) return;
        const existing = this.autoPushTimers.get(file.path);
        if (existing) window.clearTimeout(existing);
        const timer = window.setTimeout(() => {
          this.autoPushTimers.delete(file.path);
          this.syncEngine.pushFile(file.path).catch(() => {});
        }, 2000);
        this.autoPushTimers.set(file.path, timer);
      }),
    );

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!file) {
          this.statusBarItem.setText('Gitee: 就绪');
          return;
        }
        const state = this.stateManager.getFileState(file.path);
        if (!state) {
          this.statusBarItem.setText('Gitee: 未跟踪');
        } else {
          this.statusBarItem.setText(`Gitee: ✅ ${new Date(state.lastSync).toLocaleTimeString()}`);
        }
      }),
    );

    this.registerDomEvent(window, 'pagehide', () => {
      void this.stateManager.save(this.stateManager.getState());
    });

    this.setupIntervalSync();

    if (this.settings.autoPullOnStart && this.settings.owner && this.settings.repo && this.settings.token) {
      void this.syncEngine.pullAll();
    }

    if (this.settings.mcpServerEnabled) {
      void this.mcpServer.start();
    }

    this.addSettingTab(
      new GiteeSyncSettingTab(
        this.app,
        this,
        this.settings,
        this.saveSettings.bind(this),
        this.stateManager,
        this.historyManager,
        this.mcpServer,
      ),
    );

    if (this.settings.autoCheckUpdate) {
      void this.checkForUpdate();
    }
  }

  onunload() {
    for (const timer of this.autoPushTimers.values()) {
      window.clearTimeout(timer);
    }
    this.autoPushTimers.clear();
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    this.mcpServer.stop();
  }

  private setupIntervalSync() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    if (this.settings.syncIntervalMin > 0) {
      this.syncIntervalId = window.setInterval(() => {
        this.setStatusBarText('Gitee: 定时同步中...');
        this.syncEngine.pushAll().then(result => {
          this.setStatusBarText(`Gitee: ${new Date().toLocaleTimeString()}`);
          this.historyManager.addRecord({
            timestamp: Date.now(), type: 'auto_push',
            uploaded: result.uploaded, downloaded: 0, deleted: result.deleted,
            errors: result.errors,
          }).catch(() => {});
        }).catch(() => {
          this.setStatusBarText('Gitee: 定时同步失败');
        });
      }, this.settings.syncIntervalMin * 60 * 1000);
    }
  }

  private setStatusBarText(text: string) {
    this.statusBarItem.setText(text);
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<GiteeSyncSettings>,
    );
  }

  async saveSettings() {
    this.giteeClient = new GiteeClient(
      this.settings.owner,
      this.settings.repo,
      this.settings.token,
      this.settings.branch,
    );
    this.syncEngine = new SyncEngine(
      this,
      this.settings,
      this.giteeClient,
      this.stateManager,
      this.app.vault,
      this.passwordManager,
    );
    this.setupIntervalSync();
    await this.saveData(this.settings);
  }

  async checkForUpdate(): Promise<void> {
    const now = Date.now();
    if (now - this.settings.lastUpdateCheck < 86400000) return;
    this.settings.lastUpdateCheck = now;
    await this.saveData(this.settings);

    try {
      const resp = await requestUrl({
        url: 'https://api.github.com/repos/Weixi138/obsidian-gitee/releases/latest',
        method: 'GET',
      });
      const latest = (resp.json.tag_name as string).replace(/^v/, '');
      const current = this.manifest.version;
      if (latest === current) return;
      openChangelogModal(this.app, `发现新版本 v${latest}\n\n当前版本 v${current}\n\n---\n\n${resp.json.body || '无更新日志'}`);
    } catch {
      // 静默忽略检查失败
    }
  }
}

class PushSelectModal extends Modal {
  private syncEngine: SyncEngine;
  private selected: Set<string> = new Set();
  private searchInput!: HTMLInputElement;
  private listEl!: HTMLElement;

  constructor(app: App, syncEngine: SyncEngine) {
    super(app);
    this.syncEngine = syncEngine;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('gitee-sync-select-modal');
    contentEl.createEl('h2', { text: '选择要推送的文件' });

    this.searchInput = contentEl.createEl('input', {
      type: 'text',
      placeholder: '搜索文件...',
    });
    this.searchInput.addClass('gitee-sync-select-modal');
    this.searchInput.addEventListener('input', () => this.renderList());

    this.listEl = contentEl.createEl('div');
    this.listEl.addClass('file-list');

    const btnRow = contentEl.createEl('div', { cls: 'modal-button-container' });

    const selectAllBtn = btnRow.createEl('button', { text: '全选' });
    selectAllBtn.addEventListener('click', () => {
      const files = this.app.vault.getFiles();
      files.forEach(f => this.selected.add(f.path));
      this.renderList();
    });

    const deselectAllBtn = btnRow.createEl('button', { text: '取消全选' });
    deselectAllBtn.addEventListener('click', () => {
      this.selected.clear();
      this.renderList();
    });

    const pushBtn = btnRow.createEl('button', { text: '推送选中', cls: 'mod-cta' });
    pushBtn.addEventListener('click', () => {
      void (async () => {
        if (this.selected.size === 0) {
          new Notice('请先选择文件');
          return;
        }
        this.close();
        new Notice(`开始推送 ${this.selected.size} 个文件...`);
        for (const path of this.selected) {
          try {
            await this.syncEngine.pushFile(path);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            new Notice(`推送失败: ${path} - ${msg}`);
          }
        }
        new Notice(`推送完成: ${this.selected.size} 个文件`);
      })();
    });

    this.renderList();
  }

  onClose() {
    this.contentEl.empty();
  }

  private renderList() {
    this.listEl.empty();
    const query = this.searchInput.value.toLowerCase();
    const files = this.app.vault.getFiles().filter(f => {
      if (!query) return true;
      return f.path.toLowerCase().includes(query);
    });
    for (const file of files) {
      const item = this.listEl.createEl('div', { cls: 'checkbox-item' });

      const cb = item.createEl('input', { type: 'checkbox' });
      cb.checked = this.selected.has(file.path);
      cb.addEventListener('change', () => {
        if (cb.checked) this.selected.add(file.path);
        else this.selected.delete(file.path);
      });

      const label = item.createEl('span', { text: file.path });

      item.addEventListener('click', (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        if (cb.checked) this.selected.add(file.path);
        else this.selected.delete(file.path);
      });
    }
  }
}
import { App, Menu, Modal, Notice, Plugin, TFile } from 'obsidian';
import { GiteeSyncSettings, DEFAULT_SETTINGS } from './types';
import { GiteeSyncSettingTab } from './settings';
import { GiteeClient } from './gitee/client';
import { SyncStateManager } from './sync/state';
import { PasswordManager } from './password-manager';
import { SyncEngine } from './sync/engine';

export default class GiteeEncryptedSyncPlugin extends Plugin {
  settings!: GiteeSyncSettings;
  stateManager!: SyncStateManager;
  giteeClient!: GiteeClient;
  syncEngine!: SyncEngine;
  passwordManager!: PasswordManager;

  async onload() {
    await this.loadSettings();

    this.passwordManager = new PasswordManager(this.settings);
    this.stateManager = new SyncStateManager(this);
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

    this.addCommand({
      id: 'gitee-push',
      name: '推送所有文件至 Gitee',
      callback: async () => {
        try {
          const result = await this.syncEngine.pushAll();
          const parts: string[] = [];
          if (result.uploaded > 0) parts.push(`上传 ${result.uploaded} 个文件`);
          if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length} 个文件`);
          new Notice(`推送完成: ${parts.join(', ') || '无变更'}`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          new Notice(`推送失败: ${msg}`);
        }
      },
    });

    this.addRibbonIcon('cloud-upload', 'Gitee 推送', (evt: MouseEvent) => {
      const menu = new Menu();
      menu.addItem(item => item
        .setTitle('推送全部文件')
        .setIcon('upload')
        .onClick(async () => {
          try {
            const result = await this.syncEngine.pushAll();
            const parts: string[] = [];
            if (result.uploaded > 0) parts.push(`上传 ${result.uploaded} 个文件`);
            if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length} 个文件`);
            new Notice(`推送完成: ${parts.join(', ') || '无变更'}`);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            new Notice(`推送失败: ${msg}`);
          }
        }));
      menu.addItem(item => item
        .setTitle('选择文件推送')
        .setIcon('list')
        .onClick(async () => {
          new PushSelectModal(this.app, this.syncEngine).open();
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
      }),
    );

    this.addSettingTab(
      new GiteeSyncSettingTab(
        this.app,
        this,
        this.settings,
        this.saveSettings.bind(this),
        this.stateManager,
      ),
    );
  }

  onunload() {
    // nothing to clean up
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
    await this.saveData(this.settings);
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
    this.searchInput.style.cssText = 'width: 100%; margin-bottom: 10px;';
    this.searchInput.addEventListener('input', () => this.renderList());

    this.listEl = contentEl.createEl('div');
    this.listEl.style.cssText = 'max-height: 400px; overflow-y: auto;';

    const btnRow = contentEl.createEl('div', { cls: 'modal-button-container' });
    btnRow.style.cssText = 'margin-top: 10px; display: flex; gap: 8px;';

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
      item.style.cssText = 'display: flex; align-items: center; padding: 4px 0; cursor: pointer;';

      const cb = item.createEl('input', { type: 'checkbox' });
      cb.checked = this.selected.has(file.path);
      cb.addEventListener('change', () => {
        if (cb.checked) this.selected.add(file.path);
        else this.selected.delete(file.path);
      });

      const label = item.createEl('span', { text: file.path });
      label.style.cssText = 'margin-left: 8px; font-size: 0.9em;';

      item.addEventListener('click', (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        if (cb.checked) this.selected.add(file.path);
        else this.selected.delete(file.path);
      });
    }
  }
}
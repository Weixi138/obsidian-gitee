import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { GiteeSyncSettings } from './types';
import { GiteeClient } from './gitee/client';
import { SyncStateManager } from './sync/state';

export class GiteeSyncSettingTab extends PluginSettingTab {
  private settings: GiteeSyncSettings;
  private saveSettings: () => Promise<void>;
  private stateManager: SyncStateManager;
  private pluginVersion: string;

  constructor(
    app: App,
    plugin: Plugin,
    settings: GiteeSyncSettings,
    saveSettings: () => Promise<void>,
    stateManager: SyncStateManager,
  ) {
    super(app, plugin);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.stateManager = stateManager;
    this.pluginVersion = plugin.manifest.version;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Gitee 用户名')
      .setDesc('仓库所有者的用户名')
      .addText(text =>
        text
          .setPlaceholder('your-username')
          .setValue(this.settings.owner)
          .onChange(async value => {
            this.settings.owner = value;
            await this.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('仓库名称')
      .setDesc('Gitee 仓库名称')
      .addText(text =>
        text
          .setPlaceholder('your-repo')
          .setValue(this.settings.repo)
          .onChange(async value => {
            this.settings.repo = value;
            await this.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('访问令牌')
      .setDesc('Gitee 个人访问令牌')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('输入令牌')
          .setValue(this.settings.token)
          .onChange(async value => {
            this.settings.token = value;
            await this.saveSettings();
          });
      });

    const passwordSetting = new Setting(containerEl)
      .setName('加密密码')
      .setDesc('用于端到端加密，请妥善保管')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('输入加密密码')
          .setValue(this.settings.password)
          .onChange(async value => {
            this.settings.password = value;
            await this.saveSettings();
          });
      });
    const hint = passwordSetting.descEl.createEl('div');
    hint.setText('更改密码后需要重新加密所有文件');
    hint.style.cssText = 'color: var(--text-muted); font-size: 0.85em; margin-top: 4px;';

    new Setting(containerEl)
      .setName('分支')
      .setDesc('推送的目标分支')
      .addText(text =>
        text
          .setPlaceholder('main')
          .setValue(this.settings.branch)
          .onChange(async value => {
            this.settings.branch = value || 'main';
            await this.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('忽略模式')
      .setDesc('逗号分隔的路径前缀，匹配的文件不会推送')
      .addText(text =>
        text
          .setPlaceholder('.obsidian, .git')
          .setValue(this.settings.ignorePatterns.join(', '))
          .onChange(async value => {
            this.settings.ignorePatterns = value
              .split(',')
              .map(s => s.trim())
              .filter(Boolean);
            await this.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('最大文件大小 (MB)')
      .setDesc('超过此大小的文件将被跳过')
      .addText(text =>
        text
          .setPlaceholder('50')
          .setValue(String(this.settings.maxFileSizeMB))
          .onChange(async value => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              this.settings.maxFileSizeMB = num;
              await this.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName('测试连接')
      .setDesc('验证 Gitee 令牌是否有效')
      .addButton(button =>
        button.setButtonText('测试').onClick(async () => {
          if (!this.settings.owner || !this.settings.repo || !this.settings.token) {
            new Notice('请先填写用户名、仓库和令牌');
            return;
          }
          try {
            const client = new GiteeClient(
              this.settings.owner,
              this.settings.repo,
              this.settings.token,
              this.settings.branch,
            );
            await client.getBranchCommitSha();
            new Notice('连接成功');
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            new Notice(`连接失败: ${msg}`);
          }
        }),
      );

    new Setting(containerEl)
      .setName('清除同步状态')
      .setDesc('删除本地同步状态文件，不会影响远程文件')
      .addButton(button =>
        button
          .setButtonText('清除')
          .setWarning()
          .onClick(async () => {
            const confirmed = confirm('确定要清除同步状态吗？这将导致下次推送时重新上传所有文件。');
            if (!confirmed) return;
            try {
              await this.stateManager.save({
                stateVersion: 1,
                files: {},
                lastSyncTime: 0,
                passwordHash: '',
              });
              new Notice('同步状态已清除');
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              new Notice(`清除失败: ${msg}`);
            }
          }),
      );

    containerEl.createEl('div', {
      text: `版本 ${this.pluginVersion}`,
    }).style.cssText = 'text-align: center; color: var(--text-muted); font-size: 0.85em; margin-top: 24px;';
  }
}
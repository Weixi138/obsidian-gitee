import { App, Platform, Plugin, PluginSettingTab, Setting, Notice, requestUrl } from 'obsidian';
import { GiteeSyncSettings } from './types';
import { GiteeClient } from './gitee/client';
import { SyncStateManager } from './sync/state';
import { SyncHistoryManager } from './sync/history';
import { McpServer } from './sync/mcp-server';
import { openHistoryModal, openChangelogModal } from './ui/history-view';
import { runDiagnostics } from './utils/diagnostics';

export class GiteeSyncSettingTab extends PluginSettingTab {
  private settings: GiteeSyncSettings;
  private saveSettings: () => Promise<void>;
  private stateManager: SyncStateManager;
  private historyManager: SyncHistoryManager;
  private mcpServer: McpServer;
  private pluginVersion: string;

  constructor(
    app: App,
    plugin: Plugin,
    settings: GiteeSyncSettings,
    saveSettings: () => Promise<void>,
    stateManager: SyncStateManager,
    historyManager: SyncHistoryManager,
    mcpServer: McpServer,
  ) {
    super(app, plugin);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.stateManager = stateManager;
    this.historyManager = historyManager;
    this.mcpServer = mcpServer;
    this.pluginVersion = plugin.manifest.version;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const isMobile = Platform.isMobile;

    this.addGroup(containerEl, '🔑 认证配置', () => {
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

      new Setting(containerEl)
        .setName('分支')
        .setDesc('推送的目标分支')
        .addText(text =>
          text
            .setPlaceholder('master')
            .setValue(this.settings.branch)
            .onChange(async value => {
              this.settings.branch = value || 'master';
              await this.saveSettings();
            }),
        );
    });

    this.addGroup(containerEl, '🔒 安全加密', () => {
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
      hint.addClass('gitee-settings-hint');

      new Setting(containerEl)
        .setName('密码提示')
        .setDesc('帮助记忆加密密码的提示信息')
        .addText(text =>
          text
            .setPlaceholder('输入密码提示')
            .setValue(this.settings.passwordHint || '')
            .onChange(async value => {
              this.settings.passwordHint = value;
              await this.saveSettings();
            }),
        );

      if (!isMobile) {
        new Setting(containerEl)
          .setName('文件夹加密密码')
          .setDesc('JSON 格式: {"文件夹名": "密码"}，优先级高于全局密码')
          .addTextArea(text =>
            text
              .setPlaceholder('{"日记": "diary123", "工作": "work456"}')
              .setValue(JSON.stringify(this.settings.folderPasswords, null, 2))
              .onChange(async value => {
                try {
                  const parsed = JSON.parse(value || '{}');
                  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
                    this.settings.folderPasswords = parsed;
                    await this.saveSettings();
                  }
                } catch {
                  // invalid JSON, ignore
                }
              }),
          );
      }
    });

    if (!isMobile) {
      this.addGroup(containerEl, '⚡ 同步策略', () => {
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
          .setName('同步文件夹')
          .setDesc('逗号分隔的文件夹路径，留空则同步所有文件')
          .addText(text =>
            text
              .setPlaceholder('日记, 工作')
              .setValue(this.settings.syncFolders.join(', '))
              .onChange(async value => {
                this.settings.syncFolders = value
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
          .setName('保存后自动推送')
          .setDesc('文件保存后自动加密推送到 Gitee（2 秒防抖）')
          .addToggle(toggle =>
            toggle
              .setValue(this.settings.autoPush)
              .onChange(async value => {
                this.settings.autoPush = value;
                await this.saveSettings();
              }),
          );

        new Setting(containerEl)
          .setName('启动时自动拉取')
          .setDesc('Obsidian 启动时自动从 Gitee 拉取最新文件')
          .addToggle(toggle =>
            toggle
              .setValue(this.settings.autoPullOnStart)
              .onChange(async value => {
                this.settings.autoPullOnStart = value;
                await this.saveSettings();
              }),
          );

        new Setting(containerEl)
          .setName('定时同步间隔（分钟）')
          .setDesc('0 表示不启用定时同步')
          .addText(text =>
            text
              .setPlaceholder('0')
              .setValue(String(this.settings.syncIntervalMin))
              .onChange(async value => {
                const num = parseInt(value, 10);
                if (!isNaN(num) && num >= 0) {
                  this.settings.syncIntervalMin = num;
                  await this.saveSettings();
                }
              }),
          );
      });

      this.addGroup(containerEl, '🔧 运维工具', () => {
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
          .setName('同步历史')
          .setDesc('查看最近的同步操作记录')
          .addButton(button =>
            button.setButtonText('查看历史').onClick(async () => {
              const records = this.historyManager.getRecords(50);
              let md = '';
              for (const r of records) {
                md += `- ${new Date(r.timestamp).toLocaleString()} [${r.type}] 上传:${r.uploaded} 下载:${r.downloaded} 删除:${r.deleted}`;
                if (r.errors.length > 0) md += ` 错误:${r.errors.join('; ')}`;
                md += '\n';
              }
              openHistoryModal(this.app, md || '暂无记录');
            }),
          );

        new Setting(containerEl)
          .setName('统计信息')
          .setDesc('同步统计概览')
          .addButton(button =>
            button.setButtonText('查看统计').onClick(() => {
              const stats = this.historyManager.getStats();
              const md = [
                `推送次数: ${stats.totalPushes}`,
                `拉取次数: ${stats.totalPulls}`,
                `总上传文件: ${stats.totalUploaded}`,
                `总下载文件: ${stats.totalDownloaded}`,
                `总删除文件: ${stats.totalDeleted}`,
                `总错误数: ${stats.totalErrors}`,
                `状态文件数: ${Object.keys(this.stateManager.getState().files).length}`,
              ].join('\n');
              openHistoryModal(this.app, md);
            }),
          );

        new Setting(containerEl)
          .setName('导出日志')
          .setDesc('将同步历史导出为 Markdown 文件')
          .addButton(button =>
            button.setButtonText('导出').onClick(async () => {
              try {
                const md = await this.historyManager.exportLog();
                const path = `gitee-sync-log-${Date.now()}.md`;
                await this.app.vault.create(path, md);
                new Notice(`日志已导出: ${path}`);
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                new Notice(`导出失败: ${msg}`);
              }
            }),
          );

        new Setting(containerEl)
          .setName('网络诊断')
          .setDesc('测试 Gitee 连通性、API 延迟和令牌有效性')
          .addButton(button =>
            button.setButtonText('运行诊断').onClick(async () => {
              if (!this.settings.owner || !this.settings.repo || !this.settings.token) {
                new Notice('请先填写用户名、仓库和令牌');
                return;
              }
              const client = new GiteeClient(
                this.settings.owner,
                this.settings.repo,
                this.settings.token,
                this.settings.branch,
              );
              const result = await runDiagnostics(client);
              const md = [
                `## 诊断结果\n`,
                `**DNS**: ${result.dns.status === 'ok' ? '✅' : '❌'} ${result.dns.detail}`,
                `**API**: ${result.api.status === 'ok' ? '✅' : '❌'} ${result.api.detail}${result.api.latencyMs ? ` (${result.api.latencyMs}ms)` : ''}`,
                `**认证**: ${result.auth.status === 'ok' ? '✅' : '❌'} ${result.auth.detail}`,
              ].join('\n');
              openHistoryModal(this.app, md);
            }),
          );

        new Setting(containerEl)
          .setName('健康检查')
          .setDesc('验证远程文件完整性和密码匹配')
          .addButton(button =>
            button.setButtonText('检查').onClick(async () => {
              try {
                const state = this.stateManager.getState();
                const fileCount = Object.keys(state.files).length;
                if (!state.passwordHash) {
                  openHistoryModal(this.app, '健康检查: 尚未进行过同步，无法检查');
                  return;
                }
                openHistoryModal(this.app, `健康检查结果:\n\n- 状态文件数: ${fileCount}\n- 密码哈希: ${state.passwordHash.substring(0, 8)}...\n- 上次同步: ${state.lastSyncTime ? new Date(state.lastSyncTime).toLocaleString() : '从未'}\n- 密码提示: ${this.settings.passwordHint || '未设置'}`);
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                new Notice(`健康检查失败: ${msg}`);
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

        new Setting(containerEl)
          .setName('MCP 服务器')
          .setDesc('启动本地 MCP 服务器供 AI 客户端连接（仅桌面端，端口 3100）')
          .addToggle(toggle =>
            toggle
              .setValue(this.settings.mcpServerEnabled)
              .onChange(async value => {
                this.settings.mcpServerEnabled = value;
                await this.saveSettings();
                if (value) {
                  this.mcpServer.start();
                } else {
                  this.mcpServer.stop();
                }
              }),
          );

        new Setting(containerEl)
          .setName('自动检查更新')
          .setDesc('启动时自动检查 GitHub 是否有新版本')
          .addToggle(toggle =>
            toggle
              .setValue(this.settings.autoCheckUpdate)
              .onChange(async value => {
                this.settings.autoCheckUpdate = value;
                await this.saveSettings();
              }),
          );

        new Setting(containerEl)
          .setName('检查更新')
          .setDesc('手动检查 GitHub 是否有新版本')
          .addButton(button =>
            button.setButtonText('检查').onClick(async () => {
              new Notice('正在检查更新...');
              try {
                const resp = await requestUrl({
                  url: 'https://api.github.com/repos/Weixi138/obsidian-gitee/releases/latest',
                  method: 'GET',
                });
                const latest = (resp.json.tag_name as string).replace(/^v/, '');
                const current = this.pluginVersion;
                if (latest === current) {
                  new Notice('已是最新版本');
                  return;
                }
                openChangelogModal(this.app, `发现新版本 v${latest}\n\n当前版本 v${current}\n\n---\n\n${resp.json.body || '无更新日志'}`);
              } catch {
                new Notice('检查更新失败，请检查网络连接');
              }
            }),
          );
      });
    }

    containerEl.createEl('div', {
      text: `版本 ${this.pluginVersion}`,
      cls: 'gitee-settings-version',
    });
  }

  private addGroup(containerEl: HTMLElement, title: string, fn: () => void) {
    const group = containerEl.createEl('div', { cls: 'gitee-settings-group' });
    group.createEl('div', { text: title, cls: 'gitee-settings-group-title' });
    fn();
  }
}
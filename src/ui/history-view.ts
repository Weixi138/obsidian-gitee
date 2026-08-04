import { App, Modal, Notice, requestUrl } from 'obsidian';

export function openHistoryModal(app: App, markdown: string): void {
  new class extends Modal {
    onOpen() {
      const { contentEl } = this;
      contentEl.addClass('gitee-history-modal');
      contentEl.createEl('h2', { text: '同步历史' });
      const pre = contentEl.createEl('pre');
      pre.addClass('gitee-history-modal');
      pre.setText(markdown);
    }
    onClose() {
      this.contentEl.empty();
    }
  }(app).open();
}

export function openChangelogModal(app: App, markdown: string, version?: string): void {
  new class extends Modal {
    onOpen() {
      const { contentEl } = this;
      contentEl.addClass('gitee-history-modal');
      contentEl.createEl('h2', { text: '发现新版本' });
      const pre = contentEl.createEl('pre');
      pre.addClass('gitee-history-modal');
      pre.setText(markdown);

      const btnRow = contentEl.createEl('div');
      btnRow.addClass('modal-button-container');
      btnRow.style.cssText = 'margin-top: 16px; display: flex; gap: 12px; justify-content: center;';

      const updateBtn = btnRow.createEl('button', { text: '立即更新', cls: 'mod-cta' });
      updateBtn.style.cssText = 'min-height: 44px; padding: 8px 24px; font-size: 1em;';
      updateBtn.addEventListener('click', () => {
        const url = version
          ? `https://github.com/Weixi138/obsidian-gitee/releases/tag/v${version}`
          : 'https://github.com/Weixi138/obsidian-gitee/releases/latest';
        open(url);
        this.close();
      });

      const laterBtn = btnRow.createEl('button', { text: '暂不更新' });
      laterBtn.style.cssText = 'min-height: 44px; padding: 8px 24px;';
      laterBtn.addEventListener('click', () => this.close());
    }
    onClose() {
      this.contentEl.empty();
    }
  }(app).open();
}
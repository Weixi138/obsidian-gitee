import { App, Modal } from 'obsidian';

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
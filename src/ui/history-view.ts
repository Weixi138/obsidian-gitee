import { App, Modal, Notice } from 'obsidian';

export function openHistoryModal(app: App, markdown: string): void {
  new class extends Modal {
    onOpen() {
      const { contentEl } = this;
      contentEl.addClass('gitee-history-modal');
      contentEl.createEl('h2', { text: '同步历史' });
      const pre = contentEl.createEl('pre');
      pre.style.cssText = 'max-height: 500px; overflow-y: auto; font-size: 0.85em; white-space: pre-wrap;';
      pre.setText(markdown);
    }
    onClose() {
      this.contentEl.empty();
    }
  }(app).open();
}
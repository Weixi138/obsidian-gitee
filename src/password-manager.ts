import { Notice } from 'obsidian';
import { GiteeSyncSettings } from './types';
import { computeSHA256, decrypt } from './crypto';

export class PasswordManager {
  private settings: GiteeSyncSettings;

  constructor(settings: GiteeSyncSettings) {
    this.settings = settings;
  }

  async getPassword(): Promise<string> {
    const password = this.settings.password;
    if (!password) {
      new Notice('同步密码未设置，请在设置中填写密码');
      throw new Error('密码未设置');
    }
    return password;
  }

  async getPasswordHash(password: string): Promise<string> {
    return computeSHA256(password);
  }

  async validatePassword(encryptedSample: string): Promise<boolean> {
    try {
      await decrypt(encryptedSample, this.settings.password);
      return true;
    } catch {
      return false;
    }
  }
}
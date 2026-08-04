import { Plugin } from 'obsidian';
import { SyncState, SyncFileState } from '../types';
import { getConfigDir } from '../types';

const EMPTY_STATE: SyncState = {
  stateVersion: 1,
  files: {},
  lastSyncTime: 0,
  passwordHash: '',
};

export class SyncStateManager {
  private plugin: Plugin;
  private state: SyncState;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.state = { ...EMPTY_STATE, files: {} };
  }

  private getStatePath(): string {
    const configDir = getConfigDir(this.plugin.app.vault);
    return `${configDir}/plugins/sync-gitee/data/sync-state.json`;
  }

  async load(): Promise<SyncState> {
    try {
      const path = this.getStatePath();
      const exists = await this.plugin.app.vault.adapter.exists(path);
      if (!exists) {
        this.state = { ...EMPTY_STATE, files: {} };
        return this.state;
      }
      const raw = await this.plugin.app.vault.adapter.read(path);
      this.state = JSON.parse(raw) as SyncState;
      return this.state;
    } catch {
      this.state = { ...EMPTY_STATE, files: {} };
      return this.state;
    }
  }

  async save(state: SyncState): Promise<void> {
    this.state = state;
    const path = this.getStatePath();
    const dir = path.substring(0, path.lastIndexOf('/'));
    try {
      const dirExists = await this.plugin.app.vault.adapter.exists(dir);
      if (!dirExists) {
        await this.plugin.app.vault.adapter.mkdir(dir);
      }
    } catch {
      // ignore
    }
    await this.plugin.app.vault.adapter.write(path, JSON.stringify(state, null, 2));
  }

  getFileState(localPath: string): SyncFileState | null {
    return this.state.files[localPath] ?? null;
  }

  getState(): SyncState {
    return this.state;
  }

  getFileStateByRemotePath(remotePath: string): SyncFileState | null {
    return Object.values(this.state.files).find(f => f.remotePath === remotePath) ?? null;
  }

  async updateFileState(fileState: SyncFileState): Promise<void> {
    this.state.files[fileState.localPath] = fileState;
    await this.save(this.state);
  }

  async removeFileState(localPath: string): Promise<void> {
    delete this.state.files[localPath];
    await this.save(this.state);
  }

  async batchUpdate(files: SyncFileState[]): Promise<void> {
    for (const f of files) {
      this.state.files[f.localPath] = f;
    }
    this.state.lastSyncTime = Date.now();
    await this.save(this.state);
  }

  getPasswordHash(): string {
    return this.state.passwordHash;
  }

  async updatePasswordHash(hash: string): Promise<void> {
    this.state.passwordHash = hash;
    await this.save(this.state);
  }
}
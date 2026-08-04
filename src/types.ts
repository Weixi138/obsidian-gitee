import { Vault } from 'obsidian';

export interface GiteeSyncSettings {
  owner: string;
  repo: string;
  token: string;
  password: string;
  branch: string;
  ignorePatterns: string[];
  maxFileSizeMB: number;
}

export const DEFAULT_SETTINGS: GiteeSyncSettings = {
  owner: '',
  repo: '',
  token: '',
  password: '',
  branch: 'master',
  ignorePatterns: ['.obsidian', '.git'],
  maxFileSizeMB: 50,
};

export interface SyncFileState {
  localPath: string;
  remotePath: string;
  localHash: string;
  remoteSha: string;
  lastSync: number;
}

export interface SyncState {
  stateVersion: number;
  files: Record<string, SyncFileState>;
  lastSyncTime: number;
  passwordHash: string;
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  errors: string[];
  skipped: { path: string; reason: string }[];
}

export function getConfigDir(vault: Vault): string {
  return vault.configDir;
}
import { Vault } from 'obsidian';

export interface GiteeSyncSettings {
  owner: string;
  repo: string;
  token: string;
  password: string;
  passwordHint: string;
  folderPasswords: Record<string, string>;
  branch: string;
  ignorePatterns: string[];
  syncFolders: string[];
  maxFileSizeMB: number;
  autoPush: boolean;
  autoPullOnStart: boolean;
  syncIntervalMin: number;
  mcpServerEnabled: boolean;
}

export const DEFAULT_SETTINGS: GiteeSyncSettings = {
  owner: '',
  repo: '',
  token: '',
  password: '',
  passwordHint: '',
  folderPasswords: {},
  branch: 'master',
  ignorePatterns: ['.obsidian', '.git'],
  syncFolders: [],
  maxFileSizeMB: 50,
  autoPush: false,
  autoPullOnStart: false,
  syncIntervalMin: 0,
  mcpServerEnabled: false,
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
  deleted: number;
  errors: string[];
  skipped: { path: string; reason: string }[];
}

export function getConfigDir(vault: Vault): string {
  return vault.configDir;
}
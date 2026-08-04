import { Plugin, TFile, Vault, Notice } from 'obsidian';
import { GiteeSyncSettings, SyncFileState, SyncResult } from '../types';
import { encrypt, encryptBinary, computeSHA256 } from '../crypto';
import { getRemotePath, isEncryptedFile, isIgnored } from '../utils/path';
import { readTextFile, readBinaryAsUint8Array, isBinaryFile, getFileSize } from '../utils/file-utils';
import { GiteeClient } from '../gitee/client';
import { SyncStateManager } from './state';
import { PasswordManager } from '../password-manager';

export class SyncEngine {
  private plugin: Plugin;
  private settings: GiteeSyncSettings;
  private gitee: GiteeClient;
  private stateManager: SyncStateManager;
  private vault: Vault;
  private passwordManager: PasswordManager;
  private remoteTree: Map<string, { sha: string; type: 'blob' | 'tree' }> | null = null;

  constructor(
    plugin: Plugin,
    settings: GiteeSyncSettings,
    giteeClient: GiteeClient,
    stateManager: SyncStateManager,
    vault: Vault,
    passwordManager: PasswordManager,
  ) {
    this.plugin = plugin;
    this.settings = settings;
    this.gitee = giteeClient;
    this.stateManager = stateManager;
    this.vault = vault;
    this.passwordManager = passwordManager;
  }

  async pushAll(): Promise<SyncResult> {
    const result: SyncResult = { uploaded: 0, errors: [], skipped: [] };

    try {
      if (!this.settings.owner || !this.settings.repo || !this.settings.token) {
        new Notice('请先在设置中填写 Gitee 信息');
        return { ...result, errors: ['设置不完整'] };
      }

      const password = await this.passwordManager.getPassword();

      const files = this.vault.getFiles();

      const localFiles = files.filter(f => {
        if (isIgnored(f.path, this.settings.ignorePatterns)) return false;
        const sizeMB = getFileSize(f) / (1024 * 1024);
        if (sizeMB > this.settings.maxFileSizeMB) {
          result.skipped.push({ path: f.path, reason: `超过大小限制 (${sizeMB.toFixed(1)}MB > ${this.settings.maxFileSizeMB}MB)` });
          return false;
        }
        return true;
      });

      const commitSha = await this.gitee.getBranchCommitSha();
      const treeSha = await this.gitee.getTreeSha(commitSha);
      const remoteTree = await this.gitee.getRecursiveTree(treeSha);
      this.remoteTree = remoteTree;

      const remoteFiles = new Map<string, { sha: string }>();
      for (const [path, info] of remoteTree) {
        if (isEncryptedFile(path) && info.type === 'blob' && path !== 'path-map.json.enc') {
          remoteFiles.set(path, { sha: info.sha });
        }
      }

      await this.stateManager.load();

      const currentHash = await this.passwordManager.getPasswordHash(password);
      const storedHash = this.stateManager.getPasswordHash();
      if (storedHash && currentHash !== storedHash) {
        new Notice('检测到密码变更，请先在设置中更新密码');
        result.errors.push('密码已变更');
        return result;
      }
      if (!storedHash) {
        await this.stateManager.updatePasswordHash(currentHash);
      }

      const pendingStates: SyncFileState[] = [];

      for (const file of localFiles) {
        try {
          const remotePath = await getRemotePath(file.path, password);
          const state = this.stateManager.getFileState(file.path);

          let localHash: string;
          if (isBinaryFile(file)) {
            const uint8Data = await readBinaryAsUint8Array(this.vault, file);
            localHash = await computeSHA256(Array.from(uint8Data).map(b => String.fromCharCode(b)).join(''));
          } else {
            const content = await readTextFile(this.vault, file);
            localHash = await computeSHA256(content);
          }

          if (state && state.localHash === localHash) {
            continue;
          }

          await this.uploadFile(file, remotePath, password);
          pendingStates.push({
            localPath: file.path,
            remotePath,
            localHash,
            lastSync: Date.now(),
          });
          result.uploaded++;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          result.errors.push(`${file.path}: ${msg}`);
        }
      }

      if (pendingStates.length > 0) {
        await this.stateManager.batchUpdate(pendingStates);
      }

      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`推送失败: ${msg}`);
      result.errors.push(msg);
      return result;
    }
  }

  async pushFile(filePath: string): Promise<string> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) throw new Error(`文件不存在: ${filePath}`);

    const password = await this.passwordManager.getPassword();
    const remotePath = await getRemotePath(filePath, password);

    let existingSha: string | undefined;
    if (this.remoteTree) {
      const remoteInfo = this.remoteTree.get(remotePath);
      if (remoteInfo) existingSha = remoteInfo.sha;
    }

    let localHash: string;
    if (isBinaryFile(file)) {
      const uint8Data = await readBinaryAsUint8Array(this.vault, file);
      const encrypted = await encryptBinary(uint8Data.buffer as ArrayBuffer, password);
      const base64Content = btoa(encrypted);
      const remoteSha = await this.gitee.createOrUpdateFile(remotePath, base64Content, `Push: ${remotePath}`, existingSha);
      localHash = await computeSHA256(Array.from(uint8Data).map(b => String.fromCharCode(b)).join(''));
      await this.stateManager.updateFileState({
        localPath: filePath,
        remotePath,
        localHash,
        lastSync: Date.now(),
      });
      await this.savePathMapEntry(remotePath, filePath);
      return remoteSha;
    } else {
      const content = await readTextFile(this.vault, file);
      const encrypted = await encrypt(content, password);
      const base64Content = btoa(encrypted);
      const remoteSha = await this.gitee.createOrUpdateFile(remotePath, base64Content, `Push: ${remotePath}`, existingSha);
      localHash = await computeSHA256(content);
      await this.stateManager.updateFileState({
        localPath: filePath,
        remotePath,
        localHash,
        lastSync: Date.now(),
      });
      await this.savePathMapEntry(remotePath, filePath);
      return remoteSha;
    }
  }

  private async uploadFile(file: TFile, remotePath: string, password: string): Promise<void> {
    let existingSha: string | undefined;
    if (this.remoteTree) {
      const remoteInfo = this.remoteTree.get(remotePath);
      if (remoteInfo) existingSha = remoteInfo.sha;
    }

    if (isBinaryFile(file)) {
      const uint8Data = await readBinaryAsUint8Array(this.vault, file);
      const encrypted = await encryptBinary(uint8Data.buffer as ArrayBuffer, password);
      const base64Content = btoa(encrypted);
      await this.gitee.createOrUpdateFile(remotePath, base64Content, `Sync: ${remotePath}`, existingSha);
    } else {
      const content = await readTextFile(this.vault, file);
      const encrypted = await encrypt(content, password);
      const base64Content = btoa(encrypted);
      await this.gitee.createOrUpdateFile(remotePath, base64Content, `Sync: ${remotePath}`, existingSha);
    }

    await this.savePathMapEntry(remotePath, file.path);
  }

  private async savePathMapEntry(remotePath: string, localPath: string): Promise<void> {
    const map = await this.loadPathMap();
    map[remotePath] = localPath;
    const json = JSON.stringify(map, null, 2);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const content = btoa(binary);
    try {
      await this.gitee.createOrUpdateFile('path-map.json.enc', content, 'Update path map');
    } catch {
      // ignore path map update errors
    }
  }

  private async loadPathMap(): Promise<Record<string, string>> {
    try {
      const data = await this.gitee.getFileContent('path-map.json.enc');
      if (data && data.content && data.content.trim()) {
        return JSON.parse(data.content) as Record<string, string>;
      }
    } catch {
      // ignore
    }
    return {};
  }
}
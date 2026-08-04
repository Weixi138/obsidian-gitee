import { Plugin, TFile, Vault, Notice } from 'obsidian';
import { GiteeSyncSettings, SyncFileState, SyncResult } from '../types';
import { encrypt, encryptBinary, decrypt, decryptBinary, computeSHA256, computeSHA256Buffer } from '../crypto';
import { getRemotePath, isEncryptedFile, isIgnored } from '../utils/path';
import { readTextFile, readBinaryAsUint8Array, isBinaryFile, getFileSize, writeTextFile, writeBinaryFile } from '../utils/file-utils';
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
  private pathMapCache: Record<string, string> | null = null;

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
    const result: SyncResult = { uploaded: 0, downloaded: 0, deleted: 0, errors: [], skipped: [] };

    try {
      if (!this.settings.owner || !this.settings.repo || !this.settings.token) {
        new Notice('请先在设置中填写 Gitee 信息');
        return { ...result, errors: ['设置不完整'] };
      }

      await this.passwordManager.getPassword();

      const files = this.vault.getFiles();

      const localFiles = files.filter(f => {
        if (isIgnored(f.path, this.settings.ignorePatterns)) return false;
        if (this.settings.syncFolders.length > 0) {
          const inFolder = this.settings.syncFolders.some(folder => f.path.startsWith(folder + '/') || f.path === folder);
          if (!inFolder) return false;
        }
        const sizeMB = getFileSize(f) / (1024 * 1024);
        if (sizeMB > this.settings.maxFileSizeMB) {
          result.skipped.push({ path: f.path, reason: `超过大小限制 (${sizeMB.toFixed(1)}MB > ${this.settings.maxFileSizeMB}MB)` });
          return false;
        }
        return true;
      });

      const localPaths = new Set(localFiles.map(f => f.path));

      const commitSha = await this.gitee.getBranchCommitSha();
      const treeSha = await this.gitee.getTreeSha(commitSha);
      const remoteTree = await this.gitee.getRecursiveTree(treeSha);
      this.remoteTree = remoteTree;

      await this.stateManager.load();

      this.pathMapCache = await this.loadPathMap();

      const currentHash = await this.passwordManager.getPasswordHash(
        await this.passwordManager.getPassword()
      );
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
      const pendingPathMap: Array<[string, string]> = [];

      for (const file of localFiles) {
        try {
          const filePassword = this.passwordManager.getPasswordForFile(file.path);
          const remotePath = await getRemotePath(file.path, filePassword);
          const state = this.stateManager.getFileState(file.path);

          let localHash: string;
          if (isBinaryFile(file)) {
            const uint8Data = await readBinaryAsUint8Array(this.vault, file);
            localHash = await computeSHA256Buffer(uint8Data.buffer as ArrayBuffer);
          } else {
            const content = await readTextFile(this.vault, file);
            localHash = await computeSHA256(content);
          }

          if (state && state.localHash === localHash) {
            continue;
          }

          await this.uploadFile(file, remotePath, filePassword);
          const remoteInfo = this.remoteTree?.get(remotePath);
          pendingStates.push({
            localPath: file.path,
            remotePath,
            localHash,
            remoteSha: remoteInfo?.sha || '',
            lastSync: Date.now(),
          });
          pendingPathMap.push([remotePath, file.path]);
          result.uploaded++;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          result.errors.push(`${file.path}: ${msg}`);
        }
      }

      const deletedStates: SyncFileState[] = [];
      for (const [localPath, state] of Object.entries(this.stateManager.getState().files)) {
        if (!localPaths.has(localPath)) {
          if (isIgnored(localPath, this.settings.ignorePatterns)) {
            result.skipped.push({ path: localPath, reason: '已被忽略模式过滤，跳过删除远程' });
            continue;
          }
          try {
            await this.gitee.deleteFile(state.remotePath, `Delete: ${localPath}`, state.remoteSha);
            deletedStates.push(state);
            result.deleted++;
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            result.errors.push(`删除远程失败 ${localPath}: ${msg}`);
          }
        }
      }

      if (pendingStates.length > 0 || deletedStates.length > 0) {
        if (pendingPathMap.length > 0 && this.pathMapCache) {
          for (const [remotePath, localPath] of pendingPathMap) {
            this.pathMapCache[remotePath] = localPath;
          }
          await this.writePathMap(this.pathMapCache);
        }
        await this.stateManager.batchUpdate(pendingStates);
        for (const ds of deletedStates) {
          await this.stateManager.removeFileState(ds.localPath);
        }
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

    const password = this.passwordManager.getPasswordForFile(filePath);
    const remotePath = await getRemotePath(filePath, password);

    let existingSha: string | undefined;
    if (this.remoteTree) {
      const remoteInfo = this.remoteTree.get(remotePath);
      if (remoteInfo) existingSha = remoteInfo.sha;
    }
    if (!existingSha) {
      const existing = await this.gitee.getFileContent(remotePath);
      if (existing) existingSha = existing.sha;
    }

    let localHash: string;
    if (isBinaryFile(file)) {
      const uint8Data = await readBinaryAsUint8Array(this.vault, file);
      const encrypted = await encryptBinary(uint8Data.buffer as ArrayBuffer, password);
      const base64Content = btoa(encrypted);
      const remoteSha = await this.gitee.createOrUpdateFile(remotePath, base64Content, `Push: ${remotePath}`, existingSha);
      localHash = await computeSHA256Buffer(uint8Data.buffer as ArrayBuffer);
      await this.stateManager.updateFileState({
        localPath: filePath,
        remotePath,
        localHash,
        remoteSha: remoteSha,
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
        remoteSha: remoteSha,
        lastSync: Date.now(),
      });
      await this.savePathMapEntry(remotePath, filePath);
      return remoteSha;
    }
  }

  async pullAll(): Promise<SyncResult> {
    const result: SyncResult = { uploaded: 0, downloaded: 0, deleted: 0, errors: [], skipped: [] };

    try {
      if (!this.settings.owner || !this.settings.repo || !this.settings.token) {
        new Notice('请先在设置中填写 Gitee 信息');
        return { ...result, errors: ['设置不完整'] };
      }

      await this.passwordManager.getPassword();

      const commitSha = await this.gitee.getBranchCommitSha();
      const treeSha = await this.gitee.getTreeSha(commitSha);
      const remoteTree = await this.gitee.getRecursiveTree(treeSha);
      this.remoteTree = remoteTree;

      const pathMap = await this.loadPathMap();
      this.pathMapCache = { ...pathMap };

      await this.stateManager.load();

      const currentHash = await this.passwordManager.getPasswordHash(
        await this.passwordManager.getPassword()
      );
      const storedHash = this.stateManager.getPasswordHash();
      if (storedHash && currentHash !== storedHash) {
        new Notice('检测到密码变更，请先在设置中更新密码');
        result.errors.push('密码已变更');
        return result;
      }

      const pendingStates: SyncFileState[] = [];

      for (const [remotePath, info] of remoteTree) {
        if (!isEncryptedFile(remotePath) || info.type !== 'blob' || remotePath === 'path-map.json.enc') continue;

        let localPath = pathMap[remotePath];
        if (!localPath) {
          const stateFile = this.stateManager.getFileStateByRemotePath(remotePath);
          if (stateFile) {
            localPath = stateFile.localPath;
          }
        }
        if (!localPath) {
          const files = this.vault.getFiles();
          for (const file of files) {
            const filePassword = this.passwordManager.getPasswordForFile(file.path);
            const computed = await getRemotePath(file.path, filePassword);
            if (computed === remotePath) {
              localPath = file.path;
              if (this.pathMapCache) {
                this.pathMapCache[remotePath] = localPath;
              }
              break;
            }
          }
        }
        if (!localPath) {
          result.skipped.push({ path: remotePath, reason: '路径映射和状态中均无对应本地路径' });
          continue;
        }

        try {
          const state = this.stateManager.getFileState(localPath);
          const fileExists = this.vault.getAbstractFileByPath(localPath) instanceof TFile;
          if (state && state.remoteSha === info.sha && fileExists) continue;

          const data = await this.gitee.getFileContent(remotePath);
          if (!data) {
            result.skipped.push({ path: localPath, reason: '远程文件不存在' });
            continue;
          }

          const filePassword = this.passwordManager.getPasswordForFile(localPath);

          let localHash: string;
          if (isBinaryFileByExt(localPath)) {
            const decrypted = await decryptBinary(data.content, filePassword);
            await writeBinaryFile(this.vault, localPath, decrypted);
            localHash = await computeSHA256Buffer(decrypted);
          } else {
            const decrypted = await decrypt(data.content, filePassword);
            await writeTextFile(this.vault, localPath, decrypted);
            localHash = await computeSHA256(decrypted);
          }

          pendingStates.push({
            localPath,
            remotePath,
            localHash,
            remoteSha: info.sha,
            lastSync: Date.now(),
          });
          result.downloaded++;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          result.errors.push(`${localPath}: ${msg}`);
        }
      }

      if (pendingStates.length > 0) {
        await this.stateManager.batchUpdate(pendingStates);
      }

      if (this.pathMapCache) {
        const pathMapSize = Object.keys(this.pathMapCache).length;
        const initialSize = Object.keys(pathMap).length;
        if (pathMapSize > initialSize) {
          await this.writePathMap(this.pathMapCache);
        }
      }

      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`拉取失败: ${msg}`);
      result.errors.push(msg);
      return result;
    }
  }

  async pullFile(filePath: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) throw new Error(`文件不存在: ${filePath}`);

    const password = this.passwordManager.getPasswordForFile(filePath);
    const remotePath = await getRemotePath(filePath, password);

    const data = await this.gitee.getFileContent(remotePath);
    if (!data) throw new Error(`远程文件不存在: ${remotePath}`);

    let localHash: string;
    if (isBinaryFile(file)) {
      const decrypted = await decryptBinary(data.content, password);
      await writeBinaryFile(this.vault, filePath, decrypted);
      localHash = await computeSHA256Buffer(decrypted);
    } else {
      const decrypted = await decrypt(data.content, password);
      await writeTextFile(this.vault, filePath, decrypted);
      localHash = await computeSHA256(decrypted);
    }

    await this.stateManager.updateFileState({
      localPath: filePath,
      remotePath,
      localHash,
      remoteSha: data.sha,
      lastSync: Date.now(),
    });
  }

  async onFileDeleted(localPath: string): Promise<void> {
    const state = this.stateManager.getFileState(localPath);
    if (!state) return;
    try {
      await this.gitee.deleteFile(state.remotePath, `Delete: ${localPath}`, state.remoteSha);
      await this.stateManager.removeFileState(localPath);
    } catch {
      // 远程文件可能已被删除，忽略错误
    }
  }

  async onFileRenamed(oldPath: string, newPath: string): Promise<void> {
    const state = this.stateManager.getFileState(oldPath);
    if (!state) return;
    state.localPath = newPath;
    delete this.stateManager.getState().files[oldPath];
    this.stateManager.getState().files[newPath] = state;
    await this.stateManager.save(this.stateManager.getState());
    await this.savePathMapEntry(state.remotePath, newPath);
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
  }

  private async savePathMapEntry(remotePath: string, localPath: string): Promise<void> {
    const map = await this.loadPathMap();
    map[remotePath] = localPath;
    await this.writePathMap(map);
  }

  private async batchSavePathMap(entries: Array<[string, string]>): Promise<void> {
    const map = await this.loadPathMap();
    for (const [remotePath, localPath] of entries) {
      map[remotePath] = localPath;
    }
    await this.writePathMap(map);
  }

  private async writePathMap(map: Record<string, string>): Promise<void> {
    const json = JSON.stringify(map, null, 2);
    const password = this.passwordManager.getPasswordForFile('path-map.json.enc');
    const encrypted = await encrypt(json, password);
    const content = btoa(encrypted);
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
        const password = this.passwordManager.getPasswordForFile('path-map.json.enc');
        try {
          const decrypted = await decrypt(data.content, password);
          return JSON.parse(decrypted) as Record<string, string>;
        } catch {
          // 兼容旧版本：未加密的 JSON 明文
          return JSON.parse(data.content) as Record<string, string>;
        }
      }
    } catch {
      // ignore
    }
    return {};
  }
}

function isBinaryFileByExt(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const textExtensions = new Set([
    'md', 'txt', 'html', 'css', 'js', 'ts', 'json', 'xml', 'yaml', 'yml',
    'csv', 'log', 'ini', 'cfg', 'conf', 'sh', 'bat', 'ps1', 'py', 'rb',
    'java', 'c', 'cpp', 'h', 'hpp', 'sql', 'r', 'tex', 'latex',
  ]);
  return !textExtensions.has(ext);
}
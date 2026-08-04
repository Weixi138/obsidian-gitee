import { Vault, TFile } from 'obsidian';
import { arrayBufferToBase64 } from '../crypto';

export async function readTextFile(vault: Vault, file: TFile): Promise<string> {
  return vault.read(file);
}

export async function readBinaryAsBase64(vault: Vault, file: TFile): Promise<string> {
  const buffer = await vault.readBinary(file);
  return arrayBufferToBase64(buffer);
}

export async function readBinaryAsUint8Array(vault: Vault, file: TFile): Promise<Uint8Array> {
  const buffer = await vault.readBinary(file);
  return new Uint8Array(buffer);
}

export function isBinaryFile(file: TFile): boolean {
  const ext = file.extension.toLowerCase();
  const textExtensions = new Set([
    'md', 'txt', 'html', 'css', 'js', 'ts', 'json', 'xml', 'yaml', 'yml',
    'csv', 'log', 'ini', 'cfg', 'conf', 'sh', 'bat', 'ps1', 'py', 'rb',
    'java', 'c', 'cpp', 'h', 'hpp', 'sql', 'r', 'tex', 'latex',
  ]);
  return !textExtensions.has(ext);
}

export async function writeTextFile(vault: Vault, path: string, content: string): Promise<void> {
  const existing = vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await vault.modify(existing, content);
  } else {
    await vault.create(path, content);
  }
}

export async function writeBinaryFile(vault: Vault, path: string, arrayBuffer: ArrayBuffer): Promise<void> {
  const existing = vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await vault.modifyBinary(existing, arrayBuffer);
  } else {
    await vault.createBinary(path, arrayBuffer);
  }
}

export async function deleteFile(vault: Vault, path: string): Promise<void> {
  const file = vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await vault.delete(file);
  }
}

export function fileExists(vault: Vault, path: string): boolean {
  return vault.getAbstractFileByPath(path) instanceof TFile;
}

export function getFileSize(file: TFile): number {
  return file.stat.size;
}
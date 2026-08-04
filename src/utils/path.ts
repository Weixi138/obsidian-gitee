import { computeSHA256 } from '../crypto';

export async function getRemotePath(localPath: string, password: string): Promise<string> {
  const segments = localPath.split('/');
  const encrypted = await Promise.all(segments.map(seg => hashSegment(seg, password)));
  return encrypted.join('/') + '.enc';
}

export function isEncryptedFile(path: string): boolean {
  return path.endsWith('.enc');
}

export function isIgnored(path: string, patterns: string[]): boolean {
  const segments = path.split('/');
  for (const pattern of patterns) {
    const patternSegments = pattern.split('/');
    if (matchPattern(segments, patternSegments)) {
      return true;
    }
  }
  return false;
}

async function hashSegment(segment: string, password: string): Promise<string> {
  const hash = await computeSHA256(password + ':' + segment);
  return hash.substring(0, 16);
}

function matchPattern(pathSegments: string[], patternSegments: string[]): boolean {
  for (let i = 0; i <= pathSegments.length - patternSegments.length; i++) {
    let matched = true;
    for (let j = 0; j < patternSegments.length; j++) {
      if (!matchSegment(pathSegments[i + j]!, patternSegments[j]!)) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function matchSegment(segment: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return segment === pattern;
  const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return regex.test(segment);
}
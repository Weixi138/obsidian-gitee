export async function encrypt(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  return 'GSE1:' + arrayBufferToBase64(combined.buffer);
}

export async function encryptBinary(data: ArrayBuffer, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data,
  );
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  return 'GSE1:' + arrayBufferToBase64(combined.buffer);
}

export async function decrypt(ciphertext: string, password: string): Promise<string> {
  const buf = decodeCiphertext(ciphertext);
  const salt = new Uint8Array(buf, 0, 16);
  const iv = new Uint8Array(buf, 16, 12);
  const encryptedData = new Uint8Array(buf, 28);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encryptedData,
  );
  return new TextDecoder().decode(decrypted);
}

export async function decryptBinary(ciphertext: string, password: string): Promise<ArrayBuffer> {
  const buf = decodeCiphertext(ciphertext);
  const salt = new Uint8Array(buf, 0, 16);
  const iv = new Uint8Array(buf, 16, 12);
  const encryptedData = new Uint8Array(buf, 28);
  const key = await deriveKey(password, salt);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encryptedData,
  );
}

function decodeCiphertext(ciphertext: string): ArrayBuffer {
  let raw = ciphertext;
  if (raw.startsWith('GSE1:')) {
    raw = raw.slice(5);
  }
  return base64ToArrayBuffer(raw);
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function computeSHA256(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
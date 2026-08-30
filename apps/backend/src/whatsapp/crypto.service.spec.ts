import { ConfigService } from '@nestjs/config';
import { CredentialCryptoService } from './crypto.service';

const KEY_A = 'a1b2c3d4'.repeat(8); // 64 hex chars
const KEY_B = 'f0e1d2c3'.repeat(8);

function service(encryptionKey: string): CredentialCryptoService {
  const config = {
    get: (key: string) =>
      key === 'security.encryptionKey' ? encryptionKey : 'jwt-secret-long-enough-for-tests',
  } as unknown as ConfigService;
  return new CredentialCryptoService(config);
}

describe('CredentialCryptoService', () => {
  const crypto = service(KEY_A);

  it('round-trips a value', () => {
    const secret = 'ultramsg_token_9f8e7d6c5b4a';
    expect(crypto.decrypt(crypto.encrypt(secret))).toBe(secret);
  });

  it('never stores the plaintext', () => {
    const secret = 'ultramsg_token_9f8e7d6c5b4a';
    expect(crypto.encrypt(secret)).not.toContain(secret);
  });

  it('produces different ciphertext each time (fresh IV)', () => {
    const a = crypto.encrypt('same value');
    const b = crypto.encrypt('same value');
    expect(a).not.toBe(b);
    expect(crypto.decrypt(a)).toBe(crypto.decrypt(b));
  });

  it('round-trips unicode and long values', () => {
    const value = `${'x'.repeat(2000)} — ключ 🔐`;
    expect(crypto.decrypt(crypto.encrypt(value))).toBe(value);
  });

  it('treats the empty string as empty rather than encrypting it', () => {
    expect(crypto.encrypt('')).toBe('');
    expect(crypto.decrypt('')).toBe('');
  });

  it('recognises its own ciphertext', () => {
    expect(crypto.isEncrypted(crypto.encrypt('v'))).toBe(true);
    expect(crypto.isEncrypted('plaintext')).toBe(false);
  });

  it('refuses to decrypt under a different key instead of returning garbage', () => {
    const other = service(KEY_B);
    expect(() => other.decrypt(crypto.encrypt('secret'))).toThrow();
  });

  it('detects a tampered ciphertext (GCM auth tag)', () => {
    const sealed = crypto.encrypt('secret');
    const parts = sealed.split(':');
    // Flip the last character of the ciphertext segment.
    const last = parts[3];
    parts[3] = last.slice(0, -1) + (last.at(-1) === 'A' ? 'B' : 'A');
    expect(() => crypto.decrypt(parts.join(':'))).toThrow();
  });

  it('rejects a value that is not in the expected format', () => {
    expect(() => crypto.decrypt('not-encrypted')).toThrow(/expected encrypted format/i);
    expect(() => crypto.decrypt('v1:only:two')).toThrow();
  });

  it('accepts a long passphrase as well as a hex key', () => {
    const pass = service('a-perfectly-reasonable-passphrase-over-32-chars');
    expect(pass.decrypt(pass.encrypt('v'))).toBe('v');
  });

  it('round-trips a whole credentials bag', () => {
    const bag = { instanceId: 'i-123', token: 'tok-abc', mode: 'project' };
    expect(crypto.decryptRecord(crypto.encryptRecord(bag))).toEqual(bag);
  });

  describe('mask', () => {
    it('reveals only the last four characters', () => {
      expect(CredentialCryptoService.mask('supersecrettoken1234')).toBe('••••••••1234');
    });

    it('reveals nothing at all for a short value', () => {
      expect(CredentialCryptoService.mask('abcd1234')).toBe('••••••••');
      expect(CredentialCryptoService.mask('short')).toBe('••••••••');
    });

    it('returns empty for an unset value', () => {
      expect(CredentialCryptoService.mask('')).toBe('');
    });
  });

  describe('generateWebhookSecret', () => {
    it('produces a 256-bit hex secret', () => {
      const s = CredentialCryptoService.generateWebhookSecret();
      expect(s).toMatch(/^[0-9a-f]{64}$/);
    });

    it('does not repeat', () => {
      const secrets = new Set(
        Array.from({ length: 50 }, () => CredentialCryptoService.generateWebhookSecret()),
      );
      expect(secrets.size).toBe(50);
    });
  });
});

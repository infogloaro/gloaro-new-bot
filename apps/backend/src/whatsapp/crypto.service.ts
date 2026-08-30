import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/** Marker so a future key rotation can tell old ciphertext from new. */
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Encrypts provider credentials before they touch the database.
 *
 * Every secret is sealed individually with AES-256-GCM under a key that lives
 * only in the environment (Secrets Manager in AWS), so a database dump on its
 * own is not enough to send messages as a client. GCM is authenticated, so a
 * tampered ciphertext fails to decrypt rather than yielding garbage.
 *
 * Ciphertext format: `v1:<iv b64>:<auth tag b64>:<ciphertext b64>`
 */
@Injectable()
export class CredentialCryptoService implements OnModuleInit {
  private readonly logger = new Logger(CredentialCryptoService.name);
  private readonly key: Buffer;
  private readonly derivedFromFallback: boolean;

  constructor(config: ConfigService) {
    const raw = config.get<string>('security.encryptionKey') ?? '';
    const jwtSecret = config.get<string>('jwt.secret') ?? '';

    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      this.key = Buffer.from(raw, 'hex');
      this.derivedFromFallback = false;
    } else if (raw.length >= 32) {
      // Accept a long passphrase too, so operators are not forced to hand-roll hex.
      this.key = crypto.createHash('sha256').update(raw, 'utf8').digest();
      this.derivedFromFallback = false;
    } else {
      // Development convenience only. Credentials encrypted under this key are
      // unreadable the moment JWT_SECRET changes, which is the intended pressure.
      this.key = crypto
        .createHash('sha256')
        .update(`gloaro-credential-fallback:${jwtSecret}`, 'utf8')
        .digest();
      this.derivedFromFallback = true;
    }
  }

  onModuleInit(): void {
    if (this.derivedFromFallback) {
      this.logger.warn(
        'CREDENTIALS_ENCRYPTION_KEY is not set - provider credentials are encrypted with a key ' +
          'derived from JWT_SECRET. Set a dedicated 64-character hex key before production.',
      );
    }
  }

  /** True when the value already looks like something this service produced. */
  isEncrypted(value: string): boolean {
    return typeof value === 'string' && value.startsWith(`${VERSION}:`);
  }

  encrypt(plaintext: string): string {
    if (plaintext === '') return '';
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), sealed.toString('base64')].join(
      ':',
    );
  }

  /**
   * Returns the plaintext, or throws if the value was written under a different
   * key. Callers treat a throw as "this account needs reconfiguring", never as
   * a reason to fall back to the raw stored bytes.
   */
  decrypt(ciphertext: string): string {
    if (ciphertext === '') return '';
    const [version, ivB64, tagB64, dataB64] = ciphertext.split(':');
    if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('Stored credential is not in the expected encrypted format');
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Encrypts every value of a credentials bag. */
  encryptRecord(values: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, this.encrypt(v ?? '')]));
  }

  decryptRecord(values: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, this.decrypt(v ?? '')]));
  }

  /**
   * What the admin panel is allowed to see: enough to recognise the value,
   * never enough to use it.
   */
  static mask(plaintext: string): string {
    if (!plaintext) return '';
    if (plaintext.length <= 8) return '••••••••';
    return `••••••••${plaintext.slice(-4)}`;
  }

  /** A fresh per-account webhook secret. */
  static generateWebhookSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}

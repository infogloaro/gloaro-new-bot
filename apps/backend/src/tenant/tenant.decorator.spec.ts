import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser } from '../auth/jwt.strategy';
import { DEFAULT_TENANT_ID } from './tenant.constants';
import { resolveTenantId } from './tenant.decorator';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function request(
  user: Partial<AuthUser> | undefined,
  headers: Record<string, string> = {},
  query: Record<string, string> = {},
): Request & { user?: AuthUser } {
  return { user, headers, query } as unknown as Request & { user?: AuthUser };
}

describe('resolveTenantId', () => {
  it('rejects an unauthenticated request', () => {
    expect(() => resolveTenantId(request(undefined))).toThrow(UnauthorizedException);
  });

  describe('a tenant-scoped user', () => {
    const admin = { id: 'u1', role: 'ADMIN', tenantId: TENANT_A } as AuthUser;

    it('is pinned to the tenant on their account', () => {
      expect(resolveTenantId(request(admin))).toBe(TENANT_A);
    });

    it('may name their own tenant explicitly', () => {
      expect(resolveTenantId(request(admin, { 'x-tenant-id': TENANT_A }))).toBe(TENANT_A);
      expect(resolveTenantId(request(admin, {}, { tenantId: TENANT_A }))).toBe(TENANT_A);
    });

    it('cannot reach another tenant through the header', () => {
      expect(() => resolveTenantId(request(admin, { 'x-tenant-id': TENANT_B }))).toThrow(
        ForbiddenException,
      );
    });

    it('cannot reach another tenant through the query string', () => {
      expect(() => resolveTenantId(request(admin, {}, { tenantId: TENANT_B }))).toThrow(
        ForbiddenException,
      );
    });

    it('cannot slip past the check with surrounding whitespace', () => {
      expect(() => resolveTenantId(request(admin, { 'x-tenant-id': ` ${TENANT_B} ` }))).toThrow(
        ForbiddenException,
      );
    });

    it('is refused entirely when their account has no tenant', () => {
      const orphan = { id: 'u2', role: 'AGENT', tenantId: null } as AuthUser;
      expect(() => resolveTenantId(request(orphan))).toThrow(ForbiddenException);
    });

    it('applies to AGENT exactly as it does to ADMIN', () => {
      const agent = { id: 'u3', role: 'AGENT', tenantId: TENANT_A } as AuthUser;
      expect(resolveTenantId(request(agent))).toBe(TENANT_A);
      expect(() => resolveTenantId(request(agent, { 'x-tenant-id': TENANT_B }))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('SUPER_ADMIN', () => {
    const superAdmin = { id: 'u9', role: 'SUPER_ADMIN', tenantId: null } as AuthUser;

    it('may act inside any named tenant', () => {
      expect(resolveTenantId(request(superAdmin, { 'x-tenant-id': TENANT_B }))).toBe(TENANT_B);
      expect(resolveTenantId(request(superAdmin, {}, { tenantId: TENANT_A }))).toBe(TENANT_A);
    });

    it('falls back to the default tenant when none is named', () => {
      expect(resolveTenantId(request(superAdmin))).toBe(DEFAULT_TENANT_ID);
    });

    it('prefers their own tenant over the default when they have one', () => {
      const pinned = { ...superAdmin, tenantId: TENANT_A } as AuthUser;
      expect(resolveTenantId(request(pinned))).toBe(TENANT_A);
    });

    it('treats a blank header as "not named"', () => {
      expect(resolveTenantId(request(superAdmin, { 'x-tenant-id': '  ' }))).toBe(DEFAULT_TENANT_ID);
    });
  });
});

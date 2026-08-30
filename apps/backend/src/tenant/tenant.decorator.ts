import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { AuthUser } from '../auth/jwt.strategy';
import { DEFAULT_TENANT_ID, TENANT_HEADER } from './tenant.constants';

/**
 * Works out which tenant this request is allowed to act inside.
 *
 * This is the single choke point for tenant isolation on the admin API: every
 * service method takes a `tenantId` and every query filters on it, and the only
 * value they ever receive comes from here. A tenant-scoped user cannot widen
 * their reach by sending a header, because the header is compared against the
 * tenant stamped on their account rather than trusted.
 */
export function resolveTenantId(req: Request & { user?: AuthUser }): string {
  const user = req.user;
  if (!user) throw new UnauthorizedException('Not authenticated');

  const headerValue = req.headers[TENANT_HEADER];
  const requested =
    (Array.isArray(headerValue) ? headerValue[0] : headerValue) ??
    (typeof req.query?.tenantId === 'string' ? req.query.tenantId : undefined);

  // SUPER_ADMIN operates across tenants and may name the one it wants.
  if (user.role === UserRole.SUPER_ADMIN) {
    return requested?.trim() || user.tenantId || DEFAULT_TENANT_ID;
  }

  if (!user.tenantId) {
    throw new ForbiddenException('This account is not assigned to a tenant');
  }
  if (requested && requested.trim() !== user.tenantId) {
    throw new ForbiddenException('You cannot access another tenant');
  }
  return user.tenantId;
}

/** Injects the resolved tenant id into a handler parameter. */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string =>
  resolveTenantId(ctx.switchToHttp().getRequest()),
);

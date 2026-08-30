/**
 * The tenant every row created before multi-tenancy belongs to, and the tenant
 * a fresh install seeds. The id is fixed so the migration, the seed script and
 * the runtime all agree without a lookup.
 */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const DEFAULT_TENANT_SLUG = 'gloaro';

/** Header a SUPER_ADMIN sends to act inside one specific tenant. */
export const TENANT_HEADER = 'x-tenant-id';

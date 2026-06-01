-- scripts/init.sql
-- Row Level Security for multi-tenant isolation

-- Enable RLS on tenant-scoped tables (run after Prisma migrations)
-- These are applied after `pnpm db:push`

-- Note: Prisma manages table creation.
-- This script sets up RLS policies post-migration.

-- Example RLS setup (enable after migration):
-- ALTER TABLE "Upload" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE "Alert" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY tenant_isolation_uploads ON "Upload"
--   USING ("tenantId" = current_setting('app.tenant_id', true));

-- For development: RLS is disabled, tenantId is filtered in application layer.
-- Enable in production by uncommenting above and setting app.tenant_id per connection.

SELECT 'AML Detector database initialized' as status;

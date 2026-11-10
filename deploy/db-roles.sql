-- FuelFlow — least-privilege database role for the running application.
--
-- Run ONCE as the database owner, AFTER `npm run db:deploy` has created the tables:
--   psql "$DIRECT_URL" -v app_password=a-long-random-password -f deploy/db-roles.sql
-- Then set DATABASE_URL to connect as fuelflow_app, and keep DIRECT_URL (owner) for migrations only.
-- Re-run after each new migration so new tables get the same grants.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fuelflow_app') THEN
    CREATE ROLE fuelflow_app LOGIN;
  END IF;
END
$$;
ALTER ROLE fuelflow_app WITH LOGIN PASSWORD :'app_password';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO fuelflow_app', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO fuelflow_app;

-- normal read/write on business tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fuelflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fuelflow_app;

-- append-only ledgers: the app may add rows and read them, never change or remove them
-- (UPDATE is also blocked by triggers created in the 20261111000000_hardening migration)
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog", "StockMovement", "PaymentTransaction" FROM fuelflow_app;

-- the app must never alter the schema or the migration history
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "_prisma_migrations" FROM fuelflow_app;
REVOKE CREATE ON SCHEMA public FROM fuelflow_app;

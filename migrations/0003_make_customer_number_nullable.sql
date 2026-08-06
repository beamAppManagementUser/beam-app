-- migrations/0003_make_customer_number_nullable.sql
-- Drop NOT NULL constraint on common customer-number column names if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inward_entries' AND column_name = 'customer_number'
  ) THEN
    EXECUTE 'ALTER TABLE inward_entries ALTER COLUMN customer_number DROP NOT NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inward_entries' AND column_name = 'CustomerNumber'
  ) THEN
    EXECUTE 'ALTER TABLE inward_entries ALTER COLUMN "CustomerNumber" DROP NOT NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inward_entries' AND column_name = 'customer_no'
  ) THEN
    EXECUTE 'ALTER TABLE inward_entries ALTER COLUMN customer_no DROP NOT NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inward_entries' AND column_name = 'customerNumber'
  ) THEN
    EXECUTE 'ALTER TABLE inward_entries ALTER COLUMN "customerNumber" DROP NOT NULL';
  END IF;
END
$$;

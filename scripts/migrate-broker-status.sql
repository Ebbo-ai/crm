-- Explicit one-time data migration. Never called at startup.
-- Run against dev now; production execution requires separate authorization.
-- NULL means not yet migrated. NOT_SET is a deliberate review state.
BEGIN;
UPDATE clients c
SET broker_status = CASE
  WHEN upper(trim(coalesce(broker_firm_name, ''))) = 'N/A'
    OR upper(trim(coalesce(broker_contact_name, ''))) = 'N/A' THEN 'DIRECT'
  WHEN has_broker OR EXISTS (
    SELECT 1 FROM broker_contacts b WHERE b.client_id = c.id
  ) THEN 'BROKER'
  ELSE 'NOT_SET'
END
WHERE broker_status IS NULL;
COMMIT;

-- Ejecutar una sola vez antes de desplegar la sincronización de configuración.
BEGIN;
ALTER TABLE public.mtaxi_users ADD COLUMN IF NOT EXISTS settings jsonb;
COMMIT;

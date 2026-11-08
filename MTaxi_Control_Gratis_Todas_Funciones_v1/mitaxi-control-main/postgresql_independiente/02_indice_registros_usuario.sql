-- Ejecutar una sola vez sobre instalaciones existentes antes de actualizar server.mjs.
-- Las filas existentes reciben created_at=NOW() si la columna no existía.
BEGIN;
ALTER TABLE public.taxi_records ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS taxi_records_client_created_idx ON public.taxi_records(client_id, created_at);
COMMIT;

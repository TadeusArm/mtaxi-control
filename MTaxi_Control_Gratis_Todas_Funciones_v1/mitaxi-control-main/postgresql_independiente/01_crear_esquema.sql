-- Esquema compatible con db/schema.ts y la migración existente.
BEGIN;
CREATE TABLE IF NOT EXISTS public.taxi_records (
  client_id text NOT NULL,
  record_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT taxi_records_pkey PRIMARY KEY (client_id, record_id)
);
ALTER TABLE public.taxi_records ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS taxi_records_client_created_idx ON public.taxi_records(client_id, created_at);

CREATE TABLE IF NOT EXISTS public.mtaxi_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mtaxi_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.mtaxi_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mtaxi_sessions_user_id_idx ON public.mtaxi_sessions(user_id);
CREATE INDEX IF NOT EXISTS mtaxi_sessions_expires_at_idx ON public.mtaxi_sessions(expires_at);
COMMIT;

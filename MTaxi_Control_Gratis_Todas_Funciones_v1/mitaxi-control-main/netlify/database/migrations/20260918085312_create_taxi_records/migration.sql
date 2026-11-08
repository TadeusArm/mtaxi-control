CREATE TABLE "taxi_records" (
	"client_id" text,
	"record_id" text,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taxi_records_pkey" PRIMARY KEY("client_id","record_id")
);

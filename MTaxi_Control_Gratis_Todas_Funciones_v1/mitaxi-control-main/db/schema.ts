import { pgTable, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const taxiRecords = pgTable("taxi_records", {
  clientId: text("client_id").notNull(),
  recordId: text("record_id").notNull(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.clientId, table.recordId] })]);

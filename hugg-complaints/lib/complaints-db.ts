// lib/complaints-db.ts
// ============================================================
//  Single accessor for the new `complaints` schema tables.
//  PostgREST reaches a non-public schema via .schema('complaints').
//
//  ⚠️ ONE-TIME SETUP: the `complaints` schema must be added to the
//  project's "Exposed schemas" (Supabase Dashboard → Settings → API
//  → Exposed schemas → add `complaints`). Without this, .schema()
//  calls return a "schema must be one of the following" error.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export const COMPLAINTS_SCHEMA = 'complaints' as const

export const CTBL = {
  tickets: 'tickets',
  deliveries: 'deliveries',
  actions: 'actions',
} as const

// Returns a query builder scoped to the complaints schema.
// Usage: cdb(supabase).from(CTBL.tickets).select('*')
export function cdb(client: SupabaseClient) {
  return client.schema(COMPLAINTS_SCHEMA)
}

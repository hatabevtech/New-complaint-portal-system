// lib/state-machine.ts
// ============================================================
//  The complaint state machine. Pure-ish logic layer over the
//  `complaints` schema. No HTTP here — API routes call these.
//
//  Design (locked):
//   • Movement is LENIENT — advanceStage accepts any stage; the UI
//     presents the order. We don't reject out-of-order moves.
//   • Stages are GATED on data — a data-bearing stage can't be
//     marked complete without its field (address_confirmed, qty…).
//   • GUARDS — no acting on a closed ticket, no double-close, must
//     be handed off to a human before stage moves.
//   • closeTicket policing = Option B — require resolution_method
//     always; require fault_attribution when method = redispatch.
//   • Every state change LOGS AN ACTION + MOVES STATE in one call.
//
//  All functions return { ok: true, ... } or { ok: false, reason }
//  — business-rule failures don't throw (mirrors n8n Continue-On-Fail).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { cdb, CTBL } from './complaints-db'
import {
  ComplaintType,
  StageKey,
  ResolutionMethod,
  FaultAttribution,
  getStage,
  shouldHandOff,
  firstStage,
} from './pipelines'

export type Result<T = {}> =
  | ({ ok: true } & T)
  | { ok: false; reason: string }

// ── Shape of the ticket fields the state machine reads/writes ──
interface TicketRow {
  id: string
  complaint_type: ComplaintType
  ticket_status: 'open' | 'in_progress' | 'awaiting_information' | 'closed'
  currently_handled_by: 'system' | 'human'
  current_stage: StageKey | null
  // data-gate fields
  address_confirmed: boolean | null
  pincode_confirmed: boolean | null
  phone_confirmed: boolean | null
  damaged_qty: number | null
  damaged_value: number | null
  // resolution
  resolution_method: ResolutionMethod | null
  resolved_by: 'system' | 'human' | null
  fault_attribution: FaultAttribution | null
  created_at: string
  closed_at: string | null
}

// Which stages require which data before they can be completed.
// (Lenient on ORDER, strict on EVIDENCE.)
const STAGE_GATES: Partial<Record<StageKey, (t: TicketRow) => string | null>> = {
  verify_address:    (t) => (t.address_confirmed ? null : 'address not confirmed'),
  verify_pincode:    (t) => (t.pincode_confirmed ? null : 'pincode not confirmed'),
  verify_phone:      (t) => (t.phone_confirmed ? null : 'phone not confirmed'),
  identify_quantity: (t) =>
    t.damaged_qty != null && t.damaged_value != null
      ? null
      : 'damaged quantity and value required',
}

// ── action logging (internal; always paired with a state change) ──
async function logAction(
  supabase: SupabaseClient,
  ticketId: string,
  action: {
    action_type: string
    action_by: 'system' | 'human'
    delivery_id?: string | null
    outcome?: string | null
    channel?: string | null
    notes?: string | null
    courier_ref?: string | null
  },
): Promise<{ error: string | null }> {
  const { error } = await cdb(supabase)
    .from(CTBL.actions)
    .insert({
      ticket_id: ticketId,
      action_type: action.action_type,
      action_by: action.action_by,
      delivery_id: action.delivery_id ?? null,
      outcome: action.outcome ?? null,
      channel: action.channel ?? null,
      notes: action.notes ?? null,
      courier_ref: action.courier_ref ?? null,
    })
  return { error: error?.message ?? null }
}

async function getTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<TicketRow | null> {
  const { data } = await cdb(supabase)
    .from(CTBL.tickets)
    .select(
      'id, complaint_type, ticket_status, currently_handled_by, current_stage, address_confirmed, pincode_confirmed, phone_confirmed, damaged_qty, damaged_value, resolution_method, resolved_by, fault_attribution, created_at, closed_at',
    )
    .eq('id', ticketId)
    .single()
  return (data as TicketRow) ?? null
}

// ============================================================
//  1. assignToHuman — flip system -> human.
//     • For on_create types: called right after creation.
//     • For delivery_delayed: called when shouldHandOff() fires
//       (by a poller or manually). Sets current_stage to the first
//       human stage and logs `escalated_to_human`.
// ============================================================
export async function assignToHuman(
  supabase: SupabaseClient,
  ticketId: string,
  opts?: { reason?: string; actor?: 'system' | 'human' },
): Promise<Result<{ current_stage: StageKey }>> {
  const t = await getTicket(supabase, ticketId)
  if (!t) return { ok: false, reason: 'ticket not found' }
  if (t.ticket_status === 'closed') return { ok: false, reason: 'ticket already closed' }
  if (t.currently_handled_by === 'human') {
    return { ok: false, reason: 'already handled by human' }
  }

  const stage = firstStage(t.complaint_type)

  const { error } = await cdb(supabase)
    .from(CTBL.tickets)
    .update({
      currently_handled_by: 'human',
      current_stage: stage,
      ticket_status: t.ticket_status === 'open' ? 'in_progress' : t.ticket_status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ticketId)
  if (error) return { ok: false, reason: error.message }

  const { error: aErr } = await logAction(supabase, ticketId, {
    action_type: 'escalated_to_human',
    action_by: opts?.actor ?? 'system',
    notes: opts?.reason ?? null,
  })
  if (aErr) return { ok: false, reason: `state moved but action log failed: ${aErr}` }

  return { ok: true, current_stage: stage }
}

// Convenience: evaluate the conditional handoff for delivery_delayed
// and hand off if the rule fires. attempts/orderDate come from the
// courier feed + ticket. Returns ok:false{reason:'not yet'} if not due.
export async function maybeHandOff(
  supabase: SupabaseClient,
  ticketId: string,
  signals: { attempts?: number | null; orderDate?: string | null },
): Promise<Result<{ current_stage: StageKey } | { handed_off: false }>> {
  const t = await getTicket(supabase, ticketId)
  if (!t) return { ok: false, reason: 'ticket not found' }
  if (t.currently_handled_by === 'human') return { ok: false, reason: 'already human' }

  const due = shouldHandOff(t.complaint_type, {
    attempts: signals.attempts,
    orderDate: signals.orderDate,
  })
  if (!due) return { ok: true, handed_off: false }

  return assignToHuman(supabase, ticketId, {
    actor: 'system',
    reason: 'handoff trigger met (attempts/age)',
  })
}

// ============================================================
//  2. advanceStage — move current_stage + log the action.
//     Lenient on order; gated on data; one paired write.
//     `complete: true` (default) means "this stage is done, move to
//     `to` (or the rep-chosen next stage)". The gate runs on the
//     stage being COMPLETED, not the one being moved to.
// ============================================================
export async function advanceStage(
  supabase: SupabaseClient,
  ticketId: string,
  args: {
    to: StageKey                 // where the rep is moving to (lenient)
    completing?: StageKey | null // the stage they just finished (gate runs here)
    action_type: string          // e.g. 'verify_address', 'customer_contacted'
    action_by?: 'system' | 'human'
    delivery_id?: string | null
    outcome?: string | null
    channel?: string | null
    notes?: string | null
    courier_ref?: string | null
  },
): Promise<Result<{ current_stage: StageKey }>> {
  const t = await getTicket(supabase, ticketId)
  if (!t) return { ok: false, reason: 'ticket not found' }

  // guards
  if (t.ticket_status === 'closed') return { ok: false, reason: 'ticket is closed' }
  if (t.currently_handled_by !== 'human') {
    return { ok: false, reason: 'ticket must be handed off to a human first' }
  }

  // the target stage must exist in this type's pipeline
  if (!getStage(t.complaint_type, args.to)) {
    return { ok: false, reason: `stage '${args.to}' not valid for ${t.complaint_type}` }
  }

  // data gate — runs on the stage being COMPLETED (skippable stages have no gate)
  const completing = args.completing ?? t.current_stage
  if (completing) {
    const gate = STAGE_GATES[completing]
    if (gate) {
      const missing = gate(t)
      if (missing) return { ok: false, reason: `cannot complete ${completing}: ${missing}` }
    }
  }

  const { error } = await cdb(supabase)
    .from(CTBL.tickets)
    .update({ current_stage: args.to, updated_at: new Date().toISOString() })
    .eq('id', ticketId)
  if (error) return { ok: false, reason: error.message }

  const { error: aErr } = await logAction(supabase, ticketId, {
    action_type: args.action_type,
    action_by: args.action_by ?? 'human',
    delivery_id: args.delivery_id,
    outcome: args.outcome,
    channel: args.channel,
    notes: args.notes,
    courier_ref: args.courier_ref,
  })
  if (aErr) return { ok: false, reason: `stage moved but action log failed: ${aErr}` }

  return { ok: true, current_stage: args.to }
}

// ============================================================
//  3. closeTicket — terminal. Writes resolution + closes.
//     Policing = Option B:
//       • resolution_method REQUIRED
//       • fault_attribution REQUIRED when method = 'redispatch'
//     Guards: no double-close.
//     Computes resolution_time_minutes from created_at.
// ============================================================
export async function closeTicket(
  supabase: SupabaseClient,
  ticketId: string,
  args: {
    resolution_method: ResolutionMethod
    resolved_by: 'system' | 'human'
    fault_attribution?: FaultAttribution
    resolution_notes?: string | null
  },
): Promise<Result<{ resolution_time_minutes: number }>> {
  const t = await getTicket(supabase, ticketId)
  if (!t) return { ok: false, reason: 'ticket not found' }

  // guards
  if (t.ticket_status === 'closed') return { ok: false, reason: 'ticket already closed' }

  // Option B policing
  if (!args.resolution_method) {
    return { ok: false, reason: 'resolution_method is required to close' }
  }
  if (args.resolution_method === 'redispatch' && !args.fault_attribution) {
    return {
      ok: false,
      reason: 'fault_attribution is required for a redispatch (decides fee vs free)',
    }
  }

  const now = new Date()
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(t.created_at).getTime()) / 60_000),
  )

  const { error } = await cdb(supabase)
    .from(CTBL.tickets)
    .update({
      ticket_status: 'closed',
      current_stage: 'resolution',
      resolution_method: args.resolution_method,
      resolved_by: args.resolved_by,
      fault_attribution: args.fault_attribution ?? t.fault_attribution ?? 'none',
      resolution_notes: args.resolution_notes ?? null,
      resolution_time_minutes: minutes,
      closed_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', ticketId)
    .neq('ticket_status', 'closed') // race guard: only close if not already closed
  if (error) return { ok: false, reason: error.message }

  const { error: aErr } = await logAction(supabase, ticketId, {
    action_type: 'resolved',
    action_by: args.resolved_by,
    outcome: args.resolution_method,
    notes: args.resolution_notes ?? null,
  })
  if (aErr) return { ok: false, reason: `closed but action log failed: ${aErr}` }

  return { ok: true, resolution_time_minutes: minutes }
}

// ============================================================
//  5. escalateToCourier — email the courier, enter awaiting state.
//     One-shot: guarded so it can't double-fire while awaiting.
//     Sets awaiting_since (drives the follow-up clock).
//     (Email send itself is a stub for now — logs the action.)
// ============================================================
export async function escalateToCourier(
  supabase: SupabaseClient,
  ticketId: string,
  opts?: { courier?: string; notes?: string },
): Promise<Result> {
  const t = await getTicket(supabase, ticketId)
  if (!t) return { ok: false, reason: 'ticket not found' }
  if (t.ticket_status === 'closed') return { ok: false, reason: 'ticket is closed' }
  if (t.ticket_status === 'awaiting_information') {
    return { ok: false, reason: 'already escalated and awaiting a response' }
  }

  const now = new Date().toISOString()
  const { error } = await cdb(supabase)
    .from(CTBL.tickets)
    .update({ ticket_status: 'awaiting_information', awaiting_since: now, updated_at: now })
    .eq('id', ticketId)
  if (error) return { ok: false, reason: error.message }

  const { error: aErr } = await logAction(supabase, ticketId, {
    action_type: 'escalated_to_courier',
    action_by: 'human',
    channel: 'email',
    notes: opts?.notes ?? (opts?.courier ? `Emailed ${opts.courier}` : 'Escalated to courier'),
  })
  if (aErr) return { ok: false, reason: `escalated but action log failed: ${aErr}` }
  return { ok: true }
}

// ============================================================
//  6. courierResponded — clear the wait, back to in_progress.
//     Optional note captures what the courier said.
//     Guarded: only valid while awaiting_information.
// ============================================================
export async function courierResponded(
  supabase: SupabaseClient,
  ticketId: string,
  opts?: { note?: string },
): Promise<Result> {
  const t = await getTicket(supabase, ticketId)
  if (!t) return { ok: false, reason: 'ticket not found' }
  if (t.ticket_status !== 'awaiting_information') {
    return { ok: false, reason: 'ticket is not awaiting a courier response' }
  }

  const now = new Date().toISOString()
  const { error } = await cdb(supabase)
    .from(CTBL.tickets)
    .update({ ticket_status: 'in_progress', awaiting_since: null, updated_at: now })
    .eq('id', ticketId)
  if (error) return { ok: false, reason: error.message }

  const { error: aErr } = await logAction(supabase, ticketId, {
    action_type: 'courier_responded',
    action_by: 'human',
    notes: opts?.note ?? 'Courier responded',
  })
  if (aErr) return { ok: false, reason: `reopened but action log failed: ${aErr}` }
  return { ok: true }
}
//     For side events (note added, evidence reviewed, SMS sent)
//     that don't advance the pipeline. Still guarded against
//     closed tickets.
// ============================================================
export async function recordAction(
  supabase: SupabaseClient,
  ticketId: string,
  action: {
    action_type: string
    action_by?: 'system' | 'human'
    delivery_id?: string | null
    outcome?: string | null
    channel?: string | null
    notes?: string | null
    courier_ref?: string | null
  },
): Promise<Result> {
  const t = await getTicket(supabase, ticketId)
  if (!t) return { ok: false, reason: 'ticket not found' }
  if (t.ticket_status === 'closed') return { ok: false, reason: 'ticket is closed' }

  const { error } = await logAction(supabase, ticketId, {
    action_type: action.action_type,
    action_by: action.action_by ?? 'human',
    delivery_id: action.delivery_id,
    outcome: action.outcome,
    channel: action.channel,
    notes: action.notes,
    courier_ref: action.courier_ref,
  })
  if (error) return { ok: false, reason: error }
  return { ok: true }
}

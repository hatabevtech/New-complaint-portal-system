// lib/data.ts
// ============================================================
//  Server-side data access for the complaints UI.
//  Reads complaints.* and joins public.orders for display fields
//  (name, total, payment) — those facts are NOT copied onto the
//  ticket, so we fetch them live and merge.
// ============================================================

import { createAdminClient } from './supabase/server'
import { cdb, CTBL } from './complaints-db'
import type { ComplaintType, StageKey } from './pipelines'

export interface TicketRow {
  id: string
  ticket_number: string
  order_id: string
  customer_phone: string | null
  complaint_type: ComplaintType
  raised_by: string
  source: string | null
  current_stage: StageKey | null
  ticket_status: 'open' | 'in_progress' | 'awaiting_information' | 'closed'
  currently_handled_by: 'system' | 'human'
  awaiting_since: string | null
  fault_attribution: string | null
  resolution_method: string | null
  resolved_by: string | null
  resolution_notes: string | null
  resolution_time_minutes: number | null
  damaged_qty: number | null
  damaged_value: number | null
  missing_items: string | null
  address_confirmed: boolean | null
  pincode_confirmed: boolean | null
  phone_confirmed: boolean | null
  image_url: string | null
  video_url: string | null
  shipping_address: string | null
  shipping_city: string | null
  shipping_state: string | null
  shipping_postcode: string | null
  updated_address: string | null
  created_at: string
  closed_at: string | null
}

export interface DeliveryRow {
  id: string
  ticket_id: string
  delivery_reference: string | null
  sku: string | null
  product_name: string | null
  courier: string | null
  tracking_id: string | null
  tracking_link: string | null
  status: string | null
  status_message: string | null
  edd: string | null
  is_redispatch: boolean | null
}

export interface ActionRow {
  id: string
  ticket_id: string
  action_type: string
  action_by: 'system' | 'human'
  outcome: string | null
  channel: string | null
  notes: string | null
  courier_ref: string | null
  created_at: string
}

// Order facts joined from public.orders (display only).
export interface OrderFacts {
  customer_name: string | null
  order_total: number | null
  payment_method: string | null
}

export interface TicketWithExtras extends TicketRow {
  order?: OrderFacts
  deliveries?: DeliveryRow[]
  actions?: ActionRow[]
}

// List view — tickets + their first delivery + order facts (for the table).
export async function listTickets(): Promise<TicketWithExtras[]> {
  const supabase = createAdminClient()

  const { data: tickets, error } = await cdb(supabase)
    .from(CTBL.tickets)
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listTickets: ${error.message}`)
  const rows = (tickets ?? []) as TicketRow[]
  if (rows.length === 0) return []

// deliveries for all tickets (one query)
  const ids = rows.map((t) => t.id)
  const { data: deliveries } = await cdb(supabase)
    .from(CTBL.deliveries)
    .select('*')
    .in('ticket_id', ids)
  const delByTicket = new Map<string, DeliveryRow[]>()
  for (const d of (deliveries ?? []) as DeliveryRow[]) {
    const arr = delByTicket.get(d.ticket_id) ?? []
    arr.push(d)
    delByTicket.set(d.ticket_id, arr)
  }

  // actions for all tickets (one query), newest first
  const { data: actions } = await cdb(supabase)
    .from(CTBL.actions)
    .select('*')
    .in('ticket_id', ids)
    .order('created_at', { ascending: false })
  const actByTicket = new Map<string, ActionRow[]>()
  for (const a of (actions ?? []) as ActionRow[]) {
    const arr = actByTicket.get(a.ticket_id) ?? []
    arr.push(a)
    actByTicket.set(a.ticket_id, arr)
  }

  // order facts from public.orders (join on order_id = orders.id)
  const orderIds = Array.from(new Set(rows.map((t) => t.order_id)))
  const facts = await fetchOrderFacts(supabase, orderIds)

  return rows.map((t) => ({
    ...t,
    order: facts.get(String(t.order_id)),
    deliveries: delByTicket.get(t.id) ?? [],
    actions: actByTicket.get(t.id) ?? [],
  }))
}

// Detail view — one ticket fully hydrated.
export async function getTicket(id: string): Promise<TicketWithExtras | null> {
  const supabase = createAdminClient()
  const { data: ticket, error } = await cdb(supabase)
    .from(CTBL.tickets)
    .select('*')
    .eq('id', id)
    .single()
  if (error || !ticket) return null
  const t = ticket as TicketRow

  const [{ data: deliveries }, { data: actions }, facts] = await Promise.all([
    cdb(supabase).from(CTBL.deliveries).select('*').eq('ticket_id', id),
    cdb(supabase).from(CTBL.actions).select('*').eq('ticket_id', id).order('created_at', { ascending: false }),
    fetchOrderFacts(supabase, [t.order_id]),
  ])

  return {
    ...t,
    order: facts.get(String(t.order_id)),
    deliveries: (deliveries ?? []) as DeliveryRow[],
    actions: (actions ?? []) as ActionRow[],
  }
}

// public.orders lives in the public schema; default client reads it.
// order_id on the ticket is text; orders.id is the join key.
async function fetchOrderFacts(
  supabase: ReturnType<typeof createAdminClient>,
  orderIds: string[],
): Promise<Map<string, OrderFacts>> {
  const map = new Map<string, OrderFacts>()
  if (orderIds.length === 0) return map
  // orders.id may be integer; cast the text order_ids for the .in() filter.
  const numericIds = orderIds.map((x) => x).filter(Boolean)
  const { data } = await supabase
    .from('orders')
    .select('id, billing_first_name, billing_last_name, total, payment_method')
    .in('id', numericIds)
  for (const o of (data ?? []) as Array<{
    id: number | string
    billing_first_name: string | null
    billing_last_name: string | null
    total: number | string | null
    payment_method: string | null
  }>) {
    const name = [o.billing_first_name, o.billing_last_name].filter(Boolean).join(' ').replace(/ nan/gi, '').trim() || null
    map.set(String(o.id), {
      customer_name: name,
      order_total: o.total != null ? Number(o.total) : null,
      payment_method: o.payment_method,
    })
  }
  return map
}

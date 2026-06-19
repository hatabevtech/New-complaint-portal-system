// lib/pipelines.ts
// ============================================================
//  Single source of truth for the five complaint pipelines.
//  Each complaint_type maps to: an ordered list of HUMAN stages,
//  a handoff rule (when system -> human), and display labels.
//
//  These are settled definitions (see pipeline_definitions doc).
//  current_stage on the ticket is one of these stage keys, or
//  null while the system still owns it (only delivery_delayed
//  has a system-monitoring window; the rest hand off on creation).
// ============================================================

export type ComplaintType =
  | 'delivery_delayed'
  | 'damaged_item'
  | 'delivered_not_received'
  | 'missing_item'
  | 'wrong_item'

// Every stage key used across all pipelines. A key can appear in
// more than one pipeline (e.g. contact_customer, resolution).
export type StageKey =
  | 'verify_address'
  | 'verify_pincode'
  | 'verify_phone'
  | 'contact_customer'
  | 'check_tracking'
  | 'verify_photo'
  | 'verify_video'
  | 'verify_from_factory'
  | 'identify_quantity'
  | 'file_claim'
  | 'resolution'

export interface Stage {
  key: StageKey
  label: string          // human-readable, shown in the UI
  skippable?: boolean     // rep may pass without acting (e.g. file_claim)
  terminal?: boolean      // completing this stage closes the ticket
}

// ── Handoff: when does an item move from system -> human? ──
// 'on_create'  : straight to human the moment the ticket exists.
// 'conditional': system monitors; hands off when the rule fires.
export type HandoffMode = 'on_create' | 'conditional'

export interface HandoffRule {
  mode: HandoffMode
  // Only meaningful for 'conditional'. Evaluated against live ticket data.
  // delivery_delayed: attempts > 2 OR (today - order_date) > 7 days.
  conditionLabel?: string
  maxAgeDays?: number
  maxAttempts?: number
}

export interface Pipeline {
  type: ComplaintType
  handoff: HandoffRule
  // Ordered human stages. current_stage walks this list after handoff.
  stages: Stage[]
}

// ── Reusable stage definitions (so labels stay consistent) ──
const S: Record<StageKey, Stage> = {
  verify_address:      { key: 'verify_address',      label: 'Verify Address' },
  verify_pincode:      { key: 'verify_pincode',      label: 'Verify Pincode' },
  verify_phone:        { key: 'verify_phone',        label: 'Verify Phone Number' },
  contact_customer:    { key: 'contact_customer',    label: 'Contact Customer' },
  check_tracking:      { key: 'check_tracking',      label: 'Check Tracking' },
  verify_photo:        { key: 'verify_photo',        label: 'Verify Photo' },
  verify_video:        { key: 'verify_video',        label: 'Verify Video' },
  verify_from_factory: { key: 'verify_from_factory', label: 'Verify Dispatch with Factory' },
  identify_quantity:   { key: 'identify_quantity',   label: 'Identify Quantity' },
  file_claim:          { key: 'file_claim',          label: 'File Claim', skippable: true },
  resolution:          { key: 'resolution',          label: 'Resolution', terminal: true },
}

// ── The five pipelines ──
// wrong_item is identical to missing_item (shared stage list).
const EVIDENCE_MISSING_WRONG: Stage[] = [
  S.verify_photo, S.verify_video, S.verify_from_factory, S.file_claim, S.resolution,
]

export const PIPELINES: Record<ComplaintType, Pipeline> = {
  delivery_delayed: {
    type: 'delivery_delayed',
    handoff: {
      mode: 'conditional',
      conditionLabel: 'attempts > 2 OR order age > 7 days',
      maxAgeDays: 7,
      maxAttempts: 2,
    },
    stages: [
      S.verify_address, S.verify_pincode, S.verify_phone, S.contact_customer, S.resolution,
    ],
  },

  missing_item: {
    type: 'missing_item',
    handoff: { mode: 'on_create' },
    stages: EVIDENCE_MISSING_WRONG,
  },

  wrong_item: {
    type: 'wrong_item',
    handoff: { mode: 'on_create' },
    stages: EVIDENCE_MISSING_WRONG,   // identical to missing_item
  },

  damaged_item: {
    type: 'damaged_item',
    handoff: { mode: 'on_create' },
    stages: [
      S.verify_photo, S.verify_video, S.identify_quantity, S.file_claim, S.resolution,
    ],
  },

  delivered_not_received: {
    type: 'delivered_not_received',
    handoff: { mode: 'on_create' },
    stages: [
      S.check_tracking, S.contact_customer, S.file_claim, S.resolution,
    ],
  },
}

// ============================================================
//  Helpers — pure functions over the config. No DB calls.
// ============================================================

export function getPipeline(type: ComplaintType): Pipeline {
  return PIPELINES[type]
}

export function getStages(type: ComplaintType): Stage[] {
  return PIPELINES[type].stages
}

export function getStage(type: ComplaintType, key: StageKey): Stage | undefined {
  return PIPELINES[type].stages.find((s) => s.key === key)
}

// The first human stage after handoff (where current_stage starts).
export function firstStage(type: ComplaintType): StageKey {
  return PIPELINES[type].stages[0].key
}

// The next stage after the current one, or null if current is terminal/last.
// current === null means "system still owns it" -> next is the first stage.
export function nextStage(type: ComplaintType, current: StageKey | null): StageKey | null {
  const stages = PIPELINES[type].stages
  if (current === null) return stages[0]?.key ?? null
  const i = stages.findIndex((s) => s.key === current)
  if (i === -1 || i >= stages.length - 1) return null
  return stages[i + 1].key
}

export function isTerminal(type: ComplaintType, key: StageKey): boolean {
  return !!getStage(type, key)?.terminal
}

export function isSkippable(type: ComplaintType, key: StageKey): boolean {
  return !!getStage(type, key)?.skippable
}

// True if this type goes straight to a human on creation (no system window).
export function handsOffOnCreate(type: ComplaintType): boolean {
  return PIPELINES[type].handoff.mode === 'on_create'
}

// Evaluate the conditional handoff for delivery_delayed.
// Returns true when the item should move system -> human.
// attempts: live count from courier feed; orderDate: ISO string from the ticket.
export function shouldHandOff(
  type: ComplaintType,
  opts: { attempts?: number | null; orderDate?: string | null; now?: Date },
): boolean {
  const rule = PIPELINES[type].handoff
  if (rule.mode === 'on_create') return true

  const now = opts.now ?? new Date()
  const attempts = opts.attempts ?? 0
  let ageDays = 0
  if (opts.orderDate) {
    ageDays = Math.floor((now.getTime() - new Date(opts.orderDate).getTime()) / 86_400_000)
  }

  const overAttempts = rule.maxAttempts != null && attempts > rule.maxAttempts
  const overAge = rule.maxAgeDays != null && ageDays > rule.maxAgeDays
  return overAttempts || overAge
}

// Resolution taxonomy (mirrors the complaints.resolution_method enum).
export type ResolutionMethod =
  | 'refund'          // incl. coupon (mode in resolution_notes)
  | 'redispatch'      // incl. fee-charged redispatch (customer fault)
  | 'self_resolved'
  | 'no_resolution'
  | 'duplicate'

export type FaultAttribution = 'customer' | 'courier' | 'none'

// Derived outcome category (NOT stored — computed from resolved_by + status).
export type OutcomeCategory = 'unresolved' | 'auto_resolved' | 'human_resolved'

export function outcomeCategory(args: {
  ticketStatus: string
  resolvedBy: 'system' | 'human' | null
}): OutcomeCategory {
  if (args.ticketStatus !== 'closed') return 'unresolved'
  return args.resolvedBy === 'human' ? 'human_resolved' : 'auto_resolved'
}

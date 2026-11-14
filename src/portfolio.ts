export type Profile = {
  id: number; full_name: string; school: string; grade: string; locality: string;
  interests: string[]; about: string; goals: string; skills: string; links: string[]; revision: number
}

export type Stage = { id: number; name: string }
export type Cycle = { id: number; season: string; starts_on: string | null; ends_on: string | null; stages: Stage[] }
export type Competition = { id: number; name: string; asks_topic: boolean; team_by_default: boolean; cycles: Cycle[] }
export type Catalogue = { categories: { id: number; name: string; competitions: Competition[] }[]; upload_limits: UploadLimits }

export const statuses = {
  draft: 'Чернетка', submitted: 'На перевірці', verified: 'Підтверджено',
  clarify: 'Потребує уточнення', rejected: 'Відхилено',
}
export const resultKinds = { participated: 'Участь', award: 'Нагорода', placement: 'Місце', other: 'Інший результат' }
export const evidenceKinds = {
  '': 'Не зазначено', later: 'Додам пізніше', not_issued: 'Документ не видавався', link: 'Є посилання на результати',
}
export type ReviewStatus = Exclude<keyof typeof statuses, 'draft'>
export const bases = { document: 'Документ', protocol: 'Офіційний протокол', known: 'Особисто відомий результат', other: 'Інша підстава' }
export type ReviewEvent = {
  id: number; actor: string; version: number; action: string; group_id: number | null; group?: string; at: string
  attachment_available?: boolean | null
  details: {
    comment?: string; basis?: keyof typeof bases; filenames?: string[]; removed_documents?: number
    reply?: string; url?: string; filename?: string; replacement?: string; team_member_confirmed?: boolean; link_changed?: boolean
    changes?: Record<string, [string | number | null, string | number | null]>
  }
}
export type GroupReview = {
  group_id: number; group: string; status: ReviewStatus; revision: number; submitted_at: string;
  new_materials: boolean; seen_materials: number; decision?: ReviewEvent | null; can_revoke?: boolean
}
export type Attachment = { id: string; filename: string; size: number; content_type: string; added_revision: number }
export type RecordInput = {
  competition_id: number | null; cycle_id: number | null; stage_id: number | null;
  competition_proposal: string; season_proposal: string; stage_proposal: string; section: string; topic: string;
  starts_on: string | null; ends_on: string | null; academic_year: number | null; school: string; grade: string;
  participation: 'solo' | 'team'; declared_team: string; declared_members: string;
  result_kind: keyof typeof resultKinds; award: string; placement: string; score: string | null; description: string;
  results_url: string; evidence: keyof typeof evidenceKinds; group_ids?: number[];
}
export type RecordSummary = Pick<RecordInput, 'academic_year' | 'participation' | 'result_kind' | 'evidence' | 'competition_id'> & {
  id: string; student: Pick<Profile, 'id' | 'full_name'>; competition_name: string; season: string; stage_name: string;
  status: keyof typeof statuses; has_document: boolean; has_link: boolean; updated_at: string;
  version: number; resubmitted: boolean; category_id: number | null; result_label: string; reviews?: GroupReview[]; has_changes_draft?: boolean;
}
export type Achievement = RecordSummary & RecordInput & {
  revision: number; materials_revision: number; attachments: Attachment[]; duplicate?: boolean;
  changes_draft?: Partial<RecordInput> & { reply: string } | null;
  can_withdraw?: boolean;
  team: { id: string; name: string; result: Record<string, string | null> } | null;
}

export type UploadLimits = { max_bytes: number; count: number }
export type PageInfo = { page: number; pages: number; total: number }
export type RecordPage<T = RecordSummary> = PageInfo & { records: T[]; counts: { unique: number; verified: number; categories: number } }
export type Notification = ReviewEvent & { record_id: string; read: boolean; competition: string }
export const apiQuery = (path: string, params: Record<string, string>) =>
  path + '?' + new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '')).toString()
export const eventDate = (value: string) => new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
export const recordPath = (id: string) => '/api/achievements/' + id + '/'
export const recordTitle = (record: Pick<RecordSummary, 'competition_name'>) => record.competition_name || 'Чернетка без назви'
export const waitingForDocument = (record: RecordSummary) => record.evidence === 'later' && !record.has_document

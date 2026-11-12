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
export type Attachment = { id: string; filename: string; size: number; content_type: string }
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
}
export type Achievement = RecordSummary & RecordInput & {
  revision: number; attachments: Attachment[]; duplicate?: boolean;
  team: { id: string; name: string; result: Record<string, string | null> } | null;
}

export type UploadLimits = { max_bytes: number; count: number }
export const recordPath = (id: string) => '/api/achievements/' + id + '/'
export const recordTitle = (record: Pick<RecordSummary, 'competition_name'>) => record.competition_name || 'Чернетка без назви'
export const waitingForDocument = (record: RecordSummary) => record.evidence === 'later' && !record.has_document

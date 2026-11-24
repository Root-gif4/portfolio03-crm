// API の型（backend/app/schemas.py と同じ形）

export type Role = 'admin' | 'manager' | 'member'
export type ProjectStatus = 'lead' | 'proposal' | 'negotiation' | 'won' | 'lost'
export type TaskStatus = 'todo' | 'doing' | 'done'
export type Priority = 'high' | 'medium' | 'low'
export type Outlook = 'on_track' | 'at_risk'

export interface Ref {
  id: number
  name: string
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  per_page: number
}

export interface Me {
  id: number
  email: string
  name: string
  role: Role
  active: boolean
  last_login_at: string | null
  can_manage_users: boolean
  can_view_audit: boolean
  /** チームの状況（マネージャー・管理者） */
  can_view_team?: boolean
  can_delete: boolean
}

export interface User {
  id: number
  email: string
  name: string
  role: Role
  active: boolean
  last_login_at: string | null
}

export interface Customer {
  id: number
  name: string
  kana: string
  industry: string
  phone: string
  email: string
  address: string
  note: string
  owner: Ref
  version: number
  created_at: string
  updated_at: string
  project_count: number
  open_amount: number
  can_edit: boolean
  can_delete: boolean
}

export interface Project {
  id: number
  name: string
  status: ProjectStatus
  amount: number
  start_date: string
  expected_close_date: string | null
  closed_at: string | null
  description: string
  customer: Ref
  owner: Ref
  version: number
  created_at: string
  updated_at: string
  task_total: number
  task_open: number
  can_edit: boolean
  can_delete: boolean
  can_reopen: boolean
}

export interface Task {
  id: number
  title: string
  status: TaskStatus
  priority: Priority
  start_date: string
  due_date: string | null
  description: string
  completed_at: string | null
  project: Ref
  customer: Ref
  assignee: Ref | null
  version: number
  created_at: string
  updated_at: string
  overdue: boolean
  /** 担当者からの報告 */
  progress: number
  outlook: Outlook | null
  report_note: string
  reported_at: string | null
  can_edit: boolean
  can_delete: boolean
}

export interface AuditLog {
  id: number
  created_at: string
  user: Ref | null
  action: string
  entity_type: string
  entity_id: number | null
  summary: string
  changes: Record<string, [unknown, unknown]>
  ip: string
}

export interface Dashboard {
  today: string
  kpi: {
    customers: number
    open_projects: number
    pipeline_amount: number
    won_this_month: number
    win_rate: number | null
    overdue_tasks: number
    /** all：チーム全体、mine：自分の担当だけ（メンバー） */
    overdue_scope: 'all' | 'mine'
  }
  by_status: { status: ProjectStatus; count: number; amount: number }[]
  monthly_won: { month: string; amount: number }[]
  my_overdue: Task[]
  my_due_soon: Task[]
  closing_soon: { id: number; name: string; amount: number; expected_close_date: string; status: ProjectStatus; customer: string }[]
  recent: { id: number; created_at: string; user: string; action: string; entity_type: string; entity_id: number | null; summary: string }[]
}

export interface ScheduleTask {
  id: number
  title: string
  status: TaskStatus
  priority: Priority
  start_date: string
  due_date: string | null
  assignee: Ref | null
  overdue: boolean
}

export interface ScheduleProject {
  id: number
  name: string
  status: ProjectStatus
  amount: number
  customer: Ref
  owner: Ref
  start_date: string
  expected_close_date: string | null
  tasks: ScheduleTask[]
}

export interface Schedule {
  start: string
  end: string
  today: string
  truncated: boolean
  projects: ScheduleProject[]
}

export interface TeamMember {
  id: number | null
  name: string
  role: Role | ''
  role_label: string
  open: number
  doing: number
  overdue: number
  due_week: number
  at_risk: number
  stale: number
  avg_progress: number
  last_report_at: string | null
}

export interface TeamStatus {
  today: string
  stale_days: number
  members: TeamMember[]
  at_risk: Task[]
  overdue: Task[]
  stale: Task[]
}

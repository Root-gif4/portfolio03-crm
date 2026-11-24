// 顧客・案件・タスクの入力フォーム（ダイアログ）。作成と変更で同じものを使う。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ErrorBox, Field, fieldErrors, Modal, useToast } from '../components/ui'
import { api } from '../lib/api'
import { useMe } from '../lib/auth'
import { PRIORITY, PROJECT_STATUS, PROJECT_STATUS_ORDER, TASK_STATUS, todayJst } from '../lib/format'
import { useUserOptions } from '../lib/hooks'
import type { Customer, Page, Priority, Project, ProjectStatus, Task, TaskStatus } from '../lib/types'

function useSave<T>(onDone: (v: T) => void, keys: string[][]) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ method, url, body }: { method: 'post' | 'put'; url: string; body: unknown }) =>
      method === 'post' ? api.post<T>(url, body) : api.put<T>(url, body),
    onSuccess: (v, vars) => {
      keys.forEach((k) => void qc.invalidateQueries({ queryKey: k }))
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      void qc.invalidateQueries({ queryKey: ['audit'] })
      toast('success', vars.method === 'post' ? '追加しました' : '保存しました')
      onDone(v)
    },
  })
}

function OwnerSelect({ id, value, onChange }: { id: string; value: number; onChange: (v: number) => void }) {
  const me = useMe()
  const { data: users = [] } = useUserOptions()
  const canPick = me.can_delete // マネージャー以上
  return (
    <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={!canPick}>
      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </select>
  )
}

// ---------------------------------------------------------------- 顧客

export function CustomerForm({ open, onClose, customer, onSaved }: { open: boolean; onClose: () => void; customer?: Customer; onSaved?: (c: Customer) => void }) {
  const me = useMe()
  const [v, setV] = useState({
    name: customer?.name ?? '', kana: customer?.kana ?? '', industry: customer?.industry ?? '', phone: customer?.phone ?? '',
    email: customer?.email ?? '', address: customer?.address ?? '', note: customer?.note ?? '', owner_id: customer?.owner.id ?? me.id,
  })
  const save = useSave<Customer>((c) => { onClose(); onSaved?.(c) }, [['customers'], ['customer']])
  const errs = fieldErrors(save.error)
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(customer
      ? { method: 'put', url: `/api/customers/${customer.id}`, body: { ...v, version: customer.version } }
      : { method: 'post', url: '/api/customers', body: v })
  }
  return (
    <Modal open={open} onClose={onClose} title={customer ? '顧客を変更' : '顧客を追加'} wide
      footer={<><button type="button" className="btn" onClick={onClose}>やめる</button>
        <button type="submit" form="customer-form" className="btn btn-primary" disabled={save.isPending}>{customer ? '保存する' : '追加する'}</button></>}>
      <form id="customer-form" onSubmit={submit} className="form-grid">
        {!Object.keys(errs).length && <ErrorBox error={save.error} />}
        <Field label="会社名・屋号" required error={errs.name}>{(id) => <input id={id} value={v.name} onChange={set('name')} maxLength={100} required placeholder="例：株式会社サンプル" />}</Field>
        <Field label="フリガナ" error={errs.kana} hint="一覧の並び順に使います">{(id) => <input id={id} value={v.kana} onChange={set('kana')} maxLength={100} placeholder="例：サンプル" />}</Field>
        <Field label="業種" error={errs.industry}>{(id) => <input id={id} value={v.industry} onChange={set('industry')} maxLength={50} placeholder="例：製造" />}</Field>
        <Field label="担当者" error={errs.owner_id} hint={me.can_delete ? undefined : 'メンバーは自分が担当になります'}>{(id) => <OwnerSelect id={id} value={v.owner_id} onChange={(o) => setV({ ...v, owner_id: o })} />}</Field>
        <Field label="電話番号" error={errs.phone}>{(id) => <input id={id} value={v.phone} onChange={set('phone')} maxLength={20} inputMode="tel" placeholder="03-1234-5678" />}</Field>
        <Field label="メールアドレス" error={errs.email}>{(id) => <input id={id} type="email" value={v.email} onChange={set('email')} maxLength={254} placeholder="info@example.com" />}</Field>
        <div className="span-2"><Field label="住所" error={errs.address}>{(id) => <input id={id} value={v.address} onChange={set('address')} maxLength={200} />}</Field></div>
        <div className="span-2"><Field label="メモ" error={errs.note}>{(id) => <textarea id={id} value={v.note} onChange={set('note')} maxLength={2000} rows={3} />}</Field></div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- 案件

export function ProjectForm({ open, onClose, project, customerId, onSaved }: { open: boolean; onClose: () => void; project?: Project; customerId?: number; onSaved?: (p: Project) => void }) {
  const me = useMe()
  const { data: customers } = useQuery({
    queryKey: ['customers', 'all-options'],
    queryFn: () => api.get<Page<Customer>>('/api/customers', { per_page: 100, sort: 'name' }),
    enabled: open,
  })
  const [v, setV] = useState({
    customer_id: project?.customer.id ?? customerId ?? 0, name: project?.name ?? '', status: project?.status ?? ('lead' as ProjectStatus),
    amount: String(project?.amount ?? ''), start_date: project?.start_date ?? todayJst(), expected_close_date: project?.expected_close_date ?? '', description: project?.description ?? '',
    owner_id: project?.owner.id ?? me.id,
  })
  const save = useSave<Project>((p) => { onClose(); onSaved?.(p) }, [['projects'], ['project'], ['customers'], ['customer']])
  const errs = fieldErrors(save.error)
  const closedLocked = !!project && (project.status === 'won' || project.status === 'lost') && !project.can_reopen
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const amount = Number(v.amount.replace(/[,，円¥\s]/g, '') || 0)
    const body = { ...v, amount, customer_id: Number(v.customer_id), start_date: v.start_date || null, expected_close_date: v.expected_close_date || null }
    save.mutate(project
      ? { method: 'put', url: `/api/projects/${project.id}`, body: { ...body, version: project.version } }
      : { method: 'post', url: '/api/projects', body })
  }
  return (
    <Modal open={open} onClose={onClose} title={project ? '案件を変更' : '案件を追加'} wide
      footer={<><button type="button" className="btn" onClick={onClose}>やめる</button>
        <button type="submit" form="project-form" className="btn btn-primary" disabled={save.isPending}>{project ? '保存する' : '追加する'}</button></>}>
      <form id="project-form" onSubmit={submit} className="form-grid">
        {!Object.keys(errs).length && <ErrorBox error={save.error} />}
        <div className="span-2"><Field label="案件名" required error={errs.name}>{(id) => <input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={100} required placeholder="例：業務システム導入" />}</Field></div>
        <Field label="顧客" required error={errs.customer_id}>{(id) => (
          <select id={id} value={v.customer_id} onChange={(e) => setV({ ...v, customer_id: Number(e.target.value) })} required>
            <option value={0} disabled>選んでください</option>
            {customers?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}</Field>
        <Field label="担当者" error={errs.owner_id}>{(id) => <OwnerSelect id={id} value={v.owner_id} onChange={(o) => setV({ ...v, owner_id: o })} />}</Field>
        <Field label="ステータス" error={errs.status} hint={closedLocked ? '受注・失注を戻せるのはマネージャー以上です' : undefined}>{(id) => (
          <select id={id} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as ProjectStatus })}>
            {PROJECT_STATUS_ORDER.map((s) => (
              <option key={s} value={s} disabled={closedLocked && s !== 'won' && s !== 'lost'}>{PROJECT_STATUS[s]}</option>
            ))}
          </select>
        )}</Field>
        <Field label="見込み金額（円）" error={errs.amount}>{(id) => <input id={id} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} inputMode="numeric" placeholder="例：1200000" />}</Field>
        <Field label="開始日" error={errs.start_date} hint="商談を始めた日">{(id) => <input id={id} type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} />}</Field>
        <Field label="受注予定日" error={errs.expected_close_date}>{(id) => <input id={id} type="date" value={v.expected_close_date} onChange={(e) => setV({ ...v, expected_close_date: e.target.value })} />}</Field>
        <div className="span-2"><Field label="内容・メモ" error={errs.description}>{(id) => <textarea id={id} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={2000} rows={3} />}</Field></div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- タスク

export function TaskForm({ open, onClose, task, projectId, onSaved }: { open: boolean; onClose: () => void; task?: Task; projectId?: number; onSaved?: (t: Task) => void }) {
  const me = useMe()
  const { data: users = [] } = useUserOptions()
  const { data: projects } = useQuery({
    queryKey: ['projects', 'options'],
    queryFn: () => api.get<Page<Project>>('/api/projects', { per_page: 100, status: ['lead', 'proposal', 'negotiation', 'won'] }),
    enabled: open && !projectId && !task,
  })
  const [v, setV] = useState({
    project_id: task?.project.id ?? projectId ?? 0, title: task?.title ?? '', status: task?.status ?? ('todo' as TaskStatus),
    priority: task?.priority ?? ('medium' as Priority), start_date: task?.start_date ?? todayJst(), due_date: task?.due_date ?? '', assignee_id: task?.assignee?.id ?? me.id,
    description: task?.description ?? '',
  })
  const save = useSave<Task>((t) => { onClose(); onSaved?.(t) }, [['tasks'], ['projects'], ['project']])
  const errs = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body = { ...v, project_id: Number(v.project_id), start_date: v.start_date || null, due_date: v.due_date || null, assignee_id: v.assignee_id || null }
    save.mutate(task
      ? { method: 'put', url: `/api/tasks/${task.id}`, body: { ...body, version: task.version } }
      : { method: 'post', url: '/api/tasks', body })
  }
  return (
    <Modal open={open} onClose={onClose} title={task ? 'タスクを変更' : 'タスクを追加'} wide
      footer={<><button type="button" className="btn" onClick={onClose}>やめる</button>
        <button type="submit" form="task-form" className="btn btn-primary" disabled={save.isPending}>{task ? '保存する' : '追加する'}</button></>}>
      <form id="task-form" onSubmit={submit} className="form-grid">
        {!Object.keys(errs).length && <ErrorBox error={save.error} />}
        <div className="span-2"><Field label="やること" required error={errs.title}>{(id) => <input id={id} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={100} required placeholder="例：見積書を送る" />}</Field></div>
        {!projectId && !task && (
          <div className="span-2"><Field label="案件" required error={errs.project_id}>{(id) => (
            <select id={id} value={v.project_id} onChange={(e) => setV({ ...v, project_id: Number(e.target.value) })} required>
              <option value={0} disabled>選んでください</option>
              {projects?.items.map((p) => <option key={p.id} value={p.id}>{p.customer.name}／{p.name}</option>)}
            </select>
          )}</Field></div>
        )}
        <Field label="担当者" error={errs.assignee_id}>{(id) => (
          <select id={id} value={v.assignee_id ?? 0} onChange={(e) => setV({ ...v, assignee_id: Number(e.target.value) })}>
            <option value={0}>（未定）</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}</Field>
        <Field label="開始日" error={errs.start_date} hint="取りかかる（取りかかった）日">{(id) => <input id={id} type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} />}</Field>
        <Field label="期限" error={errs.due_date}>{(id) => <input id={id} type="date" value={v.due_date} min={v.start_date || undefined} onChange={(e) => setV({ ...v, due_date: e.target.value })} />}</Field>
        <Field label="ステータス" error={errs.status}>{(id) => (
          <select id={id} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as TaskStatus })}>
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS[s]}</option>)}
          </select>
        )}</Field>
        <Field label="優先度" error={errs.priority}>{(id) => (
          <select id={id} value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value as Priority })}>
            {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
          </select>
        )}</Field>
        <div className="span-2"><Field label="メモ" error={errs.description}>{(id) => <textarea id={id} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={2000} rows={3} />}</Field></div>
      </form>
    </Modal>
  )
}

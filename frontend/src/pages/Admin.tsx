import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { Icon } from '../components/Icon'
import { Card, ErrorBox, Field, fieldErrors, Loading, Modal, PageHeader, Pagination, useToast } from '../components/ui'
import { api } from '../lib/api'
import { useMe } from '../lib/auth'
import { ACTION, dateTime, ENTITY, ROLE } from '../lib/format'
import { useFilters, useUserOptions } from '../lib/hooks'
import { loadReminder, playChime, REMINDER_DAY_CHOICES, saveReminder, type ReminderSettings } from '../lib/reminder'
import type { AuditLog, Page, Role, User } from '../lib/types'

// ---------------------------------------------------------------- ユーザー（管理者だけ）

export function Users() {
  const me = useMe()
  const [editing, setEditing] = useState<User | 'new' | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/api/users'), enabled: me.can_manage_users })
  if (!me.can_manage_users) return <Navigate to="/" replace />
  return (
    <>
      <PageHeader title="ユーザー" description="ログインできる人と権限です。権限を変えたり使用停止にしたりすると、その人は一度ログアウトされます。"
        actions={<button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Icon name="plus" /> ユーザーを追加</button>} />
      <Card>
        <div className="role-guide">
          <p><strong>管理者</strong>：すべての操作とユーザー管理</p>
          <p><strong>マネージャー</strong>：すべての顧客・案件・タスクの変更と削除、操作履歴</p>
          <p><strong>メンバー</strong>：自分が担当の顧客・案件・タスクの変更（削除はできない）</p>
        </div>
        <ErrorBox error={error} />
        {isLoading ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>名前</th><th>メールアドレス</th><th>権限</th><th>状態</th><th>最後のログイン</th><th aria-label="操作" /></tr></thead>
              <tbody>
                {data?.map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'is-done'}>
                    <td><strong>{u.name}</strong>{u.id === me.id && <span className="muted small">（自分）</span>}</td>
                    <td>{u.email}</td>
                    <td><span className={`badge role-${u.role}`}>{ROLE[u.role]}</span></td>
                    <td>{u.active ? '使用中' : '使用停止'}</td>
                    <td>{dateTime(u.last_login_at)}</td>
                    <td className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(u)}>変更</button>
                      <button type="button" className="btn btn-sm" onClick={() => setResetting(u)}>パスワード再設定</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <UserForm user={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
    </>
  )
}

function UserForm({ user, onClose }: { user?: User; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [v, setV] = useState({ email: user?.email ?? '', name: user?.name ?? '', role: user?.role ?? ('member' as Role), active: user?.active ?? true, password: '' })
  const save = useMutation({
    mutationFn: () => user
      ? api.put<User>(`/api/users/${user.id}`, { name: v.name, role: v.role, active: v.active })
      : api.post<User>('/api/users', { email: v.email, name: v.name, role: v.role, password: v.password }),
    onSuccess: () => {
      toast('success', user ? '保存しました' : 'ユーザーを追加しました')
      void qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
  })
  const errs = fieldErrors(save.error)
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate() }
  return (
    <Modal open title={user ? 'ユーザーを変更' : 'ユーザーを追加'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>やめる</button><button type="submit" form="user-form" className="btn btn-primary" disabled={save.isPending}>{user ? '保存する' : '追加する'}</button></>}>
      <form id="user-form" onSubmit={submit} className="form-stack">
        {!Object.keys(errs).length && <ErrorBox error={save.error} />}
        <Field label="名前" required error={errs.name}>{(id) => <input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={50} required />}</Field>
        <Field label="メールアドレス（ログインに使う）" required error={errs.email}>{(id) => <input id={id} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} disabled={!!user} required maxLength={254} />}</Field>
        <Field label="権限" error={errs.role}>{(id) => (
          <select id={id} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>
            {(Object.keys(ROLE) as Role[]).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
          </select>
        )}</Field>
        {user ? (
          <label className="check"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> 使用中（外すとログインできなくなります）</label>
        ) : (
          <Field label="最初のパスワード" required error={errs.password} hint="10 文字以上で、英字と数字（または記号）を混ぜます。本人に伝え、ログイン後に変えてもらってください。">
            {(id) => <input id={id} type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} required maxLength={128} />}
          </Field>
        )}
      </form>
    </Modal>
  )
}

function ResetPassword({ user, onClose }: { user: User; onClose: () => void }) {
  const toast = useToast()
  const [pw, setPw] = useState('')
  const save = useMutation({
    mutationFn: () => api.post(`/api/users/${user.id}/password`, { new_password: pw }),
    onSuccess: () => { toast('success', `${user.name} さんのパスワードを再設定しました`); onClose() },
  })
  const errs = fieldErrors(save.error)
  return (
    <Modal open title={`${user.name} さんのパスワードを再設定`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>やめる</button><button type="submit" form="reset-form" className="btn btn-primary" disabled={save.isPending}>再設定する</button></>}>
      <form id="reset-form" onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="form-stack">
        {!Object.keys(errs).length && <ErrorBox error={save.error} />}
        <p className="muted">再設定すると、その人のログインはすべて切れます。ロックも解除されます。</p>
        <Field label="新しいパスワード" required error={errs.new_password} hint="10 文字以上、英字と数字（または記号）を混ぜる">
          {(id) => <input id={id} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required maxLength={128} />}
        </Field>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- 操作履歴（マネージャー以上）

export function Audit() {
  const me = useMe()
  const [f, setF] = useFilters({ q: '', user_id: '', action: '', entity_type: '', date_from: '', date_to: '', page: '1' })
  const [open, setOpen] = useState<number | null>(null)
  const { data: users = [] } = useUserOptions()
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', f],
    queryFn: () => api.get<Page<AuditLog>>('/api/audit-logs', { ...f, per_page: 50 }),
    enabled: me.can_view_audit,
    placeholderData: (prev) => prev,
  })
  if (!me.can_view_audit) return <Navigate to="/" replace />
  return (
    <>
      <PageHeader title="操作履歴" description="だれが・いつ・何をしたかの記録です（追加だけで、書き換え・削除はできません）。行を押すと変わった内容が出ます。" />
      <Card>
        <div className="filters">
          <label className="search"><Icon name="search" /><input type="search" placeholder="内容で探す" value={f.q} onChange={(e) => setF({ q: e.target.value })} aria-label="検索" /></label>
          <select value={f.user_id} onChange={(e) => setF({ user_id: e.target.value })} aria-label="操作した人">
            <option value="">操作した人：すべて</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={f.action} onChange={(e) => setF({ action: e.target.value })} aria-label="操作">
            <option value="">操作：すべて</option>
            {Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={f.entity_type} onChange={(e) => setF({ entity_type: e.target.value })} aria-label="対象">
            <option value="">対象：すべて</option>
            {['customer', 'project', 'task', 'user'].map((k) => <option key={k} value={k}>{ENTITY[k]}</option>)}
          </select>
          <input type="date" value={f.date_from} onChange={(e) => setF({ date_from: e.target.value })} aria-label="いつから" />
          <input type="date" value={f.date_to} onChange={(e) => setF({ date_to: e.target.value })} aria-label="いつまで" />
        </div>
        <ErrorBox error={error} />
        {isLoading ? <Loading /> : data && (
          <>
            <div className="table-wrap">
              <table className="table clickable">
                <thead><tr><th>日時</th><th>操作した人</th><th>操作</th><th>内容</th><th>IP</th></tr></thead>
                <tbody>
                  {data.items.map((a) => (
                    <Fragment key={a.id}>
                      <tr onClick={() => setOpen(open === a.id ? null : a.id)}>
                        <td className="nowrap">{dateTime(a.created_at)}</td>
                        <td>{a.user?.name ?? '—'}</td>
                        <td><span className={`badge act-${a.action}`}>{ENTITY[a.entity_type] ?? a.entity_type}の{ACTION[a.action] ?? a.action}</span></td>
                        <td>{a.summary}</td>
                        <td className="muted small">{a.ip}</td>
                      </tr>
                      {open === a.id && Object.keys(a.changes).length > 0 && (
                        <tr className="detail-row"><td colSpan={5}>
                          <table className="table mini"><thead><tr><th>項目</th><th>前</th><th>後</th></tr></thead>
                            <tbody>{Object.entries(a.changes).map(([k, [b, n]]) => <tr key={k}><td>{k}</td><td>{String(b ?? '（空）')}</td><td>{String(n ?? '（空）')}</td></tr>)}</tbody>
                          </table>
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={Number(f.page)} perPage={50} total={data.total} onChange={(p) => setF({ page: String(p) })} />
          </>
        )}
      </Card>
    </>
  )
}

// ---------------------------------------------------------------- 設定（全員）

export function Settings() {
  const me = useMe()
  const toast = useToast()
  const [v, setV] = useState({ current_password: '', new_password: '', confirm: '' })
  const [mismatch, setMismatch] = useState(false)
  const save = useMutation({
    mutationFn: () => api.post('/api/auth/password', { current_password: v.current_password, new_password: v.new_password }),
    onSuccess: () => { toast('success', 'パスワードを変更しました（ほかの端末のログインは切れました）'); setV({ current_password: '', new_password: '', confirm: '' }) },
  })
  const errs = fieldErrors(save.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (v.new_password !== v.confirm) { setMismatch(true); return }
    setMismatch(false)
    save.mutate()
  }
  return (
    <>
      <PageHeader title="設定" description="自分のアカウントの情報・パスワード・期限のお知らせの設定です。画面の明るさは左下のボタンで切り替えられます。" />
      <div className="grid-2">
        <Card title="アカウント">
          <dl className="dl">
            <dt>名前</dt><dd>{me.name}</dd>
            <dt>メールアドレス</dt><dd>{me.email}</dd>
            <dt>権限</dt><dd>{ROLE[me.role]}</dd>
            <dt>最後のログイン</dt><dd>{dateTime(me.last_login_at)}</dd>
          </dl>
        </Card>
        <Card title="パスワードの変更">
          <form onSubmit={submit} className="form-stack">
            {!Object.keys(errs).length && <ErrorBox error={save.error} />}
            <Field label="今のパスワード" required error={errs.current_password}>{(id) => <input id={id} type="password" autoComplete="current-password" value={v.current_password} onChange={(e) => setV({ ...v, current_password: e.target.value })} required maxLength={128} />}</Field>
            <Field label="新しいパスワード" required error={errs.new_password} hint="10 文字以上で、英字と数字（または記号）を混ぜます">{(id) => <input id={id} type="password" autoComplete="new-password" value={v.new_password} onChange={(e) => setV({ ...v, new_password: e.target.value })} required maxLength={128} />}</Field>
            <Field label="新しいパスワード（確認）" required error={mismatch ? '上と同じパスワードを入れてください' : undefined}>{(id) => <input id={id} type="password" autoComplete="new-password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} required maxLength={128} />}</Field>
            <div><button type="submit" className="btn btn-primary" disabled={save.isPending}>変更する</button></div>
          </form>
        </Card>
      </div>
      <ReminderSettingsCard />
    </>
  )
}

function ReminderSettingsCard() {
  const toast = useToast()
  const [r, setR] = useState(loadReminder)
  const update = (patch: Partial<ReminderSettings>) => {
    const next = { ...r, ...patch }
    setR(next)
    saveReminder(next)
    toast('success', '期限のお知らせの設定を保存しました')
  }
  return (
    <Card title="期限のお知らせ">
      <p className="muted small" style={{ marginTop: 0 }}>ログインしたときに、あなたが担当のタスクのうち、期限が過ぎたものと近いものをお知らせします（この PC のこのブラウザに保存します）。</p>
      <div className="form-stack reminder-settings">
        <label className="check"><input type="checkbox" checked={r.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> ログインしたときにお知らせする</label>
        <label className="check">
          期限の
          <select value={r.days} onChange={(e) => update({ days: Number(e.target.value) })} disabled={!r.enabled} aria-label="何日前から知らせるか" className="inline-select">
            {REMINDER_DAY_CHOICES.map((d) => <option key={d} value={d}>{d} 日前</option>)}
          </select>
          から知らせる
        </label>
        <label className="check"><input type="checkbox" checked={r.sound} onChange={(e) => update({ sound: e.target.checked })} disabled={!r.enabled} /> 音を鳴らす</label>
        <div><button type="button" className="btn btn-sm" onClick={playChime}><Icon name="bell" size={16} /> 音を試す</button></div>
      </div>
    </Card>
  )
}

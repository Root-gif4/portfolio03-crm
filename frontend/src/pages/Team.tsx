import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { Icon } from '../components/Icon'
import { LastReport, ProgressView, ReportDialog } from '../components/Report'
import { Card, Empty, ErrorBox, Loading, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { useMe } from '../lib/auth'
import { dateTime, dueLabel, period } from '../lib/format'
import type { Task, TeamMember, TeamStatus } from '../lib/types'

/** チームの状況（マネージャー・管理者）：だれのタスクが遅れていそうか、止まっていないかを確かめる */
export function Team() {
  const me = useMe()
  const { data, isLoading, error } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.get<TeamStatus>('/api/team/status'),
    enabled: !!me.can_view_team,
  })
  if (!me.can_view_team) return <Navigate to="/" replace />

  return (
    <>
      <PageHeader title="チームの状況" description="メンバーごとのタスクの数と、担当者からの報告です。数字を押すとそのタスクの一覧が開きます。" />
      {isLoading && <Loading />}
      <ErrorBox error={error} />
      {data && (
        <>
          <Card title="メンバーごと（未完了のタスク）">
            <div className="table-wrap">
              <table className="table team-table">
                <thead><tr>
                  <th>メンバー</th><th className="num">未完了</th><th className="num">対応中</th><th className="num">期限切れ</th>
                  <th className="num">7 日以内</th><th className="num">遅れそう</th><th className="num">止まっている</th>
                  <th>平均の進み具合</th><th>最後の報告</th>
                </tr></thead>
                <tbody>{data.members.map((m) => <MemberRow key={m.id ?? 'none'} m={m} />)}</tbody>
              </table>
            </div>
            <p className="hint">「止まっている」は、{data.stale_days} 日以上、報告も変更もない未完了のタスクです。</p>
          </Card>

          <div className="grid-2">
            <WatchCard title="遅れそうと報告されたタスク" icon="alert" danger tasks={data.at_risk} today={data.today}
              empty="遅れそうなタスクはありません。" to="/tasks?at_risk=1" />
            <WatchCard title="期限切れのタスク" icon="clock" danger tasks={data.overdue} today={data.today}
              empty="期限切れのタスクはありません。" to="/tasks?overdue=1" />
          </div>
          <WatchCard title={`止まっているタスク（${data.stale_days} 日以上報告なし）`} icon="info" tasks={data.stale} today={data.today}
            empty="止まっているタスクはありません。" to="/tasks?stale=1" />
        </>
      )}
    </>
  )
}

function Count({ n, to, hot }: { n: number; to: string; hot?: boolean }) {
  if (!n) return <span className="zero">0</span>
  return <Link to={to} className={hot ? 'hot' : ''}>{n}</Link>
}

function MemberRow({ m }: { m: TeamMember }) {
  const base = m.id === null ? '/tasks?' : `/tasks?assignee_id=${m.id}&`
  return (
    <tr>
      <td><strong>{m.name}</strong>{m.role_label && <span className="muted small">　{m.role_label}</span>}</td>
      <td className="num"><Count n={m.open} to={base.replace(/[?&]$/, '')} /></td>
      <td className="num"><Count n={m.doing} to={`${base}status=doing`} /></td>
      <td className="num"><Count n={m.overdue} to={`${base}overdue=1`} hot /></td>
      <td className="num">{m.due_week || <span className="zero">0</span>}</td>
      <td className="num"><Count n={m.at_risk} to={`${base}at_risk=1`} hot /></td>
      <td className="num"><Count n={m.stale} to={`${base}stale=1`} /></td>
      <td>{m.open ? (
        <div className="progress-view compact">
          <div className="progress-bar" aria-label={`平均 ${m.avg_progress}%`}><span style={{ width: `${m.avg_progress}%` }} /></div>
          <span className="progress-num">{m.avg_progress}%</span>
        </div>
      ) : <span className="muted small">—</span>}</td>
      <td className="small">{m.last_report_at ? dateTime(m.last_report_at) : <span className="muted">報告なし</span>}</td>
    </tr>
  )
}

function WatchCard({ title, icon, danger, tasks, today, empty, to }: {
  title: string; icon: string; danger?: boolean; tasks: Task[]; today: string; empty: string; to: string
}) {
  const [reporting, setReporting] = useState<Task | null>(null)
  return (
    <Card title={<span className={`card-title-icon ${danger ? 'danger' : ''}`}><Icon name={icon} size={16} /> {title}（{tasks.length}{tasks.length >= 20 ? '+' : ''}）</span>}
      actions={tasks.length > 0 && <Link to={to} className="link">一覧で見る</Link>}>
      {tasks.length ? (
        <ul className="list watch-list">
          {tasks.map((t) => (
            <li key={t.id}>
              <div className="list-main">
                <Link to={`/projects/${t.project.id}`}><strong>{t.title}</strong></Link>
                <span className="muted small">{t.assignee?.name ?? '（担当者なし）'}・{t.customer.name}／{t.project.name}・{period(t.start_date, t.due_date)}</span>
                <ProgressView task={t} compact />
                <LastReport task={t} />
              </div>
              <div className="reminder-side">
                <span className={`due ${t.overdue ? 'due-over' : ''}`}>{dueLabel(t.due_date, today)}</span>
                {t.can_edit && <button type="button" className="btn btn-sm" onClick={() => setReporting(t)}>報告・見通し</button>}
              </div>
            </li>
          ))}
        </ul>
      ) : <Empty icon="check" title={empty} />}
      {reporting && <ReportDialog task={reporting} onClose={() => setReporting(null)} />}
    </Card>
  )
}

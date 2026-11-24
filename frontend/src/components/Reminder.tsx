import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../lib/api'
import { useMe } from '../lib/auth'
import { addDays, dueLabel, period, todayJst } from '../lib/format'
import { loadReminder, playChime, SHOWN_KEY } from '../lib/reminder'
import type { Page, Task } from '../lib/types'
import { Icon } from './Icon'
import { OutlookBadge, useReport } from './Report'
import { Modal, PriorityBadge } from './ui'

/** ログインしたとき（このタブで最初の 1 回）に、期限が近い・過ぎた自分のタスクを知らせる */
export function DeadlineReminder() {
  const me = useMe()
  const navigate = useNavigate()
  const [settings] = useState(loadReminder)
  const [due] = useState(() => !!settings.enabled && sessionStorage.getItem(SHOWN_KEY) !== String(me.id))
  const [open, setOpen] = useState(false)
  const handled = useRef(false) // 報告のあとに読み直しても、もう一度開いたり鳴らしたりしない
  const today = todayJst()
  const { data } = useQuery({
    queryKey: ['tasks', 'reminder', me.id, settings.days],
    queryFn: () => api.get<Page<Task>>('/api/tasks', {
      mine: true, status: ['todo', 'doing'], due_to: addDays(today, settings.days), sort: 'due_date', per_page: 50,
    }),
    enabled: due,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!due || !data || handled.current) return
    handled.current = true
    sessionStorage.setItem(SHOWN_KEY, String(me.id))
    if (data.items.length) {
      setOpen(true)
      if (settings.sound) playChime()
    }
  }, [due, data, me.id, settings.sound])

  if (!open || !data) return null
  const overdue = data.items.filter((t) => t.overdue)
  const soon = data.items.filter((t) => !t.overdue)
  const close = () => setOpen(false)

  return (
    <Modal open title="期限のお知らせ" onClose={close} wide
      footer={<>
        <button type="button" className="btn" onClick={close}>確認しました</button>
        <button type="button" className="btn btn-primary" onClick={() => { close(); navigate('/tasks?mine=1') }}>自分のタスクを開く</button>
      </>}>
      <div className="reminder">
        <p className="reminder-lead"><Icon name="bell" /> {me.name} さんの担当で、期限が過ぎた・{settings.days} 日以内に来るタスクが <strong>{data.total} 件</strong> あります。</p>
        {overdue.length > 0 && <ReminderList title={`期限切れ（${overdue.length}）`} tasks={overdue} today={today} danger onPick={close} />}
        {soon.length > 0 && <ReminderList title={`${settings.days} 日以内（${soon.length}）`} tasks={soon} today={today} onPick={close} />}
        <p className="muted small">それぞれ「予定どおり」か「遅れそう」を押すと、マネージャーに見通しが伝わります（「チームの状況」に出ます）。お知らせの日数や音は「設定」で変えられます。</p>
      </div>
    </Modal>
  )
}

function ReminderList({ title, tasks, today, danger, onPick }: { title: string; tasks: Task[]; today: string; danger?: boolean; onPick: () => void }) {
  // 押したあとの状態（版も新しくなるので、続けて押せるようにする）
  const [done, setDone] = useState<Record<number, Task>>({})
  const report = useReport((t) => setDone((d) => ({ ...d, [t.id]: t })))
  return (
    <>
      <h3 className={`sub ${danger ? 'danger' : ''}`}><Icon name={danger ? 'alert' : 'clock'} size={16} /> {title}</h3>
      <ul className="list">
        {tasks.map((t) => (
          <li key={t.id}>
            <Link to={`/projects/${t.project.id}`} className="list-main" onClick={onPick}>
              <strong>{t.title}</strong>
              <span className="muted small">{t.customer.name}／{t.project.name}　{period(t.start_date, t.due_date)}</span>
            </Link>
            <div className="reminder-side">
              <div className="right">
                {t.priority === 'high' && <PriorityBadge priority="high" />}
                <span className={`due ${t.overdue ? 'due-over' : ''}`}>{dueLabel(t.due_date, today)}</span>
              </div>
              {t.can_edit && (() => {
                const cur = done[t.id] ?? t
                return (
                  <div className="outlook-buttons" role="group" aria-label={`「${t.title}」の見通し`}>
                    {done[t.id] && cur.outlook && <OutlookBadge outlook={cur.outlook} />}
                    <button type="button" className={`btn btn-sm ok ${cur.outlook === 'on_track' ? 'on' : ''}`} disabled={report.isPending}
                      onClick={() => report.mutate({ t: cur, body: { outlook: 'on_track', note: cur.report_note } })}>予定どおり</button>
                    <button type="button" className={`btn btn-sm risk ${cur.outlook === 'at_risk' ? 'on' : ''}`} disabled={report.isPending}
                      onClick={() => report.mutate({ t: cur, body: { outlook: 'at_risk', note: cur.report_note } })}>遅れそう</button>
                  </div>
                )
              })()}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

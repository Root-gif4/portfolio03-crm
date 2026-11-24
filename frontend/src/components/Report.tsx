// 担当者からの報告（進み具合・見通し・ひとこと）の部品

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { dateTime, OUTLOOK } from '../lib/format'
import type { Outlook, Task } from '../lib/types'
import { Icon } from './Icon'
import { ErrorBox, Field, fieldErrors, Modal, useToast } from './ui'

/** 報告を送る。成功したら一覧・ダッシュボード・チームの状況・履歴を読み直す */
export function useReport(onDone?: (t: Task) => void) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ t, body }: { t: Task; body: { progress?: number; outlook?: Outlook; note?: string } }) =>
      api.patch<Task>(`/api/tasks/${t.id}/report`, { ...body, version: t.version }),
    onSuccess: (t) => {
      for (const k of ['tasks', 'project', 'projects', 'dashboard', 'team', 'audit', 'schedule']) void qc.invalidateQueries({ queryKey: [k] })
      toast('success', `「${t.title}」の進み具合を報告しました`)
      onDone?.(t)
    },
    onError: (e) => toast('error', e.message),
  })
}

/** 進み具合の棒と、見通しのしるし */
export function ProgressView({ task, compact }: { task: Task; compact?: boolean }) {
  const p = task.progress
  return (
    <div className={`progress-view ${compact ? 'compact' : ''}`}>
      <div className="progress-bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={`進み具合 ${p}%`}>
        <span style={{ width: `${p}%` }} className={task.outlook === 'at_risk' ? 'risk' : task.status === 'done' ? 'done' : ''} />
      </div>
      <span className="progress-num">{p}%</span>
      {task.outlook && task.status !== 'done' && <OutlookBadge outlook={task.outlook} />}
    </div>
  )
}

export function OutlookBadge({ outlook }: { outlook: Outlook }) {
  return <span className={`badge ol-${outlook}`}>{outlook === 'at_risk' ? '⚠ ' : ''}{OUTLOOK[outlook]}</span>
}

/** 最後の報告（ひとこと・日時）を 1 行で */
export function LastReport({ task }: { task: Task }) {
  if (!task.reported_at) return <span className="muted small">まだ報告がありません</span>
  return (
    <span className="muted small last-report" title={task.report_note}>
      {task.report_note ? `「${task.report_note}」` : '報告'}（{dateTime(task.reported_at)}）
    </span>
  )
}

const STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

/** 進み具合を報告するダイアログ */
export function ReportDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const [v, setV] = useState({ progress: task.progress, outlook: (task.outlook ?? 'on_track') as Outlook, note: '' })
  const report = useReport(() => onClose())
  const errs = fieldErrors(report.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    report.mutate({ t: task, body: v })
  }
  return (
    <Modal open title="進み具合を報告" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>やめる</button>
        <button type="submit" form="report-form" className="btn btn-primary" disabled={report.isPending}>報告する</button></>}>
      <form id="report-form" onSubmit={submit} className="form-stack">
        <p className="muted small">「{task.title}」（{task.project.name}）の今の状態を、マネージャーに知らせます。</p>
        {!Object.keys(errs).length && <ErrorBox error={report.error} />}
        <Field label={`進み具合：${v.progress}%`} error={errs.progress}>{(id) => (
          <div className="progress-input">
            <input id={id} type="range" min={0} max={100} step={10} value={v.progress} list="progress-steps"
              onChange={(e) => setV({ ...v, progress: Number(e.target.value) })} />
            <datalist id="progress-steps">{STEPS.map((s) => <option key={s} value={s} />)}</datalist>
            <div className="progress-quick">
              {[0, 20, 50, 80].map((s) => (
                <button key={s} type="button" className={`chip ${v.progress === s ? 'on' : ''}`} onClick={() => setV({ ...v, progress: s })}>{s}%</button>
              ))}
            </div>
          </div>
        )}</Field>
        <fieldset className="outlook-pick">
          <legend>期限までに終わりそうですか？</legend>
          <label className={`outlook-option ok ${v.outlook === 'on_track' ? 'on' : ''}`}>
            <input type="radio" name="outlook" checked={v.outlook === 'on_track'} onChange={() => setV({ ...v, outlook: 'on_track' })} />
            <Icon name="check" size={16} /> 予定どおり
          </label>
          <label className={`outlook-option risk ${v.outlook === 'at_risk' ? 'on' : ''}`}>
            <input type="radio" name="outlook" checked={v.outlook === 'at_risk'} onChange={() => setV({ ...v, outlook: 'at_risk' })} />
            <Icon name="alert" size={16} /> 遅れそう
          </label>
        </fieldset>
        <Field label="ひとこと（任意）" error={errs.note} hint={v.outlook === 'at_risk' ? '遅れそうな理由や、手伝ってほしいことを書くと伝わりやすくなります' : '例：先方の確認待ち。来週には終わる見込み'}>{(id) => (
          <input id={id} value={v.note} maxLength={200} onChange={(e) => setV({ ...v, note: e.target.value })} />
        )}</Field>
        {task.reported_at && <p className="hint">前回の報告：{task.report_note || '（ひとことなし）'}（{dateTime(task.reported_at)}）</p>}
      </form>
    </Modal>
  )
}

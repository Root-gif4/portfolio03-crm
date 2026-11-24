import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../lib/api'
import { PRIORITY, PROJECT_STATUS, TASK_STATUS } from '../lib/format'
import type { Priority, ProjectStatus, TaskStatus } from '../lib/types'
import { Icon } from './Icon'

// ---- ページの見出し

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

// ---- 状態の表示（色と文字の両方で）

export function ProjectBadge({ status }: { status: ProjectStatus }) {
  return <span className={`badge st-${status}`}>{PROJECT_STATUS[status]}</span>
}
export function TaskBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge ts-${status}`}>{TASK_STATUS[status]}</span>
}
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`badge pr-${priority}`}>優先度 {PRIORITY[priority]}</span>
}

// ---- 入力欄

export function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req">必須</span>}
      </label>
      {children(id)}
      {error ? <p className="field-error" role="alert">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  )
}

/** API のエラーを「項目ごとのメッセージ」に分ける */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {}
  const out: Record<string, string> = {}
  for (const er of e.errors) if (er.field) out[er.field] = er.message.replace(/^.+?：/, '')
  if (e.field && !out[e.field]) out[e.field] = e.message
  return out
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null
  const msg = error instanceof Error ? error.message : 'エラーが起きました。'
  return (
    <div className="alert alert-error" role="alert">
      <Icon name="alert" /> <span>{msg}</span>
    </div>
  )
}

// ---- ダイアログ

export function Modal({ title, open, onClose, children, footer, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** 確認（ブラウザの confirm() は使わない） */
export function ConfirmDialog({ open, title, message, confirmLabel, danger, onConfirm, onClose, busy }: {
  open: boolean; title: string; message: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean
}) {
  return (
    <Modal open={open} title={title} onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>やめる</button>
      <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
    </>}>
      <p>{message}</p>
    </Modal>
  )
}

// ---- 一覧

export function Pagination({ page, perPage, total, onChange }: { page: number; perPage: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / perPage))
  const from = total === 0 ? 0 : (page - 1) * perPage + 1
  const to = Math.min(total, page * perPage)
  return (
    <div className="pagination">
      <span className="muted">{total.toLocaleString()} 件中 {from}–{to} 件</span>
      <div>
        <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>前へ</button>
        <span className="page-no">{page} / {pages}</span>
        <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>次へ</button>
      </div>
    </div>
  )
}

export function Empty({ icon = 'info', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <p className="empty-title">{title}</p>
      {children && <div className="muted">{children}</div>}
    </div>
  )
}

export function Loading({ label = '読み込んでいます…' }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" /> {label}</div>
}

// ---- 完了・失敗のお知らせ

interface Toast { id: number; kind: 'success' | 'error'; text: string }
const ToastContext = createContext<(kind: Toast['kind'], text: string) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon name={t.kind === 'success' ? 'check' : 'alert'} /> {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

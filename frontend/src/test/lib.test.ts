import { describe, expect, it, vi } from 'vitest'
import { api, ApiError, toQuery } from '../lib/api'
import { addDays, addMonths, daysFrom, dueLabel, manYen, period, sinceLabel, weekday, yen } from '../lib/format'
import { DEFAULT_REMINDER, loadReminder } from '../lib/reminder'
import { fieldErrors } from '../components/ui'

describe('format', () => {
  it('金額', () => {
    expect(yen(1500000)).toBe('￥1,500,000')
    expect(manYen(38_300_000)).toBe('3,830万円')
    expect(manYen(250_000_000)).toBe('2.5億円')
    expect(manYen(5000)).toBe('5,000円')
  })
  it('期限の表示', () => {
    expect(daysFrom('2026-11-23', '2026-11-20')).toBe(-3)
    expect(dueLabel('2026-11-20', '2026-11-23')).toBe('3日超過')
    expect(dueLabel('2026-11-23', '2026-11-23')).toBe('今日まで')
    expect(dueLabel('2026-11-24', '2026-11-23')).toBe('明日まで')
    expect(dueLabel('2026-12-01', '2026-11-23')).toBe('あと8日')
    expect(dueLabel(null, '2026-11-23')).toBe('期限なし')
  })
  it('開始日と期間の表示・日付の計算', () => {
    expect(sinceLabel('2026-11-20', '2026-11-23')).toBe('開始から4日目')
    expect(sinceLabel('2026-11-23', '2026-11-23')).toBe('今日から開始')
    expect(sinceLabel('2026-11-25', '2026-11-23')).toBe('2日後に開始')
    expect(period('2026-11-05', '2026-12-20')).toBe('11/5 → 12/20')
    expect(period('2026-11-05', null)).toBe('11/5 →')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addMonths('2026-11-01', -11)).toBe('2025-12-01')
    expect(weekday('2026-11-23')).toBe(1)
  })
})

describe('期限のお知らせの設定', () => {
  it('壊れた値・おかしな日数は初めの設定に戻す', () => {
    localStorage.setItem('crm-reminder', '{bad json')
    expect(loadReminder()).toEqual(DEFAULT_REMINDER)
    localStorage.setItem('crm-reminder', JSON.stringify({ enabled: false, days: 999, sound: 'x' }))
    expect(loadReminder()).toEqual({ enabled: false, days: 3, sound: true })
    localStorage.clear()
  })
})

describe('api', () => {
  it('条件を URL にする（空は付けない・配列は繰り返す）', () => {
    expect(toQuery({ q: 'a b', page: 2, empty: '', no: false, status: ['lead', 'won'], none: undefined }))
      .toBe('?q=a+b&page=2&status=lead&status=won')
    expect(toQuery({})).toBe('')
  })

  it('書き換えには CSRF 対策のヘッダーを付け、読むだけなら付けない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api.get('/api/x')
    await api.post('/api/y', { a: 1 })
    expect(fetchMock.mock.calls[0][1].headers['X-Requested-With']).toBeUndefined()
    expect(fetchMock.mock.calls[1][1].headers['X-Requested-With']).toBe('crm-app')
    expect(fetchMock.mock.calls[1][1].credentials).toBe('same-origin')
    vi.unstubAllGlobals()
  })

  it('エラーは ApiError（メッセージと項目）にする', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: '名前：入力してください', field: 'name', errors: [{ field: 'name', message: '名前：入力してください' }] }), { status: 422 })))
    const err = (await api.post('/api/customers', {}).catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(422)
    expect(fieldErrors(err)).toEqual({ name: '入力してください' })
    vi.unstubAllGlobals()
  })

  it('サーバーにつながらないときは分かりやすいメッセージ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const err = (await api.get('/api/x').catch((e: unknown) => e)) as ApiError
    expect(err.message).toContain('サーバーにつながりません')
    vi.unstubAllGlobals()
  })
})

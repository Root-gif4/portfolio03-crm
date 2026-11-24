// 期限のお知らせ（ログインしたときに、期限が近いタスクと期限切れのタスクを知らせる）の設定と音

export interface ReminderSettings {
  enabled: boolean
  /** 期限の何日前から知らせるか */
  days: number
  sound: boolean
}

const KEY = 'crm-reminder'
/** このタブで、だれに知らせ済みか（ログインし直すと消す） */
export const SHOWN_KEY = 'crm-reminded'
export const DEFAULT_REMINDER: ReminderSettings = { enabled: true, days: 3, sound: true }
export const REMINDER_DAY_CHOICES = [1, 2, 3, 5, 7]

export function loadReminder(): ReminderSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ReminderSettings> | null
    if (!v) return DEFAULT_REMINDER
    return {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_REMINDER.enabled,
      days: REMINDER_DAY_CHOICES.includes(Number(v.days)) ? Number(v.days) : DEFAULT_REMINDER.days,
      sound: typeof v.sound === 'boolean' ? v.sound : DEFAULT_REMINDER.sound,
    }
  } catch {
    return DEFAULT_REMINDER
  }
}

export function saveReminder(v: ReminderSettings) {
  localStorage.setItem(KEY, JSON.stringify(v))
}

/** 「ポーン、ポーン」と 2 回鳴らす（音のファイルを使わず、ブラウザの機能で作る） */
export function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    void ctx.resume?.()
    const notes: [number, number][] = [[880, 0], [660, 0.28], [880, 0.7], [660, 0.98]]
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = ctx.currentTime + at
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.55)
    }
    setTimeout(() => void ctx.close(), 2000)
  } catch {
    // 音が出せない環境（音の許可がないなど）では、画面のお知らせだけにする
  }
}

import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'crm-theme'

function current(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/** ライト／ダーク。選んだものはこのブラウザに保存し、次も同じ明るさで開く */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(current)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* 保存できなくても切り替えはする */
    }
    setTheme(next)
  }
  return [theme, toggle]
}

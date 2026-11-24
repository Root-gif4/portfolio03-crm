import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// テストごとに画面を片付ける（vitest の globals を使わないため自分で呼ぶ）
afterEach(() => cleanup())

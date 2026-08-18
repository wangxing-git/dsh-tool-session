import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // client.ts 依赖 DSH Web 宿主注入的运行时（window.__ModuleLoader__ 与 connection rpc），
      // 其纯逻辑已抽到可单测的辅助函数中，此处排除宿主壳。
      exclude: ['src/client.ts'],
      reporter: ['text', 'html'],
    },
  },
})

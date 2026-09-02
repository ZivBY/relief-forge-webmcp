import { sites } from '@openai/sites-vite-plugin'
import vinext from 'vinext'
import { defineConfig } from 'vite'
const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
}

export default defineConfig(async ({ mode }) => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false'
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs'
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry'

  if (mode === 'test') {
    const { default: react } = await import('@vitejs/plugin-react')
    return {
      plugins: [react()],
      test: {
        // Local generated output and isolated Codex worktrees can contain
        // duplicate test files; only the repository source is part of this run.
        exclude: [
          '**/node_modules/**',
          '**/dist/**',
          '**/.vinext/**',
          '**/tmp/**',
          '**/.git/**',
        ],
      },
    }
  }

  const { cloudflare } = await import('@cloudflare/vite-plugin')

  return {
    server: {
      port: 4173,
      strictPort: true,
      open: true,
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  }
})

import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

/**
 * Stamp the built commit into the page, as `<meta name="build-commit">`.
 *
 * "Is my change live?" was answerable only by diffing bundle hashes, and that
 * reads the same whether a deploy never ran, ran and was cancelled, or ran
 * and shipped something else. It cost an afternoon on 2026-10-11: two pushes
 * produced no visible change and the hash alone could not say why.
 *
 * Vercel exports VERCEL_GIT_COMMIT_SHA to the build; anything else — a laptop,
 * a CI runner without it — gets `dev`, which is the honest answer rather than
 * a stale number. Read at BUILD time, so it describes the bundle being served
 * and not whatever the server happens to be running now.
 *
 * In the HTML rather than the JS bundle on purpose: `curl -s <url> | grep
 * build-commit` answers the question without executing anything.
 */
function buildCommitMeta(): Plugin {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'dev'
  return {
    name: 'build-commit-meta',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `  <meta name="build-commit" content="${sha}">\n  </head>`,
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), buildCommitMeta()],
  server: { port: 5174 },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@grocery-app/shared': path.resolve(__dirname, '../../packages/shared/src'),
      'react': path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
    },
  },
})

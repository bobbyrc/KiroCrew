import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { CONTEXT_SINGLETON_DEDUPE } from '../vite.shared'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * The Vite config the story bundle is built with. Deliberately NOT the app's
 * `vite.config.ts` (see `.storybook/main.ts` for why). It carries only the two
 * pieces a component needs to resolve at all — the `@` source alias and the
 * context-carrying singleton dedupe list, imported from the same module the app
 * build reads. Tailwind v4 needs the same Vite plugin as production to compile
 * `src/index.css` utilities for visual review.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(here, '../src'),
      // The edition seam's two virtual modules. The app's vite.config.ts
      // provides them; the Storybook builder does not, so a story that imports
      // either transitively (ChatSidebar, via extensions.ts) fails to resolve.
      // The stock public build resolves both to "nothing" — the base module is
      // a side-effect-only import, the languages module default-exports []. The
      // single stub file satisfies both. Aliased to a real file rather than a
      // `\0`-virtual plugin: that convention never resolved under the Storybook
      // rolldown builder (the build failed on the languages import).
      'virtual:kirocrew-edition-languages': path.resolve(here, 'edition-stub.ts'),
      'virtual:kirocrew-edition': path.resolve(here, 'edition-stub.ts'),
    },
    dedupe: CONTEXT_SINGLETON_DEDUPE,
  },
})

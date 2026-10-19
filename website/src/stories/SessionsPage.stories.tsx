import type { Meta, StoryObj } from '@storybook/react-vite'
import { configureStore } from '@reduxjs/toolkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import dashboardReducer, { sseSlots, markSlotUnread } from '../store/dashboardSlice'
import chatReducer from '../store/chatSlice'
import notificationsReducer from '../store/notificationsSlice'
import instancesReducer from '../store/instancesSlice'
import { ThemeProvider } from '../hooks/useTheme'
import { api } from '../api/client'
import SessionsPage from '../pages/SessionsPage'
import type { ChatSlot } from '../types'

// Deterministic clock so the recency buckets (Today / Yesterday / Earlier) are
// stable across runs: pin "now" to a fixed instant and lay the mocked sessions
// out relative to it.
const NOW = new Date('2026-10-19T18:00:00Z').getTime()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function slot(key: string, title: string, tsMs: number, extra: Partial<ChatSlot> = {}): ChatSlot {
  return {
    key,
    title,
    messages: 4,
    running: false,
    agent: 'kirocrew',
    last_ts: ago(tsMs),
    ...extra,
  } as ChatSlot
}

// A realistic spread across several projects / GitHub repos, so the Project
// grouping has something to show. `project` is the active directory the session
// is scoped to; a couple also carry a linked PR repo to exercise that fallback.
const SLOTS: ChatSlot[] = [
  slot('chat-1', 'Add session grouping toggle', 2 * MIN, { project: '/Users/me/code/KiroCrew', workspace: 'default' }),
  slot('chat-2', 'Fix pin order regression', 40 * MIN, { project: '/Users/me/code/KiroCrew', workspace: 'default' }),
  slot('chat-3', 'Stream worktree isolation', 3 * HOUR, { project: '/Users/me/code/furnace', workspace: 'furnace' }),
  slot('chat-4', 'Bufferbloat alert tuning', 26 * HOUR, { project: '/Users/me/code/pingpong', workspace: 'default' }),
  slot('chat-5', 'Bulk unfollow flow', 27 * HOUR, { project: '/Users/me/code/thunderclap', workspace: 'default' }),
  slot('chat-6', 'Keepalived VRRP review', 5 * DAY, { project: '/Users/me/code/homelab-ansible', workspace: 'default' }),
  slot('chat-7', 'Triage dup issues', 6 * DAY, {
    workspace: 'default',
    source_links: [{ provider: 'github', number: 42, url: 'https://github.com/kirodotdev/KiroCrew/pull/42', repo: 'kirodotdev/KiroCrew' }],
  }),
  slot('chat-8', 'Quick scratch note', 20 * MIN, { workspace: 'default' }),
]

const meta: Meta<typeof SessionsPage> = {
  title: 'Pages/SessionsPage',
  component: SessionsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    Story => {
      // The page reads the status-tag vocabulary through the api client; stub it
      // so the story never hits the network and the chip row stays deterministic.
      ;(api as unknown as { chatTags: () => Promise<unknown[]> }).chatTags = () => Promise.resolve([])
      const store = configureStore({
        reducer: {
          dashboard: dashboardReducer,
          chat: chatReducer,
          notifications: notificationsReducer,
          instances: instancesReducer,
        },
      })
      // Seed the mocked sessions through the normal SSE action, then mark two
      // unread — the same path the live dashboard uses, so no preloadedState
      // generics wrangling and no reach into slice internals.
      store.dispatch(sseSlots(SLOTS))
      store.dispatch(markSlotUnread('chat-2'))
      store.dispatch(markSlotUnread('chat-5'))
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      return (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>
            <ThemeProvider>
              <MemoryRouter initialEntries={['/sessions']}>
                <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
                  <Story />
                </div>
              </MemoryRouter>
            </ThemeProvider>
          </Provider>
        </QueryClientProvider>
      )
    },
  ],
}
export default meta

type Story = StoryObj<typeof SessionsPage>

/** The page as it ships: rows folded by recency (Today / Yesterday / Earlier),
 *  with the new per-row location chip visible on each row. */
export const GroupedByRecency: Story = {}

/** The page with the Group-by control switched to Project — the new behaviour,
 *  folding the same sessions by their project / GitHub repo. Driven from the
 *  story so a screenshot captures it without a click. */
export const GroupedByProject: Story = {
  play: async ({ canvasElement }) => {
    const btn = canvasElement.querySelector<HTMLButtonElement>('[data-testid="sessions-groupby-project"]')
    btn?.click()
  },
}

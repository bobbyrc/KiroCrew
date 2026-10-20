import type { Meta, StoryObj } from '@storybook/react-vite'
import { configureStore } from '@reduxjs/toolkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import dashboardReducer, { sseSlots } from '../store/dashboardSlice'
import chatReducer from '../store/chatSlice'
import notificationsReducer from '../store/notificationsSlice'
import instancesReducer from '../store/instancesSlice'
import { ThemeProvider } from '../hooks/useTheme'
import { api } from '../api/client'
import ChatSidebar from '../pages/ChatSidebar'
import type { ChatSidebarProps } from '../pages/ChatSidebar'
import type { ChatSlot } from '../types'

const NOW = new Date('2026-10-19T18:00:00Z').getTime()
const ago = (min: number) => NOW - min * 60_000

function slot(key: string, title: string, min: number, workspace: string | undefined, extra: Partial<ChatSlot> = {}): ChatSlot {
  return {
    key, title, running: false, messages: 4, agent: 'kirocrew',
    last_ts: new Date(ago(min)).toISOString(), workspace, ...extra,
  } as ChatSlot
}

// Sessions across three workspaces plus two unfiled, so the workspace lane shows
// several buckets and the "No workspace" bucket last. Each also carries a project
// dir (or a linked repo) so the project lane groups them: the KiroCrew workspace
// sessions sit in two different project checkouts, one session has only a linked
// repo (the basename fallback), and the two unfiled sessions have no project.
const SLOTS: ChatSlot[] = [
  slot('chat-1', 'Add session grouping toggle', 2, 'KiroCrew', { project: '/Users/me/code/KiroCrew' }),
  slot('chat-2', 'Fix pin order regression', 40, 'KiroCrew', { project: '/Users/me/code/KiroCrew' }),
  slot('chat-3', 'Stream worktree isolation', 180, 'furnace', { project: '/Users/me/code/furnace' }),
  slot('chat-4', 'Bufferbloat alert tuning', 1500, 'furnace', { project: '/Users/me/code/pingpong' }),
  slot('chat-5', 'Keepalived VRRP review', 7000, 'homelab', { project: '/Users/me/code/homelab-ansible' }),
  slot('chat-6', 'Quick scratch note', 20, undefined),
  slot('chat-7', 'Triage dup issues', 9000, undefined, {
    source_links: [{ provider: 'github', number: 42, url: 'https://github.com/kirodotdev/KiroCrew/issues/42', repo: 'kirodotdev/KiroCrew', kind: 'issue' }],
  } as Partial<ChatSlot>),
]

const meta: Meta<typeof ChatSidebar> = {
  title: 'Pages/ChatSidebar',
  component: ChatSidebar,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story, ctx) => {
      ;(api as unknown as { chatTags: () => Promise<unknown[]> }).chatTags = () => Promise.resolve([])
      // The sidebar fetches folders, tag columns and config on mount; in
      // Storybook there is no backend, so stub them to the empty public-build
      // shape rather than let each query 404 into an error card.
      const apiStub = api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
      apiStub.chatFolders = () => Promise.resolve([])
      apiStub.tagColumns = () => Promise.resolve([])
      apiStub.kirocrewConfig = () => Promise.resolve({})
      // Preset the lane the story wants BEFORE the sidebar mounts (readStoredLane
      // runs at mount).
      const lane = (ctx.parameters.lane as string) ?? 'tree'
      localStorage.setItem('mc-sidebar-lane', lane)
      localStorage.setItem('mc-session-stale-collapse-ms', '0')
      const store = configureStore({
        reducer: { dashboard: dashboardReducer, chat: chatReducer, notifications: notificationsReducer, instances: instancesReducer },
      })
      store.dispatch(sseSlots(SLOTS))
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      queryClient.setQueryData(['chat-folders'], [])
      queryClient.setQueryData(['tag-columns'], [])
      return (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>
            <ThemeProvider>
              <MemoryRouter>
                <div style={{ width: 300, height: '100vh', display: 'flex', flexDirection: 'column' }}>
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

type Story = StoryObj<typeof ChatSidebar>
const args: ChatSidebarProps = {
  slots: SLOTS as unknown as ChatSidebarProps['slots'], activeSlot: null, unreadSlots: [],
  history: [], historyHasMore: false, defaultAgent: '', installedAgents: [],
}

/** The default folder/recency sidebar. */
export const FolderView: Story = { args, parameters: { lane: 'tree' } }

/** The new workspace lane: sessions grouped by their Kiro Crew workspace. */
export const WorkspaceView: Story = { args, parameters: { lane: 'workspace' } }

/** The new project lane: sessions grouped by their active project (directory
 *  basename, or a linked repo), "No project" last. */
export const ProjectView: Story = { args, parameters: { lane: 'project' } }

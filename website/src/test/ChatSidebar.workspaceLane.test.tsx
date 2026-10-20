/**
 * The workspace lane: sessions exploded out of their folders and grouped by
 * their Kiro Crew workspace, busiest bucket first, "No workspace" last, pinned
 * rows kept in a leading header-less section. These assertions pin the lane's
 * own behaviour; the folder-hide parity (that it drops a hidden row like every
 * other lane) is enumerated in ChatSidebar.laneFolderHideParity.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { createTestStore } from './helpers'
import { ThemeProvider } from '../hooks/useTheme'
import ChatSidebar from '../pages/ChatSidebar'
import type { RootState } from '../store'
import type { ChatSlot } from '../types'

function renderSidebar(slots: ChatSlot[]) {
  const store = createTestStore({
    dashboard: {
      status: {}, connected: true, slots, approvalMode: 'normal',
      channelTrusted: false, refreshTrigger: 0, unreadSlots: [], updateProgress: null,
      slotsLoaded: true,
      subagentRunning: {}, subagentDetails: {}, subagentText: {},
      sessionDefaultColor: null, sessionColorsMode: 'tint', sessionColorsPalette: 'horizon', sessionColorsIntensity: 'clear',
    } as unknown as RootState['dashboard'],
    chat: { activeSlot: null, slotStatusDetail: {}, subagents: {}, slotActivity: {}, workflowRuns: {} } as unknown as RootState['chat'],
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false }, mutations: { retry: false } } })
  qc.setQueryData(['chat-folders'], [])
  qc.setQueryData(['tag-columns'], [])
  return render(
    <QueryClientProvider client={qc}>
      <Provider store={store}>
        <ThemeProvider>
          <MemoryRouter>
            <ChatSidebar slots={slots} activeSlot={null} unreadSlots={[]} history={[]} historyHasMore={false} defaultAgent="" installedAgents={[]} />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>
    </QueryClientProvider>,
  )
}

const slot = (key: string, title: string, modified: number, extra: Partial<ChatSlot> = {}): ChatSlot =>
  ({ key, title, running: false, messages: 2, modified, ...extra } as unknown as ChatSlot)

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mc-session-stale-collapse-ms', '0')
  localStorage.setItem('mc-sidebar-lane', 'workspace')
})
afterEach(() => vi.clearAllMocks())

describe('workspace lane', () => {
  it('renders a header per workspace, busiest first, "No workspace" last', () => {
    const slots = [
      slot('a1', 'Alpha one', 5000, { workspace: 'alpha' }),
      slot('a2', 'Alpha two', 4000, { workspace: 'alpha' }),
      slot('b1', 'Beta one', 3000, { workspace: 'beta' }),
      slot('n1', 'No workspace one', 2000),
    ]
    const { getAllByTestId, getByTestId } = renderSidebar(slots)
    const lane = getByTestId('workspace-view-lane')
    const headers = getAllByTestId('workspace-segment-header').map(h => h.textContent)
    // alpha (2) before beta (1), unassigned bucket last.
    expect(headers).toEqual(['alpha', 'beta', 'No workspace'])
    // The lane really is the workspace lane and shows every session.
    expect(within(lane).getByText('Alpha one')).toBeTruthy()
    expect(within(lane).getByText('No workspace one')).toBeTruthy()
  })

  it('keeps the workspace bucket grouping even though "default" is a real bucket', () => {
    const slots = [
      slot('d1', 'Default one', 5000, { workspace: 'default' }),
      slot('x1', 'Other one', 4000, { workspace: 'other' }),
    ]
    const { getAllByTestId } = renderSidebar(slots)
    // Two distinct named workspaces, both headed; "default" is not collapsed
    // into the unassigned bucket.
    const headers = getAllByTestId('workspace-segment-header').map(h => h.textContent)
    expect(headers).toEqual(['default', 'other'])
  })

  it('falls back to the folder tree with only one workspace (no redundant single bucket)', () => {
    const slots = [
      slot('a1', 'One', 5000, { workspace: 'alpha' }),
      slot('a2', 'Two', 4000, { workspace: 'alpha' }),
    ]
    const { queryByTestId } = renderSidebar(slots)
    // One bucket would be the flat list under a redundant header, so renderedLane
    // falls back to the tree lane instead.
    expect(queryByTestId('workspace-view-lane')).toBeNull()
    expect(queryByTestId('tree-view-lane')).toBeTruthy()
  })
})

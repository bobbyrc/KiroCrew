/**
 * The project lane: sessions exploded out of their folders and grouped by their
 * active project, busiest bucket first, "No project" last, pinned rows kept in a
 * leading header-less section. The bucket label is the project directory's
 * folder basename, falling back to a linked repo. These assertions pin the
 * lane's own behaviour; the folder-hide parity (that it drops a hidden row like
 * every other lane) is enumerated in ChatSidebar.laneFolderHideParity.test.tsx.
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

const repoLink = (repo: string) =>
  [{ provider: 'github', number: 1, url: `https://github.com/${repo}/pull/1`, repo }] as unknown as ChatSlot['source_links']

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mc-session-stale-collapse-ms', '0')
  localStorage.setItem('mc-sidebar-lane', 'project')
})
afterEach(() => vi.clearAllMocks())

describe('project lane', () => {
  it('groups by the project directory basename, busiest first, "No project" last', () => {
    const slots = [
      slot('a1', 'Alpha one', 5000, { project: '/Users/me/code/KiroCrew' }),
      slot('a2', 'Alpha two', 4000, { project: '/Users/me/code/KiroCrew/' }),
      slot('b1', 'Beta one', 3000, { project: '/Users/me/code/pingpong' }),
      slot('n1', 'No project one', 2000),
    ]
    const { getAllByTestId, getByTestId } = renderSidebar(slots)
    const lane = getByTestId('project-view-lane')
    const headers = getAllByTestId('project-segment-header').map(h => h.textContent)
    // Basename only (trailing separator ignored), KiroCrew (2) before pingpong (1),
    // the unassigned bucket last.
    expect(headers).toEqual(['KiroCrew', 'pingpong', 'No project'])
    expect(within(lane).getByText('Alpha one')).toBeTruthy()
    expect(within(lane).getByText('No project one')).toBeTruthy()
  })

  it('falls back to a linked repo when a session has no project directory', () => {
    const slots = [
      slot('p1', 'Has project', 5000, { project: '/Users/me/code/KiroCrew' }),
      slot('r1', 'Repo only', 4000, { source_links: repoLink('kirodotdev/KiroCrew') }),
    ]
    const { getAllByTestId } = renderSidebar(slots)
    const headers = getAllByTestId('project-segment-header').map(h => h.textContent)
    // The repo-only session buckets under its owner/name; the basename session
    // under KiroCrew. Both have one row, so the alphabetical tiebreak orders them.
    expect(headers).toEqual(['KiroCrew', 'kirodotdev/KiroCrew'])
  })

  it('handles a Windows-shaped project path', () => {
    const slots = [
      slot('w1', 'Win one', 5000, { project: 'C:\\repos\\KiroCrew' }),
      slot('w2', 'Win two', 4000, { project: 'C:\\repos\\KiroCrew' }),
      slot('o1', 'Other', 3000, { project: 'C:\\repos\\other' }),
    ]
    const { getAllByTestId } = renderSidebar(slots)
    const headers = getAllByTestId('project-segment-header').map(h => h.textContent)
    expect(headers).toEqual(['KiroCrew', 'other'])
  })

  it('falls back to the folder tree with only one project (no redundant single bucket)', () => {
    const slots = [
      slot('a1', 'One', 5000, { project: '/Users/me/code/KiroCrew' }),
      slot('a2', 'Two', 4000, { project: '/Users/me/code/KiroCrew' }),
    ]
    const { queryByTestId } = renderSidebar(slots)
    expect(queryByTestId('project-view-lane')).toBeNull()
    expect(queryByTestId('tree-view-lane')).toBeTruthy()
  })
})

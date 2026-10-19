import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, MessagesSquare, FolderGit2 } from 'lucide-react'
import { useAppSelector, useAppDispatch } from '../store'
import { createSlot } from '../store/chatSlice'
import { api } from '../api/client'
import { isChatPageSurface } from '../utils/channelOrigin'
import { timeAgo } from '../utils/timeAgo'
import { lastActivityEpoch, localDaysAgo } from './chat/sessionOrder'
import { pathBasename, stripTrailingSeparators } from '../utils/pathBasename'
import { relativeLuminance } from '../lib/iconContrast'
import { errMessage } from '../utils/thunkError'
import { compareText } from '../i18n/format'
import { safeSetItem } from '../utils/safeStorage'
import { PageHeader, Btn, SearchInput, Badge, EmptyState, FilteredEmpty } from '../components/ui'
import ErrorNotice from '../components/ErrorNotice'
import type { ChatSlot, ChatTag } from '../types'
import { i18nT } from '../i18n/t'

/** Recency bucket a session row sorts into, by LOCAL calendar day. */
export type RecencyGroup = 'today' | 'yesterday' | 'earlier'

/** Bucket a timestamp against local-midnight boundaries, reusing the shared
 *  DST-safe day-index math the sidebar's recency tint and date segments use, so
 *  a row cannot land in a different bucket here than it would in the sidebar. */
export function recencyGroup(tsMs: number, nowMs: number): RecencyGroup {
  const days = localDaysAgo(new Date(nowMs), new Date(tsMs))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return 'earlier'
}

/** Chip filter state: 'all', 'unread', or 'tag:<name>' for a status tag. */
type ChipFilter = 'all' | 'unread' | `tag:${string}`

/** Black or white foreground for an arbitrary hex background, by WCAG luminance. */
function avatarFg(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#000'
  const n = parseInt(m[1], 16)
  return relativeLuminance((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff) > 0.4 ? '#000' : '#fff'
}

/** How rows are bucketed into sections. 'recency' is the original behaviour;
 *  'workspace' folds on the KiroCrew workspace name; 'project' folds on the
 *  session's active project directory (its basename as the label), falling back
 *  to a linked repo and then to an "unassigned" bucket. */
export type GroupMode = 'recency' | 'workspace' | 'project'
export const GROUP_MODES: GroupMode[] = ['recency', 'workspace', 'project']

/** localStorage key for the user's last-chosen grouping mode on /sessions, so
 *  the choice survives a reload (same `mc-` convention as useReadingWidth). */
const GROUP_MODE_LS_KEY = 'mc-sessions-group-mode'

/** Read the persisted mode, defaulting to 'recency' for an unset or junk value. */
function loadGroupMode(): GroupMode {
  const stored = localStorage.getItem(GROUP_MODE_LS_KEY)
  return (GROUP_MODES as string[]).includes(stored ?? '') ? (stored as GroupMode) : 'recency'
}

/** A resolved bucket: a stable `id` (sort/testid key) and a display `label`.
 *  Recency labels are static i18n strings; workspace/project labels are the
 *  live field value, so they are carried on the bucket rather than looked up. */
type Bucket = { id: string; label: string }

/** The group a slot sorts into, for the active mode. Pinned slots always win
 *  their own leading bucket — pinning is a reachability promise
 *  (utils/pinnedSessionOrder.ts), so a parked pinned session must stay findable
 *  above every other section regardless of the fold. */
const PINNED_ID = '__pinned__'
const UNASSIGNED_ID = '__unassigned__'

/** The repo/project label for a slot, or '' when it has neither. Prefers the
 *  active project directory's basename; falls back to a linked PR/issue repo
 *  (owner/name — keep the owner so two repos of the same name stay distinct). */
export function projectLabelFor(s: ChatSlot): string {
  const proj = (s.project ?? '').trim()
  if (proj) {
    const base = pathBasename(stripTrailingSeparators(proj))
    if (base) return base
  }
  const repo = (s.source_links ?? []).map(l => l.repo).find(r => !!r)
  return repo ?? ''
}

/** The short location chip shown on a session row: the project/repo label when
 *  the session has one, otherwise its workspace (when not the default). Returns
 *  '' when there is nothing worth showing, so the chip is omitted entirely. */
export function rowLocationLabel(s: ChatSlot): string {
  const proj = projectLabelFor(s)
  if (proj) return proj
  const ws = (s.workspace ?? '').trim()
  return ws && ws !== 'default' ? ws : ''
}

/**
 * Top-level `/sessions` page: a neutral, bookmarkable session chooser with no
 * session selected. Rows navigate to the full `/chat/<key>` experience; the
 * page renders inside the main dashboard shell, so the nav rail and top bar
 * stay available. Unlike bare `/chat` it never auto-selects or auto-creates a
 * session — that is the point of the page.
 */
export default function SessionsPage() {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const slots = useAppSelector(s => s.dashboard.slots)
  const slotsLoaded = useAppSelector(s => s.dashboard.slotsLoaded)
  const unreadSlots = useAppSelector(s => s.dashboard.unreadSlots)
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<ChipFilter>('all')
  const [mode, setMode] = useState<GroupMode>(loadGroupMode)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const { data: tags = [], error: tagsError } = useQuery<ChatTag[]>({
    queryKey: ['chat-tags'],
    queryFn: () => api.chatTags(),
  })

  // Same visibility rule as the chat sidebar: chat-like surfaces only.
  const visible = useMemo(
    () => slots.filter(s => isChatPageSurface(s.surface ?? s.mode)),
    [slots],
  )
  const unread = useMemo(() => new Set(unreadSlots), [unreadSlots])
  // Badge and filter must count the same population: unreadSlots can hold
  // non-chat-surface and orphaned keys (see filterUnreadKeysBySurface), so the
  // raw store count can exceed the rows the Unread chip reveals.
  const unreadVisible = useMemo(
    () => visible.filter(s => unread.has(s.key)).length,
    [visible, unread],
  )

  // Status-tag chips are offered only for tags actually in use, in vocabulary
  // order, so the chip row never fills with a stale taxonomy. slot.tags holds
  // tag IDs (see ChatSidebar's t.id matching); names are display-only.
  const statusChips = useMemo(() => {
    const inUse = new Set(visible.flatMap(s => s.tags ?? []))
    return tags.filter(t => t.status && inUse.has(t.id)).sort((a, b) => a.order - b.order)
  }, [tags, visible])
  const tagById = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return visible.filter(s => {
      if (chip === 'unread' && !unread.has(s.key)) return false
      if (chip.startsWith('tag:') && !(s.tags ?? []).includes(chip.slice(4))) return false
      if (q && !(s.title ?? s.key).toLowerCase().includes(q)) return false
      return true
    })
  }, [visible, chip, query, unread])

  // Mode-aware bucketing. Every mode floats pinned sessions into a leading
  // `__pinned__` section (a reachability promise), then folds the rest by the
  // active dimension. The result is an ORDERED list of {id,label,slots}: a Map
  // preserves recency's fixed order and gives workspace/project a stable,
  // membership-count-then-name order that does not thrash as activity moves.
  const orderedGroups = useMemo(() => {
    const now = Date.now()
    const pinned: ChatSlot[] = []
    // id -> {label, slots}. Recency seeds its three buckets up front so the
    // order is fixed; dynamic modes grow the map as values appear.
    const buckets = new Map<string, Bucket & { slots: ChatSlot[] }>()
    const ensure = (id: string, label: string) => {
      let b = buckets.get(id)
      if (!b) buckets.set(id, (b = { id, label, slots: [] }))
      return b
    }
    if (mode === 'recency') {
      ensure('today', i18nT('pages.sessionsPage.group_today'))
      ensure('yesterday', i18nT('pages.sessionsPage.group_yesterday'))
      ensure('earlier', i18nT('pages.sessionsPage.group_earlier'))
    }

    for (const s of filtered) {
      if (s.pinned) { pinned.push(s); continue }
      if (mode === 'recency') {
        ensure(recencyGroup(lastActivityEpoch(s) * 1000, now), '').slots.push(s)
      } else if (mode === 'workspace') {
        const ws = (s.workspace ?? '').trim()
        if (ws) ensure(`ws:${ws}`, ws).slots.push(s)
        else ensure(UNASSIGNED_ID, i18nT('pages.sessionsPage.group_no_workspace')).slots.push(s)
      } else {
        const label = projectLabelFor(s)
        if (label) ensure(`proj:${label}`, label).slots.push(s)
        else ensure(UNASSIGNED_ID, i18nT('pages.sessionsPage.group_no_project')).slots.push(s)
      }
    }

    // Each section sorts newest-first internally.
    for (const b of buckets.values()) b.slots.sort((a, c) => lastActivityEpoch(c) - lastActivityEpoch(a))

    const out: (Bucket & { slots: ChatSlot[] })[] = []
    if (pinned.length) {
      // Honor the gateway's manual pin order (pin_rank), as the sidebar does;
      // unranked rows keep recency order after ranked ones.
      pinned.sort((a, c) => (a.pin_rank ?? Infinity) - (c.pin_rank ?? Infinity))
      // Same label the sidebar's pinned filter uses, so the two surfaces agree.
      out.push({ id: PINNED_ID, label: i18nT('pages.chatSidebar.filter_pinned'), slots: pinned })
    }

    const rest = [...buckets.values()].filter(b => b.slots.length > 0)
    if (mode === 'recency') {
      // Fixed chronological order; relabel now (seeded labels were set before
      // a language change could re-run this memo).
      const order = ['today', 'yesterday', 'earlier']
      const label: Record<string, string> = {
        today: i18nT('pages.sessionsPage.group_today'),
        yesterday: i18nT('pages.sessionsPage.group_yesterday'),
        earlier: i18nT('pages.sessionsPage.group_earlier'),
      }
      for (const id of order) {
        const b = rest.find(x => x.id === id)
        if (b) out.push({ ...b, label: label[id] })
      }
    } else {
      // Busiest workspace/project first; ties broken by case-insensitive label.
      // The unassigned bucket always sinks to the bottom.
      rest.sort((a, c) => {
        if (a.id === UNASSIGNED_ID) return 1
        if (c.id === UNASSIGNED_ID) return -1
        return c.slots.length - a.slots.length || compareText(a.label, c.label)
      })
      out.push(...rest)
    }
    return out
  }, [filtered, mode])

  // Persist the grouping choice so it survives a reload (mc- localStorage
  // convention, as useReadingWidth does); safeSetItem swallows a storage
  // failure (private mode, quota) rather than throwing in the click handler.
  const chooseMode = (m: GroupMode) => {
    setMode(m)
    safeSetItem(GROUP_MODE_LS_KEY, m)
  }

  const onNew = async () => {
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const slot = await dispatch(createSlot(undefined)).unwrap()
      if (slot?.key) navigate(`/chat?sid=${encodeURIComponent(slot.key)}`)
    } catch (err) {
      // errMessage, not `err instanceof Error`: unwrap() throws a serialized
      // plain object, and the instanceof idiom renders '[object Object]'
      // (see utils/thunkError.ts).
      const detail = errMessage(err)
      // In-page recovery surface (errors-use-error-notice): the ErrorNotice
      // below the header owns the failed state — the sole report, per the
      // first-principles review (no parallel notification dispatch).
      setCreateError(detail)
    } finally {
      setCreating(false)
    }
  }

  const chipCls = (active: boolean) =>
    `text-[13px] px-3 py-1 rounded-full border transition-colors cursor-pointer ${
      active
        ? 'bg-accent-subtle border-accent text-accent'
        : 'border-border-strong text-muted hover:border-[var(--border-hover)]'
    }`

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden" data-testid="sessions-page">
      <div className="pt-3">
        <PageHeader
          title={i18nT('pages.sessionsPage.page_title')}
          actions={
            <Btn primary onClick={onNew} disabled={creating} data-testid="sessions-new">
              <Plus size={15} strokeWidth={2.5} />
              {i18nT('pages.sessionsPage.new_session')}
            </Btn>
          }
        />
      </div>
      {/* This page holds no draft input, so the agent hand-off loses nothing
          (see ErrorNotice's askAgent contract). Tags failing only degrades the
          chip row; sessions themselves still render from the slots stream. */}
      {(createError || tagsError) && (
        <div className="px-4 md:px-6 pb-2 flex flex-col gap-2">
          <ErrorNotice
            title={i18nT('pages.chatPage.could_not_start_a_new_session')}
            message={createError}
            onDismiss={() => setCreateError(null)}
            askAgent
            testId="sessions-create-error"
          />
          <ErrorNotice
            message={tagsError ? errMessage(tagsError) : null}
            askAgent
            testId="sessions-tags-error"
          />
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap px-4 md:px-6 pb-2">
        <SearchInput
          type="search"
          aria-label={i18nT('pages.sessionsPage.search_placeholder')}
          placeholder={i18nT('pages.sessionsPage.search_placeholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          data-testid="sessions-search"
          className="flex-1 min-w-[180px] max-w-[420px]"
        />
        <div
          className="flex items-center rounded-lg border border-border-strong overflow-hidden shrink-0"
          role="radiogroup"
          aria-label={i18nT('pages.sessionsPage.group_by_label')}
          data-testid="sessions-groupby"
        >
          {GROUP_MODES.map((m, i) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => chooseMode(m)}
              data-testid={`sessions-groupby-${m}`}
              className={`text-[13px] px-3 py-1 cursor-pointer transition-colors ${i > 0 ? 'border-l border-border-strong' : ''} ${
                mode === m ? 'bg-accent-subtle text-accent' : 'text-muted hover:text-text-strong hover:bg-bg-hover'
              }`}
            >
              {i18nT(`pages.sessionsPage.group_by_${m}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap px-4 md:px-6 pb-3">
        <button className={chipCls(chip === 'all')} aria-pressed={chip === 'all'} onClick={() => setChip('all')}>
          {i18nT('pages.sessionsPage.filter_all')}
        </button>
        <button
          className={chipCls(chip === 'unread')}
          aria-pressed={chip === 'unread'}
          onClick={() => setChip(chip === 'unread' ? 'all' : 'unread')}
          data-testid="sessions-chip-unread"
        >
          {i18nT('pages.sessionsPage.filter_unread')}
          {unreadVisible > 0 && <span className="ml-1">{unreadVisible}</span>}
        </button>
        {statusChips.map(t => (
          <button
            key={t.id}
            className={chipCls(chip === `tag:${t.id}`)}
            aria-pressed={chip === `tag:${t.id}`}
            onClick={() => setChip(chip === `tag:${t.id}` ? 'all' : `tag:${t.id}`)}
            data-testid={`sessions-chip-tag-${t.id}`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-8 md:px-6">
        {!slotsLoaded && visible.length === 0 ? (
          // An empty frame before the first SSE slots payload is ambiguous (the
          // store keeps `slotsLoaded` precisely to disambiguate it, as ChatSidebar
          // does), so show skeleton rows rather than flash "No sessions" and a
          // create CTA at a user who actually has sessions still loading.
          <div className="md:px-1 pt-3" data-testid="sessions-loading" aria-hidden="true">
            <div className="md:border md:border-border md:rounded-xl md:overflow-hidden md:bg-bg-elevated/30">
              {[0, 1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className={`flex items-center gap-3 px-4 py-2.5 border-border ${i < 4 ? 'border-b' : 'border-b md:border-b-0'}`}
                >
                  <span className="w-8 h-8 rounded-lg bg-bg-hover shrink-0 animate-pulse" />
                  <span className="flex-1 min-w-0 space-y-1.5">
                    <span className="block h-3 w-40 max-w-[60%] rounded bg-bg-hover animate-pulse" />
                    <span className="block h-2.5 w-24 max-w-[40%] rounded bg-bg-hover animate-pulse" />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare size={40} />}
            title={i18nT('pages.sessionsPage.empty_title')}
            subtitle={i18nT('pages.sessionsPage.empty_subtitle')}
            action={
              <Btn primary onClick={onNew} disabled={creating} data-testid="sessions-empty-new">
                <Plus size={15} strokeWidth={2.5} />
                {i18nT('pages.sessionsPage.new_session')}
              </Btn>
            }
          />
        ) : filtered.length === 0 ? (
          <FilteredEmpty
            // A chip-only zero result has an empty query; echo the active chip's
            // label instead so the message never quotes an empty string.
            query={
              query.trim() ||
              (chip === 'unread'
                ? i18nT('pages.sessionsPage.filter_unread')
                : (tagById.get(chip.slice(4))?.name ?? ''))
            }
            onClear={() => {
              setQuery('')
              setChip('all')
            }}
          />
        ) : (
          orderedGroups.map(g => (
            <section key={g.id} aria-label={g.label}>
              <div className="px-4 md:px-1 pt-3 pb-1.5 text-[11px] uppercase tracking-wider font-semibold text-muted-strong select-none flex items-center gap-1.5">
                <span className="truncate">{g.label}</span>
                <span className="text-muted font-normal normal-case tracking-normal">{g.slots.length}</span>
              </div>
              {/* Full-bleed divider list on phone; thin-bordered rounded card
                  (schedule-table style) on sm+. */}
              <div className="md:border md:border-border md:rounded-xl md:overflow-hidden md:bg-bg-elevated/30">
                {g.slots.map((s, i) => (
                  <button
                    key={s.key}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer hover:bg-bg-hover border-border ${
                      i < g.slots.length - 1 ? 'border-b' : 'border-b md:border-b-0'
                    }`}
                    onClick={() => navigate(`/chat?sid=${encodeURIComponent(s.key)}`)}
                    data-testid={`sessions-row-${s.key}`}
                  >
                    <span
                      className="w-8 h-8 rounded-lg bg-bg-hover text-text-strong text-sm font-semibold flex items-center justify-center shrink-0 uppercase"
                      style={s.color_hex ? { background: s.color_hex, color: avatarFg(s.color_hex) } : undefined}
                    >
                      {(s.agent || s.title || s.key).charAt(0)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] font-medium text-text-strong truncate">
                        {s.title || s.key}
                      </span>
                      <span className="block text-[12px] text-muted truncate">
                        {s.agent}
                        {rowLocationLabel(s) && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-1 align-middle"
                            data-testid={`sessions-location-${s.key}`}
                          >
                            <FolderGit2 size={11} className="lucide-inline shrink-0" aria-hidden="true" />
                            {rowLocationLabel(s)}
                          </span>
                        )}
                        {(s.tags ?? []).map(id => {
                          const t = tagById.get(id)
                          if (!t) return null
                          return (
                            <Badge
                              key={id}
                              variant="muted"
                              className="ml-1.5 text-[12px] py-0"
                              style={{ color: t.color }}
                            >
                              {t.name}
                            </Badge>
                          )
                        })}
                      </span>
                    </span>
                    {unread.has(s.key) && (
                      <span
                        className="w-2.5 h-2.5 rounded-full bg-accent shrink-0"
                        data-testid={`sessions-unread-${s.key}`}
                      >
                        <span className="sr-only">{i18nT('pages.sessionsPage.filter_unread')}</span>
                      </span>
                    )}
                    <span className="text-[11px] text-muted-strong shrink-0">
                      {timeAgo(lastActivityEpoch(s))}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

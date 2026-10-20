/** The short project label a session is grouped and searched by, shared by the
 *  project lane (which buckets rows under it) and the sidebar search (which
 *  matches it), so the two never disagree about what a session's project is
 *  called. */
import { pathBasename, stripTrailingSeparators } from '../../utils/pathBasename'
import type { Slot } from './types'

/** The project a row buckets under: a short label from the session's project
 *  directory (its folder basename), falling back to the first linked repo
 *  (`owner/name`), then '' for the "No project" bucket (which sinks last).
 *  Separator-aware via `pathBasename`, so a Windows gateway's `C:\repo` reads as
 *  `repo` rather than the whole path. */
export function projectBucketOf(s: Slot): string {
  const dir = (s.project ?? '').trim()
  if (dir) {
    const base = pathBasename(stripTrailingSeparators(dir))
    if (base) return base
  }
  const repo = s.source_links?.find(l => (l.repo ?? '').trim() !== '')?.repo
  return (repo ?? '').trim()
}

/** Every project/repo string a search query can match a session on: its project
 *  label (above), its full project path (so a query naming a parent directory
 *  still finds it), and every linked repo. Lower-cased, de-duplicated, empties
 *  dropped. Used by the search predicate's substring test. */
export function projectSearchText(s: Slot): string[] {
  const out = new Set<string>()
  const dir = (s.project ?? '').trim()
  if (dir) {
    out.add(dir.toLowerCase())
    const base = pathBasename(stripTrailingSeparators(dir))
    if (base) out.add(base.toLowerCase())
  }
  for (const link of s.source_links ?? []) {
    const repo = (link.repo ?? '').trim()
    if (repo) out.add(repo.toLowerCase())
  }
  return [...out]
}

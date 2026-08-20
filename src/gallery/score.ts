/**
 * Popularity that decays with age.
 *
 * A raw star count sorts by seniority as much as by quality: whatever went up first collects the
 * stars, sits at the top, and collects more, while something good posted this week is never seen. So
 * the score is stars against age, which lets a new patch overtake an old one — and means the top of
 * the list can change without anybody unstarring anything.
 *
 * The shape is the one news aggregators settled on: a power of the age in the denominator. The
 * gravity decides how fast yesterday stops mattering, and the offset keeps a brand-new entry with one
 * star from dividing by nearly nothing and pinning itself to the top.
 */

const GRAVITY = 1.5
const OFFSET_HOURS = 4

export function popularity(stars: number, ageMs: number): number {
  const ageHours = Math.max(0, ageMs) / 3_600_000
  return stars / Math.pow(ageHours + OFFSET_HOURS, GRAVITY)
}

/** Compares two entries for the popular ordering, highest score first. */
export function byPopularity(
  a: { stars: number; createdAt: number },
  b: { stars: number; createdAt: number },
  now: number,
): number {
  const score = popularity(b.stars, now - b.createdAt) - popularity(a.stars, now - a.createdAt)
  // A stable tiebreak, so equal scores do not shuffle between renders.
  return score !== 0 ? score : b.createdAt - a.createdAt
}

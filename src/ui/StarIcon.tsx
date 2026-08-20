/**
 * A flat star, white.
 *
 * Never yellow: yellow stars belong to shopping reviews, and white keeps the colour grammar intact —
 * white is chrome, the orange marks a destination, and the fluorescent ramp belongs to cascade depth.
 * Filled means starred, outlined means not.
 */
export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M 10 1.6 L 12.6 7.3 L 18.9 8.1 L 14.3 12.4 L 15.5 18.6 L 10 15.5 L 4.5 18.6 L 5.7 12.4 L 1.1 8.1 L 7.4 7.3 Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.6}
      />
    </svg>
  )
}

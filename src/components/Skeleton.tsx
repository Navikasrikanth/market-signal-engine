/**
 * Placeholders shaped like the thing they replace.
 *
 * The point is not that something is loading — it is that nothing moves when
 * the data lands. A spinner in the middle of a page followed by a full layout
 * is two paints and a jump; a block the same height as the card that replaces
 * it is one.
 *
 * Deliberately plain: `aria-hidden`, no text, no invented numbers. A skeleton
 * that renders sample figures teaches a reader to glance at a shape and trust
 * it, which is precisely the habit this product should not build.
 */
export function Bar({
  w = '100%',
  h = 12,
  className,
}: {
  w?: string | number
  h?: number
  className?: string
}) {
  return (
    <div
      className={`skeleton ${className ?? ''}`}
      style={{ width: w, height: h }}
      aria-hidden
    />
  )
}

/** One card's worth of space, matching `EventCard`'s real geometry. */
export function CardSkeleton() {
  return (
    <div className="card p-4" aria-hidden>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Bar w={72} h={16} />
          <Bar w={140} h={10} />
        </div>
        <Bar w={54} h={28} />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Bar w="88%" h={14} />
        <Bar w="62%" h={14} />
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Bar w={110} h={10} />
        <Bar w={90} h={10} />
        <div className="ml-auto">
          <Bar w={96} h={28} />
        </div>
      </div>
    </div>
  )
}

/**
 * A whole page's worth, for the route-level `loading.tsx` files.
 *
 * `rows` matches the default attention budget rather than filling the
 * viewport, so the skeleton makes the same promise the page will keep.
 */
export function PageSkeleton({
  rows = 5,
  hero = false,
}: {
  rows?: number
  hero?: boolean
}) {
  /*
   * A `div`, not a `main`.
   *
   * This is a route-level Suspense fallback, so during a navigation it is in
   * the document at the same time as the page streaming in behind it. As a
   * `<main>` that meant two `main` landmarks on the page at once - invalid for
   * assistive tech, and it broke two browser journeys that address the page by
   * its landmark. The placeholder is not the page's main content; it is the
   * space the main content is about to occupy.
   */
  return (
    <div
      className="mx-auto w-full max-w-3xl px-5 py-10"
      role="status"
      aria-label="Loading"
    >
      <Bar w={280} h={34} />
      <div className="mt-5 flex flex-col gap-2">
        <Bar w={340} h={10} />
        <Bar w="70%" h={14} />
      </div>

      {hero && <Bar h={168} className="mt-5" />}

      <div className="mt-8 flex flex-col gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

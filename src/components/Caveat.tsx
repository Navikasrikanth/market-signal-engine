/**
 * An honest limitation, folded away.
 *
 * The disclaimers on these pages are the product's differentiator — a system
 * that filters someone's attention and will not say what it cannot know is
 * rarer than one that filters well. But they were also four-line paragraphs
 * sitting between the reader and the data, competing with the thing they are
 * about.
 *
 * Demoted, not deleted. A one-line summary the eye can skip, expandable by
 * anyone who wants it. The caveat is still on the page and still one click
 * from anywhere it applies; it simply stops shouting over the numbers.
 *
 * Uses native `<details>`, so it works without JavaScript and stays keyboard
 * accessible for free.
 */
export function Caveat({
  summary,
  children,
}: {
  /** One line. What the limitation IS, not that one exists. */
  summary: string
  children: React.ReactNode
}) {
  return (
    <details className="group mt-3">
      <summary className="cursor-pointer list-none font-mono text-[10px] tracking-wider text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--accent-ink)]">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className="mt-2 border-l border-[color:var(--border-strong)] pl-3 text-xs leading-relaxed text-[color:var(--ink-3)]">
        {children}
      </div>
    </details>
  )
}

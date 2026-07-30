import type { Headline } from "@/lib/headline";

/**
 * One line, under the date.
 *
 * This used to be the big tinted block at the top of Today, and it was the
 * right idea in the wrong place. Now that every row counts down to itself, a
 * large block naming the next thing says the same sentence twice on one screen
 * — and two answers to one question is worse than either alone, because you
 * have to check whether they agree.
 *
 * So the rows carry the answer and this carries the summary: which of them is
 * next, and the cases a row can't cover — a day with nothing on it, or one
 * where the only thing left is a chore, which has no time to count down to.
 */
export function HeadlineLine({ headline }: { headline: Headline }) {
  return (
    <p
      // Named so a test can find this line rather than counting paragraphs
      // from the top — the first count landed on the date above it. Nothing in
      // the app reads it.
      data-summary=""
      className="mb-5 flex items-baseline gap-2 px-1 text-sm"
    >
      {headline.color && (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
          style={{ backgroundColor: headline.color }}
        />
      )}
      <span className="min-w-0">
        <span className="font-semibold">{headline.title}</span>
        {headline.detail && (
          <span className="text-muted"> · {headline.detail}</span>
        )}
      </span>
    </p>
  );
}

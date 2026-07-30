import type { Headline } from "@/lib/headline";
import { tintedBlock } from "@/components/ui";

/**
 * The answer, before the list.
 *
 * Deliberately the largest thing on the screen. Everything under it is a list of
 * equal-weight rows, which is fine for detail and useless for "so what?" — you
 * had to read all of them and do the arithmetic against the clock yourself. One
 * line in large type does that work for you, and the list becomes what it should
 * always have been: the supporting evidence.
 *
 * Coloured by whatever it's about — whose event it is, or the dorm's own colour
 * when it's about chores — so the answer is identifiable before it's read.
 */
export function HeadlineBlock({ headline }: { headline: Headline }) {
  const tinted = headline.color !== null;

  return (
    <section
      className={`mb-6 rounded-2xl px-5 py-4 ${
        tinted ? "" : "border border-dashed border-border"
      }`}
      style={tinted ? tintedBlock(headline.color!, "strong") : undefined}
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted">
        {headline.label}
      </p>
      {/* The display face and a real jump in size. A heading one notch bigger
          than the body text isn't a hierarchy, it's a rounding error. */}
      <p className="mt-1.5 font-display text-[1.6rem] font-semibold leading-[1.15] tracking-tight">
        {headline.title}
      </p>
      {headline.detail && (
        <p className="mt-1.5 text-sm text-muted">{headline.detail}</p>
      )}
    </section>
  );
}

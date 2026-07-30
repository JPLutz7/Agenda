import { chooseTheme } from "@/lib/actions";
import type { Theme } from "@/lib/theme";
import { Monitor, Moon, Sun } from "lucide-react";

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "Auto", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/**
 * Three buttons, one of them already pressed.
 *
 * A segmented control rather than a switch, because there are three answers and
 * the third one matters most: "Auto" is what almost everybody should be on, and
 * a two-state toggle has nowhere to put it — choosing either end silently opts
 * you out of the phone's own night setting forever.
 *
 * Each is its own form posting to a server action, so the whole thing works
 * with no client-side JavaScript at all, and the colours are already correct in
 * the response rather than being repainted after it arrives.
 */
export function ThemePicker({ current }: { current: Theme }) {
  return (
    <div
      role="group"
      aria-label="Colour scheme"
      className="flex gap-1 rounded-lg border border-border bg-surface p-1"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = value === current;
        return (
          <form
            key={value}
            action={chooseTheme.bind(null, value)}
            className="flex-1"
          >
            <button
              type="submit"
              aria-pressed={active}
              className={`flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium transition ${
                active
                  ? "bg-accent text-white"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              {label}
            </button>
          </form>
        );
      })}
    </div>
  );
}

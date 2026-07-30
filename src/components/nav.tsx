"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  CheckCheck,
  ListTodo,
  Settings2,
  Sun,
  type LucideIcon,
} from "lucide-react";

/**
 * The bottom bar. Icons come from lucide rather than being SVG paths typed out
 * here — five hand-drawn glyphs never quite match each other's weight, and
 * these are drawn on the same grid by people who do it for a living.
 */
const TABS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/", label: "Today", Icon: Sun },
  { href: "/calendar", label: "Calendar", Icon: Calendar },
  { href: "/chores", label: "Chores", Icon: CheckCheck },
  { href: "/list", label: "List", Icon: ListTodo },
  { href: "/settings", label: "Setup", Icon: Settings2 },
];

export function Nav() {
  const pathname = usePathname();
  // The sign-in screen stands alone — there's nothing to navigate to yet.
  if (pathname === "/login") return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map(({ href, label, Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`pressable flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                  active ? "text-accent" : "text-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

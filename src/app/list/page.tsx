import Link from "next/link";
import { requireSignedIn } from "@/lib/guard";
import {
  getListItems,
  getNeedsEstimate,
  getPeople,
  getSpentThisMonth,
} from "@/lib/data";
import { addListItem, clearCheckedItems } from "@/lib/actions";
import { hasApiKey, nearbyStores, DEFAULT_POSTAL_CODE } from "@/lib/bestbuy";
import { refreshPricesIfStale } from "@/lib/prices";
import { ActionForm, SubmitButton, fieldClass } from "@/components/forms";
import { Needs } from "@/components/list/needs";
import { Wants } from "@/components/list/wants";
import { money } from "@/components/list/money";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type Tab = "needs" | "wants";

/**
 * Nearest Best Buy to South Bend, looked up once per render and only when a
 * key exists. Failure is silent — it's a nicety, not the point of the page.
 */
async function nearestStoreLabel(): Promise<string | null> {
  if (!hasApiKey()) return null;
  try {
    const [store] = await nearbyStores(DEFAULT_POSTAL_CODE);
    if (!store) return null;
    return `${store.city} (${store.distanceMiles} mi)`;
  } catch {
    return null;
  }
}

export default async function ListPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireSignedIn();
  // Wants go stale on their own schedule; nudge a background refresh.
  refreshPricesIfStale();

  const params = await searchParams;
  const tab: Tab = params.tab === "wants" ? "wants" : "needs";

  const { open, done } = getListItems();
  const people = getPeople();
  const estimate = getNeedsEstimate();
  const spent = getSpentThisMonth();

  const needsOpen = open.filter((i) => i.category !== "want");
  const needsDone = done.filter((i) => i.category !== "want");
  const wantsOpen = open.filter((i) => i.category === "want");
  const wantsDone = done.filter((i) => i.category === "want");

  const store = tab === "wants" ? await nearestStoreLabel() : null;

  const tabClass = (which: Tab) =>
    `flex-1 rounded-md px-2 py-1.5 text-center text-sm font-medium transition-colors ${
      which === tab
        ? "bg-accent text-white"
        : "text-muted hover:text-foreground"
    }`;

  return (
    <>
      <PageHeader
        title="Shopping list"
        subtitle={
          tab === "needs"
            ? "What the apartment is out of."
            : "Things you're saving up for."
        }
      />

      <div className="mb-4 flex rounded-lg border border-border bg-surface p-0.5">
        <Link href="/list" className={tabClass("needs")}>
          Needs {needsOpen.length > 0 ? `(${needsOpen.length})` : ""}
        </Link>
        <Link href="/list?tab=wants" className={tabClass("wants")}>
          Wants {wantsOpen.length > 0 ? `(${wantsOpen.length})` : ""}
        </Link>
      </div>

      <ActionForm action={addListItem} className="mb-5" resetOnSuccess>
        <input type="hidden" name="category" value={tab === "wants" ? "want" : "need"} />
        <div className="flex gap-2">
          <input
            name="text"
            required
            autoComplete="off"
            className={fieldClass}
            placeholder={
              tab === "needs" ? "Paper towels" : 'LG 48" OLED evo B5'
            }
          />
          {people.length > 0 && (
            <select
              name="added_by"
              defaultValue={people[0].id}
              aria-label="Added by"
              className="rounded-lg border border-border bg-surface px-2 text-sm"
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          )}
          <SubmitButton>Add</SubmitButton>
        </div>
        {tab === "wants" && (
          <p className="mt-2 text-xs text-muted">
            Word it the way Best Buy lists it and the price will find itself.
          </p>
        )}
      </ActionForm>

      {tab === "needs" ? (
        <>
          <Needs open={needsOpen} done={needsDone} estimate={estimate} />
          {spent > 0 && (
            <p className="mt-4 px-1 text-xs text-muted">
              Spent on groceries this month: {money(spent)}
            </p>
          )}
          {needsDone.length > 0 && (
            <form action={clearCheckedItems.bind(null, "need")} className="mt-3">
              <SubmitButton variant="danger" className="px-2 py-1">
                Clear the cart
              </SubmitButton>
            </form>
          )}
        </>
      ) : (
        <>
          <Wants
            open={wantsOpen}
            done={wantsDone}
            hasApiKey={hasApiKey()}
            nearestStore={store}
          />
          {wantsDone.length > 0 && (
            <form action={clearCheckedItems.bind(null, "want")} className="mt-3">
              <SubmitButton variant="danger" className="px-2 py-1">
                Clear bought
              </SubmitButton>
            </form>
          )}
        </>
      )}
    </>
  );
}

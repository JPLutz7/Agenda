import "server-only";
import { db } from "./db";
import {
  MissingApiKey,
  fetchProductBySku,
  hasApiKey,
  searchProducts,
} from "./bestbuy";
import { fetchPrice, shopName } from "./scrape";

/**
 * Keeping Want prices current.
 *
 * Two ways, because one shop out of the whole internet publishes a free API:
 *
 * - **Best Buy** (`retailer = 'bestbuy'`). A Want starts as a search — "LG 48
 *   class B5 OLED" — because a model name typed by a person isn't a product.
 *   The first successful check binds it to a real SKU, and every check after
 *   that goes straight to that SKU, so the price can't drift onto a different
 *   television.
 * - **A link** (`retailer = 'link'`). The page the user pasted is fetched and
 *   its published price read out of the markup. No searching and nothing to
 *   bind: the URL *is* the product.
 *
 * Anything else — `retailer` null — is priced by hand and never touched here.
 */

/** Prices don't move minute to minute; six hours is plenty. */
export const PRICE_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

type WantRow = {
  id: number;
  text: string;
  retailer: string | null;
  retailer_query: string | null;
  retailer_sku: string | null;
  retailer_url: string | null;
  price_cents: number | null;
};

export type PriceResult = {
  itemId: number;
  label: string;
  priceCents: number | null;
  error: string | null;
};

/** What a check found, before it's written down. */
type Found = {
  priceCents: number;
  regularPriceCents: number | null;
  name: string | null;
  url: string | null;
  sku: string | null;
};

function recordPrice(itemId: number, priceCents: number, source: string) {
  const previous = db
    .prepare<[number], { price_cents: number }>(
      "SELECT price_cents FROM price_history WHERE item_id = ? ORDER BY recorded_at DESC LIMIT 1",
    )
    .get(itemId);
  // Only log actual movement: a row every six hours saying the same number
  // would bury the changes worth seeing.
  if (previous?.price_cents === priceCents) return;
  db.prepare(
    "INSERT INTO price_history (item_id, price_cents, source) VALUES (?, ?, ?)",
  ).run(itemId, priceCents, source);
}

async function fromBestBuy(item: WantRow): Promise<Found> {
  let product = item.retailer_sku
    ? await fetchProductBySku(item.retailer_sku)
    : null;

  // Not bound yet (or the SKU has gone): resolve it from the search text.
  if (!product && item.retailer_query) {
    const matches = await searchProducts(item.retailer_query, 5);
    product = matches[0] ?? null;
  }
  if (!product) {
    throw new Error(
      "Couldn't find this at Best Buy. Try wording it the way the product " +
        "is listed on their site, or paste a link to it at another shop.",
    );
  }
  return {
    priceCents: product.priceCents,
    regularPriceCents: product.regularPriceCents,
    name: product.name,
    url: product.url,
    sku: product.sku,
  };
}

async function fromLink(item: WantRow): Promise<Found> {
  if (!item.retailer_url) {
    throw new Error("This one has no link to check. Add one, or type the price in.");
  }
  const scraped = await fetchPrice(item.retailer_url);
  return {
    priceCents: scraped.priceCents,
    regularPriceCents: scraped.regularPriceCents,
    // Prefer the shop's own product name, but never end up with nothing.
    name: scraped.name ?? shopName(item.retailer_url),
    url: item.retailer_url,
    sku: null,
  };
}

async function refreshWant(item: WantRow): Promise<PriceResult> {
  try {
    const found =
      item.retailer === "link" ? await fromLink(item) : await fromBestBuy(item);

    db.transaction(() => {
      db.prepare(
        `UPDATE list_items
         SET retailer_sku = ?, retailer_url = ?, retailer_name = ?,
             price_cents = ?, regular_price_cents = ?,
             price_checked_at = datetime('now'), price_error = NULL,
             price_source = ?
         WHERE id = ?`,
      ).run(
        found.sku,
        found.url,
        found.name,
        found.priceCents,
        found.regularPriceCents,
        item.retailer ?? "bestbuy",
        item.id,
      );
      recordPrice(item.id, found.priceCents, item.retailer ?? "bestbuy");
    })();

    return {
      itemId: item.id,
      label: item.text,
      priceCents: found.priceCents,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE list_items
       SET price_checked_at = datetime('now'), price_error = ?
       WHERE id = ?`,
    ).run(message, item.id);
    return { itemId: item.id, label: item.text, priceCents: null, error: message };
  }
}

const SELECT_WANT = `SELECT id, text, retailer, retailer_query, retailer_sku,
                            retailer_url, price_cents
                     FROM list_items`;

/**
 * Which Wants are due a check.
 *
 * Link-priced items are included whether or not a Best Buy key exists — that's
 * rather the point of them, and skipping them for a missing key that has
 * nothing to do with them would be daft.
 */
function wantsToCheck(onlyStale: boolean): WantRow[] {
  const sources = hasApiKey() ? ["bestbuy", "link"] : ["link"];
  const placeholders = sources.map(() => "?").join(",");
  return db
    .prepare<(string | number)[], WantRow>(
      `${SELECT_WANT}
       WHERE category = 'want' AND checked_at IS NULL
         AND retailer IN (${placeholders})
         AND (? = 0
              OR price_checked_at IS NULL
              OR (julianday('now') - julianday(price_checked_at)) * 86400000 > ?)
       ORDER BY id`,
    )
    .all(...sources, onlyStale ? 1 : 0, PRICE_STALE_AFTER_MS) as WantRow[];
}

export async function refreshWantPrices(
  { onlyStale = false }: { onlyStale?: boolean } = {},
): Promise<PriceResult[]> {
  const items = wantsToCheck(onlyStale);
  const results: PriceResult[] = [];
  // Sequential: a handful of items, and it keeps well inside Best Buy's rate
  // limit while being unmistakably gentle on anyone else's server.
  for (const item of items) {
    results.push(await refreshWant(item));
  }
  return results;
}

/** Refresh one item now, surfacing the reason if it fails. */
export async function refreshOneWant(itemId: number): Promise<PriceResult> {
  const item = db
    .prepare<[number], WantRow>(`${SELECT_WANT} WHERE id = ?`)
    .get(itemId);
  if (!item) return { itemId, label: "", priceCents: null, error: "Gone." };

  if (item.retailer === null) {
    // Priced by hand on purpose; nothing to check and nothing to complain
    // about.
    return { itemId, label: item.text, priceCents: item.price_cents, error: null };
  }
  if (item.retailer !== "link" && !hasApiKey()) {
    const missing = new MissingApiKey();
    db.prepare("UPDATE list_items SET price_error = ? WHERE id = ?").run(
      missing.message,
      itemId,
    );
    return { itemId, label: item.text, priceCents: null, error: missing.message };
  }
  return refreshWant(item);
}

let inFlight: Promise<unknown> | null = null;

/** Kick off a background refresh if prices have gone stale. */
export function refreshPricesIfStale(): void {
  if (inFlight) return;
  if (wantsToCheck(true).length === 0) return;
  inFlight = refreshWantPrices({ onlyStale: true })
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
}

import "server-only";
import { db } from "./db";
import {
  MissingApiKey,
  fetchProductBySku,
  hasApiKey,
  searchProducts,
} from "./bestbuy";

/**
 * Keeping Want prices current.
 *
 * A Want starts as a search — "LG 48 class B5 OLED" — because a model name
 * typed by a person isn't a product. The first successful check binds it to a
 * real SKU, and every check after that goes straight to that SKU, so the
 * price can't drift onto a different television.
 */

/** Prices don't move minute to minute; six hours is plenty. */
export const PRICE_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

type WantRow = {
  id: number;
  text: string;
  retailer: string | null;
  retailer_query: string | null;
  retailer_sku: string | null;
  price_cents: number | null;
};

export type PriceResult = {
  itemId: number;
  label: string;
  priceCents: number | null;
  error: string | null;
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

async function refreshWant(item: WantRow): Promise<PriceResult> {
  try {
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
          "is listed on their site.",
      );
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE list_items
         SET retailer_sku = ?, retailer_url = ?, retailer_name = ?,
             price_cents = ?, regular_price_cents = ?,
             price_checked_at = datetime('now'), price_error = NULL,
             price_source = ?
         WHERE id = ?`,
      ).run(
        product.sku,
        product.url,
        product.name,
        product.priceCents,
        product.regularPriceCents,
        item.retailer ?? "bestbuy",
        item.id,
      );
      recordPrice(item.id, product.priceCents, item.retailer ?? "bestbuy");
    })();

    return {
      itemId: item.id,
      label: item.text,
      priceCents: product.priceCents,
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

function wantsToCheck(onlyStale: boolean): WantRow[] {
  return db
    .prepare<[number, number], WantRow>(
      `SELECT id, text, retailer, retailer_query, retailer_sku, price_cents
       FROM list_items
       WHERE category = 'want' AND checked_at IS NULL AND retailer IS NOT NULL
         AND (? = 0
              OR price_checked_at IS NULL
              OR (julianday('now') - julianday(price_checked_at)) * 86400000 > ?)
       ORDER BY id`,
    )
    .all(onlyStale ? 1 : 0, PRICE_STALE_AFTER_MS) as WantRow[];
}

export async function refreshWantPrices(
  { onlyStale = false }: { onlyStale?: boolean } = {},
): Promise<PriceResult[]> {
  if (!hasApiKey()) {
    // Not an error worth recording against every item — the Wants list says
    // plainly that no key is set.
    return [];
  }
  const items = wantsToCheck(onlyStale);
  const results: PriceResult[] = [];
  // Sequential: a handful of items, and it keeps well inside the rate limit.
  for (const item of items) {
    results.push(await refreshWant(item));
  }
  return results;
}

/** Refresh one item now, surfacing the reason if it fails. */
export async function refreshOneWant(itemId: number): Promise<PriceResult> {
  if (!hasApiKey()) {
    const missing = new MissingApiKey();
    db.prepare("UPDATE list_items SET price_error = ? WHERE id = ?").run(
      missing.message,
      itemId,
    );
    return { itemId, label: "", priceCents: null, error: missing.message };
  }
  const item = db
    .prepare<[number], WantRow>(
      `SELECT id, text, retailer, retailer_query, retailer_sku, price_cents
       FROM list_items WHERE id = ?`,
    )
    .get(itemId);
  if (!item) return { itemId, label: "", priceCents: null, error: "Gone." };
  return refreshWant(item);
}

let inFlight: Promise<unknown> | null = null;

/** Kick off a background refresh if prices have gone stale. */
export function refreshPricesIfStale(): void {
  if (inFlight || !hasApiKey()) return;
  if (wantsToCheck(true).length === 0) return;
  inFlight = refreshWantPrices({ onlyStale: true })
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
}

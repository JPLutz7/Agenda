import "server-only";

/**
 * Best Buy's product catalogue, for pricing the Wants list.
 *
 * Needs are priced by remembering what you paid, because no API covers Aldi
 * or Martin's. Wants are single, identifiable products, so a real retailer
 * lookup works — and Best Buy publishes one with near-real-time prices.
 *
 * Requires BESTBUY_API_KEY (free, from developer.bestbuy.com). Without it the
 * app still keeps Wants and any price typed in by hand; it just can't refresh
 * them, and says so rather than showing a stale number as if it were current.
 */

/** Overridable so the price path can be exercised against a stand-in. */
const BASE = process.env.BESTBUY_API_BASE ?? "https://api.bestbuy.com/v1";
const TIMEOUT_MS = 15_000;

/** Best Buy nearest South Bend is in Mishawaka; this is the search origin. */
export const DEFAULT_POSTAL_CODE = "46601";

export type RetailerProduct = {
  sku: string;
  name: string;
  url: string;
  /** Current selling price, in cents. */
  priceCents: number;
  /** List price, when it differs — the basis for "on offer". */
  regularPriceCents: number | null;
};

export type NearbyStore = {
  name: string;
  city: string;
  distanceMiles: number;
};

export function hasApiKey(): boolean {
  return Boolean(process.env.BESTBUY_API_KEY);
}

export class MissingApiKey extends Error {
  constructor() {
    super(
      "No Best Buy API key set, so prices can't be looked up. Add " +
        "BESTBUY_API_KEY to the server — it's free from developer.bestbuy.com.",
    );
    this.name = "MissingApiKey";
  }
}

function toCents(value: unknown): number | null {
  // Prices come back as dollars. Round rather than truncate so 19.99 doesn't
  // become 1998 through float representation.
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

async function request(path: string): Promise<unknown> {
  const key = process.env.BESTBUY_API_KEY;
  if (!key) throw new MissingApiKey();

  const separator = path.includes("?") ? "&" : "?";
  const url = `${BASE}/${path}${separator}format=json&apiKey=${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (response.status === 403) {
    throw new Error(
      "Best Buy rejected the API key. Check it's correct and still active.",
    );
  }
  if (response.status === 429) {
    throw new Error("Best Buy rate limit reached; it'll retry later.");
  }
  if (!response.ok) {
    throw new Error(`Best Buy returned ${response.status}.`);
  }
  return response.json();
}

/** The fields worth asking for; the default response is enormous. */
const SHOW = "sku,name,salePrice,regularPrice,url,onlineAvailability";

function parseProduct(raw: unknown): RetailerProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const price = toCents(p.salePrice);
  if (typeof p.sku === "undefined" || price === null) return null;

  const regular = toCents(p.regularPrice);
  return {
    sku: String(p.sku),
    name: typeof p.name === "string" ? p.name : "Unknown product",
    url: typeof p.url === "string" ? p.url : "",
    priceCents: price,
    // Only meaningful when it's actually higher than what you'd pay.
    regularPriceCents: regular !== null && regular > price ? regular : null,
  };
}

/**
 * Search the catalogue. Each word becomes its own `search=` term, which is how
 * Best Buy's query language ANDs them across name and description.
 */
export async function searchProducts(
  query: string,
  limit = 5,
): Promise<RetailerProduct[]> {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/[^\w.\-]/g, ""))
    .filter(Boolean)
    .slice(0, 10);
  if (terms.length === 0) return [];

  const search = terms.map((t) => `search=${encodeURIComponent(t)}`).join("&");
  const data = (await request(
    `products(${search})?show=${SHOW}&pageSize=${limit}&sort=salePrice.asc`,
  )) as { products?: unknown[] };

  return (data.products ?? [])
    .map(parseProduct)
    .filter((p): p is RetailerProduct => p !== null);
}

export async function fetchProductBySku(
  sku: string,
): Promise<RetailerProduct | null> {
  const clean = sku.replace(/\D/g, "");
  if (!clean) return null;
  const data = await request(`products/${clean}.json?show=${SHOW}`);
  return parseProduct(data);
}

/** Nearest stores to a postal code, for "where would I actually buy this". */
export async function nearbyStores(
  postalCode: string,
  withinMiles = 25,
): Promise<NearbyStore[]> {
  const zip = postalCode.replace(/\D/g, "").slice(0, 5);
  if (zip.length !== 5) return [];
  const data = (await request(
    `stores(area(${zip},${withinMiles}))?show=name,city,distance&pageSize=3&sort=distance.asc`,
  )) as { stores?: unknown[] };

  return (data.stores ?? []).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const s = raw as Record<string, unknown>;
    return [
      {
        name: typeof s.name === "string" ? s.name : "Best Buy",
        city: typeof s.city === "string" ? s.city : "",
        distanceMiles:
          typeof s.distance === "number" ? Math.round(s.distance * 10) / 10 : 0,
      },
    ];
  });
}

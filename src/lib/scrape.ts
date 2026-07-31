import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

/**
 * Reading a price off a product page.
 *
 * Best Buy is the only shop here with a usable free API, and the list is not
 * only Best Buy. Nearly every online shop publishes its price in a
 * machine-readable block inside the page — that's what makes prices show up in
 * Google results — so for everything else the app fetches the page the user
 * pasted and reads that block.
 *
 * The honest limits, stated once here because the UI has to repeat them:
 *
 * - **Some shops refuse.** Amazon, Walmart and Target block requests that
 *   don't come from a real browser. There is no clever fix that is also
 *   honest; those items get a plain error saying to type the price in.
 * - **This reads, it does not crawl.** One page, the one you chose, at most
 *   every six hours.
 * - **A missing price is never guessed.** If the markup isn't there, the item
 *   says so rather than showing something that might be last month's.
 */

const TIMEOUT_MS = 12_000;
/** Enough for any product page; a stream that keeps going is a trap. */
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;

/** A browser UA. Sending Node's default gets refused by most CDNs outright. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type ScrapedPrice = {
  priceCents: number;
  /** The product's own name, when the page states it. */
  name: string | null;
  /** List price when the page publishes one above the selling price. */
  regularPriceCents: number | null;
};

export class BlockedByShop extends Error {
  constructor(host: string) {
    super(
      `${host} blocks automated price checks, so this one can't update by ` +
        `itself. Type the price in instead.`,
    );
    this.name = "BlockedByShop";
  }
}

export class NoPriceOnPage extends Error {
  constructor(host: string) {
    super(
      `Couldn't find a price on that ${host} page. Some shops only show it to ` +
        `a real browser. Type the price in instead.`,
    );
    this.name = "NoPriceOnPage";
  }
}

/* ------------------------------------------------------------- addressing */

/**
 * Anything that resolves inside the network the app is running on.
 *
 * The URL here is typed by a person, and the server will fetch it — which is
 * exactly the shape of request that reaches a cloud provider's metadata
 * service or something else on the private network. Checking the *resolved*
 * address matters: a hostname is free to point at 169.254.169.254.
 */
function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||          // link-local, incl. metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a >= 224                              // multicast and reserved
    );
  }
  if (net.isIPv6(address)) {
    const v = address.toLowerCase();
    if (v === "::1" || v === "::") return true;
    // Unique-local and link-local. fd00::/8 covers Fly's private network.
    if (/^f[cd]/.test(v) || v.startsWith("fe80")) return true;
    // ::ffff:10.0.0.1 and friends — an IPv4 address wearing a hat.
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // not an address we understand: refuse rather than guess
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("That needs to be an http or https link.");
  }
  // The one exception, and only for the host the operator named themselves in
  // AGENDA_SCRAPE_BASE. Without this the stand-in shop used to exercise this
  // path is unreachable, being on localhost — but a URL a *user* types can
  // never reach the private network, which is the point of the check.
  const override = process.env.AGENDA_SCRAPE_BASE;
  if (override && url.host === new URL(override).host) return;

  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("That address isn't reachable.");
    return;
  }
  if (/(^|\.)(localhost|local|internal|localdomain)$/i.test(host)) {
    throw new Error("That address isn't reachable.");
  }

  let resolved: string[];
  try {
    resolved = (await dns.lookup(host, { all: true })).map((r) => r.address);
  } catch {
    throw new Error(`Couldn't find ${host}. Check the link.`);
  }
  if (resolved.length === 0 || resolved.some(isPrivateAddress)) {
    throw new Error("That address isn't reachable.");
  }
}

/** Fetch a page, following redirects by hand so each hop is checked too. */
async function fetchPage(startUrl: string): Promise<{ html: string; host: string }> {
  let current = new URL(startUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(current);

    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`${current.hostname} returned a broken redirect.`);
      current = new URL(location, current);
      continue;
    }

    // The tells for bot protection. 429 is rate limiting, which is the same
    // problem from the user's side: this one won't update by itself.
    if ([401, 403, 405, 429, 503].includes(response.status)) {
      throw new BlockedByShop(current.hostname);
    }
    if (!response.ok) {
      throw new Error(`${current.hostname} returned ${response.status}.`);
    }

    return { html: await readCapped(response), host: current.hostname };
  }
  throw new Error("That link redirects too many times.");
}

/** Read the body but stop at MAX_BYTES rather than trusting the other end. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- parsing */

function toCents(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  }
  if (typeof value !== "string") return null;
  // '$1,299.00' / '1299,00' / 'USD 1299'. Strip everything but digits and
  // separators, then work out which separator is the decimal one.
  let s = value.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) : null;
}

/** USD or nothing. A €-priced page is not a South Bend price. */
function currencyIsUsable(currency: unknown): boolean {
  if (typeof currency !== "string" || currency === "") return true;
  return currency.toUpperCase() === "USD";
}

type Offer = { price: number | null; regular: number | null };

function readOffer(raw: unknown): Offer {
  const empty = { price: null, regular: null };
  if (!raw || typeof raw !== "object") return empty;
  if (Array.isArray(raw)) {
    // Several offers: the one you'd actually pay is the cheapest.
    const found = raw.map(readOffer).filter((o) => o.price !== null);
    if (found.length === 0) return empty;
    return found.reduce((a, b) => ((b.price ?? 0) < (a.price ?? 0) ? b : a));
  }

  const o = raw as Record<string, unknown>;
  if (!currencyIsUsable(o.priceCurrency)) return empty;

  const price =
    toCents(o.price) ??
    toCents(o.lowPrice) ??
    toCents((o.priceSpecification as Record<string, unknown> | undefined)?.price);
  // schema.org has no settled name for "was"; these are the ones in the wild.
  const regular =
    toCents(o.listPrice) ??
    toCents(o.highPrice) ??
    toCents(
      (o.priceSpecification as Record<string, unknown> | undefined)
        ?.strikethroughPrice,
    );
  return { price, regular: regular !== null && price !== null && regular > price ? regular : null };
}

/** Walk JSON-LD, which nests Products inside @graph, arrays, and each other. */
function findProduct(node: unknown, depth = 0): ScrapedPrice | null {
  if (depth > 6 || !node || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProduct(child, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const types = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
  if (types.some((t) => /product|vehicle|book|offer/i.test(t)) && obj.offers) {
    const { price, regular } = readOffer(obj.offers);
    if (price !== null) {
      return {
        priceCents: price,
        regularPriceCents: regular,
        name: typeof obj.name === "string" ? obj.name.trim() : null,
      };
    }
  }

  for (const key of ["@graph", "mainEntity", "itemListElement", "hasVariant"]) {
    const found = findProduct(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function fromJsonLd(html: string): ScrapedPrice | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const [, body] of blocks) {
    try {
      const found = findProduct(JSON.parse(body.trim()));
      if (found) return found;
    } catch {
      // A malformed block is common and not worth failing the whole page over.
    }
  }
  return null;
}

function metaContent(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)=["']${property}["'][^>]*>`,
    "i",
  );
  const tag = html.match(pattern)?.[0];
  return tag?.match(/content=["']([^"']*)["']/i)?.[1] ?? null;
}

/** Open Graph and microdata, for pages with no JSON-LD. */
function fromMeta(html: string): ScrapedPrice | null {
  const price =
    toCents(metaContent(html, "product:price:amount")) ??
    toCents(metaContent(html, "og:price:amount")) ??
    toCents(metaContent(html, "price"));
  if (price === null) return null;

  const currency =
    metaContent(html, "product:price:currency") ??
    metaContent(html, "og:price:currency") ??
    metaContent(html, "priceCurrency");
  if (!currencyIsUsable(currency)) return null;

  const name =
    metaContent(html, "og:title") ??
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ??
    null;
  return { priceCents: price, regularPriceCents: null, name: name || null };
}

/**
 * Amazon, which is a special case because it is the shop people actually use
 * and it publishes none of the above.
 *
 * It serves the real page to a plain request — no bot wall, unlike most of the
 * other big shops — but with no JSON-LD and no price meta tags anywhere. The
 * price lives in its own markup, so this reads that: the block Amazon marks as
 * the buying price, then the screen-reader copy of the number inside it.
 *
 * That is a promise about someone else's HTML, and it will break when they
 * change it. When it does, the item says it couldn't find a price — which is
 * the same thing it says for any other unreadable page, and is a great deal
 * better than showing a number scraped out of the wrong element.
 */
function fromAmazon(html: string): ScrapedPrice | null {
  const start = html.indexOf("corePrice_feature_div");
  if (start < 0) return null;
  // Bounded so a missing price can't wander off into an unrelated block
  // further down the page and find a number there.
  const block = html.slice(start, start + 6000);
  const price = block.match(
    /class="a-offscreen"[^>]*>\s*\$([\d,]+\.\d{2})/,
  )?.[1];
  if (!price) return null;

  const cents = toCents(price);
  if (cents === null) return null;
  const name = html
    .match(/<span[^>]+id="productTitle"[^>]*>([^<]*)</)?.[1]
    ?.trim();
  return { priceCents: cents, regularPriceCents: null, name: name || null };
}

/**
 * The price on a product page, or a clear reason there isn't one.
 *
 * `BESTBUY_API_BASE` has a sibling here on purpose: `AGENDA_SCRAPE_BASE`
 * rewrites the host so the whole path can be exercised against a local page
 * without depending on a real shop being up, or hammering one.
 */
/**
 * The price in a page's markup, or null if it isn't stated in any form we read.
 *
 * Separate from the fetching so it can be tested against saved markup — which
 * is the half that breaks, since it's a set of promises about other people's
 * HTML. `host` decides whether the shop-specific reader is allowed to run.
 */
export function extractPrice(html: string, host: string): ScrapedPrice | null {
  return (
    fromJsonLd(html) ??
    fromMeta(html) ??
    (/(^|\.)amazon\./i.test(host) ? fromAmazon(html) : null)
  );
}

export async function fetchPrice(url: string): Promise<ScrapedPrice> {
  // The shop is whoever the *user* named. Under AGENDA_SCRAPE_BASE the fetched
  // host is a stand-in, and picking a parser by that would test the wrong one.
  const declaredHost = new URL(url).hostname;
  const { html, host } = await fetchPage(rewriteForTesting(url));

  const found = extractPrice(html, declaredHost);
  if (!found) throw new NoPriceOnPage(shopName(url) || host);
  return found;
}

function rewriteForTesting(url: string): string {
  const base = process.env.AGENDA_SCRAPE_BASE;
  if (!base) return url;
  const target = new URL(url);
  const replacement = new URL(base);
  target.protocol = replacement.protocol;
  target.host = replacement.host;
  return target.toString();
}

/** 'bestbuy.com' — what to call the shop in the UI. */
export function shopName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the shop";
  }
}

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/**
 * The SKU out of a Best Buy product address, or null if it isn't one.
 *
 * Worth doing rather than treating a bestbuy.com link like any other shop's,
 * for two reasons. Best Buy blocks the generic price reader — pasting one of
 * their links used to make an item whose price could never be checked — and
 * their own API answers by SKU, which the link is already carrying. So the link
 * binds straight to the right product, with none of the guessing that comes
 * from searching for a product by its name.
 *
 * Both shapes their site uses:
 *   …/site/lg-48-class-b5-oled/6588359.p?skuId=6588359
 *   …/site/combo/whatever/xyz?skuId=6588359
 * The query parameter wins when both are present — on a bundle page the path
 * carries the combo's id and `skuId` carries the thing you actually chose.
 */
/**
 * A readable product name out of a Best Buy address.
 *
 * Their URLs carry the product's name as a slug —
 * `/site/lg-48-class-b5-series-oled-evo-4k-smart-tv/6588359.p` — and without
 * this a link pasted while there's no API key becomes an item called
 * "bestbuy.com", which is a poor thing to find on a wish list. The real name
 * replaces this the first time a price check succeeds.
 *
 * Acronyms are the only fiddly part: plain title case turns OLED into "Oled"
 * and 4K into "4k". The list below is the ones a student's wish list actually
 * hits; anything not on it just gets its first letter capitalised, which is
 * right for ordinary words and no worse than the slug for the rest.
 */
/** Path segments that belong to the address, not to the product. */
const STRUCTURAL_SEGMENTS = new Set(["site", "product", "products", "en-ca", "fr-ca"]);

const SHOUTED = new Set([
  "tv", "oled", "qled", "led", "lcd", "hd", "uhd", "hdr", "4k", "8k", "usb",
  "usbc", "ssd", "hdd", "ram", "cpu", "gpu", "pc", "ps5", "xbox", "hdmi",
  "wifi", "lg", "hp", "msi", "asus", "amd", "rtx", "gtx", "ai",
]);

export function bestBuyNameFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // The slug is the segment before the one ending in `.p`.
  const parts = parsed.pathname.split("/").filter(Boolean);
  const skuIndex = parts.findIndex((s) => /^\d{5,}\.p$/.test(s));
  const slug = skuIndex > 0 ? parts[skuIndex - 1] : null;
  if (!slug || !/[a-z]/i.test(slug)) return null;
  // Some of their addresses carry no product slug at all — `/site/6588359.p`,
  // or `/en-ca/product/6588359.p` — and the segment before the SKU is then
  // part of the path's own structure. Naming an item "Site" or "Product" is
  // worse than falling back to the shop's name. A real slug is always several
  // words joined by hyphens.
  if (!slug.includes("-") || STRUCTURAL_SEGMENTS.has(slug.toLowerCase())) {
    return null;
  }

  const words = slug.split("-").filter(Boolean);
  if (words.length === 0) return null;

  return words
    .map((word) =>
      SHOUTED.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ")
    .slice(0, 200);
}

export function bestBuySku(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)bestbuy\.(com|ca)$/i.test(parsed.hostname)) return null;

  const fromQuery = parsed.searchParams.get("skuId");
  if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;

  const fromPath = /\/(\d{5,})\.p(?:$|[/?#])/.exec(parsed.pathname + "?");
  return fromPath ? fromPath[1] : null;
}

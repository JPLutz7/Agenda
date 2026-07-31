/**
 * Reading a price out of a page.
 *
 * This half is a set of promises about other people's HTML, so it's the half
 * that breaks when a shop redesigns. Testing it against saved markup — rather
 * than against a live shop — is what makes a breakage visible here instead of
 * as a wrong number on the Wants list.
 *
 * Every "must not" below is a way of showing a price that isn't the price,
 * which is worse than showing none.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestBuyNameFromUrl,
  bestBuySku,
  extractPrice,
  looksLikeUrl,
  shopName,
} from "../src/lib/scrape.ts";

const page = (head: string, body = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (obj: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

test("a plain schema.org product", () => {
  const found = extractPrice(
    page(
      ld({
        "@type": "Product",
        name: "Dell UltraSharp U2723QE",
        offers: { "@type": "Offer", price: "329.99", priceCurrency: "USD" },
      }),
    ),
    "shopco.example",
  );
  assert.equal(found?.priceCents, 32999);
  assert.equal(found?.name, "Dell UltraSharp U2723QE");
});

test("nested inside @graph, which is how most shops actually publish it", () => {
  const found = extractPrice(
    page(
      ld({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", name: "ShopCo" },
          {
            "@type": "Product",
            name: "Thing",
            offers: { "@type": "Offer", price: 49.5, priceCurrency: "USD", listPrice: "79.99" },
          },
        ],
      }),
    ),
    "shopco.example",
  );
  assert.equal(found?.priceCents, 4950);
  assert.equal(found?.regularPriceCents, 7999);
});

test("several offers means the one you would actually pay", () => {
  const found = extractPrice(
    page(
      ld({
        "@type": "Product",
        name: "Thing",
        offers: [
          { "@type": "Offer", price: "89.00", priceCurrency: "USD" },
          { "@type": "Offer", price: "72.50", priceCurrency: "USD" },
        ],
      }),
    ),
    "shopco.example",
  );
  assert.equal(found?.priceCents, 7250);
});

test("Open Graph tags are enough when there is no JSON-LD", () => {
  const found = extractPrice(
    page(
      '<meta property="og:title" content="Anglepoise Type 75">' +
        '<meta property="product:price:amount" content="189.00">' +
        '<meta property="product:price:currency" content="USD">',
    ),
    "shopco.example",
  );
  assert.equal(found?.priceCents, 18900);
  assert.equal(found?.name, "Anglepoise Type 75");
});

test("thousands separators and stray currency text are handled", () => {
  for (const [written, cents] of [
    ["$1,299.00", 129900],
    ["1299.00", 129900],
    ["USD 249", 24900],
    ["  19.99  ", 1999],
  ] as const) {
    const found = extractPrice(
      page(ld({ "@type": "Product", offers: { price: written, priceCurrency: "USD" } })),
      "shopco.example",
    );
    assert.equal(found?.priceCents, cents, `"${written}" should be ${cents}`);
  }
});

test("a price in another currency is refused, not shown as dollars", () => {
  const found = extractPrice(
    page(ld({ "@type": "Product", offers: { price: "249.00", priceCurrency: "EUR" } })),
    "shopco.example",
  );
  assert.equal(found, null);
});

test("a page with no price yields nothing rather than a guess", () => {
  assert.equal(extractPrice(page("<title>Some product</title>", "<p>Call us</p>"), "x.example"), null);
  assert.equal(extractPrice(page("", ""), "x.example"), null);
  // Malformed JSON-LD is common and must not throw or be believed.
  assert.equal(
    extractPrice(page('<script type="application/ld+json">{ oh dear</script>'), "x.example"),
    null,
  );
});

test("Amazon's own markup, and only for Amazon", () => {
  const amazonPage = page(
    "<title>Sony WH-1000XM5</title>",
    '<span id="productTitle">  Sony WH-1000XM5  </span>' +
      // A decoy: the crossed-out list price sits in its own block above.
      '<div id="corePriceDisplay_desktop_feature_div"><span class="a-offscreen">$399.99</span></div>' +
      '<div id="corePrice_feature_div"><span class="a-price">' +
      '<span class="a-offscreen">$248.00</span></span></div>',
  );

  const found = extractPrice(amazonPage, "www.amazon.com");
  assert.equal(found?.priceCents, 24800, "should take the buying price, not the decoy");
  assert.equal(found?.name, "Sony WH-1000XM5");

  // The same markup on any other shop must not be read with Amazon's rules —
  // those selectors mean nothing anywhere else.
  assert.equal(extractPrice(amazonPage, "shopco.example"), null);
});

test("shopName and looksLikeUrl", () => {
  assert.equal(shopName("https://www.bestbuy.com/site/x.p"), "bestbuy.com");
  assert.equal(shopName("not a url"), "the shop");
  assert.equal(looksLikeUrl("https://example.com/x"), true);
  assert.equal(looksLikeUrl("  http://example.com  "), true);
  assert.equal(looksLikeUrl("LG 48 inch OLED"), false);
  assert.equal(looksLikeUrl("ftp://example.com/x"), false);
});

test("a Best Buy link gives up its SKU, and other shops' links don't", () => {
  // The two shapes their site uses.
  assert.equal(
    bestBuySku("https://www.bestbuy.com/site/lg-48-class-b5-series-oled-evo-4k-smart-tv/6588359.p?skuId=6588359"),
    "6588359",
  );
  assert.equal(
    bestBuySku("https://www.bestbuy.com/site/lg-48-oled/6588359.p"),
    "6588359",
  );
  // On a bundle page the path carries the combo and skuId carries the choice,
  // so the query parameter has to win.
  assert.equal(
    bestBuySku("https://www.bestbuy.com/site/combo/tv-and-soundbar/1234567.p?skuId=6588359"),
    "6588359",
  );
  assert.equal(bestBuySku("https://www.bestbuy.ca/en-ca/product/6588359.p"), "6588359");

  // Anything else is somebody else's shop, and goes through the price reader.
  assert.equal(bestBuySku("https://www.amazon.com/dp/B0ABCDEFG"), null);
  assert.equal(bestBuySku("https://shop.example/product/42"), null);
  // A lookalike domain must not be mistaken for the real one.
  assert.equal(bestBuySku("https://bestbuy.com.evil.example/site/1234567.p"), null);
  assert.equal(bestBuySku("https://www.bestbuy.com/site/searchpage.jsp?st=oled"), null);
  assert.equal(bestBuySku("not a url at all"), null);
});

test("and gives up a readable product name too", () => {
  assert.equal(
    bestBuyNameFromUrl("https://www.bestbuy.com/site/lg-48-class-b5-series-oled-evo-4k-smart-tv/6588359.p?skuId=6588359"),
    "LG 48 Class B5 Series OLED Evo 4K Smart TV",
  );
  // The acronyms are the point: plain title case gives "Oled", "4k", "Tv".
  assert.equal(
    bestBuyNameFromUrl("https://www.bestbuy.com/site/samsung-65-qled-uhd-hdr/1234567.p"),
    "Samsung 65 QLED UHD HDR",
  );
  // Ordinary words keep ordinary capitalisation.
  assert.equal(
    bestBuyNameFromUrl("https://www.bestbuy.com/site/desk-lamp-with-clamp/1234567.p"),
    "Desk Lamp With Clamp",
  );
  // Nothing to take a name from: the segment before the SKU is part of the
  // address rather than the product, and "Site" is a worse name than the fallback.
  assert.equal(bestBuyNameFromUrl("https://www.bestbuy.com/site/6588359.p"), null);
  assert.equal(bestBuyNameFromUrl("https://www.bestbuy.ca/en-ca/product/6588359.p"), null);
  assert.equal(bestBuyNameFromUrl("https://shop.example/thing"), null);
  assert.equal(bestBuyNameFromUrl("nonsense"), null);
});

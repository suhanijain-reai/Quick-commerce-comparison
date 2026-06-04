import { chromium } from "playwright";
import { pincodeToCoords } from "../utils/geocode.js";
import { parseProducts } from "../utils/parser.js";
import { cache } from "../utils/cache.js";

// ─── Stealth launch options to avoid bot detection ───────────────────────────
const LAUNCH_OPTIONS = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--no-first-run",
    "--ignore-certificate-errors",
    "--window-size=1366,768",
  ],
};

// ── Realistic browser headers ─────────────────────────────────────────────────
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8,hi;q=0.7",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

// ─── Blinkit API endpoint (intercepted from their web app) ────────────────────
const BLINKIT_BASE = "https://blinkit.com";
// Their search-results page calls this internal "layout" API (one call per page of 12).
const BLINKIT_SEARCH_PATH = "/v1/layout/search";

/**
 * Sets pincode location on Blinkit by injecting lat/lng cookies,
 * which is how their app determines the nearest dark store.
 */
async function setBlinkitLocation(page, lat, lng, pincode) {
  // Navigate to homepage first to establish session
  await page.goto(BLINKIT_BASE, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Inject location via localStorage and cookies — how Blinkit stores it
  await page.evaluate(
    ({ lat, lng, pincode }) => {
      localStorage.setItem("userLat", lat);
      localStorage.setItem("userLng", lng);
      localStorage.setItem("userPincode", pincode);
      // Blinkit uses gr_1_lat / gr_1_lng for their location guard
      localStorage.setItem("gr_1_lat", lat);
      localStorage.setItem("gr_1_lng", lng);
    },
    { lat, lng, pincode }
  );

  // Set location cookies
  await page.context().addCookies([
    { name: "gr_1_lat", value: String(lat), domain: ".blinkit.com", path: "/" },
    { name: "gr_1_lng", value: String(lng), domain: ".blinkit.com", path: "/" },
    { name: "userPincode", value: String(pincode), domain: ".blinkit.com", path: "/" },
  ]);

  // Reload so Blinkit picks up the new location
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });

  // Small random delay to look human
  await randomDelay(800, 1500);
}

/**
 * Intercepts Blinkit's internal search API calls.
 *
 * Their results page calls `/v1/layout/search?q=...` and loads more pages
 * (12 products each) as you scroll. We attach a response listener that
 * collects every search-layout payload, navigate to the search page, then
 * scroll to pull additional pages until we have `maxResults` products or the
 * list stops growing.
 *
 * Returns an array of raw layout responses (one per page) for the parser.
 */
async function interceptSearchAPI(page, query, maxResults = 48) {
  const pages = [];
  let productCount = 0;

  const onResponse = async (response) => {
    const url = response.url();
    // Match the real search endpoint, but skip the "empty_search" placeholder.
    if (!url.includes(BLINKIT_SEARCH_PATH) || url.includes("empty_search")) return;
    try {
      const json = await response.json();
      const snippets = json?.response?.snippets || [];
      const hasProducts = snippets.some(
        (s) => typeof s?.widget_type === "string" && s.widget_type.startsWith("product_card")
      );
      if (hasProducts) {
        pages.push(json);
        productCount += snippets.filter(
          (s) => typeof s?.widget_type === "string" && s.widget_type.startsWith("product_card")
        ).length;
      }
    } catch {
      // Not JSON / failed body read — ignore.
    }
  };

  page.on("response", onResponse);

  try {
    const searchUrl = `${BLINKIT_BASE}/s/?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 20000 });

    // Wait for the first page of products to land.
    const start = Date.now();
    while (pages.length === 0 && Date.now() - start < 15000) {
      await randomDelay(300, 500);
    }
    if (pages.length === 0) {
      throw new Error("No search-layout response captured after 15s");
    }

    // Scroll to trigger lazy-loaded pages until we have enough (or it stalls).
    let stalls = 0;
    while (productCount < maxResults && stalls < 3) {
      const before = pages.length;
      await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
      await randomDelay(900, 1400);
      stalls = pages.length === before ? stalls + 1 : 0;
    }

    return pages;
  } finally {
    page.off("response", onResponse);
  }
}

/**
 * Falls back to scraping the DOM if API interception fails.
 * Parses Blinkit's search results page HTML directly.
 */
async function scrapeDOMFallback(page, query) {
  const searchUrl = `${BLINKIT_BASE}/s/?q=${encodeURIComponent(query)}`;
  await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 20000 });

  // Wait for product cards to appear
  await page
    .waitForSelector('[data-test-id="plp-product"]', { timeout: 10000 })
    .catch(() => null);

  // Extract product data from DOM
  const products = await page.evaluate(() => {
    const items = [];

    // Blinkit product card selectors (may change — keep updated)
    const cards = document.querySelectorAll(
      '[data-test-id="plp-product"], .product-container, .Product__UpdatedDetailWrapper'
    );

    cards.forEach((card) => {
      try {
        // Product name
        const name =
          card.querySelector('[data-test-id="product-name"]')?.innerText ||
          card.querySelector(".Product__Name")?.innerText ||
          card.querySelector("h5")?.innerText ||
          "";

        // Price — Blinkit shows MRP and sale price separately
        const priceEl =
          card.querySelector('[data-test-id="product-price"]') ||
          card.querySelector(".Product__Price") ||
          card.querySelector('[class*="price"]');
        const priceText = priceEl?.innerText || "";

        // MRP (original price)
        const mrpEl =
          card.querySelector('[data-test-id="product-mrp"]') ||
          card.querySelector(".Product__MRP") ||
          card.querySelector('[class*="mrp"]');
        const mrpText = mrpEl?.innerText || "";

        // Quantity / weight info
        const qtyEl =
          card.querySelector('[data-test-id="product-weight"]') ||
          card.querySelector(".Product__Weight") ||
          card.querySelector('[class*="weight"]');
        const quantity = qtyEl?.innerText || "";

        // Product image
        const img = card.querySelector("img")?.src || "";

        // Out of stock check
        const isOutOfStock =
          !!card.querySelector('[data-test-id="out-of-stock"]') ||
          card.innerText.toLowerCase().includes("out of stock") ||
          card.innerText.toLowerCase().includes("notify me");

        // Product ID from data attributes
        const productId =
          card.getAttribute("data-product-id") ||
          card.getAttribute("data-id") ||
          "";

        if (name) {
          items.push({
            name: name.trim(),
            priceText: priceText.trim(),
            mrpText: mrpText.trim(),
            quantity: quantity.trim(),
            image: img,
            isOutOfStock,
            productId,
          });
        }
      } catch {
        // Skip malformed cards
      }
    });

    return items;
  });

  return products;
}

/**
 * Main search function — tries API intercept first, falls back to DOM scraping.
 */
export async function searchBlinkit({ pincode, query, useProxy = null }) {
  const cacheKey = `blinkit:${pincode}:${query.toLowerCase().trim()}`;

  // Return cached result if fresh (< 30 mins old)
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[CACHE HIT] ${cacheKey}`);
    return { ...cached, fromCache: true };
  }

  // Step 1: Convert pincode to lat/lng
  const coords = await pincodeToCoords(pincode);
  if (!coords) {
    throw Object.assign(new Error(`Could not resolve pincode: ${pincode}`), {
      code: "INVALID_PINCODE",
      status: 400,
    });
  }

  console.log(`[SEARCH] pincode=${pincode} (${coords.lat},${coords.lng}) query="${query}"`);

  const browser = await chromium.launch(LAUNCH_OPTIONS);

  try {
    const context = await browser.newContext({
      extraHTTPHeaders: BROWSER_HEADERS,
      viewport: { width: 1366, height: 768 },
      // Mask automation signals
      userAgent: BROWSER_HEADERS["User-Agent"],
    });

    // Block images/fonts/css to speed up scraping (we only need API data)
    await context.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}", (route) =>
      route.abort()
    );

    const page = await context.newPage();

    // Hide webdriver flag — Playwright's stealth
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
      window.chrome = { runtime: {} };
    });

    // Step 2: Set location
    await setBlinkitLocation(page, coords.lat, coords.lng, pincode);

    // Step 3: Try to intercept their API
    let rawData = null;
    let products = [];

    try {
      rawData = await interceptSearchAPI(page, query);
      products = parseProducts(rawData, "api");
      console.log(`[API INTERCEPT] Found ${products.length} products`);
    } catch (err) {
      console.warn(`[API INTERCEPT FAILED] ${err.message} — falling back to DOM`);
      const domItems = await scrapeDOMFallback(page, query);
      products = parseProducts(domItems, "dom");
      console.log(`[DOM FALLBACK] Found ${products.length} products`);
    }

    const result = {
      pincode,
      query,
      location: coords,
      products,
      scrapedAt: new Date().toISOString(),
      fromCache: false,
    };

    // Cache successful scrapes only — don't poison the cache with empty
    // results from a transient block/timeout (TTL defaults to 30 mins).
    if (products.length > 0) {
      cache.set(cacheKey, result);
    }

    return result;
  } finally {
    await browser.close();
  }
}

/**
 * Scrapes multiple queries for one pincode in sequence (not parallel —
 * parallel browser instances get rate-limited/blocked faster).
 */
export async function bulkSearch({ pincode, queries }) {
  const results = [];
  for (const query of queries) {
    try {
      const result = await searchBlinkit({ pincode, query });
      results.push({ query, success: true, ...result });
    } catch (err) {
      results.push({ query, success: false, error: err.message, products: [] });
    }
    // Polite delay between requests
    await randomDelay(1500, 3000);
  }
  return results;
}

function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((r) => setTimeout(r, ms));
}

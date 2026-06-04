import { chromium } from "playwright";
import { pincodeToCoords } from "../utils/geocode.js";
import { parseZeptoProducts } from "../utils/parser.js";
import { cache } from "../utils/cache.js";

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

const ZEPTO_BASE = "https://www.zeptonow.com";

/**
 * Sets Zepto location by injecting lat/lng into localStorage and cookies.
 * Zepto uses these to resolve the nearest dark store.
 */
async function setZeptoLocation(page, lat, lng, pincode) {
  await page.goto(ZEPTO_BASE, { waitUntil: "domcontentloaded", timeout: 30000 });

  await page.evaluate(
    ({ lat, lng, pincode }) => {
      const loc = JSON.stringify({ lat, lng, pincode });
      localStorage.setItem("userLatLng", JSON.stringify({ lat, lng }));
      localStorage.setItem("userPincode", String(pincode));
      localStorage.setItem("selectedAddress", loc);
      // Keys used across different Zepto app versions
      localStorage.setItem("ZEPTO_USER_LAT", String(lat));
      localStorage.setItem("ZEPTO_USER_LNG", String(lng));
      localStorage.setItem("zepto_lat", String(lat));
      localStorage.setItem("zepto_lng", String(lng));
    },
    { lat, lng, pincode }
  );

  await page.context().addCookies([
    { name: "userLat", value: String(lat), domain: ".zeptonow.com", path: "/" },
    { name: "userLng", value: String(lng), domain: ".zeptonow.com", path: "/" },
    { name: "userPincode", value: String(pincode), domain: ".zeptonow.com", path: "/" },
  ]);

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await randomDelay(800, 1500);
}

/**
 * Intercepts Zepto's internal search API responses.
 *
 * Zepto's search page fires XHR/fetch requests that return product lists.
 * We attach a response listener, navigate to the search URL, then scroll
 * to trigger pagination until we have enough products or it stalls.
 */
async function interceptZeptoAPI(page, query, maxResults = 48) {
  const pages = [];
  let productCount = 0;

  const onResponse = async (response) => {
    const url = response.url();
    // Catch any JSON response from Zepto's domain that looks like a search call
    if (!url.includes("zeptonow.com") && !url.includes("zepto")) return;
    if (!url.includes("search")) return;

    try {
      const json = await response.json();

      // Try multiple known Zepto response shapes
      const products =
        json?.data?.storeProducts ||
        json?.data?.searchResults ||
        json?.data?.products ||
        json?.response?.data?.products ||
        json?.products ||
        json?.results ||
        [];

      if (Array.isArray(products) && products.length > 0) {
        pages.push(json);
        productCount += products.length;
      }
    } catch {
      // Not JSON — ignore
    }
  };

  page.on("response", onResponse);

  try {
    const searchUrl = `${ZEPTO_BASE}/search?query=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 20000 });

    const start = Date.now();
    while (pages.length === 0 && Date.now() - start < 12000) {
      await randomDelay(300, 500);
    }
    if (pages.length === 0) throw new Error("No Zepto search API response captured");

    // Scroll to trigger lazy-loaded pages
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
 * Falls back to scraping Zepto's DOM if API interception fails.
 */
async function scrapeZeptoDOMFallback(page, query) {
  const searchUrl = `${ZEPTO_BASE}/search?query=${encodeURIComponent(query)}`;
  await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 20000 });

  await page
    .waitForSelector(
      '[class*="ProductCard"], [data-testid*="product"], [class*="product-card"]',
      { timeout: 10000 }
    )
    .catch(() => null);

  const products = await page.evaluate(() => {
    const items = [];

    const cards = document.querySelectorAll(
      '[class*="ProductCard"], [data-testid*="product-card"], [class*="product-card"], [class*="ProductWidget"]'
    );

    cards.forEach((card) => {
      try {
        const name =
          card.querySelector('[class*="ProductName"], [class*="product-name"], h3, h4')
            ?.innerText ||
          card.querySelector('[data-testid*="name"]')?.innerText ||
          "";

        const priceEl = card.querySelector(
          '[class*="Price"]:not([class*="Mrp"]):not([class*="mrp"]):not([class*="strike"]), [data-testid*="price"]'
        );
        const priceText = priceEl?.innerText || "";

        const mrpEl = card.querySelector(
          '[class*="Mrp"], [class*="mrp"], [class*="strike"], [class*="StrikeThrough"], s, del'
        );
        const mrpText = mrpEl?.innerText || "";

        const qtyEl = card.querySelector(
          '[class*="Weight"], [class*="Unit"], [class*="Quantity"], [class*="quantity"], [data-testid*="weight"]'
        );
        const quantity = qtyEl?.innerText || "";

        const img = card.querySelector("img")?.src || "";

        const isOutOfStock =
          !!card.querySelector('[class*="OutOfStock"], [class*="out-of-stock"]') ||
          card.innerText.toLowerCase().includes("out of stock") ||
          card.innerText.toLowerCase().includes("notify me");

        const productId =
          card.getAttribute("data-product-id") || card.getAttribute("id") || "";

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
export async function searchZepto({ pincode, query }) {
  const cacheKey = `zepto:${pincode}:${query.toLowerCase().trim()}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[CACHE HIT] ${cacheKey}`);
    return { ...cached, fromCache: true };
  }

  const coords = await pincodeToCoords(pincode);
  if (!coords) {
    throw Object.assign(new Error(`Could not resolve pincode: ${pincode}`), {
      code: "INVALID_PINCODE",
      status: 400,
    });
  }

  console.log(`[ZEPTO SEARCH] pincode=${pincode} (${coords.lat},${coords.lng}) query="${query}"`);

  const browser = await chromium.launch(LAUNCH_OPTIONS);

  try {
    const context = await browser.newContext({
      extraHTTPHeaders: BROWSER_HEADERS,
      viewport: { width: 1366, height: 768 },
      userAgent: BROWSER_HEADERS["User-Agent"],
    });

    await context.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}", (route) =>
      route.abort()
    );

    const page = await context.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
      window.chrome = { runtime: {} };
    });

    await setZeptoLocation(page, coords.lat, coords.lng, pincode);

    let products = [];

    try {
      const rawData = await interceptZeptoAPI(page, query);
      products = parseZeptoProducts(rawData, "api");
      console.log(`[ZEPTO API] Found ${products.length} products`);
    } catch (err) {
      console.warn(`[ZEPTO API FAILED] ${err.message} — falling back to DOM`);
      const domItems = await scrapeZeptoDOMFallback(page, query);
      products = parseZeptoProducts(domItems, "dom");
      console.log(`[ZEPTO DOM] Found ${products.length} products`);
    }

    const result = {
      pincode,
      query,
      location: coords,
      products,
      scrapedAt: new Date().toISOString(),
      fromCache: false,
      platform: "zepto",
    };

    if (products.length > 0) {
      cache.set(cacheKey, result);
    }

    return result;
  } finally {
    await browser.close();
  }
}

/**
 * Searches multiple queries for one pincode in sequence.
 */
export async function bulkSearchZepto({ pincode, queries }) {
  const results = [];
  for (const query of queries) {
    try {
      const result = await searchZepto({ pincode, query });
      results.push({ query, success: true, ...result });
    } catch (err) {
      results.push({ query, success: false, error: err.message, products: [] });
    }
    await randomDelay(1500, 3000);
  }
  return results;
}

function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((r) => setTimeout(r, ms));
}

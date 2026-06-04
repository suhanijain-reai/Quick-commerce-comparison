/**
 * Normalizes product data from either Blinkit's API response
 * or raw DOM-scraped data into a consistent shape.
 */
export function parseProducts(raw, source) {
  if (source === "api") {
    return parseAPIResponse(raw);
  } else {
    return parseDOMProducts(raw);
  }
}

/**
 * Parses Blinkit's current search API (`/v1/layout/search`).
 *
 * The response is a "layout" of snippets:
 *   { is_success, response: { snippets: [ { widget_type, data: {...} } ], pagination } }
 *
 * Products are the snippets whose widget_type starts with "product_card"
 * (currently "product_card_snippet_type_2"). Each text field is an object
 * like { text: "₹35", color, font } — we read the `.text`.
 *
 * Accepts a single response object OR an array of them (one per paginated page).
 */
function parseAPIResponse(raw) {
  const pages = Array.isArray(raw) ? raw : [raw];

  const cards = [];
  for (const page of pages) {
    const snippets =
      page?.response?.snippets ||
      page?.snippets ||
      page?.data?.snippets ||
      [];
    for (const s of snippets) {
      if (typeof s?.widget_type === "string" && s.widget_type.startsWith("product_card") && s.data) {
        cards.push(s.data);
      }
    }
  }

  const products = cards.map((c) => normalizeLayoutCard(c)).filter(Boolean);

  // The same product can appear across pages — dedupe by id.
  const seen = new Set();
  return products.filter((p) => {
    if (!p.id || seen.has(p.id)) return p.id ? false : true;
    seen.add(p.id);
    return true;
  });
}

/** Reads the `.text` out of Blinkit's styled-text objects, tolerating plain strings. */
function text(field) {
  if (field == null) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && typeof field.text === "string") return field.text;
  return "";
}

function normalizeLayoutCard(d) {
  if (!d) return null;

  const name = text(d.display_name) || text(d.name);
  if (!name) return null;

  const price = extractPrice(text(d.normal_price));
  const mrp = extractPrice(text(d.mrp)) ?? price;

  const inventory = typeof d.inventory === "number" ? d.inventory : null;
  const isAvailable =
    d.is_sold_out !== true && (inventory === null || inventory > 0);

  return {
    id: String(d.product_id || d.identity?.id || ""),
    name: name.trim(),
    brand: text(d.brand_name).trim(),
    quantity: text(d.variant).trim(),
    price,
    mrp,
    discount:
      price != null && mrp != null && mrp > price
        ? Math.round(((mrp - price) / mrp) * 100)
        : 0,
    image: d.image?.url || d.media_container?.items?.[0]?.image?.url || "",
    category: "",
    rating: d.rating?.bar?.value ?? null,
    isAvailable,
    inventory,
    merchantId: String(d.merchant_id || ""),
    sku: String(d.product_id || ""),
  };
}

/**
 * Parses raw DOM-scraped product objects (from scrapeDOMFallback).
 */
function parseDOMProducts(items) {
  return items
    .map((item) => {
      const price = extractPrice(item.priceText);
      const mrp = extractPrice(item.mrpText) ?? price;

      return {
        id: item.productId || "",
        name: item.name || "",
        brand: extractBrand(item.name),
        quantity: item.quantity || "",
        price,
        mrp,
        discount:
          price != null && mrp != null && mrp > price
            ? Math.round(((mrp - price) / mrp) * 100)
            : 0,
        image: item.image || "",
        category: "",
        rating: null,
        isAvailable: !item.isOutOfStock,
        inventory: null,
        merchantId: "",
        sku: item.productId || "",
      };
    })
    .filter((p) => p.name && p.price !== null);
}

/**
 * Extracts a numeric price from text like "₹68", "Rs. 68", "68.00"
 */
function extractPrice(text) {
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/[\d]+(?:\.\d{1,2})?/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * Best-effort brand extraction — takes the first word of the product name.
 * Not always accurate but useful for grouping.
 */
function extractBrand(name) {
  if (!name) return "";
  return name.split(" ")[0];
}

// ─── Zepto parser ─────────────────────────────────────────────────────────────

/**
 * Normalizes product data from Zepto's API response or DOM scrape
 * into the same shape used by Blinkit products.
 */
export function parseZeptoProducts(raw, source) {
  if (source === "api") return parseZeptoAPIResponse(raw);
  return parseZeptoDOMProducts(raw);
}

/**
 * Parses Zepto's search API response.
 *
 * Zepto has changed their API shape across versions. We try multiple
 * known paths and take the first one that yields an array of products.
 * Prices may arrive in paise (1/100 rupee) — detected heuristically.
 */
function parseZeptoAPIResponse(rawPages) {
  const pages = Array.isArray(rawPages) ? rawPages : [rawPages];
  const allProducts = [];

  for (const page of pages) {
    const products =
      page?.data?.storeProducts ||
      page?.data?.searchResults ||
      page?.data?.products ||
      page?.response?.data?.products ||
      page?.products ||
      page?.results ||
      [];

    for (const item of Array.isArray(products) ? products : []) {
      const normalized = normalizeZeptoProduct(item);
      if (normalized) allProducts.push(normalized);
    }
  }

  // Dedupe by id
  const seen = new Set();
  return allProducts.filter((p) => {
    if (!p.id || seen.has(p.id)) return !p.id;
    seen.add(p.id);
    return true;
  });
}

function normalizeZeptoProduct(item) {
  if (!item) return null;

  // Zepto nests product details under item.product in storeProduct responses
  const prod = item.product || item;
  const name = prod.name || prod.displayName || prod.productName || "";
  if (!name) return null;

  let price = item.price ?? item.offerPrice ?? prod.price ?? null;
  let mrp = item.mrp ?? item.originalPrice ?? prod.mrp ?? price;

  // Zepto sometimes returns prices in paise — divide by 100 if so
  if (price !== null && price > 500 && Number.isInteger(price)) {
    price = price / 100;
    if (mrp != null) mrp = mrp / 100;
  }

  const inStock =
    item.inStock ?? item.in_stock ?? prod.inStock ?? (item.quantity > 0) ?? true;

  const images = prod.images || prod.media || [];
  const imageUrl =
    (Array.isArray(images) && images.length > 0
      ? images[0]?.url || images[0]?.src || (typeof images[0] === "string" ? images[0] : "")
      : "") ||
    prod.imageUrl ||
    prod.thumbnailImage ||
    "";

  return {
    id: String(item.id || item.storeProductId || prod.id || ""),
    name: name.trim(),
    brand: String(prod.brandName || prod.brand || extractBrand(name)).trim(),
    quantity: String(
      prod.quantity || prod.unitQuantity || prod.displayUnit || prod.weight || ""
    ).trim(),
    price,
    mrp,
    discount:
      price != null && mrp != null && mrp > price
        ? Math.round(((mrp - price) / mrp) * 100)
        : 0,
    image: imageUrl,
    category: prod.category?.name || "",
    rating: prod.rating ?? null,
    isAvailable: !!inStock,
    inventory: item.quantity ?? null,
    merchantId: "",
    sku: String(prod.id || item.productId || ""),
  };
}

function parseZeptoDOMProducts(items) {
  return items
    .map((item) => {
      const price = extractPrice(item.priceText);
      const mrp = extractPrice(item.mrpText) ?? price;

      return {
        id: item.productId || "",
        name: item.name || "",
        brand: extractBrand(item.name),
        quantity: item.quantity || "",
        price,
        mrp,
        discount:
          price != null && mrp != null && mrp > price
            ? Math.round(((mrp - price) / mrp) * 100)
            : 0,
        image: item.image || "",
        category: "",
        rating: null,
        isAvailable: !item.isOutOfStock,
        inventory: null,
        merchantId: "",
        sku: item.productId || "",
      };
    })
    .filter((p) => p.name && p.price !== null);
}

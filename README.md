# Blinkit Scraper API

A Node.js + Express API that scrapes product prices from Blinkit based on pincode.

## How it works

1. You send a pincode + product query
2. The API converts the pincode to lat/lng (via OpenStreetMap Nominatim — free)
3. A headless Chromium browser opens Blinkit, sets your location via cookies/localStorage
4. It intercepts Blinkit's internal API calls to extract product prices
5. Results are cached for 30 minutes and returned as JSON

---

## Setup

### Prerequisites
- Node.js 18+
- ~300MB disk space for Chromium

### Install

```bash
git clone <your-repo>
cd blinkit-scraper-api
npm install
npx playwright install chromium   # downloads headless Chrome (~280MB)
npm start
```

Server starts at `http://localhost:3000`

---

## API Endpoints

### Search products
```
GET /api/blinkit/search?pincode=400001&query=amul+milk
```

**Response:**
```json
{
  "success": true,
  "pincode": "400001",
  "query": "amul milk",
  "location": { "lat": 18.9388, "lng": 72.8354, "address": "Fort, Mumbai" },
  "scrapedAt": "2025-06-01T10:30:00.000Z",
  "fromCache": false,
  "products": [
    {
      "id": "12345",
      "name": "Amul Full Cream Milk",
      "brand": "Amul",
      "quantity": "1 L",
      "price": 68,
      "mrp": 72,
      "discount": 5,
      "image": "https://cdn.blinkit.com/...",
      "category": "Dairy",
      "isAvailable": true,
      "sku": "AMU001"
    },
    {
      "id": "12346",
      "name": "Amul Toned Milk",
      "brand": "Amul",
      "quantity": "500 ml",
      "price": null,
      "mrp": 35,
      "discount": 0,
      "image": "...",
      "category": "Dairy",
      "isAvailable": false,    ← out of stock at this pincode
      "sku": "AMU002"
    }
  ]
}
```

---

### Bulk search (multiple products, one pincode)
```
POST /api/blinkit/bulk
Content-Type: application/json

{
  "pincode": "560034",
  "queries": ["amul milk", "britannia bread", "lay's chips", "maggi noodles"]
}
```

Max 10 queries per request. Runs sequentially with random delays to avoid blocks.

---

### Health check
```
GET /health
```

---

## Rate limits

The API enforces **30 requests per minute per IP** to prevent hammering Blinkit.

Each scrape takes 5–15 seconds (real browser, network, rendering). Results are cached for 30 minutes so repeated queries for the same pincode+product are instant.

---

## Deployment tips

### Using a proxy (recommended for production)

Blinkit will eventually block your server's IP if it sees too many requests from one source. Use rotating residential proxies:

```js
// In src/scrapers/blinkit.js, add to LAUNCH_OPTIONS:
args: [
  ...existingArgs,
  "--proxy-server=http://your-proxy-host:port"
]

// And in context options:
await browser.newContext({
  proxy: { server: "http://user:pass@proxy-host:port" }
})
```

Good proxy providers for India: Brightdata, Oxylabs, Smartproxy

### Redis cache (for multi-instance deployments)

Replace `src/utils/cache.js` with Redis:
```bash
npm install ioredis
```
```js
import Redis from "ioredis";
const redis = new Redis(process.env.REDIS_URL);

export const cache = {
  async get(key) {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  },
  async set(key, value, ttlMs) {
    await redis.set(key, JSON.stringify(value), "PX", ttlMs);
  }
};
```

### Environment variables
```env
PORT=3000
REDIS_URL=redis://localhost:6379         # optional
GOOGLE_MAPS_API_KEY=your_key_here        # optional, for better geocoding
```

---

## Caveats & legal

- Blinkit's ToS prohibits automated scraping. Use responsibly.
- Prices change frequently — treat scraped data as approximate.
- Blinkit may change their HTML/API structure at any time, breaking the scraper.
- The DOM selector fallback in `scrapeDOMFallback()` will need updates when Blinkit redesigns.
- Not suitable for reselling price data commercially.

---

## Project structure

```
src/
├── server.js              ← Express app entry point
├── routes/
│   └── blinkit.js         ← API route handlers
├── scrapers/
│   └── blinkit.js         ← Core Playwright scraper logic
├── middleware/
│   └── validate.js        ← Input validation + rate limiter
└── utils/
    ├── geocode.js          ← Pincode → lat/lng conversion
    ├── parser.js           ← Normalize API/DOM product data
    └── cache.js            ← In-memory cache with TTL
```

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blinkitRouter } from "./routes/blinkit.js";
import { zeptoRouter } from "./routes/zepto.js";
import { rateLimiter } from "./middleware/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve the frontend UI (public/) — before the rate limiter so static
// assets don't eat into the API request budget.
app.use(express.static(path.join(__dirname, "..", "public")));

app.use(rateLimiter);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Scraper routes
app.use("/api/blinkit", blinkitRouter);
app.use("/api/zepto", zeptoRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error("[ERROR]", err.message);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    code: err.code || "UNKNOWN_ERROR",
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Blinkit Scraper API running on http://localhost:${PORT}`);
  console.log(`🖥️  Web UI:  http://localhost:${PORT}/`);

});

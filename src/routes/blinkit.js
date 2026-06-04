import { Router } from "express";
import { searchBlinkit, bulkSearch } from "../scrapers/blinkit.js";
import { validatePincode, validateQuery } from "../middleware/validate.js";

export const blinkitRouter = Router();

/**
 * GET /api/blinkit/search
 * Query params: pincode (required), query (required)
 *
 * Example: GET /api/blinkit/search?pincode=400001&query=amul+milk
 */
blinkitRouter.get("/search", validatePincode, validateQuery, async (req, res, next) => {
  try {
    const { pincode, query } = req.query;
    const result = await searchBlinkit({ pincode, query });
    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/blinkit/bulk
 * Body: { pincode: "400001", queries: ["milk", "bread", "eggs"] }
 *
 * Searches multiple products for one pincode in sequence.
 * Max 10 queries per request to avoid getting blocked.
 */
blinkitRouter.post("/bulk", validatePincode, async (req, res, next) => {
  try {
    const { pincode, queries } = req.body;

    if (!queries || !Array.isArray(queries) || queries.length === 0) {
      return res.status(400).json({
        success: false,
        error: "queries must be a non-empty array",
        code: "INVALID_QUERIES",
      });
    }

    if (queries.length > 10) {
      return res.status(400).json({
        success: false,
        error: "Max 10 queries per bulk request",
        code: "TOO_MANY_QUERIES",
      });
    }

    const results = await bulkSearch({ pincode, queries });
    res.json({
      success: true,
      pincode,
      totalQueries: queries.length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/blinkit/test
 * Quick test endpoint — searches for "milk" in Mumbai (400001)
 */
blinkitRouter.get("/test", async (req, res, next) => {
  try {
    const result = await searchBlinkit({ pincode: "400001", query: "milk" });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

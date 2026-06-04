import { Router } from "express";
import { searchZepto, bulkSearchZepto } from "../scrapers/zepto.js";
import { validatePincode, validateQuery } from "../middleware/validate.js";

export const zeptoRouter = Router();

/**
 * GET /api/zepto/search
 * Query params: pincode (required), query (required)
 *
 * Example: GET /api/zepto/search?pincode=400001&query=amul+milk
 */
zeptoRouter.get("/search", validatePincode, validateQuery, async (req, res, next) => {
  try {
    const { pincode, query } = req.query;
    const result = await searchZepto({ pincode, query });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/zepto/bulk
 * Body: { pincode: "400001", queries: ["milk", "bread", "eggs"] }
 */
zeptoRouter.post("/bulk", validatePincode, async (req, res, next) => {
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

    const results = await bulkSearchZepto({ pincode, queries });
    res.json({ success: true, pincode, totalQueries: queries.length, results });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/zepto/test
 */
zeptoRouter.get("/test", async (req, res, next) => {
  try {
    const result = await searchZepto({ pincode: "400001", query: "milk" });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

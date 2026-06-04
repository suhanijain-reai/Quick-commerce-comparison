import axios from "axios";
import { cache } from "./cache.js";

// Free geocoding options (in order of preference):
// 1. Nominatim (OpenStreetMap) — free, no API key needed, rate limited to 1 req/sec
// 2. Positionstack — free tier 25k/month
// 3. Google Maps Geocoding — paid but most accurate for India

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/**
 * Converts an Indian pincode to lat/lng coordinates.
 * Uses Nominatim (OpenStreetMap) — free, no API key needed.
 *
 * For production, swap to Google Maps Geocoding API for better accuracy.
 * Google Maps: https://maps.googleapis.com/maps/api/geocode/json?address=400001,India&key=YOUR_KEY
 */
export async function pincodeToCoords(pincode) {
  const cacheKey = `geocode:${pincode}`;

  // Pincode coords rarely change — cache for 24 hours
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Method 1: Nominatim (free, no key)
    const response = await axios.get(NOMINATIM_URL, {
      params: {
        postalcode: pincode,
        country: "India",
        format: "json",
        limit: 1,
      },
      headers: {
        // Nominatim requires a User-Agent identifying your app
        "User-Agent": "BlinkitScraper/1.0 (contact@yourapp.com)",
      },
      timeout: 5000,
    });

    if (response.data && response.data.length > 0) {
      const { lat, lon, display_name } = response.data[0];
      const coords = {
        lat: parseFloat(lat),
        lng: parseFloat(lon),
        address: display_name,
      };
      cache.set(cacheKey, coords, 24 * 60 * 60 * 1000); // 24h
      return coords;
    }

    // Method 2: Fallback to hardcoded major pincodes
    const fallback = PINCODE_FALLBACKS[pincode];
    if (fallback) {
      console.warn(`[GEOCODE] Using fallback coords for ${pincode}`);
      return fallback;
    }

    return null;
  } catch (err) {
    console.error(`[GEOCODE ERROR] ${err.message}`);

    // Try fallback even on error
    const fallback = PINCODE_FALLBACKS[pincode];
    if (fallback) return fallback;

    return null;
  }
}

/**
 * Fallback hardcoded coords for common pincodes.
 * Useful when Nominatim is rate-limited or down.
 */
const PINCODE_FALLBACKS = {
  // Mumbai
  "400001": { lat: 18.9388, lng: 72.8354, address: "Fort, Mumbai" },
  "400051": { lat: 19.0596, lng: 72.8295, address: "Bandra West, Mumbai" },
  "400076": { lat: 19.1196, lng: 72.9089, address: "Powai, Mumbai" },
  // Delhi
  "110001": { lat: 28.6448, lng: 77.216, address: "Connaught Place, Delhi" },
  "110020": { lat: 28.5355, lng: 77.2091, address: "Hauz Khas, Delhi" },
  "110092": { lat: 28.6681, lng: 77.3031, address: "Preet Vihar, Delhi" },
  // Bengaluru
  "560001": { lat: 12.9716, lng: 77.5946, address: "MG Road, Bengaluru" },
  "560034": { lat: 12.9165, lng: 77.6101, address: "Koramangala, Bengaluru" },
  "560037": { lat: 12.9352, lng: 77.6245, address: "Indiranagar, Bengaluru" },
  // Hyderabad
  "500001": { lat: 17.385, lng: 78.4867, address: "Hyderabad City Center" },
  "500032": { lat: 17.4435, lng: 78.3772, address: "Madhapur, Hyderabad" },
  // Chennai
  "600001": { lat: 13.0827, lng: 80.2707, address: "Chennai City Center" },
  "600041": { lat: 13.0339, lng: 80.2619, address: "Adyar, Chennai" },
  // Pune
  "411001": { lat: 18.5204, lng: 73.8567, address: "Pune City Center" },
  "411006": { lat: 18.5314, lng: 73.8446, address: "Shivajinagar, Pune" },
};

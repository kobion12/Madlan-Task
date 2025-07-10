import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";
import { parse as csvParse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import * as fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "YOUR_API_KEY";
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.dirname(__filename);
const CACHE_DIR = path.join(PROJECT_ROOT, "places_cache");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const USER_AGENT = "address-geocoder/2.0";

// --- Haversine distance in kilometers ---
function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// --- Caching helpers ---
async function getCache(cacheKey: string): Promise<any | null> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const filePath = path.join(CACHE_DIR, cacheKey + ".json");
    const stat = await fs.stat(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}
async function setCache(cacheKey: string, data: any) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const filePath = path.join(CACHE_DIR, cacheKey + ".json");
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// --- Google Places API ---
async function searchPlaces(query: string, location: string): Promise<any[]> {
  let results: any[] = [];
  let nextPageToken: string | undefined;
  let count = 0;
  do {
    let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)} in ${encodeURIComponent(location)}&key=${GOOGLE_API_KEY}`;
    if (nextPageToken) url += `&pagetoken=${nextPageToken}`;
    const resp = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    const data: any = await resp.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") break;
    results = results.concat(data.results || []);
    nextPageToken = data.next_page_token;
    if (nextPageToken) await new Promise(res => setTimeout(res, 2000));
    count++;
  } while (nextPageToken && count < 3);
  return results.map((r: any) => ({
    name: r.name,
    address: r.formatted_address,
    latitude: r.geometry.location.lat,
    longitude: r.geometry.location.lng,
    type: query,
    place_id: r.place_id,
  }));
}
async function getPOIs(location: string): Promise<{elementary: any[], clinics: any[]}> {
  const cacheKey = `pois_${location.replace(/\s+/g, "_")}`;
  let cache = await getCache(cacheKey);
  if (cache) return cache;
  const [elementary, clinics] = await Promise.all([
    searchPlaces("elementary school", location),
    searchPlaces("קופת חולים", location),
  ]);
  const data = { elementary, clinics };
  await setCache(cacheKey, data);
  return data;
}

// --- Geocoding ---
interface GeocodeResult {
  input: string;
  latitude: number | null;
  longitude: number | null;
  formattedAddress: string | null;
  status: string;
  error?: string;
}
async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}`;
  try {
    const resp = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    const data: any = await resp.json();
    if (data.status === "OK" && data.results.length > 0) {
      const loc = data.results[0].geometry.location;
      return {
        input: address,
        latitude: loc.lat,
        longitude: loc.lng,
        formattedAddress: data.results[0].formatted_address,
        status: "OK",
      };
    } else {
      return {
        input: address,
        latitude: null,
        longitude: null,
        formattedAddress: null,
        status: data.status,
        error: data.error_message || "No results found",
      };
    }
  } catch (error) {
    return {
      input: address,
      latitude: null,
      longitude: null,
      formattedAddress: null,
      status: "ERROR",
      error: String(error),
    };
  }
}

// --- Listing Interface with optional geo fields ---
interface ListingWithGeo {
  address: string;
  price: number;
  rooms: number;
  city: string;
  street: string;
  neighbourhood?: string;
  seller_type?: string;
  property_floors?: string | number;
  property_builded_area?: string | number;
  property_type?: string;
  bulletin_has_balconies?: boolean | string;
  bulletin_has_elevator?: boolean | string;
  bulletin_has_parking?: boolean | string;
  raw: any;
  latitude?: number | null;
  longitude?: number | null;
  formattedAddress?: string | null;
  closestName?: string;
  closestAddress?: string;
  closestType?: string;
  closestDistanceKm?: number;
  status?: string;
  geocodeError?: string;
}

// --- MCP Server ---
const server = new McpServer({
  name: "address-geocoder",
  version: "1.1.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// --- Unified top-listings-by-poi-proximity tool ---
server.tool(
  "top-listings-by-poi-proximity",
  `Given a listings file (CSV/XLSX with headers: publish_date, seller_type, property_rooms, property_price, property_floors, property_builded_area, city, neighbourhood, street, property_type, bulletin_has_balconies, bulletin_has_elevator, bulletin_has_parking), returns the top N listings matching the price/room filter with minimal distance to a POI (clinic, school, or both) in the specified city.`,
  {
    file: z
      .object({
        path: z.string(),
        originalname: z.string(),
        mimetype: z.string(),
      })
      .describe("Listings file (CSV or XLSX)"),
    location: z.string().default("Haifa").describe("City or area for POI search."),
    maxPrice: z.number().default(2000000).describe("Maximum price (NIS)."),
    minRooms: z.number().default(3).describe("Minimum number of rooms."),
    poiType: z.enum(["clinic", "school", "both"]).default("clinic").describe("Which POI to check distance to."),
    topN: z.number().min(1).max(20).default(3).describe("How many listings to return."),
  },
  async ({ file, location, maxPrice, minRooms, poiType, topN }) => {
    // 1. Parse file
    let listings: any[] = [];
    const ext = path.extname(file.originalname).toLowerCase();
    try {
      const buf = await fs.readFile(file.path);
      if (ext === ".csv") {
        listings = csvParse(buf.toString("utf8"), { columns: true, skip_empty_lines: true });
      } else if (ext === ".xlsx") {
        const workbook = XLSX.read(buf, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        listings = XLSX.utils.sheet_to_json(worksheet);
      } else {
        return { content: [{ type: "text", text: "Unsupported file format. Upload CSV or XLSX." }] };
      }
    } catch (e) {
      return { content: [{ type: "text", text: "Failed to parse file: " + e }] };
    }

    // 2. Normalize and FILTER FIRST by price & rooms (BEFORE geocoding)
    function parsePrice(val: any) {
      return Number(String(val).replace(/[^0-9.]/g, ""));
    }
    function parseRooms(val: any) {
      return Number(String(val).replace(/[^0-9.]/g, ""));
    }
    const filteredListings: ListingWithGeo[] = listings
      .map((rec) => ({
        address: `${rec.street || ""}, ${rec.city || ""}`,
        street: rec.street || "",
        city: rec.city || "",
        neighbourhood: rec.neighbourhood || "",
        seller_type: rec.seller_type,
        property_floors: rec.property_floors,
        property_builded_area: rec.property_builded_area,
        property_type: rec.property_type,
        bulletin_has_balconies: rec.bulletin_has_balconies,
        bulletin_has_elevator: rec.bulletin_has_elevator,
        bulletin_has_parking: rec.bulletin_has_parking,
        price: parsePrice(rec.property_price),
        rooms: parseRooms(rec.property_rooms),
        raw: rec,
      }))
      .filter(
        (rec) =>
          rec.address &&
          !isNaN(rec.price) &&
          !isNaN(rec.rooms) &&
          rec.price <= maxPrice &&
          rec.rooms >= minRooms
      );

    if (!filteredListings.length) {
      return {
        content: [{ type: "text", text: "No listings match price and room filters." }],
      };
    }

    // 3. Fetch POIs
    const pois = await getPOIs(location);
    let relevantEntities: any[] = [];
    if (poiType === "clinic") relevantEntities = pois.clinics;
    else if (poiType === "school") relevantEntities = pois.elementary;
    else relevantEntities = [...pois.clinics, ...pois.elementary];

    if (!relevantEntities.length) {
      return { content: [{ type: "text", text: `No POIs found for type '${poiType}' in ${location}.` }] };
    }

    // 4. Geocode & compute distance for filtered listings
    for (const rec of filteredListings) {
      const geo = await geocodeAddress(rec.address);
      rec.latitude = geo.latitude;
      rec.longitude = geo.longitude;
      rec.formattedAddress = geo.formattedAddress;

      if (rec.latitude == null || rec.longitude == null) {
        rec.closestName = "-";
        rec.closestAddress = "-";
        rec.closestType = "-";
        rec.closestDistanceKm = Number.POSITIVE_INFINITY;
        rec.status = geo.status;
        rec.geocodeError = geo.error || "-";
        continue;
      }

      // Find nearest relevant POI
      let closest = null;
      let minDistance = Number.POSITIVE_INFINITY;
      for (const entity of relevantEntities) {
        const dist = haversineDistance(
          rec.latitude, rec.longitude,
          entity.latitude, entity.longitude
        );
        if (dist < minDistance) {
          minDistance = dist;
          closest = entity;
        }
      }
      rec.closestName = closest ? closest.name : "-";
      rec.closestAddress = closest ? closest.address : "-";
      rec.closestType = closest
        ? closest.type === "elementary school"
          ? "School"
          : (closest.type === "קופת חולים" ? "Clinic" : closest.type)
        : "-";
      rec.closestDistanceKm = isFinite(minDistance) ? minDistance : Number.POSITIVE_INFINITY;
      rec.status = geo.status;
      rec.geocodeError = geo.error || "-";
    }

    // 5. Sort and pick top N
    const sortedListings = filteredListings
      .filter((r) => typeof r.closestDistanceKm === "number" && isFinite(r.closestDistanceKm))
      .sort((a, b) =>
        ((typeof a.closestDistanceKm === "number") ? a.closestDistanceKm : Number.POSITIVE_INFINITY)
        -
        ((typeof b.closestDistanceKm === "number") ? b.closestDistanceKm : Number.POSITIVE_INFINITY)
      )
      .slice(0, topN);

    if (!sortedListings.length) {
      return { content: [{ type: "text", text: "No listings could be geocoded." }] };
    }

    // 6. Output Markdown table
    const mdRows = [
      "| Street | City | Neighbourhood | Price (NIS) | Rooms | Closest POI | POI Address | POI Type | Distance (km) | Seller | Floors | Area | Type | Balconies | Elevator | Parking |",
      "|--------|------|--------------|-------------|-------|-------------|-------------|----------|---------------|--------|--------|------|------|-----------|----------|---------|",
      ...sortedListings.map(
        (r) =>
          `| ${r.street} | ${r.city} | ${r.neighbourhood || ""} | ${r.price} | ${r.rooms} | ${r.closestName} | ${r.closestAddress} | ${r.closestType} | ${
            typeof r.closestDistanceKm === "number" && isFinite(r.closestDistanceKm)
              ? r.closestDistanceKm.toFixed(2)
              : "-"
          } | ${r.seller_type || ""} | ${r.property_floors || ""} | ${r.property_builded_area || ""} | ${r.property_type || ""} | ${r.bulletin_has_balconies || ""} | ${r.bulletin_has_elevator || ""} | ${r.bulletin_has_parking || ""} |`
      ),
    ].join("\n");

    return {
      content: [
        {
          type: "text",
          text: `**Top ${topN} Listings in ${location}, Filtered & Sorted by Distance to ${poiType === "clinic" ? "Clinic" : poiType === "school" ? "School" : "Closest POI"}**\n\n${mdRows}`,
        },
      ],
    };
  }
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Address Geocoder MCP Server running with POI proximity filter");
}
main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
import "dotenv/config";
import express from "express";
import cron from "node-cron";

import {
  iuteDomainForCountry,
  verifyIuteWebhook,
  listLoanProducts,
  listProductMappings,
  upsertProductMappings,
  deleteProductMappings
} from "./iute.js";

import { syncOneOrder } from "./cron.js";
import { addOrderTag } from "./shopify.js";

const app = express();

// We need raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); }
}));

const {
  PORT = 10000,

  IUTE_COUNTRY = "mk",        // mk, al, en, bg, bs, md
  IUTE_TESTMODE = "true",     // "true" or "false"
  IUTE_ADMIN_KEY,

  SHOPIFY_SHOP,               // your-store.myshopify.com
  SHOPIFY_ADMIN_TOKEN,        // Admin API access token (custom app)

  // Optional: comma-separated iute order ids for cron demo
  IUTE_ORDER_IDS = ""
} = process.env;

if (!IUTE_ADMIN_KEY) console.warn("Missing IUTE_ADMIN_KEY");
if (!SHOPIFY_SHOP) console.warn("Missing SHOPIFY_SHOP");
if (!SHOPIFY_ADMIN_TOKEN) console.warn("Missing SHOPIFY_ADMIN_TOKEN");

function getIuteDomain() {
  return iuteDomainForCountry({
    country: IUTE_COUNTRY,
    isTest: String(IUTE_TESTMODE).toLowerCase() === "true"
  });
}

app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Iute callback endpoints (merchant.userConfirmationUrl / userCancelUrl)
 * The doc shows your frontend sends these URLs in iute.checkout JSON. :contentReference[oaicite:8]{index=8}
 */
app.post("/iute/confirm", async (req, res) => {
  try {
    const iuteDomain = getIuteDomain();
    await verifyIuteWebhook({ iuteDomain, rawBody: req.rawBody, headers: req.headers });

    const payload = req.body; // expects { orderId, loanAmount, ... } in Woo; in Shopify you decide
    const iuteOrderId = payload.orderId;

    // Optionally tag the order that matches iuteOrderId
    // (Requires your Shopify order already tagged with IUTE_ORDER_ID:<iuteOrderId>)
    // Here we just run sync now:
    const result = await syncOneOrder({
      shop: SHOPIFY_SHOP,
      accessToken: SHOPIFY_ADMIN_TOKEN,
      iuteDomain,
      adminKey: IUTE_ADMIN_KEY,
      iuteOrderId
    });

    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(409).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/iute/cancel", async (req, res) => {
  try {
    const iuteDomain = getIuteDomain();
    await verifyIuteWebhook({ iuteDomain, rawBody: req.rawBody, headers: req.headers });

    const payload = req.body;
    const iuteOrderId = payload.orderId;

    const result = await syncOneOrder({
      shop: SHOPIFY_SHOP,
      accessToken: SHOPIFY_ADMIN_TOKEN,
      iuteDomain,
      adminKey: IUTE_ADMIN_KEY,
      iuteOrderId
    });

    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(409).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Manual status check endpoint (useful for debugging)
 */
app.get("/iute/status/:orderId", async (req, res) => {
  try {
    const iuteDomain = getIuteDomain();
    const result = await syncOneOrder({
      shop: SHOPIFY_SHOP,
      accessToken: SHOPIFY_ADMIN_TOKEN,
      iuteDomain,
      adminKey: IUTE_ADMIN_KEY,
      iuteOrderId: req.params.orderId
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Optional mapping proxy (so you can manage mappings from your own UI later)
 * Endpoints match the doc. :contentReference[oaicite:9]{index=9}
 */
app.get("/iute/loan-products", async (req, res) => {
  try {
    const iuteDomain = getIuteDomain();
    const data = await listLoanProducts({ iuteDomain, adminKey: IUTE_ADMIN_KEY });
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/iute/mappings", async (req, res) => {
  try {
    const iuteDomain = getIuteDomain();
    const data = await listProductMappings({ iuteDomain, adminKey: IUTE_ADMIN_KEY });
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post("/iute/mappings", async (req, res) => {
  try {
    const iuteDomain = getIuteDomain();
    const mappings = req.body; // [{ productId, sku }]
    const data = await upsertProductMappings({ iuteDomain, adminKey: IUTE_ADMIN_KEY, mappings });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.delete("/iute/mappings", async (req, res) => {
  try {
    const iuteDomain = getIuteDomain();
    const mappings = req.body; // [{ productId, sku }]
    const data = await deleteProductMappings({ iuteDomain, adminKey: IUTE_ADMIN_KEY, mappings });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// --- Simple demo cron (every 5 minutes) per doc suggestion :contentReference[oaicite:10]{index=10}
const cronExpr = "*/5 * * * *";
cron.schedule(cronExpr, async () => {
  const ids = IUTE_ORDER_IDS.split(",").map(s => s.trim()).filter(Boolean);
  if (!ids.length) return;

  const iuteDomain = getIuteDomain();
  for (const iuteOrderId of ids) {
    try {
      await syncOneOrder({
        shop: SHOPIFY_SHOP,
        accessToken: SHOPIFY_ADMIN_TOKEN,
        iuteDomain,
        adminKey: IUTE_ADMIN_KEY,
        iuteOrderId
      });
    } catch (e) {
      console.error("Cron sync failed:", iuteOrderId, e?.message || e);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});

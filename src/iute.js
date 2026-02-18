import crypto from "crypto";

const PUBLIC_KEY_CACHE = {
  pem: null,
  fetchedAt: 0,
  ttlMs: 60 * 60 * 1000 // 1 hour
};

export function iuteDomainForCountry({ country, isTest }) {
  // domains from the integration doc :contentReference[oaicite:4]{index=4}
  const base = isTest ? "https://ecom-stage.iutecredit" : "https://ecom.iutecredit";
  const tldByCountry = {
    al: "al",
    en: "al", // Albania (EN) uses same domain as AL in the Woo plugin logic
    mk: "mk",
    md: "md",
    bg: "bg",
    bs: "ba"
  };
  const tld = tldByCountry[country] ?? "mk";
  return `${base}.${tld}`;
}

export async function getIutePublicKeyPem(iuteDomain) {
  const now = Date.now();
  if (PUBLIC_KEY_CACHE.pem && now - PUBLIC_KEY_CACHE.fetchedAt < PUBLIC_KEY_CACHE.ttlMs) {
    return PUBLIC_KEY_CACHE.pem;
  }
  const res = await fetch(`${iuteDomain}/public-key.pem`);
  if (!res.ok) throw new Error(`Failed to download public key: ${res.status}`);
  const pem = await res.text();

  PUBLIC_KEY_CACHE.pem = pem;
  PUBLIC_KEY_CACHE.fetchedAt = now;
  return pem;
}

export async function verifyIuteWebhook({ iuteDomain, rawBody, headers }) {
  const ts =
    headers["x-iute-timestamp"] ||
    headers["X-Iute-Timestamp"] ||
    headers["x-iute-timestamp".toLowerCase()];

  const sigB64 =
    headers["x-iute-signature"] ||
    headers["X-Iute-Signature"] ||
    headers["x-iute-signature".toLowerCase()];

  if (!ts) throw new Error("Missing x-iute-timestamp header");
  if (!sigB64) throw new Error("Missing x-iute-signature header");

  const signature = Buffer.from(sigB64, "base64");
  const publicKeyPem = await getIutePublicKeyPem(iuteDomain);

  // PHP did: openssl_verify(data + "" + timestamp, signature, publicKey, sha256WithRSAEncryption)
  const message = Buffer.concat([Buffer.from(rawBody, "utf8"), Buffer.from(String(ts), "utf8")]);

  const ok = crypto.verify(
    "RSA-SHA256",
    message,
    publicKeyPem,
    signature
  );

  if (!ok) throw new Error("Signature verification failed");
  return true;
}

export async function getLoanApplicationStatus({ iuteDomain, adminKey, orderId }) {
  const url = new URL(`${iuteDomain}/api/v1/eshop/management/loan-application-status`);
  url.searchParams.set("orderId", orderId);

  const res = await fetch(url.toString(), {
    headers: {
      "accept": "*/*",
      "x-iute-admin-key": adminKey
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Iute status error ${res.status}: ${text}`);
  }
  return res.json();
}

// Optional mapping helpers from doc endpoints :contentReference[oaicite:5]{index=5}
export async function listLoanProducts({ iuteDomain, adminKey }) {
  const res = await fetch(`${iuteDomain}/api/v1/eshop/management/loan-product`, {
    headers: { "accept": "*/*", "x-iute-admin-key": adminKey }
  });
  if (!res.ok) throw new Error(`Loan products error ${res.status}`);
  return res.json();
}

export async function listProductMappings({ iuteDomain, adminKey }) {
  const res = await fetch(`${iuteDomain}/api/v1/eshop/management/product-mapping?size=500`, {
    headers: { "accept": "*/*", "x-iute-admin-key": adminKey }
  });
  if (!res.ok) throw new Error(`Product mappings error ${res.status}`);
  return res.json();
}

export async function upsertProductMappings({ iuteDomain, adminKey, mappings }) {
  // doc uses v2 + batch=true :contentReference[oaicite:6]{index=6}
  const res = await fetch(`${iuteDomain}/api/v2/eshop/management/product-mapping?batch=true`, {
    method: "POST",
    headers: {
      "accept": "*/*",
      "x-iute-admin-key": adminKey,
      "content-type": "application/json"
    },
    body: JSON.stringify(mappings)
  });
  if (!res.ok) throw new Error(`Upsert mappings error ${res.status}`);
  return res.json().catch(() => ({}));
}

export async function deleteProductMappings({ iuteDomain, adminKey, mappings }) {
  const res = await fetch(`${iuteDomain}/api/v2/eshop/management/product-mapping?batch=true`, {
    method: "DELETE",
    headers: {
      "accept": "*/*",
      "x-iute-admin-key": adminKey,
      "content-type": "application/json"
    },
    body: JSON.stringify(mappings)
  });
  if (!res.ok) throw new Error(`Delete mappings error ${res.status}`);
  return res.json().catch(() => ({}));
}

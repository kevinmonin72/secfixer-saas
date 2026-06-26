export interface ShopifyTarget { store: string; token: string; }

async function shopifyFetch(target: ShopifyTarget, path: string, method = "GET", body?: unknown) {
  const host = target.store.includes(".myshopify.com") ? target.store : `${target.store}.myshopify.com`;
  const res = await fetch(`https://${host}/admin/api/2024-01/${path}`, {
    method,
    headers: { "X-Shopify-Access-Token": target.token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getActiveThemeId(target: ShopifyTarget): Promise<string> {
  const data = await shopifyFetch(target, "themes.json");
  const active = (data.themes as { id: number; role: string }[]).find(t => t.role === "main");
  if (!active) throw new Error("Aucun thème actif trouvé.");
  return String(active.id);
}

async function getThemeAsset(target: ShopifyTarget, themeId: string, assetKey: string): Promise<string> {
  const data = await shopifyFetch(target, `themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(assetKey)}`);
  return (data.asset?.value as string) || "";
}

async function updateThemeAsset(target: ShopifyTarget, themeId: string, assetKey: string, value: string): Promise<string> {
  await shopifyFetch(target, `themes/${themeId}/assets.json`, "PUT", { asset: { key: assetKey, value } });
  const host = target.store.includes(".myshopify.com") ? target.store : `${target.store}.myshopify.com`;
  return `https://${host}/admin/themes/${themeId}/editor`;
}

export async function validateShopify(target: ShopifyTarget): Promise<boolean> {
  const data = await shopifyFetch(target, "shop.json");
  return !!data.shop?.name;
}

export async function injectIntoThemeLiquid(target: ShopifyTarget, metaTags: string): Promise<string> {
  const themeId = await getActiveThemeId(target);
  const current = await getThemeAsset(target, themeId, "layout/theme.liquid");
  if (current.includes("secfixer-injected")) return `already-applied:${themeId}`;
  const marker = "<!-- secfixer-injected -->";
  const patched = current.replace(/<\/head>/i, `${marker}\n${metaTags}\n</head>`);
  if (patched === current) throw new Error("Balise </head> introuvable dans theme.liquid.");
  return updateThemeAsset(target, themeId, "layout/theme.liquid", patched);
}

export interface WebflowTarget { token: string; siteId: string; }

async function webflowFetch(target: WebflowTarget, path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.webflow.com/v2${path}`, {
    method,
    headers: { Authorization: `Bearer ${target.token}`, "Content-Type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Webflow API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function validateWebflow(target: WebflowTarget): Promise<boolean> {
  const data = await webflowFetch(target, `/sites/${target.siteId}`);
  return !!data.id;
}

export async function injectCustomCodeWebflow(target: WebflowTarget, headCode: string): Promise<string> {
  const existing = await webflowFetch(target, `/sites/${target.siteId}/custom_code`).catch(() => null);
  const existingHead: string = existing?.customCode?.headCode || "";
  if (existingHead.includes("secfixer-injected")) {
    return `https://webflow.com/dashboard/sites/${target.siteId}/settings/code`;
  }
  const merged = `${existingHead}\n<!-- secfixer-injected -->\n${headCode}`;
  await webflowFetch(target, `/sites/${target.siteId}/custom_code`, "PUT", {
    customCode: { headCode: merged, footerCode: existing?.customCode?.footerCode || "" },
  });
  return `https://webflow.com/dashboard/sites/${target.siteId}/settings/code`;
}

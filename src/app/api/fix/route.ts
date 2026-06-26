import { NextRequest, NextResponse } from "next/server";
import { generatePatches, CmsType } from "@/lib/fix-engine";
import { filterActionable, LocalSecFinding } from "@/lib/localsec-parser";
import { upsertFile, injectMetaTagsIntoHtml, appendToFile, GithubTarget } from "@/lib/adapters/github";
import { validateWp, generateWpMuPlugin, WpTarget } from "@/lib/adapters/wordpress";
import { injectIntoThemeLiquid, validateShopify, ShopifyTarget } from "@/lib/adapters/shopify";
import { injectCustomCodeWebflow, validateWebflow, WebflowTarget } from "@/lib/adapters/webflow";

type FixResult = {
  patchTitle: string;
  status: "applied" | "manual" | "error";
  url?: string;
  error?: string;
  code?: string;
  downloadFile?: { name: string; content: string };
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { findings, cms, credentials, siteUrl } = body as {
      findings: LocalSecFinding[];
      cms: CmsType;
      credentials: Record<string, string>;
      siteUrl: string;
    };

    if (!findings?.length) return NextResponse.json({ error: "Aucun finding fourni." }, { status: 400 });

    const actionable = filterActionable(findings);
    const patches = generatePatches(actionable, cms, siteUrl);
    const results: FixResult[] = [];

    // --- GITHUB PAGES ---
    if (cms === "github_pages" || cms === "nextjs") {
      const [owner, repo] = (credentials.repo || "").split("/");
      if (!owner || !repo || !credentials.token) {
        return NextResponse.json({ error: "Token et repo (owner/repo) requis." }, { status: 400 });
      }
      const target: GithubTarget = { token: credentials.token, owner, repo, branch: credentials.branch || "main" };

      for (const patch of patches) {
        if (!patch.canAutoApply) {
          results.push({ patchTitle: patch.title, status: "manual", code: patch.content || patch.patchContent });
          continue;
        }
        try {
          let url: string | undefined;
          if (patch.action === "create_file" && patch.filePath && patch.content) {
            url = await upsertFile(target, { path: patch.filePath, content: patch.content }, `fix(security): add ${patch.filePath} [SecFixer]`);
          } else if (patch.action === "update_file" && patch.filePath && patch.patchContent) {
            if (patch.filePath.endsWith(".html")) {
              url = await injectMetaTagsIntoHtml(target, patch.filePath, patch.patchContent);
            } else {
              url = await appendToFile(target, patch.filePath, patch.patchContent);
            }
          }
          results.push({ patchTitle: patch.title, status: "applied", url });
        } catch (e) {
          results.push({ patchTitle: patch.title, status: "error", error: (e as Error).message });
        }
      }

    // --- WORDPRESS ---
    } else if (cms === "wordpress") {
      const wpTarget: WpTarget = {
        siteUrl: credentials.wpUrl || siteUrl,
        username: credentials.wpUser || "",
        appPassword: credentials.wpPass || "",
      };

      // Validate credentials if provided
      let wpName = "";
      if (wpTarget.username && wpTarget.appPassword) {
        try {
          const user = await validateWp(wpTarget);
          wpName = user.name;
        } catch (e) {
          return NextResponse.json({ error: `Connexion WordPress échouée : ${(e as Error).message}` }, { status: 401 });
        }
      }

      // Collect all headers from patches
      const SECURITY_HEADERS = [
        "Strict-Transport-Security: max-age=31536000; includeSubDomains; preload",
        "X-Content-Type-Options: nosniff",
        "X-Frame-Options: SAMEORIGIN",
        "Referrer-Policy: strict-origin-when-cross-origin",
        "Permissions-Policy: geolocation=(), camera=(), microphone=()",
        "Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;",
      ];
      const muPluginCode = generateWpMuPlugin(SECURITY_HEADERS);

      for (const patch of patches) {
        if (patch.filePath === "wp-config.php") {
          results.push({
            patchTitle: patch.title,
            status: "manual",
            code: patch.patchContent,
            downloadFile: undefined,
          });
        } else {
          results.push({
            patchTitle: patch.title,
            status: "manual",
            code: patch.patchContent || muPluginCode,
            downloadFile: {
              name: "secfixer-headers.php",
              content: muPluginCode,
            },
          });
        }
      }

      if (wpName) {
        results.unshift({
          patchTitle: `✅ Connecté à WordPress (${wpName})`,
          status: "applied",
          url: wpTarget.siteUrl,
        });
      }

    // --- SHOPIFY ---
    } else if (cms === "shopify") {
      const shTarget: ShopifyTarget = { store: credentials.shStore || "", token: credentials.shToken || "" };
      if (!shTarget.store || !shTarget.token) {
        return NextResponse.json({ error: "Nom du store et Admin API token requis pour Shopify." }, { status: 400 });
      }
      try { await validateShopify(shTarget); } catch (e) {
        return NextResponse.json({ error: `Connexion Shopify échouée : ${(e as Error).message}` }, { status: 401 });
      }
      for (const patch of patches) {
        if (!patch.canAutoApply || !patch.patchContent) {
          results.push({ patchTitle: patch.title, status: "manual", code: patch.patchContent || patch.content });
          continue;
        }
        try {
          const url = await injectIntoThemeLiquid(shTarget, patch.patchContent);
          results.push({ patchTitle: patch.title, status: "applied", url });
        } catch (e) {
          results.push({ patchTitle: patch.title, status: "error", error: (e as Error).message });
        }
      }

    // --- WEBFLOW ---
    } else if (cms === "webflow") {
      const wfTarget: WebflowTarget = { token: credentials.wfToken || "", siteId: credentials.wfSiteId || "" };
      if (!wfTarget.token || !wfTarget.siteId) {
        return NextResponse.json({ error: "API Token et Site ID requis pour Webflow." }, { status: 400 });
      }
      try { await validateWebflow(wfTarget); } catch (e) {
        return NextResponse.json({ error: `Connexion Webflow échouée : ${(e as Error).message}` }, { status: 401 });
      }
      const allMeta = patches.filter(p => p.patchContent || p.content).map(p => p.patchContent || p.content || "").join("\n");
      if (allMeta) {
        try {
          const url = await injectCustomCodeWebflow(wfTarget, allMeta);
          results.push({ patchTitle: `${patches.length} correctif(s) injectés dans le Custom Code`, status: "applied", url });
        } catch (e) {
          results.push({ patchTitle: "Injection Webflow", status: "error", error: (e as Error).message });
        }
      }

    // --- GENERIC / WIX ---
    } else {
      for (const patch of patches) {
        results.push({ patchTitle: patch.title, status: "manual", code: patch.content || patch.patchContent });
      }
    }

    return NextResponse.json({ results, patchCount: patches.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

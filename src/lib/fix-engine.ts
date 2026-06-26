import { LocalSecFinding } from "./localsec-parser";

export type CmsType = "github_pages" | "wordpress" | "shopify" | "generic" | "webflow" | "wix" | "nextjs";

export interface Patch {
  findingId: string;
  severity: string;
  title: string;
  action: "create_file" | "update_file" | "update_theme" | "wp_option" | "manual";
  filePath?: string;
  content?: string;
  patchContent?: string;
  description: string;
  canAutoApply: boolean;
}

// --- HEADER PATCHES ---
const SECURITY_HEADERS = [
  "Strict-Transport-Security: max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options: nosniff",
  "X-Frame-Options: SAMEORIGIN",
  "Referrer-Policy: strict-origin-when-cross-origin",
  "Permissions-Policy: geolocation=(), camera=(), microphone=()",
];

function headersFileContent(extra: string[] = []): string {
  return `/*\n${[...SECURITY_HEADERS, ...extra].map(h => `  ${h}`).join("\n")}\n`;
}

function cspValue(finding: LocalSecFinding): string {
  if (finding.id?.includes("MISSING_CSP")) return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';";
  return "default-src 'self';";
}

function wpFunctionsSnippet(headers: string[]): string {
  const lines = headers.map(h => {
    const [name, ...rest] = h.split(": ");
    return `  header('${name}: ${rest.join(": ")}');`;
  });
  return `// SecFixer — Security Headers
if (!function_exists('secfixer_security_headers')) {
  function secfixer_security_headers() {
${lines.join("\n")}
  }
  add_action('send_headers', 'secfixer_security_headers');
}`;
}

// --- FIX ENGINE ---
export function generatePatches(findings: LocalSecFinding[], cms: CmsType, siteUrl: string): Patch[] {
  const patches: Patch[] = [];
  const headerFindings = findings.filter(f => f.category === "Security Headers" || f.id?.includes("MISSING_") || f.id?.includes("HSTS") || f.id?.includes("CSP") || f.id?.includes("FRAME") || f.id?.includes("CONTENT_TYPE"));
  const cspFindings = findings.filter(f => f.category === "CSP" || f.id?.includes("CSP_MISSING") || f.id?.includes("MISSING_CSP"));
  const cookieFindings = findings.filter(f => f.category === "Cookies Security");
  const vulnLibFindings = findings.filter(f => f.category === "Vulnerable Library" || f.category === "CVE (passif fingerprint)");
  const trackerFindings = findings.filter(f => f.category === "Tracker / RGPD");

  // HEADERS PATCH
  if (headerFindings.length > 0) {
    const extraHeaders: string[] = [];
    if (cspFindings.length > 0) extraHeaders.push(`Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;`);

    if (cms === "github_pages") {
      patches.push({
        findingId: headerFindings[0].id,
        severity: "High",
        title: `${headerFindings.length} header(s) de sécurité manquants`,
        action: "create_file",
        filePath: "_headers",
        content: headersFileContent(extraHeaders),
        description: "Crée/remplace le fichier _headers à la racine du repo (compatible Netlify/Cloudflare Pages). Pour GitHub Pages natif, les meta-CSP sont injectées dans index.html.",
        canAutoApply: true,
      });
      // Also patch index.html with meta tags for pure GitHub Pages
      patches.push({
        findingId: "GH_META_CSP",
        severity: "Medium",
        title: "Meta tags de sécurité dans index.html",
        action: "update_file",
        filePath: "index.html",
        patchContent: `  <meta http-equiv="X-Frame-Options" content="SAMEORIGIN">\n  <meta http-equiv="X-Content-Type-Options" content="nosniff">\n  <meta http-equiv="Content-Security-Policy" content="${cspValue(cspFindings[0] || headerFindings[0])}">`,
        description: "Injecte les meta tags dans <head> de index.html (GitHub Pages ne supporte pas les headers HTTP custom).",
        canAutoApply: true,
      });
    } else if (cms === "wordpress") {
      const wpHeaders = [...SECURITY_HEADERS, ...extraHeaders];
      patches.push({
        findingId: headerFindings[0].id,
        severity: "High",
        title: `${headerFindings.length} header(s) via functions.php`,
        action: "update_file",
        filePath: "wp-content/themes/[votre-theme]/functions.php",
        patchContent: wpFunctionsSnippet(wpHeaders),
        description: "Injecte les headers HTTP via add_action('send_headers') dans functions.php du thème actif.",
        canAutoApply: true,
      });
    } else if (cms === "nextjs") {
      patches.push({
        findingId: headerFindings[0].id,
        severity: "High",
        title: `${headerFindings.length} header(s) dans next.config.js`,
        action: "update_file",
        filePath: "next.config.js",
        patchContent: `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  async headers() {\n    return [\n      {\n        source: '/(.*)',\n        headers: [\n          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },\n          { key: 'X-Content-Type-Options', value: 'nosniff' },\n          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },\n          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },\n          { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=()' },\n          ${extraHeaders.length ? `{ key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" },` : ""}\n        ],\n      },\n    ];\n  },\n};\nmodule.exports = nextConfig;`,
        description: "Ajoute un bloc headers() dans next.config.js — appliqué à toutes les routes.",
        canAutoApply: true,
      });
    } else if (cms === "webflow") {
      patches.push({
        findingId: headerFindings[0].id,
        severity: "High",
        title: `${headerFindings.length} header(s) — Custom Code Webflow`,
        action: "manual",
        content: `<!-- Coller dans Project Settings → Custom Code → Head Code -->\n<meta http-equiv="X-Frame-Options" content="SAMEORIGIN">\n<meta http-equiv="X-Content-Type-Options" content="nosniff">\n<meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">\n${extraHeaders.length ? `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;">` : ""}\n\n<!-- Note: HSTS requiert un plan Webflow Enterprise ou proxy Cloudflare -->\n<!-- Cloudflare → SSL/TLS → Edge Certificates → HSTS : activé -->`,
        description: "Meta tags dans Project Settings → Custom Code (Head). HSTS via Cloudflare proxy.",
        canAutoApply: false,
      });
    } else if (cms === "wix") {
      patches.push({
        findingId: headerFindings[0].id,
        severity: "High",
        title: `${headerFindings.length} header(s) — Wix Velo (http-functions)`,
        action: "manual",
        content: `// Wix Velo — Coller dans Site → Developer Tools → http-functions.js\n// (ou via Cloudflare proxy pour les vrais headers HTTP)\nimport { ok, serverError } from 'wix-http-functions';\n\nexport function use_middleware(request, context) {\n  // Wix ne supporte pas les headers HTTP custom natifs\n  // Solution recommandée : router via Cloudflare avec ces règles :\n  // Cloudflare → Transform Rules → Response Headers:\n  //   - Strict-Transport-Security: max-age=31536000\n  //   - X-Frame-Options: SAMEORIGIN\n  //   - X-Content-Type-Options: nosniff\n  //   - Referrer-Policy: strict-origin-when-cross-origin\n  return context.next();\n}\n\n// Alternative : SEO → Custom Meta Tags\n// <meta name="referrer" content="strict-origin-when-cross-origin">\n// <meta http-equiv="X-Frame-Options" content="SAMEORIGIN">`,
        description: "Wix ne supporte pas les headers HTTP natifs — solution via Cloudflare proxy ou meta tags dans SEO → Custom Meta Tags.",
        canAutoApply: false,
      });
    } else if (cms === "shopify") {
      patches.push({
        findingId: headerFindings[0].id,
        severity: "High",
        title: "Meta tags dans theme.liquid",
        action: "update_theme",
        filePath: "layout/theme.liquid",
        patchContent: `  <meta http-equiv="X-Frame-Options" content="SAMEORIGIN">\n  <meta http-equiv="Content-Security-Policy" content="${cspValue(cspFindings[0] || headerFindings[0])}">`,
        description: "Ajoute les meta tags de sécurité dans le <head> de layout/theme.liquid.",
        canAutoApply: true,
      });
    } else {
      patches.push({
        findingId: headerFindings[0].id,
        severity: "High",
        title: "Configuration headers serveur (Nginx/Apache)",
        action: "manual",
        content: `# Nginx\nadd_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;\nadd_header X-Content-Type-Options "nosniff" always;\nadd_header X-Frame-Options "SAMEORIGIN" always;\nadd_header Referrer-Policy "strict-origin-when-cross-origin" always;\nadd_header Permissions-Policy "geolocation=(), camera=(), microphone=()" always;\n${extraHeaders.length ? `add_header Content-Security-Policy "${cspValue(cspFindings[0] || headerFindings[0])}" always;\n` : ""}\n# Apache (.htaccess)\nHeader always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"\nHeader always set X-Content-Type-Options "nosniff"\nHeader always set X-Frame-Options "SAMEORIGIN"`,
        description: "Patch de configuration pour Nginx ou Apache à appliquer sur le serveur.",
        canAutoApply: false,
      });
    }
  }

  // COOKIES PATCH
  if (cookieFindings.length > 0 && cms === "wordpress") {
    patches.push({
      findingId: cookieFindings[0].id,
      severity: cookieFindings[0].severity,
      title: "Cookies session — SameSite + Secure + HttpOnly",
      action: "update_file",
      filePath: "wp-config.php",
      patchContent: `// SecFixer — Cookie Security\n@ini_set('session.cookie_secure', true);\n@ini_set('session.cookie_httponly', true);\n@ini_set('session.cookie_samesite', 'Lax');\ndefine('COOKIE_DOMAIN', parse_url('${siteUrl}', PHP_URL_HOST) ?: '');`,
      description: "Force les flags Secure + HttpOnly + SameSite=Lax sur les cookies de session WordPress.",
      canAutoApply: true,
    });
  }

  // VULN LIBS PATCH (GitHub Pages / generic)
  if (vulnLibFindings.length > 0) {
    for (const f of vulnLibFindings) {
      const libMatch = f.title.match(/^([\w.-]+)\s+([\d.]+)\s*:/);
      if (!libMatch) continue;
      const [, libName, libVersion] = libMatch;
      const fixedMatch = f.evidence?.match(/corrigé en ([\d.]+)/);
      const fixedVersion = fixedMatch ? fixedMatch[1] : "latest";
      patches.push({
        findingId: f.id,
        severity: f.severity,
        title: `Mise à jour ${libName} ${libVersion} → ${fixedVersion}+`,
        action: cms === "github_pages" ? "update_file" : "manual",
        filePath: cms === "github_pages" ? "package.json" : undefined,
        patchContent: cms === "github_pages" ? `"${libName}": "^${fixedVersion}"` : undefined,
        content: cms !== "github_pages" ? `npm install ${libName}@^${fixedVersion}\n# ou via Composer/pip selon votre stack` : undefined,
        description: f.evidence?.split("\n").slice(0, 2).join(" | ") || f.description,
        canAutoApply: cms === "github_pages",
      });
    }
  }

  // TRACKER RGPD PATCH
  if (trackerFindings.length > 0) {
    const snippet = `<!-- SecFixer — Consent Gate RGPD -->\n<script>\n(function(){\n  var consent = localStorage.getItem('secfixer_consent');\n  if (consent !== '1') {\n    document.querySelectorAll('[data-tracker]').forEach(function(el){ el.remove(); });\n    // Afficher votre bannière de consentement ici\n  }\n})();\n</script>`;
    patches.push({
      findingId: trackerFindings[0].id,
      severity: "Medium",
      title: `${trackerFindings.length} traceur(s) RGPD — consent gate`,
      action: cms === "shopify" ? "update_theme" : cms === "github_pages" ? "update_file" : "manual",
      filePath: cms === "shopify" ? "layout/theme.liquid" : cms === "github_pages" ? "index.html" : undefined,
      patchContent: snippet,
      description: "Ajoute un consent gate qui bloque les traceurs jusqu'au consentement explicite (RGPD Art. 6 + ePrivacy).",
      canAutoApply: false,
    });
  }

  // Deduplicate by filePath
  const seen = new Set<string>();
  return patches.filter(p => {
    const key = p.filePath || p.findingId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

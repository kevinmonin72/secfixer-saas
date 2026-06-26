"use client";
import { useState, useCallback, useRef } from "react";
import { parseLocalSecHtml, LocalSecReport, filterActionable, LocalSecFinding } from "@/lib/localsec-parser";
import { generatePatches, CmsType, Patch } from "@/lib/fix-engine";

const SEV_COLOR: Record<string, string> = {
  Critical: "#ef4444", High: "#f97316", Medium: "#f59e0b", Low: "#0ea5e9", Info: "#64748b",
};
const SEV_BG: Record<string, string> = {
  Critical: "#450a0a", High: "#431407", Medium: "#451a03", Low: "#082f49", Info: "#0f172a",
};
const CMS_OPTIONS: { value: CmsType; label: string; icon: string; desc: string }[] = [
  { value: "wordpress", label: "WordPress", icon: "🔵", desc: "WP REST API" },
  { value: "webflow", label: "Webflow", icon: "🌊", desc: "Custom Code + API" },
  { value: "wix", label: "Wix", icon: "⬛", desc: "Velo + Cloudflare" },
  { value: "nextjs", label: "Next.js / React", icon: "⚡", desc: "next.config.js" },
  { value: "github_pages", label: "GitHub Pages", icon: "🐙", desc: "Commit via API" },
  { value: "shopify", label: "Shopify", icon: "🛍️", desc: "Theme liquid" },
  { value: "generic", label: "Nginx / Apache", icon: "⚙️", desc: "Config serveur" },
];
type FixResult = { patchTitle: string; status: "applied"|"manual"|"error"; url?: string; error?: string; code?: string };

function Badge({ sev }: { sev: string }) {
  return (
    <span style={{ fontSize: ".72em", fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: SEV_BG[sev], color: SEV_COLOR[sev], border: `1px solid ${SEV_COLOR[sev]}44`, textTransform: "uppercase", letterSpacing: ".06em", whiteSpace: "nowrap" }}>{sev}</span>
  );
}

function Step({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: ".88em", background: done ? "#16a34a" : active ? "#2563eb" : "#1e293b", color: done || active ? "#fff" : "#475569", border: `2px solid ${done ? "#16a34a" : active ? "#3b82f6" : "#334155"}`, transition: "all .3s" }}>
        {done ? "✓" : n}
      </div>
      <span style={{ fontWeight: done || active ? 600 : 400, color: done || active ? "#f1f5f9" : "#475569", fontSize: ".9em" }}>{label}</span>
    </div>
  );
}

export default function SecFixerPage() {
  const [report, setReport] = useState<LocalSecReport | null>(null);
  const [actionable, setActionable] = useState<LocalSecFinding[]>([]);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [cms, setCms] = useState<CmsType>("github_pages");
  const [ghToken, setGhToken] = useState("");
  const [ghRepo, setGhRepo] = useState("");
  const [ghBranch, setGhBranch] = useState("main");
  const [wpUrl, setWpUrl] = useState("");
  const [wpUser, setWpUser] = useState("");
  const [wpPass, setWpPass] = useState("");
  const [wfToken, setWfToken] = useState("");
  const [wfSiteId, setWfSiteId] = useState("");
  const [shStore, setShStore] = useState("");
  const [shToken, setShToken] = useState("");
  const [results, setResults] = useState<FixResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<1|2|3>(1);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const processHtml = (html: string) => {
    try {
      const reports = parseLocalSecHtml(html);
      if (!reports.length) throw new Error("Aucun rapport LocalSec trouvé dans ce fichier.");
      const r = reports[0];
      setReport(r);
      const a = filterActionable(r.findings);
      setActionable(a);
      setPatches(generatePatches(a, cms, r.siteUrl));
      setError("");
      setStep(2);
    } catch (err) { setError((err as Error).message); }
  };

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => processHtml(ev.target?.result as string);
    reader.readAsText(file);
  }, [cms]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => processHtml(ev.target?.result as string);
    reader.readAsText(file);
  }, [cms]);

  const handleCmsChange = (v: CmsType) => {
    setCms(v);
    if (report) setPatches(generatePatches(actionable, v, report.siteUrl));
  };

  const handleFixAll = async () => {
    if (!report) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings: actionable, cms, siteUrl: report.siteUrl, credentials: { token: ghToken, repo: ghRepo, branch: ghBranch, wpUrl, wpUser, wpPass, wfToken, wfSiteId, shStore, shToken } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(data.results);
      setStep(3);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };

  const sevCount = (sev: string) => actionable.filter(f => f.severity === sev).length;
  const autoCount = patches.filter(p => p.canAutoApply).length;
  const manualCount = patches.filter(p => !p.canAutoApply).length;
  const applied = results.filter(r => r.status === "applied").length;
  const manual = results.filter(r => r.status === "manual").length;
  const errCount = results.filter(r => r.status === "error").length;

  const card = (children: React.ReactNode, extra?: React.CSSProperties) => (
    <div style={{ background: "rgba(30,41,59,.7)", border: "1px solid #1e293b", borderRadius: 14, padding: 24, backdropFilter: "blur(8px)", ...extra }}>{children}</div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(ellipse at top left, #0f2040 0%, #0f172a 50%, #080d1a 100%)", padding: "0 0 80px" }}>

      {/* NAV */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 40px", borderBottom: "1px solid #1e293b", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100, background: "rgba(15,23,42,.85)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🔧</span>
          <span style={{ fontWeight: 800, fontSize: "1.1em", background: "linear-gradient(135deg,#38bdf8,#818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>SecFixer</span>
          <span style={{ fontSize: ".72em", padding: "2px 8px", borderRadius: 4, background: "#1e293b", color: "#64748b", border: "1px solid #334155", marginLeft: 4 }}>v1.0</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Step n={1} label="Import" active={step === 1} done={step > 1} />
          <div style={{ width: 32, height: 2, background: "#334155", alignSelf: "center" }} />
          <Step n={2} label="Configurer" active={step === 2} done={step > 2} />
          <div style={{ width: 32, height: 2, background: "#334155", alignSelf: "center" }} />
          <Step n={3} label="Résultats" active={step === 3} done={false} />
        </div>
        <div style={{ fontSize: ".8em", color: "#475569" }}>LocalSec Audit Pro →</div>
      </nav>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>

        {/* ===== STEP 1 — IMPORT ===== */}
        {step === 1 && (
          <div style={{ display: "grid", gap: 32 }}>
            <div style={{ textAlign: "center" }}>
              <h1 style={{ fontSize: "2.6em", fontWeight: 900, margin: "0 0 12px", lineHeight: 1.15 }}>
                <span style={{ background: "linear-gradient(135deg,#38bdf8,#818cf8,#e879f9)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Auto-patch</span>
                <br /><span style={{ color: "#f1f5f9" }}>tes failles de sécurité</span>
              </h1>
              <p style={{ color: "#94a3b8", fontSize: "1.1em", margin: 0 }}>Import un rapport LocalSec → choisis le CMS → toutes les failles sont corrigées en 1 clic.</p>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? "#3b82f6" : "#334155"}`,
                borderRadius: 16,
                padding: "64px 40px",
                textAlign: "center",
                cursor: "pointer",
                background: dragging ? "rgba(37,99,235,.08)" : "rgba(30,41,59,.4)",
                transition: "all .2s",
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
              <div style={{ fontWeight: 700, fontSize: "1.15em", color: "#e2e8f0", marginBottom: 8 }}>
                {dragging ? "Relâche ici" : "Glisse le rapport LocalSec ici"}
              </div>
              <div style={{ color: "#64748b", fontSize: ".9em", marginBottom: 24 }}>ou clique pour choisir un fichier (.html)</div>
              <div style={{ display: "inline-block", background: "linear-gradient(135deg,#2563eb,#7c3aed)", padding: "10px 28px", borderRadius: 8, fontWeight: 700, color: "#fff", fontSize: ".95em" }}>Choisir le rapport</div>
              <input ref={fileRef} type="file" accept=".html" onChange={handleFile} style={{ display: "none" }} />
            </div>

            {error && (
              <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 10, padding: 16, color: "#fca5a5" }}>⚠️ {error}</div>
            )}

            {/* How it works */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
              {[
                { icon: "📥", title: "1. Import", desc: "Exporte le rapport HTML depuis LocalSec Audit Pro" },
                { icon: "⚡", title: "2. Auto-fix", desc: "SecFixer génère et applique les patches via l'API du CMS" },
                { icon: "✅", title: "3. Vérifié", desc: "Chaque correctif est documenté avec lien vers le commit" },
              ].map(item => (
                <div key={item.title} style={{ background: "rgba(30,41,59,.5)", border: "1px solid #1e293b", borderRadius: 12, padding: 20, textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>{item.icon}</div>
                  <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>{item.title}</div>
                  <div style={{ color: "#64748b", fontSize: ".85em" }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== STEP 2 — CONFIGURE ===== */}
        {step === 2 && report && (
          <div style={{ display: "grid", gap: 20 }}>

            {/* Site card */}
            {card(
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
                <div>
                  <div style={{ fontSize: ".75em", color: "#64748b", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>Site audité</div>
                  <div style={{ fontWeight: 700, color: "#38bdf8", fontSize: "1.05em", wordBreak: "break-all" }}>{report.siteUrl}</div>
                  <div style={{ color: "#64748b", fontSize: ".85em", marginTop: 6 }}>Score <strong style={{ color: "#f1f5f9" }}>{report.score}/100</strong> — Grade <strong style={{ color: "#f1f5f9" }}>{report.grade}</strong> — <strong style={{ color: "#f97316" }}>{actionable.length} failles</strong> à corriger</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(["Critical","High","Medium"] as const).map(s => sevCount(s) > 0 && (
                    <div key={s} style={{ background: SEV_BG[s], border: `1px solid ${SEV_COLOR[s]}44`, borderRadius: 8, padding: "8px 14px", textAlign: "center" }}>
                      <div style={{ fontSize: "1.4em", fontWeight: 800, color: SEV_COLOR[s] }}>{sevCount(s)}</div>
                      <div style={{ fontSize: ".7em", color: SEV_COLOR[s], fontWeight: 600, textTransform: "uppercase" }}>{s}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CMS select */}
            {card(
              <>
                <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 16, fontSize: ".95em" }}>Type de CMS / hébergement</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, gridTemplateRows: "auto" }}>
                  {CMS_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => handleCmsChange(opt.value)} style={{
                      padding: "14px 18px", borderRadius: 10, border: `2px solid ${cms === opt.value ? "#3b82f6" : "#1e293b"}`,
                      background: cms === opt.value ? "rgba(37,99,235,.15)" : "rgba(15,23,42,.6)",
                      color: "#f1f5f9", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 12, transition: "all .2s",
                    }}>
                      <span style={{ fontSize: 22 }}>{opt.icon}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: ".9em" }}>{opt.label}</div>
                        <div style={{ fontSize: ".75em", color: "#64748b" }}>{opt.desc}</div>
                      </div>
                      {cms === opt.value && <div style={{ marginLeft: "auto", color: "#3b82f6", fontWeight: 700 }}>✓</div>}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Webflow credentials */}
            {cms === "webflow" && card(
              <>
                <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 6, fontSize: ".95em" }}>Accès Webflow</div>
                <div style={{ color: "#64748b", fontSize: ".82em", marginBottom: 16 }}>
                  Token API : <strong style={{ color: "#94a3b8" }}>Account Settings → Integrations → API Access → Generate API token</strong><br />
                  Site ID : URL du dashboard Webflow → <code style={{ color: "#38bdf8" }}>webflow.com/dashboard/sites/[SITE-ID]</code>
                </div>
                <div style={{ display: "grid", gap: 12 }}>
                  {[
                    { val: wfToken, set: setWfToken, ph: "Webflow API Token", type: "password" as const, icon: "🔑" },
                    { val: wfSiteId, set: setWfSiteId, ph: "Site ID (ex: 64a3f2b1c8e9d...)", type: "text" as const, icon: "🌊" },
                  ].map((field, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(15,23,42,.8)", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px" }}>
                      <span style={{ fontSize: 16 }}>{field.icon}</span>
                      <input value={field.val} onChange={e => field.set(e.target.value)} placeholder={field.ph} type={field.type}
                        style={{ flex: 1, background: "none", border: "none", color: "#f1f5f9", fontSize: ".9em", outline: "none" }} />
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(56,189,248,.06)", border: "1px solid rgba(56,189,248,.15)", borderRadius: 6, color: "#64748b", fontSize: ".78em" }}>
                  ℹ️ Le code sera injecté dans Custom Code Head via l'API Webflow. Pour HSTS, activer via Cloudflare.
                </div>
              </>
            )}

            {/* Wix info */}
            {cms === "wix" && card(
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <span style={{ fontSize: 28 }}>ℹ️</span>
                <div>
                  <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>Wix — correction via Cloudflare</div>
                  <div style={{ color: "#94a3b8", fontSize: ".85em", lineHeight: 1.7 }}>
                    Wix ne supporte pas les headers HTTP custom natifs. Les patches générés contiennent le code <strong style={{ color: "#f1f5f9" }}>Cloudflare Transform Rules</strong> à appliquer si ton domaine est proxié, ainsi que les meta tags disponibles dans <strong style={{ color: "#f1f5f9" }}>SEO → Custom Meta Tags</strong>.
                  </div>
                </div>
              </div>
            )}

            {/* Next.js credentials (via GitHub) */}
            {cms === "nextjs" && card(
              <>
                <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 6, fontSize: ".95em" }}>Accès GitHub (repo Next.js)</div>
                <div style={{ color: "#64748b", fontSize: ".82em", marginBottom: 16 }}>Les patches (next.config.js) seront commités directement dans le repo GitHub du projet.</div>
                <div style={{ display: "grid", gap: 12 }}>
                  {[
                    { val: ghToken, set: setGhToken, ph: "Personal Access Token (repo scope)", type: "password" as const, icon: "🔑" },
                    { val: ghRepo, set: setGhRepo, ph: "owner/repo (ex: client72/mon-nextjs-site)", type: "text" as const, icon: "📁" },
                    { val: ghBranch, set: setGhBranch, ph: "Branch (défaut : main)", type: "text" as const, icon: "🌿" },
                  ].map((field, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(15,23,42,.8)", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px" }}>
                      <span style={{ fontSize: 16 }}>{field.icon}</span>
                      <input value={field.val} onChange={e => field.set(e.target.value)} placeholder={field.ph} type={field.type}
                        style={{ flex: 1, background: "none", border: "none", color: "#f1f5f9", fontSize: ".9em", outline: "none" }} />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* WordPress credentials */}
            {cms === "wordpress" && card(
              <>
                <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 6, fontSize: ".95em" }}>Accès WordPress</div>
                <div style={{ color: "#64748b", fontSize: ".82em", marginBottom: 16 }}>Utilise un <strong style={{ color: "#94a3b8" }}>Mot de passe d'application</strong> WordPress (pas ton mot de passe admin) — Réglages → Profil → Mots de passe d'application.</div>
                <div style={{ display: "grid", gap: 12 }}>
                  {[
                    { val: wpUrl, set: setWpUrl, ph: "URL du site (ex: https://lapelle-marseille.com)", type: "text" as const, icon: "🌐" },
                    { val: wpUser, set: setWpUser, ph: "Identifiant WordPress (ex: admin)", type: "text" as const, icon: "👤" },
                    { val: wpPass, set: setWpPass, ph: "Mot de passe d'application (xxxx xxxx xxxx xxxx)", type: "password" as const, icon: "🔑" },
                  ].map((field, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(15,23,42,.8)", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px" }}>
                      <span style={{ fontSize: 16 }}>{field.icon}</span>
                      <input value={field.val} onChange={e => field.set(e.target.value)} placeholder={field.ph} type={field.type}
                        style={{ flex: 1, background: "none", border: "none", color: "#f1f5f9", fontSize: ".9em", outline: "none" }} />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Shopify credentials */}
            {cms === "shopify" && card(
              <>
                <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 6, fontSize: ".95em" }}>Accès Shopify</div>
                <div style={{ color: "#64748b", fontSize: ".82em", marginBottom: 16 }}>
                  Admin API token : <strong style={{ color: "#94a3b8" }}>Apps → Develop apps → Create app → Admin API access token</strong> (scope : <code style={{ color: "#38bdf8" }}>write_themes</code>)
                </div>
                <div style={{ display: "grid", gap: 12 }}>
                  {[
                    { val: shStore, set: setShStore, ph: "Nom du store (ex: mon-store.myshopify.com)", type: "text" as const, icon: "🛍️" },
                    { val: shToken, set: setShToken, ph: "Admin API Access Token (shpat_...)", type: "password" as const, icon: "🔑" },
                  ].map((field, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(15,23,42,.8)", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px" }}>
                      <span style={{ fontSize: 16 }}>{field.icon}</span>
                      <input value={field.val} onChange={e => field.set(e.target.value)} placeholder={field.ph} type={field.type}
                        style={{ flex: 1, background: "none", border: "none", color: "#f1f5f9", fontSize: ".9em", outline: "none" }} />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* GitHub credentials */}
            {cms === "github_pages" && card(
              <>
                <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 6, fontSize: ".95em" }}>Accès GitHub</div>
                <div style={{ color: "#64748b", fontSize: ".82em", marginBottom: 16 }}>Les patches seront commités directement dans le repo du client.</div>
                <div style={{ display: "grid", gap: 12 }}>
                  {[
                    { val: ghToken, set: setGhToken, ph: "Personal Access Token (repo scope)", type: "password" as const, icon: "🔑" },
                    { val: ghRepo, set: setGhRepo, ph: "owner/repo (ex: client72/mon-site)", type: "text" as const, icon: "📁" },
                    { val: ghBranch, set: setGhBranch, ph: "Branch (défaut : main)", type: "text" as const, icon: "🌿" },
                  ].map((field, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(15,23,42,.8)", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px" }}>
                      <span style={{ fontSize: 16 }}>{field.icon}</span>
                      <input value={field.val} onChange={e => field.set(e.target.value)} placeholder={field.ph} type={field.type}
                        style={{ flex: 1, background: "none", border: "none", color: "#f1f5f9", fontSize: ".9em", outline: "none" }} />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Patches list */}
            {card(
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: ".95em" }}>{patches.length} patch(es) générés</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ fontSize: ".78em", padding: "3px 10px", borderRadius: 20, background: "#052e16", color: "#6ee7b7", border: "1px solid #14532d" }}>⚡ {autoCount} auto</span>
                    <span style={{ fontSize: ".78em", padding: "3px 10px", borderRadius: 20, background: "#1e293b", color: "#94a3b8", border: "1px solid #334155" }}>📋 {manualCount} manuel</span>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {patches.map(p => (
                    <div key={p.findingId} style={{ background: "rgba(15,23,42,.6)", borderRadius: 8, padding: 14, borderLeft: `3px solid ${SEV_COLOR[p.severity] || "#475569"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 600, color: "#e2e8f0", fontSize: ".9em" }}>{p.title}</div>
                          {p.filePath && <div style={{ fontFamily: "monospace", fontSize: ".75em", color: "#38bdf8", marginTop: 4 }}>→ {p.filePath}</div>}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                          <Badge sev={p.severity} />
                          <span style={{ fontSize: ".75em", padding: "3px 10px", borderRadius: 20, background: p.canAutoApply ? "#052e16" : "#1e293b", color: p.canAutoApply ? "#6ee7b7" : "#94a3b8", border: p.canAutoApply ? "1px solid #14532d" : "1px solid #334155" }}>
                            {p.canAutoApply ? "⚡ Auto" : "📋 Manuel"}
                          </span>
                        </div>
                      </div>
                      <div style={{ color: "#64748b", fontSize: ".8em", marginTop: 6, lineHeight: 1.5 }}>{p.description}</div>
                    </div>
                  ))}
                  {patches.length === 0 && <div style={{ color: "#64748b", textAlign: "center", padding: 24 }}>Aucun patch généré — excellent, le site est déjà bien configuré.</div>}
                </div>
              </>
            )}

            {error && (
              <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 10, padding: 16, color: "#fca5a5" }}>⚠️ {error}</div>
            )}

            <button onClick={handleFixAll} disabled={loading || patches.length === 0} style={{
              background: loading || patches.length === 0 ? "#1e293b" : "linear-gradient(135deg,#2563eb,#7c3aed)",
              color: loading || patches.length === 0 ? "#475569" : "#fff",
              border: "none", padding: "18px 32px", borderRadius: 12,
              fontSize: "1.05em", fontWeight: 800, cursor: loading || patches.length === 0 ? "not-allowed" : "pointer",
              width: "100%", letterSpacing: ".02em", transition: "all .2s",
            }}>
              {loading
                ? "⏳ Application des patches en cours…"
                : patches.length === 0
                ? "✅ Aucun patch nécessaire"
                : `🚀 Appliquer ${autoCount} patch(es) auto + générer ${manualCount} correctif(s) manuel`}
            </button>
          </div>
        )}

        {/* ===== STEP 3 — RESULTS ===== */}
        {step === 3 && (
          <div style={{ display: "grid", gap: 20 }}>
            {/* Score card */}
            {card(
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, textAlign: "center" }}>
                <div>
                  <div style={{ fontSize: "2.5em", fontWeight: 900, color: "#22c55e" }}>{applied}</div>
                  <div style={{ color: "#64748b", fontSize: ".85em", marginTop: 4 }}>✅ Appliqués automatiquement</div>
                </div>
                <div>
                  <div style={{ fontSize: "2.5em", fontWeight: 900, color: "#f59e0b" }}>{manual}</div>
                  <div style={{ color: "#64748b", fontSize: ".85em", marginTop: 4 }}>📋 Code généré (copie)</div>
                </div>
                <div>
                  <div style={{ fontSize: "2.5em", fontWeight: 900, color: errCount > 0 ? "#ef4444" : "#6ee7b7" }}>{errCount}</div>
                  <div style={{ color: "#64748b", fontSize: ".85em", marginTop: 4 }}>{errCount > 0 ? "❌ Erreurs" : "🎯 Aucune erreur"}</div>
                </div>
              </div>
            )}

            {results.map((r, i) => (
              <div key={i} style={{
                background: "rgba(30,41,59,.7)", border: `1px solid ${r.status === "applied" ? "#14532d" : r.status === "error" ? "#7f1d1d" : "#334155"}`,
                borderLeft: `4px solid ${r.status === "applied" ? "#22c55e" : r.status === "error" ? "#ef4444" : "#f59e0b"}`,
                borderRadius: 12, padding: 20,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{r.patchTitle}</div>
                  <span style={{ fontSize: ".8em", fontWeight: 700, padding: "4px 12px", borderRadius: 6, background: r.status === "applied" ? "#052e16" : r.status === "error" ? "#450a0a" : "#1c1917", color: r.status === "applied" ? "#6ee7b7" : r.status === "error" ? "#fca5a5" : "#fcd34d" }}>
                    {r.status === "applied" ? "✅ Commité sur GitHub" : r.status === "error" ? "❌ Erreur" : "📋 Correctif généré"}
                  </span>
                </div>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#38bdf8", fontSize: ".85em", textDecoration: "none", background: "rgba(56,189,248,.08)", padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(56,189,248,.2)" }}>
                    🔗 Voir sur GitHub
                  </a>
                )}
                {r.error && <div style={{ color: "#f87171", fontSize: ".85em", marginTop: 8, padding: "8px 12px", background: "#450a0a", borderRadius: 6 }}>{r.error}</div>}
                {r.code && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: "pointer", color: "#94a3b8", fontSize: ".85em", fontWeight: 600, padding: "6px 0" }}>📄 Voir le code à déployer ▾</summary>
                    <div style={{ position: "relative", marginTop: 10 }}>
                      <pre style={{ background: "#020617", border: "1px solid #1e293b", padding: 16, borderRadius: 8, overflow: "auto", fontSize: ".8em", color: "#e2e8f0", whiteSpace: "pre-wrap", margin: 0 }}>{r.code}</pre>
                      <button onClick={() => navigator.clipboard.writeText(r.code || "")}
                        style={{ position: "absolute", top: 10, right: 10, background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: ".75em" }}>
                        Copier
                      </button>
                    </div>
                  </details>
                )}
              </div>
            ))}

            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => { setStep(1); setReport(null); setResults([]); setError(""); }}
                style={{ flex: 1, background: "rgba(30,41,59,.7)", color: "#94a3b8", border: "1px solid #334155", padding: "13px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>
                ← Nouveau rapport
              </button>
              <button onClick={() => setStep(2)}
                style={{ flex: 1, background: "rgba(30,41,59,.7)", color: "#94a3b8", border: "1px solid #334155", padding: "13px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>
                ← Reconfig CMS
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

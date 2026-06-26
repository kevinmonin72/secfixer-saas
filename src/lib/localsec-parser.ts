export interface LocalSecFinding {
  id: string;
  category: string;
  severity: "Critical" | "High" | "Medium" | "Low" | "Info";
  title: string;
  description: string;
  evidence: string;
  recommendation: string;
  cvssScore?: string;
  mitreAttack?: string;
}

export interface LocalSecReport {
  siteUrl: string;
  score: number;
  grade: string;
  findings: LocalSecFinding[];
}

export function parseLocalSecHtml(html: string): LocalSecReport[] {
  const match = html.match(/<script[^>]+id="report-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Aucun bloc report-data trouvé. Exportez depuis LocalSec Audit Pro.");
  const raw = match[1].replace(/\\u003c/g, "<");
  const reports: LocalSecReport[] = JSON.parse(raw);
  return reports;
}

export function filterActionable(findings: LocalSecFinding[]): LocalSecFinding[] {
  return findings.filter(f => ["Critical", "High", "Medium"].includes(f.severity));
}

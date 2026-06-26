import type { Metadata } from "next";
export const metadata: Metadata = { title: "SecFixer — Auto-patch sécurité", description: "Résout automatiquement les failles LocalSec via CMS API" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body style={{ margin: 0, fontFamily: "-apple-system,'Segoe UI',sans-serif", background: "#0f172a", color: "#f8fafc" }}>{children}</body></html>;
}

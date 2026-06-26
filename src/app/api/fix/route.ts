import { NextRequest, NextResponse } from "next/server";
import { generatePatches, CmsType } from "@/lib/fix-engine";
import { filterActionable, LocalSecFinding } from "@/lib/localsec-parser";
import { upsertFile, injectMetaTagsIntoHtml, appendToFile, GithubTarget } from "@/lib/adapters/github";

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
    const results: { patchTitle: string; status: "applied" | "manual" | "error"; url?: string; error?: string; code?: string }[] = [];

    if (cms === "github_pages") {
      const [owner, repo] = (credentials.repo || "").split("/");
      if (!owner || !repo || !credentials.token) {
        return NextResponse.json({ error: "Token et repo (owner/repo) requis pour GitHub Pages." }, { status: 400 });
      }
      const target: GithubTarget = {
        token: credentials.token,
        owner,
        repo,
        branch: credentials.branch || "main",
      };

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
    } else if (cms === "wordpress") {
      // WordPress: generate MU plugin code + return for manual placement
      for (const patch of patches) {
        results.push({
          patchTitle: patch.title,
          status: "manual",
          code: patch.patchContent || patch.content,
        });
      }
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

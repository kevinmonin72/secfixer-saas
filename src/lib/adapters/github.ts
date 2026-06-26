export interface GithubTarget {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

interface GithubFile {
  path: string;
  content: string;
  sha?: string;
}

async function ghFetch(token: string, path: string, opts: RequestInit = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub API ${res.status}: ${(err as { message?: string }).message || res.statusText}`);
  }
  return res.json();
}

export async function getFileSha(target: GithubTarget, filePath: string): Promise<string | null> {
  try {
    const data = await ghFetch(target.token, `/repos/${target.owner}/${target.repo}/contents/${filePath}?ref=${target.branch}`);
    return (data as { sha: string }).sha || null;
  } catch {
    return null;
  }
}

export async function getFileContent(target: GithubTarget, filePath: string): Promise<string | null> {
  try {
    const data = await ghFetch(target.token, `/repos/${target.owner}/${target.repo}/contents/${filePath}?ref=${target.branch}`);
    const d = data as { content?: string };
    return d.content ? Buffer.from(d.content, "base64").toString("utf-8") : null;
  } catch {
    return null;
  }
}

export async function upsertFile(target: GithubTarget, file: GithubFile, commitMessage: string): Promise<string> {
  const sha = file.sha ?? (await getFileSha(target, file.path));
  const body: Record<string, unknown> = {
    message: commitMessage,
    content: Buffer.from(file.content, "utf-8").toString("base64"),
    branch: target.branch,
  };
  if (sha) body.sha = sha;

  await ghFetch(target.token, `/repos/${target.owner}/${target.repo}/contents/${file.path}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return `https://github.com/${target.owner}/${target.repo}/blob/${target.branch}/${file.path}`;
}

export async function injectMetaTagsIntoHtml(target: GithubTarget, htmlPath: string, metaTags: string): Promise<string> {
  const existing = await getFileContent(target, htmlPath);
  if (!existing) throw new Error(`${htmlPath} introuvable dans ${target.owner}/${target.repo}`);

  if (existing.includes("secfixer-injected")) {
    return `https://github.com/${target.owner}/${target.repo}/blob/${target.branch}/${htmlPath}`;
  }

  const patched = existing.replace(/<head([^>]*)>/i, `<head$1>\n  <!-- secfixer-injected -->\n${metaTags}`);
  const sha = await getFileSha(target, htmlPath);
  return upsertFile(target, { path: htmlPath, content: patched, sha: sha ?? undefined }, "fix(security): inject security meta tags [SecFixer]");
}

export async function appendToFile(target: GithubTarget, filePath: string, snippet: string): Promise<string> {
  const existing = await getFileContent(target, filePath);
  if (existing?.includes("secfixer")) {
    return `https://github.com/${target.owner}/${target.repo}/blob/${target.branch}/${filePath}`;
  }
  const newContent = existing ? `${existing}\n\n${snippet}` : snippet;
  const sha = await getFileSha(target, filePath);
  return upsertFile(target, { path: filePath, content: newContent, sha: sha ?? undefined }, `fix(security): patch ${filePath} [SecFixer]`);
}

export async function listRepos(token: string): Promise<{ full_name: string; default_branch: string }[]> {
  const data = await ghFetch(token, "/user/repos?per_page=100&sort=updated") as { full_name: string; default_branch: string }[];
  return data.map(r => ({ full_name: r.full_name, default_branch: r.default_branch }));
}

export async function validateToken(token: string): Promise<{ login: string }> {
  return ghFetch(token, "/user") as Promise<{ login: string }>;
}

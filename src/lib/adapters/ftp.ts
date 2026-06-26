import * as ftp from "basic-ftp";

export interface FtpTarget { host: string; user: string; password: string; port?: number; secure?: boolean; }

export async function uploadFileViaftp(target: FtpTarget, remoteDir: string, filename: string, content: string): Promise<string> {
  const client = new ftp.Client(10000);
  try {
    await client.access({
      host: target.host,
      user: target.user,
      password: target.password,
      port: target.port || 21,
      secure: target.secure || false,
      secureOptions: { rejectUnauthorized: false },
    });

    // Find wp-content/mu-plugins relative to public root
    const possiblePaths = [
      `${remoteDir}/mu-plugins`,
      `${remoteDir}/wp-content/mu-plugins`,
      `/public_html/wp-content/mu-plugins`,
      `/httpdocs/wp-content/mu-plugins`,
      `/www/wp-content/mu-plugins`,
    ];

    let uploadPath = "";
    for (const p of possiblePaths) {
      try {
        await client.ensureDir(p);
        uploadPath = p;
        break;
      } catch { continue; }
    }
    if (!uploadPath) throw new Error("Impossible de trouver wp-content/mu-plugins via FTP.");

    const { Readable } = await import("stream");
    const stream = Readable.from([content]);
    await client.uploadFrom(stream, `${uploadPath}/${filename}`);
    return uploadPath;
  } finally {
    client.close();
  }
}

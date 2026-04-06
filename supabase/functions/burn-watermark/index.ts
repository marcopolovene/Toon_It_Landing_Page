import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// ── SECURITY FIX: SSRF block — allowlist-only URL validation ──────────────────
function isSafeVideoUrl(rawUrl: string): boolean {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (parsed.protocol !== "https:") return false;
  const blocked = [
    /^169\.254\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^127\./,
    /^0\./,
    /^::1$/,
    /localhost/i,
    /metadata\.google\.internal/i,
    /metadata/i,
  ];
  if (blocked.some(r => r.test(parsed.hostname))) return false;
  const allowed = [
    "dzarqnick.cloudinary.com",
    "zgfpxdkanwbcieowrqoz.supabase.co",
    "res.cloudinary.com",
  ];
  return allowed.some(h => parsed.hostname === h || parsed.hostname.endsWith("." + h));
}

async function streamToFile(url: string, path: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed ${resp.status}: ${url}`);
  const file = await Deno.open(path, { write: true, create: true, truncate: true });
  try {
    await resp.body!.pipeTo(file.writable);
  } catch (e) {
    try { file.close(); } catch (_) {}
    throw e;
  }
}

async function ensureFFmpeg(): Promise<string> {
  try {
    const { code } = await new Deno.Command("ffmpeg", {
      args: ["-version"], stdout: "null", stderr: "null"
    }).output();
    if (code === 0) { console.log("[BURN] Using system ffmpeg"); return "ffmpeg"; }
  } catch (_) {}
  const ffmpegPath = "/tmp/ffmpeg";
  try {
    const stat = await Deno.stat(ffmpegPath);
    if (stat.size > 1_000_000) { console.log("[BURN] Using cached ffmpeg"); return ffmpegPath; }
  } catch (_) {}
  console.log("[BURN] Downloading ffmpeg via stream...");
  await streamToFile(
    "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-x64",
    ffmpegPath
  );
  await new Deno.Command("chmod", {
    args: ["+x", ffmpegPath], stdout: "null", stderr: "null"
  }).output();
  console.log("[BURN] ffmpeg ready");
  return ffmpegPath;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" }
    });
  }

  // ── SECURITY FIX: Authenticate caller via Supabase JWT ────────────────────
  // Service-mode: n8n internal calls bypass user JWT
  const SERVICE_SECRET = Deno.env.get('BURN_SERVICE_SECRET') ?? '';
  const isServiceCall = SERVICE_SECRET.length > 0 &&
    req.headers.get('x-service-secret') === SERVICE_SECRET;

  if (!isServiceCall) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await authClient.auth.getUser(authHeader.slice(7));
  if (authErr || !user) {
    console.log("[BURN] Auth failed:", authErr?.message);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  } // end isServiceCall check

  let body: { job_id?: string; video_url?: string; user_id?: string };
  try {
    body = await req.json();
  } catch (_) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const { job_id, video_url } = body;
  if (!job_id || !video_url) {
    return new Response(JSON.stringify({ error: "Missing job_id or video_url" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  // ── SECURITY FIX: Verify job belongs to authenticated user ───────────────
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Skip ownership check for service calls (n8n internal — already trusted)
  if (!isServiceCall) {
    const { data: jobRow, error: jobErr } = await supabase
      .from("generations")
      .select("user_id")
      .eq("job_id", job_id)
      .single();
    if (jobErr || !jobRow || jobRow.user_id !== user.id) {
      console.log("[BURN] Ownership check failed — job:", job_id, "user:", user.id);
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  }

  // ── SECURITY FIX: Validate URL against allowlist (blocks SSRF) ───────────
  if (!isSafeVideoUrl(video_url)) {
    console.log("[BURN] Blocked unsafe URL:", video_url);
    return new Response(JSON.stringify({ error: "Invalid video URL" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const tmpIn  = `/tmp/${job_id}_clean.mp4`;
  const tmpOut = `/tmp/${job_id}_wm.mp4`;

  try {
    console.log(`[BURN] Starting sync burn for ${job_id}`);
    // [FIX] Private bucket: extract storage path and download with service role auth
    const storagePathMatch = video_url.match(/\/videos\/(.+)$/);
    if (storagePathMatch) {
      const storagePath = storagePathMatch[1];
      console.log(`[BURN] Downloading via authenticated storage: ${storagePath}`);
      const { data: fileData, error: dlError } = await supabase.storage
        .from("videos")
        .download(storagePath);
      if (dlError || !fileData) {
        throw new Error(`Storage download failed: ${dlError?.message || "no data"}`);
      }
      const arrBuf = await fileData.arrayBuffer();
      await Deno.writeFile(tmpIn, new Uint8Array(arrBuf));
    } else {
      // Fallback: try direct fetch (for non-Supabase URLs)
      await streamToFile(video_url, tmpIn);
    }
    const inStat = await Deno.stat(tmpIn);
    console.log(`[BURN] Video downloaded: ${inStat.size} bytes`);
    const ffmpegBin = await ensureFFmpeg();
    const { code, stderr } = await new Deno.Command(ffmpegBin, {
      args: [
        "-y", "-i", tmpIn,
        "-vf", "drawtext=text='ToonIt.ai':fontcolor=white@0.56:fontsize=18:x=16:y=h-th-8:shadowcolor=black@0.6:shadowx=0:shadowy=1",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "copy", tmpOut
      ],
      stdout: "null",
      stderr: "piped"
    }).output();
    if (code !== 0) {
      const errMsg = new TextDecoder().decode(stderr);
      throw new Error(`FFmpeg failed (${code}): ${errMsg.slice(-400)}`);
    }
    console.log(`[BURN] FFmpeg encode done`);
    const wmData = await Deno.readFile(tmpOut);
    const storagePath = `${job_id}_wm.mp4`;
    const { error: uploadErr } = await supabase.storage
      .from("videos")
      .upload(storagePath, wmData, { contentType: "video/mp4", upsert: true });
    if (uploadErr) throw uploadErr;
    const wmUrl = `${SUPABASE_URL}/storage/v1/object/public/videos/${storagePath}`;
    console.log(`[BURN] Uploaded: ${wmUrl}`);
    await supabase.from("generations")
      .update({ watermark_url: wmUrl, watermark_ready: true })
      .eq("job_id", job_id);
    console.log(`[BURN] DB updated`);
    try { await Deno.remove(tmpIn); } catch (_) {}
    try { await Deno.remove(tmpOut); } catch (_) {}
    return new Response(
      JSON.stringify({ status: "complete", job_id, watermark_url: wmUrl }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error(`[BURN] Error for ${job_id}:`, err);
    try { await Deno.remove(tmpIn); } catch (_) {}
    try { await Deno.remove(tmpOut); } catch (_) {}
    return new Response(
      JSON.stringify({ status: "error", job_id, message: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
});

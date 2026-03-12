import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Stream a URL to a local file (avoids loading entire body into memory)
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
  // Try system ffmpeg first
  try {
    const { code } = await new Deno.Command("ffmpeg", {
      args: ["-version"], stdout: "null", stderr: "null"
    }).output();
    if (code === 0) { console.log("[BURN] Using system ffmpeg"); return "ffmpeg"; }
  } catch (_) {}

  const ffmpegPath = "/tmp/ffmpeg";

  // Check if already cached and valid (>1MB)
  try {
    const stat = await Deno.stat(ffmpegPath);
    if (stat.size > 1_000_000) { console.log("[BURN] Using cached ffmpeg"); return ffmpegPath; }
  } catch (_) {}

  // Stream download — avoids loading 70MB into memory at once
  console.log("[BURN] Downloading ffmpeg via stream...");
  await streamToFile(
    "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-x64",
    ffmpegPath
  );

  // chmod via system binary (Deno.chmod is blocklisted in Edge Functions)
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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const tmpIn  = `/tmp/${job_id}_clean.mp4`;
  const tmpOut = `/tmp/${job_id}_wm.mp4`;

  try {
    console.log(`[BURN] Starting sync burn for ${job_id}`);

    // Stream video to disk
    await streamToFile(video_url, tmpIn);
    const inStat = await Deno.stat(tmpIn);
    console.log(`[BURN] Video downloaded: ${inStat.size} bytes`);

    const ffmpegBin = await ensureFFmpeg();
    console.log(`[BURN] Using: ${ffmpegBin}`);

    const { code, stderr } = await new Deno.Command(ffmpegBin, {
      args: [
        "-y", "-i", tmpIn,
        "-vf", "drawtext=text='ToonIt.ai':fontcolor=white@0.55:fontsize=18:x=w-tw-10:y=h-th-8:shadowcolor=black@0.8:shadowx=0:shadowy=1",
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

    // Read and upload watermarked file
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

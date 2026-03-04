import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function downloadFile(url: string, path: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${url}`);
  const buf = await resp.arrayBuffer();
  await Deno.writeFile(path, new Uint8Array(buf));
}

async function ensureFFmpeg(): Promise<string> {
  try {
    const cmd = new Deno.Command("ffmpeg", { args: ["-version"], stdout: "null", stderr: "null" });
    const { code } = await cmd.output();
    if (code === 0) return "ffmpeg";
  } catch (_) {}
  const ffmpegPath = "/tmp/ffmpeg";
  try { await Deno.stat(ffmpegPath); return ffmpegPath; } catch (_) {}
  console.log("[BURN] Downloading ffmpeg binary...");
  await downloadFile(
    "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-x64",
    ffmpegPath
  );
  await Deno.chmod(ffmpegPath, 0o755);
  console.log("[BURN] ffmpeg ready");
  return ffmpegPath;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  }

  let body: { job_id?: string; video_url?: string; user_id?: string };
  try { body = await req.json(); }
  catch (_) { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  const { job_id, video_url } = body;
  if (!job_id || !video_url) {
    return new Response(JSON.stringify({ error: "Missing job_id or video_url" }), { status: 400 });
  }

  const burnAsync = async () => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const tmpIn   = `/tmp/${job_id}_source`;
    const tmpClean = `/tmp/${job_id}_clean.mp4`;
    const tmpWm   = `/tmp/${job_id}_wm.mp4`;

    try {
      console.log(`[BURN] Starting for ${job_id}`);

      // 1. Download source (may be WEBM or MP4)
      await downloadFile(video_url, tmpIn);
      console.log(`[BURN] Downloaded source`);

      const ffmpegBin = await ensureFFmpeg();

      // 2a. Re-encode to clean MP4 (no watermark, fixes WEBM→MP4)
      const cleanCmd = new Deno.Command(ffmpegBin, {
        args: [
          "-y", "-i", tmpIn,
          "-c:v", "libx264", "-preset", "fast", "-crf", "23",
          "-c:a", "copy",
          "-movflags", "+faststart",
          tmpClean
        ],
        stdout: "null", stderr: "piped"
      });
      const cleanResult = await cleanCmd.output();
      if (cleanResult.code !== 0) {
        const err = new TextDecoder().decode(cleanResult.stderr);
        throw new Error(`FFmpeg clean encode failed (${cleanResult.code}): ${err.slice(-300)}`);
      }
      console.log(`[BURN] Clean MP4 encoded`);

      // 2b. Burn watermark text onto clean MP4 → watermarked MP4
      const wmCmd = new Deno.Command(ffmpegBin, {
        args: [
          "-y", "-i", tmpClean,
          "-vf", "drawtext=text='ToonIt.ai':fontcolor=white:alpha=0.55:fontsize=28:x=20:y=h-50:shadowcolor=black:shadowx=1:shadowy=1",
          "-c:v", "libx264", "-preset", "fast", "-crf", "23",
          "-c:a", "copy",
          "-movflags", "+faststart",
          tmpWm
        ],
        stdout: "null", stderr: "piped"
      });
      const wmResult = await wmCmd.output();
      if (wmResult.code !== 0) {
        const err = new TextDecoder().decode(wmResult.stderr);
        throw new Error(`FFmpeg WM burn failed (${wmResult.code}): ${err.slice(-300)}`);
      }
      console.log(`[BURN] Watermarked MP4 encoded`);

      // 3. Upload clean MP4
      const cleanData = await Deno.readFile(tmpClean);
      const cleanPath = `${job_id}_clean.mp4`;
      const { error: cleanUploadErr } = await supabase.storage
        .from("videos")
        .upload(cleanPath, cleanData, { contentType: "video/mp4", upsert: true });
      if (cleanUploadErr) throw cleanUploadErr;
      const cleanUrl = `${SUPABASE_URL}/storage/v1/object/public/videos/${cleanPath}`;
      console.log(`[BURN] Clean uploaded: ${cleanUrl}`);

      // 4. Upload watermarked MP4
      const wmData = await Deno.readFile(tmpWm);
      const wmPath = `${job_id}_wm.mp4`;
      const { error: wmUploadErr } = await supabase.storage
        .from("videos")
        .upload(wmPath, wmData, { contentType: "video/mp4", upsert: true });
      if (wmUploadErr) throw wmUploadErr;
      const wmUrl = `${SUPABASE_URL}/storage/v1/object/public/videos/${wmPath}`;
      console.log(`[BURN] WM uploaded: ${wmUrl}`);

      // 5. Update generations table with both URLs
      await supabase.from("generations")
        .update({
          watermark_url: wmUrl,
          watermark_ready: true,
          clean_mp4_url: cleanUrl
        })
        .eq("job_id", job_id);

      console.log(`[BURN] DB updated for ${job_id}`);
    } catch (err) {
      console.error(`[BURN] Error for ${job_id}:`, err);
    } finally {
      for (const p of [tmpIn, tmpClean, tmpWm]) {
        try { await Deno.remove(p); } catch (_) {}
      }
    }
  };

  burnAsync();

  return new Response(
    JSON.stringify({ status: "queued", job_id }),
    { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
});

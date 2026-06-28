/* assembler.js — client-side concatenation via ffmpeg.wasm (loaded from CDN on demand).
 * Video-only concat (most generated clips have no audio), normalized to a common
 * width/height so mismatched segments still stitch cleanly. */

const Assembler = {
  _ff: null,
  _loading: null,
  FF_VER: "0.12.10",
  CORE_VER: "0.12.6",

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  },

  async _toBlobURL(url, type) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("Could not fetch " + url);
    const b = await r.blob();
    return URL.createObjectURL(new Blob([b], { type }));
  },

  async load(onStatus) {
    if (this._ff) return this._ff;
    if (this._loading) return this._loading;
    this._loading = (async () => {
      onStatus && onStatus("loading the stitching engine…");
      const base = "https://unpkg.com/@ffmpeg/ffmpeg@" + this.FF_VER + "/dist/umd/ffmpeg.js";
      const coreBase = "https://unpkg.com/@ffmpeg/core@" + this.CORE_VER + "/dist/umd";
      await this.loadScript(base);
      if (!window.FFmpegWASM) throw new Error("ffmpeg.wasm did not initialize.");
      const ff = new window.FFmpegWASM.FFmpeg();
      const coreURL = await this._toBlobURL(coreBase + "/ffmpeg-core.js", "text/javascript");
      const wasmURL = await this._toBlobURL(coreBase + "/ffmpeg-core.wasm", "application/wasm");
      await ff.load({ coreURL, wasmURL });
      this._ff = ff;
      return ff;
    })();
    return this._loading;
  },

  /* segments: [{ blob }], target: {width,height}. Returns a Blob (video/mp4). */
  async assemble(segments, target, onStatus) {
    const ff = await this.load(onStatus);
    const W = target.width || 1280;
    const H = target.height || 720;

    onStatus && onStatus("preparing clips…");
    const names = [];
    for (let i = 0; i < segments.length; i++) {
      const name = "in" + i + ".mp4";
      const buf = new Uint8Array(await segments[i].blob.arrayBuffer());
      await ff.writeFile(name, buf);
      names.push(name);
    }

    const N = segments.length;
    const parts = [];
    const refs = [];
    for (let i = 0; i < N; i++) {
      parts.push(
        "[" + i + ":v]scale=" + W + ":" + H +
        ":force_original_aspect_ratio=decrease,pad=" + W + ":" + H +
        ":(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v" + i + "]"
      );
      refs.push("[v" + i + "]");
    }
    const filter = parts.join(";") + ";" + refs.join("") + "concat=n=" + N + ":v=1:a=0[outv]";

    const args = [];
    names.forEach(n => { args.push("-i", n); });
    args.push("-filter_complex", filter, "-map", "[outv]", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "out.mp4");

    onStatus && onStatus("stitching " + N + " clips…");
    await ff.exec(args);

    const data = await ff.readFile("out.mp4");
    // cleanup
    try { names.forEach(n => ff.deleteFile && ff.deleteFile(n)); ff.deleteFile && ff.deleteFile("out.mp4"); } catch (e) {}
    return new Blob([data.buffer || data], { type: "video/mp4" });
  }
};

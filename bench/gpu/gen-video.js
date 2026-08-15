const { chromium } = require("playwright");
const fs = require("fs");

const OUT = process.argv[2] || "test.webm";
const DURATION_MS = 4500;
const W = 640, H = 360;

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<!doctype html><html><body>
    <canvas id="c" width="${W}" height="${H}"></canvas>
  </body></html>`);

  const result = await page.evaluate(async ({ W, H, DURATION_MS }) => {
    const canvas = document.getElementById("c");
    const ctx = canvas.getContext("2d");
    let t = 0;
    const draw = () => {
      t += 1;
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, `hsl(${(t * 3) % 360}, 80%, 50%)`);
      g.addColorStop(1, `hsl(${(t * 3 + 120) % 360}, 80%, 50%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // éléments en mouvement (déclenche le décodage/upload réel)
      ctx.fillStyle = "#fff";
      ctx.fillRect((t * 7) % W, (t * 5) % H, 60, 60);
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(W / 2 + Math.sin(t / 10) * 150, H / 2 + Math.cos(t / 13) * 100, 40, 0, Math.PI * 2);
      ctx.fill();
    };
    draw();

    const stream = canvas.captureStream(30);
    let mime = "video/webm;codecs=vp9";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm;codecs=vp8";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    rec.start(200);
    const iv = setInterval(draw, 33);
    await new Promise((r) => setTimeout(r, DURATION_MS));
    clearInterval(iv);
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: mime });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
    }
    return { mime, size: buf.length, b64: btoa(bin) };
  }, { W, H, DURATION_MS });

  fs.writeFileSync(OUT, Buffer.from(result.b64, "base64"));
  console.log(`vidéo écrite: ${OUT} (${result.size} o, ${result.mime})`);

  // vérification : durée réelle
  await page.setContent(`<video id="v" src="data:${result.mime};base64,${result.b64}"></video>`);
  const dur = await page.evaluate(() => new Promise((res) => {
    const v = document.getElementById("v");
    v.onloadedmetadata = () => res(v.duration);
    v.onerror = () => res(-1);
    v.load();
  }));
  console.log(`durée réelle: ${dur.toFixed(2)} s`);
  await browser.close();
})();

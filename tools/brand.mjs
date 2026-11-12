// Makes the brand images: favicon PNGs from the SVG, and the 1200x630 social
// sharing picture - a posed shot rendered by the real game with the title set
// over it. Needs the dev server running, Chrome and puppeteer-core.
//
//   node tools/brand.mjs <favicon.svg> <out dir>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [svgPath, outDir] = process.argv.slice(2);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--force-color-profile=srgb'],
});

// ---------- favicon PNGs ----------
const svg = await readFile(svgPath, 'utf8');
const icon = await browser.newPage();
for (const size of [180, 512, 192, 32]) {
  await icon.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await icon.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await icon.screenshot({ path: path.join(outDir, `icon-${size}.png`), omitBackground: true });
}
// "maskable": phones crop app icons to their own shape, so this one has a
// full-bleed background and the head kept inside the safe middle
const inner = svg.slice(svg.indexOf('</defs>') + 7, svg.lastIndexOf('</svg>')).replace(/<rect[^>]*\/>/, '');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${svg.slice(svg.indexOf('<defs>'), svg.indexOf('</defs>') + 7)}
  <rect width="64" height="64" fill="url(#bg)"/><g transform="translate(32 33) scale(0.7) translate(-32 -32)">${inner}</g></svg>`;
await icon.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
await icon.setContent(`<style>html,body{margin:0}svg{display:block;width:512px;height:512px}</style>${maskable}`);
await icon.screenshot({ path: path.join(outDir, 'icon-maskable-512.png') });
await icon.close();

// ---------- the posed game shot ----------
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  let a = 77;
  Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.requestAnimationFrame = () => 0;
  localStorage.clear();
});
await page.goto('http://localhost:5173/?nolock&pr=2', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__game);
await page.evaluate(() => {
  const g = window.__game;
  g.audio.init = () => {};
  Object.defineProperty(g.audio, 'beat', { get: () => 4.08 }); // lights caught right on a beat
  document.getElementById('btn-start').click();
  g.thirdPerson = true;
  g.enemies.timer = 1e9;
  const tick = (n) => { for (let i = 0; i < n; i++) g.tick(1 / 60); };

  // the hero stands in front of the dance floor, facing the camera, AK up
  g.player.pos.set(2.2, 0, 10.2);
  g.cam.yaw = Math.PI - 0.22;
  g.cam.pitch = 0.04;
  g.input.justPressed.add('Digit2');
  tick(50);

  // a crowd of dancers behind him
  [[-3.2, 6.4], [-0.6, 5.2], [5.6, 6.2], [-5.6, 4.2], [3.6, 3.6], [-2.4, 2.6], [6.8, 3.2], [0.8, 7.6]]
    .forEach(([x, z]) => g.dancers.add(x, z, 0, 14, 0));

  // shielded enemies closing in from the sides
  const spawn = (type, x, z, shield) => {
    g.enemies.queue = [type];
    g.enemies.spawnNext(g.player);
    const e = g.enemies.list[g.enemies.list.length - 1];
    e.pos.set(x, 0, z);
    e.setShield(shield);
    return e;
  };
  spawn('gunner', -4.6, 8.8, 2);
  spawn('rusher', 7.2, 8.4, 1);
  spawn('gunner', -7.4, 6.2, 3);
  // let them finish arriving: run to move time, then come back to the mark
  g.input.down.add('KeyW'); tick(55); g.input.down.delete('KeyW'); tick(20);
  g.player.pos.set(2.2, 0, 10.2);
  g.player.vel.set(0, 0, 0);
  const marks = [[-4.6, 8.8], [7.2, 8.4], [-7.4, 6.2]];
  g.enemies.list.forEach((e, i) => { e.pos.set(marks[i][0], 0, marks[i][1]); e.vel.set(0, 0, 0); e.yaw = Math.atan2(g.player.pos.x - e.pos.x, g.player.pos.z - e.pos.z); e.cooldown = 99; });
  g.cam.yaw = Math.PI - 0.22;
  tick(40);

  // one frozen enemy bullet streaking past
  const e0 = g.enemies.list[0];
  const from = e0.muzzle(e0.pos.clone());
  const dir = g.player.pos.clone().setY(1.5).add({ x: -1.3, y: 0.25, z: 0 }).sub(from).normalize();
  const b = g.projectiles.spawn(from, dir, 13, e0);
  b.pos.addScaledVector(dir, 3.4); b.travel = 3.4;
  b.group.position.copy(b.pos);
  b.trail.scale.set(b.width, b.width, 3.4);

  // freeze the game and take the key-art camera angle
  g.state = 'paused';
  document.getElementById('hud').style.display = 'none';
  document.querySelectorAll('.screen').forEach((s) => (s.style.display = 'none'));
  const c = g.renderer.camera, p = g.player.pos;
  c.fov = 36; c.aspect = 1200 / 630; c.updateProjectionMatrix();
  c.position.set(p.x - 0.7, 1.5, p.z + 4.9);
  c.lookAt(p.x - 1.55, 1.4, p.z);
  c.updateMatrixWorld();
  g.renderer.sky.position.copy(c.position);
  g.renderer.setGrade(1, 0, 0);
  g.renderer.render();
});
const shot = Buffer.from(await page.screenshot({ type: 'png' }));
await writeFile(path.join(outDir, 'keyart.png'), shot);
await page.close();

// ---------- title over the shot ----------
const card = await browser.newPage();
await card.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
await card.setContent(`<!doctype html><style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #070a1c;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #efe8da; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .shade { position: absolute; inset: 0; background:
    linear-gradient(90deg, rgba(7,10,28,0.95) 0%, rgba(7,10,28,0.82) 28%, rgba(7,10,28,0.25) 50%, rgba(7,10,28,0) 66%),
    linear-gradient(0deg, rgba(7,10,28,0.7) 0%, rgba(7,10,28,0) 30%); }
  .text { position: absolute; left: 72px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 26px; }
  h1 { margin: 0; font-size: 72px; font-weight: 100; letter-spacing: 0.26em; line-height: 1; text-shadow: 0 0 40px rgba(63,232,210,0.35); }
  p { margin: 0; font-size: 29px; font-weight: 300; line-height: 1.35; letter-spacing: 0.02em; max-width: 520px; }
  p b { font-weight: 500; color: #3fe8d2; }
  .chip { align-self: flex-start; margin-top: 6px; font-size: 16px; letter-spacing: 0.32em; text-transform: uppercase;
    color: #070a1c; background: #efe8da; padding: 14px 22px 14px 26px; }
  .bar { position: absolute; left: 72px; bottom: 54px; display: flex; gap: 22px; font-size: 15px; letter-spacing: 0.26em; text-transform: uppercase; opacity: 0.72; }
  .bar i { font-style: normal; color: #ff8a00; }
  .line { position: absolute; left: 72px; top: 150px; width: 64px; height: 3px; background: #3fe8d2; box-shadow: 0 0 14px #3fe8d2; }
</style>
<img class="bg" src="data:image/png;base64,${shot.toString('base64')}"><div class="shade"></div><div class="line"></div>
<div class="text">
  <h1>STILLPOINT</h1>
  <p>The world only moves<br><b>when you do.</b></p>
  <div class="chip">Play in your browser</div>
</div>
<div class="bar"><span>A shooter in a disco</span><i>·</i><span>Three.js</span><i>·</i><span>No download</span></div>`);
await card.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
await card.screenshot({ path: path.join(outDir, 'og-2x.png'), type: 'png' });
await browser.close();
console.log('brand images written to', outDir);

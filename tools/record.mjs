// Films the demo video and a set of stills.
//
// A scripted "bot" plays the real game in headless Chrome. Nothing runs in
// real time: this script advances the game exactly 1/60 s at a time and takes
// a picture every second step, so the video is a smooth 30 fps however slow
// the capture is. Random numbers are seeded, so every run films the same fight.
//
// Needs: Google Chrome, ffmpeg, `npm i --no-save puppeteer-core`, and the dev
// server running (`npm run dev`) - the bot drives the game through the
// `window.__game` handle that only exists in dev.
//
//   node tools/record.mjs <out.mp4> <stills dir> [mode: desktop | mobile] [seconds]
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [out, stillsDir, mode = 'desktop', seconds = '23'] = process.argv.slice(2);
if (!out || !stillsDir) throw new Error('usage: node tools/record.mjs <out.mp4> <stills dir> [desktop|mobile] [seconds]');
const MOBILE = mode === 'mobile';
const W = MOBILE ? 390 : 1280, H = MOBILE ? 844 : 720, SCALE = MOBILE ? 2 : 1.5;
const FPS = 30, TOTAL = Number(seconds);
const URL = process.env.GAME_URL || 'http://localhost:5173/?nolock';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await mkdir(stillsDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: SCALE, hasTouch: MOBILE, isMobile: MOBILE });
page.on('pageerror', (e) => console.error('page error:', e.message));

// Before the game loads: seed the dice and stop the game's own frame loop
// (this script will call the game's tick itself).
await page.evaluateOnNewDocument(() => {
  let a = 20261112;
  Math.random = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  window.requestAnimationFrame = () => 0;
  localStorage.clear();
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__game);

// ---------- the bot ----------
// The film is staged: instead of waiting for waves, enemies are placed in
// front of the camera on cue, and the bot holds the south side of the room
// so the dance floor is always the backdrop.
await page.evaluate((MOBILE) => {
  const g = window.__game;
  let sim = 0;
  g.audio.init = () => {}; // silent film: no audio engine
  Object.defineProperty(g.audio, 'beat', { get: () => (sim * 122) / 60 }); // lights follow film time
  document.getElementById('btn-start').click();
  g.enemies.wave = 3;
  g.enemies.timer = 1e9; // no natural waves during filming
  g.player.pos.set(0.5, 0, 15.5);

  const inp = g.input;
  let strafe = 1, strafeT = 0.8, pauseT = 0.7, nextPause = 2.2, fireT = 0.6, lastKills = 0;
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const at = (t) => sim >= t && sim - 1 / 60 < t; // true on the one tick that crosses time t

  function spawn(type, x, z, extra) {
    g.enemies.queue = [type];
    g.enemies.spawnNext(g.player);
    const e = g.enemies.list[g.enemies.list.length - 1];
    e.pos.set(x, 0, z);
    e.root.position.copy(e.pos);
    e.yaw = Math.atan2(g.player.pos.x - x, g.player.pos.z - z);
    Object.assign(e, extra);
    g.effects.ring(x, 0, z, e.cfg.color, 2, 0.6);
    return e;
  }

  function pickTarget() {
    const sniper = g.weapon.spec.scope;
    let best = null, bd = 1e9;
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      let d = Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z) + (e.hasLOS ? 0 : 30);
      if (sniper && e.type === 'marksman') d -= 100; // the scope goes for the far one
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  window.__demo = {
    get sim() { return sim; },
    step() {
      const dt = 1 / 60;
      sim += dt;
      const p = g.player.pos;

      // --- the running order of the film
      if (!MOBILE) {
        if (at(0.05)) { spawn('gunner', -4, 6.5); spawn('rusher', 5, 5.5); }
        if (at(3.6)) { spawn('gunner', 4, 7.5); spawn('rusher', -6, 6.5); }
        if (at(6.5)) inp.justPressed.add('Digit2'); // AK
        if (at(6.9)) { spawn('rusher', 0.5, 6.2); spawn('gunner', -5.5, 8); spawn('gunner', 6, 8); }
        if (at(9.4)) { spawn('rusher', -3, 6); spawn('rusher', 4, 6.5); }
        if (at(11)) g.toggleView(); // third-person
        if (at(11.3)) { spawn('gunner', -3.5, 7); spawn('rusher', 4.5, 7); }
        if (at(14.2)) spawn('gunner', 2.5, 8);
        if (at(16.9)) { inp.justPressed.add('Digit3'); spawn('marksman', 3.2, -5.2, { cooldown: 30 }); } // sniper
        if (at(17.7)) inp.aimHeld = true; // scope
        if (at(20)) inp.aimHeld = false;
        if (at(20.2)) inp.justPressed.add('Digit2');
        if (at(20.5)) { spawn('rusher', -4, 7); spawn('rusher', 1, 6); spawn('gunner', 5.5, 8); }
      } else {
        if (at(0.05)) { g.toggleView(); spawn('gunner', -3, 7); spawn('rusher', 3.5, 6.5); }
        if (at(3.5)) { spawn('rusher', -4, 6.5); spawn('gunner', 3, 8); }
        if (at(5)) inp.wheel = 1;
        if (at(6.5)) { spawn('rusher', 0.5, 6.5); spawn('gunner', -4.5, 8); }
      }
      const scoping = !MOBILE && sim > 17.2 && sim < 20.2;

      // a kill in third-person: stand still so the crying shows
      if (g.kills > lastKills) { lastKills = g.kills; if (g.thirdPerson) pauseT = Math.max(pauseT, 1.5); }

      // --- feet: strafe inside a box on the south side, stopping now and then
      // (every stop freezes time, which is the point of the game)
      const target = pickTarget();
      const dist = target ? Math.hypot(target.pos.x - p.x, target.pos.z - p.z) : 99;
      let mx = 0, mz = 0;
      if (pauseT > 0 || scoping) {
        pauseT -= dt;
      } else {
        strafeT -= dt;
        if (strafeT <= 0) { strafe = -strafe; strafeT = 0.8 + Math.random() * 0.8; }
        if (p.x > 4.5) strafe = -1; else if (p.x < -4.5) strafe = 1;
        mx = strafe;
        if (p.z < 12.5 || dist < 5) mz = -1; else if (p.z > 17) mz = 1;
        nextPause -= dt;
        if (nextPause <= 0) { pauseT = 0.75; nextPause = 2.4 + Math.random() * 1.2; }
      }
      if (MOBILE) {
        inp.touchAxis.x = mx; inp.touchAxis.z = mz;
        document.getElementById('t-knob').style.transform = `translate(${mx * 36}px, ${-mz * 36}px)`;
        document.getElementById('t-fire').classList.toggle('on', inp.fireHeld);
      } else {
        for (const k of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) inp.down.delete(k);
        if (mx) inp.down.add(mx > 0 ? 'KeyD' : 'KeyA');
        if (mz) inp.down.add(mz > 0 ? 'KeyW' : 'KeyS');
      }

      // --- eyes and trigger: turn toward the target like a person, not a robot
      let aligned = false;
      if (target) {
        const c = g.renderer.camera.position;
        const flat = Math.hypot(target.pos.x - c.x, target.pos.z - c.z);
        const dy = wrap(Math.atan2(-(target.pos.x - c.x), -(target.pos.z - c.z)) - g.cam.yaw);
        const dp = Math.atan2(target.pos.y + 1.15 - c.y, flat) - g.cam.pitch;
        const gain = scoping ? 0.14 : 0.11;
        g.cam.yaw += dy * gain;
        g.cam.pitch += dp * gain;
        aligned = Math.abs(dy) < 0.035 && Math.abs(dp) < 0.05 && target.state !== 'spawn';
      } else {
        g.cam.yaw += wrap(0 - g.cam.yaw) * 0.04;
        g.cam.pitch += (-0.03 - g.cam.pitch) * 0.05;
      }
      fireT -= dt;
      inp.fireHeld = false;
      const w = g.weapon;
      if (aligned) {
        if (w.spec.auto) inp.fireHeld = true;
        else if (w.spec.scope) { if (w.aim > 0.97 && fireT <= 0 && sim > 18.6) { inp.fireJust = true; fireT = 1.5; } }
        else if (fireT <= 0) { inp.fireJust = true; fireT = 0.34; }
      }
      if (w.ammo === 0 && !w.reloading) inp.justPressed.add('KeyR');

      g.tick(dt);

      // CSS animations and fades also follow film time, not the clock on the wall
      for (const a of document.getAnimations()) {
        if (a.__t0 === undefined) a.__t0 = sim;
        a.pause();
        a.currentTime = (sim - a.__t0) * 1000;
      }
    },
  };
}, MOBILE);

// ---------- film it ----------
const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-vf', `scale=${MOBILE ? 780 : 1280}:-2:flags=lanczos`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'slow',
  '-movflags', '+faststart', out,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const frames = TOTAL * FPS;
for (let f = 0; f < frames; f++) {
  await page.evaluate(() => { window.__demo.step(); window.__demo.step(); });
  const shot = await page.screenshot({ type: 'jpeg', quality: 95 });
  if (!ff.stdin.write(shot)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % 15 === 0) {
    // a still every half second of film, to choose pictures from
    await page.screenshot({ path: path.join(stillsDir, `${mode}-${String(f / 15).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 92 });
    process.stdout.write(`\r${Math.round((f / frames) * 100)}%`);
  }
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
const stats = await page.evaluate(() => ({ kills: window.__game.kills, wave: window.__game.enemies.wave, hp: window.__game.player.health, state: window.__game.state }));
console.log('\ndone', JSON.stringify(stats));
await browser.close();

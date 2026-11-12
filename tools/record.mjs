// Films the demo video and a set of stills.
//
// A scripted "bot" plays the real game in headless Chrome. Nothing runs in
// real time: this script advances the game exactly 1/60 s at a time and takes
// a picture every second step, so the video is a smooth 30 fps however slow
// the capture is. Random numbers are seeded, so every run films the same fight.
//
// Sound is filmed too. The game's audio engine is handed an "offline" audio
// context whose clock is the film's clock, so every note, shot and sob lands
// on the exact frame it belongs to; at the end the whole soundtrack is
// rendered in one go and joined to the picture.
//
// Needs: Google Chrome, ffmpeg, `npm i --no-save puppeteer-core`, and the dev
// server running (`npm run dev`) - the bot drives the game through the
// `window.__game` handle that only exists in dev.
//
//   node tools/record.mjs <out.mp4> <stills dir | -> [mode: desktop | mobile] [seconds]
//
// Options (environment variables):
//   FPS=60        frames per second (30 or 60)
//   SCALE=3       device pixel ratio: 1280x720 at 3 = 3840x2160 (4K)
//   WIDTH= HEIGHT=  page size in CSS pixels (mobile default 405x720 = 9:16)
//   OUT_WIDTH=    width of the encoded video (default: filmed width)
//   CRF=17        quality (lower = better, bigger)
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [out, stillsDir, mode = 'desktop', seconds = '23'] = process.argv.slice(2);
if (!out || !stillsDir) throw new Error('usage: node tools/record.mjs <out.mp4> <stills dir> [desktop|mobile] [seconds]');
const MOBILE = mode === 'mobile';
const env = process.env;
const W = Number(env.WIDTH) || (MOBILE ? 405 : 1280), H = Number(env.HEIGHT) || 720;
const SCALE = Number(env.SCALE) || (MOBILE ? 2 : 1.5);
const FPS = Number(env.FPS) || 30, TOTAL = Number(seconds);
const STEPS = Math.round(60 / FPS); // game steps per filmed frame
const OUT_W = Number(env.OUT_WIDTH) || Math.round((W * SCALE) / 2) * 2;
const SAMPLE_RATE = 48000;
const URL = env.GAME_URL || `http://localhost:5173/?nolock&pr=${SCALE}`;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const STILLS = stillsDir !== '-';
if (STILLS) await mkdir(stillsDir, { recursive: true });

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
await page.evaluateOnNewDocument(({ seconds, rate }) => {
  let a = 20261112;
  Math.random = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  window.requestAnimationFrame = () => 0;
  localStorage.clear();

  // The sound stage: an offline audio context that reports film time as
  // "now". The game cannot tell it apart from a live one.
  window.__simTime = 0;
  window.AudioContext = function FilmAudioContext() {
    const off = new OfflineAudioContext(2, Math.ceil((seconds + 1.5) * rate), rate);
    window.__audio = off;
    return new Proxy(off, {
      get(target, key) {
        if (key === 'currentTime') return window.__simTime;
        if (key === 'state') return 'running';
        const v = target[key];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  };
}, { seconds: TOTAL, rate: SAMPLE_RATE });
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__game);

// ---------- the bot ----------
// The film is staged: instead of waiting for waves, enemies are placed in
// front of the camera on cue, and the bot holds the south side of the room
// so the dance floor is always the backdrop.
//
// The desktop bot plays like a skilled player: it never stops strafing,
// snaps to heads, jumps mid-fight, deals with close threats first and
// quick-scopes with the sniper. It opens in first-person for a few seconds,
// then plays the rest in third-person.
await page.evaluate(async (MOBILE) => {
  const g = window.__game;
  let sim = 0;
  document.getElementById('btn-start').click(); // also starts the audio engine
  g.enemies.wave = 3;
  g.enemies.timer = 1e9; // no natural waves during filming
  const cfg = (await import('/src/config.js')).CONFIG;
  if (!MOBILE) cfg.threat.maxShield = 1; // one shield point each keeps the film moving
  g.player.pos.set(0.5, 0, 14.5);

  const inp = g.input;
  const PRO = !MOBILE;
  let strafe = 1, strafeT = 0.6, pauseT = PRO ? 0 : 0.7, nextPause = 2.2, fireT = 0.5, jumpT = 2.2, lastKills = 0, outro = false;
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

  // Closest threat first; anything charging inside 5 m jumps the queue.
  function pickTarget() {
    const sniper = g.weapon.spec.scope;
    let best = null, bd = 1e9;
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      let d = Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z);
      if (!e.hasLOS) d += 30;
      if (e.type === 'rusher' && d < 5) d -= 20;
      if (sniper) d += e.type === 'marksman' ? -100 : 100; // the scope is for the far ones
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  window.__demo = {
    get sim() { return sim; },
    step() {
      const dt = 1 / 60;
      sim += dt;
      window.__simTime = sim;
      g.audio.music?.schedule(); // keep the soundtrack written a little ahead
      const p = g.player.pos;

      // --- the running order of the film
      if (PRO) {
        if (at(0.05)) { spawn('gunner', -4, 6); spawn('gunner', 4.5, 7); }
        if (at(2.2)) { spawn('rusher', -5.5, 5.5); spawn('gunner', 3, 6.5); }
        if (at(3.4)) pauseT = 0.7; // one deliberate stop: the world freezes
        if (at(4.3)) spawn('gunner', -2, 6.5);
        if (at(5.6)) g.toggleView(); // third-person from here on
        if (at(5.9)) { spawn('rusher', 5, 5); spawn('gunner', -4.5, 7); }
        if (at(7.6)) inp.justPressed.add('Digit2'); // AK
        if (at(8.4)) { spawn('gunner', 5.5, 7.5); spawn('rusher', -3, 5); spawn('gunner', -6, 7.5); }
        if (at(10.7)) pauseT = 0.65;
        if (at(11.3)) { spawn('rusher', 2, 5); spawn('gunner', 6, 7); spawn('gunner', -5, 7); }
        if (at(13.8)) {
          inp.justPressed.add('Digit3'); // sniper: two far targets, already standing
          spawn('marksman', 3.4, -5.2, { cooldown: 30, state: 'move' });
          spawn('marksman', -4.8, -5.6, { cooldown: 30, state: 'move' });
        }
        if (at(14.5)) inp.aimHeld = true; // quick-scope
        if (at(18.8)) inp.aimHeld = false;
        if (at(19)) inp.justPressed.add('Digit2');
        if (at(19.2)) { spawn('rusher', -4, 5.5); spawn('gunner', 5.5, 7.5); spawn('gunner', 0.5, 6); }
        if (at(21.4)) { spawn('gunner', -5.5, 7); spawn('rusher', 4, 5.5); }
        if (at(23.4)) { spawn('rusher', 5, 6); spawn('gunner', -3.5, 7.5); }
        // if anyone is still standing near the end, the last burst takes them all
        if (at(27.6)) for (const e of g.enemies.list) if (e.alive) { e.setShield(0); e.hp = 1; }
        if (g.player.health < 3) g.player.health = 3; // the star does not die on camera
      } else {
        if (at(0.05)) { g.toggleView(); spawn('gunner', -3, 7); spawn('rusher', 3.5, 6.5); }
        if (at(3.5)) { spawn('rusher', -4, 6.5); spawn('gunner', 3, 8); }
        if (at(5)) inp.wheel = 1;
        if (at(6.5)) { spawn('rusher', 0.5, 6.5); spawn('gunner', -4.5, 8); }
        if (at(9.5)) { spawn('gunner', 4, 7.5); spawn('rusher', -3, 6); }
        if (at(12.5)) { spawn('rusher', 3, 6.5); spawn('gunner', -1, 8); spawn('rusher', -5, 7); }
      }
      const scoping = PRO && sim > 14.2 && sim < 18.9;
      const alive = g.enemies.list.filter((e) => e.alive).length;

      // the ending: the room is clear, he stops, sits down and cries
      if (PRO && sim > 25 && alive === 0 && !outro) {
        outro = true;
        pauseT = 99;
        g.cryCooldown = 0;
        g.mourn();
      }
      if (!PRO && g.kills > lastKills && g.thirdPerson) pauseT = Math.max(pauseT, 1.5);
      lastKills = g.kills;

      // --- feet
      const target = pickTarget();
      const dist = target ? Math.hypot(target.pos.x - p.x, target.pos.z - p.z) : 99;
      let mx = 0, mz = 0;
      if (pauseT > 0 || scoping) {
        pauseT -= dt;
      } else {
        strafeT -= dt;
        if (strafeT <= 0) { strafe = -strafe; strafeT = PRO ? 0.45 + Math.random() * 0.7 : 0.8 + Math.random() * 0.8; }
        const edge = PRO ? 5.5 : 4.5;
        if (p.x > edge) strafe = -1; else if (p.x < -edge) strafe = 1;
        mx = strafe;
        // stay well clear of the back wall so the third-person camera has room
        if (p.z > 15.5) mz = 1; else if (p.z < 10.8 || (dist < 5 && p.z < 15)) mz = -1; else if (PRO && dist > 10.5) mz = 1;
        if (PRO) {
          jumpT -= dt;
          if (jumpT <= 0 && g.player.onGround) { inp.justPressed.add('Space'); jumpT = 2.4 + Math.random() * 2.2; }
        } else {
          nextPause -= dt;
          if (nextPause <= 0) { pauseT = 0.75; nextPause = 2.4 + Math.random() * 1.2; }
        }
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

      // --- eyes and trigger
      // The pro flicks fast and goes for the head (a shield hides the head,
      // so then it aims centre mass).
      let aligned = false;
      if (target && !outro) {
        const c = g.renderer.camera.position;
        const flat = Math.hypot(target.pos.x - c.x, target.pos.z - c.z);
        const aimY = PRO && target.shield === 0 ? 1.81 * target.scale : 1.1;
        const dy = wrap(Math.atan2(-(target.pos.x - c.x), -(target.pos.z - c.z)) - g.cam.yaw);
        const dp = Math.atan2(target.pos.y + aimY - c.y, flat) - g.cam.pitch;
        // a high gain keeps the crosshair on a target even while strafing hard
        const gain = PRO ? (scoping ? 0.22 : 0.55) : 0.11;
        g.cam.yaw += dy * gain;
        g.cam.pitch = Math.max(g.cam.pitch + dp * gain, PRO ? -0.5 : -1.3);
        const tol = PRO ? Math.max(0.02, 0.2 / Math.max(flat, 1)) : 0.04;
        aligned = Math.abs(dy) < tol && Math.abs(dp) < tol && target.state !== 'spawn';
      } else {
        g.cam.yaw += wrap(0 - g.cam.yaw) * 0.04;
        g.cam.pitch += ((outro ? -0.12 : -0.03) - g.cam.pitch) * 0.05;
      }
      fireT -= dt;
      inp.fireHeld = false;
      const w = g.weapon;
      if (aligned) {
        if (w.spec.auto) inp.fireHeld = true;
        else if (w.spec.scope) { if (w.aim > 0.97 && fireT <= 0 && sim > 15.1) { inp.fireJust = true; fireT = 0.5; } }
        else if (fireT <= 0) { inp.fireJust = true; fireT = PRO ? 0.27 : 0.34; }
      }
      if (w.ammo === 0 && !w.reloading) inp.justPressed.add('KeyR');
      if (PRO && alive === 0 && w.ammo < w.spec.magSize * 0.6 && !w.reloading && !scoping) inp.justPressed.add('KeyR'); // reload in the lull

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
const silent = out.replace(/\.mp4$/, '.silent.mp4');
const wav = out.replace(/\.mp4$/, '.wav');
const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-vf', `scale=${OUT_W}:-2:flags=lanczos`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-crf', env.CRF || '17', '-preset', 'slow', '-movflags', '+faststart', silent,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const frames = Math.round(TOTAL * FPS);
const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__demo.step(); }, STEPS);
  const shot = await page.screenshot({ type: 'jpeg', quality: 96 });
  if (!ff.stdin.write(shot)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % (FPS / 2) === 0) {
    // a still every half second of film, to choose pictures from
    if (STILLS) await page.screenshot({ path: path.join(stillsDir, `${mode}-${String(f / (FPS / 2)).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 92 });
    process.stdout.write(`\r${Math.round((f / frames) * 100)}%  (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));

// ---------- the soundtrack: render it all at once, save as a WAV ----------
const audio = await page.evaluate(async (seconds) => {
  if (!window.__audio) return null;
  const buf = await window.__audio.startRendering();
  const n = Math.min(buf.length, Math.round(seconds * buf.sampleRate));
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const bytes = new Uint8Array(44 + n * 4);
  const v = new DataView(bytes.buffer);
  const text = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}, TOTAL);

const stats = await page.evaluate(() => ({ kills: window.__game.kills, hp: window.__game.player.health, state: window.__game.state }));
await browser.close();

const run = (args) => new Promise((res, rej) => spawn('ffmpeg', args, { stdio: 'inherit' }).on('close', (c) => (c ? rej(new Error('ffmpeg failed')) : res())));
if (audio) {
  await writeFile(wav, Buffer.from(audio, 'base64'));
  // join picture and sound; loudnorm brings it to the level social sites expect
  await run(['-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-c:v', 'copy', '-af', 'loudnorm=I=-15:TP=-1.5:LRA=11',
    '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out]);
  await rm(silent);
} else {
  await rename(silent, out);
}
console.log('\ndone', JSON.stringify(stats), audio ? `sound: ${wav}` : 'no sound');

# STILLPOINT

**Play it: https://stillpoint-gray.vercel.app**

A shooter where the world only moves when you do. Stand still and enemies,
bullets and debris freeze; walk and time flows; sprint and it runs at full
speed. Every kill brings a dancer onto the floor, so the club fills up as you
win — and the enemies that are left get shields.

[![STILLPOINT gameplay](docs/demo.gif)](https://stillpoint-gray.vercel.app)

Full 23-second clip with all three guns, both views and the sniper scope:
[docs/demo.mp4](docs/demo.mp4)

## Pictures

| First-person | Enemies with shields |
|---|---|
| ![First-person view with the pistol](docs/shot-first-person.jpg) | ![Shielded enemies and dancers](docs/shot-shields.jpg) |

| Third-person | Sniper scope |
|---|---|
| ![Third-person view of the ogre hero](docs/shot-third-person.jpg) | ![Looking through the sniper scope](docs/shot-scope.jpg) |

On a phone, on-screen controls appear:

<img src="docs/shot-mobile.jpg" alt="Phone layout with joystick and buttons" width="300">

## What is in it

- **Time control** — the world runs at 2% speed while you stand still and at full speed when you run. Shooting and reloading push time forward briefly.
- **Two views** — first-person by default, third-person on `V` (an original muscle-bound ogre). The sniper scope always looks through his eyes.
- **Three guns** — pistol, AK (hold to fire) and a scoped sniper that shoots through enemies.
- **Enemies that learn** — every kill gives each survivor a shield point; every 3 kills raises the enemy level.
- **A party** — light-up dance floor, moving beams, mirror ball, LED ceiling, a DJ, and generated club music that goes muffled when time freezes.
- **After a kill** — a dancer appears with confetti, and the ogre sits down and cries.
- **No asset files** — geometry, textures, sound effects and music are all generated in code with Three.js and the Web Audio API.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173 in Chrome or Safari and click to begin.
(The game captures the mouse; press Esc to release it.)

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Aim |
| Left click | Fire (hold for the AK) |
| Right click | Zoom / sniper scope |
| 1 2 3 or wheel | Pistol, AK, sniper |
| R | Reload |
| Space | Jump |
| Shift | Slow walk (slow time) |
| V | Switch third / first person |
| M | Music on / off |
| Esc | Pause |

On a phone, or in a window narrower than 820 px, on-screen controls appear:
a floating joystick for the left thumb (push gently to walk slowly), drag to
look with the right thumb, and buttons for fire, jump, reload, zoom, weapon
and view. To try it on your phone, run `npm run dev -- --host` and open the
Network address it prints (phone and computer on the same Wi-Fi).

Optional: put a real crying recording at `public/sounds/cry.mp3` and the hero
uses it after a kill instead of the built-in synthesised voice.

## How it is built

`Game.js` owns every system and runs one frame in this order:
input → player (real time) → `TimeSystem` picks the world speed → enemies,
bullets and effects advance by that scaled time → render.
The party (music, lights, dancers) always runs on real time, to the beat.

| File | Job |
|---|---|
| `src/config.js` | Every tunable number: speeds, time curve, weapons, enemies, colours |
| `src/core/Game.js` | Game states and the frame loop |
| `src/core/TimeSystem.js` | Turns player activity into world speed |
| `src/core/Input.js` | Keyboard, mouse, pointer lock |
| `src/core/AudioSystem.js`, `Music.js` | Synthesised sound effects and the soundtrack |
| `src/player/PlayerController.js` | Movement, jumping, collision, health |
| `src/player/CameraController.js` | Third / first-person camera, recoil, zoom, shake |
| `src/player/PlayerAvatar.js` | The ogre hero model and its animation |
| `src/weapons/Weapon.js`, `weaponModels.js` | Gun behaviour and the three gun models |
| `src/weapons/ProjectileSystem.js` | Travelling bullets and what they hit |
| `src/enemies/Enemy.js`, `EnemyManager.js` | Enemy models, AI, waves |
| `src/world/Arena.js`, `Collision.js`, `NavGrid.js` | Level geometry, physics queries, pathfinding |
| `src/world/Party.js`, `src/party/Dancers.js` | Dance floor, lights, mirror ball, dancers |
| `src/fx/Effects.js` | Shards, flashes, confetti, debris |
| `src/render/Renderer.js` | Lights, shadows, bloom, colour grade |
| `src/ui/HUD.js` | Crosshair, health, ammo, screens |
| `src/ui/TouchControls.js` | On-screen joystick and buttons for phones |

## Re-filming the demo

`tools/record.mjs` films the clip and stills above: a scripted bot plays the
real game in headless Chrome, one exact 1/60 s step at a time.

```bash
npm i --no-save puppeteer-core
npm run dev
node tools/record.mjs docs/demo.mp4 /tmp/stills desktop 23.5
```

Made by [Hamzeh](https://hamzeh.framer.ai/?utm_source=mini-game&utm_medium=referral).

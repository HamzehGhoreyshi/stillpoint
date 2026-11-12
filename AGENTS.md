First read ~/Desktop/AI/ai-os/AGENTS.md

# AGENTS.md — mini-game (STILLPOINT)

## First
This project belongs to Hamzeh's AI OS.
Read `~/Desktop/AI/ai-os/AGENTS.md` and follow its session routine.
If you cannot reach that path, ask Hamzeh to also connect the `ai-os` folder.
Project summary lives in: `~/Desktop/AI/ai-os/10_context/projects/mini-game.md`

## This project
- What it is: STILLPOINT — a browser first-person shooter where time only moves when the player moves; kills bring dancers onto a party dance floor. Experiment.
- Tech stack: Three.js + Vite, plain JavaScript modules. No asset files: geometry, textures, sound and music are generated in code.
- How to run it: `npm install`, then `npm run dev` → http://localhost:5173 (use Chrome/Safari so the mouse can be captured). Add `?nolock` to play without mouse capture.
- How to deploy it: push to `main` — the GitHub repo is connected to the Vercel project `stillpoint`, so every push deploys to https://stillpoint-gray.vercel.app. (`vercel deploy --prod --yes` still works for a manual deploy.)
- Repo: https://github.com/HamzehGhoreyshi/stillpoint (public).
- Demo media: `node tools/record.mjs` re-films `docs/demo.mp4` and the stills (see README).
- Rules specific to this project:
  - All balance numbers live in `src/config.js` — change feel there, not inside systems.
  - Original art direction only (moonlit slate, amber enemies, ivory guns, an original green ogre hero). Do not copy the look of an existing game or character — Hamzeh asked for Shrek; the hero is deliberately an original muscle-bound ogre instead.
  - Graphics tiers live in `QUALITY` in `src/config.js`; new visual features must respect them (anything costly needs an off switch for the `low` tier).
  - Static level geometry is merged at start-up (`Arena.mergeStatic`), so arena meshes cannot be moved or recoloured individually afterwards — animate things in `Party.js` instead.
  - Do not edit files under `src/`, `public/` or `index.html` while `tools/record.mjs` is filming: the dev server reloads the page and ruins the take.
  - Touch controls write into the same `Input` object as keyboard and mouse; never branch game logic on device type.
  - World systems use scaled time from `TimeSystem`; the player and the party (music, lights, dancers) use real time.
  - Portfolio link (Hamzeh's own public projects, not client sites): the published page must show a visible link to `https://hamzeh.framer.ai/?utm_source=mini-game&utm_medium=referral`. Check it is there before every deploy.

## Session end (in addition to the AI OS routine)
- Commit and push this project's changes to its own repo.
- Update the project page in ai-os/10_context/projects/mini-game.md directly: state, decisions, next actions.

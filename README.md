# Daud Track — footer mini game

An isometric running track for the Daud footer. You jump over the snooze alarm clocks and grab the post-run coffee (+50).
It's a static site with no build step, built on Three.js r163 (loaded from jsDelivr, the same as the hero).

## Files
- `index.html`: the page and the score display
- `style.css`: the score display, hint and game-over styling (the font is Doto, dot matrix, self-hosted in `assets/`)
- `main.js`: everything else. The colours are in `COLORS`, the difficulty in `GAME` and the track size in `TRACK`, all at the top of the file.
- `models/`: `runner.glb`, `clock.glb`, `coffee.glb`. They're recoloured in code, so their own colours don't matter.
- `assets/daud-logo.png`: the dot-matrix logo painted on the infield

## Deploy (Vercel)
1. Create a new GitHub repo (e.g. `DaudTrack`) and upload all of these files, keeping the folders.
2. In Vercel, choose New Project, import the repo, set Framework to "Other" and click Deploy. There's no build command.

## Embed in Framer
- Add an Embed (URL) to the footer: `https://<your-vercel-url>/`
- Size: full width; height about 100vh (clamp 640–900px) on desktop and 100svh on mobile.
- Put the email and social row above it, or overlay it on top. The game keeps its top-left area empty.

## Controls
- Desktop: Space, ↑ or click to start and to jump. After the first click the game has keyboard focus, so Space won't scroll the page.
- Mobile: tap.

## Handy URLs
- `?bot`: the game plays itself (for demos and screen recordings)

## Notes
- The best score (HI) is saved in the visitor's browser.
- The game stops rendering when the footer is off screen.
- Doto font: SIL Open Font License (`assets/Doto-OFL.txt`).

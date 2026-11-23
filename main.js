import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* =========================================================
   DAUD TRACK — footer mini game
   Jump over the snooze alarms, grab the post-run coffee.
   ========================================================= */

// ---------- Look (white paper) — change colours here ----------
const COLORS = {
  bg: "#FFFFFF",
  track: "#F3AFD0",
  trackSide: "#D592B3",
  infield: "#F4F4F4",
  infieldSide: "#E3E3E3",
  lines: "#FFFFFF",
  logo: "#303030",
  shadow: "#B07A95",
  // runner
  hair: "#303030",
  skin: "#FFFFFF",
  shirt: "#303030",
  shorts: "#303030",
  shoes: "#F3AFD0",
  // alarm clock
  clockBody: "#303030",
  clockFace: "#FFFFFF",
  clockHands: "#303030",
  clockBells: "#F3AFD0",
  // coffee
  cup: "#FFFFFF",
  cupSleeve: "#303030",
  cupLid: "#FFFFFF",
  straw: "#F3AFD0",
};

// ---------- Gameplay tuning ----------
const GAME = {
  idleSpeed: 3.2, // units/s while waiting to start
  startSpeed: 5.2, // units/s when a run starts
  maxSpeed: 10.5,
  rampScore: 1400, // score at which speed is ~63% of the way to max
  scorePerUnit: 2, // ~10 points per second at start (dino-like)
  airTime: 0.62, // seconds in the air
  jumpHeight: 1.9, // world units (clock is ~1.2 tall)
  clockScale: 0.47,
  coffeeScale: 0.68,
  coffeeBonus: 50,
  coffeeChance: 0.3, // chance a long gap gets a coffee
  doubleChance: 0.25, // chance of a double clock once warmed up
  spawnAheadLaps: 0.55, // obstacles appear this far ahead of the runner
  firstObstacleDelay: 1.4, // seconds of free running after start
  storageKey: "daud-track-hi",
};

// ---------- Track ----------
const TRACK = {
  lengthDesktop: 11, // straight length
  lengthPortrait: 15,
  rIn: 3.2,
  rOut: 5.6,
  depth: 0.7,
  lanes: 4,
  runLane: 0.625, // 0 = inner edge, 1 = outer edge
  runnerScale: 1.9,
};

const params = new URLSearchParams(location.search);
const BOT = params.has("bot"); // ?bot — auto-play demo / testing

// =========================================================
const canvas = document.getElementById("game");
const hud = {
  hi: document.getElementById("hi"),
  score: document.getElementById("score"),
  hint: document.getElementById("hint"),
  over: document.getElementById("over"),
  overScore: document.getElementById("overScore"),
  pops: document.getElementById("pops"),
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setClearColor(COLORS.bg);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 200);

scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(-6, 14, 8);
scene.add(sun);

// 3-band toon ramp for the flat illustrated look
const ramp = new THREE.DataTexture(new Uint8Array([90, 180, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;
const matCache = new Map();
function toon(hex) {
  if (!matCache.has(hex)) matCache.set(hex, new THREE.MeshToonMaterial({ color: hex, gradientMap: ramp }));
  return matCache.get(hex);
}
const flat = (hex) => new THREE.MeshBasicMaterial({ color: hex });

// ---------- World ----------
const world = new THREE.Group();
scene.add(world);
const trackGroup = new THREE.Group();
world.add(trackGroup);

let L = TRACK.lengthDesktop;
let laneR = TRACK.rIn + (TRACK.rOut - TRACK.rIn) * TRACK.runLane;
let lapLength = 2 * L + 2 * Math.PI * laneR;
let portrait = false;
let logoImage = null;

function stadium(path, r, reverse) {
  if (!reverse) {
    path.moveTo(-L / 2, -r);
    path.lineTo(L / 2, -r);
    path.absarc(L / 2, 0, r, -Math.PI / 2, Math.PI / 2, false);
    path.lineTo(-L / 2, r);
    path.absarc(-L / 2, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  } else {
    path.moveTo(-L / 2, -r);
    path.absarc(-L / 2, 0, r, Math.PI * 1.5, Math.PI / 2, true);
    path.lineTo(L / 2, r);
    path.absarc(L / 2, 0, r, Math.PI / 2, -Math.PI / 2, true);
    path.lineTo(-L / 2, -r);
  }
  return path;
}

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && o.material.map) o.material.map.dispose();
  });
  g.clear();
}

function buildTrack() {
  disposeGroup(trackGroup);
  const { rIn, rOut, depth, lanes } = TRACK;

  const ring = stadium(new THREE.Shape(), rOut);
  ring.holes.push(stadium(new THREE.Path(), rIn, true));
  const tg = new THREE.ExtrudeGeometry(ring, { depth, bevelEnabled: false, curveSegments: 56 });
  tg.rotateX(-Math.PI / 2);
  trackGroup.add(new THREE.Mesh(tg, [toon(COLORS.track), toon(COLORS.trackSide)]));

  const ig = new THREE.ExtrudeGeometry(stadium(new THREE.Shape(), rIn), { depth: depth * 0.8, bevelEnabled: false, curveSegments: 56 });
  ig.rotateX(-Math.PI / 2);
  trackGroup.add(new THREE.Mesh(ig, [toon(COLORS.infield), toon(COLORS.infieldSide)]));

  const lineMat = flat(COLORS.lines);
  for (let i = 0; i <= lanes; i++) {
    const r = rIn + ((rOut - rIn) * i) / lanes;
    const s = stadium(new THREE.Shape(), r + 0.05);
    s.holes.push(stadium(new THREE.Path(), r - 0.05, true));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s, 72), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = depth + 0.01;
    trackGroup.add(m);
  }
  // finish line across the front straight
  const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.22, rOut - rIn), lineMat);
  fin.rotation.x = -Math.PI / 2;
  fin.position.set(0, depth + 0.02, (rIn + rOut) / 2);
  trackGroup.add(fin);

  // dot-matrix logo painted on the infield
  if (logoImage) {
    const cv = document.createElement("canvas");
    cv.width = logoImage.width;
    cv.height = logoImage.height;
    const cx = cv.getContext("2d");
    cx.drawImage(logoImage, 0, 0);
    cx.globalCompositeOperation = "source-in";
    cx.fillStyle = COLORS.logo;
    cx.fillRect(0, 0, cv.width, cv.height);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const w = Math.min(L + 2.2, portrait ? 15.5 : 12.5);
    const h = (w * logoImage.height) / logoImage.width;
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    decal.rotation.x = -Math.PI / 2;
    decal.position.y = depth * 0.8 + 0.01;
    trackGroup.add(decal);
  }
}

// position + heading on the running lane for distance s
const _p = new THREE.Vector3();
function lanePoint(s, out = _p) {
  const r = laneR;
  let d = ((s % lapLength) + lapLength) % lapLength;
  const arc = Math.PI * r;
  let tx, tz;
  if (d < L) {
    out.set(-L / 2 + d, 0, r);
    tx = 1; tz = 0;
  } else if ((d -= L) < arc) {
    const t = d / r;
    out.set(L / 2 + r * Math.sin(t), 0, r * Math.cos(t));
    tx = Math.cos(t); tz = -Math.sin(t);
  } else if ((d -= arc) < L) {
    out.set(L / 2 - d, 0, -r);
    tx = -1; tz = 0;
  } else {
    d -= L;
    const t = d / r;
    out.set(-L / 2 - r * Math.sin(t), 0, -r * Math.cos(t));
    tx = -Math.cos(t); tz = Math.sin(t);
  }
  out.y = TRACK.depth;
  return Math.atan2(tx, tz); // heading for a model facing +Z
}

// ---------- Camera framing ----------
function layout() {
  const W = innerWidth, H = innerHeight;
  renderer.setSize(W, H, false);
  const nowPortrait = H > W * 1.05;
  if (nowPortrait !== portrait || !trackGroup.children.length) {
    portrait = nowPortrait;
    L = portrait ? TRACK.lengthPortrait : TRACK.lengthDesktop;
    lapLength = 2 * L + 2 * Math.PI * laneR;
    world.rotation.y = portrait ? Math.PI * 0.75 : 0;
    buildTrack();
  }

  const dir = portrait ? new THREE.Vector3(1, 1.7, 1) : new THREE.Vector3(1, 0.9, 1);
  camera.position.copy(dir.normalize().multiplyScalar(40));
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  // fit the track (plus runner headroom) into the view
  world.updateMatrixWorld(true);
  // sample the outer edge of the oval (bottom of the slab + runner headroom on top)
  const R = TRACK.rOut + 0.2;
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const x = Math.cos(a) * R + Math.sign(Math.cos(a)) * (L / 2);
    const z = Math.sin(a) * R;
    pts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, TRACK.depth + 2.2, z));
  }
  const inv = camera.matrixWorldInverse;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    p.applyMatrix4(world.matrixWorld).applyMatrix4(inv);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const aspect = W / H;
  // leave room for HUD (top) and hint text (bottom)
  const padTop = portrait ? 0.11 : 0.1, padBottom = portrait ? 0.17 : 0.2, padSide = 0.05;
  const spanY = (maxY - minY) / (1 - padTop - padBottom);
  const spanX = (maxX - minX) / (1 - 2 * padSide);
  let halfH = Math.max(spanY, spanX / aspect) / 2;
  const cxv = (minX + maxX) / 2;
  const cyv = (minY + maxY) / 2 + halfH * (padTop - padBottom);
  camera.left = cxv - halfH * aspect;
  camera.right = cxv + halfH * aspect;
  camera.top = cyv + halfH;
  camera.bottom = cyv - halfH;
  camera.updateProjectionMatrix();
}

// ---------- Assets ----------
const loader = new GLTFLoader();
function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

function recolor(root, map, fallback) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const key = Object.keys(map).find((k) => o.name === k || o.material?.name === k || o.name.startsWith(k));
    o.material = toon(key ? map[key] : fallback);
  });
}

let runnerModel, mixer, runAction, clockTemplate, coffeeTemplate;
const runner = new THREE.Group(); // heading
const runnerBody = new THREE.Group(); // tumble / jump offset
runner.add(runnerBody);
world.add(runner);

const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.75, 24),
  new THREE.MeshBasicMaterial({ color: COLORS.shadow, transparent: true, opacity: 0.35, depthWrite: false })
);
shadow.rotation.x = -Math.PI / 2;
world.add(shadow);

async function loadAssets() {
  const [runnerGltf, clockGltf, coffeeGltf, logo] = await Promise.all([
    loader.loadAsync("./runner.glb"),
    loader.loadAsync("./clock.glb"),
    loader.loadAsync("./coffee.glb"),
    loadImage("./daud-logo.png").catch(() => null),
  ]);
  logoImage = logo;

  runnerModel = runnerGltf.scene;
  recolor(runnerModel, {
    "Material.002": COLORS.hair,
    "Material.003": COLORS.skin,
    "Material.004": COLORS.shirt,
    "Material.005": COLORS.shorts,
    "Material.006": COLORS.shoes,
  }, COLORS.shirt);
  runnerModel.scale.setScalar(TRACK.runnerScale);
  runnerBody.add(runnerModel);
  mixer = new THREE.AnimationMixer(runnerModel);
  runAction = mixer.clipAction(runnerGltf.animations[0]);
  runAction.play();

  clockTemplate = clockGltf.scene;
  recolor(clockTemplate, {
    Face: COLORS.clockFace,
    Clock: COLORS.clockBody,
    Bells: COLORS.clockBells,
    Button: COLORS.clockBody,
    Arrows_Small: COLORS.clockHands,
    Arrows_Large: COLORS.clockHands,
    Knob: COLORS.clockHands,
    Leg: COLORS.clockBody,
  }, COLORS.clockBody);

  coffeeTemplate = coffeeGltf.scene;
  recolor(coffeeTemplate, {
    Cylinder_4: COLORS.straw,
    Cylinder_3: COLORS.cupLid,
    Cylinder_2: COLORS.cupSleeve,
    Cylinder: COLORS.cup,
  }, COLORS.cup);
  // centre the cup on its footprint
  const cb = new THREE.Box3().setFromObject(coffeeTemplate);
  const cc = cb.getCenter(new THREE.Vector3());
  coffeeTemplate.position.set(-cc.x, -cb.min.y, -cc.z);
  const cw = new THREE.Group();
  cw.add(coffeeTemplate);
  coffeeTemplate = cw;
}

// ---------- Game state ----------
const state = {
  mode: "loading", // loading | idle | playing | over
  dist: 0, // runner distance along lane
  speed: GAME.idleSpeed,
  score: 0,
  hi: 0,
  y: 0,
  vy: 0,
  grounded: true,
  runTime: 0,
  nextSpawn: 0,
  lastFlash: 0,
  overAt: 0,
  tumble: 0,
};
try {
  state.hi = parseInt(localStorage.getItem(GAME.storageKey) || "0", 10) || 0;
} catch (_) {}

const GRAV = (8 * GAME.jumpHeight) / (GAME.airTime * GAME.airTime);
const JUMP_V = (GRAV * GAME.airTime) / 2;

const things = []; // {type, s, obj, born, hit, taken}

const pad = (n) => String(Math.floor(n)).padStart(5, "0");
function renderScore() {
  hud.score.textContent = pad(state.score);
  hud.hi.textContent = "HI " + pad(state.hi);
}

function clearThings() {
  for (const t of things) world.remove(t.obj);
  things.length = 0;
}

function spawnClock(s) {
  const obj = clockTemplate.clone(true);
  obj.scale.setScalar(0.001);
  const wrap = new THREE.Group();
  wrap.add(obj);
  world.add(wrap);
  things.push({ type: "clock", s, obj: wrap, inner: obj, born: performance.now(), hit: false, fly: null });
}

function spawnCoffee(s) {
  const obj = coffeeTemplate.clone(true);
  obj.scale.setScalar(0.001);
  const wrap = new THREE.Group();
  wrap.add(obj);
  world.add(wrap);
  things.push({ type: "coffee", s, obj: wrap, inner: obj, born: performance.now(), taken: false, takenAt: 0 });
}

function difficulty() {
  return 1 - Math.exp(-state.score / GAME.rampScore);
}

function scheduleSpawns() {
  const ahead = state.dist + lapLength * GAME.spawnAheadLaps;
  while (state.nextSpawn < ahead) {
    const k = difficulty();
    const v = state.speed;
    spawnClock(state.nextSpawn);
    let extra = 0;
    if (k > 0.35 && Math.random() < GAME.doubleChance) {
      spawnClock(state.nextSpawn + 1.15);
      extra = 1.15;
    }
    // gap in seconds at current speed, shrinking as the run heats up
    const tMin = GAME.airTime * 1.45;
    const tMax = THREE.MathUtils.lerp(2.7, 1.35, k);
    const gap = v * THREE.MathUtils.lerp(tMin, Math.max(tMin * 1.05, tMax), Math.random()) + extra;
    if (gap > v * GAME.airTime * 2.6 && Math.random() < GAME.coffeeChance) {
      spawnCoffee(state.nextSpawn + extra + gap * 0.5);
    }
    state.nextSpawn += gap;
  }
}

function startRun() {
  clearThings();
  state.mode = "playing";
  state.score = 0;
  state.speed = GAME.startSpeed;
  state.runTime = 0;
  state.lastFlash = 0;
  state.y = 0;
  state.vy = 0;
  state.grounded = true;
  state.tumble = 0;
  runnerBody.rotation.set(0, 0, 0);
  runnerBody.position.set(0, 0, 0);
  runAction.paused = false;
  state.nextSpawn = state.dist + GAME.startSpeed * GAME.firstObstacleDelay + lapLength * 0.25;
  hud.hint.classList.add("gone");
  hud.over.hidden = true;
  document.body.classList.add("playing");
  renderScore();
}

function gameOver(clock) {
  state.mode = "over";
  state.overAt = performance.now();
  runAction.paused = true;
  const newPB = state.score > state.hi;
  if (newPB) {
    state.hi = Math.floor(state.score);
    try {
      localStorage.setItem(GAME.storageKey, String(state.hi));
    } catch (_) {}
  }
  if (clock) clock.fly = { vx: 0, vy: 7, spin: 9, t: 0 };
  hud.overScore.innerHTML = pad(state.score) + (newPB ? ' &nbsp;<span class="pb">NEW PB!</span>' : "");
  hud.over.hidden = false;
  document.body.classList.remove("playing");
  renderScore();
}

function jump() {
  if (state.mode === "loading") return;
  if (state.mode === "idle") return startRun();
  if (state.mode === "over") {
    if (performance.now() - state.overAt > 450) startRun();
    return;
  }
  if (state.grounded) {
    state.vy = JUMP_V;
    state.grounded = false;
  }
}

// ---------- Input ----------
addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    e.preventDefault();
    if (!e.repeat) jump();
  }
});
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== undefined && e.button > 0) return;
  canvas.focus?.();
  jump();
});
canvas.tabIndex = 0;

// "+50" floating text
const _sp = new THREE.Vector3();
function popText(worldPos, text) {
  _sp.copy(worldPos).project(camera);
  const el = document.createElement("div");
  el.className = "pop";
  el.textContent = text;
  el.style.left = ((_sp.x + 1) / 2) * innerWidth + "px";
  el.style.top = ((1 - _sp.y) / 2) * innerHeight + "px";
  hud.pops.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

// ---------- Loop ----------
const clock = new THREE.Clock();
let visible = true;
const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const _pos = new THREE.Vector3();
const _wp = new THREE.Vector3();

function update(dt) {
  const now = performance.now();

  if (state.mode === "playing") {
    state.runTime += dt;
    const k = difficulty();
    state.speed = THREE.MathUtils.lerp(GAME.startSpeed, GAME.maxSpeed, k);
    state.score += state.speed * dt * GAME.scorePerUnit;
    const hundreds = Math.floor(state.score / 100);
    if (hundreds > state.lastFlash) {
      state.lastFlash = hundreds;
      hud.score.classList.remove("flash");
      void hud.score.offsetWidth;
      hud.score.classList.add("flash");
    }
    scheduleSpawns();
  } else if (state.mode === "idle") {
    state.speed = GAME.idleSpeed;
  }

  if (state.mode !== "over") {
    state.dist += state.speed * dt;
    // jump physics
    if (!state.grounded) {
      state.vy -= GRAV * dt;
      state.y += state.vy * dt;
      if (state.y <= 0) {
        state.y = 0;
        state.vy = 0;
        state.grounded = true;
      }
    }
    if (mixer) {
      runAction.timeScale = state.grounded ? THREE.MathUtils.clamp(state.speed / 5, 0.75, 1.9) : 0.35;
      mixer.update(dt);
    }
  } else {
    // tumble forward
    state.tumble = Math.min(1, state.tumble + dt * 3.2);
    const e = 1 - Math.pow(1 - state.tumble, 3);
    runnerBody.rotation.x = e * 1.35;
    runnerBody.position.z = e * 0.9;
    state.y = Math.max(0, state.y - dt * 6);
  }

  // place runner
  const heading = lanePoint(state.dist, _pos);
  runner.position.copy(_pos);
  runner.rotation.y = heading;
  runnerBody.position.y = state.y;
  shadow.position.set(_pos.x, TRACK.depth + 0.015, _pos.z);
  const sh = 1 - Math.min(1, state.y / GAME.jumpHeight) * 0.45;
  shadow.scale.setScalar(sh);
  shadow.material.opacity = 0.35 * sh;

  // obstacles & pickups
  for (let i = things.length - 1; i >= 0; i--) {
    const t = things[i];
    const h = lanePoint(t.s, t.obj.position);
    const age = (now - t.born) / 1000;
    const ds = t.s - state.dist;

    if (t.type === "clock") {
      t.obj.rotation.y = h + Math.PI; // face the runner
      const sc = GAME.clockScale * (age < 0.4 ? easeOutBack(age / 0.4) : 1);
      t.inner.scale.setScalar(Math.max(0.001, sc));
      // ring when the runner gets close
      t.inner.rotation.z = ds > 0 && ds < 5 && state.mode === "playing" ? Math.sin(now * 0.045) * 0.14 : 0;

      if (t.fly) {
        t.fly.t += dt;
        t.inner.position.y = t.fly.vy * t.fly.t - 9 * t.fly.t * t.fly.t;
        t.inner.position.z = -t.fly.t * 3;
        t.inner.rotation.x = -t.fly.t * t.fly.spin;
        if (t.inner.position.y < -3) t.fly = null;
      } else if (state.mode === "playing" && Math.abs(ds) < 0.62 && state.y < GAME.clockScale * 2.3) {
        gameOver(t);
      }
    } else {
      t.obj.rotation.y = now * 0.0015;
      let sc = GAME.coffeeScale * (age < 0.4 ? easeOutBack(age / 0.4) : 1);
      t.inner.position.y = 0.12 + Math.sin(now * 0.004 + t.s) * 0.08;
      if (t.taken) {
        const a = (now - t.takenAt) / 250;
        sc *= 1 + a * 0.8;
        t.inner.position.y += a * 1.2;
        if (a > 1) {
          world.remove(t.obj);
          things.splice(i, 1);
          continue;
        }
      } else if (state.mode === "playing" && Math.abs(ds) < 0.6 && state.y < 0.9) {
        t.taken = true;
        t.takenAt = now;
        state.score += GAME.coffeeBonus;
        t.obj.getWorldPosition(_wp);
        _wp.y += 1.2;
        popText(_wp, "+" + GAME.coffeeBonus);
      }
      t.inner.scale.setScalar(Math.max(0.001, sc));
    }

    if (ds < -4 && state.mode === "playing") {
      world.remove(t.obj);
      things.splice(i, 1);
    }
  }

  // bot: auto-jump for demos / testing
  if (BOT && state.mode === "playing" && state.grounded) {
    const lead = state.speed * GAME.airTime * 0.42;
    for (const t of things) {
      const ds = t.s - state.dist;
      if (t.type === "clock" && !t.fly && ds > 0 && ds < lead) {
        jump();
        break;
      }
    }
  }
  if (BOT && state.mode === "idle") startRun();

  if (state.mode === "playing") renderScore();
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (!visible || state.mode === "loading") return;
  update(dt);
  renderer.render(scene, camera);
}

// pause when the footer is off screen (works inside the Framer iframe too)
if ("IntersectionObserver" in window) {
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) clock.getDelta();
  }).observe(canvas);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) clock.getDelta();
});

addEventListener("resize", layout);

// test hook
window.__daudTrack = { state, things, jump, step: (dt) => { update(dt); renderer.render(scene, camera); } };

// ---------- Boot ----------
(async () => {
  try {
    await loadAssets();
  } catch (err) {
    console.error("[daud-track] asset load failed", err);
    return;
  }
  layout();
  renderScore();
  state.mode = "idle";
  if (document.fonts?.ready) await document.fonts.ready;
  window.__daudReady = true;
  try {
    parent.postMessage({ type: "daudtrack:ready" }, "*");
  } catch (_) {}
})();
requestAnimationFrame(frame);

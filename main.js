import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as audio from "./audio.js";

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
  shoes: "#303030",
  teeLogo: "#FFFFFF", // Daud mark printed on the front of the tee
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
  outline: "#8E8E8E", // soft grey sticker outline on runner, clocks, coffee
  coffeeRing: "#FFFFFF",
  // effects
  dust: "#FFFFFF",
  pixels: ["#F3AFD0", "#303030", "#FFFFFF"], // pixel dissolve blocks
};

// ---------- Gameplay tuning ----------
const GAME = {
  idleSpeed: 3.2, // units/s while waiting to start
  startSpeed: 5.2, // units/s when a run starts
  maxSpeed: 10.5,
  rampScore: 1400, // score at which speed is ~63% of the way to max
  scorePerUnit: 2, // ~10 points per second at start (dino-like)
  airTime: 0.7, // seconds in the air
  jumpHeight: 2.1, // world units (clock is ~1.2 tall)
  jumpBuffer: 0.15, // s — a press just before landing still counts
  clockHitbox: 0.45, // half-length of the clock along the track
  clockScale: 0.47,
  coffeeScale: 0.8,
  coffeeBonus: 50,
  coffeeChance: 0.3, // chance a long gap gets a coffee
  doubleChance: 0.25, // chance of a double clock once warmed up
  spawnAheadLaps: 0.55, // obstacles appear this far ahead of the runner
  firstObstacleDelay: 1.4, // seconds of free running after start
  storageKey: "daud-track-hi",
  // look of the pieces (URL overrides for previews: ?outline=all&signal=bang&marker=ring)
  outline: "all", // "none" | "coffee" | "all"
  outlineWidth: 0.032, // world units
  clockSignal: "bang", // "bang" | "brring" | "none" — pops up while the clock rings
  clockMarker: "none", // "none" | "ring" — charcoal ring under clocks (the coffee's white ring, flipped)
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
  // tee print, in the model's own (bind-pose) units: centre + size on the chest
  teeLogo: { x: -0.12, y: 1.43, width: 0.6, minFacing: -0.35 }, // x shifts the D bowl to the centre; tails wrap round the side
};

const params = new URLSearchParams(location.search);
let BOT = params.has("bot"); // ?bot — auto-play demo / testing
if (params.has("outline")) GAME.outline = params.get("outline");
if (params.has("signal")) GAME.clockSignal = params.get("signal");
if (params.has("marker")) GAME.clockMarker = params.get("marker");

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
  // yaw (in world-local space) that points a +Z face at the camera
  const cd = camera.position.clone().applyMatrix4(new THREE.Matrix4().copy(world.matrixWorld).invert());
  camYaw = Math.atan2(cd.x, cd.z);
}
let camYaw = Math.PI / 4;

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

// ---------- Pixel dissolve (same idea as the hero reveal) ----------
const toOut = (hex) => new THREE.Color(hex).convertLinearToSRGB();
const dissolve = {
  uDis: { value: 0 },
  uBand: { value: 0.28 },
  uBlock: { value: 0.2 },
  uBotY: { value: 0 },
  uTopY: { value: 4 },
  uPA: { value: toOut(COLORS.pixels[0]) },
  uPB: { value: toOut(COLORS.pixels[1]) },
  uPC: { value: toOut(COLORS.pixels[2]) },
};
const tee = {
  uTeeMap: { value: null },
  uTeeColor: { value: new THREE.Color(COLORS.teeLogo) },
  uTeeRect: { value: new THREE.Vector4(0, 1.3, 0.4, 0.13) }, // cx, cy, w, h
  uTeeFacing: { value: TRACK.teeLogo.minFacing },
};
function dissolveMaterial(hex, withTee = false) {
  const m = new THREE.MeshToonMaterial({ color: hex, gradientMap: ramp });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, dissolve);
    if (withTee) {
      Object.assign(sh.uniforms, tee);
      sh.defines = Object.assign(sh.defines || {}, { DAUD_TEE: "" });
    }
    sh.vertexShader = "varying vec3 vDisW;\n#ifdef DAUD_TEE\nuniform vec4 uTeeRect;\nvarying vec2 vTeeUv;\nvarying float vTeeF;\n#endif\n" + sh.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      vDisW = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #ifdef DAUD_TEE
        // planar print from the front, in bind pose so it sticks to the cloth
        vTeeUv = (position.xy - uTeeRect.xy) / uTeeRect.zw + 0.5;
        vTeeF = abs(position.x) < 0.2 ? normal.z : -1.0; // torso only, not the sleeves
      #endif`
    );
    if (withTee) {
      sh.fragmentShader = sh.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        if (vTeeF > uTeeFacing && all(greaterThan(vTeeUv, vec2(0.0))) && all(lessThan(vTeeUv, vec2(1.0)))) {
          float tA = texture2D(uTeeMap, vTeeUv).a;
          diffuseColor.rgb = mix(diffuseColor.rgb, uTeeColor, tA);
        }`
      );
      sh.fragmentShader = "#ifdef DAUD_TEE\nuniform sampler2D uTeeMap;\nuniform vec3 uTeeColor;\nuniform float uTeeFacing;\nvarying vec2 vTeeUv;\nvarying float vTeeF;\n#endif\n" + sh.fragmentShader;
    }
    sh.fragmentShader =
      `varying vec3 vDisW;
      uniform float uDis, uBand, uBlock, uBotY, uTopY;
      uniform vec3 uPA, uPB, uPC;
      float disHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      ` +
      sh.fragmentShader.replace(
        "void main() {",
        `void main() {
        if (uDis > 0.0) {
          vec3 dCell = floor(vDisW / uBlock);
          float dR = disHash(dCell);
          float dH = clamp((vDisW.y - uBotY) / (uTopY - uBotY), 0.0, 1.0);
          float dT = mix(1.0 - dH, dR, 0.55);          // top first, ragged
          float dP = uDis * (1.0 + uBand);
          if (dP > dT + uBand) discard;
          if (dP > dT) {
            float dK = disHash(dCell + 7.31);
            vec3 dC = dK < 0.5 ? uPA : (dK < 0.8 ? uPB : uPC);
            gl_FragColor = vec4(dC, 1.0);
            return;
          }
        }`
      );
  };
  m.customProgramCacheKey = () => (withTee ? "daud-dissolve-tee" : "daud-dissolve");
  return m;
}

// ---------- Outline for the coffee (reads as a collectible) ----------
function outlineMaterial(hex, thick) {
  const m = new THREE.MeshBasicMaterial({ color: hex, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uThick = { value: thick };
    sh.vertexShader = "uniform float uThick;\n" + sh.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      #ifdef USE_SKINNING
        vec3 oN = normalize(normalMatrix * objectNormal);
      #else
        vec3 oN = normalize(normalMatrix * normal);
      #endif
      mvPosition.xyz += oN * uThick;
      gl_Position = projectionMatrix * mvPosition;`
    );
  };
  m.customProgramCacheKey = () => "daud-outline";
  return m;
}
function addOutlines(root, thick) {
  const mat = outlineMaterial(COLORS.outline, thick);
  const list = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) list.push(o); });
  const made = [];
  for (const m of list) {
    let ol;
    if (m.isSkinnedMesh) {
      ol = new THREE.SkinnedMesh(m.geometry, mat);
      ol.bind(m.skeleton, m.bindMatrix);
      m.parent.add(ol);
      ol.position.copy(m.position); ol.quaternion.copy(m.quaternion); ol.scale.copy(m.scale);
    } else {
      ol = new THREE.Mesh(m.geometry, mat);
      m.add(ol);
    }
    ol.userData.isOutline = true;
    ol.frustumCulled = false;
    ol.renderOrder = -1;
    made.push(ol);
  }
  return made;
}
let runnerOutlines = [];
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
  const [runnerGltf, clockGltf, coffeeGltf, logo, mark] = await Promise.all([
    loader.loadAsync("./runner.glb"),
    loader.loadAsync("./clock.glb"),
    loader.loadAsync("./coffee.glb"),
    loadImage("./daud-logo.png").catch(() => null),
    loadImage("./daud-mark.png").catch(() => null),
  ]);
  if (mark) {
    const t = new THREE.Texture(mark);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    tee.uTeeMap.value = t;
    const L = TRACK.teeLogo;
    tee.uTeeRect.value.set(L.x, L.y, L.width, (L.width * mark.height) / mark.width);
  }
  logoImage = logo;

  runnerModel = runnerGltf.scene;
  const runnerColors = {
    "Material.002": COLORS.hair,
    "Material.003": COLORS.skin,
    "Material.004": COLORS.shirt,
    "Material.005": COLORS.shorts,
    "Material.006": COLORS.shoes,
  };
  runnerModel.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const isShirt = o.material?.name === "Material.004";
    o.material = dissolveMaterial(runnerColors[o.material?.name] || COLORS.shirt, isShirt && !!mark);
  });
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
  // outlines (sticker look) — coffee only, or everything
  const ow = GAME.outlineWidth;
  if (GAME.outline === "coffee" || GAME.outline === "all") addOutlines(coffeeTemplate, ow * 1.15);
  if (GAME.outline === "all") {
    addOutlines(clockTemplate, ow);
    runnerOutlines = addOutlines(runnerModel, ow * 0.9);
  }
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
  bufferedAt: -1,
  dis: 0, // pixel dissolve progress (0 visible, 1 gone)
  disTarget: 0,
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

const clockRingGeo = new THREE.RingGeometry(0.5, 0.7, 40);
clockRingGeo.rotateX(-Math.PI / 2);

// "BRRING!" / "!" pop above a ringing clock
const signalTex = {};
function getSignalTex(kind) {
  if (signalTex[kind]) return signalTex[kind];
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  if (kind === "bang") {
    c.width = c.height = 128;
    x.fillStyle = COLORS.clockBody;
    x.beginPath(); x.arc(64, 58, 46, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.moveTo(50, 96); x.lineTo(64, 124); x.lineTo(78, 96); x.fill();
    x.fillStyle = COLORS.lines;
    x.font = '900 72px "Doto", monospace'; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText("!", 64, 62);
  } else {
    c.width = 512; c.height = 160;
    x.font = '900 104px "Doto", monospace'; x.textAlign = "center"; x.textBaseline = "middle";
    x.lineJoin = "round"; x.lineWidth = 22; x.strokeStyle = COLORS.lines; x.strokeText("BRRING!", 256, 84);
    x.fillStyle = COLORS.clockBody; x.fillText("BRRING!", 256, 84);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (signalTex[kind] = { tex: t, aspect: c.width / c.height });
}

function spawnClock(s) {
  const obj = clockTemplate.clone(true);
  obj.scale.setScalar(0.001);
  const wrap = new THREE.Group();
  wrap.add(obj);
  let patch = null, sign = null;
  if (GAME.clockMarker === "ring") {
    patch = new THREE.Mesh(clockRingGeo, new THREE.MeshBasicMaterial({ color: COLORS.clockBody, transparent: true, depthWrite: false }));
    patch.position.y = 0.012;
    wrap.add(patch);
  }
  if (GAME.clockSignal !== "none") {
    const st = getSignalTex(GAME.clockSignal);
    sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: st.tex, transparent: true, depthTest: false }));
    const h = GAME.clockSignal === "bang" ? 0.85 : 0.85;
    sign.userData.base = new THREE.Vector2(h * st.aspect, h);
    sign.position.y = GAME.clockSignal === "bang" ? 2.25 : 2.1;
    sign.renderOrder = 5;
    sign.visible = false;
    wrap.add(sign);
  }
  world.add(wrap);
  things.push({ type: "clock", s, obj: wrap, inner: obj, patch, sign, ringFor: 0, born: performance.now(), hit: false, fly: null });
}

const ringGeo = new THREE.RingGeometry(0.46, 0.72, 40);
ringGeo.rotateX(-Math.PI / 2);
function spawnCoffee(s) {
  const obj = coffeeTemplate.clone(true);
  obj.scale.setScalar(0.001);
  const wrap = new THREE.Group();
  wrap.add(obj);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: COLORS.coffeeRing, transparent: true, depthWrite: false }));
  ring.position.y = 0.02;
  wrap.add(ring);
  world.add(wrap);
  things.push({ type: "coffee", s, obj: wrap, inner: obj, ring, born: performance.now(), taken: false, takenAt: 0 });
}

// ---------- Dust puffs ----------
const dustGeo = new THREE.CircleGeometry(1, 14);
const puffs = [];
for (let i = 0; i < 40; i++) {
  const m = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({ color: COLORS.dust, transparent: true, depthWrite: false }));
  m.visible = false;
  m.renderOrder = 2;
  world.add(m);
  puffs.push({ m, life: 0, max: 1, size: 0.3, vx: 0, vy: 0, vz: 0 });
}
let puffCursor = 0, puffTimer = 0;
const _wq = new THREE.Quaternion();
function emitPuff(x, z, back, size, spread = 0.25, up = 0.6) {
  const p = puffs[puffCursor++ % puffs.length];
  const a = Math.random() * Math.PI * 2;
  p.m.position.set(x + Math.cos(a) * spread * Math.random(), TRACK.depth + 0.12, z + Math.sin(a) * spread * Math.random());
  p.vx = back.x * 0.8 + (Math.random() - 0.5) * 0.6;
  p.vz = back.z * 0.8 + (Math.random() - 0.5) * 0.6;
  p.vy = up * (0.6 + Math.random() * 0.6);
  p.size = size * (0.7 + Math.random() * 0.6);
  p.max = 0.38 + Math.random() * 0.22;
  p.life = p.max;
  p.m.visible = true;
}
function updatePuffs(dt) {
  // face the camera (undo the world rotation)
  _wq.copy(world.quaternion).invert().multiply(camera.quaternion);
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.m.visible = false; continue; }
    const k = 1 - p.life / p.max;
    p.m.position.x += p.vx * dt;
    p.m.position.y += p.vy * dt;
    p.m.position.z += p.vz * dt;
    p.m.scale.setScalar(p.size * (0.4 + k * 0.9));
    p.m.material.opacity = 0.9 * (1 - k * k);
    p.m.quaternion.copy(_wq);
  }
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
  state.bufferedAt = -1;
  state.disTarget = 0; // pixel back in if he vanished
  runnerBody.rotation.set(0, 0, 0);
  runnerBody.position.set(0, 0, 0);
  runAction.paused = false;
  state.nextSpawn = state.dist + GAME.startSpeed * GAME.firstObstacleDelay + lapLength * 0.25;
  hud.hint.classList.add("gone");
  hud.over.hidden = true;
  document.body.classList.add("playing");
  renderScore();
  audio.sfx.start();
  audio.musicStart();
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
  audio.musicStop();
  audio.sfx.crash();
  if (newPB && state.hi > 0) audio.sfx.pb();
  hud.overScore.innerHTML = pad(state.score) + (newPB ? ' &nbsp;<span class="pb">NEW PB!</span>' : "");
  hud.over.hidden = false;
  document.body.classList.remove("playing");
  renderScore();
}

function jump() {
  if (state.mode === "loading") return;
  audio.unlock();
  if (state.mode === "idle") return startRun();
  if (state.mode === "over") {
    if (performance.now() - state.overAt > 450) startRun();
    return;
  }
  if (state.grounded) doJump();
  else state.bufferedAt = performance.now();
}
function doJump() {
  state.vy = JUMP_V;
  state.grounded = false;
  state.bufferedAt = -1;
  audio.sfx.jump();
  const h = lanePoint(state.dist, _pos);
  for (let i = 0; i < 4; i++) emitPuff(_pos.x, _pos.z, { x: -Math.sin(h), z: -Math.cos(h) }, 0.28, 0.3, 0.4);
}

// ---------- Input ----------
const soundBtn = document.getElementById("sound");
function renderSound() {
  if (!soundBtn) return;
  soundBtn.textContent = audio.isOn() ? "SOUND ON" : "SOUND OFF";
  soundBtn.setAttribute("aria-pressed", String(audio.isOn()));
}
function toggleSound() {
  audio.unlock();
  audio.setOn(!audio.isOn());
  renderSound();
}
soundBtn?.addEventListener("pointerdown", (e) => e.stopPropagation());
soundBtn?.addEventListener("click", (e) => { e.stopPropagation(); toggleSound(); soundBtn.blur(); });
renderSound();

addEventListener("keydown", (e) => {
  if (e.code === "KeyM") return toggleSound();
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
      audio.sfx.hundred();
    }
    scheduleSpawns();
    audio.musicIntensity(k);
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
        audio.sfx.land();
        const h = lanePoint(state.dist, _pos);
        for (let i = 0; i < 6; i++) emitPuff(_pos.x, _pos.z, { x: Math.cos(i) * 0.8, z: Math.sin(i) * 0.8 }, 0.32, 0.35, 0.35);
        if (state.bufferedAt > 0 && performance.now() - state.bufferedAt < GAME.jumpBuffer * 1000 && state.mode === "playing") doJump();
      }
    }
    if (mixer) {
      runAction.timeScale = state.grounded ? THREE.MathUtils.clamp(state.speed / 5, 0.75, 1.9) : 0.35;
      mixer.update(dt);
    }
  } else {
    // tumble forward, then pixel away
    state.tumble = Math.min(1, state.tumble + dt * 3.2);
    if (performance.now() - state.overAt > 280) state.disTarget = 1;
    const e = 1 - Math.pow(1 - state.tumble, 3);
    runnerBody.rotation.x = e * 1.35;
    runnerBody.position.z = e * 0.9;
    state.y = Math.max(0, state.y - dt * 6);
  }

  // pixel dissolve: out over ~0.75s, back in over ~0.45s
  const disRate = state.disTarget > state.dis ? 1.35 : 2.2;
  state.dis = state.disTarget > state.dis ? Math.min(state.disTarget, state.dis + dt * disRate) : Math.max(state.disTarget, state.dis - dt * disRate);
  dissolve.uDis.value = state.dis;
  runnerBody.visible = state.dis < 0.999;
  for (const o of runnerOutlines) o.visible = state.dis < 0.02;

  // place runner
  const heading = lanePoint(state.dist, _pos);
  dissolve.uBotY.value = TRACK.depth + state.y - 0.2;
  dissolve.uTopY.value = TRACK.depth + state.y + 3.7;

  // running dust behind the feet
  if (state.mode !== "over" && state.grounded) {
    puffTimer -= dt;
    if (puffTimer <= 0) {
      puffTimer = 0.55 / Math.max(3, state.speed);
      const bx = -Math.sin(heading), bz = -Math.cos(heading);
      emitPuff(_pos.x + bx * 0.35, _pos.z + bz * 0.35, { x: bx, z: bz }, state.mode === "playing" ? 0.2 : 0.14, 0.15, 0.5);
    }
  }
  updatePuffs(dt);
  runner.position.copy(_pos);
  runner.rotation.y = heading;
  runnerBody.position.y = state.y;
  shadow.position.set(_pos.x, TRACK.depth + 0.015, _pos.z);
  const sh = 1 - Math.min(1, state.y / GAME.jumpHeight) * 0.45;
  shadow.scale.setScalar(sh * (1 - state.dis));
  shadow.material.opacity = 0.35 * sh * (1 - state.dis);

  // obstacles & pickups
  for (let i = things.length - 1; i >= 0; i--) {
    const t = things[i];
    const h = lanePoint(t.s, t.obj.position);
    const age = (now - t.born) / 1000;
    const ds = t.s - state.dist;

    if (t.type === "clock") {
      // face the camera so the clock face always reads (patch stays aligned to the track)
      t.obj.rotation.y = camYaw;

      const sc = GAME.clockScale * (age < 0.4 ? easeOutBack(age / 0.4) : 1);
      t.inner.scale.setScalar(Math.max(0.001, sc));
      // it starts ringing exactly when a jump would clear it — the "jump now" cue
      const D = state.speed * GAME.airTime;
      const winOpen = (1 - 0.14) * D - GAME.clockHitbox;
      const ringing = !t.fly && ds > 0 && ds < winOpen && state.mode === "playing";
      t.inner.rotation.z = ringing ? Math.sin(now * 0.06) * 0.2 : 0;
      if (t.patch) {
        // steady ring, throbs while the clock rings
        t.patch.material.opacity = 0.85 * Math.min(1, age / 0.3) * (t.fly ? Math.max(0, 1 - t.fly.t * 3) : 1);
        t.patch.scale.setScalar(ringing ? 1 + Math.abs(Math.sin(now * 0.02)) * 0.18 : 1);
      }
      if (t.sign) {
        if (ringing && t.ringFor === 0 && !t.rang) { t.rang = true; audio.sfx.ring(); }
        t.ringFor = ringing ? t.ringFor + dt : 0;
        t.sign.visible = ringing;
        if (ringing) {
          const pop = t.ringFor < 0.18 ? easeOutBack(t.ringFor / 0.18) : 1;
          const jit = 1 + Math.sin(now * 0.05) * 0.05;
          t.sign.scale.set(t.sign.userData.base.x * pop * jit, t.sign.userData.base.y * pop * jit, 1);
          t.sign.material.rotation = Math.sin(now * 0.04) * 0.08;
        }
      }
      t.inner.position.y = ringing ? Math.abs(Math.sin(now * 0.03)) * 0.12 : t.fly ? t.inner.position.y : 0;

      if (t.fly) {
        t.fly.t += dt;
        t.inner.position.y = t.fly.vy * t.fly.t - 9 * t.fly.t * t.fly.t;
        t.inner.position.z = -t.fly.t * 6;
        t.inner.rotation.x = -t.fly.t * t.fly.spin;
        if (t.inner.position.y < -4) t.obj.visible = false;
      } else if (state.mode === "playing" && Math.abs(ds) < GAME.clockHitbox && state.y < GAME.clockScale * 2.1) {
        gameOver(t);
      }
    } else {
      t.obj.rotation.y = now * 0.0015;
      let sc = GAME.coffeeScale * (age < 0.4 ? easeOutBack(age / 0.4) : 1);
      t.inner.position.y = 0.35 + Math.sin(now * 0.004 + t.s) * 0.12;
      const pulse = (now * 0.0012 + t.s) % 1;
      t.ring.scale.setScalar(t.taken ? 0.001 : 0.9 + pulse * 0.5);
      t.ring.material.opacity = t.taken ? 0 : 1 - pulse * pulse;
      t.ring.rotation.y = -t.obj.rotation.y;
      if (t.taken) {
        const a = (now - t.takenAt) / 250;
        sc *= 1 + a * 0.8;
        t.inner.position.y += a * 1.2;
        if (a > 1) {
          world.remove(t.obj);
          things.splice(i, 1);
          continue;
        }
      } else if (state.mode === "playing" && Math.abs(ds) < 0.6 && state.y < 1.1) {
        t.taken = true;
        t.takenAt = now;
        state.score += GAME.coffeeBonus;
        t.obj.getWorldPosition(_wp);
        _wp.y += 1.2;
        popText(_wp, "+" + GAME.coffeeBonus);
        audio.sfx.coffee();
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
    const lead = state.speed * GAME.airTime * 0.5;
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
    audio.suspend(!visible);
    if (visible) clock.getDelta();
  }).observe(canvas);
}
document.addEventListener("visibilitychange", () => {
  audio.suspend(document.hidden);
  if (!document.hidden) clock.getDelta();
});

addEventListener("resize", layout);

// test hook
window.__daudTrack = { state, things, jump, setBot: (v) => (BOT = v), camera, world, runner, layout, renderer, scene, tee,
  stage: (pairs) => { clearThings(); state.mode = "playing"; document.body.classList.add("playing"); hud.hint.classList.add("gone"); state.nextSpawn = 1e9;
    for (const [type, ds] of pairs) (type === "clock" ? spawnClock : spawnCoffee)(state.dist + ds);
    for (const t of things) t.born -= 1000; },
  step: (dt) => { update(dt); renderer.render(scene, camera); } };

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

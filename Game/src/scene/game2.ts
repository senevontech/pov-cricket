// src/scene/Game.ts
import { Sound } from "@babylonjs/core/Audio/sound";

import "@babylonjs/core/Helpers/sceneHelpers";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";

import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";

import "@babylonjs/core/Shaders/rgbdDecode.fragment";
import "@babylonjs/core/Shaders/rgbdEncode.fragment";
import "@babylonjs/core/Shaders/hdrFiltering.fragment";
import "@babylonjs/core/Shaders/hdrFiltering.vertex";

import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4, Color3 } from "@babylonjs/core/Maths/math.color";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";

import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";

import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

import { Ray } from "@babylonjs/core/Culling/ray";

import HavokPhysics from "@babylonjs/havok";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";

import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

export class Game {
  private scene!: Scene;
  private engine: Engine;
  private canvas: HTMLCanvasElement;

  // ✅ SFX
private sfxBatHit: Sound | null = null;
private audioUnlocked = false;
private lastBatHitSfxAt = 0;
private BAT_HIT_SFX_COOLDOWN_MS = 70; // prevents spam if hit checks fire quickly

private sfxBatHitReady = false;
private sfxBatHitFailed = false;



  // ✅ LOADER UI
  private loaderWrap: HTMLDivElement | null = null;
  private loaderBar: HTMLDivElement | null = null;
  private loaderPct: HTMLDivElement | null = null;
  private loaderMsg: HTMLDivElement | null = null;
  private loaderTarget = 0;
  private loaderAnimRaf: number | null = null;

  // ✅ ADD these new fields inside class Game (near other UI fields)
private mobileHintWrap: HTMLDivElement | null = null;
private mobileHintShown = false;


  // ✅ TOP-LEFT LOGO (mobile responsive)
  private logoWrap: HTMLDivElement | null = null;
  private logoImg: HTMLImageElement | null = null;

  // ✅ Camera
  private camera: UniversalCamera | null = null;

  // ✅ Follow-ball camera flags
  private camFollowBall = false;
  private camFollowStartAt = 0;
  private CAM_FOLLOW_DURATION_MS = 1800; // tune
  private CAM_TARGET_LERP = 0.16; // tune
  private camTargetSmoothed = new Vector3(0, 0, 0);

  // ✅ Required points (from cricket3.glb)
  private ballRelease!: TransformNode;
  private batsmanPoint!: TransformNode;
  private wicketTarget!: TransformNode;

  private pitchStart!: TransformNode;
  private pitchEnd!: TransformNode;
  private pitchL!: TransformNode;
  private pitchR!: TransformNode;

  private bounceGood!: TransformNode;
  private bounceYorker!: TransformNode;
  private offStump!: TransformNode;

  // ✅ CENTER COUNTDOWN UI
  private countdownEl: HTMLDivElement | null = null;
  private countdownTimer: any = null;

  // ✅ BIG BOTTOM POP TEXT (Hit / Miss / SIX / FOUR / OUT)
  private popupEl: HTMLDivElement | null = null;
  private popupTimer: any = null;

  // Imported meshes (collidable candidates)
  private stadiumMeshes: AbstractMesh[] = [];

  // Ball
  private activeBall: AbstractMesh | null = null;
  private activeBallAgg: PhysicsAggregate | null = null;

  // =========================================================
  // ✅ BAT POWER TUNING (SIX only on perfect timing + sweet spot)
  // =========================================================
  private BAT_BASE_POWER = 10.2;
  private BAT_MAX_POWER = 50;

  private BAT_LOFT_BASE = 20.6;
  private BAT_LOFT_MAX = 30.8;

  private SIX_TIMING_MIN = 0.88; // must be almost perfect (0..1)
  private SIX_ALIGN_MIN = 0.75;
  private SIX_SWING_SPEED_MIN = 8.0;

  // Scheduler
  private deliveryIntervalMs = 2300;
  private nextDeliveryAt = 0;
  private ballObserver: any = null;
  private deliveryObserver: any = null;

  // Pitch basis
  private pitchLen = 20.12;
  private baseY = 0;

  // Debug
  private readonly SHOW_DEBUG_POINTS = false;
  private readonly SHOW_DEBUG_PITCH_PLANE = false;

  // =========================================================
  // ✅ BAT (3D MODEL + CURSOR FOLLOW + HIT)
  // =========================================================
  private pickPlane: Mesh | null = null;
  private batRoot: TransformNode | null = null;

  // empties from bat2.glb
  private batL: TransformNode | null = null;
  private batR: TransformNode | null = null;
  private batStart: TransformNode | null = null;
  private batHand: TransformNode | null = null;

  // swing
  private isSwinging = false;
  private swingUntil = 0;
  private swingConsumedHit = false;

  // ✅ timing
  private swingStartedAt = 0;

  // bat velocity for power
  private lastBatPos = new Vector3(0, 0, 0);
  private lastBatT = 0;

  // stop scripted ball controller after hit
  private ballWasHit = false;

  // hit assist (stick for 1-2 frames then launch)
  private hitAssistFramesLeft = 0;
  private hitAssistVel = new Vector3(0, 0, 0);

  // =========================================================
  // ✅ SCORING / GAME STATE
  // =========================================================
  private gameOver = false;

  private runs = 0;
  private balls = 0;
  private hits = 0;
  private misses = 0;

  private scoreboardEl: HTMLDivElement | null = null;

  // ✅ PLAY AGAIN BUTTON
  private playAgainBtnEl: HTMLButtonElement | null = null;

  private boundaryMesh: AbstractMesh | null = null;
  private boundaryCenter = new Vector3(0, 0, 0);
  private boundaryRadius = 0;

  private wicketMeshes: AbstractMesh[] = [];

  // per-delivery flags
  private boundaryScored = false;
  private prevInsideBoundary = true;
  private touchedGroundSinceHit = false;
  private wasHitThisDelivery = false;
  private pendingMissForThisSwing = false;

  // =========================================================
  // ✅ FIX FOR WRONG 4/6 (prevents hit-assist from counting as bounce)
  // =========================================================
  private lastHitAt = 0;
  private hitMinY = Number.POSITIVE_INFINITY;
  private HIT_GROUND_GRACE_MS = 220;

  constructor(engine: Engine, canvas: HTMLCanvasElement) {
    this.engine = engine;
    this.canvas = canvas;
  }

  async start() {
    this.scene = await this.createScene();
    this.engine.runRenderLoop(() => this.scene.render());
  }

  private worldPos(n: TransformNode) {
    return n.getAbsolutePosition().clone();
  }

  private rand(min: number, max: number) {
    return min + Math.random() * (max - min);
  }

  private assetUrl(rel: string) {
    // rel like: "models/cricket3.glb" or "hdr/sky.hdr" or "ui/logo.png"
    const base = (import.meta as any).env?.BASE_URL ?? "/";
    const cleanBase = base.endsWith("/") ? base : base + "/";
    const cleanRel = rel.replace(/^\/+/, "");
    return cleanBase + cleanRel;
  }

  private clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
  }

  // =========================================================
  // ✅ FIX: this function was killing your loader
  // =========================================================
  private killFullscreenCurtains() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    const isFullscreenCover = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width >= w * 0.9 && r.height >= h * 0.9;
    };

    const isPositionedCover = (cs: CSSStyleDeclaration) =>
      (cs.position === "fixed" || cs.position === "absolute") &&
      (cs.inset === "0px" || (cs.top === "0px" && cs.left === "0px"));

    const isVisibleCurtain = (cs: CSSStyleDeclaration) => {
      const bg = cs.backgroundColor || "";
      const op = Number(cs.opacity || "1");
      const looksDark = bg.includes("rgba") && (bg.includes("0, 0, 0") || bg.includes("0,0,0"));
      const notTransparent = bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)";
      return (looksDark || notTransparent) && op > 0;
    };

    // ✅ IMPORTANT: allow loader + logo id so it doesn't get removed
    const allowIds = new Set([
  "renderCanvas",
  "cricket-scoreboard",
  "cricket-play-again",
  "cricket-countdown",
  "cricket-popup",
  "cricket-loader",
  "cricket-logo",
  "cricket-mobile-hint", // ✅ ADD THIS
  "app",
]);

    const els = Array.from(document.body.querySelectorAll("*"));
    for (const el of els) {
      const id = (el as HTMLElement).id || "";
      if (allowIds.has(id)) continue;

      const cs = getComputedStyle(el);
      if (!isPositionedCover(cs)) continue;
      if (!isFullscreenCover(el)) continue;
      if (!isVisibleCurtain(cs)) continue;

      const hEl = el as HTMLElement;
      hEl.style.background = "transparent";
      hEl.style.opacity = "0";
      hEl.style.pointerEvents = "none";
      hEl.style.backdropFilter = "none";
      hEl.style.filter = "none";
    }

    this.canvas.style.filter = "none";
    (this.canvas.style as any).webkitFilter = "none";
  }


  // ✅ unlock browser audio (needed on mobile + some desktop browsers)
private async unlockAudio() {
  if (this.audioUnlocked) return;
  this.audioUnlocked = true;

  try {
    // Babylon exposes the audio context on Engine.audioEngine
    const anyEngine: any = this.engine as any;
    const audioEngine = anyEngine?.audioEngine;

    const ctx: AudioContext | undefined = audioEngine?.audioContext;
    if (ctx && ctx.state === "suspended") {
      await ctx.resume();
    }

    // also "unlock" Babylon audio engine if available
    if (audioEngine?.unlock) {
      await audioEngine.unlock();
    }
  } catch (e) {
    // fail silently (audio just won't play until browser allows it)
    console.warn("Audio unlock failed:", e);

  }
  
}

private async playBatHitSfx(intensity01 = 0.75) {
  if (!this.sfxBatHit || this.sfxBatHitFailed) return;

  const now = performance.now();
  if (now - this.lastBatHitSfxAt < this.BAT_HIT_SFX_COOLDOWN_MS) return;
  this.lastBatHitSfxAt = now;

  try {
    // ✅ ensure audio context is running right before play
    await this.unlockAudio();

    // ✅ wait until ready (if still loading)
    if (!this.sfxBatHitReady) {
      // tiny grace: if not ready, skip instead of “silent play”
      return;
    }

    const vol = 0.35 + 0.65 * this.clamp(intensity01, 0, 1);
    this.sfxBatHit.setVolume(vol);

    // ✅ replay reliably
    this.sfxBatHit.stop();
    this.sfxBatHit.play();
  } catch (e) {
    // console.warn("SFX play failed:", e);
  }
}



  // =========================================================
  // ✅ LOADER UI
  // =========================================================
  private ensureLoader() {
    if (this.loaderWrap) return;

    const wrap = document.createElement("div");
    wrap.id = "cricket-loader";
    wrap.style.position = "fixed";
    wrap.style.inset = "0";
    wrap.style.zIndex = "999999"; // ✅ higher than everything
    wrap.style.display = "none";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "center";
    wrap.style.background = "rgb(255, 91, 25)";
    wrap.style.backdropFilter = "blur(0px)";
    wrap.style.pointerEvents = "auto";

    const card = document.createElement("div");
    card.style.width = "min(520px, 92vw)";
    card.style.border = "1px solid rgb(197, 197, 197)";
    card.style.background = "rgb(212, 212, 212)";
    card.style.boxShadow = "0 30px 90px rgba(0, 0, 0, 0.08)";
    card.style.padding = "18px 18px";
    card.style.borderRadius = "1px";
    card.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";

    const title = document.createElement("div");
    title.innerText = "Loading POV-CRICKET…";
    title.style.color = "#000000";
    title.style.fontWeight = "700";
    title.style.letterSpacing = "0.5px";
    title.style.fontSize = "16px";
    title.style.marginBottom = "10px";

    const msg = document.createElement("div");
    msg.innerText = "Preparing assets";
    msg.style.color = "rgba(0, 0, 0, 0.88)";
    msg.style.fontSize = "12px";
    msg.style.marginBottom = "12px";
    this.loaderMsg = msg;

    const barWrap = document.createElement("div");
    barWrap.style.height = "5px";
    barWrap.style.borderRadius = "999px";
    barWrap.style.overflow = "hidden";
    barWrap.style.border = "1px solid rgba(255,255,255,0.16)";
    barWrap.style.background = "rgba(255,255,255,0.08)";

    const bar = document.createElement("div");
    bar.style.height = "100%";
    bar.style.width = "0%";
    bar.style.borderRadius = "999px";
    bar.style.background = "linear-gradient(90deg, rgba(255,85,0,0.95), rgba(255,170,90,0.95))";
    bar.style.transition = "width 120ms linear";
    this.loaderBar = bar;

    barWrap.appendChild(bar);

    const footer = document.createElement("div");
    footer.style.marginTop = "10px";
    footer.style.display = "flex";
    footer.style.alignItems = "center";
    footer.style.justifyContent = "space-between";

    const pct = document.createElement("div");
    pct.innerText = "0%";
    pct.style.color = "rgba(0, 0, 0, 0.92)";
    pct.style.fontSize = "12px";
    pct.style.fontWeight = "900";
    this.loaderPct = pct;

    const hint = document.createElement("div");
    hint.innerText = "First load may take longer";
    hint.style.color = "rgba(160, 27, 0, 0.55)";
    hint.style.fontSize = "12px";

    footer.appendChild(hint);
    footer.appendChild(pct);

    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(barWrap);
    card.appendChild(footer);

    wrap.appendChild(card);
    document.body.appendChild(wrap);
    this.loaderWrap = wrap;
  }

  private showLoader(msg = "Loading…") {
    this.ensureLoader();
    if (!this.loaderWrap) return;
    this.loaderWrap.style.display = "flex";
    this.loaderWrap.style.opacity = "1";
    this.setLoader(0, msg, true);
  }

  private setLoader(percent: number, msg?: string, immediate = false) {
    this.ensureLoader();
    this.loaderTarget = Math.max(0, Math.min(100, percent));

    if (msg && this.loaderMsg) this.loaderMsg.innerText = msg;

    if (immediate && this.loaderBar && this.loaderPct) {
      this.loaderBar.style.width = `${this.loaderTarget.toFixed(1)}%`;
      this.loaderPct.innerText = `${Math.round(this.loaderTarget)}%`;
    }

    if (this.loaderAnimRaf != null) return;

    const tick = () => {
      this.loaderAnimRaf = null;
      if (!this.loaderBar || !this.loaderPct) return;

      const cur = parseFloat(this.loaderBar.style.width || "0") || 0;
      const next = cur + (this.loaderTarget - cur) * 0.18;

      this.loaderBar.style.width = `${next}%`;
      this.loaderPct.innerText = `${Math.round(next)}%`;

      if (Math.abs(this.loaderTarget - next) > 0.4) {
        this.loaderAnimRaf = requestAnimationFrame(tick);
      } else {
        this.loaderBar.style.width = `${this.loaderTarget}%`;
        this.loaderPct.innerText = `${Math.round(this.loaderTarget)}%`;
      }
    };

    this.loaderAnimRaf = requestAnimationFrame(tick);
  }

  private async hideLoader() {
    if (!this.loaderWrap) return;
    this.setLoader(100, "Done", true);

    await new Promise((r) => setTimeout(r, 200));

    this.loaderWrap.style.transition = "opacity 250ms ease";
    this.loaderWrap.style.opacity = "0";

    await new Promise((r) => setTimeout(r, 280));

    this.loaderWrap.style.display = "none";
    this.loaderWrap.style.transition = "";
  }

  private mapProgress(evt: any, fallbackTotalBytes: number) {
    let p = 0;
    if (evt && evt.lengthComputable && evt.total > 0) p = evt.loaded / evt.total;
    else if (evt && typeof evt.loaded === "number") p = Math.min(1, evt.loaded / fallbackTotalBytes);
    return Math.max(0, Math.min(1, p));
  }

  // =========================================================
  // ✅ TOP-LEFT LOGO (mobile responsive)
  // Put your logo file in: /public/ui/logo.png
  // Then it will load as: this.assetUrl("ui/logo.png")
  // =========================================================
  private ensureLogo() {
    if (this.logoWrap) return;

    const wrap = document.createElement("div");
    wrap.id = "cricket-logo";
    wrap.style.position = "fixed";
    wrap.style.left = "max(10px, env(safe-area-inset-left))";
    wrap.style.top = "max(10px, env(safe-area-inset-top))";
    wrap.style.zIndex = "10020"; // above canvas, below loader (999999)
    wrap.style.pointerEvents = "none";
    wrap.style.userSelect = "none";
    wrap.style.webkitUserSelect = "none" as any;

    // subtle readable pill (kept minimal)
    wrap.style.padding = "6px 8px";
    wrap.style.border = "1px solid rgba(255, 255, 255, 0)";
    wrap.style.background = "rgba(0, 0, 0, 0)";
    wrap.style.backdropFilter = "blur(6px)";
    wrap.style.borderRadius = "0px";
    wrap.style.boxShadow = "0 14px 40px rgba(0, 0, 0, 0)";

    const img = document.createElement("img");
    img.alt = "Logo";
    img.decoding = "async";

    // ✅ change this path if your logo is elsewhere
    img.src = this.assetUrl("logo/logo.png");

    // ✅ responsive sizing (mobile -> desktop)
    img.style.width = "clamp(90px, 20vw, 150px)";
    img.style.height = "auto";
    img.style.display = "block";
    img.style.objectFit = "contain";

    // if logo missing, hide silently
    img.onerror = () => {
      wrap.style.display = "none";
    };

    wrap.appendChild(img);
    document.body.appendChild(wrap);

    this.logoWrap = wrap;
    this.logoImg = img;
  }



  // ✅ ADD this function inside class Game (anywhere with other UI helpers)
private ensureMobileHint() {
  if (this.mobileHintWrap) return;

  const wrap = document.createElement("div");
  wrap.id = "cricket-mobile-hint";
  wrap.style.position = "fixed";
  wrap.style.inset = "0";
  wrap.style.zIndex = "100000"; // above everything except loader (999999)
  wrap.style.display = "none";
  wrap.style.alignItems = "center";
  wrap.style.justifyContent = "center";
  wrap.style.padding = "16px";
  wrap.style.background = "rgba(0, 0, 0, 0.18)";
  wrap.style.backdropFilter = "blur(0px)";
  wrap.style.pointerEvents = "auto";

  const card = document.createElement("div");
  card.style.width = "min(520px, 92vw)";
  card.style.border = "1px solid rgba(255, 255, 255, 0)";
  card.style.background = "rgb(227, 68, 0)";
  card.style.boxShadow = "0 30px 90px rgba(0, 0, 0, 0)";
  card.style.padding = "16px 16px";
  card.style.borderRadius = "1px";
  card.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  card.style.color = "#fff";

  const title = document.createElement("div");
  title.innerText = "Heads up!";
  title.style.fontWeight = "900";
  title.style.letterSpacing = "0.3px";
  title.style.fontSize = "16px";
  title.style.marginBottom = "8px";

  const msg = document.createElement("div");
  msg.innerText = "The site is experienced best on desktop.";
  msg.style.opacity = "0.92";
  msg.style.fontSize = "13px";
  msg.style.lineHeight = "1.35";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.justifyContent = "flex-end";
  actions.style.gap = "10px";
  actions.style.marginTop = "14px";

  const skip = document.createElement("button");
  skip.type = "button";
  skip.innerText = "Skip";
  skip.style.cursor = "pointer";
  skip.style.padding = "10px 14px";
  skip.style.borderRadius = "1px";
  skip.style.border = "1px solid rgba(255,255,255,0.22)";
  skip.style.background = "rgba(255,255,255,0.10)";
  skip.style.color = "#fff";
  skip.style.fontWeight = "900";
  skip.style.letterSpacing = "0.4px";
  skip.style.pointerEvents = "auto";

  const hide = () => {
    wrap.style.display = "none";
    this.mobileHintShown = true;
  };

  // click skip
  skip.onclick = hide;

  // click outside card => also skip (nice UX)
  wrap.onclick = (e) => {
    if (e.target === wrap) hide();
  };

  // ESC key => skip (if keyboard exists)
  window.addEventListener("keydown", (e) => {
    if (wrap.style.display !== "none" && e.key === "Escape") hide();
  });

  actions.appendChild(skip);
  card.appendChild(title);
  card.appendChild(msg);
  card.appendChild(actions);
  wrap.appendChild(card);

  document.body.appendChild(wrap);
  this.mobileHintWrap = wrap;
}

private isMobileDevice() {
  const w = window.innerWidth;
  const coarse = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)").matches : false;
  const ua = (navigator.userAgent || "").toLowerCase();
  const uaMobile = /android|iphone|ipad|ipod|mobile|tablet/.test(ua);
  // treat <= 900px as mobile-ish (good practical threshold)
  return w <= 900 || coarse || uaMobile;
}

private maybeShowMobileHint() {
  if (this.mobileHintShown) return;
  this.ensureMobileHint();
  if (!this.mobileHintWrap) return;

  if (this.isMobileDevice()) {
    this.mobileHintWrap.style.display = "flex";
  }
}


  // =========================================================
  // ✅ PITCH CLAMP HELPERS
  // =========================================================
  private getPitchBasis() {
    const S = this.worldPos(this.pitchStart);
    const E = this.worldPos(this.pitchEnd);
    const L = this.worldPos(this.pitchL);
    const R = this.worldPos(this.pitchR);

    const forward = E.subtract(S).normalize();
    const side = R.subtract(L).normalize();

    const length = E.subtract(S).length();
    const width = R.subtract(L).length();

    const center = S.add(E).scale(0.5);

    return { S, E, L, R, forward, side, length, width, center };
  }

  private clampPointToPitch(p: Vector3, marginSide = 0.06, marginLen = 0.08) {
    const { S, forward, side, length, width } = this.getPitchBasis();

    const rel = p.subtract(S);
    const u = Vector3.Dot(rel, forward);
    const v = Vector3.Dot(rel, side);

    const halfW = width * 0.5;

    const uClamped = this.clamp(u, marginLen, length - marginLen);
    const vClamped = this.clamp(v, -halfW + marginSide, halfW - marginSide);

    const out = S.add(forward.scale(uClamped)).add(side.scale(vClamped));
    out.y = this.baseY + 0.005;
    return out;
  }

  private distPointToSegment(p: Vector3, a: Vector3, b: Vector3) {
    const ab = b.subtract(a);
    const ap = p.subtract(a);
    const abLen2 = Vector3.Dot(ab, ab);
    if (abLen2 < 1e-6) return { dist: Vector3.Distance(p, a), t: 0, closest: a.clone() };

    const t = this.clamp(Vector3.Dot(ap, ab) / abLen2, 0, 1);
    const closest = a.add(ab.scale(t));
    return { dist: Vector3.Distance(p, closest), t, closest };
  }

  // =========================================================
  // ✅ CANVAS TOP + ANTI OVERLAY
  // =========================================================
  private forceCanvasFullscreenAndTop() {
    document.documentElement.style.margin = "0";
    document.documentElement.style.padding = "0";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.overflow = "hidden";

    const c = this.canvas;
    c.style.position = "fixed";
    c.style.inset = "0";
    c.style.width = "100vw";
    c.style.height = "100vh";
    c.style.display = "block";
    c.style.zIndex = "50";
    c.style.background = "transparent";
    c.style.filter = "none";
    (c.style as any).webkitFilter = "none";

    const p = c.parentElement as HTMLElement | null;
    if (p) {
      p.style.position = "relative";
      p.style.zIndex = "1";
      p.style.background = "transparent";
      p.style.filter = "none";
      (p.style as any).webkitFilter = "none";
    }
  }

  // ✅ UPDATE your existing injectAntiOverlayCSS() to include the new id (so it never gets nuked by overlays)
private injectAntiOverlayCSS() {
  const id = "anti-overlay-style";
  if (document.getElementById(id)) return;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    html, body, #app, #renderCanvas { background: transparent !important; margin:0 !important; padding:0 !important; overflow:hidden !important; }
    body::before, body::after, #app::before, #app::after { content:none !important; display:none !important; opacity:0 !important; }

    /* ✅ ensure hint is always clickable/visible when shown */
    #cricket-mobile-hint { display:none; }
  `;
  document.head.appendChild(style);
}


  // =========================================================
  // ✅ POPUP
  // =========================================================
  private ensurePopup() {
    if (this.popupEl) return;

    const el = document.createElement("div");
    el.id = "cricket-popup";
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.top = "24px";
    el.style.transform = "translateX(-50%) translateY(18px)";
    el.style.zIndex = "10080";
    el.style.pointerEvents = "none";
    el.style.opacity = "0";
    el.style.display = "none";

    el.style.padding = "12px 20px";
    el.style.borderRadius = "1px";
    el.style.border = "1px solid rgba(255, 255, 255, 0)";
    el.style.background = "rgba(0,0,0,0.58)";
    el.style.backdropFilter = "blur(2px)";
    el.style.boxShadow = "0 26px 80px rgba(0, 0, 0, 0.21)";

    el.style.color = "#fff";
    el.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    el.style.fontWeight = "1000";
    el.style.letterSpacing = "1px";
    el.style.textAlign = "center";
    el.style.fontSize = "32px";
    el.style.textTransform = "uppercase";
    el.style.userSelect = "none";
    el.style.whiteSpace = "nowrap";
    el.style.textShadow = "0 6px 24px rgba(0,0,0,0.6)";

    el.style.transition = "opacity 240ms ease, transform 280ms ease";

    document.body.appendChild(el);
    this.popupEl = el;
  }

  private popText(text: string, variant: "hit" | "miss" | "six" | "four" | "out" | "info" = "info") {
    this.ensurePopup();
    if (!this.popupEl) return;

    if (this.popupTimer) {
      clearTimeout(this.popupTimer);
      this.popupTimer = null;
    }

    const el = this.popupEl;
    el.innerText = text;

    const stylesByVariant: Record<string, { border: string; bg: string }> = {
      hit: { border: "rgba(34,197,94,0.55)", bg: "rgba(16,185,129,0.18)" },
      miss: { border: "rgba(239,68,68,0.55)", bg: "rgba(239,68,68,0.14)" },
      six: { border: "rgba(168,85,247,0.55)", bg: "rgba(168,85,247,0.16)" },
      four: { border: "rgba(59,130,246,0.55)", bg: "rgba(59,130,246,0.16)" },
      out: { border: "rgba(255, 0, 0, 0.6)", bg: "rgba(245, 11, 11, 0.3)" },
      info: { border: "rgba(255,255,255,0.22)", bg: "rgba(0,0,0,0.58)" },
    };

    const s = stylesByVariant[variant] ?? stylesByVariant.info;
    el.style.border = `1px solid ${s.border}`;
    el.style.background = s.bg;

    el.style.display = "block";

    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateX(-50%) translateY(0px)";
    });

    this.popupTimer = setTimeout(() => {
      if (!this.popupEl) return;
      this.popupEl.style.opacity = "0";
      this.popupEl.style.transform = "translateX(-50%) translateY(18px)";
      setTimeout(() => {
        if (!this.popupEl) return;
        this.popupEl.style.display = "none";
      }, 390);
    }, 1900);
  }

  // =========================================================
  // ✅ SCOREBOARD
  // =========================================================
  private ensureScoreboard() {
    if (this.scoreboardEl) return;

    const el = document.createElement("div");
    el.id = "cricket-scoreboard";
    el.style.position = "fixed";
    el.style.right = "15px";
    el.style.top = "14px";
    el.style.zIndex = "9999";
    el.style.pointerEvents = "none";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "1px";
    el.style.border = "1px solid rgba(255, 98, 0, 0.18)";
    el.style.background = "rgb(255, 98, 19)";
    el.style.backdropFilter = "blur(0px)";
    el.style.color = "#ffffff";
    el.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    el.style.fontWeight = "400";
    el.style.fontSize = "13px";
    el.style.lineHeight = "1.25";
    el.style.boxShadow = "0 18px 40px rgba(0,0,0,0.35)";

    document.body.appendChild(el);
    this.scoreboardEl = el;
    this.updateScoreboard("Ready");
  }

  private updateScoreboard(status: string) {
    if (!this.scoreboardEl) return;

    const badge = (txt: string) =>
      `<span style="
        display:inline-block;
        padding:2px 8px;
        border-radius:0px;
        border:1px solid rgba(255, 89, 0, 0.22);
        background:rgba(255, 165, 119, 0.08);
        font-size:11px;
        font-weight:900;
        letter-spacing:0.3px;
      ">${txt}</span>`;

    const overText = this.gameOver ? badge("OUT") : badge("PLAY");
    this.scoreboardEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <span style="font-size:14px; font-weight:900;">SCORE</span>
        ${overText}
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px 14px;">
        <div><span style="opacity:.78">Runs</span><div style="font-size:18px; font-weight:900;">${this.runs}</div></div>
        <div><span style="opacity:.78">Balls</span><div style="font-size:18px; font-weight:900;">${this.balls}</div></div>
        <div><span style="opacity:.78">Hits</span><div style="font-size:16px; font-weight:900;">${this.hits}</div></div>
        <div><span style="opacity:.78">Missed</span><div style="font-size:16px; font-weight:900;">${this.misses}</div></div>
      </div>
      <div style="margin-top:8px; opacity:.9; font-weight:800;">${status}</div>
    `;
  }

  // =========================================================
  // ✅ COUNTDOWN
  // =========================================================
  private ensureCountdown() {
    if (this.countdownEl) return;

    const el = document.createElement("div");
    el.id = "cricket-countdown";
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.top = "50%";
    el.style.transform = "translate(-50%, -50%)";
    el.style.zIndex = "10040";
    el.style.pointerEvents = "none";
    el.style.display = "none";

    el.style.padding = "16px 22px";
    el.style.borderRadius = "1px";
    el.style.border = "1px solid rgba(255,255,255,0.22)";
    el.style.background = "rgb(255, 64, 0)";
    el.style.backdropFilter = "blur(0px)";
    el.style.boxShadow = "0 26px 80px rgba(0,0,0,0.55)";
    el.style.color = "#fff";
    el.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    el.style.fontWeight = "950";
    el.style.letterSpacing = "1px";
    el.style.textAlign = "center";

    document.body.appendChild(el);
    this.countdownEl = el;
  }

  private hideCountdown() {
    if (!this.countdownEl) return;
    this.countdownEl.style.display = "none";
  }

  private async showCountdown(seconds: number) {
    this.ensureCountdown();
    if (!this.countdownEl) return;

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.countdownEl.style.display = "block";

    let t = seconds;
    const render = (v: number) => {
      if (!this.countdownEl) return;
      this.countdownEl.innerHTML = `
        <div style="font-size:12px; opacity:.85; margin-bottom:8px;">BOWLING STARTS IN</div>
        <div style="font-size:56px; line-height:1; font-weight:1000;">${v}</div>
      `;
    };

    render(t);

    await new Promise<void>((resolve) => {
      this.countdownTimer = setInterval(() => {
        t -= 1;
        if (t <= 0) {
          clearInterval(this.countdownTimer);
          this.countdownTimer = null;
          this.hideCountdown();
          resolve();
          return;
        }
        render(t);
      }, 1000);
    });
  }

  private async startMatchWithDelay() {
    this.nextDeliveryAt = Number.POSITIVE_INFINITY;
    this.showPlayAgain(false);

    this.updateScoreboard("Get ready...");
    await this.showCountdown(3);

    if (this.gameOver) return;

    this.nextDeliveryAt = performance.now() + 150;
    this.updateScoreboard("PLAY!");
    this.popText("PLAY!", "info");
  }

  // =========================================================
  // ✅ PLAY AGAIN
  // =========================================================
  private ensurePlayAgainButton() {
    if (this.playAgainBtnEl) return;

    const btn = document.createElement("button");
    const baseBg = "rgb(255, 85, 0)";
    const hoverBg = "rgba(255, 85, 0, 0.95)";
    btn.style.background = baseBg;
    btn.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.09)";
    btn.style.backdropFilter = "none";

    btn.id = "cricket-play-again";
    btn.innerText = "PLAY AGAIN";

    btn.style.position = "fixed";
    btn.style.left = "50%";
    btn.style.top = "50%";
    btn.style.transform = "translate(-50%, -50%)";
    btn.style.zIndex = "10050";
    btn.style.pointerEvents = "auto";

    btn.style.padding = "14px 18px";
    btn.style.borderRadius = "1px";
    btn.style.border = "1px solid rgba(255,255,255,0.25)";
    btn.style.color = "#fff";
    btn.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    btn.style.fontWeight = "950";
    btn.style.letterSpacing = "0.8px";
    btn.style.fontSize = "15px";
    btn.style.cursor = "pointer";
    btn.style.display = "none";

    btn.onmouseenter = () => (btn.style.background = hoverBg);
    btn.onmouseleave = () => (btn.style.background = baseBg);

    btn.onclick = () => this.resetGame();

    document.body.appendChild(btn);
    this.playAgainBtnEl = btn;
  }

  private showPlayAgain(show: boolean) {
    if (!this.playAgainBtnEl) return;
    this.playAgainBtnEl.style.display = show ? "inline-flex" : "none";
  }

  private resetGame() {
    this.gameOver = false;
    this.runs = 0;
    this.balls = 0;
    this.hits = 0;
    this.misses = 0;

    this.ballWasHit = false;
    this.wasHitThisDelivery = false;
    this.touchedGroundSinceHit = false;
    this.boundaryScored = false;
    this.prevInsideBoundary = true;
    this.hitAssistFramesLeft = 0;
    this.pendingMissForThisSwing = false;
    this.isSwinging = false;
    this.swingConsumedHit = false;

    this.lastHitAt = 0;
    this.hitMinY = Number.POSITIVE_INFINITY;

    this.camFollowBall = false;

    if (this.scene && this.ballObserver) {
      this.scene.onBeforeRenderObservable.remove(this.ballObserver);
      this.ballObserver = null;
    }

    this.disposeBall();
    this.showPlayAgain(false);
    this.popText("READY", "info");
    this.startMatchWithDelay();
  }

  private addRuns(amount: number, reason: string) {
    if (this.gameOver) return;
    this.runs += amount;
    this.updateScoreboard(`${reason} (+${amount})`);

    if (amount === 6) this.popText("SIX!", "six");
    else if (amount === 4) this.popText("FOUR!", "four");
    else this.popText(`+${amount}`, "info");
  }

  private setOut(reason = "OUT!") {
    if (this.gameOver) return;
    this.gameOver = true;

    this.nextDeliveryAt = Number.POSITIVE_INFINITY;

    this.camFollowBall = false;

    if (this.scene && this.ballObserver) {
      this.scene.onBeforeRenderObservable.remove(this.ballObserver);
      this.ballObserver = null;
    }

    this.updateScoreboard(reason);
    this.popText("OUT!", "out");
    this.showPlayAgain(true);
  }

  // =========================================================
  // ✅ BOUNDARY + WICKET
  // =========================================================
  private setupBoundaryAndWickets(scene: Scene) {
    const findByNameLoose = (needle: string) => {
      const n = needle.toLowerCase();

      let mesh = scene.meshes.find((m) => (m.name || "").toLowerCase() === n);
      if (mesh) return { type: "mesh" as const, node: mesh };

      let tn = scene.transformNodes.find((t) => (t.name || "").toLowerCase() === n);
      if (tn) return { type: "tn" as const, node: tn };

      mesh = scene.meshes.find((m) => (m.name || "").toLowerCase().includes(n));
      if (mesh) return { type: "mesh" as const, node: mesh };

      tn = scene.transformNodes.find((t) => (t.name || "").toLowerCase().includes(n));
      if (tn) return { type: "tn" as const, node: tn };

      return null;
    };

    const collectChildrenMeshes = (root: any): Mesh[] => {
      const out: Mesh[] = [];
      for (const m of scene.meshes) {
        if (!m || m.name === "__root__") continue;
        let p: any = m.parent;
        while (p) {
          if (p === root) {
            out.push(m as Mesh);
            break;
          }
          p = p.parent;
        }
      }
      return out;
    };

    const boundaryNode = findByNameLoose("boundary");
    let boundaryMeshes: Mesh[] = [];

    if (boundaryNode?.type === "mesh") boundaryMeshes = [boundaryNode.node as Mesh];
    else if (boundaryNode?.type === "tn") boundaryMeshes = collectChildrenMeshes(boundaryNode.node);

    if (boundaryMeshes.length) {
      boundaryMeshes.forEach((bm) => {
        bm.computeWorldMatrix(true);
        bm.refreshBoundingInfo(true);
      });

      let minX = Number.POSITIVE_INFINITY,
        minZ = Number.POSITIVE_INFINITY,
        maxX = Number.NEGATIVE_INFINITY,
        maxZ = Number.NEGATIVE_INFINITY;

      for (const bm of boundaryMeshes) {
        try {
          const bb = bm.getBoundingInfo().boundingBox;
          const vMin = bb.minimumWorld;
          const vMax = bb.maximumWorld;
          minX = Math.min(minX, vMin.x);
          minZ = Math.min(minZ, vMin.z);
          maxX = Math.max(maxX, vMax.x);
          maxZ = Math.max(maxZ, vMax.z);
        } catch {}
      }

      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const rx = (maxX - minX) / 2;
      const rz = (maxZ - minZ) / 2;
      const r = Math.max(rx, rz);

      this.boundaryMesh = boundaryMeshes[0];
      this.boundaryCenter.set(cx, this.baseY, cz);
      this.boundaryRadius = Math.max(0.01, r);
    } else {
      this.boundaryMesh = null;
      this.boundaryRadius = 0;
      console.warn('Boundary not found (searched loosely for "boundary"). 4/6 scoring disabled.');
    }

    const wicketNames = ["wicket1", "wicket2", "wicket3"];
    this.wicketMeshes = wicketNames
      .map((n) => scene.getMeshByName(n) || (scene.getNodeByName(n) as any))
      .filter(Boolean) as any[];

    if (!this.wicketMeshes.length) {
      console.warn('Wicket meshes "wicket1/wicket2/wicket3" not found. OUT detection disabled.');
    }
  }

  private isInsideBoundary(p: Vector3) {
    if (!this.boundaryRadius || !Number.isFinite(this.boundaryRadius)) return true;
    const dx = p.x - this.boundaryCenter.x;
    const dz = p.z - this.boundaryCenter.z;
    return dx * dx + dz * dz <= this.boundaryRadius * this.boundaryRadius;
  }

  private checkWicketHit(ballPos: Vector3, ballRadius: number) {
    if (!this.wicketMeshes.length) return false;

    for (const w of this.wicketMeshes) {
      if (!w || !(w as any).getBoundingInfo) continue;
      try {
        const bi = (w as any).getBoundingInfo();
        const c = bi.boundingSphere.centerWorld;
        const r = bi.boundingSphere.radiusWorld;
        const d = Vector3.Distance(ballPos, c);
        if (d <= r + ballRadius * 1.35) return true;
      } catch {}
    }
    return false;
  }

  // =========================================================
  // ✅ MAIN SCENE
  // =========================================================
  private async createScene() {
    // ✅ show loader first
    this.showLoader("Booting engine…");
    this.setLoader(2, "Preparing scene…", true);

    this.injectAntiOverlayCSS();
    this.forceCanvasFullscreenAndTop();
    // ✅ Strong audio unlock (must happen from a real user gesture)
const unlockOnce = async () => {
  await this.unlockAudio();
  window.removeEventListener("pointerdown", unlockOnce);
  window.removeEventListener("touchstart", unlockOnce);
  window.removeEventListener("mousedown", unlockOnce);
};

window.addEventListener("pointerdown", unlockOnce, { once: true });
window.addEventListener("touchstart", unlockOnce, { once: true });
window.addEventListener("mousedown", unlockOnce, { once: true });

    this.ensureLogo(); 
    this.maybeShowMobileHint();
    this.killFullscreenCurtains();

    const scene = new Scene(this.engine);
    this.scene = scene;
    // ✅ Load SFX (put file in /public/sfx/bat-hit.mp3)
// ✅ Load SFX (put file in /public/sfx/bat-hit.mp3)
try {
  const sfxUrl = this.assetUrl("sfx/bat-hit.mp3"); // ✅ remove ?v=Date.now() for testing first

  this.sfxBatHitReady = false;
  this.sfxBatHitFailed = false;

  this.sfxBatHit = new Sound(
    "batHit",
    sfxUrl,
    scene,
    () => {
      this.sfxBatHitReady = true;
      // console.log("✅ bat-hit sfx ready");
    },
    {
      autoplay: false,
      loop: false,
      volume: 0.65,
      // ✅ important on some browsers
      spatialSound: false,
    }
  );

  // Optional: helps prevent “first play silent”
  this.sfxBatHit.setPlaybackRate(1);
} catch (e) {
  this.sfxBatHitFailed = true;
  console.warn("Bat hit sfx load failed:", e);
}



    this.ensureScoreboard();
    this.ensurePlayAgainButton();
    this.ensureCountdown();
    this.ensurePopup();
    this.showPlayAgain(false);

    scene.clearColor = new Color4(0.02, 0.03, 0.05, 1);

    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
    hemi.intensity = 1.2;

    const sun = new DirectionalLight("sun", new Vector3(-0.35, -1, -0.25), scene);
    sun.intensity = 2.0;

    try {
      // ✅ HDR
      this.setLoader(6, "Loading sky…");

      const hdrUrl = this.assetUrl("hdr/sky2k.hdr") + `?v=${Date.now()}`;

      const hdr = new HDRCubeTexture(
        hdrUrl,
        scene,
        512,
        false,
        true,
        false,
        true,
        () => {},
        (message) => {
          console.warn("HDR Failed to load, switching to fallback environment:", message);
          scene.environmentTexture = null;
          scene.createDefaultEnvironment({ createSkybox: true, skyboxSize: 6000 });
        }
      );

      scene.environmentTexture = hdr;

      const skybox = scene.createDefaultSkybox(hdr, true, 6000, 0.0);
      if (skybox) skybox.isPickable = false;

      scene.environmentIntensity = 2.0;
      scene.imageProcessingConfiguration.toneMappingEnabled = true;
      scene.imageProcessingConfiguration.toneMappingType = 1;
      scene.imageProcessingConfiguration.exposure = 1.25;
      scene.imageProcessingConfiguration.contrast = 1.08;

      this.setLoader(10, "Sky ready");
    } catch (e) {
      console.warn("HDR failed to load:", e);
      scene.createDefaultEnvironment({ createSkybox: true, skyboxSize: 6000 });
      this.setLoader(10, "Sky fallback loaded");
    }

    // ✅ Havok
    this.setLoader(14, "Initializing physics…");
    const hk = await HavokPhysics();
    const plugin = new HavokPlugin(true, hk);
    scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);
    this.setLoader(20, "Physics ready");

    // ✅ Stadium load with progress (20 -> 80)
    const stadium = await SceneLoader.ImportMeshAsync(
      "",
      this.assetUrl("models/"),
      "cricket3.glb",
      scene,
      (evt) => {
        const p = this.mapProgress(evt, 18 * 1024 * 1024); // fallback 18MB
        const mapped = 20 + p * 60;
        this.setLoader(mapped, `Loading stadium… ${Math.round(mapped)}%`);
      }
    );

    stadium.meshes.forEach((m) => {
      const n = (m.name || "").toLowerCase();
      if (n.includes("batsman") || n.includes("player") || n.includes("character")) {
        m.isVisible = false;
        m.setEnabled(false);
      }
    });

    this.stadiumMeshes = stadium.meshes.filter((m) => m && m.name !== "__root__");

    for (const m of stadium.meshes) {
      const mesh = m as Mesh;
      const mat: any = mesh.material;
      if (!mat) continue;

      if (mat instanceof PBRMaterial) {
        mat.environmentIntensity = 1.4;
        mat.metallic = Math.min(1, mat.metallic ?? 0.3);
        mat.roughness = Math.min(1, Math.max(0.05, mat.roughness ?? 0.6));
      } else {
        if ("specularPower" in mat) mat.specularPower = 128;
      }
    }

    // ✅ Grab required points
    this.ballRelease = this.getPoint(scene, "BallRelease");
    this.batsmanPoint = this.getPoint(scene, "BatsmanPoint");
    this.wicketTarget = this.getPoint(scene, "WicketTarget");

    this.pitchStart = this.getPoint(scene, "PitchStart");
    this.pitchEnd = this.getPoint(scene, "PitchEnd");
    this.pitchL = this.getPoint(scene, "PitchL");
    this.pitchR = this.getPoint(scene, "PitchR");

    this.bounceGood = this.getPoint(scene, "BounceGood");
    this.bounceYorker = this.getPoint(scene, "BounceYorker");
    this.offStump = this.getPoint(scene, "OffStump");

    const pitchStart = this.worldPos(this.pitchStart);
    const pitchEnd = this.worldPos(this.pitchEnd);
    const batsman = this.worldPos(this.batsmanPoint);
    const wicket = this.worldPos(this.wicketTarget);

    this.pitchLen = pitchEnd.subtract(pitchStart).length();

    const y1 = this.sampleSurfaceY(batsman.add(new Vector3(0, 2, 0)));
    const y2 = this.sampleSurfaceY(wicket.add(new Vector3(0, 2, 0)));
    const mid = pitchStart.add(pitchEnd).scale(0.5);
    const y3 = this.sampleSurfaceY(mid.add(new Vector3(0, 2, 0)));

    const fallback = Math.min(batsman.y, wicket.y);
    this.baseY = this.safeAvg([y1, y2, y3], fallback);

    this.setupBoundaryAndWickets(scene);
    this.createEnvironmentColliders(scene);

    // ✅ Camera
    const pitchStartPos = this.worldPos(this.pitchStart);
    const batsmanPos = this.worldPos(this.batsmanPoint);

    const lookDir = pitchStartPos.subtract(batsmanPos).normalize();
    const pitchSide = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).normalize();

    const eyeHeight = 0.3;
    const eyeBack = 0.5;
    const sideOffset = 0;

    const camDir = lookDir.add(pitchSide.scale(sideOffset)).normalize();

    const camera = new UniversalCamera(
      "cam",
      new Vector3(batsmanPos.x, this.baseY + eyeHeight, batsmanPos.z).subtract(camDir.scale(eyeBack)),
      scene
    );

    this.camera = camera;

    camera.fov = 1.2;
    camera.minZ = 0.03;
    camera.speed = 0;
    camera.inertia = 0.7;
    camera.attachControl(this.canvas, true);

    camera.setTarget(new Vector3(pitchStartPos.x, this.baseY + eyeHeight, pitchStartPos.z));
    this.camTargetSmoothed.copyFrom(camera.getTarget());

    scene.onBeforeRenderObservable.add(() => {
      if (this.gameOver) return;

      const bw = this.worldPos(this.batsmanPoint);
      const ps = this.worldPos(this.pitchStart);

      const fwd = ps.subtract(bw).normalize();
      const side = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).normalize();
      const dir = fwd.add(side.scale(sideOffset)).normalize();

      camera.position.copyFrom(new Vector3(bw.x, this.baseY + eyeHeight, bw.z).subtract(dir.scale(eyeBack)));

      let desiredTarget = new Vector3(ps.x, this.baseY + eyeHeight, ps.z);

      if (this.camFollowBall && this.activeBall) {
        const now = performance.now();
        if (now - this.camFollowStartAt <= this.CAM_FOLLOW_DURATION_MS) {
          const bp = this.activeBall.getAbsolutePosition();
          desiredTarget = new Vector3(bp.x, bp.y + 0.08, bp.z);
        } else {
          this.camFollowBall = false;
        }
      } else {
        this.camFollowBall = false;
      }

      this.camTargetSmoothed.x = Scalar.Lerp(this.camTargetSmoothed.x, desiredTarget.x, this.CAM_TARGET_LERP);
      this.camTargetSmoothed.y = Scalar.Lerp(this.camTargetSmoothed.y, desiredTarget.y, this.CAM_TARGET_LERP);
      this.camTargetSmoothed.z = Scalar.Lerp(this.camTargetSmoothed.z, desiredTarget.z, this.CAM_TARGET_LERP);

      camera.setTarget(this.camTargetSmoothed);
    });

    // ✅ Bat load with progress (80 -> 95)
    this.setLoader(80, "Loading bat…");
    await this.setupBat3D(scene, (p) => {
      const mapped = 80 + p * 15;
      this.setLoader(mapped, `Loading bat… ${Math.round(mapped)}%`);
    });

    // ✅ Wicket helper collider
    const wicketBox = MeshBuilder.CreateBox("WicketTargetCollider", { width: 0.4, height: 1.0, depth: 0.2 }, scene);
    wicketBox.position = wicket.clone().add(new Vector3(0, 0.5, 0));
    wicketBox.isVisible = false;
    new PhysicsAggregate(wicketBox, PhysicsShapeType.BOX, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);

    this.updateScoreboard("Ready");
    this.startDeliveries(scene, { intervalMs: 5300 });
    this.startMatchWithDelay();

    this.setLoader(98, "Finalizing…");
    await this.hideLoader();

    return scene;
  }

  // =========================================================
  // ✅ BAT
  // =========================================================
  private async setupBat3D(scene: Scene, onProgress?: (p01: number) => void) {
    const pitchStart = this.worldPos(this.pitchStart);
    const pitchEnd = this.worldPos(this.pitchEnd);

    const pitchForward = pitchEnd.subtract(pitchStart).normalize();
    const pitchWidth = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).length();
    const mid = pitchStart.add(pitchEnd).scale(0.5);

    const planeW = Math.max(2, pitchWidth * 2.4);
    const planeH = Math.max(6, this.pitchLen * 1.5);

    const pickPlane = MeshBuilder.CreateGround("batPickPlane", { width: planeW, height: planeH }, scene);
    pickPlane.isVisible = false;
    pickPlane.isPickable = true;
    pickPlane.position.set(mid.x, this.baseY + 0.001, mid.z);
    pickPlane.rotation.y = Math.atan2(pitchForward.x, pitchForward.z);
    this.pickPlane = pickPlane;

    const batRes = await SceneLoader.ImportMeshAsync(
      "",
      this.assetUrl("models/"),
      "bat2.glb",
      scene,
      (evt) => {
        const p = this.mapProgress(evt, 5 * 1024 * 1024); // fallback 5MB
        onProgress?.(p);
      }
    );

    const batRoot = new TransformNode("batRoot", scene);

    const BAT_SCALE = 0.02;
    const BAT_HEIGHT_OFFSET = 0.01;
    const BAT_TILT_X = -Math.PI / 30;
    const BAT_ROLL_Z = 0.68;

    this.batRoot = batRoot;

    batRes.meshes.forEach((m) => {
      if (!m || m.name === "__root__") return;
      m.setParent(batRoot);
      m.isPickable = false;
    });
    batRes.transformNodes.forEach((t) => {
      if (!t || t.name === "__root__") return;
      t.setParent(batRoot);
    });

    const findTNInBat = (name: string): TransformNode | null => {
      const tn = batRes.transformNodes.find((t) => t.name === name);
      if (tn) return tn;

      const anyNode: any =
        batRes.meshes.find((m) => m.name === name) ??
        (batRes.meshes.find((m) => (m.name || "").toLowerCase() === name.toLowerCase()) as any);

      if (anyNode && anyNode.getAbsolutePosition) {
        const wrap = new TransformNode(`${name}_wrap`, scene);
        wrap.position.copyFrom(anyNode.getAbsolutePosition());
        wrap.setParent(batRoot);
        return wrap;
      }
      return null;
    };

    this.batL = findTNInBat("BatL");
    this.batR = findTNInBat("BatR");
    this.batStart = findTNInBat("BatStart");
    this.batHand = findTNInBat("hand");

    if (!this.batL || !this.batR || !this.batStart) {
      console.warn("[bat2.glb] Missing empties. Required: BatL, BatR, BatStart (optional: hand).");
    }

    batRoot.scaling.setAll(BAT_SCALE);

    this.lastBatPos.copyFrom(batRoot.position);
    this.lastBatT = performance.now();

    const pointerObs = scene.onPointerObservable.add((pi) => {
      
      if (this.gameOver) return;
       
      if (pi.type === 1) {
        const ev = pi.event as PointerEvent;
        if (ev.button === 0) {
          this.unlockAudio();
          this.isSwinging = true;
          this.swingStartedAt = performance.now();
          this.swingUntil = performance.now() + 160;
          this.swingConsumedHit = false;

          this.pendingMissForThisSwing = !!this.activeBall && !this.wasHitThisDelivery;
        }
      }
    });

    scene.onDisposeObservable.add(() => {
      try {
        scene.onPointerObservable.remove(pointerObs);
      } catch {}
      try {
        pickPlane.dispose();
      } catch {}
      try {
        batRes.meshes.forEach((m) => m?.dispose?.());
        batRes.transformNodes.forEach((t) => t?.dispose?.());
        batRoot.dispose();
      } catch {}
    });

    scene.onBeforeRenderObservable.add(() => {
      if (!this.batRoot || !this.pickPlane) return;

      const now = performance.now();

      if (this.isSwinging && now > this.swingUntil) {
        this.isSwinging = false;

        if (!this.gameOver && this.pendingMissForThisSwing && !this.swingConsumedHit) {
          this.misses += 1;
          this.updateScoreboard("Missed!");
          this.popText("MISS!", "miss");
        }
        this.pendingMissForThisSwing = false;
      }

      if (this.gameOver) return;

      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m === this.pickPlane);
      if (pick?.hit && pick.pickedPoint) {
        this.batRoot.position.copyFrom(pick.pickedPoint);
        this.batRoot.position.y = this.baseY + BAT_HEIGHT_OFFSET;
      }

      const ps = this.worldPos(this.pitchStart);
      const faceDir = ps.subtract(this.batRoot.position).normalize();
      const yaw = Math.atan2(faceDir.x, faceDir.z);

      const swingExtra = this.isSwinging ? -0.25 : 0;
      this.batRoot.rotation.set(BAT_TILT_X + swingExtra, yaw, BAT_ROLL_Z);

      const dt = Math.max(0.001, (now - this.lastBatT) / 1000);
      const batVel = this.batRoot.position.subtract(this.lastBatPos).scale(1 / dt);
      this.lastBatPos.copyFrom(this.batRoot.position);
      this.lastBatT = now;

      if (this.hitAssistFramesLeft > 0 && this.activeBall && this.activeBallAgg && this.batStart) {
        const sweet = this.batStart.getAbsolutePosition().clone();

        this.activeBall.position.copyFrom(sweet);
        this.activeBallAgg.body.setLinearVelocity(new Vector3(0, 0, 0));
        this.activeBallAgg.body.setAngularVelocity(new Vector3(0, 0, 0));

        this.hitAssistFramesLeft--;

        if (this.hitAssistFramesLeft <= 0) {
          this.activeBallAgg.body.setLinearVelocity(this.hitAssistVel.clone());
          this.activeBallAgg.body.setAngularVelocity(
            new Vector3(this.rand(-10, 10), this.rand(-30, 30), this.rand(-10, 10))
          );
          this.activeBallAgg.body.setLinearDamping(0.03);
          this.activeBallAgg.body.setAngularDamping(0.08);
        }
        return;
      }

      if (this.isSwinging && !this.swingConsumedHit && this.activeBall && this.activeBallAgg && this.batL && this.batR) {
        const ball = this.activeBall;
        const body = this.activeBallAgg.body;

        const A = this.batL.getAbsolutePosition();
        const B = this.batR.getAbsolutePosition();

        const ballPos = ball.getAbsolutePosition();
        const hit = this.distPointToSegment(ballPos, A, B);

        const hitRadius = 0.24;

        if (hit.dist <= hitRadius) {
          this.swingConsumedHit = true;
          this.pendingMissForThisSwing = false;

          this.popText("HIT!", "hit");
          const intensity = this.clamp(batVel.length() / 14, 0, 1);
this.playBatHitSfx(intensity);

          if (!this.wasHitThisDelivery) {
            this.wasHitThisDelivery = true;
            this.hits += 1;
            this.updateScoreboard("Hit!");
          }

          this.ballWasHit = true;

          this.camFollowBall = true;
          this.camFollowStartAt = performance.now();

          this.lastHitAt = performance.now();
          this.hitMinY = Number.POSITIVE_INFINITY;
          this.touchedGroundSinceHit = false;

          // @ts-ignore
          body.wakeUp?.();

          const baseDir = ps.subtract(ballPos).normalize();
          const vLen = batVel.length();
          const batVelDir = vLen > 0.001 ? batVel.scale(1 / vLen) : baseDir;

          const dir = batVelDir.scale(0.75).add(baseDir.scale(0.25)).normalize();

          const bp = this.worldPos(this.batsmanPoint);
          const distToBatsman = Vector3.Distance(ballPos, bp);

          const IDEAL = 0.28;
          const WINDOW = 0.55;
          const timingRaw = 1 - this.clamp(Math.abs(distToBatsman - IDEAL) / WINDOW, 0, 1);
          const timingScore = timingRaw * timingRaw;

          const align = this.clamp(Vector3.Dot(batVelDir, dir), 0, 1);
          const swingSpeed = this.clamp(vLen, 0, 18);
          const swingFactor = this.clamp((swingSpeed - 3) / 10, 0, 1);

          const sweetSpotFactor = 1 - Math.abs(hit.t - 0.5) * 2;
          const sweet = this.clamp(sweetSpotFactor, 0, 1);

          const timingFactor = Math.pow(timingScore, 1.6);
          const alignFactor = this.clamp(align, 0, 1);

          let power = this.BAT_BASE_POWER + this.BAT_MAX_POWER * timingFactor * sweet * alignFactor * swingFactor;
          let loft = this.BAT_LOFT_BASE + this.BAT_LOFT_MAX * timingFactor * sweet * swingFactor;

          if (timingScore < 0.35) {
            power *= 0.45;
            loft *= 0.4;
          }

          const isSixCandidate =
            timingScore >= this.SIX_TIMING_MIN &&
            alignFactor >= this.SIX_ALIGN_MIN &&
            swingSpeed >= this.SIX_SWING_SPEED_MIN &&
            sweet > 0.7;

          if (!isSixCandidate) {
            loft *= 0.55;
            power *= 0.85;
          }

          let finalDir = dir.clone();
          if (timingScore < 0.5 || sweet < 0.5) {
            finalDir = finalDir
              .add(new Vector3(this.rand(-0.35, 0.35), this.rand(-0.15, 0.15), this.rand(-0.35, 0.35)))
              .normalize();
          }

          this.hitAssistFramesLeft = 2;
          this.hitAssistVel.copyFrom(finalDir.scale(power));
          this.hitAssistVel.y += loft;
        }
      }
    });
  }

  // =========================================================
  // ENVIRONMENT COLLIDERS
  // =========================================================
  private createEnvironmentColliders(scene: Scene) {
    const candidates = this.stadiumMeshes.filter((m) => {
      if (!m) return false;
      if (!m.isEnabled()) return false;

      const n = (m.name || "").toLowerCase();
      if (n.includes("point") || n.includes("helper")) return false;
      if (n.includes("batsman") || n.includes("player") || n.includes("character") || n.includes("man")) return false;

      if (
        n.includes("ballrelease") ||
        n.includes("pitchstart") ||
        n.includes("pitchend") ||
        n.includes("pitchl") ||
        n.includes("pitchr") ||
        n.includes("bouncegood") ||
        n.includes("bounceyorker") ||
        n.includes("offstump") ||
        n.includes("wickettarget")
      )
        return false;

      const mm = m as Mesh;
      const verts = (mm as any).getTotalVertices?.() ?? 0;
      const inds = (mm as any).getTotalIndices?.() ?? 0;
      if (verts < 100 || inds < 300) return false;

      try {
        const bi = m.getBoundingInfo?.();
        if (bi) {
          const size = bi.boundingBox.extendSizeWorld;
          const maxDim = Math.max(size.x, size.y, size.z) * 2;
          if (maxDim > this.pitchLen * 6) return false;
        }
      } catch {}

      return true;
    });

    candidates.forEach((m) => {
      try {
        new PhysicsAggregate(m, PhysicsShapeType.MESH, { mass: 0, friction: 0.95, restitution: 0.02 }, scene);
      } catch {}
    });
  }

  // =========================================================
  // DELIVERY SCHEDULER
  // =========================================================
  private startDeliveries(scene: Scene, opts: { intervalMs: number }) {
    this.deliveryIntervalMs = opts.intervalMs;

    if (this.deliveryObserver) {
      scene.onBeforeRenderObservable.remove(this.deliveryObserver);
      this.deliveryObserver = null;
    }

    this.deliveryObserver = scene.onBeforeRenderObservable.add(() => {
      if (this.gameOver) return;

      const now = performance.now();
      if (now >= this.nextDeliveryAt) {
        this.deliverBall();
        this.nextDeliveryAt = now + this.deliveryIntervalMs;
      }
    });
  }

  // =========================================================
  // BALL LOGIC + SCORING + OUT
  // =========================================================
  private deliverBall() {
    const scene = this.scene;
    if (!scene || this.gameOver) return;

    if (this.ballObserver) {
      scene.onBeforeRenderObservable.remove(this.ballObserver);
      this.ballObserver = null;
    }

    this.disposeBall();

    this.ballWasHit = false;
    this.wasHitThisDelivery = false;
    this.touchedGroundSinceHit = false;
    this.boundaryScored = false;
    this.prevInsideBoundary = true;
    this.hitAssistFramesLeft = 0;

    this.lastHitAt = 0;
    this.hitMinY = Number.POSITIVE_INFINITY;

    this.camFollowBall = false;

    this.balls += 1;
    this.updateScoreboard("Ball delivered");

    const release = this.worldPos(this.ballRelease);
    const batsman = this.worldPos(this.batsmanPoint);
    const wicket = this.worldPos(this.wicketTarget);

    const pitchStart = this.worldPos(this.pitchStart);
    const pitchEnd = this.worldPos(this.pitchEnd);

    const pitchForward = pitchEnd.subtract(pitchStart).normalize();
    const pitchSide = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).normalize();
    const pitchWidth = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).length();

    const isYorker = Math.random() < 0.25;
    const baseBounce = isYorker ? this.worldPos(this.bounceYorker) : this.worldPos(this.bounceGood);
    const off = this.worldPos(this.offStump);

    let bouncePoint = baseBounce.clone();

    const deltaToOff = off.subtract(baseBounce);
    const offSideAmount = Vector3.Dot(deltaToOff, pitchSide);
    const biasStrength = isYorker ? 0.25 : 0.12;
    bouncePoint = bouncePoint.add(pitchSide.scale(offSideAmount * biasStrength));

    const maxLine = Math.max(0.05, Math.min(0.16, pitchWidth * 0.22));
    const lineJitter = this.rand(-maxLine, maxLine) * (isYorker ? 0.6 : 1.0);
    const lengthJitter = isYorker ? this.rand(-0.12, 0.12) : this.rand(-0.35, 0.35);

    bouncePoint = bouncePoint.add(pitchSide.scale(lineJitter)).add(pitchForward.scale(lengthJitter));
    bouncePoint = this.clampPointToPitch(bouncePoint, 0.08, 0.12);

    const ballRadius = 0.012;
    const ball = MeshBuilder.CreateSphere("ball", { diameter: ballRadius * 3, segments: 24 }, scene);

    const mat = new StandardMaterial("ballMat", scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0, 0, 0);
    mat.specularPower = 192;
    mat.emissiveColor = new Color3(0, 0, 0);
    ball.material = mat;

    ball.position.copyFrom(release);
    this.prevInsideBoundary = this.isInsideBoundary(ball.position);

    const restitution = this.rand(0.12, 0.35);
    const ballAgg = new PhysicsAggregate(
      ball,
      PhysicsShapeType.SPHERE,
      { mass: 0.156, friction: 0.28, restitution },
      scene
    );

    const body = ballAgg.body;
    body.setLinearDamping(0.01);
    body.setAngularDamping(0.04);
    // @ts-ignore
    body.wakeUp?.();

    const speed = this.rand(0.5, 7);
    const dist = Vector3.Distance(release, bouncePoint);
    const t = this.clamp(dist / speed, 0.5, 0.35);

    const g = -9.81;
    const toBounce = bouncePoint.subtract(release);

    const vx = toBounce.x / t;
    const vz = toBounce.z / t;
    const vy = (toBounce.y - 0.5 * g * (t * t)) / t;

    body.setLinearVelocity(new Vector3(vx, vy, vz));
    body.setAngularVelocity(new Vector3(this.rand(-30, 30), this.rand(-80, 80), this.rand(-30, 30)));

    this.activeBall = ball;
    this.activeBallAgg = ballAgg;

    let bounced = false;
    let postBounceNoRebounceApplied = false;

    const seamKick = this.rand(-0.25, 0.25);
    const swing = this.rand(-0.12, 0.12);

    const bornAt = performance.now();

    this.ballObserver = scene.onBeforeRenderObservable.add(() => {
      if (this.gameOver) return;
      if (!this.activeBall || !this.activeBallAgg) return;

      const age = (performance.now() - bornAt) / 1000;
      const p = ball.getAbsolutePosition();

      if (age > 0.25 && this.checkWicketHit(p, ballRadius)) {
        this.setOut("OUT! Wicket hit");
        return;
      }

      const pitchTouchY = this.baseY + ballRadius * 1.05;

      if (this.wasHitThisDelivery) {
        const sinceHit = performance.now() - this.lastHitAt;

        this.hitMinY = Math.min(this.hitMinY, p.y);

        if (sinceHit > this.HIT_GROUND_GRACE_MS) {
          const v = body.getLinearVelocity();
          const nearGround = p.y <= pitchTouchY + 0.0025;
          const descending = v.y <= 0.15;
          const dippedLow = this.hitMinY <= pitchTouchY + 0.0025;

          if (nearGround && descending && dippedLow) {
            this.touchedGroundSinceHit = true;
          }
        }
      }

      if (!this.boundaryScored && this.boundaryRadius > 0.01) {
        const inside = this.isInsideBoundary(p);
        if (this.prevInsideBoundary && !inside) {
          this.boundaryScored = true;
          const airborne = this.wasHitThisDelivery && !this.touchedGroundSinceHit;
          if (airborne) this.addRuns(6, "SIX!");
          else this.addRuns(4, "FOUR!");
        }
        this.prevInsideBoundary = inside;
      }

      if (!this.ballWasHit && !bounced && age < t) {
        body.applyImpulse(pitchSide.scale(swing * 0.05), p);
      }

      if (!this.ballWasHit) {
        if (!bounced && age >= t && p.y <= pitchTouchY) {
          bounced = true;
          body.applyImpulse(pitchSide.scale(seamKick * 0.25), p);

          const toward = wicket.subtract(p).normalize();
          const v = body.getLinearVelocity();

          const speed2 = Math.max(v.length() * 0.65, 6);
          const newV = toward.scale(speed2);

          newV.y = Math.max(v.y, 1.0);
          body.setLinearVelocity(newV);
        }

        if (bounced && !postBounceNoRebounceApplied) {
          postBounceNoRebounceApplied = true;

          const anyBody: any = body as any;
          if (typeof anyBody.setRestitution === "function") anyBody.setRestitution(0.01);
          if (typeof anyBody.setFriction === "function") anyBody.setFriction(0.95);

          const anyShape: any = (this.activeBallAgg as any)?.shape;
          const anyMat: any = anyShape?.material;
          if (anyMat) {
            if ("restitution" in anyMat) anyMat.restitution = 0.01;
            if ("friction" in anyMat) anyMat.friction = 0.95;
          }

          body.setLinearDamping(0.06);
          body.setAngularDamping(0.25);
        }

        if (bounced && age > t + 0.12 && p.y <= pitchTouchY) {
          ball.position.y = this.baseY + ballRadius * 1.01;

          const v = body.getLinearVelocity();
          const newV = new Vector3(v.x, 0, v.z);

          const minSpeed = 10;
          const horizSpeed = Math.sqrt(newV.x * newV.x + newV.z * newV.z);
          if (horizSpeed < minSpeed) {
            const fwd = wicket.subtract(batsman).normalize();
            newV.x = fwd.x * minSpeed;
            newV.z = fwd.z * minSpeed;
          }

          body.setLinearVelocity(newV);
          body.setLinearDamping(0.25);
          body.setAngularDamping(0.35);
        }
      }

      if (age > 8.0 || p.y < this.baseY - 5) {
        if (!this.gameOver && this.wasHitThisDelivery && !this.boundaryScored) {
          this.addRuns(1, "RUN");
        }

        if (this.ballObserver) {
          scene.onBeforeRenderObservable.remove(this.ballObserver);
          this.ballObserver = null;
        }
        this.disposeBall();
        if (!this.gameOver) this.updateScoreboard("Next ball...");
      }
    });
  }

  private disposeBall() {
    if (this.scene && this.ballObserver) {
      this.scene.onBeforeRenderObservable.remove(this.ballObserver);
      this.ballObserver = null;
    }
    try {
      this.activeBallAgg?.dispose();
    } catch {}
    try {
      this.activeBall?.dispose();
    } catch {}
    this.activeBall = null;
    this.activeBallAgg = null;

    this.camFollowBall = false;
  }

  // =========================================================
  // Raycast ground sampling
  // =========================================================
  private sampleSurfaceY(fromPos: Vector3): number | null {
    if (!this.scene) return null;

    const rayOrigin = fromPos.clone();
    rayOrigin.y += 10;
    const ray = new Ray(rayOrigin, new Vector3(0, -1, 0), 200);

    const pick = this.scene.pickWithRay(
      ray,
      (m) => {
        if (!m) return false;
        const name = (m.name || "").toLowerCase();
        if (name.includes("point") || name.includes("helper")) return false;
        const mm = m as Mesh;
        const verts = (mm as any).getTotalVertices?.() ?? 0;
        return verts > 60;
      },
      false
    );

    if (pick?.hit && pick.pickedPoint) return pick.pickedPoint.y;
    return null;
  }

  private safeAvg(values: Array<number | null>, fallback: number) {
    const good = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!good.length) return fallback;
    return good.reduce((a, b) => a + b, 0) / good.length;
  }

  private getPoint(scene: Scene, name: string): TransformNode {
    const tn = scene.getTransformNodeByName(name);
    if (tn) return tn;

    const node = scene.getNodeByName(name) as any;
    if (node && node.position) {
      const wrap = new TransformNode(`${name}_wrap`, scene);
      wrap.position.copyFrom(node.position);
      return wrap;
    }

    throw new Error(`Missing required point "${name}" in GLB. Make sure Empty is named exactly "${name}".`);
  }
}

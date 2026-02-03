// src/scene/Game.ts
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
  private BAT_BASE_POWER = 20.2;
  private BAT_MAX_POWER = 40;

  private BAT_LOFT_BASE = 20.6;
  private BAT_LOFT_MAX = 60.8;

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

  

  private clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
  }

  // =========================================================
  // ✅ PITCH CLAMP HELPERS (keeps bounce inside PitchL/R + Start/End)
  // =========================================================
  private getPitchBasis() {
    const S = this.worldPos(this.pitchStart);
    const E = this.worldPos(this.pitchEnd);
    const L = this.worldPos(this.pitchL);
    const R = this.worldPos(this.pitchR);

    const forward = E.subtract(S).normalize(); // along pitch length
    const side = R.subtract(L).normalize(); // across pitch width

    const length = E.subtract(S).length();
    const width = R.subtract(L).length();

    const center = S.add(E).scale(0.5);

    return { S, E, L, R, forward, side, length, width, center };
  }

  /**
   * Clamp a point into pitch rectangle:
   * - along forward axis: [0..length]
   * - along side axis: [-width/2 .. +width/2]
   */
  private clampPointToPitch(p: Vector3, marginSide = 0.06, marginLen = 0.08) {
    const { S, forward, side, length, width } = this.getPitchBasis();

    // local coordinates relative to PitchStart
    const rel = p.subtract(S);
    const u = Vector3.Dot(rel, forward); // 0..length
    const v = Vector3.Dot(rel, side); // -width/2 .. +width/2 (approx)

    const halfW = width * 0.5;

    // clamp inside with small margins (prevents touching lines)
    const uClamped = this.clamp(u, marginLen, length - marginLen);
    const vClamped = this.clamp(v, -halfW + marginSide, halfW - marginSide);

    // rebuild world point
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
  // ✅ HARD FIX: FORCE CANVAS TOP + KILL CSS OVERLAYS (pseudo-elements)
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

  private injectAntiOverlayCSS() {
    const id = "anti-overlay-style";
    if (document.getElementById(id)) return;

    const style = document.createElement("style");
    style.id = id;

    style.textContent = `
      html, body, #root { background: transparent !important; }
      body::before, body::after,
      #root::before, #root::after,
      .app::before, .app::after,
      .overlay::before, .overlay::after {
        content: none !important;
        display: none !important;
        opacity: 0 !important;
      }
      .overlay, .backdrop, .modal-overlay, .fullscreen-overlay, .game-over-overlay {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  // =========================================================
  // ✅ BIG BOTTOM POP TEXT (Hit / Miss / SIX / FOUR / OUT)
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

    // subtle animation using CSS transition
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

    // color accents per type (kept simple, no extra CSS files)
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

    // trigger animation frame
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateX(-50%) translateY(0px)";
    });

    // auto hide
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
  // ✅ SCOREBOARD (DOM OVERLAY)
  // =========================================================
  private ensureScoreboard() {
    if (this.scoreboardEl) return;

    const el = document.createElement("div");
    el.id = "cricket-scoreboard";
    el.style.position = "fixed";
    el.style.right = "38px";
    el.style.top = "14px";
    el.style.zIndex = "9999";
    el.style.pointerEvents = "none";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "1px";
    el.style.border = "1px solid rgba(255, 98, 0, 0.18)";
    el.style.background = "rgba(193, 71, 0, 0.75)";
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
  // ✅ COUNTDOWN (CENTER SCREEN)
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
    el.style.background = "rgba(36, 218, 0, 0.25)";
    el.style.backdropFilter = "blur(14px)";
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
  // ✅ PLAY AGAIN BUTTON (DOM)
  // =========================================================
  private ensurePlayAgainButton() {
    if (this.playAgainBtnEl) return;

    const btn = document.createElement("button");
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
    btn.style.background = "rgba(255, 85, 0, 0.55)";
    btn.style.backdropFilter = "blur(5px)";
    btn.style.color = "#fff";
    btn.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    btn.style.fontWeight = "950";
    btn.style.letterSpacing = "0.8px";
    btn.style.fontSize = "15px";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = "0 26px 80px rgba(0,0,0,0.55)";
    btn.style.display = "none";

    btn.onmouseenter = () => (btn.style.background = "rgba(0,0,0,0.7)");
    btn.onmouseleave = () => (btn.style.background = "rgba(0,0,0,0.55)");

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

    // ✅ reset hit tracking
    this.lastHitAt = 0;
    this.hitMinY = Number.POSITIVE_INFINITY;

    // ✅ stop camera follow
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

    // ✅ popup for FOUR/SIX
    if (amount === 6) this.popText("SIX!", "six");
    else if (amount === 4) this.popText("FOUR!", "four");
    else this.popText(`+${amount}`, "info");
  }

  private setOut(reason = "OUT!") {
    if (this.gameOver) return;
    this.gameOver = true;

    this.nextDeliveryAt = Number.POSITIVE_INFINITY;

    // ✅ stop camera follow
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
  // ✅ BOUNDARY + WICKET DETECTION HELPERS
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

      console.log("[BOUNDARY FIX] meshes:", boundaryMeshes.length);
      console.log("[BOUNDARY FIX] center:", this.boundaryCenter.toString(), "radius:", this.boundaryRadius);
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
    this.injectAntiOverlayCSS();
    this.forceCanvasFullscreenAndTop();

    const scene = new Scene(this.engine);
    this.scene = scene;

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

    // ✅ HDR Environment (safe + fallback)  -> avoids black screen if HDR missing
    try {
      const hdr = new HDRCubeTexture("/hdr/sky.hdr", scene, 512);
      scene.environmentTexture = hdr;

      const skybox = scene.createDefaultSkybox(hdr, true, 6000, 0.0);
      if (skybox) skybox.isPickable = false;

      scene.environmentIntensity = 2.0;
      scene.imageProcessingConfiguration.toneMappingEnabled = true;
      scene.imageProcessingConfiguration.toneMappingType = 1;
      scene.imageProcessingConfiguration.exposure = 1.25;
      scene.imageProcessingConfiguration.contrast = 1.08;
    } catch (e) {
      console.warn("HDR failed to load:", e);
      scene.createDefaultEnvironment({ createSkybox: true, skyboxSize: 6000 });
    }

    // ✅ Havok Physics
    const hk = await HavokPhysics();
    const plugin = new HavokPlugin(true, hk);
    scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);

    // ✅ Load stadium
    const stadium = await SceneLoader.ImportMeshAsync("", "/models/", "cricket3.glb", scene);

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

    // ✅ Camera (locked broadcast + side offset)
    const pitchStartPos = this.worldPos(this.pitchStart);
    const batsmanPos = this.worldPos(this.batsmanPoint);

    // forward direction (batsman -> pitchStart)
    const lookDir = pitchStartPos.subtract(batsmanPos).normalize();

    // side direction (pitchL -> pitchR)
    const pitchSide = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).normalize();

    // -------- TUNE THESE 3 VALUES ----------
    const eyeHeight = 0.3; // up/down
    const eyeBack = 0.5; // zoom in/out
    const sideOffset = 0; // left/right (negative = other side)
    // --------------------------------------

    // final camera direction (forward + side)
    const camDir = lookDir.add(pitchSide.scale(sideOffset)).normalize();

    const camera = new UniversalCamera(
      "cam",
      new Vector3(batsmanPos.x, this.baseY + eyeHeight, batsmanPos.z).subtract(camDir.scale(eyeBack)),
      scene
    );

    this.camera = camera;

    camera.fov = 1.2; // radians
    camera.minZ = 0.03;
    camera.speed = 0;
    camera.inertia = 0.7;
    camera.attachControl(this.canvas, true);

    // aim slightly above the pitch start
    camera.setTarget(new Vector3(pitchStartPos.x, this.baseY + eyeHeight, pitchStartPos.z));
    this.camTargetSmoothed.copyFrom(camera.getTarget());

    // ✅ IMPORTANT: keep the SAME camDir logic every frame + follow-ball target after hit
    scene.onBeforeRenderObservable.add(() => {
      if (this.gameOver) return;

      const bw = this.worldPos(this.batsmanPoint);
      const ps = this.worldPos(this.pitchStart);

      const fwd = ps.subtract(bw).normalize();
      const side = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).normalize();
      const dir = fwd.add(side.scale(sideOffset)).normalize();

      // keep broadcast camera position
      camera.position.copyFrom(new Vector3(bw.x, this.baseY + eyeHeight, bw.z).subtract(dir.scale(eyeBack)));

      // default target = pitch start
      let desiredTarget = new Vector3(ps.x, this.baseY + eyeHeight, ps.z);

      // ✅ follow ball after hit for some time
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

      // smooth target lerp
      this.camTargetSmoothed.x = Scalar.Lerp(this.camTargetSmoothed.x, desiredTarget.x, this.CAM_TARGET_LERP);
      this.camTargetSmoothed.y = Scalar.Lerp(this.camTargetSmoothed.y, desiredTarget.y, this.CAM_TARGET_LERP);
      this.camTargetSmoothed.z = Scalar.Lerp(this.camTargetSmoothed.z, desiredTarget.z, this.CAM_TARGET_LERP);

      camera.setTarget(this.camTargetSmoothed);
    });

    // ✅ Post FX pipeline
    const pipeline = new DefaultRenderingPipeline("realismPipeline", true, scene, [camera]);
    pipeline.fxaaEnabled = true;
    pipeline.imageProcessingEnabled = true;

    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.85;
    pipeline.bloomWeight = 0.25;
    pipeline.bloomKernel = 64;

    pipeline.depthOfFieldEnabled = false;

    pipeline.sharpenEnabled = true;
    pipeline.sharpen.edgeAmount = 0.25;
    pipeline.sharpen.colorAmount = 0.15;

    if (pipeline.imageProcessing) {
      pipeline.imageProcessing.vignetteEnabled = false;
      pipeline.imageProcessing.contrast = 1.05;
      pipeline.imageProcessing.exposure = 1.1;
    }

    // ✅ Bat
    await this.setupBat3D(scene);

    // ✅ Wicket helper collider
    const wicketBox = MeshBuilder.CreateBox("WicketTargetCollider", { width: 0.4, height: 1.0, depth: 0.2 }, scene);
    wicketBox.position = wicket.clone().add(new Vector3(0, 0.5, 0));
    wicketBox.isVisible = false;
    new PhysicsAggregate(wicketBox, PhysicsShapeType.BOX, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);

    this.updateScoreboard("Ready");
    this.startDeliveries(scene, { intervalMs: 5300 });

    this.startMatchWithDelay();
    return scene;
  }

  // =========================================================
  // ✅ BAT: load 3D model + cursor follow + TIMING-based hit
  // =========================================================
  private async setupBat3D(scene: Scene) {
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

    const batRes = await SceneLoader.ImportMeshAsync("", "/models/", "bat2.glb", scene);
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

        // ✅ MISS popup
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

      // HIT ASSIST (stick ball to sweet spot for 2 frames)
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

      // HIT DETECTION
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

          // ✅ HIT popup
          this.popText("HIT!", "hit");

          if (!this.wasHitThisDelivery) {
            this.wasHitThisDelivery = true;
            this.hits += 1;
            this.updateScoreboard("Hit!");
          }

          this.ballWasHit = true;

          // ✅ CAMERA: follow ball after hit
          this.camFollowBall = true;
          this.camFollowStartAt = performance.now();

          // ✅ FIX: reset hit tracking for accurate 4/6
          this.lastHitAt = performance.now();
          this.hitMinY = Number.POSITIVE_INFINITY;
          this.touchedGroundSinceHit = false;

          // @ts-ignore
          body.wakeUp?.();

          // ---- direction basis
          const baseDir = ps.subtract(ballPos).normalize();
          const vLen = batVel.length();
          const batVelDir = vLen > 0.001 ? batVel.scale(1 / vLen) : baseDir;

          const dir = batVelDir.scale(0.75).add(baseDir.scale(0.25)).normalize();

          // ---- timing window
          const bp = this.worldPos(this.batsmanPoint);
          const distToBatsman = Vector3.Distance(ballPos, bp);

          const IDEAL = 0.28;
          const WINDOW = 0.55;
          const timingRaw = 1 - this.clamp(Math.abs(distToBatsman - IDEAL) / WINDOW, 0, 1);
          const timingScore = timingRaw * timingRaw; // 0..1

          // ---- alignment & speed
          const align = this.clamp(Vector3.Dot(batVelDir, dir), 0, 1);
          const swingSpeed = this.clamp(vLen, 0, 18);
          const swingFactor = this.clamp((swingSpeed - 3) / 10, 0, 1);

          // ---- sweet spot (middle only)
          const sweetSpotFactor = 1 - Math.abs(hit.t - 0.5) * 2; // 1 at center, 0 at edges
          const sweet = this.clamp(sweetSpotFactor, 0, 1);

          // ---- harsher timing curve
          const timingFactor = Math.pow(timingScore, 1.6);
          const alignFactor = this.clamp(align, 0, 1);

          // =========================================================
          // ✅ REALISTIC POWER + LOFT + SIX GATE
          // =========================================================
          let power =
            this.BAT_BASE_POWER + this.BAT_MAX_POWER * timingFactor * sweet * alignFactor * swingFactor;

          let loft = this.BAT_LOFT_BASE + this.BAT_LOFT_MAX * timingFactor * sweet * swingFactor;

          // Penalize mistimed / edge hits heavily
          if (timingScore < 0.35) {
            power *= 0.45;
            loft *= 0.4;
          }

          // SIX only when all are perfect
          const isSixCandidate =
            timingScore >= this.SIX_TIMING_MIN &&
            alignFactor >= this.SIX_ALIGN_MIN &&
            swingSpeed >= this.SIX_SWING_SPEED_MIN &&
            sweet > 0.7;

          if (!isSixCandidate) {
            loft *= 0.55;
            power *= 0.85;
          }

          // Direction randomness on bad timing/edge
          let finalDir = dir.clone();
          if (timingScore < 0.5 || sweet < 0.5) {
            finalDir = finalDir
              .add(new Vector3(this.rand(-0.35, 0.35), this.rand(-0.15, 0.15), this.rand(-0.35, 0.35)))
              .normalize();
          }

          // Hit assist launch
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

    // ✅ reset hit tracking for this delivery
    this.lastHitAt = 0;
    this.hitMinY = Number.POSITIVE_INFINITY;

    // ✅ reset camera follow for new delivery
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

    // ✅ HARD CLAMP: keep bounce strictly inside the pitch
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
    const ballAgg = new PhysicsAggregate(ball, PhysicsShapeType.SPHERE, { mass: 0.156, friction: 0.28, restitution }, scene);

    const body = ballAgg.body;
    body.setLinearDamping(0.01);
    body.setAngularDamping(0.04);
    // @ts-ignore
    body.wakeUp?.();

    const speed = this.rand(2, 12);
    const dist = Vector3.Distance(release, bouncePoint);
    const t = this.clamp(dist / speed, 0.25, 1.35);

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

      // ✅ OUT (delay prevents instant out)
      if (age > 0.25 && this.checkWicketHit(p, ballRadius)) {
        this.setOut("OUT! Wicket hit");
        // setOut already pops OUT
        return;
      }

      const pitchTouchY = this.baseY + ballRadius * 1.05;

      // =========================================================
      // ✅ FIX: "REAL" ground touch after hit (prevents false bounce from hit-assist)
      // =========================================================
      if (this.wasHitThisDelivery) {
        const sinceHit = performance.now() - this.lastHitAt;

        // track min Y since hit
        this.hitMinY = Math.min(this.hitMinY, p.y);

        // only allow bounce detection after grace period
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

      // =========================================================
      // ✅ Boundary scoring (SIX if no ground touch since hit)
      // =========================================================
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

    // ✅ stop follow if ball gone
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

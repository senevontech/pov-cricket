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
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";

import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";

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

  // Imported meshes (collidable candidates)
  private stadiumMeshes: AbstractMesh[] = [];

  // Ball
  private activeBall: AbstractMesh | null = null;
  private activeBallAgg: PhysicsAggregate | null = null;

  // Scheduler
  private deliveryIntervalMs = 2300;
  private nextDeliveryAt = 0;
  private ballObserver: any = null;

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

  // empties from bat.glb
  private batL: TransformNode | null = null;
  private batR: TransformNode | null = null;
  private batStart: TransformNode | null = null;
  private batHand: TransformNode | null = null;

  // swing
  private isSwinging = false;
  private swingUntil = 0;
  private swingConsumedHit = false;

  // bat velocity for power
  private lastBatPos = new Vector3(0, 0, 0);
  private lastBatT = 0;

  // stop scripted ball controller after hit
  private ballWasHit = false;

  // hit assist (stick for 1-2 frames then launch)
  private hitAssistFramesLeft = 0;
  private hitAssistVel = new Vector3(0, 0, 0);

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

  private distPointToSegment(p: Vector3, a: Vector3, b: Vector3) {
    const ab = b.subtract(a);
    const ap = p.subtract(a);
    const abLen2 = Vector3.Dot(ab, ab);
    if (abLen2 < 1e-6) return { dist: Vector3.Distance(p, a), t: 0, closest: a.clone() };

    const t = this.clamp(Vector3.Dot(ap, ab) / abLen2, 0, 1);
    const closest = a.add(ab.scale(t));
    return { dist: Vector3.Distance(p, closest), t, closest };
  }

  private async createScene() {
    const scene = new Scene(this.engine);
    this.scene = scene;

    scene.clearColor = new Color4(0.02, 0.03, 0.05, 1);
    new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);

    // =========================================================
    // ✅ HDR (IBL + visible skybox)
    // =========================================================
    try {
      const hdr = new HDRCubeTexture("/hdr/sky.hdr", scene, 512);

      // environment lighting (IBL)
      scene.environmentTexture = hdr;

      // Make HDR visible as background
      const skybox = scene.createDefaultSkybox(hdr, true, 6000, 0.0);
      if (skybox) skybox.isPickable = false;

      // Tunables
      scene.environmentIntensity = 1.6;

      scene.imageProcessingConfiguration.toneMappingEnabled = true;
      scene.imageProcessingConfiguration.toneMappingType = 1;
      scene.imageProcessingConfiguration.exposure = 1.2;
      scene.imageProcessingConfiguration.contrast = 1.1;
    } catch (e) {
      console.warn("HDR failed to load:", e);
    }

    // =========================================================
    // ✅ Havok Physics
    // =========================================================
    const hk = await HavokPhysics();
    const plugin = new HavokPlugin(true, hk);
    scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);

    // =========================================================
    // ✅ Load stadium
    // =========================================================
    const stadium = await SceneLoader.ImportMeshAsync("", "/models/", "cricket3.glb", scene);

    // Hide/disable batsman meshes if present (so ball doesn't collide with them)
    stadium.meshes.forEach((m) => {
      const n = (m.name || "").toLowerCase();
      if (n.includes("batsman") || n.includes("player") || n.includes("character")) {
        m.isVisible = false;
        m.setEnabled(false);
      }
    });

    this.stadiumMeshes = stadium.meshes.filter((m) => m && m.name !== "__root__");

    // Boost materials for HDR realism (if PBR)
    for (const m of stadium.meshes) {
      const mesh = m as Mesh;
      const mat: any = mesh.material;
      if (!mat) continue;

      if (mat instanceof PBRMaterial) {
        mat.environmentIntensity = 1.2;
        mat.metallic = Math.min(1, mat.metallic ?? 0.3);
        mat.roughness = Math.min(1, Math.max(0.05, mat.roughness ?? 0.6));
      } else {
        if ("specularPower" in mat) mat.specularPower = 128;
      }
    }

    // =========================================================
    // ✅ Grab required points from stadium GLB
    // =========================================================
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

    // pitch length from Blender points
    this.pitchLen = pitchEnd.subtract(pitchStart).length();

    // ground/pitch Y from model ray sampling
    const y1 = this.sampleSurfaceY(batsman.add(new Vector3(0, 2, 0)));
    const y2 = this.sampleSurfaceY(wicket.add(new Vector3(0, 2, 0)));
    const mid = pitchStart.add(pitchEnd).scale(0.5);
    const y3 = this.sampleSurfaceY(mid.add(new Vector3(0, 2, 0)));

    const fallback = Math.min(batsman.y, wicket.y);
    this.baseY = this.safeAvg([y1, y2, y3], fallback);

    // Environment colliders
    this.createEnvironmentColliders(scene);

    // =========================================================
    // ✅ Camera at batsman looking at bowling end
    // =========================================================
    const lookDir = pitchStart.subtract(batsman).normalize();
    const eyeHeight = 0.2;
    const eyeBack = 0.4;

    const camera = new UniversalCamera(
      "cam",
      new Vector3(batsman.x, this.baseY + eyeHeight, batsman.z).subtract(lookDir.scale(eyeBack)),
      scene
    );

    camera.minZ = 0.03;
    camera.speed = 0;
    camera.inertia = 0.7;
    camera.attachControl(this.canvas, true);
    camera.setTarget(new Vector3(pitchStart.x, this.baseY + eyeHeight, pitchStart.z));

    scene.onBeforeRenderObservable.add(() => {
      const bw = this.worldPos(this.batsmanPoint);
      const ps = this.worldPos(this.pitchStart);
      const dir = ps.subtract(bw).normalize();

      camera.position.copyFrom(new Vector3(bw.x, this.baseY + eyeHeight, bw.z).subtract(dir.scale(eyeBack)));
      camera.setTarget(new Vector3(ps.x, this.baseY + eyeHeight, ps.z));
    });

    // =========================================================
    // ✅ Realism pipeline (Bloom + DOF + FXAA + Sharpen)
    // =========================================================
    const pipeline = new DefaultRenderingPipeline("realismPipeline", true, scene, [camera]);

    pipeline.fxaaEnabled = true;
    pipeline.imageProcessingEnabled = true;

    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.85;
    pipeline.bloomWeight = 0.25;
    pipeline.bloomKernel = 64;

    pipeline.depthOfFieldEnabled = true;
    pipeline.depthOfFieldBlurLevel = 1;
    pipeline.depthOfField.focalLength = 150;
    pipeline.depthOfField.fStop = 2.2;
    pipeline.depthOfField.focusDistance = 3.5;

    pipeline.sharpenEnabled = true;
    pipeline.sharpen.edgeAmount = 0.25;
    pipeline.sharpen.colorAmount = 0.15;

    // =========================================================
    // ✅ Setup bat model (cursor follow + hit)
    // Place /public/models/bat.glb
    // Empties required: BatL, BatR, BatStart, hand
    // =========================================================
    await this.setupBat3D(scene);

    // =========================================================
    // ✅ Wicket collider (small helper)
    // =========================================================
    const wicketBox = MeshBuilder.CreateBox("WicketTargetCollider", { width: 0.4, height: 1.0, depth: 0.2 }, scene);
    wicketBox.position = wicket.clone().add(new Vector3(0, 0.5, 0));
    wicketBox.isVisible = false;
    new PhysicsAggregate(wicketBox, PhysicsShapeType.BOX, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);

    // Debug pitch plane if needed
    if (this.SHOW_DEBUG_PITCH_PLANE) {
      const dbg = MeshBuilder.CreateGround("dbgPitchPlane", { width: this.pitchLen * 0.35, height: this.pitchLen * 1.2 }, scene);
      dbg.position.set(mid.x, this.baseY + 0.02, mid.z);
      const m = new StandardMaterial("dbgPitchMat", scene);
      m.diffuseColor = new Color3(0.1, 0.8, 0.9);
      m.alpha = 0.25;
      dbg.material = m;
    }

    if (this.SHOW_DEBUG_POINTS) {
      this.debugPoint(scene, "BallRelease_dbg", this.worldPos(this.ballRelease), 0.18, new Color3(1, 0.6, 0.2));
      this.debugPoint(scene, "Batsman_dbg", batsman, 0.18, new Color3(0.2, 1, 0.2));
      this.debugPoint(scene, "Wicket_dbg", wicket, 0.18, new Color3(0.2, 0.6, 1));
      this.debugPoint(scene, "PitchStart_dbg", pitchStart, 0.18, new Color3(1, 1, 0.2));
      this.debugPoint(scene, "PitchEnd_dbg", pitchEnd, 0.18, new Color3(1, 0.6, 0.2));
      this.debugPoint(scene, "PitchL_dbg", this.worldPos(this.pitchL), 0.14, new Color3(0.9, 0.9, 0.9));
      this.debugPoint(scene, "PitchR_dbg", this.worldPos(this.pitchR), 0.14, new Color3(0.9, 0.9, 0.9));
      this.debugPoint(scene, "BounceGood_dbg", this.worldPos(this.bounceGood), 0.16, new Color3(0.9, 0.2, 0.9));
      this.debugPoint(scene, "BounceYorker_dbg", this.worldPos(this.bounceYorker), 0.16, new Color3(0.4, 0.9, 0.8));
      this.debugPoint(scene, "OffStump_dbg", this.worldPos(this.offStump), 0.14, new Color3(1, 1, 1));
    }

    // Start deliveries
    this.startDeliveries(scene, { intervalMs: 2300 });
    return scene;
  }

  // =========================================================
  // ✅ BAT: load 3D model + cursor follow + hit ball
  // =========================================================
  private async setupBat3D(scene: Scene) {
    const pitchStart = this.worldPos(this.pitchStart);
    const pitchEnd = this.worldPos(this.pitchEnd);

    const pitchForward = pitchEnd.subtract(pitchStart).normalize();
    const pitchWidth = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).length();
    const mid = pitchStart.add(pitchEnd).scale(0.5);

    // Pick plane aligned to pitch (mouse -> world)
    const planeW = Math.max(2, pitchWidth * 2.4);
    const planeH = Math.max(6, this.pitchLen * 1.5);

    const pickPlane = MeshBuilder.CreateGround("batPickPlane", { width: planeW, height: planeH }, scene);
    pickPlane.isVisible = false;
    pickPlane.isPickable = true;
    // pickPlane.position.set(mid.x, this.baseY, mid.z);
    pickPlane.position.set(mid.x, this.baseY + 0.001, mid.z);

    pickPlane.rotation.y = Math.atan2(pitchForward.x, pitchForward.z);
    this.pickPlane = pickPlane;

    // Load bat glb
    const batRes = await SceneLoader.ImportMeshAsync("", "/models/", "bat2.glb", scene);

    // Root container so we can move the whole thing
    const batRoot = new TransformNode("batRoot", scene);
    // ---- Bat tuning (adjust freely) ----
const BAT_SCALE = 0.03;              // smaller bat (try 0.25–0.5)
const BAT_HEIGHT_OFFSET = 0;      // lift slightly above pitch so it doesn't clip
const BAT_TILT_X = -Math.PI / 80;     // 45° tilt (forward)
const BAT_ROLL_Z = 0.28;             // slight roll for natural feel (optional)

    this.batRoot = batRoot;

    // Parent imported meshes under batRoot (ignore __root__)
    batRes.meshes.forEach((m) => {
      if (!m || m.name === "__root__") return;
      m.setParent(batRoot);
      m.isPickable = false;
    });
    batRes.transformNodes.forEach((t) => {
      if (!t || t.name === "__root__") return;
      // many empties appear here; parent them too
      t.setParent(batRoot);
    });

    // find node only inside this imported bat
    const findTNInBat = (name: string): TransformNode | null => {
      const tn = batRes.transformNodes.find((t) => t.name === name);
      if (tn) return tn;

      // sometimes empties export as a node/mesh; wrap it
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

    // Required empties
    this.batL = findTNInBat("BatL");
    this.batR = findTNInBat("BatR");
    this.batStart = findTNInBat("BatStart");
    this.batHand = findTNInBat("hand");

    if (!this.batL || !this.batR || !this.batStart) {
      console.warn(
        "[bat2.glb] Missing empties. Required: BatL, BatR, BatStart (and optional: hand). Check names in Blender."
      );
    }

    // Optional: scale/offset bat if needed
    // (Adjust to match your model size)
    // batRoot.scaling.setAll(0.05);
    batRoot.scaling.setAll(BAT_SCALE);


    // Motion tracking
    this.lastBatPos.copyFrom(batRoot.position);
    this.lastBatT = performance.now();

    // Click to swing
    const pointerObs = scene.onPointerObservable.add((pi) => {
      // POINTERDOWN = 1
      if (pi.type === 1) {
        const ev = pi.event as PointerEvent;
        if (ev.button === 0) {
          this.isSwinging = true;
          this.swingUntil = performance.now() + 160;
          this.swingConsumedHit = false;
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

    // Update loop: cursor follow + hit logic
    scene.onBeforeRenderObservable.add(() => {
      if (!this.batRoot || !this.pickPlane) return;

      const now = performance.now();
      if (this.isSwinging && now > this.swingUntil) this.isSwinging = false;

      // 1) Cursor -> pick point
      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m === this.pickPlane);
      if (pick?.hit && pick.pickedPoint) {
  this.batRoot.position.copyFrom(pick.pickedPoint);
  this.batRoot.position.y = this.baseY + BAT_HEIGHT_OFFSET;
}


      // 2) Rotate bat to face bowling end
      const ps = this.worldPos(this.pitchStart);
      const faceDir = ps.subtract(this.batRoot.position).normalize();
      const yaw = Math.atan2(faceDir.x, faceDir.z);

      // idle vs swing pose
    //   this.batRoot.rotation.set(this.isSwinging ? -0.95 : -0.55, yaw, 0);
    // ✅ Keep bat at ~45° to ground, yaw follows pitch, plus slight roll
const swingExtra = this.isSwinging ? -0.35 : 0; // extra "snap" on swing
this.batRoot.rotation.set(
  BAT_TILT_X + swingExtra,
  yaw,
  BAT_ROLL_Z
);


      // 3) Bat velocity (for hit power)
      const dt = Math.max(0.001, (now - this.lastBatT) / 1000);
      const batVel = this.batRoot.position.subtract(this.lastBatPos).scale(1 / dt);
      this.lastBatPos.copyFrom(this.batRoot.position);
      this.lastBatT = now;

      // 4) HIT ASSIST: stick ball to BatStart for 2 frames then launch
      if (this.hitAssistFramesLeft > 0 && this.activeBall && this.activeBallAgg && this.batStart) {
        const sweet = this.batStart.getAbsolutePosition().clone();

        // force visual contact
        this.activeBall.position.copyFrom(sweet);

        // hold still while "stuck"
        this.activeBallAgg.body.setLinearVelocity(new Vector3(0, 0, 0));
        this.activeBallAgg.body.setAngularVelocity(new Vector3(0, 0, 0));

        this.hitAssistFramesLeft--;

        // launch on last frame
        if (this.hitAssistFramesLeft <= 0) {
          this.activeBallAgg.body.setLinearVelocity(this.hitAssistVel.clone());
          this.activeBallAgg.body.setAngularVelocity(
            new Vector3(this.rand(-15, 15), this.rand(-60, 60), this.rand(-15, 15))
          );
          this.activeBallAgg.body.setLinearDamping(0.01);
          this.activeBallAgg.body.setAngularDamping(0.03);
        }
        return; // skip detection while sticking
      }

      // 5) Hit detection (BatL->BatR segment)
      if (
        this.isSwinging &&
        !this.swingConsumedHit &&
        this.activeBall &&
        this.activeBallAgg &&
        this.batL &&
        this.batR
      ) {
        const ball = this.activeBall;
        const body = this.activeBallAgg.body;

        const A = this.batL.getAbsolutePosition();
        const B = this.batR.getAbsolutePosition();

        const ballPos = ball.getAbsolutePosition();
        const hit = this.distPointToSegment(ballPos, A, B);

        // Forgiving radius (tune)
        const hitRadius = 0.35;

        if (hit.dist <= hitRadius) {
          this.swingConsumedHit = true;

          // stop scripted ball controller so it NEVER overwrites hit
          this.ballWasHit = true;
          if (this.scene && this.ballObserver) {
            this.scene.onBeforeRenderObservable.remove(this.ballObserver);
            this.ballObserver = null;
          }

          // @ts-ignore
          body.wakeUp?.();

          // direction: mostly bat movement, fallback to bowling end
          const baseDir = ps.subtract(ballPos).normalize();
          const velDir = batVel.length() > 0.01 ? batVel.normalize() : baseDir;
          const dir = velDir.scale(0.85).add(baseDir.scale(0.15)).normalize();

          // velocity magnitude (guaranteed)
          const speed = this.clamp(batVel.length(), 0, 40);
          const vMag = 14 + speed * 2.2;

          // loft based on where on bat you hit (tip gives more loft)
          const loft = 3.0 + hit.t * 6.0;

          this.hitAssistFramesLeft = 2;
          this.hitAssistVel.copyFrom(dir.scale(vMag));
          this.hitAssistVel.y += loft;
        }
      }
    });
  }

  // =========================================================
  // ENVIRONMENT COLLIDERS (SAFE + LOW BOUNCE)
  // =========================================================
  private createEnvironmentColliders(scene: Scene) {
    const candidates = this.stadiumMeshes.filter((m) => {
      if (!m) return false;
      if (!m.isEnabled()) return false;

      const n = (m.name || "").toLowerCase();

      // ignore markers / empties
      if (n.includes("point") || n.includes("helper")) return false;

      // ignore characters
      if (n.includes("batsman") || n.includes("player") || n.includes("character") || n.includes("man")) return false;

      // ignore authored markers
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

      // skip absurdly huge meshes (often invisible shells)
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
    this.nextDeliveryAt = performance.now();

    scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      if (now >= this.nextDeliveryAt) {
        this.deliverBall();
        this.nextDeliveryAt = now + this.deliveryIntervalMs;
      }
    });
  }

  // =========================================================
  // BALL LOGIC (Random speed + TRUE Good/Yorker bounce)
  // =========================================================
  private deliverBall() {
    const scene = this.scene;
    if (!scene) return;

    if (this.ballObserver) {
      scene.onBeforeRenderObservable.remove(this.ballObserver);
      this.ballObserver = null;
    }

    this.disposeBall();

    // reset hit state for new delivery
    this.ballWasHit = false;
    this.hitAssistFramesLeft = 0;

    const release = this.worldPos(this.ballRelease);
    const batsman = this.worldPos(this.batsmanPoint);
    const wicket = this.worldPos(this.wicketTarget);

    const pitchStart = this.worldPos(this.pitchStart);
    const pitchEnd = this.worldPos(this.pitchEnd);

    // pitch axes
    const pitchForward = pitchEnd.subtract(pitchStart).normalize();
    const pitchSide = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).normalize();
    const pitchWidth = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).length();

    // Bounce point
    const isYorker = Math.random() < 0.25;
    const baseBounce = isYorker ? this.worldPos(this.bounceYorker) : this.worldPos(this.bounceGood);
    const off = this.worldPos(this.offStump);

    let bouncePoint = baseBounce.clone();

    // soft bias toward off-stump
    const deltaToOff = off.subtract(baseBounce);
    const offSideAmount = Vector3.Dot(deltaToOff, pitchSide);
    const biasStrength = isYorker ? 0.25 : 0.12;
    bouncePoint = bouncePoint.add(pitchSide.scale(offSideAmount * biasStrength));

    // jitter within pitch
    const maxLine = Math.max(0.05, Math.min(0.16, pitchWidth * 0.22));
    const lineJitter = this.rand(-maxLine, maxLine);
    const lengthJitter = isYorker ? this.rand(-0.12, 0.12) : this.rand(-0.35, 0.35);

    bouncePoint = bouncePoint.add(pitchSide.scale(lineJitter)).add(pitchForward.scale(lengthJitter));
    bouncePoint.y = this.baseY + 0.005;

    // Ball mesh
    const ballRadius = 0.012;
    const ball = MeshBuilder.CreateSphere("ball", { diameter: ballRadius * 2, segments: 24 }, scene);

    const mat = new StandardMaterial("ballMat", scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(1, 1, 1);
    mat.specularPower = 192;
    mat.emissiveColor = new Color3(0.04, 0.02, 0.02);
    ball.material = mat;

    ball.position.copyFrom(release);

    // physics
    const restitution = this.rand(0.12, 0.35);
    const ballAgg = new PhysicsAggregate(ball, PhysicsShapeType.SPHERE, { mass: 0.156, friction: 0.28, restitution }, scene);

    const body = ballAgg.body;
    body.setLinearDamping(0.01);
    body.setAngularDamping(0.04);
    // @ts-ignore
    body.wakeUp?.();

    // Random speed
    const speed = this.rand(2, 9);
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

    // post-bounce behavior
    let bounced = false;
    let postBounceNoRebounceApplied = false;

    const seamKick = this.rand(-0.25, 0.25);
    const swing = this.rand(-0.12, 0.12);

    const bornAt = performance.now();

    this.ballObserver = scene.onBeforeRenderObservable.add(() => {
      if (this.ballWasHit) return; // ✅ do not override after hit
      if (!this.activeBall || !this.activeBallAgg) return;

      const age = (performance.now() - bornAt) / 1000;
      const p = ball.getAbsolutePosition();

      // swing in air (pre-bounce)
      if (!bounced && age < t) {
        body.applyImpulse(pitchSide.scale(swing * 0.05), p);
      }

      const pitchTouchY = this.baseY + ballRadius * 1.05;

      // First bounce
      if (!bounced && age >= t && p.y <= pitchTouchY) {
        bounced = true;

        body.applyImpulse(pitchSide.scale(seamKick * 0.25), p);

        // after bounce: go toward wicket target
        const toward = wicket.subtract(p).normalize();
        const v = body.getLinearVelocity();

        const speed2 = Math.max(v.length() * 0.65, 6);
        const newV = toward.scale(speed2);

        newV.y = Math.max(v.y, 1.0);
        body.setLinearVelocity(newV);
      }

      // remove bounciness after first bounce
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

      // skid on pitch (no extra bounces)
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

      // cleanup
      if (age > 8.0 || p.y < this.baseY - 5) {
        if (this.ballObserver) {
          scene.onBeforeRenderObservable.remove(this.ballObserver);
          this.ballObserver = null;
        }
        this.disposeBall();
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

  // =========================================================
  // Debug helpers
  // =========================================================
  private debugPoint(scene: Scene, name: string, pos: Vector3, size = 0.2, color = new Color3(1, 1, 1)) {
    const s = MeshBuilder.CreateSphere(name, { diameter: size }, scene);
    const m = new StandardMaterial(name + "_mat", scene);
    m.diffuseColor = color;
    m.emissiveColor = color;
    s.material = m;
    s.position.copyFrom(pos);
    return s;
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

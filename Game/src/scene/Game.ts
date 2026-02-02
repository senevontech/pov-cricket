// src/scene/Game.ts
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

    // ✅ Required points (new system)
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

    private async createScene() {
        const scene = new Scene(this.engine);
        this.scene = scene;

        scene.clearColor = new Color4(0.02, 0.03, 0.05, 1);
        new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);

        // HDR
        try {
            const hdr = new HDRCubeTexture("/hdr/alps.hdr", scene, 512);
            scene.environmentTexture = hdr;
            scene.environmentIntensity = 2.5;
        } catch { }

        // Havok
        const hk = await HavokPhysics();
        const plugin = new HavokPlugin(true, hk);
        scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);

        // Load stadium
        const result = await SceneLoader.ImportMeshAsync("", "/models/", "cricket2.glb", scene);
        // result.meshes.forEach((m) => (m.isPickable = false));

        result.meshes.forEach((m) => {
            const n = (m.name || "").toLowerCase();
            if (n.includes("batsman") || n.includes("player") || n.includes("character")) {
                m.isVisible = false;
                m.setEnabled(false); // also removes from collisions/picking
            }
        });

        this.stadiumMeshes = result.meshes.filter((m) => m && m.name !== "__root__");

        // ✅ Grab points (NO BowlerPoint now)
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

        // ✅ pitch length from Blender
        this.pitchLen = pitchEnd.subtract(pitchStart).length();

        // ✅ ground / pitch Y from model
        const y1 = this.sampleSurfaceY(batsman.add(new Vector3(0, 2, 0)));
        const y2 = this.sampleSurfaceY(wicket.add(new Vector3(0, 2, 0)));
        const mid = pitchStart.add(pitchEnd).scale(0.5);
        const y3 = this.sampleSurfaceY(mid.add(new Vector3(0, 2, 0)));

        const fallback = Math.min(batsman.y, wicket.y);
        this.baseY = this.safeAvg([y1, y2, y3], fallback);

        // Environment colliders
        this.createEnvironmentColliders(scene);

        // ✅ Camera: at BatsmanPoint, looking towards PitchStart (bowling end)
        const forward = pitchEnd.subtract(pitchStart).normalize(); // bowling -> batting
        const lookDir = pitchStart.subtract(batsman).normalize();  // batsman -> bowler-end

        const eyeHeight = 0.20; // you set it low
        const eyeBack = 0.40;

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

        // Wicket collider
        const wicketBox = MeshBuilder.CreateBox(
            "WicketTargetCollider",
            { width: 0.4, height: 1.0, depth: 0.2 },
            scene
        );
        wicketBox.position = wicket.clone().add(new Vector3(0, 0.5, 0));
        wicketBox.isVisible = false;
        new PhysicsAggregate(wicketBox, PhysicsShapeType.BOX, { mass: 0 }, scene);

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
    // ENVIRONMENT COLLIDERS
    // =========================================================
    // =========================================================
// ENVIRONMENT COLLIDERS (SAFE + NON-BOUNCY)
// =========================================================
private createEnvironmentColliders(scene: Scene) {
  const candidates = this.stadiumMeshes.filter((m) => {
    if (!m) return false;

    // ✅ if you disabled a mesh, do NOT create collider on it
    if (!m.isEnabled()) return false;

    const n = (m.name || "").toLowerCase();

    // ignore markers / empties
    if (n.includes("point") || n.includes("helper")) return false;

    // ignore characters (even if you missed one)
    if (
      n.includes("batsman") ||
      n.includes("player") ||
      n.includes("character") ||
      n.includes("man")
    )
      return false;

    // ignore our authored markers
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

    // must have geometry
    const verts = (mm as any).getTotalVertices?.() ?? 0;
    const inds = (mm as any).getTotalIndices?.() ?? 0;
    if (verts < 100 || inds < 300) return false;

    // ✅ skip extremely huge meshes (often invisible shells / stadium bounds)
    try {
      const bi = m.getBoundingInfo?.();
      if (bi) {
        const size = bi.boundingBox.extendSizeWorld;
        const maxDim = Math.max(size.x, size.y, size.z) * 2;
        // if something is absurdly big compared to pitch, it's probably not a "wall"
        if (maxDim > this.pitchLen * 6) return false;
      }
    } catch {}

    return true;
  });

  candidates.forEach((m) => {
    try {
      // ✅ IMPORTANT: make environment NOT bouncy
      new PhysicsAggregate(
        m,
        PhysicsShapeType.MESH,
        {
          mass: 0,
          friction: 0.95,
          restitution: 0.02, // <-- was 0.65 (too bouncy)
        },
        scene
      );
    } catch {}
  });
}


    // =========================================================
    // DELIVERY SCHEDULER
    // =========================================================
    private startDeliveries(scene: Scene, opts: { intervalMs: number }) {
        this.deliveryIntervalMs = opts.intervalMs;
        this.nextDeliveryAt = performance.now(); // immediate

        scene.onBeforeRenderObservable.add(() => {
            const now = performance.now();
            if (now >= this.nextDeliveryAt) {
                this.deliverBall();
                this.nextDeliveryAt = now + this.deliveryIntervalMs;
            }
        });
    }

    // =========================================================
    // BALL LOGIC (BallRelease -> BounceGood/Yorker aligned to OffStump -> WicketTarget)
    // =========================================================
    private deliverBall() {
        const scene = this.scene;
        if (!scene) return;

        // remove previous observer
        if (this.ballObserver) {
            scene.onBeforeRenderObservable.remove(this.ballObserver);
            this.ballObserver = null;
        }

        this.disposeBall();

        const release = this.worldPos(this.ballRelease);
        const batsman = this.worldPos(this.batsmanPoint);
        const wicket = this.worldPos(this.wicketTarget);

        const pitchStart = this.worldPos(this.pitchStart);
        const pitchEnd = this.worldPos(this.pitchEnd);

        // ✅ pitch forward axis (bowling -> batting)
        const pitchForward = pitchEnd.subtract(pitchStart).normalize();

        // ✅ pitch side axis from PitchL -> PitchR (left -> right)
        const pitchSide = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).normalize();

        // ✅ pitch width (for clamping jitter)
        const pitchWidth = this.worldPos(this.pitchR).subtract(this.worldPos(this.pitchL)).length();

        // bounce base
        const isYorker = Math.random() < 0.25;
        const baseBounce = isYorker ? this.worldPos(this.bounceYorker) : this.worldPos(this.bounceGood);

        // line anchor
        const off = this.worldPos(this.offStump);

        // ✅ align bounce laterally to OffStump line (using pitchSide)
        const lateralAlongSide = Vector3.Dot(off.subtract(baseBounce), pitchSide);
        let bouncePoint = baseBounce.add(pitchSide.scale(lateralAlongSide));

        // ✅ jitter (keep within pitch width)
        const maxLine = Math.max(0.04, Math.min(0.12, pitchWidth * 0.18)); // adaptive
        const lineJitter = this.rand(-maxLine, maxLine);

        // length jitter along pitch
        const lengthJitter = this.rand(-0.25, 0.25);

        bouncePoint = bouncePoint
            .add(pitchSide.scale(lineJitter))
            .add(pitchForward.scale(lengthJitter));

        // keep bounce on pitch surface
        bouncePoint.y = this.baseY + 0.005;

        // ✅ ball real size (use 0.036 for real cricket ball; your 0.011 is tiny)
        const ballRadius = 0.012;
        const ball = MeshBuilder.CreateSphere("ball", { diameter: ballRadius * 2, segments: 22 }, scene);

        const mat = new StandardMaterial("ballMat", scene);
        mat.diffuseColor = new Color3(1, 1, 1);

        // ✅ shiny highlight
        mat.specularColor = new Color3(1, 1, 1);
        mat.specularPower = 128;

        // ✅ slight emissive helps visibility (optional)
        mat.emissiveColor = new Color3(0.08, 0.02, 0.02);

        // mat.specularColor = new Color3(0.9, 0.9, 0.9);
        ball.material = mat;

        // position at release
        ball.position.copyFrom(release);

        // pace
        // const speed = this.rand(25, 40);

        const speed = this.rand(22, 42); 
const restitution = this.rand(0.15, 0.45);





        // const restitution = this.rand(0.15, 0.45);

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

        // Projectile to bounce point
        const dist = Vector3.Distance(release, bouncePoint);
        const speedVar = this.rand(0.85, 1.20);
        // const t = this.clamp(dist / speed, 0.25, 1.35);
        // const t = this.clamp((dist / speed) / speedVar, 0.25, 1.35);
        const t = this.clamp(dist / speed, 0.25, 1.35);
        const derivedSpeed = dist / t; 


        
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
            if (!this.activeBall || !this.activeBallAgg) return;

            const age = (performance.now() - bornAt) / 1000;
            const p = ball.getAbsolutePosition();

            // swing before bounce (use pitchSide so it always swings across pitch width)
            if (!bounced && age < t) {
                body.applyImpulse(pitchSide.scale(swing * 0.05), p);
            }

            const pitchTouchY = this.baseY + ballRadius * 1.05;

            // First bounce
            if (!bounced && age >= t && p.y <= pitchTouchY) {
                bounced = true;

                body.applyImpulse(pitchSide.scale(seamKick * 0.25), p);

                // ✅ After bounce, go toward wicket target (behind batsman)
                const toward = wicket.subtract(p).normalize();
                const v = body.getLinearVelocity();

                const speed2 = Math.max(v.length(), 18);
                const newV = toward.scale(speed2);

                // small lift so it doesn't instantly re-hit pitch
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
                    // keep going toward wicket side
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
        try { this.activeBallAgg?.dispose(); } catch { }
        try { this.activeBall?.dispose(); } catch { }
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
    // Helpers
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

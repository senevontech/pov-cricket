import {
  Engine,
  Scene,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  Color3,
  MeshBuilder,
  StandardMaterial,
  ArcRotateCamera,
  Quaternion,
  PhysicsAggregate,
  PhysicsShapeType,
  PhysicsMotionType,
  PhysicsBody,
  Ray,
} from "babylonjs";
// import * as BABYLON from "babylonjs";

// import HavokPhysics from "havok";
import HavokPhysics from "@babylonjs/havok";

const FIXED_DT = 1 / 60;

// ---------- HUD ----------
type Hud = {
  setStatus: (s: string) => void;
  getType: () => BowlType;
  getSpeed: () => number;
  getSpin: () => number;
};

function mkHud(): Hud {
  const statusEl = document.getElementById("status") as HTMLSpanElement | null;
  const typeSel = document.getElementById("typeSel") as HTMLSelectElement | null;
  const speed = document.getElementById("speed") as HTMLInputElement | null;
  const spin = document.getElementById("spin") as HTMLInputElement | null;
  const speedVal = document.getElementById("speedVal") as HTMLSpanElement | null;
  const spinVal = document.getElementById("spinVal") as HTMLSpanElement | null;

  const safeNum = (el: HTMLInputElement | null, fallback: number) => {
    const v = Number(el?.value);
    return Number.isFinite(v) ? v : fallback;
  };

  const sync = () => {
    if (speedVal && speed) speedVal.textContent = String(speed.value);
    if (spinVal && spin) spinVal.textContent = String(spin.value);
  };

  // only attach listeners if sliders exist
  if (speed) speed.oninput = sync;
  if (spin) spin.oninput = sync;
  sync();

  return {
    setStatus: (s) => {
      if (statusEl) statusEl.textContent = s;
    },
    getType: () => ((typeSel?.value as BowlType) || "PACE_OUTSWING"),
    getSpeed: () => safeNum(speed, 26),
    getSpin: () => safeNum(spin, 30),
  };
}


// ---------- Helpers ----------
function makeMat(scene: Scene, color: Color3, alpha = 1) {
  const m = new StandardMaterial("mat", scene);
  m.diffuseColor = color;
  m.specularColor = new Color3(0.22, 0.22, 0.25);
  m.emissiveColor = new Color3(0.02, 0.02, 0.03);
  m.alpha = alpha;
  return m;
}
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------- Bowling Types ----------
type BowlType =
  | "PACE_OUTSWING"
  | "PACE_INSWING"
  | "YORKER"
  | "BOUNCER"
  | "OFFSPIN"
  | "LEGSPIN"
  | "CUTTER";

type DeliveryParams = {
  lineX: number;      // +right, -left
  lengthZ: number;    // where it pitches (world z)
  releaseY: number;   // release height
  swingDir: number;   // -1 in, +1 out (in air)
  seamNoise: number;  // random wobble
  magnus: number;     // magnus strength
  spinAxis: Vector3;  // for angular vel direction
  speedMul: number;
};

function paramsFor(type: BowlType): DeliveryParams {
  switch (type) {
    case "PACE_OUTSWING":
      return {
        lineX: 0.08,
        lengthZ: 5.1,
        releaseY: 1.55,
        swingDir: +1,
        seamNoise: 0.15,
        magnus: 0.45,
        spinAxis: new Vector3(0, 1, 0),
        speedMul: 1.0,
      };
    case "PACE_INSWING":
      return {
        lineX: -0.08,
        lengthZ: 5.0,
        releaseY: 1.55,
        swingDir: -1,
        seamNoise: 0.15,
        magnus: 0.45,
        spinAxis: new Vector3(0, 1, 0),
        speedMul: 1.0,
      };
    case "YORKER":
      return {
        lineX: (Math.random() * 2 - 1) * 0.05,
        lengthZ: 8.1,
        releaseY: 1.52,
        swingDir: (Math.random() > 0.5 ? 1 : -1) * 0.6,
        seamNoise: 0.10,
        magnus: 0.35,
        spinAxis: new Vector3(0, 1, 0),
        speedMul: 1.05,
      };
    case "BOUNCER":
      return {
        lineX: (Math.random() * 2 - 1) * 0.08,
        lengthZ: 2.3,
        releaseY: 1.65,
        swingDir: (Math.random() > 0.5 ? 1 : -1) * 0.5,
        seamNoise: 0.18,
        magnus: 0.35,
        spinAxis: new Vector3(1, 0, 0),
        speedMul: 1.03,
      };
    case "OFFSPIN":
      return {
        lineX: 0.02,
        lengthZ: 5.6,
        releaseY: 1.45,
        swingDir: 0.0,
        seamNoise: 0.08,
        magnus: 0.85,
        spinAxis: new Vector3(0, 1, 0), // Y spin gives sideways drift with magnus
        speedMul: 0.86,
      };
    case "LEGSPIN":
      return {
        lineX: -0.02,
        lengthZ: 5.6,
        releaseY: 1.45,
        swingDir: 0.0,
        seamNoise: 0.08,
        magnus: 0.95,
        spinAxis: new Vector3(0, -1, 0),
        speedMul: 0.84,
      };
    case "CUTTER":
      return {
        lineX: (Math.random() * 2 - 1) * 0.08,
        lengthZ: 5.2,
        releaseY: 1.55,
        swingDir: (Math.random() > 0.5 ? 1 : -1) * 0.35,
        seamNoise: 0.25,
        magnus: 0.55,
        spinAxis: new Vector3(0.3, 1, 0).normalize(),
        speedMul: 0.95,
      };
  }
}

// ---------- Physics “cricket feel” ----------
type AeroConfig = {
  // These are “game tuned”, not real-world exact.
  dragK: number;        // quadratic drag strength
  magnusK: number;      // magnus strength
  swingK: number;       // swing lateral force strength
  seamWobbleK: number;  // random wobble
};

const AERO: AeroConfig = {
  dragK: 0.010,         // stronger drag = shorter carry
  magnusK: 0.010,       // curvature from spin
  swingK: 0.030,        // lateral movement from seam/swing
  seamWobbleK: 0.020,   // subtle unpredictability
};

function unitOrZero(v: Vector3) {
  const l = v.length();
  return l > 1e-6 ? v.scale(1 / l) : Vector3.Zero();
}

function randomSigned() {
  return (Math.random() * 2 - 1);
}

// Apply: drag + magnus + swing (only while ball is in air)
function applyBallAerodynamics(
  body: PhysicsBody,
  dt: number,
  delivery: DeliveryParams,
  userSpin: number
) {
  const v = body.getLinearVelocity();
  const speed = v.length();

  // In very low speed, skip
  if (speed < 0.5) return;

  // drag ~ v^2 opposite direction
  const vDir = unitOrZero(v);
  const drag = vDir.scale(-AERO.dragK * speed * speed);

  // magnus ~ (omega x v)  (omega from angular velocity)
  const omega = body.getAngularVelocity();
  // scale magnus with type + userSpin
  const magnus = Vector3.Cross(omega, v).scale(AERO.magnusK * delivery.magnus);

  // swing: lateral force perpendicular to velocity in XZ plane
  // (simple: push on X based on swingDir)
  const swingAmt = AERO.swingK * delivery.swingDir * speed * speed;
  const swing = new Vector3(swingAmt, 0, 0);

  // seam wobble: subtle lateral noise (more for cutters)
  const wobble = new Vector3(
    AERO.seamWobbleK * delivery.seamNoise * speed * speed * randomSigned(),
    0,
    0
  );

  // Weight early phase more (more swing early in flight)
  // We approximate by using Z position: from release z ~ -8.5 to pitch zone ~ positive
  const pos = body.transformNode.position;
  const phase = clamp((pos.z + 8.5) / 14, 0, 1); // 0 at release → 1 near batsman
  const swingFade = lerp(1.0, 0.2, phase);

  const totalAccel = drag.add(magnus).add(swing.scale(swingFade)).add(wobble.scale(swingFade));

  // Apply as force: F = m * a
  // Babylon force is in world units; good enough for tuned gameplay
  const mass = 0.156; // cricket ball approx; keep consistent with rigidbody mass
  const force = totalAccel.scale(mass);

  body.applyForce(force, body.transformNode.getAbsolutePosition());
}

// ---------- Main ----------
async function createHavok() {
  const hk = await HavokPhysics();
  return hk;
}

async function createScene(engine: Engine, canvas: HTMLCanvasElement) {
  const hud = mkHud();
  const scene = new Scene(engine);
  (scene as any).clearColor = new Color3(0.03, 0.04, 0.07);

  // Camera
  const camera = new ArcRotateCamera(
    "cam",
    Math.PI * 0.95,
    Math.PI * 0.28,
    28,
    new Vector3(0, 2.2, 0),
    scene
  );
  camera.attachControl(canvas, true);
  camera.wheelPrecision = 60;
  camera.lowerRadiusLimit = 10;
  camera.upperRadiusLimit = 60;

  // Lights
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;

  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.2), scene);
  sun.position = new Vector3(15, 25, -10);
  sun.intensity = 0.9;

  // Physics
  const hk = await createHavok();
  const havokPlugin = new (await import("babylonjs")).HavokPlugin(true, hk);
  scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);

  // Pitch
  const pitch = MeshBuilder.CreateBox("pitch", { width: 3.2, height: 0.15, depth: 20 }, scene);
  pitch.position = new Vector3(0, -0.075, 0);
  pitch.material = makeMat(scene, new Color3(0.18, 0.22, 0.16));

  // More “cricket pitch” feel: higher friction helps grip/spin
  new PhysicsAggregate(
    pitch,
    PhysicsShapeType.BOX,
    { mass: 0, restitution: 0.22, friction: 1.05 },
    scene
  );

  // Crease marker
  const crease = MeshBuilder.CreateBox("crease", { width: 3.25, height: 0.01, depth: 0.08 }, scene);
  crease.position = new Vector3(0, 0.005, 8.6);
  crease.material = makeMat(scene, new Color3(0.8, 0.8, 0.85), 0.85);

  // Wickets
  const stumpMat = makeMat(scene, new Color3(0.84, 0.75, 0.52));
  const stumpX = [-0.11, 0, 0.11];

  const stumps: { mesh: any; body: PhysicsBody }[] = [];
  for (let i = 0; i < 3; i++) {
    const stump = MeshBuilder.CreateCylinder(
      `stump_${i}`,
      { height: 0.72, diameter: 0.045, tessellation: 20 },
      scene
    );
    stump.position = new Vector3(stumpX[i], 0.36, 9.2);
    stump.material = stumpMat;

    const agg = new PhysicsAggregate(
      stump,
      PhysicsShapeType.CYLINDER,
      { mass: 0.55, restitution: 0.12, friction: 0.9 },
      scene
    );
    stumps.push({ mesh: stump, body: agg.body });
  }

  // Bat (kinematic)
  const bat = MeshBuilder.CreateBox("bat", { width: 0.12, height: 0.9, depth: 0.05 }, scene);
  bat.position = new Vector3(0.42, 0.75, 8.65);
  bat.material = makeMat(scene, new Color3(0.55, 0.35, 0.2));
  bat.rotationQuaternion = Quaternion.FromEulerAngles(0, 0, -0.4);

  const batAgg = new PhysicsAggregate(
    bat,
    PhysicsShapeType.BOX,
    { mass: 0, restitution: 0.2, friction: 0.55 },
    scene
  );
  batAgg.body.setMotionType(PhysicsMotionType.ANIMATED);

  // Ball
  const ball = MeshBuilder.CreateSphere("ball", { diameter: 0.075, segments: 20 }, scene);
  ball.position = new Vector3(0, 1.55, -8.5);
  ball.material = makeMat(scene, new Color3(0.75, 0.08, 0.1));

  const ballAgg = new PhysicsAggregate(
    ball,
    PhysicsShapeType.SPHERE,
    { mass: 0.156, restitution: 0.50, friction: 0.35 },
    scene
  );
  ballAgg.body.setLinearDamping(0.01);
  ballAgg.body.setAngularDamping(0.02);

  const ballBody = ballAgg.body;

  // ---------- State ----------
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  let batSwing = 0;     // -1..1
  let batAngle = -0.4;
  let batPrevPos = bat.position.clone();
  let batPrevQ = bat.rotationQuaternion!.clone();

  let isBowled = false;
  let currentDelivery: DeliveryParams = paramsFor("PACE_OUTSWING");

  // Track “in air” (simple): raycast down to pitch
  const isBallInAir = () => {
    const origin = ball.position.clone();
    const ray = new Ray(origin, new Vector3(0, -1, 0), 0.20);
    const hit = scene.pickWithRay(ray, (m) => m === pitch);
    return !hit?.hit;
  };

  // Better bat contact: apply an impulse based on bat “swing velocity” and sweet-spot
  function doBatContactBoost() {
    // approximate bat velocity at impact (position delta / dt)
    const batVel = bat.position.subtract(batPrevPos).scale(1 / FIXED_DT);

    // If bat is basically not moving, skip
    if (batVel.length() < 0.4) return;

    // Sweet spot: near middle-top of bat (in local Y)
    // We'll compute ball relative position in bat space approximately via world delta.
    const rel = ball.position.subtract(bat.position);
    const relY = rel.y; // approximate
    const sweet = 0.35; // height above bat center that is best
    const sweetFactor = clamp(1 - Math.abs(relY - sweet) / 0.55, 0.15, 1.0);

    // Edge factor: if ball too far in X from bat plane, reduce & add “edge” randomness
    const edgeFactor = clamp(1 - Math.abs(rel.x) / 0.22, 0.2, 1.0);

    // Base outgoing direction: bat forward-ish + up
    // In this setup, “forward” is +Z (toward bowler is -Z), so hit is -Z direction usually
    const outDir = new Vector3(
      batVel.x * 0.25,
      0.35 + Math.abs(batVel.z) * 0.02,
      -1.0
    ).normalize();

    const power = clamp(batVel.length(), 0, 18);
    const impulseMag = power * 0.08 * sweetFactor * edgeFactor;

    // Add slight randomness on edges (realistic nick)
    const edgeNoise = (1 - edgeFactor) * 0.6;
    const jitter = new Vector3(randomSigned() * edgeNoise, randomSigned() * edgeNoise * 0.2, randomSigned() * edgeNoise);

    const impulse = outDir.add(jitter).normalize().scale(impulseMag);

    ballBody.applyImpulse(impulse, ball.position);

    // Add extra spin from bat contact
    const extraSpin = new Vector3(0, randomSigned() * 15 * edgeFactor, randomSigned() * 10);
    ballBody.setAngularVelocity(ballBody.getAngularVelocity().add(extraSpin));
  }

  // Collision events (status + bat boost)
  ballBody.getCollisionObservable().add((ev: any) => {
    const a = ev.collider?.transformNode?.name || "";
    const b = ev.collidedAgainst?.transformNode?.name || "";
    const other = a === "ball" ? b : a;

    if (other.startsWith("stump_")) hud.setStatus("💥 Wicket hit!");
    if (other === "bat") {
      hud.setStatus("🏏 Bat contact!");
      doBatContactBoost();
    }
  });

  // Reset
  const resetPositions = () => {
    hud.setStatus("Reset");

    ball.position.set(0, 1.55, -8.5);
    ball.rotationQuaternion = Quaternion.Identity();
    ballBody.setLinearVelocity(Vector3.Zero());
    ballBody.setAngularVelocity(Vector3.Zero());

    bat.position.set(0.42, 0.75, 8.65);
    bat.rotationQuaternion = Quaternion.FromEulerAngles(0, 0, -0.4);
    batAgg.body.setLinearVelocity(Vector3.Zero());
    batAgg.body.setAngularVelocity(Vector3.Zero());

    for (let i = 0; i < stumps.length; i++) {
      stumps[i].mesh.position.set(stumpX[i], 0.36, 9.2);
      stumps[i].mesh.rotationQuaternion = Quaternion.Identity();
      stumps[i].body.setLinearVelocity(Vector3.Zero());
      stumps[i].body.setAngularVelocity(Vector3.Zero());
    }

    batAngle = -0.4;
    batSwing = 0;
    isBowled = false;
  };

  // Bowl
  const bowl = () => {
    resetPositions();

    const type = hud.getType();
    currentDelivery = paramsFor(type);

    const userSpeed = hud.getSpeed();
    const userSpin = hud.getSpin();

    hud.setStatus(`Bowling: ${type}`);

    // Release + target
    const start = new Vector3(0, currentDelivery.releaseY, -8.5);
    ball.position.copyFrom(start);

    // Pitch point (length)
    const pitchPoint = new Vector3(currentDelivery.lineX, 0.05, currentDelivery.lengthZ);
    const stumpsMid = new Vector3(0, 0.35, 9.2);

    // We aim through pitch point then towards stumps: combine directions
    const dirToPitch = pitchPoint.subtract(start).normalize();
    const dirToStumps = stumpsMid.subtract(pitchPoint).normalize();
    const dir = dirToPitch.scale(0.7).add(dirToStumps.scale(0.3)).normalize();

    const speed = userSpeed * currentDelivery.speedMul;
    const v = dir.scale(speed);

    // Small line/length randomization
    v.x += randomSigned() * 0.45;
    v.y += randomSigned() * 0.20;

    ballBody.setLinearVelocity(v);

    // Spin (angular velocity)
    // userSpin in range 0..90 -> map to rad/s-ish feel
    const spinMag = (userSpin / 90) * 75;
    const omega = currentDelivery.spinAxis.scale(spinMag);
    ballBody.setAngularVelocity(omega);

    isBowled = true;
  };

  // Buttons
  const bowlBtn = document.getElementById("bowlBtn") as HTMLButtonElement;
  const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement;
  bowlBtn.onclick = () => bowl();
  resetBtn.onclick = () => resetPositions();

  // ---------- Fixed-step loop ----------
  let acc = 0;
  let last = performance.now();

  scene.onBeforeRenderObservable.add(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;

    acc += Math.min(dt, 0.05);

    const left = keys.has("a");
    const right = keys.has("d");
    const targetSwing = (right ? 1 : 0) + (left ? -1 : 0);

    batSwing += (targetSwing - batSwing) * 0.22;

    while (acc >= FIXED_DT) {
      // store prev bat transform for velocity approx
      batPrevPos.copyFrom(bat.position);
      batPrevQ.copyFrom(bat.rotationQuaternion!);

      // bat rotation update
      batAngle += batSwing * 2.2 * FIXED_DT;
      batAngle = clamp(batAngle, -1.1, 0.35);
      bat.rotationQuaternion = Quaternion.FromEulerAngles(0, 0, batAngle);

      // slight positional “push” when swinging (feels more real)
      bat.position.x = 0.42 + batSwing * 0.10;
      bat.position.y = 0.75 + Math.max(0, batSwing) * 0.04;

      // push kinematic transform into physics
      batAgg.body.transformNode.position.copyFrom(bat.position);
      batAgg.body.transformNode.rotationQuaternion = bat.rotationQuaternion;

      // Aerodynamics: only while in air + delivery active
      if (isBowled && isBallInAir()) {
        applyBallAerodynamics(ballBody, FIXED_DT, currentDelivery, hud.getSpin());
      }

      // Simple “pitch grip”: when ball is near pitch height, add sideways “turn” for spinners
      // (This is a tuned hack that makes spin bowlers actually grip on bounce.)
      if (isBowled && !isBallInAir()) {
        const v = ballBody.getLinearVelocity();
        const omega = ballBody.getAngularVelocity();
        // turn amount from spin
        const turn = clamp(omega.y / 140, -0.12, 0.12);
        // apply sideways after bounce
        ballBody.setLinearVelocity(new Vector3(v.x + turn, v.y, v.z));
      }

      acc -= FIXED_DT;
    }

    // End of delivery
    if (isBowled && ball.position.z > 11.0) {
      isBowled = false;
      hud.setStatus("Delivery complete");
    }
  });

  hud.setStatus("Ready");
  resetPositions();
  return scene;
}

async function main() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: false,
    antialias: true,
    adaptToDeviceRatio: true,
  });

  const scene = await createScene(engine, canvas);

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
}

main().catch(console.error);

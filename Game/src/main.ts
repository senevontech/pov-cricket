import { Engine } from "@babylonjs/core/Engines/engine";
import { Game } from "./scene/game2";

const app = document.getElementById("app")!;

const canvas = document.createElement("canvas");
canvas.id = "renderCanvas";
app.appendChild(canvas);

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
});

const game = new Game(engine, canvas);

game.start().catch((err) => console.error(err));

window.addEventListener("resize", () => engine.resize());

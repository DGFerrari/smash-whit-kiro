import "./style.css";
import { World } from "./game/world.ts";
import { Renderer } from "./render/renderer.ts";
import { Camera } from "./render/camera.ts";
import { GameLoop } from "./game/loop.ts";
import { PauseMenu } from "./ui/pauseMenu.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) {
  throw new Error("No se encontró el canvas #game en el HTML");
}

const world = new World();
const renderer = new Renderer(canvas);
const camera = new Camera();

// Preparamos la cámara con el tamaño real y la colocamos sobre el jugador.
camera.resize(renderer.cssWidth, renderer.cssHeight);
camera.snapTo(world.player);

const loop = new GameLoop(world, renderer, camera);

// Menú de pausa (Escape). Al abrir pausa y hace zoom extra; al cerrar reanuda.
new PauseMenu({
  onOpen: () => loop.setPaused(true),
  onClose: () => loop.setPaused(false),
});

// Reajuste al redimensionar la ventana.
window.addEventListener("resize", () => loop.onResize());

loop.start();

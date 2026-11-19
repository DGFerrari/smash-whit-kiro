/**
 * SETS DE MOVIMIENTOS por personaje (motor v2+).
 *
 * Cada personaje parte del set común (LIGHT_ATTACKS / HEAVY_ATTACKS) y lo
 * retoca con su estilo: alcance, velocidad, daño, knockback, impulso propio del
 * fuerte y, para la presentación, el nombre del movimiento y la parte del
 * cuerpo con la que golpea (`limb`, que anima el render).
 *
 * Todo son datos constantes (deterministas). Los replays grabados antes de los
 * sets propios (motor v1) usan `LEGACY_MOVESET` para reproducirse igual.
 */
import type { CharacterId } from "../game/characters.ts";
import {
  HEAVY_ATTACKS,
  LIGHT_ATTACKS,
  type AttackDef,
  type AttackDir,
  type AttackLimb,
  type ProjectileDef,
} from "./attacks.ts";

export interface Moveset {
  light: Record<AttackDir, AttackDef>;
  heavy: Record<AttackDir, AttackDef>;
}

/** Set común original (todos los personajes antes del motor v2). */
export const LEGACY_MOVESET: Moveset = { light: LIGHT_ATTACKS, heavy: HEAVY_ATTACKS };

/** Retoque compacto de un movimiento respecto al común. */
interface Tweak {
  name: string;
  limb: AttackLimb;
  /** Multiplicadores de daño, knockback y tamaño de la hitbox. */
  dmg?: number;
  kb?: number;
  w?: number;
  h?: number;
  /** knockbackUp absoluto (0..1). */
  up?: number;
  /** Fases [startup, active, recovery] en pasos. */
  t?: [number, number, number];
  /** Impulso propio del fuerte. */
  lunge?: { x: number; y: number };
  /** Habilidades especiales (ver AttackDef). */
  projectile?: ProjectileDef;
  multiHit?: { hits: number; interval: number };
  armor?: boolean;
  intangible?: boolean;
  reflect?: boolean;
}

/** Pequeño retroceso al disparar un fuerte con proyectil (en vez de abalanzarse). */
const RECOIL = { x: -160, y: 0 };

/** Proyectiles del juego (cada personaje usa los suyos). */
const P = {
  waterSpear: { kind: "spear", w: 46, h: 12, speed: 900, life: 40, damage: 12, knockback: 500, knockbackUp: 0.3, pierce: true, noMelee: true },
  fireball: { kind: "fireball", w: 30, h: 30, speed: 620, life: 60, damage: 11, knockback: 470, knockbackUp: 0.35, noMelee: true },
  lightning: { kind: "bolt", w: 70, h: 16, speed: 1600, life: 14, damage: 10, knockback: 450, knockbackUp: 0.3, noMelee: true },
  arrow: { kind: "arrow", w: 28, h: 8, speed: 1000, vy: -60, gravity: 600, life: 50, damage: 4, knockback: 190, knockbackUp: 0.25, noMelee: true },
  bigArrow: { kind: "arrow", w: 44, h: 12, speed: 1300, gravity: 300, life: 50, damage: 12, knockback: 540, knockbackUp: 0.3, pierce: true, noMelee: true },
  note: { kind: "note", w: 26, h: 26, speed: 420, life: 80, damage: 5, knockback: 220, knockbackUp: 0.45, noMelee: true },
  kunai: { kind: "kunai", w: 22, h: 8, speed: 1200, life: 30, damage: 4, knockback: 170, knockbackUp: 0.2, noMelee: true },
  tomato: { kind: "tomato", w: 24, h: 24, speed: 560, vy: -520, gravity: 1500, life: 90, damage: 12, knockback: 480, knockbackUp: 0.55, noMelee: true },
  tire: { kind: "tire", w: 30, h: 30, speed: 760, gravity: 1800, life: 80, damage: 11, knockback: 480, knockbackUp: 0.35, bounce: true, noMelee: true },
  laser: { kind: "laser", w: 60, h: 8, speed: 1700, life: 18, damage: 6, knockback: 230, knockbackUp: 0.2, noMelee: true },
  plasma: { kind: "plasma", w: 42, h: 42, speed: 360, life: 110, damage: 14, knockback: 560, knockbackUp: 0.35, noMelee: true },
} satisfies Record<string, ProjectileDef>;

type Set4 = Record<AttackDir, Tweak>;

function tune(base: AttackDef, tw: Tweak): AttackDef {
  const [startup, rawActive, recovery] = tw.t ?? [base.startup, base.active, base.recovery];
  // Un golpe múltiple necesita una fase activa que abarque todos sus golpes.
  const active = tw.multiHit ? Math.max(rawActive, tw.multiHit.hits * tw.multiHit.interval) : rawActive;
  return {
    ...base,
    startup,
    active,
    recovery,
    damage: Math.round(base.damage * (tw.dmg ?? 1) * 10) / 10,
    knockback: Math.round(base.knockback * (tw.kb ?? 1)),
    knockbackUp: Math.min(1, Math.max(0, tw.up ?? base.knockbackUp)),
    hitbox: {
      reach: base.hitbox.reach,
      w: Math.round(base.hitbox.w * (tw.w ?? 1)),
      h: Math.round(base.hitbox.h * (tw.h ?? 1)),
    },
    name: tw.name,
    limb: tw.limb,
    lunge: tw.lunge,
    projectile: tw.projectile,
    multiHit: tw.multiHit,
    armor: tw.armor,
    intangible: tw.intangible,
    reflect: tw.reflect,
  };
}

function set(light: Set4, heavy: Set4): Moveset {
  const dirs: AttackDir[] = ["neutral", "side", "up", "down"];
  const l = {} as Record<AttackDir, AttackDef>;
  const h = {} as Record<AttackDir, AttackDef>;
  for (const d of dirs) {
    l[d] = tune(LIGHT_ATTACKS[d], light[d]);
    h[d] = tune(HEAVY_ATTACKS[d], heavy[d]);
  }
  return { light: l, heavy: h };
}

export const MOVESETS: Partial<Record<CharacterId, Moveset>> = {
  // Kael — lancero: el mayor alcance, algo más lento.
  kael: set(
    {
      neutral: { name: "Estocada", limb: "weapon", w: 1.35, dmg: 0.95 },
      side: { name: "Barrido de Lanza", limb: "weapon", w: 1.45, t: [5, 8, 9], dmg: 0.55, multiHit: { hits: 2, interval: 4 } },
      up: { name: "Remolino Alto", limb: "weapon", h: 1.3 },
      down: { name: "Pinchazo Bajo", limb: "weapon", w: 1.4 },
    },
    {
      neutral: { name: "Lanza de Marea", limb: "weapon", t: [7, 4, 16], projectile: P.waterSpear, lunge: RECOIL },
      side: { name: "Embestida de Marea", limb: "weapon", w: 1.5, kb: 1.05, lunge: { x: 820, y: -160 } },
      up: { name: "Géiser", limb: "weapon", h: 1.35, lunge: { x: 0, y: -960 } },
      down: { name: "Ancla", limb: "weapon", w: 1.3, dmg: 1.05, lunge: { x: 0, y: 780 } },
    },
  ),
  // Vesper — duelista de fuego: puños rapidísimos.
  red: set(
    {
      neutral: { name: "Jab Ígneo", limb: "fist", t: [2, 9, 6], dmg: 0.42, multiHit: { hits: 3, interval: 3 } },
      side: { name: "Gancho de Forja", limb: "fist", t: [3, 4, 7] },
      up: { name: "Uppercut Ardiente", limb: "fist", up: 0.95, kb: 1.05 },
      down: { name: "Barrida de Brasas", limb: "kick" },
    },
    {
      neutral: { name: "Bola de Fuego", limb: "fist", t: [6, 4, 15], projectile: P.fireball, lunge: RECOIL },
      side: { name: "Martillo de Forja", limb: "fist", dmg: 1.1, lunge: { x: 700, y: -140 } },
      up: { name: "Columna de Fuego", limb: "fist", lunge: { x: 0, y: -920 } },
      down: { name: "Pisotón de Lava", limb: "kick", lunge: { x: 0, y: 820 } },
    },
  ),
  // Sol — mensajero relámpago: patadas veloces y la mejor movilidad.
  yellow: set(
    {
      neutral: { name: "Relámpago", limb: "kick", t: [2, 3, 6], dmg: 0.85 },
      side: { name: "Patada Exprés", limb: "kick", t: [3, 3, 6], w: 1.1 },
      up: { name: "Rayo Ascendente", limb: "kick", t: [3, 4, 7] },
      down: { name: "Tormenta Baja", limb: "kick", t: [4, 9, 9], dmg: 0.42, multiHit: { hits: 3, interval: 3 } },
    },
    {
      neutral: { name: "Trueno", limb: "magic", t: [5, 3, 13], projectile: P.lightning, lunge: RECOIL },
      side: { name: "Entrega Urgente", limb: "kick", dmg: 0.9, lunge: { x: 960, y: -180 } },
      up: { name: "Ascenso Dorado", limb: "kick", dmg: 0.9, lunge: { x: 0, y: -1080 } },
      down: { name: "Caída de Rayo", limb: "kick", lunge: { x: 0, y: 960 } },
    },
  ),
  // Ivy — arquera: hitboxes largas y finas, poco knockback.
  green: set(
    {
      neutral: { name: "Flecha Rápida", limb: "magic", t: [4, 2, 10], projectile: P.arrow },
      side: { name: "Disparo Raso", limb: "magic", w: 1.8, h: 0.6, dmg: 0.85 },
      up: { name: "Flecha al Cielo", limb: "magic", h: 1.6, w: 0.7 },
      down: { name: "Raíces", limb: "magic", w: 1.5, h: 0.7, up: 0.4 },
    },
    {
      neutral: { name: "Lluvia de Hojas", limb: "magic", w: 1.4 },
      // Dispara mientras salta hacia atrás.
      side: { name: "Disparo Cargado", limb: "magic", t: [7, 3, 15], projectile: P.bigArrow, lunge: { x: -260, y: -160 } },
      up: { name: "Enredadera", limb: "magic", h: 1.5, lunge: { x: 0, y: -880 } },
      down: { name: "Espina", limb: "kick", lunge: { x: 0, y: 700 } },
    },
  ),
  // Nova — idol: ondas de sonido amplias.
  nova: set(
    {
      neutral: { name: "Nota Brillante", limb: "magic", t: [4, 2, 10], projectile: P.note },
      side: { name: "Golpe de Micro", limb: "weapon" },
      up: { name: "Agudo", limb: "magic", h: 1.3, up: 0.95 },
      down: { name: "Bajo Profundo", limb: "magic", w: 1.3 },
    },
    {
      neutral: { name: "Estallido Estelar", limb: "magic", w: 1.35, h: 1.3, dmg: 0.32, t: [6, 16, 12], multiHit: { hits: 4, interval: 4 } },
      side: { name: "Gira Mundial", limb: "body", lunge: { x: 760, y: -200 } },
      up: { name: "Supernova", limb: "magic", h: 1.4, kb: 1.1, lunge: { x: 0, y: -940 } },
      down: { name: "Lluvia de Estrellas", limb: "magic", w: 1.4, lunge: { x: 0, y: 700 } },
    },
  ),
  // Rook — tanque: lento pero cada golpe pesa.
  rook: set(
    {
      neutral: { name: "Golpe de Guantelete", limb: "fist", t: [4, 4, 9], dmg: 1.2, kb: 1.1 },
      side: { name: "Empujón de Escudo", limb: "body", w: 1.2, kb: 1.2, t: [5, 4, 10] },
      up: { name: "Escudo Alzado", limb: "body", h: 1.2, dmg: 1.15, t: [5, 5, 10] },
      down: { name: "Pisada de Hierro", limb: "kick", dmg: 1.15, t: [6, 4, 11] },
    },
    {
      neutral: { name: "Muralla", limb: "body", w: 1.3, h: 1.2, dmg: 1.1, kb: 1.1, t: [9, 6, 16], armor: true },
      side: { name: "Carga de Bastión", limb: "body", dmg: 1.1, kb: 1.15, t: [9, 6, 16], armor: true, lunge: { x: 520, y: -100 } },
      up: { name: "Torre", limb: "body", h: 1.3, dmg: 1.15, lunge: { x: 0, y: -760 } },
      down: { name: "Terremoto", limb: "kick", w: 1.5, dmg: 1.3, kb: 1.15, t: [8, 5, 16], lunge: { x: 0, y: 600 } },
    },
  ),
  // Kaito — ninja: rápido, con el dash más largo.
  kaito: set(
    {
      neutral: { name: "Kunai", limb: "weapon", t: [3, 2, 9], projectile: P.kunai },
      side: { name: "Corte Veloz", limb: "weapon", t: [3, 4, 7] },
      up: { name: "Patada Luna", limb: "kick", t: [3, 8, 7], dmg: 0.55, multiHit: { hits: 2, interval: 4 } },
      down: { name: "Barrido Sombra", limb: "kick", t: [4, 3, 8] },
    },
    {
      neutral: { name: "Iaido", limb: "weapon", w: 1.2, t: [4, 4, 11] },
      side: { name: "Paso Fantasma", limb: "weapon", w: 1.3, dmg: 0.85, intangible: true, t: [6, 6, 15], lunge: { x: 1000, y: -120 } },
      up: { name: "Vuelo del Halcón", limb: "kick", lunge: { x: 0, y: -1000 } },
      down: { name: "Kunai Picado", limb: "weapon", lunge: { x: 0, y: 900 } },
    },
  ),
  // Taro — chef: sartenazos contundentes.
  taro: set(
    {
      neutral: { name: "Sartenazo", limb: "weapon", dmg: 1.05 },
      side: { name: "Volteo de Wok", limb: "weapon", w: 1.15, t: [4, 8, 9], dmg: 0.55, multiHit: { hits: 2, interval: 4 } },
      up: { name: "Salteado", limb: "weapon", up: 0.95 },
      down: { name: "Cuchillada Baja", limb: "weapon" },
    },
    {
      neutral: { name: "Tomate Picante", limb: "weapon", t: [6, 3, 14], projectile: P.tomato, lunge: RECOIL },
      side: { name: "Plato Fuerte", limb: "weapon", w: 1.25, dmg: 1.2, lunge: { x: 560, y: -140 } },
      up: { name: "Flambeado", limb: "magic", h: 1.35, lunge: { x: 0, y: -880 } },
      down: { name: "Golpe de Cazo", limb: "weapon", dmg: 1.1, lunge: { x: 0, y: 760 } },
    },
  ),
  // El Primo — luchador: puños enormes y codazo volador.
  blue: set(
    {
      neutral: { name: "Puñetazo Bravo", limb: "fist", t: [2, 3, 6], w: 1.1 },
      side: { name: "Ráfaga de Puños", limb: "fist", w: 1.15, dmg: 0.4, t: [4, 12, 9], multiHit: { hits: 4, interval: 3 } },
      up: { name: "Gancho al Cielo", limb: "fist" },
      down: { name: "Patadón", limb: "kick" },
    },
    {
      neutral: { name: "Puño Supremo", limb: "fist", w: 1.2, dmg: 1.2, kb: 1.1 },
      side: { name: "Placaje Luchador", limb: "body", dmg: 1.05, armor: true, t: [8, 6, 15], lunge: { x: 720, y: -160 } },
      up: { name: "Salto de Lucha", limb: "fist", h: 1.2, lunge: { x: 0, y: -1000 } },
      down: { name: "Codazo Volador", limb: "body", w: 1.5, dmg: 1.3, kb: 1.2, lunge: { x: 0, y: 1000 } },
    },
  ),
  // Bolt — piloto: el turbo lateral más largo del juego.
  bolt: set(
    {
      neutral: { name: "Puño Pit-Stop", limb: "fist", t: [3, 3, 7] },
      side: { name: "Derrape", limb: "kick", w: 1.2, t: [3, 4, 7] },
      up: { name: "Patada Turbo", limb: "kick" },
      down: { name: "Barrido de Neumático", limb: "kick", w: 1.3, t: [5, 8, 9], dmg: 0.55, multiHit: { hits: 2, interval: 4 } },
    },
    {
      neutral: { name: "Neumático Loco", limb: "fist", t: [6, 3, 14], projectile: P.tire, lunge: RECOIL },
      side: { name: "Turbo Grand Prix", limb: "body", w: 1.3, dmg: 1.05, lunge: { x: 1100, y: -140 } },
      up: { name: "Despegue", limb: "kick", lunge: { x: 0, y: -1050 } },
      down: { name: "Caída en Picado", limb: "kick", lunge: { x: 0, y: 1000 } },
    },
  ),
  // Gloop — slime: golpes amplios que lanzan hacia arriba.
  gloop: set(
    {
      neutral: { name: "Blub", limb: "body", w: 1.15, up: 0.5, dmg: 0.85, reflect: true },
      side: { name: "Estirón", limb: "body", w: 1.5, h: 0.8, dmg: 0.85 },
      up: { name: "Rebote", limb: "head", h: 1.2, up: 1 },
      down: { name: "Charco", limb: "body", w: 1.5, h: 0.7, up: 0.6 },
    },
    {
      neutral: { name: "Gelatina Espejo", limb: "body", w: 1.35, h: 1.3, kb: 1.1, up: 0.6, reflect: true },
      side: { name: "Bola Viscosa", limb: "body", kb: 1.1, lunge: { x: 680, y: -260 } },
      up: { name: "Superrebote", limb: "head", up: 1, lunge: { x: 0, y: -1150 } },
      down: { name: "Aplastón Real", limb: "body", w: 1.6, dmg: 1.15, lunge: { x: 0, y: 900 } },
    },
  ),
  // Unit-7 — mecha: láseres de alcance medio y puño cohete.
  unit7: set(
    {
      neutral: { name: "Puño Pistón", limb: "fist" },
      side: { name: "Láser", limb: "magic", t: [4, 2, 10], projectile: P.laser },
      up: { name: "Antena Eléctrica", limb: "head", h: 1.2 },
      down: { name: "Pisotón Hidráulico", limb: "kick", dmg: 1.05 },
    },
    {
      neutral: { name: "Cañón de Plasma", limb: "magic", t: [8, 4, 16], projectile: P.plasma, lunge: RECOIL },
      side: { name: "Puño Cohete", limb: "fist", w: 1.35, dmg: 1.1, lunge: { x: 800, y: -120 } },
      up: { name: "Propulsor", limb: "kick", lunge: { x: 0, y: -980 } },
      down: { name: "Martillo Orbital", limb: "fist", dmg: 1.15, lunge: { x: 0, y: 880 } },
    },
  ),
};

/**
 * Set de movimientos de un personaje. `legacy` = replay grabado con un motor
 * anterior a los sets propios (se usa el set común para reproducirlo igual).
 */
export function getMoveset(id: CharacterId, legacy = false): Moveset {
  if (legacy) return LEGACY_MOVESET;
  return MOVESETS[id] ?? LEGACY_MOVESET;
}

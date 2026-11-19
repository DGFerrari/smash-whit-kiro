/**
 * Capa de contenido de KiroBrawl: nombres visibles, títulos y lore.
 *
 * Los ids del motor (`CharacterId`, `StageId`) no cambian (se guardan en los
 * replays); aquí se traducen a los textos que ve el jugador. Toda la UI debe
 * resolver nombres con `characterLore(id).name` / `stageLore(id).name` en lugar
 * de usar los `name` de `src/engine/game/characters.ts` y `stages.ts`.
 *
 * Límites (R1.3, R1.4): nombre de personaje ≤ 20, nombre de escenario ≤ 24,
 * título ≤ 40, lore ≤ 300, descripción ≤ 200 caracteres.
 */
import type { CharacterId } from "../engine/game/characters.ts";
import type { StageId } from "../engine/game/stages.ts";

export interface CharacterLore {
  name: string;
  title: string;
  lore: string;
  /** Si es un personaje invitado: franquicia de la que viene (crossover). */
  crossover?: string;
}

export interface StageLore {
  name: string;
  description: string;
}

/** Contenido de cada personaje, indexado por su id estable del motor. */
export const CHARACTER_LORE: Readonly<Record<CharacterId, CharacterLore>> = {
  blue: {
    name: "El Primo",
    title: "El Campeón del Cuadrilátero",
    crossover: "Brawl Stars",
    lore:
      "Invitado estelar llegado desde Brawl Stars. El luchador enmascarado salta del cuadrilátero a las islas de Aethra con sus puños del tamaño de un barril. Nunca ha perdido una pelea... según él. ¡Lo que le falta de estrategia lo compensa con codazos voladores!",
  },
  red: {
    name: "Vesper",
    title: "La Llama Carmesí",
    lore:
      "Herrera y duelista de las forjas volcánicas. Lleva un guantelete de cuero endurecido que aún humea tras cada combate. Dice que solo quiere probar su metal, pero nadie la ha visto rendirse.",
  },
  yellow: {
    name: "Sol",
    title: "El Relámpago Dorado",
    lore:
      "Mensajero más rápido del archipiélago, criado entre los tejados de la ciudad neón. Convirtió las carreras de entrega en un estilo de combate y ahora busca el título para su barrio.",
  },
  green: {
    name: "Ivy",
    title: "La Guardiana del Bosque",
    lore:
      "Exploradora de los bosques colgantes de Aethra. Conoce cada raíz y cada ruina. Entra en el torneo para que los fragmentos dejen de arrancarse de los árboles que sostienen su hogar.",
  },
  kael: {
    name: "Kael",
    title: "El Filo de la Marea",
    lore:
      "Capitán de la guardia costera de Aethra. Su armadura de acero templado en agua salada aguanta tormentas y golpes por igual. Lucha para que ningún fragmento caiga en manos de los piratas del cielo.",
  },
  nova: {
    name: "Nova",
    title: "La Estrella Fugaz",
    lore:
      "Idol cósmica que llena los estadios del Distrito Neón. Su micrófono en forma de estrella dispara notas que golpean como cometas. Pelea en el torneo para que su próxima gira sea en el cielo.",
  },
  rook: {
    name: "Rook",
    title: "El Bastión de Hierro",
    lore:
      "Caballero de la última fortaleza de Aethra. Su escudo torre ha parado avalanchas y nunca ha retrocedido un paso. Habla poco, pero cuando carga, el suelo tiembla.",
  },
  kaito: {
    name: "Kaito",
    title: "La Sombra del Viento",
    lore:
      "Ninja del Santuario del Alba entrenado para moverse entre faroles sin hacer ruido. Su bufanda roja es lo último que ven sus rivales. Busca al maestro que traicionó su clan.",
  },
  taro: {
    name: "Taro",
    title: "El Chef Volcánico",
    lore:
      "Cocinero estrella del mercado flotante. Lleva un wok de hierro forjado en lava que usa igual para saltear que para repartir sartenazos. Dice que el secreto de la victoria es el picante.",
  },
  bolt: {
    name: "Bolt",
    title: "Campeón del Turbo Grand Prix",
    lore:
      "Piloto invitado desde el circuito de Turbo Grand Prix. Se estrelló en Aethra persiguiendo un récord de velocidad y decidió quedarse a competir. Con su mono de carreras nadie le alcanza.",
    crossover: "Turbo Grand Prix",
  },
  gloop: {
    name: "Gloop",
    title: "El Rey Gelatina",
    lore:
      "Soberano del reino de los slimes, llegado a través de un portal de Slime Kingdom. Rebota, se estira y se traga los golpes. Nadie sabe si su corona es de oro o de caramelo.",
    crossover: "Slime Kingdom",
  },
  unit7: {
    name: "Unit-7",
    title: "El Mecha de Starforge",
    lore:
      "Robot de combate de la flota Starforge, enviado a Aethra en misión de reconocimiento. Analiza a cada rival antes del primer golpe. Su procesador aprendió a disfrutar de las peleas.",
    crossover: "Starforge",
  },
  sandbag: {
    name: "Saco",
    title: "El Incansable",
    lore:
      "Muñeco de entrenamiento cosido con lona y cuerda en el gimnasio del torneo. No gana nunca, pero tampoco se queja. Todos los campeones han empezado dándole golpes a él.",
  },
};

/** Contenido de cada escenario, indexado por su id estable del motor. */
export const STAGE_LORE: Readonly<Record<StageId, StageLore>> = {
  neonIsland: {
    name: "Distrito Neón",
    description:
      "Una isla flotante coronada por rascacielos de cristal y letreros de neón. El tráfico aéreo cruza el horizonte nocturno mientras la lluvia brilla sobre el acero.",
  },
  sunsetIsland: {
    name: "Risco de Pradera",
    description:
      "Acantilado de roca rojiza cubierto de hierba alta, con molinos de piedra y nubes lentas sobre un valle infinito.",
  },
  voidIsland: {
    name: "Santuario del Alba",
    description:
      "Templo de mármol y musgo suspendido sobre un mar en calma, con faroles flotantes y una montaña nevada al fondo.",
  },
  training: {
    name: "Sala de Pruebas",
    description:
      "Gimnasio del torneo con rejilla de medición y focos de estudio. Aquí se afinan los combos antes de saltar a las islas.",
  },
};

/**
 * Devuelve nombre, título y lore de un personaje. Para ids desconocidos
 * (p. ej. replays de versiones futuras) devuelve el propio id en cada campo.
 */
export function characterLore(id: string): CharacterLore {
  if (Object.prototype.hasOwnProperty.call(CHARACTER_LORE, id)) {
    return CHARACTER_LORE[id as CharacterId];
  }
  return { name: id, title: id, lore: id };
}

/**
 * Devuelve nombre y descripción de un escenario. Para ids desconocidos
 * devuelve el propio id en cada campo.
 */
export function stageLore(id: string): StageLore {
  if (Object.prototype.hasOwnProperty.call(STAGE_LORE, id)) {
    return STAGE_LORE[id as StageId];
  }
  return { name: id, description: id };
}

/** Espaço reservado no layout (não empurra vizinhos). */
export const PIXELYN_SIZE = {
  rail: 72,
  chat: 96,
  greeting: 168
} as const;

/** Escala visual dentro do slot (overflow oculto). Só aumenta o desenho, não o layout. */
export const PIXELYN_VISUAL_SCALE = {
  rail: 1.45,
  chat: 1.45,
  greeting: 1.45
} as const;

export type PixelynSizeKey = keyof typeof PIXELYN_SIZE;

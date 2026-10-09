export const iso = (d: Date) => d.toISOString();

export const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/** Formatea una fecha UTC para mostrarla en la zona de la UI (America/Montevideo por defecto). */
export function formatLocal(value: string | null | undefined, timeZone = "America/Montevideo"): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-UY", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

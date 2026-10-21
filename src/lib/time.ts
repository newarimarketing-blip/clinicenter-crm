import { CLINIC } from "./clinic-config";

export const todayLabel = () =>
  new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: CLINIC.tz });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: CLINIC.tz });

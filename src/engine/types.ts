export type Equipment = "gun" | "tank" | "fighter" | "destroyer" | "artillery";
export const equipmentTypes: Equipment[] = [
  "gun",
  "tank",
  "fighter",
  "destroyer",
  "artillery",
];
export type Battalion = "infantry" | "armored" | "artillery";
export type Point = [number, number];
export interface Province {
  id: number;
  color: string;
  kind: "land" | "sea" | "impassable-land" | "impassable-sea";
  center: Point;
  polygons: Point[][];
  neighbors: number[];
  airZone: number;
  seaZone: number | null;
  owner: number | null;
  layers: Record<string, string>;
}
export interface AirZone {
  medium: "land" | "sea";
  sourceColor: string;
  linkedAirZones: number[];
  seaZone: number | null;
  id: number;
  color: string;
  center: Point;
  name: string;
}
export interface SeaZone {
  id: number;
  color: string;
  center: Point;
  name: string;
  airZones: number[];
}
export interface World {
  width: number;
  height: number;
  provinces: Province[];
  airZones: AirZone[];
  seaZones: SeaZone[];
  nations: {
    id: number;
    name: string;
    color: string;
    capital: number;
    description: string;
  }[];
  sourceHash: string;
}
export interface Template {
  id: number;
  name: string;
  battalions: Battalion[];
}
export interface Nation {
  id: number;
  stock: Record<Equipment, number>;
  civs: number;
  mils: number;
  consumer: number;
  production: Record<Equipment, number>;
  construction: {
    kind: "civ" | "mil" | "port";
    province?: number;
    progress: number;
  }[];
  metrics: Record<string, number>;
  templates: Template[];
  recruits: { template: Template; province: number; ready: number }[];
  research: string | null;
  researchProgress: number;
  techs: string[];
  surrendered: boolean;
  ai: boolean;
}
export interface Unit {
  id: number;
  owner: number;
  kind: "division" | "fleet";
  name: string;
  province: number;
  target: number | null;
  attack: number;
  defense: number;
  maxOrg: number;
  org: number;
  strength: number;
  equipment: Partial<Record<Equipment, number>>;
  battalions: Battalion[];
  route?: number[];
  moveReady?: number;
  transition?: {
    from: number;
    to: number;
    ready: number;
    kind: "embark" | "disembark";
  };
}
export interface Wing {
  id: number;
  owner: number;
  base: number;
  zone: number | null;
  mission: "superiority" | "support";
  planes: number;
  range: number;
}
export interface GameEvent {
  tick: number;
  type: string;
  nation?: number;
  unit?: number;
  province?: number;
  amount?: number;
  message: string;
}
export interface State {
  version: 2;
  world: World;
  seed: number;
  tick: number;
  nextId: number;
  nations: Nation[];
  units: Unit[];
  wings: Wing[];
  owners: Record<number, number | null>;
  ports: Record<number, boolean>;
  wars: [number, number][];
  events: GameEvent[];
  winner: number | null;
}
export type Command =
  | { type: "war"; target: number }
  | { type: "surrender" }
  | { type: "production"; equipment: Equipment; factories: number }
  | { type: "build"; kind: "civ" | "mil" | "port"; province?: number }
  | { type: "template"; id?: number; name: string; battalions: Battalion[] }
  | { type: "recruit"; template: number; province: number }
  | { type: "fleet"; province: number; ships: number }
  | { type: "move"; units: number[]; province: number }
  | { type: "research"; tech: string }
  | { type: "wing"; province: number }
  | {
      type: "mission";
      wing: number;
      zone: number;
      mission: "superiority" | "support";
    };
export interface Order {
  nation: number;
  command: Command;
}

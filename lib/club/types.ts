import type { Card, Family, Position } from "@/lib/scoring/types";

/** Pitch slot in a 4-3-3 (no GK — markets don't map cleanly to keepers). */
export type SlotId =
  | "st"
  | "rw"
  | "lw"
  | "cam"
  | "cm"
  | "cdm"
  | "lb"
  | "cb1"
  | "cb2"
  | "rb"
  | "sub";

export interface FormationSlot {
  id: SlotId;
  label: string;
  /** CSS grid placement on the pitch */
  row: number;
  col: number;
  accepts: Position[];
  preferredFamily: Family | null;
}

export const FORMATION: FormationSlot[] = [
  { id: "st", label: "ST", row: 1, col: 2, accepts: ["ST"], preferredFamily: "Forward" },
  { id: "lw", label: "LW", row: 2, col: 1, accepts: ["RW", "ST"], preferredFamily: "Forward" },
  { id: "rw", label: "RW", row: 2, col: 3, accepts: ["RW", "ST"], preferredFamily: "Forward" },
  { id: "cam", label: "CAM", row: 3, col: 2, accepts: ["CAM", "CM"], preferredFamily: "Playmaker" },
  { id: "cm", label: "CM", row: 4, col: 1, accepts: ["CM", "CAM", "CDM"], preferredFamily: "Playmaker" },
  { id: "cdm", label: "CDM", row: 4, col: 3, accepts: ["CDM", "CM", "CB"], preferredFamily: "Anchor" },
  { id: "lb", label: "LB", row: 5, col: 1, accepts: ["CB", "CDM"], preferredFamily: "Anchor" },
  { id: "cb1", label: "CB", row: 5, col: 2, accepts: ["CB"], preferredFamily: "Anchor" },
  { id: "cb2", label: "CB", row: 5, col: 3, accepts: ["CB"], preferredFamily: "Anchor" },
  { id: "rb", label: "RB", row: 5, col: 4, accepts: ["CB", "CDM"], preferredFamily: "Anchor" },
  { id: "sub", label: "SUB", row: 6, col: 2, accepts: ["ST", "RW", "CAM", "CM", "CDM", "CB"], preferredFamily: null },
];

export type ScoutAgentId = "poacher" | "regista" | "mezzala" | "galactico";

export interface ScoutAgent {
  id: ScoutAgentId;
  name: string;
  role: string;
  blurb: string;
  /** Prefer these families when filling empty slots */
  families: Family[];
  minFinish?: "silver" | "gold";
}

export const SCOUT_AGENTS: ScoutAgent[] = [
  {
    id: "poacher",
    name: "Poacher Scout",
    role: "Finishing",
    blurb: "Hunts viral volume and pure shooters — high SHO, hot markets.",
    families: ["Forward"],
  },
  {
    id: "regista",
    name: "Regista Scout",
    role: "Deep play",
    blurb: "Builds from the back — PAS + DEF anchors and playmakers.",
    families: ["Playmaker", "Anchor"],
  },
  {
    id: "mezzala",
    name: "Mezzala Scout",
    role: "Engine",
    blurb: "Box-to-box grinders — PAC + PHY daily drivers.",
    families: ["Playmaker", "Forward"],
  },
  {
    id: "galactico",
    name: "Galáctico Scout",
    role: "Prestige",
    blurb: "Only gold-tier finishes and Icons — hall-of-fame markets.",
    families: ["Forward", "Playmaker", "Anchor"],
    minFinish: "gold",
  },
];

/** Slim snapshot stored in localStorage (full Card is fine; this keeps keys clear). */
export type SquadCard = Card;

export interface ClubState {
  version: 1;
  clubName: string;
  agentId: ScoutAgentId;
  /** slot id → card login snapshot */
  slots: Partial<Record<SlotId, SquadCard>>;
  /** Recent scout actions for the feed strip */
  feed: { at: number; text: string; login?: string }[];
}

export const EMPTY_CLUB: ClubState = {
  version: 1,
  clubName: "My Club",
  agentId: "poacher",
  slots: {},
  feed: [],
};

export const CLUB_STORAGE_KEY = "bento:club:v1";
export const SQUAD_SIZE = FORMATION.length;

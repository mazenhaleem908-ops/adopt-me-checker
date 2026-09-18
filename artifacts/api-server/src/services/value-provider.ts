import fs from "node:fs";
import path from "node:path";

export type PetVariant = "Normal" | "Neon" | "Mega Neon" | "Unknown";
export type Potion = "None" | "Fly" | "Ride" | "Fly Ride" | "Unknown";

export type ValueEntry = {
  petName: string;
  variant: Exclude<PetVariant, "Unknown">;
  potion: Exclude<Potion, "Unknown">;
  frostValue: number;
};

type ValueFile = {
  provider?: string;
  lastUpdated?: string | null;
  entries?: ValueEntry[];
};

export type ValueProvider = {
  status: () => {
    provider: string;
    available: boolean;
    lastUpdated: string | null;
    entryCount: number;
  };
  lookup: (
    petName: string,
    variant: PetVariant,
    potion: Potion,
  ) => number | null;
};

function loadValueFile(): ValueFile {
  const configuredPath = process.env.ELVEBREDD_VALUES_PATH;
  const filePath = configuredPath
    ? path.resolve(configuredPath)
    : path.resolve(process.cwd(), "data/elvebredd-values.json");

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ValueFile;
  } catch {
    return { provider: "Elvebredd import", lastUpdated: null, entries: [] };
  }
}

export function createValueProvider(): ValueProvider {
  const catalog = loadValueFile();
  const entries = catalog.entries ?? [];
  const lookupKey = (petName: string, variant: PetVariant, potion: Potion) =>
    `${petName.trim().toLowerCase()}|${variant}|${potion}`;
  const index = new Map(
    entries.map((entry) => [
      lookupKey(entry.petName, entry.variant, entry.potion),
      entry.frostValue,
    ]),
  );

  return {
    status: () => ({
      provider: catalog.provider ?? "Elvebredd import",
      available: entries.length > 0,
      lastUpdated: catalog.lastUpdated ?? null,
      entryCount: entries.length,
    }),
    lookup: (petName, variant, potion) => {
      if (variant === "Unknown" || potion === "Unknown") return null;
      return index.get(lookupKey(petName, variant, potion)) ?? null;
    },
  };
}
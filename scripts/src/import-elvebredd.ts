import fs from "node:fs";
import path from "node:path";

type ImportEntry = {
  petName: string;
  variant: "Normal" | "Neon" | "Mega Neon";
  potion: "None" | "Fly" | "Ride" | "Fly Ride";
  frostValue: number;
};

type ImportFile = {
  provider?: string;
  lastUpdated?: string | null;
  entries?: ImportEntry[];
};

const sourcePath = process.argv[2];
const destinationPath =
  process.argv[3] ??
  path.resolve(
    process.cwd(),
    "artifacts/api-server/data/elvebredd-values.json",
  );

if (!sourcePath) {
  throw new Error(
    "Usage: pnpm --filter @workspace/scripts run import:elvebredd -- <source.json> [destination.json]",
  );
}

const input = JSON.parse(fs.readFileSync(path.resolve(sourcePath), "utf8")) as ImportFile;
if (!Array.isArray(input.entries)) {
  throw new Error("The source file must contain an entries array.");
}

for (const [index, entry] of input.entries.entries()) {
  if (
    !entry ||
    typeof entry.petName !== "string" ||
    !["Normal", "Neon", "Mega Neon"].includes(entry.variant) ||
    !["None", "Fly", "Ride", "Fly Ride"].includes(entry.potion) ||
    typeof entry.frostValue !== "number" ||
    !Number.isFinite(entry.frostValue) ||
    entry.frostValue < 0
  ) {
    throw new Error(`Invalid value entry at index ${index}.`);
  }
}

const output = {
  provider: input.provider ?? "Elvebredd import",
  lastUpdated: input.lastUpdated ?? new Date().toISOString(),
  entries: input.entries,
};

fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
fs.writeFileSync(destinationPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`Imported ${output.entries.length} verified value entries.\n`);
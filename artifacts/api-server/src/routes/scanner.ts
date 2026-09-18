import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  AnalyzeScannerMediaBody,
  AnalyzeScannerMediaResponse,
  LookupScannerValueBody,
  LookupScannerValueResponse,
} from "@workspace/api-zod";
import {
  createValueProvider,
  type PetVariant,
  type Potion,
} from "../services/value-provider";

const router: IRouter = Router();
const values = createValueProvider();

const visionPrompt = `You identify Adopt Me pets in Roblox screenshots.
Return only JSON with this exact shape:
{"detections":[{"petName":"string","variant":"Normal|Neon|Mega Neon|Unknown","potion":"None|Fly|Ride|Fly Ride|Unknown","confidence":0.0,"evidenceFrame":0}]}

Rules:
- Identify every distinct Adopt Me pet visible across the provided frames.
- Do not count the same pet more than once across frames.
- Use exact pet names only when the visual evidence supports them.
- If the pet name, variant, or potion is not clear, use "Unknown" for that field and lower confidence.
- Confidence is between 0 and 1.
- Do not provide values, explanations, markdown, or any fields other than detections.
- This is vision identification, not OCR. Ignore usernames, chat, item labels, and non-pet UI.`;

type VisionDetection = {
  petName?: unknown;
  variant?: unknown;
  potion?: unknown;
  confidence?: unknown;
  evidenceFrame?: unknown;
};

function asVariant(value: unknown): PetVariant {
  return value === "Normal" ||
    value === "Neon" ||
    value === "Mega Neon" ||
    value === "Unknown"
    ? value
    : "Unknown";
}

function asPotion(value: unknown): Potion {
  return value === "None" ||
    value === "Fly" ||
    value === "Ride" ||
    value === "Fly Ride" ||
    value === "Unknown"
    ? value
    : "Unknown";
}

function asConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

router.get("/scanner/value-status", (_req, res) => {
  res.json(values.status());
});

router.post("/scanner/value-lookup", (req, res) => {
  const parsed = LookupScannerValueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Value lookup payload is invalid." });
    return;
  }

  const { petName, variant, potion } = parsed.data;
  const frostValue = values.lookup(petName, variant, potion);
  const data = LookupScannerValueResponse.parse({
    frostValue,
    valueStatus:
      variant === "Unknown" || potion === "Unknown"
        ? "needs_confirmation"
        : frostValue === null
          ? "unavailable"
          : "verified",
    provider: values.status().provider,
  });
  res.json(data);
});

router.post("/scanner/analyze", async (req, res) => {
  const parsed = AnalyzeScannerMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Upload payload is invalid." });
    return;
  }

  const { frames, mediaType, sourceName } = parsed.data;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: visionPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze these ${mediaType} frame${frames.length === 1 ? "" : "s"} as one source. Deduplicate pets across frames.`,
            },
            ...frames.map((frame, index) => ({
              type: "image_url" as const,
              image_url: { url: frame, detail: "high" as const },
              // The model receives frame order through the surrounding text.
              ...(index === 0 ? {} : {}),
            })),
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Vision provider returned no content.");

    const parsedVision = JSON.parse(content) as {
      detections?: VisionDetection[];
    };
    const seen = new Set<string>();
    const detections = (parsedVision.detections ?? [])
      .map((item, index) => {
        const petName = normalizeName(item.petName);
        const variant = asVariant(item.variant);
        const potion = asPotion(item.potion);
        const confidence = asConfidence(item.confidence);
        const key = `${petName.toLowerCase()}|${variant}|${potion}`;
        if (!petName || seen.has(key)) return null;
        seen.add(key);
        const needsConfirmation =
          confidence < 0.78 ||
          petName.length < 2 ||
          variant === "Unknown" ||
          potion === "Unknown";
        const frostValue = needsConfirmation
          ? null
          : values.lookup(petName, variant, potion);
        return {
          id: `${index}-${key}`,
          petName,
          variant,
          potion,
          confidence,
          needsConfirmation,
          frostValue,
          valueStatus: needsConfirmation
            ? ("needs_confirmation" as const)
            : frostValue === null
              ? ("unavailable" as const)
              : ("verified" as const),
          evidenceFrame:
            typeof item.evidenceFrame === "number" &&
            Number.isInteger(item.evidenceFrame)
              ? Math.max(0, Math.min(frames.length - 1, item.evidenceFrame))
              : 0,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const data = AnalyzeScannerMediaResponse.parse({
      detections,
      totalFrostValue:
        detections.length > 0 &&
        detections.every(
          (detection) => detection.valueStatus === "verified",
        )
          ? detections.reduce(
              (total, detection) => total + (detection.frostValue ?? 0),
              0,
            )
          : null,
      valueDataAvailable: values.status().available,
      valueProvider: values.status().provider,
      analyzedFrames: frames.length,
      sourceName: sourceName ?? null,
    });
    res.json(data);
  } catch (error) {
    req.log.error({ err: error }, "Scanner analysis failed");
    res.status(502).json({
      error: "The vision model could not analyze this upload. Please try again.",
    });
  }
});

export default router;
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";

import { ReasoningCard } from "../src/card";

const outputPath = fileURLToPath(new URL("../card.schema.json", import.meta.url));
const schema = zodToJsonSchema(ReasoningCard, {
  name: "ReasoningCard",
  target: "jsonSchema7",
});

await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Generated ${outputPath}`);
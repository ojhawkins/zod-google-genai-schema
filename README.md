# zod-google-genai-schema

Convert between [Zod](https://zod.dev) schemas and [`@google/genai`](https://www.npmjs.com/package/@google/genai) `Schema` definitions.

Useful when you want to define validation in Zod and reuse it for Google GenAI tool/function schemas, or convert GenAI schemas back into Zod validators.

## Installation

```bash
npm install zod-google-genai-schema
```

`zod` and `@google/genai` are peer dependencies. If they are not already in your app, install them with:

```bash
npm install zod @google/genai
```

## Usage

```ts
import { Type } from "@google/genai";
import { z } from "zod";
import { genAIToZodSchema, zodToGenAISchema } from "zod-google-genai-schema";

// Zod -> Google GenAI Schema
const userInput = z.object({
  name: z.string().describe("Customer name"),
  age: z.number().optional(),
  tags: z.array(z.string()),
});

const schema = zodToGenAISchema(userInput);
// {
//   type: Type.OBJECT,
//   properties: { ... },
//   required: ["name", "tags"]
// }

// Google GenAI Schema -> Zod
const genaiSchema = {
  type: Type.OBJECT,
  properties: {
    action: { type: Type.STRING, enum: ["create", "update"] },
    customerId: { type: Type.STRING },
  },
  required: ["action"],
};

const zodSchema = genAIToZodSchema(genaiSchema);
zodSchema.parse({ action: "create" });
```

## API

### `zodToGenAISchema(schema)`

Converts a Zod schema into a Google GenAI `Schema`.
`z.discriminatedUnion(...)` is intentionally not supported and throws an error. `z.union(...)` is supported for nested properties (`anyOf`), but top-level `anyOf` output is rejected. For top-level parameters, provide a merged object schema.

### `genAIToZodSchema(schema)`

Converts a Google GenAI `Schema` into a Zod schema.

## Development

```bash
npm run build
npm test
```

## License

MIT


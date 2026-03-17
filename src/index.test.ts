import { Type, type Schema } from "@google/genai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { genAIToZodSchema, zodToGenAISchema } from "./index.js";

describe("zodToGenAISchema", () => {
  it("converts primitive top-level schemas", () => {
    expect(zodToGenAISchema(z.string())).toEqual({
      type: Type.STRING,
      description: undefined,
    });
    expect(zodToGenAISchema(z.number())).toEqual({
      type: Type.NUMBER,
      description: undefined,
    });
    expect(zodToGenAISchema(z.boolean())).toEqual({
      type: Type.BOOLEAN,
      description: undefined,
    });
    expect(zodToGenAISchema(z.null())).toEqual({
      type: Type.NULL,
      description: undefined,
    });
  });

  it("converts object shape and required fields", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
      tags: z.array(z.string()),
    });

    const converted = zodToGenAISchema(schema);

    expect(converted).toEqual({
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: undefined },
        age: { type: Type.NUMBER, description: undefined },
        tags: {
          type: Type.ARRAY,
          items: { type: Type.STRING, description: undefined },
          description: undefined,
        },
      },
      required: ["name", "tags"],
      description: undefined,
    });
  });

  it("converts enum and nullable fields", () => {
    const schema = z.object({
      status: z.enum(["draft", "sent"]),
      note: z.string().nullable(),
    });

    const converted = zodToGenAISchema(schema);
    const properties = converted.properties ?? {};

    expect(properties.status).toEqual({
      type: Type.STRING,
      enum: ["draft", "sent"],
      description: undefined,
    });
    expect(properties.note).toEqual({
      type: Type.STRING,
      nullable: true,
      description: undefined,
    });
  });

  it("converts discriminated unions to anyOf", () => {
    const schema = z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("create"),
        name: z.string(),
      }),
      z.object({
        kind: z.literal("update"),
        id: z.string(),
      }),
    ]);

    const converted = zodToGenAISchema(schema);

    expect(converted.anyOf).toBeDefined();
    expect(converted.anyOf).toHaveLength(2);
  });

  it("converts plain unions to anyOf", () => {
    const schema = z.union([z.string(), z.number()]);
    const converted = zodToGenAISchema(schema);

    expect(converted.anyOf).toEqual([
      { type: Type.STRING, description: undefined },
      { type: Type.NUMBER, description: undefined },
    ]);
  });

  it("treats default fields as optional for object required keys", () => {
    const schema = z.object({
      id: z.string(),
      limit: z.number().default(10),
    });

    const converted = zodToGenAISchema(schema);
    expect(converted.required).toEqual(["id"]);
  });

  it("preserves top-level description on wrapped schemas", () => {
    const schema = z
      .string()
      .nullable()
      .optional()
      .describe("Wrapped string description");

    const converted = zodToGenAISchema(schema);

    expect(converted.type).toBe(Type.STRING);
    expect(converted.nullable).toBe(true);
    expect(converted.description).toBe("Wrapped string description");
  });

  it("converts numeric and boolean literals", () => {
    expect(zodToGenAISchema(z.literal(1))).toEqual({
      type: Type.INTEGER,
      enum: ["1"],
      description: undefined,
    });
    expect(zodToGenAISchema(z.literal(true))).toEqual({
      type: Type.BOOLEAN,
      enum: ["true"],
      description: undefined,
    });
  });
});

describe("genAIToZodSchema", () => {
  it("converts object schema with required and optional fields", () => {
    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, enum: ["create", "update"] },
        customerId: { type: Type.STRING },
      },
      required: ["action"],
    };

    const converted = genAIToZodSchema(schema);

    expect(converted.safeParse({ action: "create" }).success).toBe(true);
    expect(converted.safeParse({ action: "update", customerId: "c_1" }).success).toBe(true);
    expect(converted.safeParse({ customerId: "c_1" }).success).toBe(false);
  });

  it("applies numeric and string constraints", () => {
    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        limit: { type: Type.INTEGER, minimum: 1, maximum: 5 },
        email: { type: Type.STRING, format: "email", minLength: "3" },
      },
      required: ["limit", "email"],
    };

    const converted = genAIToZodSchema(schema);

    expect(converted.safeParse({ limit: 3, email: "a@b.com" }).success).toBe(true);
    expect(converted.safeParse({ limit: 0, email: "a@b.com" }).success).toBe(false);
    expect(converted.safeParse({ limit: 3, email: "bad" }).success).toBe(false);
  });

  it("supports anyOf unions", () => {
    const schema: Schema = {
      anyOf: [
        { type: Type.OBJECT, properties: { mode: { type: Type.STRING, enum: ["get"] } }, required: ["mode"] },
        {
          type: Type.OBJECT,
          properties: {
            mode: { type: Type.STRING, enum: ["search"] },
            query: { type: Type.STRING },
          },
          required: ["mode", "query"],
        },
      ],
    };

    const converted = genAIToZodSchema(schema);

    expect(converted.safeParse({ mode: "get" }).success).toBe(true);
    expect(converted.safeParse({ mode: "search", query: "abc" }).success).toBe(true);
    expect(converted.safeParse({ mode: "search" }).success).toBe(false);
  });

  it("supports boolean, null, and constrained arrays", () => {
    const boolSchema = genAIToZodSchema({ type: Type.BOOLEAN });
    expect(boolSchema.safeParse(true).success).toBe(true);
    expect(boolSchema.safeParse("true").success).toBe(false);

    const nullSchema = genAIToZodSchema({ type: Type.NULL });
    expect(nullSchema.safeParse(null).success).toBe(true);
    expect(nullSchema.safeParse("null").success).toBe(false);

    const listSchema = genAIToZodSchema({
      type: Type.ARRAY,
      items: { type: Type.STRING },
      minItems: "1",
      maxItems: "2",
    });
    expect(listSchema.safeParse(["a"]).success).toBe(true);
    expect(listSchema.safeParse([]).success).toBe(false);
    expect(listSchema.safeParse(["a", "b", "c"]).success).toBe(false);
  });

  it("applies string maxLength and pattern", () => {
    const schema = genAIToZodSchema({
      type: Type.STRING,
      maxLength: "5",
      pattern: "^[a-z]+$",
    });

    expect(schema.safeParse("hello").success).toBe(true);
    expect(schema.safeParse("hello!").success).toBe(false);
    expect(schema.safeParse("toolong").success).toBe(false);
  });

  it("supports nullable and description metadata", () => {
    const schema = genAIToZodSchema({
      type: Type.STRING,
      nullable: true,
      description: "Optional display name",
    });

    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse("abc").success).toBe(true);
    expect(schema.description).toBe("Optional display name");
  });
});

describe("round-trip coverage", () => {
  it("round-trips an object schema with optional and nullable fields", () => {
    const original = z.object({
      name: z.string(),
      note: z.string().nullable().optional(),
      tags: z.array(z.string()),
    });

    const genai = zodToGenAISchema(original);
    const roundTripped = genAIToZodSchema(genai);

    expect(roundTripped.safeParse({ name: "a", tags: ["x"] }).success).toBe(true);
    expect(roundTripped.safeParse({ name: "a", note: null, tags: ["x"] }).success).toBe(true);
    expect(roundTripped.safeParse({ tags: ["x"] }).success).toBe(false);
  });

  it("round-trips union schemas", () => {
    const original = z.union([z.string(), z.number()]);
    const roundTripped = genAIToZodSchema(zodToGenAISchema(original));

    expect(roundTripped.safeParse("ok").success).toBe(true);
    expect(roundTripped.safeParse(42).success).toBe(true);
    expect(roundTripped.safeParse(true).success).toBe(false);
  });
});

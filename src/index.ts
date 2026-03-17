import { Type, type Schema } from "@google/genai";
import { z } from "zod";

export type ZodSchema = z.ZodTypeAny;

export function zodToGenAISchema(schema: ZodSchema): Schema {
  const normalized = unwrapWrappers(schema);
  const result = toGoogleSchema(normalized);

  if (schema.description && !result.description) {
    result.description = schema.description;
  }

  return result;
}

export function genAIToZodSchema(schema: Schema): ZodSchema {
  const baseSchema = toZodBaseSchema(schema);
  return applyGenAIMetadata(baseSchema, schema);
}

function toGoogleSchema(schema: ZodSchema): Schema {
  if (schema instanceof z.ZodString) {
    return {
      type: Type.STRING,
      description: schema.description,
    };
  }

  if (schema instanceof z.ZodNumber) {
    return {
      type: Type.NUMBER,
      description: schema.description,
    };
  }

  if (schema instanceof z.ZodBoolean) {
    return {
      type: Type.BOOLEAN,
      description: schema.description,
    };
  }

  if (schema instanceof z.ZodArray) {
    return {
      type: Type.ARRAY,
      items: toGoogleSchema(getArrayElement(schema)),
      description: schema.description,
    };
  }

  if (schema instanceof z.ZodObject) {
    return toGoogleObjectSchema(schema);
  }

  if (schema instanceof z.ZodEnum) {
    return {
      type: Type.STRING,
      enum: getEnumOptions(schema).map((option) => String(option)),
      description: schema.description,
    };
  }

  if (schema instanceof z.ZodLiteral) {
    const literalSchema = toGoogleLiteralSchema(schema);
    if (literalSchema) {
      return literalSchema;
    }
  }

  if (schema instanceof z.ZodUnion) {
    return {
      anyOf: getUnionOptions(schema).map((option) => toGoogleSchema(option)),
      description: schema.description,
    };
  }

  if (schema instanceof z.ZodDiscriminatedUnion) {
    return {
      anyOf: getDiscriminatedUnionOptions(schema).map((option) =>
        toGoogleSchema(option),
      ),
      description: schema.description,
    };
  }

  if (schema instanceof z.ZodNullable) {
    const unwrapped = unwrapNullable(schema);
    return {
      ...toGoogleSchema(unwrapped),
      nullable: true,
      description: schema.description ?? unwrapped.description,
    };
  }

  if (schema instanceof z.ZodNull) {
    return {
      type: Type.NULL,
      description: schema.description,
    };
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return toGoogleSchema(unwrapOptionalLike(schema));
  }

  return {
    type: Type.OBJECT,
    description: schema.description,
  };
}

function unwrapWrappers(schema: ZodSchema): ZodSchema {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return unwrapWrappers(unwrapOptionalLike(schema));
  }
  if (schema instanceof z.ZodNullable) {
    return unwrapWrappers(unwrapNullable(schema)).nullable();
  }
  return schema;
}

function isOptionalLike(schema: ZodSchema): boolean {
  return schema instanceof z.ZodOptional || schema instanceof z.ZodDefault;
}

function unwrapOptionalLike(schema: ZodSchema): ZodSchema {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return unwrapWithInternal(schema);
  }
  return schema;
}

function toZodBaseSchema(schema: Schema): ZodSchema {
  if (schema.anyOf?.length) {
    return z.union(
      schema.anyOf.map((child) => genAIToZodSchema(child)) as [
        ZodSchema,
        ZodSchema,
        ...ZodSchema[],
      ],
    );
  }

  if (schema.type === Type.STRING && schema.enum?.length) {
    return z.enum([schema.enum[0]!, ...schema.enum.slice(1)]);
  }

  switch (schema.type) {
    case Type.STRING:
      return toZodStringSchema(schema);
    case Type.NUMBER:
      return toZodNumberSchema(schema, false);
    case Type.INTEGER:
      return toZodNumberSchema(schema, true);
    case Type.BOOLEAN:
      return z.boolean();
    case Type.ARRAY:
      return toZodArraySchema(schema);
    case Type.OBJECT:
      return toZodObjectSchema(schema);
    case Type.NULL:
      return z.null();
    default:
      return z.unknown();
  }
}

function toZodStringSchema(schema: Schema): ZodSchema {
  let stringSchema = z.string();

  if (schema.minLength !== undefined) {
    stringSchema = stringSchema.min(Number(schema.minLength));
  }
  if (schema.maxLength !== undefined) {
    stringSchema = stringSchema.max(Number(schema.maxLength));
  }
  if (schema.pattern) {
    stringSchema = stringSchema.regex(new RegExp(schema.pattern));
  }
  if (schema.format === "email") {
    stringSchema = stringSchema.email();
  }

  return stringSchema;
}

function toZodNumberSchema(schema: Schema, integer: boolean): ZodSchema {
  let numberSchema = integer ? z.number().int() : z.number();

  if (schema.minimum !== undefined) {
    numberSchema = numberSchema.min(schema.minimum);
  }
  if (schema.maximum !== undefined) {
    numberSchema = numberSchema.max(schema.maximum);
  }

  return numberSchema;
}

function toZodArraySchema(schema: Schema): ZodSchema {
  let arraySchema = z.array(schema.items ? genAIToZodSchema(schema.items) : z.unknown());

  if (schema.minItems !== undefined) {
    arraySchema = arraySchema.min(Number(schema.minItems));
  }
  if (schema.maxItems !== undefined) {
    arraySchema = arraySchema.max(Number(schema.maxItems));
  }

  return arraySchema;
}

function toZodObjectSchema(schema: Schema): ZodSchema {
  const properties = schema.properties ?? {};
  const requiredSet = new Set(schema.required ?? []);
  const shape: Record<string, ZodSchema> = {};

  for (const [key, value] of Object.entries(properties)) {
    const child = genAIToZodSchema(value);
    shape[key] = requiredSet.has(key) ? child : child.optional();
  }

  return z.object(shape);
}

function applyGenAIMetadata(baseSchema: ZodSchema, sourceSchema: Schema): ZodSchema {
  let schema = baseSchema;

  if (sourceSchema.nullable) {
    schema = schema.nullable();
  }
  if (sourceSchema.description) {
    schema = schema.describe(sourceSchema.description);
  }

  return schema;
}

function toGoogleObjectSchema(schema: z.ZodObject<any>): Schema {
  const shape = getObjectShape(schema);
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const field = value as ZodSchema;
    const optional = isOptionalLike(field);
    const unwrapped = unwrapOptionalLike(field);
    properties[key] = toGoogleSchema(unwrapped);

    if (!optional) {
      required.push(key);
    }
  }

  return {
    type: Type.OBJECT,
    properties,
    required: required.length ? required : undefined,
    description: schema.description,
  };
}

function toGoogleLiteralSchema(schema: z.ZodLiteral<any>): Schema | null {
  const literalValue = getLiteralValue(schema);

  if (typeof literalValue === "string") {
    return {
      type: Type.STRING,
      enum: [literalValue],
      description: schema.description,
    };
  }
  if (typeof literalValue === "number") {
    return {
      type: Number.isInteger(literalValue) ? Type.INTEGER : Type.NUMBER,
      enum: [String(literalValue)],
      description: schema.description,
    };
  }
  if (typeof literalValue === "boolean") {
    return {
      type: Type.BOOLEAN,
      enum: [String(literalValue)],
      description: schema.description,
    };
  }

  return null;
}

function getObjectShape(schema: z.ZodObject<any>): Record<string, unknown> {
  return ((schema as any).shape as Record<string, unknown>) ?? {};
}

function getArrayElement(schema: z.ZodArray<any>): ZodSchema {
  return (schema as any).element as ZodSchema;
}

function getEnumOptions(schema: z.ZodEnum<any>): unknown[] {
  return [ ...(((schema as any).options as unknown[]) ?? []) ];
}

function getLiteralValue(schema: z.ZodLiteral<any>): unknown {
  return (schema as any).value as unknown;
}

function getUnionOptions(schema: z.ZodUnion<any>): ZodSchema[] {
  return (((schema as any).options as unknown[]) ?? []) as ZodSchema[];
}

function getDiscriminatedUnionOptions(schema: ZodSchema): ZodSchema[] {
  const options = (schema as any).options;
  if (Array.isArray(options)) {
    return options as ZodSchema[];
  }
  if (options && typeof options.values === "function") {
    return Array.from(options.values()) as ZodSchema[];
  }
  return [];
}

function unwrapNullable(schema: z.ZodNullable<any>): ZodSchema {
  return unwrapWithInternal(schema);
}

function unwrapWithInternal(schema: ZodSchema): ZodSchema {
  return (schema as any).unwrap() as ZodSchema;
}

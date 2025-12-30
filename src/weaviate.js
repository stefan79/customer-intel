import { z } from "zod";
import weaviate, { ApiKey, generateUuid5 } from "weaviate-client";
import { Resource } from "sst";

export async function getClient() {
  const client = await weaviate.connectToWeaviateCloud(
    process.env.WeaviateEndpoint,
    {
      authCredentials: new ApiKey(Resource.WeaviateAPIKey.value),
    }
  );
  return client;
}

export async function fetchObject(client, id, collectionName){
  const uuid = generateUuid5(id)
  const collection = client.collections.use(collectionName)
  const response = await collection.query.fetchObjectById(uuid)
  return response?.properties
}

export async function insertObject(client, objectId, properties, collectionName){
  const collection = client.collections.use(collectionName)
  const id = generateUuid5(objectId)

  const uuid = await collection.data.insert({
    properties,
    id
  })

  return uuid
}


export function unwrapZodType(schema) {
  let current = schema;
  // Unwrap common wrappers to reach the base schema.
  while (true) {
    const typeName = current?._def?.typeName;
    if (typeName === z.ZodFirstPartyTypeKind.ZodOptional) {
      current = current._def.innerType;
      continue;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodNullable) {
      current = current._def.innerType;
      continue;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodDefault) {
      current = current._def.innerType;
      continue;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodEffects) {
      current = current._def.schema;
      continue;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodBranded) {
      current = current._def.type;
      continue;
    }
    return current;
  }
}

function getShape(schema) {
  const shape = schema.shape ?? schema._def.shape;
  return typeof shape === "function" ? shape() : shape;
}

function mapPrimitiveType(schema, options) {
  const typeName = schema._def.typeName;
  if (typeName === z.ZodFirstPartyTypeKind.ZodString) {
    return "text";
  }
  if (typeName === z.ZodFirstPartyTypeKind.ZodNumber) {
    return "number";
  }
  if (typeName === z.ZodFirstPartyTypeKind.ZodBoolean) {
    return "boolean";
  }
  if (typeName === z.ZodFirstPartyTypeKind.ZodDate) {
    return "date";
  }
  if (typeName === z.ZodFirstPartyTypeKind.ZodEnum) {
    return "string";
  }
  if (typeName === z.ZodFirstPartyTypeKind.ZodNativeEnum) {
    return "string";
  }
  if (typeName === z.ZodFirstPartyTypeKind.ZodLiteral) {
    const literalValue = schema._def.value;
    if (typeof literalValue === "string") {
      return "string";
    }
    if (typeof literalValue === "number") {
      return "number";
    }
    if (typeof literalValue === "boolean") {
      return "boolean";
    }
  }
  return null;
}

function mapArrayType(schema, options) {
  const element = unwrapZodType(schema._def.type);
  const elementTypeName = element._def.typeName;
  if (elementTypeName === z.ZodFirstPartyTypeKind.ZodObject) {
    return {
      dataType: "object[]",
      nestedProperties: mapZodToWeaviateProperties(element, options),
    };
  }

  const primitive = mapPrimitiveType(element, options);
  if (!primitive) {
    throw new Error(`Unsupported array element type: ${elementTypeName}`);
  }
  return { dataType: `${primitive}[]` };
}

function mapProperty(name, schema, options) {
  const base = unwrapZodType(schema);
  const typeName = base._def.typeName;
  const description = base._def.description;

  if (typeName === z.ZodFirstPartyTypeKind.ZodObject) {
    return {
      name,
      dataType: "object",
      description,
      nestedProperties: mapZodToWeaviateProperties(base, options),
    };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodArray) {
    const mapped = mapArrayType(base, options);
    return {
      name,
      description,
      ...mapped,
    };
  }

  const primitive = mapPrimitiveType(base, options);
  if (!primitive) {
    throw new Error(`Unsupported Zod type for "${name}": ${typeName}`);
  }

  return {
    name,
    dataType: primitive,
    description,
  };
}

export function mapZodToWeaviateProperties(schema) {
  const base = unwrapZodType(schema);
  const typeName = base?._def?.typeName;
  if (typeName !== z.ZodFirstPartyTypeKind.ZodObject) {
    throw new Error("Expected a Zod object schema at the root.");
  }

  const shape = getShape(base);
  return Object.entries(shape).map(([name, propSchema]) =>
    mapProperty(name, propSchema, {}),
  );
}

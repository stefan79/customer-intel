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

export async function insertObject(client, objectId, properties, collectionName, vectors){
  const collection = client.collections.use(collectionName)
  const id = generateUuid5(objectId)
  const req = {
    properties,
    id
  }

  if(vectors){
    req.vectors = vectors
  }
  

  const uuid = await collection.data.insert(req)

  return uuid
}

export async function linkObject(client, sourceId, targetId, sourcePropertyName, sourceCollectioName){
  const collection = client.collections.use(sourceCollectioName);
  const req = {
    fromUuid: generateUuid5(sourceId),
    fromProperty: sourcePropertyName,
    to: generateUuid5(targetId)
  };

  return await collection.data.referenceAdd(req);

}


export function unwrapZodType(schema) {
  let current = schema;
  // Unwrap common wrappers to reach the base schema.
  let isWrapped = true;
  while (isWrapped) {
    isWrapped = false;
    const typeName = current?._def?.typeName;
    if (typeName === z.ZodFirstPartyTypeKind.ZodOptional) {
      current = current._def.innerType;
      isWrapped = true;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodNullable) {
      current = current._def.innerType;
      isWrapped = true;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodDefault) {
      current = current._def.innerType;
      isWrapped = true;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodEffects) {
      current = current._def.schema;
      isWrapped = true;
    }
    if (typeName === z.ZodFirstPartyTypeKind.ZodBranded) {
      current = current._def.type;
      isWrapped = true;
    }
  }
  return current;
}

function getShape(schema) {
  const shape = schema.shape ?? schema._def.shape;
  return typeof shape === "function" ? shape() : shape;
}

function mapPrimitiveType(schema) {
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

function mapArrayType(schema) {
  const element = unwrapZodType(schema._def.type);
  const elementTypeName = element._def.typeName;
  if (elementTypeName === z.ZodFirstPartyTypeKind.ZodObject) {
    return {
      dataType: "object[]",
      nestedProperties: mapZodToWeaviateProperties(element),
    };
  }

  const primitive = mapPrimitiveType(element);
  if (!primitive) {
    throw new Error(`Unsupported array element type: ${elementTypeName}`);
  }
  return { dataType: `${primitive}[]` };
}

function mapProperty(name, schema) {
  const base = unwrapZodType(schema);
  const typeName = base._def.typeName;
  const description = base._def.description;

  if (typeName === z.ZodFirstPartyTypeKind.ZodObject) {
    return {
      name,
      dataType: "object",
      description,
      nestedProperties: mapZodToWeaviateProperties(base),
    };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodArray) {
    const mapped = mapArrayType(base);
    return {
      name,
      description,
      ...mapped,
    };
  }

  const primitive = mapPrimitiveType(base);
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
    mapProperty(name, propSchema),
  );
}

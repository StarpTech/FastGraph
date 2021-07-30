import {
  DocumentNode,
  visit,
  stripIgnoredCharacters,
  TypeInfo,
  visitWithTypeInfo,
  GraphQLSchema,
  buildSchema,
} from 'graphql'

export function normalizeDocument(document: string): string {
  return stripIgnoredCharacters(document)
}

export const isMutation = (document: DocumentNode): boolean => {
  return document.definitions.some(
    (definition) =>
      definition.kind === 'OperationDefinition' &&
      definition.operation === 'mutation',
  )
}

export function hasIntersectedTypes(
  schemaString: string,
  document: DocumentNode,
  matchingTypes: string[],
): boolean {
  const types = extractTypes(buildSchema(schemaString), document)
  return matchingTypes.some((typeName) => types.has(typeName))
}

export function extractTypes(
  schema: GraphQLSchema,
  ast: DocumentNode,
): Set<string> {
  const types = new Set<string>()

  const typeInfo = new TypeInfo(schema)

  visit(
    ast,
    visitWithTypeInfo(typeInfo, {
      Field() {
        const field = typeInfo.getFieldDef()
        if (field) {
          types.add(field.type.toString())
        }
      },
    }),
  )

  return types
}
import {
  DocumentNode,
  visit,
  stripIgnoredCharacters,
  ArgumentNode,
  ObjectFieldNode,
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

export function hasIntersectedTypes(schemaString: string, document: DocumentNode, matchingTypes: string[]): boolean {
  const types = extractTypes(buildSchema(schemaString), document)
  return matchingTypes.some(typeName => types.has(typeName))
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

export function extractIdsFromQuery(ast: DocumentNode): Set<Number | string> {
  const isIdFieldName = (fieldName: string) =>
    fieldName === 'key' || fieldName === 'id' || fieldName.endsWith('Id')
  const getIdFromArgument = (node: ArgumentNode | ObjectFieldNode) => {
    if (isIdFieldName(node.name.value)) {
      if (
        (node.value.kind === 'IntValue' || node.value.kind === 'StringValue') &&
        node.value.value
      ) {
        return node.value.value
      }
    }
    return undefined
  }

  const idSet = new Set<Number | string>()

  visit(ast, {
    Argument(node) {
      if (node.value.kind === 'ObjectValue') {
        node.value.fields.forEach((field) => {
          if (isIdFieldName(field.name.value)) {
            const id = getIdFromArgument(field)
            if (id) {
              idSet.add(id)
            }
          }
        })
      } else {
        const id = getIdFromArgument(node)
        if (id) {
          idSet.add(id)
        }
      }
    },
  })

  return idSet
}

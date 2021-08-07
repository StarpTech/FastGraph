import {
  DocumentNode,
  visit,
  stripIgnoredCharacters,
  TypeInfo,
  visitWithTypeInfo,
  GraphQLSchema,
  buildClientSchema,
  isScalarType,
  getNamedType,
  BREAK,
  buildSchema,
  FieldDefinitionNode,
  ObjectTypeDefinitionNode,
  InterfaceTypeDefinitionNode,
  UnionTypeDefinitionNode,
} from 'graphql'
import { Headers as HTTPHeaders } from './utils'

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
  schema: GraphQLSchema,
  document: DocumentNode,
  matchingTypes: string[],
): boolean {
  const types = extractTypes(schema, document)
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
          const namedType = getNamedType(field.type)
          const scalar = isScalarType(namedType)
          if (!scalar) {
            types.add(namedType.name)
          }
        }
      },
    }),
  )

  return types
}

export async function fetchSchema(
  introspectionUrl: string,
  headers: Headers = new Headers(),
) {
  const schema = await getClientSchema(introspectionUrl, headers)
  if (schema) {
    return schema
  } else {
    throw new Error('Schema could not updated from introspection endpoint')
  }
}

export const hasAuthDirective = (
  node:
    | FieldDefinitionNode
    | ObjectTypeDefinitionNode
    | InterfaceTypeDefinitionNode
    | UnionTypeDefinitionNode
    | null
    | undefined,
  directiveName: string,
) => {
  return !!node?.directives?.some((d) => d.name.value === directiveName)
}

export function requiresAuth(
  directiveName: string,
  schema: GraphQLSchema,
  ast: DocumentNode,
): boolean {
  const typeInfo = new TypeInfo(schema)
  let result = false

  visit(
    ast,
    visitWithTypeInfo(typeInfo, {
      enter(node) {
        if (node.kind === 'FragmentSpread' || node.kind === 'InlineFragment') {
          const type = typeInfo.getParentType()
          if (type) {
            if (
              type.astNode?.kind === 'InterfaceTypeDefinition' ||
              type.astNode?.kind === 'ObjectTypeDefinition'
            ) {
              result = !!type.astNode?.fields?.some((field) =>
                hasAuthDirective(field, directiveName),
              )
            } else {
              result = hasAuthDirective(type.astNode, directiveName)
            }
          }
        } else if (node.kind === 'Field') {
          const field = typeInfo.getFieldDef()
          if (field) {
            result = hasAuthDirective(field.astNode, directiveName)
          }
        }
        if (result) return BREAK
      },
    }),
  )

  return result
}

export const buildGraphQLSchema = (schema: string) => {
  return buildSchema(schema, {
    noLocation: true,
    assumeValid: true,
    assumeValidSDL: true,
  })
}

export async function getClientSchema(
  introspectionUrl: string,
  headers: Headers,
) {
  headers.set(HTTPHeaders.contentType, 'application/json')
  const resp = await fetch(introspectionUrl, {
    body: JSON.stringify({
      operationName: 'IntrospectionQuery',
      query: introspectionQuery,
    }),
    headers,
    method: 'POST',
  })
  const { data } = await resp.json()
  if (data && !data.errors) {
    return buildClientSchema(data)
  }

  return null
}

// https://github.com/graphql/graphql-js/blob/dd0297302800347a20a192624ba6373ee86836a3/src/utilities/introspectionQuery.js#L14
export const introspectionQuery = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        ...FullType
      }
      directives {
        name
        description
        locations
        args {
          ...InputValue
        }
      }
    }
  }
  fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
      name
      description
      args {
        ...InputValue
      }
      type {
        ...TypeRef
      }
      isDeprecated
      deprecationReason
    }
    inputFields {
      ...InputValue
    }
    interfaces {
      ...TypeRef
    }
    enumValues(includeDeprecated: true) {
      name
      description
      isDeprecated
      deprecationReason
    }
    possibleTypes {
      ...TypeRef
    }
  }
  fragment InputValue on __InputValue {
    name
    description
    type { ...TypeRef }
    defaultValue
  }
  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }
`

import {
  DocumentNode,
  visit,
  stripIgnoredCharacters,
  TypeInfo,
  visitWithTypeInfo,
  GraphQLSchema,
  buildClientSchema,
  validateSchema,
  isScalarType,
  getNamedType,
  BREAK,
  buildSchema,
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

export function requiresAuth(
  directiveName: string,
  schema: GraphQLSchema,
  ast: DocumentNode,
): boolean {
  const typeInfo = new TypeInfo(schema)
  let hasAuthDirective = false

  visit(
    ast,
    visitWithTypeInfo(typeInfo, {
      Field() {
        const field = typeInfo.getFieldDef()
        if (field) {
          hasAuthDirective = !!field.astNode?.directives?.some(
            (d) => d.name.value === directiveName,
          )
          return BREAK
        }
      },
    }),
  )

  return hasAuthDirective
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
    const schema = buildClientSchema(data)
    const errors = validateSchema(schema)

    if (errors.length === 0) {
      return schema
    }
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

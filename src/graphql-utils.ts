import {
  DocumentNode,
  visit,
  stripIgnoredCharacters,
  TypeInfo,
  visitWithTypeInfo,
  GraphQLSchema,
  buildSchema,
  buildClientSchema,
  validateSchema,
  printSchema,
} from 'graphql'
import { save } from './stores/Schema'
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
  types.add('Query') // by default available and can be used as "all" selector

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
  const schema = buildClientSchema(data)
  const validation = validateSchema(schema)

  if (validation.length === 0) {
    return schema
  }

  return null
}

export async function fetchAndStoreSchema(
  introspectionUrl: string,
  headers: Headers,
) {
  const schema = await getClientSchema(introspectionUrl, headers)
  if (schema) {
    await save(printSchema(schema))
  } else {
    console.log('schema is not valid')
  }
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

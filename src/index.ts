import { Router } from 'worktop'
import { listen } from 'worktop/cache'
import { graphql } from './routes/graphql'

const API = new Router()

API.add('POST', '/graphql', graphql)

listen(API.run)

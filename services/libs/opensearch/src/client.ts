import { Client } from '@opensearch-project/opensearch'
import { IOpenSearchConfig } from '@crowd/types'
import { getServiceChildLogger } from '@crowd/logging'

const log = getServiceChildLogger('opensearch.connection')

export const getOpensearchClient = async (config: IOpenSearchConfig): Promise<Client> => {
  let client: Client | undefined

  log.info({ config }, 'Connecting to OpenSearch!')

  if (config.node) {
    if (config.username) {
      client = new Client({
        node: config.node,
        auth: {
          username: config.username,
          password: config.password,
        },
        ssl: {
          rejectUnauthorized: false,
        },
        maxRetries: 5,
        requestTimeout: 60000,
        sniffOnStart: true,
        sniffInterval: 60000,
      })
    }
    client = new Client({
      node: config.node,
    })
  }

  if (!client) {
    throw new Error('Missing node url while initializing opensearch!')
  }

  await client.ping()
  log.info({ config }, 'Connected to OpenSearch!')

  return client
}

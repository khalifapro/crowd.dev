import { DB_CONFIG, OPENSEARCH_CONFIG, REDIS_CONFIG } from '../conf'
import { OpenSearchService, MemberSyncService } from '@crowd/opensearch'
import { DbStore, getDbConnection } from '@crowd/data-access-layer/src/database'
import { getServiceLogger } from '@crowd/logging'
import { getRedisClient } from '@crowd/redis'
import { getClientSQL } from '@crowd/questdb'

const log = getServiceLogger()

const processArguments = process.argv.slice(2)

if (processArguments.length !== 1) {
  log.error('Expected 1 argument: memberIds')
  process.exit(1)
}

const memberIds = processArguments[0].split(',')

setImmediate(async () => {
  const openSearchService = new OpenSearchService(log, OPENSEARCH_CONFIG())

  const redis = await getRedisClient(REDIS_CONFIG(), true)

  const dbConnection = await getDbConnection(DB_CONFIG())
  const store = new DbStore(log, dbConnection)
  const qdb = await getClientSQL()
  const qdbStore = new DbStore(log, qdb)

  const service = new MemberSyncService(redis, store, qdbStore, openSearchService, log)

  for (const memberId of memberIds) {
    await service.removeMember(memberId)
  }

  process.exit(0)
})

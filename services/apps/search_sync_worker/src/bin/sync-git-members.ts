import { DbStore, getDbConnection } from '@crowd/data-access-layer/src/database'
import { MemberRepository } from '@crowd/data-access-layer/src/old/apps/search_sync_worker/member.repo'
import { getServiceLogger } from '@crowd/logging'
import { MemberSyncService, OpenSearchService } from '@crowd/opensearch'
import { getRedisClient } from '@crowd/redis'
import { DB_CONFIG, OPENSEARCH_CONFIG, REDIS_CONFIG } from '../conf'

const log = getServiceLogger()

setImmediate(async () => {
  const openSearchService = new OpenSearchService(log, OPENSEARCH_CONFIG())

  const redis = await getRedisClient(REDIS_CONFIG(), true)

  const dbConnection = await getDbConnection(DB_CONFIG())
  const store = new DbStore(log, dbConnection)

  const repo = new MemberRepository(store, log)
  const service = new MemberSyncService(redis, store, openSearchService, log)

  const results = await repo.getMembersWithGitIdentities()

  if (results.length === 0) {
    log.error(`No members with git identities found!`)
    process.exit(1)
  } else {
    log.info(`Found ${results.length} members with git identities! Triggering sync!`)
    await service.syncMembers(results)
    process.exit(0)
  }
})

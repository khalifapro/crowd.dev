import { DbStore, getDbConnection } from '@crowd/data-access-layer/src/database'
import { MemberRepository } from '@crowd/data-access-layer/src/old/apps/search_sync_worker/member.repo'
import { getServiceLogger } from '@crowd/logging'
import { MemberSyncService, OpenSearchService } from '@crowd/opensearch'
import { getRedisClient } from '@crowd/redis'
import { DB_CONFIG, OPENSEARCH_CONFIG, REDIS_CONFIG } from '../conf'

const log = getServiceLogger()

const BATCH_SIZE = 100
const MAX_RETRIES = 3

async function syncBatch(service: MemberSyncService, members: any[], retryCount = 0) {
  try {
    await service.syncMembers(members)
    log.info(`Successfully synced batch of ${members.length} members`)
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      log.warn(`Error syncing batch, retrying (attempt ${retryCount + 1}): ${error.message}`)
      await syncBatch(service, members, retryCount + 1)
    } else {
      log.error(`Failed to sync batch after ${MAX_RETRIES} attempts: ${error.message}`)
      throw error
    }
  }
}

setImmediate(async () => {
  try {
    const openSearchService = new OpenSearchService(log, OPENSEARCH_CONFIG())
    const redis = await getRedisClient(REDIS_CONFIG(), true)
    const dbConnection = await getDbConnection(DB_CONFIG())
    const store = new DbStore(log, dbConnection)

    const repo = new MemberRepository(store, log)
    const service = new MemberSyncService(redis, store, openSearchService, log)

    // Fetch all members with git identities
    const allMembers = await repo.getMembersWithGitIdentities()

    if (allMembers.length === 0) {
      log.warn('No members with git identities found')
      process.exit(1)
    }

    log.info(`Found ${allMembers.length} members with git identities. Starting batch processing.`)

    // Process members in batches
    for (let i = 0; i < allMembers.length; i += BATCH_SIZE) {
      const batch = allMembers.slice(i, i + BATCH_SIZE)
      await syncBatch(service, batch)
      log.info(
        `Processed ${Math.min(i + BATCH_SIZE, allMembers.length)} out of ${
          allMembers.length
        } members`,
      )
    }

    log.info(`Finished processing a total of ${allMembers.length} members`)
    process.exit(0)
  } catch (error) {
    log.error(`Git members sync failed: ${error.message}`)
    process.exit(1)
  }
})

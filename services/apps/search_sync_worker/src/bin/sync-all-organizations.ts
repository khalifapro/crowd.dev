import { timeout } from '@crowd/common'
import { DbStore, getDbConnection } from '@crowd/data-access-layer/src/database'
import { OrganizationRepository } from '@crowd/data-access-layer/src/old/apps/search_sync_worker/organization.repo'
import { getServiceLogger } from '@crowd/logging'
import { OpenSearchService, OrganizationSyncService } from '@crowd/opensearch'
import { IndexedEntityType } from '@crowd/opensearch/src/repo/indexing.data'
import { IndexingRepository } from '@crowd/opensearch/src/repo/indexing.repo'
import { DB_CONFIG, OPENSEARCH_CONFIG } from '../conf'

const log = getServiceLogger()

const processArguments = process.argv.slice(2)

const MAX_CONCURRENT = 3

setImmediate(async () => {
  const openSearchService = new OpenSearchService(log, OPENSEARCH_CONFIG())

  const dbConnection = await getDbConnection(DB_CONFIG())
  const store = new DbStore(log, dbConnection)

  if (processArguments.includes('--clean')) {
    const indexingRepo = new IndexingRepository(store, log)
    await indexingRepo.deleteIndexedEntities(IndexedEntityType.ORGANIZATION)
  }

  const repo = new OrganizationRepository(store, log)
  const tenantIds = await repo.getTenantIds()

  const service = new OrganizationSyncService(store, openSearchService, log)

  let current = 0
  for (let i = 0; i < tenantIds.length; i++) {
    const tenantId = tenantIds[i]

    while (current == MAX_CONCURRENT) {
      await timeout(1000)
    }

    log.info(`Processing tenant ${i + 1}/${tenantIds.length}`)
    current += 1
    service
      .syncTenantOrganizations(tenantId, 500)
      .then(() => {
        current--
        log.info(`Processed tenant ${i + 1}/${tenantIds.length}`)
      })
      .catch((err) => {
        current--
        log.error(
          err,
          { tenantId },
          `Error syncing organizations for tenant ${i + 1}/${tenantIds.length}!`,
        )
      })
  }

  while (current > 0) {
    await timeout(1000)
  }

  process.exit(0)
})

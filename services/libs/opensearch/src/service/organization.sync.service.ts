import {
  IOrganizationSegmentAggregates,
  getOrgAggregates,
} from '@crowd/data-access-layer/src/activities'
import {
  IOrganizationAggregateData,
  cleanupForOganization,
  insertOrganizationSegments,
} from '@crowd/data-access-layer/src/org_segments'
import { repoQx } from '@crowd/data-access-layer/src/queryExecutor'
import { DbStore } from '@crowd/database'
import { Logger, getChildLogger, logExecutionTime } from '@crowd/logging'
import { IServiceConfig, OpenSearchIndex } from '@crowd/types'
import { IndexedEntityType } from '../repo/indexing.data'
import { IndexingRepository } from '../repo/indexing.repo'
import { IDbOrganizationSyncData } from '../repo/organization.data'
import { OrganizationRepository } from '../repo/organization.repo'
import { SegmentRepository } from '../repo/segment.repo'
import { IPagedSearchResponse, ISearchHit } from './opensearch.data'
import { OpenSearchService } from './opensearch.service'
import { IOrganizationSyncResult } from './organization.sync.data'

/* eslint-disable @typescript-eslint/no-explicit-any */

export class OrganizationSyncService {
  private log: Logger
  private readonly orgRepo: OrganizationRepository
  private readonly segmentRepo: SegmentRepository
  private readonly serviceConfig: IServiceConfig
  private readonly indexingRepo: IndexingRepository

  constructor(
    writeStore: DbStore,
    private readonly openSearchService: OpenSearchService,
    parentLog: Logger,
    serviceConfig: IServiceConfig,
    readStore?: DbStore,
  ) {
    this.log = getChildLogger('organization-sync-service', parentLog)
    this.serviceConfig = serviceConfig

    const store = readStore || writeStore
    this.orgRepo = new OrganizationRepository(store, this.log)
    this.segmentRepo = new SegmentRepository(store, this.log)
    this.indexingRepo = new IndexingRepository(writeStore, this.log)
  }

  public async getAllIndexedTenantIds(
    pageSize = 500,
    afterKey?: string,
  ): Promise<IPagedSearchResponse<string, string>> {
    const include = ['uuid_tenantId']

    const results = await this.openSearchService.search(
      OpenSearchIndex.ORGANIZATIONS,
      undefined,
      {
        uuid_tenantId_buckets: {
          composite: {
            size: pageSize,
            sources: [
              {
                uuid_tenantId: {
                  terms: {
                    field: 'uuid_tenantId',
                  },
                },
              },
            ],
            after: afterKey
              ? {
                  uuid_tenantId: afterKey,
                }
              : undefined,
          },
        },
      },
      undefined,
      undefined,
      undefined,
      include,
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (results as any).uuid_tenantId_buckets

    const newAfterKey = data.after_key?.uuid_tenantId

    const ids = data.buckets.map((b) => b.key.uuid_tenantId)

    return {
      data: ids,
      afterKey: newAfterKey,
    }
  }

  public async cleanupOrganizationIndex(tenantId: string, batchSize = 300): Promise<void> {
    this.log.warn({ tenantId }, 'Cleaning up organization index!')

    const docCount = await this.openSearchService.getDocumentCount(OpenSearchIndex.ORGANIZATIONS)
    this.log.info({ tenantId, docCount }, 'Total documents in organization index!')

    const query = {
      bool: {
        filter: {
          term: {
            uuid_tenantId: tenantId,
          },
        },
      },
    }

    const sort = [{ date_createdAt: 'asc' }]
    const include = ['date_createdAt', 'uuid_organizationId', 'uuid_segmentId']
    const pageSize = 1000
    let lastCreatedAt: string

    let results = (await this.openSearchService.search(
      OpenSearchIndex.ORGANIZATIONS,
      query,
      undefined,
      pageSize,
      sort,
      undefined,
      include,
    )) as ISearchHit<{
      date_createdAt: string
      uuid_organizationId: string
      uuid_segmentId: string
    }>[]

    let processed = 0
    const idsToRemove: string[] = []

    while (results.length > 0) {
      this.log.info(
        { tenantId, toProcess: results.length },
        'Processing organization documents from OpenSearch!',
      )
      const withSegmentIds = results
        .filter((r) => !!r._source.uuid_segmentId)
        .map((r) => r._source.uuid_organizationId)

      // check every organization if they exists in the database and if not remove them from the index
      const dbIds = await this.orgRepo.checkOrganizationsExists(
        tenantId,
        results.map((r) => r._source.uuid_organizationId),
      )

      const toRemove = results
        .filter(
          (r) =>
            !dbIds.includes(r._source.uuid_organizationId) ||
            withSegmentIds.includes(r._source.uuid_organizationId),
        )
        .map((r) => r._id)

      idsToRemove.push(...toRemove)

      // Process bulk removals in chunks
      while (idsToRemove.length >= batchSize) {
        const batch = idsToRemove.splice(0, batchSize)
        this.log.warn(
          { tenantId, docsToRemove: batch.length },
          'Removing organizations from index!',
        )
        await this.openSearchService.bulkRemoveFromIndex(batch, OpenSearchIndex.ORGANIZATIONS)
      }

      if (idsToRemove.length > 0) {
        this.log.warn(
          { tenantId, docsToRemove: idsToRemove.length },
          'Removing organizations from index!',
        )
        await this.openSearchService.bulkRemoveFromIndex(idsToRemove, OpenSearchIndex.ORGANIZATIONS)
      }

      const docCount = await this.openSearchService.getDocumentCount(OpenSearchIndex.ORGANIZATIONS)

      // use last createdAt to get the next page
      lastCreatedAt = results[results.length - 1]._source.date_createdAt

      processed += results.length
      this.log.warn(
        { tenantId, lastCreatedAt, remainingDocs: docCount },
        `Processed ${processed} organizations while cleaning up tenant!`,
      )

      results = (await this.openSearchService.search(
        OpenSearchIndex.ORGANIZATIONS,
        query,
        undefined,
        pageSize,
        sort,
        lastCreatedAt,
        include,
      )) as ISearchHit<{
        date_createdAt: string
        uuid_organizationId: string
        uuid_segmentId: string
      }>[]
    }

    // Remove any remaining IDs that were not processed
    if (idsToRemove.length > 0) {
      this.log.warn({ tenantId, idsToRemove }, 'Removing remaining organizations from index!')
      await this.openSearchService.bulkRemoveFromIndex(idsToRemove, OpenSearchIndex.ORGANIZATIONS)
    }

    this.log.warn(
      { tenantId },
      `Processed total of ${processed} organizations while cleaning up tenant!`,
    )
  }

  public async removeOrganization(organizationId: string): Promise<void> {
    this.log.debug({ organizationId }, 'Removing organization from index!')

    const query = {
      bool: {
        filter: {
          term: {
            uuid_organizationId: organizationId,
          },
        },
      },
    }

    const sort = [{ date_joinedAt: 'asc' }]
    const include = ['date_joinedAt']
    const pageSize = 10
    let lastJoinedAt: string

    let results = (await this.openSearchService.search(
      OpenSearchIndex.ORGANIZATIONS,
      query,
      undefined,
      pageSize,
      sort,
      undefined,
      include,
    )) as ISearchHit<{ date_joinedAt: string }>[]

    while (results.length > 0) {
      const ids = results.map((r) => r._id)
      await this.openSearchService.bulkRemoveFromIndex(ids, OpenSearchIndex.ORGANIZATIONS)

      // use last joinedAt to get the next page
      lastJoinedAt = results[results.length - 1]._source.date_joinedAt
      results = (await this.openSearchService.search(
        OpenSearchIndex.ORGANIZATIONS,
        query,
        undefined,
        pageSize,
        sort,
        lastJoinedAt,
        include,
      )) as ISearchHit<{ date_joinedAt: string }>[]
    }
  }

  public async syncTenantOrganizations(tenantId: string, batchSize = 200): Promise<void> {
    this.log.warn({ tenantId }, 'Syncing all tenant organizations!')
    let docCount = 0
    let organizationCount = 0
    let previousBatchIds: string[] = []
    const now = new Date()

    await logExecutionTime(
      async () => {
        let organizationIds = await this.orgRepo.getTenantOrganizationsForSync(
          tenantId,
          batchSize,
          previousBatchIds,
        )

        while (organizationIds.length > 0) {
          const { organizationsSynced, documentsIndexed } = await this.syncOrganizations(
            organizationIds,
          )

          organizationCount += organizationsSynced
          docCount += documentsIndexed

          const diffInMinutes = (new Date().getTime() - now.getTime()) / 1000 / 60
          this.log.info(
            { tenantId },
            `Synced ${organizationCount} organizations! Speed: ${Math.round(
              organizationCount / diffInMinutes,
            )} organizations/minute!`,
          )

          await this.indexingRepo.markEntitiesIndexed(
            IndexedEntityType.ORGANIZATION,
            organizationIds.map((id) => {
              return {
                id,
                tenantId,
              }
            }),
          )

          previousBatchIds = organizationIds
          organizationIds = await this.orgRepo.getTenantOrganizationsForSync(
            tenantId,
            batchSize,
            previousBatchIds,
          )
        }
      },
      this.log,
      'sync-tenant-organizations',
    )

    this.log.info(
      { tenantId },
      `Synced total of ${organizationCount} organizations with ${docCount} documents!`,
    )
  }

  /**
   * Gets segment specific aggregates of an organization and syncs to opensearch
   * Aggregate data is gathered for each segment in separate sql queries
   * Queries are run in paralel with respect to CONCURRENT_DATABASE_QUERIES constant
   * After all segment aggregates of an organization is gathered, we calculate the
   * aggregates for parent segments and push it to syncStream.
   * SyncStream sends documents to opensearch in bulk with respect to BULK_INDEX_DOCUMENT_BATCH_SIZE
   * @param organizationIds organizationIds to be synced to opensearch
   * @returns
   */
  public async syncOrganizations(organizationIds: string[]): Promise<IOrganizationSyncResult> {
    const syncOrgAggregates = async (organizationIds) => {
      let documentsIndexed = 0
      const organizationIdsToIndex = []
      for (const organizationId of organizationIds) {
        let orgData: IOrganizationSegmentAggregates[]
        try {
          const qx = repoQx(this.orgRepo)
          orgData = await getOrgAggregates(qx, organizationId)
        } catch (e) {
          this.log.error(e, 'Failed to get organization aggregates!')
          throw e
        }

        try {
          await this.orgRepo.transactionally(
            async (txRepo) => {
              const qx = repoQx(txRepo)
              await cleanupForOganization(qx, organizationId)

              if (orgData.length > 0) {
                await insertOrganizationSegments(qx, orgData as IOrganizationAggregateData[])
              }
            },
            undefined,
            true,
          )
          organizationIdsToIndex.push(organizationId)
          documentsIndexed += orgData.length
        } catch (e) {
          this.log.error(e, 'Failed to insert organization aggregates!')
          throw e
        }
      }

      return {
        organizationsSynced: organizationIds.length,
        documentsIndexed,
        organizationIdsToIndex,
      }
    }

    const syncResults = await syncOrgAggregates(organizationIds)

    const syncOrgsToOpensearchForMergeSuggestions = async (organizationIds) => {
      for (const orgId of organizationIds) {
        const data = await this.orgRepo.getOrganizationData(orgId)
        if (data) {
          this.log.error({ orgId, data }, 'Organization not found in database!')
        } else {
          const prefixed = OrganizationSyncService.prefixData(data)
          await this.openSearchService.index(orgId, OpenSearchIndex.ORGANIZATIONS, prefixed)
        }
      }
    }
    await syncOrgsToOpensearchForMergeSuggestions(syncResults.organizationIdsToIndex)

    return syncResults
  }

  public static prefixData(data: IDbOrganizationSyncData): any {
    const p: Record<string, unknown> = {}

    p.uuid_organizationId = data.organizationId
    p.bool_grandParentSegment = data.grandParentSegment ? data.grandParentSegment : false
    p.uuid_tenantId = data.tenantId
    p.obj_address = data.address
    p.string_address = data.address ? JSON.stringify(data.address) : null
    p.string_attributes = data.attributes ? JSON.stringify(data.attributes) : '{}'
    p.date_createdAt = data.createdAt ? new Date(data.createdAt).toISOString() : null
    p.string_description = data.description
    p.string_displayName = data.displayName
    p.keyword_displayName = data.displayName
    p.string_arr_emails = data.emails
    p.string_arr_names = data.names
    p.obj_employeeCountByCountry = data.employeeCountByCountry
    p.int_employees = data.employees
    p.int_founded = data.founded
    p.string_geoLocation = data.geoLocation
    p.string_location = data.location
    p.string_headline = data.headline
    p.keyword_importHash = data.importHash
    p.string_industry = data.industry
    p.string_arr_phoneNumbers = data.phoneNumbers
    p.string_arr_profiles = data.profiles
    p.obj_revenueRange = data.revenueRange
    p.string_size = data.size
    p.string_type = data.type
    p.string_url = data.url
    p.date_lastEnrichedAt = data.lastEnrichedAt ? new Date(data.lastEnrichedAt).toISOString() : null
    p.bool_isTeamOrganization = data.isTeamOrganization ? data.isTeamOrganization : false
    p.bool_manuallyCreated = data.manuallyCreated ? data.manuallyCreated : false
    p.string_logo = data.logo || null
    p.string_immediateParent = data.immediateParent
    p.string_ultimateParent = data.ultimateParent
    p.string_arr_allSubsidiaries = data.allSubsidiaries
    p.string_arr_alternativeNames = data.alternativeNames
    p.float_averageEmployeeTenure = data.averageEmployeeTenure
    p.obj_averageTenureByLevel = data.averageTenureByLevel
    p.obj_averageTenureByRole = data.averageTenureByRole
    p.string_arr_directSubsidiaries = data.directSubsidiaries
    p.obj_employeeChurnRate = data.employeeChurnRate
    p.obj_employeeCountByMonth = data.employeeCountByMonth
    p.obj_employeeGrowthRate = data.employeeGrowthRate
    p.obj_employeeCountByMonthByLevel = data.employeeCountByMonthByLevel
    p.obj_employeeCountByMonthByRole = data.employeeCountByMonthByRole
    p.string_gicsSector = data.gicsSector
    p.obj_grossAdditionsByMonth = data.grossAdditionsByMonth
    p.obj_grossDeparturesByMonth = data.grossDeparturesByMonth
    p.obj_naics = data.naics
    p.string_ticker = data.ticker
    p.string_arr_tags = data.tags
    p.string_arr_manuallyChangedFields = data.manuallyChangedFields

    // identities
    const p_identities = []
    for (const identity of data.identities) {
      p_identities.push({
        string_platform: identity.platform,
        string_value: identity.value,
        keyword_value: identity.value,
        keyword_type: identity.type,
        bool_verified: identity.verified,
        keyword_sourceId: identity.sourceId,
        keyword_integrationId: identity.integrationId,
      })
    }
    p.nested_identities = p_identities

    // aggregate data
    p.date_joinedAt = data.joinedAt ? new Date(data.joinedAt).toISOString() : null
    p.date_lastActive = data.lastActive ? new Date(data.lastActive).toISOString() : null
    p.string_arr_activeOn = data.activeOn
    p.int_activityCount = data.activityCount
    p.int_memberCount = data.memberCount

    return p
  }
}

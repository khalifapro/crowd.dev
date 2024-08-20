import { EDITION, escapeNullByte, isObjectEmpty, singleOrDefault } from '@crowd/common'
import { NodejsWorkerEmitter, SearchSyncWorkerEmitter } from '@crowd/common_services'
import { ConversationService } from '@crowd/conversations'
import { DbStore, arePrimitivesDbEqual } from '@crowd/data-access-layer/src/database'
import {
  IDbActivity,
  IDbActivityUpdateData,
} from '@crowd/data-access-layer/src/old/apps/data_sink_worker/repo/activity.data'
import ActivityRepository from '@crowd/data-access-layer/src/old/apps/data_sink_worker/repo/activity.repo'
import GithubReposRepository from '@crowd/data-access-layer/src/old/apps/data_sink_worker/repo/githubRepos.repo'
import GitlabReposRepository from '@crowd/data-access-layer/src/old/apps/data_sink_worker/repo/gitlabRepos.repo'
import IntegrationRepository from '@crowd/data-access-layer/src/old/apps/data_sink_worker/repo/integration.repo'
import MemberRepository from '@crowd/data-access-layer/src/old/apps/data_sink_worker/repo/member.repo'
import SettingsRepository from '@crowd/data-access-layer/src/old/apps/data_sink_worker/repo/settings.repo'
import { Unleash } from '@crowd/feature-flags'
import { Logger, LoggerBase, getChildLogger } from '@crowd/logging'
import { RedisClient } from '@crowd/redis'
import { ISentimentAnalysisResult, getSentiment } from '@crowd/sentiment'
import { Client as TemporalClient, WorkflowIdReusePolicy } from '@crowd/temporal'
import {
  Edition,
  IActivityData,
  MemberIdentityType,
  PlatformType,
  TemporalWorkflowId,
} from '@crowd/types'
import isEqual from 'lodash.isequal'
import mergeWith from 'lodash.mergewith'
import { TEMPORAL_CONFIG } from '../conf'
import { IActivityCreateData, IActivityUpdateData } from './activity.data'
import MemberService from './member.service'
import MemberAffiliationService from './memberAffiliation.service'

export default class ActivityService extends LoggerBase {
  private readonly conversationService: ConversationService

  constructor(
    private readonly store: DbStore,
    private readonly nodejsWorkerEmitter: NodejsWorkerEmitter,
    private readonly searchSyncWorkerEmitter: SearchSyncWorkerEmitter,
    private readonly redisClient: RedisClient,
    private readonly unleash: Unleash | undefined,
    private readonly temporal: TemporalClient,
    parentLog: Logger,
  ) {
    super(parentLog)

    this.conversationService = new ConversationService(store, this.log)
  }

  public async create(
    tenantId: string,
    segmentId: string,
    activity: IActivityCreateData,
    onboarding: boolean,
    fireSync = true,
  ): Promise<string> {
    try {
      this.log.debug('Creating an activity.')

      const sentiment = await getSentiment(`${activity.body || ''} ${activity.title || ''}`.trim())

      const id = await this.store.transactionally(async (txStore) => {
        const txRepo = new ActivityRepository(txStore, this.log)
        const txSettingsRepo = new SettingsRepository(txStore, this.log)

        await txSettingsRepo.createActivityType(
          tenantId,
          activity.platform as PlatformType,
          activity.type,
          segmentId,
        )

        if (activity.channel) {
          await txSettingsRepo.createActivityChannel(
            tenantId,
            segmentId,
            activity.platform,
            activity.channel,
          )
        }

        const id = await txRepo.create(tenantId, segmentId, {
          type: activity.type,
          timestamp: activity.timestamp.toISOString(),
          platform: activity.platform,
          isContribution: activity.isContribution,
          score: activity.score,
          sourceId: activity.sourceId,
          sourceParentId: activity.sourceParentId,
          tenantId,
          memberId: activity.memberId,
          username: activity.username,
          sentiment,
          attributes: activity.attributes || {},
          body: escapeNullByte(activity.body),
          title: escapeNullByte(activity.title),
          channel: activity.channel,
          url: activity.url,
          organizationId: activity.organizationId,
          objectMemberId: activity.objectMemberId,
          objectMemberUsername: activity.objectMemberUsername,
        })

        return id
      })

      if (EDITION !== Edition.LFX) {
        try {
          const handle = await this.temporal.workflow.start('processNewActivityAutomation', {
            workflowId: `${TemporalWorkflowId.NEW_ACTIVITY_AUTOMATION}/${id}`,
            taskQueue: TEMPORAL_CONFIG().automationsTaskQueue,
            workflowIdReusePolicy: WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
            retry: {
              maximumAttempts: 100,
            },
            args: [
              {
                tenantId,
                activityId: id,
              },
            ],
            searchAttributes: {
              TenantId: [tenantId],
            },
          })
          this.log.info(
            { workflowId: handle.workflowId },
            'Started temporal workflow to process new activity automation!',
          )
        } catch (err) {
          this.log.error(
            err,
            'Error while starting temporal workflow to process new activity automation!',
          )
          throw err
        }
      }

      const affectedIds = await this.conversationService.processActivity(tenantId, segmentId, id)

      if (fireSync) {
        await this.searchSyncWorkerEmitter.triggerMemberSync(
          tenantId,
          activity.memberId,
          onboarding,
          segmentId,
        )
        await this.searchSyncWorkerEmitter.triggerActivitySync(tenantId, id, onboarding)
      }

      if (affectedIds.length > 0) {
        for (const affectedId of affectedIds.filter((i) => i !== id)) {
          await this.searchSyncWorkerEmitter.triggerActivitySync(tenantId, affectedId, onboarding)
        }
      }

      return id
    } catch (err) {
      this.log.error(err, 'Error while creating an activity!')
      throw err
    }
  }

  public async update(
    id: string,
    tenantId: string,
    onboarding: boolean,
    segmentId: string,
    activity: IActivityUpdateData,
    original: IDbActivity,
    fireSync = true,
  ): Promise<void> {
    try {
      const updated = await this.store.transactionally(async (txStore) => {
        const txRepo = new ActivityRepository(txStore, this.log)
        const txSettingsRepo = new SettingsRepository(txStore, this.log)

        const toUpdate = await this.mergeActivityData(activity, original)

        if (toUpdate.type) {
          await txSettingsRepo.createActivityType(
            tenantId,
            original.platform as PlatformType,
            toUpdate.type,
            segmentId,
          )
        }

        if (toUpdate.channel) {
          await txSettingsRepo.createActivityChannel(
            tenantId,
            segmentId,
            original.platform,
            toUpdate.channel,
          )
        }

        if (!isObjectEmpty(toUpdate)) {
          this.log.debug({ activityId: id }, 'Updating activity.')
          await txRepo.update(id, tenantId, segmentId, {
            type: toUpdate.type || original.type,
            isContribution: toUpdate.isContribution || original.isContribution,
            score: toUpdate.score || original.score,
            sourceId: toUpdate.sourceId || original.sourceId,
            sourceParentId: toUpdate.sourceParentId || original.sourceParentId,
            memberId: toUpdate.memberId || original.memberId,
            username: toUpdate.username || original.username,
            sentiment: toUpdate.sentiment || original.sentiment,
            attributes: toUpdate.attributes || original.attributes,
            body: escapeNullByte(toUpdate.body || original.body),
            title: escapeNullByte(toUpdate.title || original.title),
            channel: toUpdate.channel || original.channel,
            url: toUpdate.url || original.url,
            organizationId: toUpdate.organizationId || original.organizationId,
            platform: toUpdate.platform || (original.platform as PlatformType),
          })

          return true
        } else {
          this.log.debug({ activityId: id }, 'No changes to update in an activity.')
          return false
        }
      })

      if (updated) {
        await this.conversationService.processActivity(tenantId, segmentId, id)

        if (fireSync) {
          await this.searchSyncWorkerEmitter.triggerMemberSync(
            tenantId,
            activity.memberId,
            onboarding,
            segmentId,
          )
          await this.searchSyncWorkerEmitter.triggerActivitySync(tenantId, id, onboarding)
        }
      }
    } catch (err) {
      this.log.error(err, { activityId: id }, 'Error while updating an activity!')
      throw err
    }
  }

  private async mergeActivityData(
    data: IActivityUpdateData,
    original: IDbActivity,
  ): Promise<IDbActivityUpdateData> {
    let calcSentiment = false

    let body: string | undefined
    if (!arePrimitivesDbEqual(original.body, data.body)) {
      body = data.body
      calcSentiment = true
    }

    let title: string | undefined
    if (!arePrimitivesDbEqual(original.title, data.title)) {
      title = data.title
      calcSentiment = true
    }

    let sentiment: Promise<ISentimentAnalysisResult | undefined>
    if (calcSentiment) {
      sentiment = getSentiment(`${body || ''} ${title || ''}`.trim())
    } else {
      sentiment = Promise.resolve(undefined)
    }

    let type: string | undefined
    if (!arePrimitivesDbEqual(original.type, data.type)) {
      type = data.type
    }

    let isContribution: boolean | undefined
    if (!arePrimitivesDbEqual(original.isContribution, data.isContribution)) {
      isContribution = data.isContribution
    }

    let score: number | undefined
    if (!arePrimitivesDbEqual(original.score, data.score)) {
      score = data.score
    }

    let sourceId: string | undefined
    if (!arePrimitivesDbEqual(original.sourceId, data.sourceId)) {
      sourceId = data.sourceId
    }

    let sourceParentId: string | undefined
    if (!arePrimitivesDbEqual(original.sourceParentId, data.sourceParentId)) {
      sourceParentId = data.sourceParentId
    }

    let memberId: string | undefined
    if (!arePrimitivesDbEqual(original.memberId, data.memberId)) {
      memberId = data.memberId
    }

    let username: string | undefined
    if (!arePrimitivesDbEqual(original.username, data.username)) {
      username = data.username
    }

    let objectMemberId: string | undefined
    if (!arePrimitivesDbEqual(original.objectMemberId, data.objectMemberId)) {
      objectMemberId = data.objectMemberId
    }

    let objectMemberUsername: string | undefined
    if (!arePrimitivesDbEqual(original.objectMemberUsername, data.objectMemberUsername)) {
      objectMemberUsername = data.objectMemberUsername
    }

    let attributes: Record<string, unknown> | undefined
    if (data.attributes && Object.keys(data.attributes).length > 0) {
      const temp = mergeWith({}, original.attributes, data.attributes)

      if (!isEqual(temp, original.attributes)) {
        attributes = temp
      }
    }

    let channel: string | undefined
    if (!arePrimitivesDbEqual(original.channel, data.channel)) {
      channel = data.channel
    }

    let url: string | undefined
    if (!arePrimitivesDbEqual(original.url, data.url)) {
      url = data.url
    }

    let organizationId: string | undefined
    if (!arePrimitivesDbEqual(original.organizationId, data.organizationId)) {
      organizationId = data.organizationId
    }

    let platform: PlatformType | undefined
    if (!arePrimitivesDbEqual(original.platform, data.platform)) {
      platform = data.platform
    }

    return {
      type,
      isContribution,
      score,
      sourceId,
      sourceParentId,
      memberId,
      username,
      objectMemberId,
      objectMemberUsername,
      sentiment: await sentiment,
      attributes,
      body,
      title,
      channel,
      url,
      organizationId,
      platform,
    }
  }

  public async processActivity(
    tenantId: string,
    integrationId: string,
    onboarding: boolean,
    platform: PlatformType,
    activity: IActivityData,
    providedSegmentId?: string,
  ): Promise<void> {
    this.log = getChildLogger('ActivityService.processActivity', this.log, {
      integrationId,
      tenantId,
      sourceId: activity.sourceId,
    })

    try {
      this.log.debug({ tenantId, integrationId, platform }, 'Processing activity.')

      if (!activity.username && !activity.member) {
        this.log.error(
          { integrationId, platform, activity },
          'Activity does not have a username or member.',
        )
        throw new Error('Activity does not have a username or member.')
      }

      let username = activity.username
      if (!username) {
        const identity = singleOrDefault(
          activity.member.identities,
          (i) => i.platform === platform && i.type === MemberIdentityType.USERNAME,
        )
        if (!identity) {
          this.log.error("Activity's member does not have an identity for the platform.")
          throw new Error(
            `Activity's member does not have an identity for the platform: ${platform}!`,
          )
        }

        username = identity.value
      }

      let member = activity.member
      if (!member) {
        member = {
          identities: [
            {
              platform,
              value: username,
              type: MemberIdentityType.USERNAME,
              verified: true,
            },
          ],
        }
      }

      let objectMemberUsername = activity.objectMemberUsername
      let objectMember = activity.objectMember

      if (objectMember && !objectMemberUsername) {
        const identity = singleOrDefault(
          objectMember.identities,
          (i) => i.platform === platform && i.type === MemberIdentityType.USERNAME,
        )
        if (!identity) {
          this.log.error("Activity's object member does not have an identity for the platform.")
          throw new Error(
            `Activity's object member does not have an identity for the platform: ${platform}!`,
          )
        }

        objectMemberUsername = identity.value
      } else if (objectMemberUsername && !objectMember) {
        objectMember = {
          identities: [
            {
              platform,
              value: objectMemberUsername,
              type: MemberIdentityType.USERNAME,
              verified: true,
            },
          ],
        }
      }

      let memberId: string
      let objectMemberId: string | undefined
      let activityId: string
      let segmentId: string
      let organizationId: string

      await this.store.transactionally(async (txStore) => {
        try {
          const txRepo = new ActivityRepository(txStore, this.log)
          const txMemberRepo = new MemberRepository(txStore, this.log)
          const txMemberService = new MemberService(
            txStore,
            this.nodejsWorkerEmitter,
            this.searchSyncWorkerEmitter,
            this.unleash,
            this.temporal,
            this.redisClient,
            this.log,
          )
          const txActivityService = new ActivityService(
            txStore,
            this.nodejsWorkerEmitter,
            this.searchSyncWorkerEmitter,
            this.redisClient,
            this.unleash,
            this.temporal,
            this.log,
          )
          const txIntegrationRepo = new IntegrationRepository(txStore, this.log)
          const txMemberAffiliationService = new MemberAffiliationService(txStore, this.log)
          const txGithubReposRepo = new GithubReposRepository(txStore, this.log)
          const txGitlabReposRepo = new GitlabReposRepository(txStore, this.log)

          segmentId = providedSegmentId
          if (!segmentId) {
            const dbIntegration = await txIntegrationRepo.findById(integrationId)
            const repoSegmentId = await txGithubReposRepo.findSegmentForRepo(
              tenantId,
              activity.channel,
            )
            const gitlabRepoSegmentId = await txGitlabReposRepo.findSegmentForRepo(
              tenantId,
              activity.channel,
            )

            if (platform === PlatformType.GITLAB && gitlabRepoSegmentId) {
              segmentId = gitlabRepoSegmentId
            } else if (platform === PlatformType.GITHUB && repoSegmentId) {
              segmentId = repoSegmentId
            } else {
              segmentId = dbIntegration.segmentId
            }
          }

          // find existing activity
          const dbActivity = await txRepo.findExisting(
            tenantId,
            segmentId,
            activity.sourceId,
            platform,
            activity.type,
            activity.channel,
          )

          if (dbActivity && dbActivity?.deletedAt) {
            // we found an existing activity but it's deleted - nothing to do here
            this.log.trace(
              { activityId: dbActivity.id },
              'Found existing activity but it is deleted, nothing to do here.',
            )
            return
          }

          let createActivity = false

          if (dbActivity) {
            this.log.trace({ activityId: dbActivity.id }, 'Found existing activity. Updating it.')
            // process member data

            let dbMember = await txMemberRepo.findMemberByUsername(
              tenantId,
              segmentId,
              platform,
              username,
            )
            if (dbMember) {
              // we found a member for the identity from the activity
              this.log.trace({ memberId: dbMember.id }, 'Found existing member.')

              // lets check if it's a match from what we have in the database activity that we got through sourceId
              if (dbActivity.memberId !== dbMember.id) {
                // the memberId from the dbActivity does not match the one we found from the identity
                // we should remove the activity and let it recreate itself with the correct member
                // this is probably a legacy problem before we had weak identities
                this.log.warn(
                  {
                    activityMemberId: dbActivity.memberId,
                    memberId: dbMember.id,
                    activityType: activity.type,
                  },
                  'Exiting activity has a memberId that does not match the memberId for the platform:username identity! Deleting the activity!',
                )

                // delete activity
                await txRepo.delete(dbActivity.id)
                await this.searchSyncWorkerEmitter.triggerRemoveActivity(
                  tenantId,
                  dbActivity.id,
                  onboarding,
                )
                createActivity = true
              }

              // update the member
              await txMemberService.update(
                dbMember.id,
                tenantId,
                onboarding,
                segmentId,
                integrationId,
                {
                  attributes: member.attributes,
                  joinedAt: member.joinedAt
                    ? new Date(member.joinedAt)
                    : new Date(activity.timestamp),
                  identities: member.identities,
                  organizations: member.organizations,
                  reach: member.reach,
                },
                dbMember,
                platform,
                false,
              )

              if (!createActivity) {
                // and use it's member id for the new activity
                dbActivity.memberId = dbMember.id
              }

              memberId = dbMember.id
            } else {
              this.log.trace(
                'We did not find a member for the identity provided! Updating the one from db activity.',
              )
              // we did not find a member for the identity from the activity
              // which is weird since the memberId from the activity points to some member
              // that does not have the identity from the new activity
              // we should add the activity to the member
              // merge member data with the one from the activity and the one from the database
              // leave activity.memberId as is

              dbMember = await txMemberRepo.findById(dbActivity.memberId)
              await txMemberService.update(
                dbMember.id,
                tenantId,
                onboarding,
                segmentId,
                integrationId,
                {
                  attributes: member.attributes,
                  joinedAt: member.joinedAt
                    ? new Date(member.joinedAt)
                    : new Date(activity.timestamp),
                  identities: member.identities,
                  organizations: member.organizations,
                  reach: member.reach,
                },
                dbMember,
                platform,
                false,
              )

              memberId = dbActivity.memberId
            }

            // process object member data
            // existing activity has it but now we don't anymore
            if (dbActivity.objectMemberId && !objectMember) {
              // TODO what to do here?
              throw new Error(
                `Activity ${dbActivity.id} has an object member but newly generated one does not!`,
              )
            }

            if (objectMember) {
              if (dbActivity.objectMemberId) {
                let dbObjectMember = await txMemberRepo.findMemberByUsername(
                  tenantId,
                  segmentId,
                  platform,
                  objectMemberUsername,
                )

                if (dbObjectMember) {
                  // we found an existing object member for the identity from the activity
                  this.log.trace(
                    { objectMemberId: dbObjectMember.id },
                    'Found existing object member.',
                  )

                  // lets check if it's a match from what we have in the database activity that we got through sourceId
                  if (dbActivity.objectMemberId !== dbObjectMember.id) {
                    // the memberId from the dbActivity does not match the one we found from the identity
                    // we should remove the activity and let it recreate itself with the correct member
                    // this is probably a legacy problem before we had weak identities
                    this.log.warn(
                      {
                        activityObjectMemberId: dbActivity.objectMemberId,
                        objectMemberId: dbObjectMember.id,
                        activityType: activity.type,
                      },
                      'Exiting activity has a objectMemberId that does not match the object member for the platform:username identity! Deleting the activity!',
                    )

                    // delete activity
                    await txRepo.delete(dbActivity.id)
                    await this.searchSyncWorkerEmitter.triggerRemoveActivity(
                      tenantId,
                      dbActivity.id,
                      onboarding,
                    )
                    createActivity = true
                  }

                  // update the member
                  await txMemberService.update(
                    dbObjectMember.id,
                    tenantId,
                    onboarding,
                    segmentId,
                    integrationId,
                    {
                      attributes: objectMember.attributes,
                      joinedAt: objectMember.joinedAt
                        ? new Date(objectMember.joinedAt)
                        : new Date(activity.timestamp),
                      identities: objectMember.identities,
                      organizations: objectMember.organizations,
                      reach: member.reach,
                    },
                    dbObjectMember,
                    platform,
                    false,
                  )

                  if (!createActivity) {
                    // and use it's member id for the new activity
                    dbActivity.objectMemberId = dbObjectMember.id
                  }

                  objectMemberId = dbObjectMember.id
                } else {
                  this.log.trace(
                    'We did not find a object member for the identity provided! Updating the one from db activity.',
                  )
                  // we did not find a member for the identity from the activity
                  // which is weird since the memberId from the activity points to some member
                  // that does not have the identity from the new activity
                  // we should add the activity to the member
                  // merge member data with the one from the activity and the one from the database
                  // leave activity.memberId as is

                  dbObjectMember = await txMemberRepo.findById(dbActivity.objectMemberId)
                  await txMemberService.update(
                    dbObjectMember.id,
                    tenantId,
                    onboarding,
                    segmentId,
                    integrationId,
                    {
                      attributes: objectMember.attributes,
                      joinedAt: objectMember.joinedAt
                        ? new Date(objectMember.joinedAt)
                        : new Date(activity.timestamp),
                      identities: objectMember.identities,
                      organizations: objectMember.organizations,
                      reach: member.reach,
                    },
                    dbObjectMember,
                    platform,
                    false,
                  )

                  objectMemberId = dbActivity.objectMemberId
                }
              }
            }

            if (!createActivity) {
              organizationId = await txMemberAffiliationService.findAffiliation(
                dbActivity.memberId,
                segmentId,
                dbActivity.timestamp,
              )

              // just update the activity now
              await txActivityService.update(
                dbActivity.id,
                tenantId,
                onboarding,
                segmentId,
                {
                  type: activity.type,
                  isContribution: activity.isContribution,
                  score: activity.score,
                  sourceId: activity.sourceId,
                  sourceParentId: activity.sourceParentId,
                  memberId: dbActivity.memberId,
                  username,
                  objectMemberId,
                  objectMemberUsername,
                  attributes: activity.attributes || {},
                  body: activity.body,
                  title: activity.title,
                  channel: activity.channel,
                  url: activity.url,
                  organizationId,
                  platform:
                    platform === PlatformType.GITHUB && dbActivity.platform === PlatformType.GIT
                      ? PlatformType.GITHUB
                      : (dbActivity.platform as PlatformType),
                },
                dbActivity,
                false,
              )

              activityId = dbActivity.id
            }

            // release lock for member inside activity exists - this migth be redundant, but just in case
          } else {
            this.log.trace('We did not find an existing activity. Creating a new one.')
            createActivity = true

            // we don't have the activity yet in the database
            // check if we have a member for the identity from the activity
            let dbMember = await txMemberRepo.findMemberByUsername(
              tenantId,
              segmentId,
              platform,
              username,
            )

            // try to find a member by email if verified one is available
            if (!dbMember) {
              const emails = member.identities
                .filter((i) => i.verified && i.type === MemberIdentityType.EMAIL)
                .map((i) => i.value)

              if (emails.length > 0) {
                for (const email of emails) {
                  dbMember = await txMemberRepo.findMemberByEmail(tenantId, email)

                  if (dbMember) {
                    break
                  }
                }
              }
            }

            if (dbMember) {
              this.log.trace({ memberId: dbMember.id }, 'Found existing member.')
              await txMemberService.update(
                dbMember.id,
                tenantId,
                onboarding,
                segmentId,
                integrationId,
                {
                  attributes: member.attributes,
                  joinedAt: member.joinedAt
                    ? new Date(member.joinedAt)
                    : new Date(activity.timestamp),
                  identities: member.identities,
                  organizations: member.organizations,
                  reach: member.reach,
                },
                dbMember,
                platform,
                false,
              )
              memberId = dbMember.id
            } else {
              this.log.trace(
                'We did not find a member for the identity provided! Creating a new one.',
              )
              memberId = await txMemberService.create(
                tenantId,
                onboarding,
                segmentId,
                integrationId,
                {
                  displayName: member.displayName || username,
                  attributes: member.attributes,
                  joinedAt: member.joinedAt
                    ? new Date(member.joinedAt)
                    : new Date(activity.timestamp),
                  identities: member.identities,
                  organizations: member.organizations,
                  reach: member.reach,
                },
                platform,
                false,
              )
            }

            if (objectMember) {
              // we don't have the activity yet in the database
              // check if we have an object member for the identity from the activity

              const dbObjectMember = await txMemberRepo.findMemberByUsername(
                tenantId,
                segmentId,
                platform,
                objectMemberUsername,
              )
              if (dbObjectMember) {
                this.log.trace(
                  { objectMemberId: dbObjectMember.id },
                  'Found existing object member.',
                )
                await txMemberService.update(
                  dbObjectMember.id,
                  tenantId,
                  onboarding,
                  segmentId,
                  integrationId,
                  {
                    attributes: objectMember.attributes,
                    joinedAt: objectMember.joinedAt
                      ? new Date(objectMember.joinedAt)
                      : new Date(activity.timestamp),
                    identities: objectMember.identities,
                    organizations: objectMember.organizations,
                    reach: member.reach,
                  },
                  dbObjectMember,
                  platform,
                  false,
                )
                objectMemberId = dbObjectMember.id
              } else {
                this.log.trace(
                  'We did not find a member for the identity provided! Creating a new one.',
                )
                objectMemberId = await txMemberService.create(
                  tenantId,
                  onboarding,
                  segmentId,
                  integrationId,
                  {
                    displayName: objectMember.displayName || username,
                    attributes: objectMember.attributes,
                    joinedAt: objectMember.joinedAt
                      ? new Date(objectMember.joinedAt)
                      : new Date(activity.timestamp),
                    identities: objectMember.identities,
                    organizations: objectMember.organizations,
                    reach: member.reach,
                  },
                  platform,
                  false,
                )
              }
            }
          }

          if (createActivity) {
            organizationId = await txMemberAffiliationService.findAffiliation(
              memberId,
              segmentId,
              activity.timestamp,
            )

            activityId = await txActivityService.create(
              tenantId,
              segmentId,
              {
                type: activity.type,
                platform,
                timestamp: new Date(activity.timestamp),
                sourceId: activity.sourceId,
                isContribution: activity.isContribution,
                score: activity.score,
                sourceParentId: activity.sourceParentId,
                memberId,
                username,
                objectMemberId,
                objectMemberUsername,
                attributes: activity.attributes || {},
                body: activity.body,
                title: activity.title,
                channel: activity.channel,
                url: activity.url,
                organizationId,
              },
              onboarding,
              false,
            )
          }
        } finally {
          // release locks matter what
        }
      })

      if (memberId) {
        await this.searchSyncWorkerEmitter.triggerMemberSync(
          tenantId,
          memberId,
          onboarding,
          segmentId,
        )
      }
      if (objectMemberId) {
        await this.searchSyncWorkerEmitter.triggerMemberSync(
          tenantId,
          objectMemberId,
          onboarding,
          segmentId,
        )
      }
      if (activityId) {
        await this.searchSyncWorkerEmitter.triggerActivitySync(tenantId, activityId, onboarding)
      }
      if (organizationId) {
        await this.redisClient.sAdd('organizationIdsForAggComputation', organizationId)
      }
    } catch (err) {
      this.log.error(err, 'Error while processing an activity!')
      throw err
    }
  }
}

import { continueAsNew, proxyActivities } from '@temporalio/workflow'

import * as activities from '../activities/merge-members-with-similar-identities'
import * as commonActivities from '../activities/common'

import { IFixVerifiedIdentitiesArgs } from '../types'

const activity = proxyActivities<typeof activities>({
  startToCloseTimeout: '3 minute',
  retry: { maximumAttempts: 3 },
})

const common = proxyActivities<typeof commonActivities>({
  startToCloseTimeout: '3 minute',
  retry: { maximumAttempts: 3 },
})

export async function fixVerifiedIdentities(args: IFixVerifiedIdentitiesArgs): Promise<void> {
  const PROCESS_MEMBERS_PER_RUN = 1000

  const memberIdsToBeSyncedAgain = await activity.findMembersWithIntegrationOrEnrichmentIdentities(
    args.tenantId,
    PROCESS_MEMBERS_PER_RUN,
    args.afterId || undefined,
  )

  if (memberIdsToBeSyncedAgain.length === 0) {
    console.log(`Finished processing!`)
    return
  }

  for (const memberId of memberIdsToBeSyncedAgain) {
    console.log(`Syncing member [${memberId}] to opensearch!`)
    await common.syncMember(memberId)
  }

  await continueAsNew<typeof fixVerifiedIdentities>({
    tenantId: args.tenantId,
    afterId: memberIdsToBeSyncedAgain[memberIdsToBeSyncedAgain.length - 1],
  })
}

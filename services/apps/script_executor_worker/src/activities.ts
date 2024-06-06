import {
  findMembersWithSameVerifiedEmailsInDifferentPlatforms,
  findMembersWithSamePlatformIdentitiesDifferentCapitalization,
  findMembersWithIntegrationOrEnrichmentIdentities,
} from './activities/merge-members-with-similar-identities'

import { findMemberMergeActions } from './activities/dissect-member'

import {
  mergeMembers,
  unmergeMembers,
  waitForTemporalWorkflowExecutionFinish,
  syncMember,
} from './activities/common'

export {
  findMembersWithSameVerifiedEmailsInDifferentPlatforms,
  findMembersWithSamePlatformIdentitiesDifferentCapitalization,
  mergeMembers,
  findMemberMergeActions,
  unmergeMembers,
  waitForTemporalWorkflowExecutionFinish,
  findMembersWithIntegrationOrEnrichmentIdentities,
  syncMember,
}

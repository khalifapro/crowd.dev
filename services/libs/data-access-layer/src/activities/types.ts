/* eslint-disable @typescript-eslint/no-explicit-any */

import { SegmentRawData } from '@crowd/types'

export interface IQueryActivityResult {
  id: string
  attributes: unknown
  body?: string | null
  channel?: string | null
  conversationId?: string | null
  createdAt?: string
  createdById?: string
  isContribution: boolean
  memberId: string
  username: string
  objectMemberId?: string | null
  objectMemberUsername?: string | null
  organizationId?: string | null
  parentId?: string | null
  platform: string
  score: number
  segmentId: string
  sentiment?: IActivitySentiment | null
  sourceId: string
  sourceParentId?: string | null
  tenantId: string
  timestamp: string
  title?: string | null
  type: string
  updatedAt?: string
  updatedById?: string
  url?: string | null

  // TODO questdb: Needed?
  ids?: string[]
  count?: number
}

export interface IActivitySentiment {
  label: string
  sentiment: number
  mixed: number
  neutral: number
  positive: number
  negative: number
}

export interface IQueryActivitiesParameters {
  tenantId?: string
  segmentIds?: string[]
  filter?: any
  orderBy?: string[]
  limit?: number
  noLimit?: boolean
  offset?: number
  countOnly?: boolean
}

export interface IQueryTopActivitiesParameters {
  tenantId: string
  segments?: SegmentRawData[]
  after: Date
  before: Date
  limit: number
}

export interface INumberOfActivitiesPerMember {
  memberId: string
  count: number
}

export interface INumberOfActivitiesPerOrganization {
  organizationId: string
  count: number
}

export interface IQueryDistinctParameters {
  tenantId: string
  after: Date
  before: Date
  limit?: number
}

export interface ActivityType {
  count: number
  type: string
  platform: string
  percentage: string
  platformIcon: string
}

export interface IMemberSegment {
  memberId: string
  segmentId: string
}

export interface IOrganizationSegment {
  organizationId: string
  segmentId: string
}

export interface IOrganizationSegmentAggregates {
  organizationId: string
  segmentId: string
  memberIds: string[]
  memberCount: number
  activityCount: number
  activeOn: string[]
  lastActive: string
  joinedAt: string
}

export interface IActiveMemberData {
  memberId: string
  activityCount: number
  activeDaysCount: number
}

export interface IQueryActiveMembersParameters {
  tenantId: string
  segmentIds: string[]
  timestampFrom: string
  timestampTo: string
  platforms?: string[]
  isContribution?: boolean
  orderBy: 'activityCount' | 'activeDaysCount'
  orderByDirection: 'asc' | 'desc'
  limit: number
  offset: number
}

export interface IActiveOrganizationData {
  organizationId: string
  activityCount: number
  activeDaysCount: number
}

export interface IQueryActiveOrganizationsParameters {
  tenantId: string
  segmentIds: string[]
  timestampFrom: string
  timestampTo: string
  platforms?: string[]
  orderBy: 'activityCount' | 'activeDaysCount'
  orderByDirection: 'asc' | 'desc'
  limit: number
  offset: number
}

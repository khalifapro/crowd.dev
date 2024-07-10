import {
  IOrganizationFullAggregatesOpensearch,
  MemberIdentityType,
  OrganizationIdentityType,
} from '@crowd/types'
import { IDbMemberSyncData } from '../repo/member.data'
import { OpenSearchIndex } from '../types'
import { MemberSyncService } from './member.sync.service'
import { OpenSearchService } from './opensearch.service'
import { OrganizationSyncService } from './organization.sync.service'

export class InitService {
  public static FAKE_TENANT_ID = 'b0e82a13-566f-40e0-b0d0-11fcb6596b0f'
  public static FAKE_SEGMENT_ID = 'ce36b0b0-1fc4-4637-955d-afb8a6b58e48'
  public static FAKE_MEMBER_ID = '9c19e17c-6a07-4f4c-bc9b-ce1fdce9c126'
  public static FAKE_ACTIVITY_ID = 'fa761640-f77c-4340-b56e-bdd0936d852b'
  public static FAKE_CONVERSATION_ID = 'cba1758c-7b1f-4a3c-b6ff-e6f3bdf54c86'
  public static FAKE_ORGANIZATION_ID = 'cba1758c-7b1f-4a3c-b6ff-e6f3bdf54c85'

  constructor(private readonly openSearchService: OpenSearchService) {}

  public async initialize(): Promise<void> {
    await this.openSearchService.initialize()

    await this.createFakeMember()
    await this.createFakeOrganization()
  }

  private async createFakeOrganization(): Promise<void> {
    const fakeOrg: IOrganizationFullAggregatesOpensearch = {
      id: InitService.FAKE_ORGANIZATION_ID,
      tenantId: InitService.FAKE_TENANT_ID,
      noMergeIds: [],
      website: 'test.com',
      ticker: 'FAKE',
      displayName: 'Fake organization',
      industry: 'Fake industry',
      location: 'Unknown City, Unknown Country',
      activityCount: 10,
      identities: [
        {
          platform: 'devto',
          value: 'fakeorg',
          type: OrganizationIdentityType.USERNAME,
          verified: true,
        },
      ],
    }

    const prepared = OrganizationSyncService.prefixData(fakeOrg)
    await this.openSearchService.index(
      `${InitService.FAKE_ORGANIZATION_ID}-${InitService.FAKE_SEGMENT_ID}`,
      OpenSearchIndex.ORGANIZATIONS,
      prepared,
    )
  }

  private async createFakeMember(): Promise<void> {
    // we need to create a fake member to initialize the index with the proper data
    // it will be created in a nonexisting tenant so no one will see it ever
    // if we don't have anything in the index any search by any field will return an error

    const fakeMember: IDbMemberSyncData = {
      id: InitService.FAKE_MEMBER_ID,
      tenantId: InitService.FAKE_TENANT_ID,
      grandParentSegment: false,
      displayName: 'Test Member',
      score: 10,
      lastEnriched: new Date().toISOString(),
      joinedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      reach: {
        total: 20,
      },
      numberOfOpenSourceContributions: 10,
      contributions: [
        {
          id: '112529472',
          url: 'https://github.com/bachman/pied-piper',
          topics: ['compression', 'data', 'middle-out', 'Java'],
          summary: 'Pied Piper: 10 commits in 1 day',
          numberCommits: 10,
          lastCommitDate: '2023-03-10',
          firstCommitDate: '2023-03-01',
        },
      ],

      affiliations: [
        {
          id: '0dfaa9a0-d95a-4397-958e-4727189e3ef8',
          segmentId: 'ce36b0b0-1fc4-4637-955d-afb8a6b58e48',
          segmentSlug: 'test-segment',
          segmentName: 'Test Segment',
          segmentParentName: 'Test Parent Segment',
          organizationId: 'b176d053-c53e-42d2-88d2-6fbc3e34184c',
          organizationName: 'Test Organization',
          organizationLogo: 'https://placehold.co/400',
          dateStart: new Date().toISOString(),
          dateEnd: new Date().toISOString(),
        },
      ],

      identities: [
        {
          platform: 'devto',
          value: 'Test Member',
          type: MemberIdentityType.USERNAME,
          verified: true,
          sourceId: null,
          integrationId: null,
        },
        {
          platform: 'github',
          value: 'fakeWeakIdentity',
          type: MemberIdentityType.USERNAME,
          verified: false,
          sourceId: null,
          integrationId: null,
        },
        {
          platform: 'github',
          value: 'test@email.com',
          type: MemberIdentityType.EMAIL,
          verified: true,
          sourceId: null,
          integrationId: null,
        },
      ],
      organizations: [
        {
          id: '0dfaa9a0-d95a-4397-958e-4727189e3ef8',
          logo: 'https://placehold.co/400',
          displayName: 'Test Organization',
          memberOrganizations: {
            title: 'blabla',
            dateStart: new Date().toISOString(),
            dateEnd: new Date().toISOString(),
          },
        },
      ],
      tags: [
        {
          id: 'bced635d-acf7-4b68-a95d-872729e09d58',
          name: 'fake tag',
        },
      ],
      toMergeIds: ['3690742c-c5de-4d9a-aef8-1e3eaf57233d'],
      noMergeIds: ['b176d053-c53e-42d2-88d2-6fbc3e34184c'],
      notes: [
        {
          id: 'b176d053-c53e-42d2-88d2-6fbc3e34184c',
          body: 'This is a fake note 1',
        },
      ],
      tasks: [
        {
          id: 'b176d053-c53e-42d2-88d2-6fbc3e34184c',
          name: 'Fake Task 1',
          body: 'This is a fake task 1',
          status: 'completed',
          dueDate: new Date().toISOString(),
          type: 'type1',
        },
      ],
      attributes: {},
      manuallyCreated: false,
    }

    const aggregates: IMemberSegmentAggregates = {
      memberId: InitService.FAKE_MEMBER_ID,
      segmentId: InitService.FAKE_SEGMENT_ID,
      activeOn: ['devto'],
      activityCount: 10,
      activityTypes: ['devto:comment'],
      activeDaysCount: 20,
      lastActive: new Date().toISOString(),
      averageSentiment: 20.32,
    }

    const prepared = MemberSyncService.prefixData(fakeMember, aggregates, [])
    await this.openSearchService.index(
      `${InitService.FAKE_MEMBER_ID}-${InitService.FAKE_SEGMENT_ID}`,
      OpenSearchIndex.MEMBERS,
      prepared,
    )
  }
}

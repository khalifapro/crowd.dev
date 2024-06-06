export interface ISimilarMember {
  primaryMemberId: string
  secondaryMemberId: string
  primaryMemberIdentityValue: string
  secondaryMemberIdentityValue: string
  hash: number
}

export interface IFindMemberMergeActionReplacement {
  memberId: string
  startDate?: string
  endDate?: string
  userId?: string
}

export interface IMemberId {
  memberId: string
}

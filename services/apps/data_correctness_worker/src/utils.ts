import { ILLMConsumableOrganization, ILLMConsumableOrganizationDbResult } from '@crowd/types'

export const prepareOrganizationData = (
  organization: ILLMConsumableOrganizationDbResult,
): ILLMConsumableOrganization => {
  return {
    displayName: organization.displayName,
    description: organization.description,
    phoneNumbers: organization.phoneNumbers,
    logo: organization.logo,
    tags: organization.tags,
    location: organization.location,
    type: organization.type,
    geoLocation: organization.geoLocation,
    ticker: organization.ticker,
    profiles: organization.profiles,
    headline: organization.headline,
    industry: organization.industry,
    founded: organization.founded,
    alternativeNames: organization.alternativeNames,
    identities: organization.identities.map((i) => ({
      id: `${i.platform}:${i.value}`,
      platform: i.platform,
      value: i.platform === 'linkedin' ? i.value.split(':').pop() : i.value,
    })),
  }
}

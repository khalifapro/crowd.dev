/**
 * Tenant Mode
 * multi: Allow new users to create new tenants.
 * multi-with-subdomain: Same as multi, but enable access to the tenant via subdomain.
 * single: One tenant, the first user to register will be the admin.
 */
const tenantMode = 'multi'

/**
 * Plan payments configuration.
 */
const isPlanEnabled = true

const defaultConfig = {
  frontendUrl: {
    host: import.meta.env.VUE_APP_FRONTEND_HOST,
    protocol: import.meta.env.VUE_APP_FRONTEND_PROTOCOL
  },
  backendUrl: import.meta.env.VUE_APP_BACKEND_URL,
  websocketsUrl: import.meta.env.VUE_APP_WEBSOCKETS_URL,
  tenantMode,
  isPlanEnabled,
  gitHubInstallationUrl:
    import.meta.env.VUE_APP_GITHUB_INSTALLATION_URL,
  discordInstallationUrl:
    import.meta.env.VUE_APP_DISCORD_INSTALLATION_URL,
  cubejsUrl: import.meta.env.VUE_APP_CUBEJS_URL,
  conversationPublicUrl:
    import.meta.env.VUE_APP_CONVERSATIONS_PUBLIC_URL,
  edition: import.meta.env.VUE_APP_EDITION,
  communityPremium: import.meta.env.VUE_APP_COMMUNITY_PREMIUM,
  env: import.meta.env.VUE_APP_ENV,
  hotjarKey: import.meta.env.VUE_APP_HOTJAR_KEY,
  pizzlyUrl: import.meta.env.VUE_APP_PIZZLY_URL,
  pizzlyPublishableKey:
    import.meta.env.VUE_APP_PIZZLY_PUBLISHABLE_KEY,
  typeformId: import.meta.env.VUE_APP_TYPEFORM_ID,
  typeformTitle: import.meta.env.VUE_APP_TYPEFORM_TITLE,
  posthog: {
    apiKey: import.meta.env.VUE_APP_POSTHOG_API_KEY,
    host: import.meta.env.VUE_APP_POSTHOG_HOST
  },
  formbricks: {
    url: import.meta.env.VUE_APP_FORMBRICKS_URL,
    formId: import.meta.env.VUE_APP_FORMBRICKS_FORM_ID,
    pmfFormId: import.meta.env.VUE_APP_FORMBRICKS_PMF_FORM_ID
  },
  stripe: {
    publishableKey:
      import.meta.env.VUE_APP_STRIPE_PUBLISHABLE_KEY || '',
    growthPlanPaymentLink:
      import.meta.env.VUE_APP_STRIPE_GROWTH_PLAN_PAYMENT_LINK ||
      '',
    customerPortalLink:
      import.meta.env.VUE_APP_STRIPE_CUSTOMER_PORTAL_LINK || ''
  }
}

const composedConfig = {
  frontendUrl: {
    host: 'CROWD_VUE_APP_FRONTEND_HOST',
    protocol: 'CROWD_VUE_APP_FRONTEND_PROTOCOL'
  },
  backendUrl: 'CROWD_VUE_APP_BACKEND_URL',
  websocketsUrl: 'CROWD_VUE_APP_WEBSOCKETS_URL',
  tenantMode,
  isPlanEnabled,
  gitHubInstallationUrl:
    'CROWD_VUE_APP_GITHUB_INSTALLATION_URL',
  discordInstallationUrl:
    'CROWD_VUE_APP_DISCORD_INSTALLATION_URL',
  cubejsUrl: 'CROWD_VUE_APP_CUBEJS_URL',
  conversationPublicUrl:
    'CROWD_VUE_APP_CONVERSATIONS_PUBLIC_URL',
  edition: 'CROWD_VUE_APP_EDITION',
  communityPremium: 'CROWD_VUE_APP_COMMUNITY_PREMIUM',
  env: 'CROWD_VUE_APP_ENV',
  hotjarKey: 'CROWD_VUE_APP_HOTJAR_KEY',
  pizzlyUrl: 'CROWD_VUE_APP_PIZZLY_URL',
  pizzlyPublishableKey:
    'CROWD_VUE_APP_PIZZLY_PUBLISHABLE_KEY',
  typeformId: 'CROWD_VUE_APP_TYPEFORM_ID',
  typeformTitle: 'CROWD_VUE_APP_TYPEFORM_TITLE',
  posthog: {
    apiKey: 'CROWD_VUE_APP_POSTHOG_API_KEY',
    host: 'CROWD_VUE_APP_POSTHOG_HOST'
  },
  formbricks: {
    url: 'CROWD_VUE_APP_FORMBRICKS_URL',
    formId: 'CROWD_VUE_APP_FORMBRICKS_FORM_ID',
    pmfFormId: 'CROWD_VUE_APP_FORMBRICKS_PMF_FORM_ID'
  },
  stripe: {
    publishableKey:
      'CROWD_VUE_APP_STRIPE_PUBLISHABLE_KEY' || '',
    growthPlanPaymentLink:
      'CROWD_VUE_APP_STRIPE_GROWTH_PLAN_PAYMENT_LINK' || '',
    customerPortalLink:
      'CROWD_VUE_APP_STRIPE_CUSTOMER_PORTAL_LINK' || ''
  }
}

const config = defaultConfig.backendUrl
  ? defaultConfig
  : composedConfig

config.isCommunityVersion = config.edition === 'community'
config.hasPremiumModules =
  !config.isCommunityVersion ||
  config.communityPremium === 'true'

export default config

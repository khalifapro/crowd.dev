import { getDbConnection } from '@crowd/data-access-layer/src/database'
import { DB_CONFIG } from '../conf'
import { websiteNormalizer } from '@crowd/common'

/* eslint-disable @typescript-eslint/no-explicit-any */

function toText(record: any): string {
  return `${record.organizationId}\t${record.platform}\t${record.type}\t${record.verified}\t${record.value}`
}

setImmediate(async () => {
  const dbConnection = await getDbConnection(DB_CONFIG())

  let page = 1
  const perPage = 500

  const query = `
    select * from "organizationIdentities"
    where "tenantId" = '875c38bd-2b1b-4e91-ad07-0cfbabb4c49f'
    and type in ('primary-domain', 'alternative-domain')
    limit $(limit) offset $(offset);
  `

  let results = await dbConnection.any(query, {
    limit: perPage,
    offset: (page - 1) * perPage,
  })

  console.log('organizationId\tplatform\ttype\tverified\tvalue')
  while (results.length > 0) {
    for (const result of results) {
      if (result.value !== result.value.trim()) {
        console.log('[trim]\n', toText(result))
      } else if (result.value !== result.value.toLowerCase()) {
        console.log('[case]\n', toText(result))
      } else if (result.value !== result.value.trim().toLowerCase()) {
        console.log('[trimcase]\n', toText(result))
      } else {
        const normalized = websiteNormalizer(result.value, false)
        if (normalized === undefined) {
          console.log('[invalid]\n', toText(result))
        } else if (normalized !== result.value) {
          console.log('[normalize]\n', toText(result))
        }
      }
    }

    page += 1
    results = await dbConnection.any(query, {
      limit: perPage,
      offset: (page - 1) * perPage,
    })
  }
})

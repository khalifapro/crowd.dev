import { DbConnection } from '@crowd/database'
import { getDbConnection } from '@crowd/data-access-layer/src/database'
import { DB_CONFIG } from '../conf'
import { timeout, websiteNormalizer } from '@crowd/common'
import { platform } from 'os'

/* eslint-disable @typescript-eslint/no-explicit-any */

function toText(record: any): string {
  return `${record.organizationId}\t${record.platform}\t${record.type}\t${record.verified}\t${record.value}`
}

async function tryUpdate(conn: DbConnection, record: any, value): Promise<void> {
  try {
    await conn.none(
      `
      update "organizationIdentities"
      set value = $(newValue)
      where "organizationId" = $(organizationId) and
            platform = $(platform) and 
            type = $(type) and
            verified = $(verified) and
            value = $(value)
      `,
      {
        newValue: value,
        organizationId: record.organizationId,
        platform: record.platform,
        type: record.type,
        verified: record.verified,
        value: record.value,
      },
    )
  } catch (err) {
    console.error('Failed to update record!', err)
    await timeout(500)
  }
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
      let newValue: string | undefined = undefined
      if (result.value !== result.value.trim()) {
        console.log('[trimming]\n', toText(result))
        newValue = result.value.trim()
      } else if (result.value !== result.value.toLowerCase()) {
        console.log('[casing]\n', toText(result))
        newValue = result.value.toLowerCase()
      } else if (result.value !== result.value.trim().toLowerCase()) {
        console.log('[trimcasing]\n', toText(result))
        newValue = result.value.trim().toLowerCase()
      } else {
        const normalized = websiteNormalizer(result.value, false)
        if (normalized === undefined) {
          console.log('[invalid]\n', toText(result))
        } else if (normalized !== result.value) {
          console.log(`[normalizing] ${normalized}\n`, toText(result))
          newValue = normalized
        }
      }

      if (newValue) {
        await tryUpdate(dbConnection, result, result.value.trim())
      }
    }

    page += 1
    results = await dbConnection.any(query, {
      limit: perPage,
      offset: (page - 1) * perPage,
    })
  }
})

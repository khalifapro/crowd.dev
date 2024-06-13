import { DbConnection } from '@crowd/database'
import { getDbConnection } from '@crowd/data-access-layer/src/database'
import { DB_CONFIG } from '../conf'
import { websiteNormalizer } from '@crowd/common'
import { promises as fs } from 'fs'

/* eslint-disable @typescript-eslint/no-explicit-any */

function toText(record: any): string {
  return `${record.organizationId},${record.platform},${record.type},${record.verified},"${record.value}"`
}

async function tryUpdate(conn: DbConnection, record: any, value): Promise<boolean> {
  try {
    console.log('updating value from ', record.value, ' to ', value)
    const result = await conn.result(
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

    if (result.rowCount !== 1) {
      console.error('ERROR!!!!!!!  Failed to update record!', result)
      return false
    }

    console.log(record.value, ' updated to ', value)
    return true
  } catch (err) {
    return false
  }
}

async function printToFile(file: string, text: string, restart = false): Promise<void> {
  try {
    if (restart) {
      // Write the text to the file, overwriting any existing content
      await fs.writeFile(file, text + '\n')
    } else {
      try {
        // Append the text to the file, creating it if it doesn't exist
        await fs.appendFile(file, text + '\n')
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          // If the file does not exist, create it and write the text
          await fs.writeFile(file, text + '\n')
        } else {
          // Re-throw any other errors
          throw err
        }
      }
    }
  } catch (err) {
    console.error(`Error handling the file ${file}:`, err)
    throw err
  }
}

setImmediate(async () => {
  await printToFile('invalid-domains.csv', 'organizationId,platform,type,verified,value', true)
  await printToFile('wont-update.csv', 'organizationId,platform,type,verified,value,newValue', true)
  const dbConnection = await getDbConnection(DB_CONFIG())

  let count = 0
  let updatedCount = 0
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

  while (results.length > 0) {
    for (const result of results) {
      let newValue = result.value
      if (newValue !== result.value.trim()) {
        console.log('[trimming]\n', toText(result))
        newValue = result.value.trim()
      }
      if (newValue !== result.value.toLowerCase()) {
        console.log('[casing]\n', toText(result))
        newValue = result.value.toLowerCase()
      }

      const normalized = websiteNormalizer(newValue, false)
      if (normalized === undefined) {
        console.log('[invalid]\n', toText(result))
        await printToFile('invalid-domains.csv', toText(result))
      } else if (normalized !== result.value) {
        console.log(`[normalizing] ${normalized}\n`, toText(result))
        newValue = normalized
      }

      if (newValue !== result.value) {
        const success = await tryUpdate(dbConnection, result, newValue)
        if (success) {
          updatedCount += 1
        } else {
          await printToFile('wont-update.csv', toText(result) + ',' + newValue)
        }
      }

      count += 1
    }

    console.log(
      '\n\n\n\n\n############## Processed',
      count,
      'records and updated',
      updatedCount,
      'values\n\n\n\n\n',
    )

    page += 1
    results = await dbConnection.any(query, {
      limit: perPage,
      offset: (page - 1) * perPage,
    })
  }
  process.exit(0)
})

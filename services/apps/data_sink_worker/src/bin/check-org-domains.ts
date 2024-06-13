import { DbTransaction, getDbConnection } from '@crowd/data-access-layer/src/database'
import { DB_CONFIG } from '../conf'
import { websiteNormalizer } from '@crowd/common'
import { promises as fs } from 'fs'

/* eslint-disable @typescript-eslint/no-explicit-any */

function toText(record: any): string {
  return `${record.organizationId},${record.platform},${record.type},${record.verified},"${record.value}"`
}

async function findExisting(
  conn: DbTransaction,
  record: any,
  newValue: string,
): Promise<any | null> {
  const result = await conn.oneOrNone(
    `
    select * from "organizationIdentities"
    where "tenantId" = $(tenantId) and
          platform = $(platform) and
          type = $(type) and
          verified = $(verified) and
          value = $(value)
    `,
    {
      tenantId: record.tenantId,
      platform: record.platform,
      type: record.type,
      verified: record.verified,
      value: newValue,
    },
  )

  return result
}

async function updateIdentityValue(conn: DbTransaction, record: any, value: string): Promise<void> {
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

  if (result.rowCount > 1) {
    throw new Error('Updated more than one record!')
  }

  if (result.rowCount === 0) {
    throw new Error('No record updated!')
  }
}

async function removeIdentity(conn: DbTransaction, record: any): Promise<void> {
  const result = await conn.result(
    `
    delete "organizationIdentities"
    where "organizationId" = $(organizationId) and
          platform = $(platform) and 
          type = $(type) and
          verified = $(verified) and
          value = $(value)
    `,
    {
      organizationId: record.organizationId,
      platform: record.platform,
      type: record.type,
      verified: record.verified,
      value: record.value,
    },
  )

  if (result.rowCount > 1) {
    throw new Error('Deleted more than one record!')
  }

  if (result.rowCount === 0) {
    throw new Error('No record deleted!')
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
  await printToFile(
    'to-merge.csv',
    'organizationId,platform,type,verified,value,toMergeId,toMergeValue,toMergeNewValue',
    true,
  )
  const dbConnection = await getDbConnection(DB_CONFIG())

  let count = 0
  let updatedCount = 0
  let deletedCount = 0
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
        newValue = result.value
      } else if (normalized !== result.value) {
        console.log(`[normalizing] ${normalized}\n`, toText(result))
        newValue = normalized
      }

      if (newValue !== result.value) {
        await dbConnection.tx(async (t: DbTransaction) => {
          if (result.verified === true) {
            // check if identity already exists with the newValue as value
            const existing = await findExisting(t, result, newValue)
            if (existing === null) {
              // if it doesn't we can just update the current one
              await updateIdentityValue(t, result, newValue)
              updatedCount += 1
            } else if (existing.organizationId === result.organizationId) {
              // delete it because the same org already has the same identity that we are trying to update
              await removeIdentity(t, result)
              deletedCount += 1
            } else if (existing.organizationId !== result.organizationId) {
              // set to merge two orgs because they are about to share the same identity with the newValue
              await printToFile(
                'to-merge.csv',
                `${toText(existing)},${result.organizationId},${result.value},${newValue}`,
              )
            }
          } else {
            const existing = await findExisting(t, result, newValue)
            if (existing === null) {
              await updateIdentityValue(t, result, newValue)
              updatedCount += 1
            } else if (existing.organizationId === result.organizationId) {
              // just remove the value since the value we are trying to set already belongs to the same org
              await removeIdentity(t, result)
              deletedCount += 1
            } else if (existing.organizationId !== result.organizationId) {
              // since it's unverified it's ok to just set the value since two orgs can have the same unverified identities
              await updateIdentityValue(t, result, newValue)
              updatedCount += 1
            }
          }
        })
      }

      count += 1
    }

    console.log(
      '\n\n\n\n\n############## Processed',
      count,
      'records, updated',
      updatedCount,
      'values, deleted',
      deletedCount,
      ' identities\n\n\n\n\n',
    )

    page += 1
    results = await dbConnection.any(query, {
      limit: perPage,
      offset: (page - 1) * perPage,
    })
  }
  process.exit(0)
})

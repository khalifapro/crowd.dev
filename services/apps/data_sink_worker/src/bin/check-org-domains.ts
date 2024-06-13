import { DbTransaction, getDbConnection } from '@crowd/data-access-layer/src/database'
import { DB_CONFIG } from '../conf'
import { websiteNormalizer } from '@crowd/common'
import { promises as fs } from 'fs'

/* eslint-disable @typescript-eslint/no-explicit-any */

function toText(record: any): string {
  return `${record.organizationId},${record.platform},${record.type},${record.verified},"${record.value}"`
}

async function findLfxMembershipStatus(
  conn: DbTransaction,
  organizationIds: string[],
): Promise<any> {
  if (organizationIds.length === 0) {
    throw new Error('No organization ids provided!')
  }

  const results = await conn.any(
    `select * from "lfxMemberships" where "organizationId" in ($(organizationIds:csv))`,
    { organizationIds },
  )

  const data = {}

  for (const orgId of organizationIds) {
    const result = results.find((r) => r.organizationId === orgId)

    if (result) {
      data[orgId] = true
    } else {
      data[orgId] = false
    }
  }

  return data
}

async function getActivityCounts(conn: DbTransaction, organizationIds: string[]): Promise<any> {
  if (organizationIds.length === 0) {
    throw new Error('No organization ids provided!')
  }

  const results = await conn.any(
    `
    select "organizationId", count(*) as count
    from activities
    where "deletedAt" is null
      and "organizationId" in ($(organizationIds:csv))
    group by "organizationId";
    `,
    {
      organizationIds,
    },
  )

  const data = {}

  for (const orgId of organizationIds) {
    const result = results.find((r) => r.organizationId === orgId)

    if (result) {
      data[orgId] = result.count
    } else {
      data[orgId] = 0
    }
  }

  return data
}

async function mergeSuggestion(
  conn: DbTransaction,
  primaryId: string,
  secondaryId: string,
): Promise<void> {
  await conn.none(
    `
    insert into "organizationToMerge"("createdAt", "updatedAt", "organizationId", "toMergeId", similarity, status)
    values(now(), now(), $(primaryId), $(secondaryId), 0.95, 'ready')
    on conflict do nothing;
    `,
    {
      primaryId,
      secondaryId,
    },
  )
}

async function findExisting(conn: DbTransaction, record: any, newValue: string): Promise<any[]> {
  const results = await conn.any(
    `
    select oi.* from "organizationIdentities" oi
    where oi."tenantId" = $(tenantId) and
          oi.platform = $(platform) and
          oi.type = $(type) and
          oi.verified = $(verified) and
          oi.value = $(value)
    `,
    {
      tenantId: record.tenantId,
      platform: record.platform,
      type: record.type,
      verified: record.verified,
      value: newValue,
    },
  )

  return results
}

async function updateIdentityValueAndUnverify(
  conn: DbTransaction,
  record: any,
  value: string,
): Promise<void> {
  if (record.verified === false) {
    throw new Error('Cannot unverify an unverified identity!')
  }

  const result = await conn.result(
    `
    update "organizationIdentities"
    set value = $(newValue),
        verified = false
    where "organizationId" = $(organizationId) and
          platform = $(platform) and 
          type = $(type) and
          verified = true and
          value = $(value)
    `,
    {
      newValue: value,
      organizationId: record.organizationId,
      platform: record.platform,
      type: record.type,
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
    delete from "organizationIdentities"
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
    select oi.* from "organizationIdentities" oi
    where oi."tenantId" = '875c38bd-2b1b-4e91-ad07-0cfbabb4c49f'
    and oi.type in ('primary-domain', 'alternative-domain')
    order by "createdAt"
    limit $(limit) offset $(offset);
  `

  let results = await dbConnection.any(query, {
    limit: perPage,
    offset: (page - 1) * perPage,
  })

  while (results.length > 0) {
    for (const result of results) {
      let newValue = result.value
      let invalid = false

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
        newValue = result.value
        invalid = true
      } else if (normalized !== result.value) {
        console.log(`[normalizing] ${normalized}\n`, toText(result))
        newValue = normalized
      }

      if (invalid) {
        await dbConnection.tx(async (t: DbTransaction) => {
          // just remove unverified incorrect domain identity
          await removeIdentity(t, result)
          deletedCount += 1
        })
      } else if (newValue !== result.value) {
        await dbConnection.tx(async (t: DbTransaction) => {
          if (result.verified === true) {
            // check if identity already exists with the newValue as value
            const existingRecords = await findExisting(t, result, newValue)
            if (existingRecords.length === 0) {
              // if it doesn't we can just update the current one
              await updateIdentityValue(t, result, newValue)
              updatedCount += 1
            } else if (existingRecords.length > 1) {
              throw new Error('More than one record found!' + toText(result) + ' ' + newValue)
            } else if (existingRecords[0].organizationId === result.organizationId) {
              // delete it because the same org already has the same identity that we are trying to update
              await removeIdentity(t, result)
              deletedCount += 1
            } else if (existingRecords[0].organizationId !== result.organizationId) {
              // check lf memberships and possibly generate merge suggestions
              const lfxMemberships = await findLfxMembershipStatus(t, [
                result.organizationId,
                existingRecords[0].organizationId,
              ])
              if (
                lfxMemberships[existingRecords[0].organizationId] &&
                lfxMemberships[result.organizationId]
              ) {
                // set to manual review file two orgs because they are about to share the same identity with the newValue
                await printToFile(
                  'to-merge.csv',
                  `${toText(existingRecords[0])},${result.organizationId},"${
                    result.value
                  }","${newValue}"`,
                )
              } else if (
                lfxMemberships[existingRecords[0].organizationId] &&
                !lfxMemberships[result.organizationId]
              ) {
                // mark the identity as unverified with the new value
                await updateIdentityValueAndUnverify(t, result, newValue)
                updatedCount += 1
                // add merge suggestion with primary being the one where org is lf member
                await mergeSuggestion(t, existingRecords[0].organizationId, result.organizationId)
              } else if (
                !lfxMemberships[existingRecords[0].organizationId] &&
                lfxMemberships[result.organizationId]
              ) {
                // mark the identity as unverified with the new value
                await updateIdentityValueAndUnverify(t, existingRecords[0], newValue)
                updatedCount += 1
                // add merge suggestion with primary being the one where org is lf member
                await mergeSuggestion(t, result.organizationId, existingRecords[0].organizationId)
              } else {
                const activityCounts = await getActivityCounts(t, [
                  result.organizationId,
                  existingRecords[0].organizationId,
                ])

                if (
                  activityCounts[result.organizationId] >
                  activityCounts[existingRecords[0].organizationId]
                ) {
                  // mark the identity as unverified with the new value
                  await updateIdentityValueAndUnverify(t, existingRecords[0], newValue)
                  updatedCount += 1
                  // add merge suggestion with primary being the one with more activity
                  await mergeSuggestion(t, result.organizationId, existingRecords[0].organizationId)
                } else {
                  // mark the identity as unverified with the new value
                  await updateIdentityValueAndUnverify(t, result, newValue)
                  updatedCount += 1
                  // add merge suggestion with primary being the one with more activity
                  await mergeSuggestion(t, existingRecords[0].organizationId, result.organizationId)
                }
              }
            }
          } else {
            const existingRecords = await findExisting(t, result, newValue)
            if (existingRecords.length === 0) {
              await updateIdentityValue(t, result, newValue)
              updatedCount += 1
            } else if (
              existingRecords.find((r) => r.organizationId === result.organizationId) !== undefined
            ) {
              // just remove the value since the value we are trying to set already belongs to the same org
              await removeIdentity(t, result)
              deletedCount += 1
            } else {
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

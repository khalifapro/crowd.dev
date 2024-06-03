import { QueryTypes, Sequelize } from 'sequelize'
import { getServiceLogger } from '@crowd/logging'
import { databaseInit } from '@/database/databaseConnection'

/* eslint-disable no-continue */
/* eslint-disable @typescript-eslint/no-loop-func */

const log = getServiceLogger()

async function getActivities(
  seq: Sequelize,
  tenantId: string,
  { offset = 0, limit = 100},
): Promise<any[]> {
  const results = await seq.query(
    `
        select distinct on ("memberId") "memberId", username, platform
        from activities
        where "tenantId" = :tenantId
        limit :limit offset :offset;
        `,
    {
      type: QueryTypes.SELECT,
      replacements: { offset, limit, tenantId },
    },
  )

  return results
}

async function getTotalActivities(seq: Sequelize, tenantId: string): Promise<number> {
    const results = await seq.query(
        `
            select count(distinct "memberId") from activities
            where "tenantId" = :tenantId;
            `,
        {
        type: QueryTypes.SELECT,
        replacements: { tenantId },
        },
    ) as any[]
    
    return results[0].count
}

async function getMemberIdentity(
  seq: Sequelize,
  username: string,
  platform: string,
): Promise<any[]> {
  const results = await seq.query(
    `
        select "memberId" from "memberIdentities"
        where value = :username
        and platform = :platform
        and type = 'username';
        `,
    {
      type: QueryTypes.SELECT,
      replacements: { username, platform },
    },
  )
  return results
}

const processArguments = process.argv.slice(2)

if (processArguments.length !== 1) {
  log.error('Expected 1 argument: tenantId')
  process.exit(1)
}

const tenantId = processArguments[0]

setImmediate(async () => {
  const dbOptions = await databaseInit(1000 * 60 * 15)

  const seq = dbOptions.sequelize as Sequelize

  log.info('Querying database for wrongly mapped members in activities!')

  let offset = 0
  let processed = 0
  const wronglyMappedMembers = []
  const BATCH_SIZE = 100

  const totalActivities = await getTotalActivities(seq, tenantId)
  let activities = await getActivities(seq, tenantId, { offset, limit: BATCH_SIZE })

  while (activities.length > 0) {
    for (const activity of activities) {
      const { memberId: activityMemberId, username, platform } = activity
      const identity = await getMemberIdentity(seq, username, platform)

      if (identity.length > 0 && activityMemberId !== identity[0].memberId) {
        wronglyMappedMembers.push({
          activityMemberId,
          correctId: identity[0].memberId,
          wrongId: activityMemberId,
          username,
          platform,
        })
      }
      
      processed += 1
    }

    log.info(`Processed ${processed}/${totalActivities} activities!`)

    offset += BATCH_SIZE
    activities = await getActivities(seq, tenantId, { offset, limit: BATCH_SIZE })
  }

  log.info('Total wrongly mapped members in activities: ', wronglyMappedMembers.length)
  log.info('Wrongly mapped members in activities: ', wronglyMappedMembers)

  process.exit(0)
})

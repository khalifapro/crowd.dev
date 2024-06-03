import commandLineArgs from 'command-line-args'
import commandLineUsage from 'command-line-usage'
import * as fs from 'fs'
import path from 'path'
import { getServiceLogger } from '@crowd/logging'
import { QueryTypes, Sequelize } from 'sequelize'
import SequelizeRepository from '../../database/repositories/sequelizeRepository'

/* eslint-disable no-console */

const banner = fs.readFileSync(path.join(__dirname, 'banner.txt'), 'utf8')

const log = getServiceLogger()

const options = [
  {
    name: 'memberId',
    alias: 'm',
    typeLabel: '{underline memberId}',
    type: String,
  },
  {
    name: 'platform',
    alias: 'p',
    typeLabel: '{underline platform}',
    type: String,
  },
  {
    name: 'username',
    alias: 'u',
    typeLabel: '{underline username}',
    type: String,
  },
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Print this usage guide.',
  },
]
const sections = [
  {
    content: banner,
    raw: true,
  },
  {
    header: 'Fix activities with wrong member and username',
    content: 'Fix activities with wrong member and username',
  },
  {
    header: 'Options',
    optionList: options,
  },
]

async function getActivitiesWithUsername(
  seq: Sequelize,
  memberId: string,
  platform: string,
  username: string,
  { offset = 0, limit = 100 },
): Promise<any[]> {
  const results = await seq.query(
    `
        select id, "memberId", username, platform
        from activities
        where "memberId" = :memberId
        and username = :username
        and platform = :platform
        limit :limit offset :offset;
        `,
    {
      type: QueryTypes.SELECT,
      replacements: { memberId, username, platform, offset, limit},
    },
  )

  return results
}

async function totalActivitiesWithUsername(
    seq: Sequelize,
    memberId: string,
    platform: string,
    username: string,
    ): Promise<number> {
    const results = await seq.query(
        `
            select count(*) from activities
            where "memberId" = :memberId
            and username = :username
            and platform = :platform;
            `,
        {
        type: QueryTypes.SELECT,
        replacements: { memberId, username, platform },
        },
    ) as any[]
    
    return results[0].count
}

async function getMemberIdentity(
  seq: Sequelize,
  username: string,
  platform: string,
): Promise<any> {
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
  return results[0]
}

async function updateActivity(
  seq: Sequelize,
  id: string,
  memberId: string,
  username: string,
  platform: string,
): Promise<void> {
    await seq.query(
        `
            update activities
            set "memberId" = :memberId
            where id = :id and username = :username and platform = :platform;
            `,
        {
          type: QueryTypes.UPDATE,
          replacements: { memberId, id, username, platform },
        },
      )
}

const usage = commandLineUsage(sections)
const parameters = commandLineArgs(options)

if (parameters.help || !parameters.memberId || !parameters.platform || !parameters.username) {
  console.log(usage)
} else {
  setImmediate(async () => {
    const memberId = parameters.memberId
    const platform = parameters.platform
    const username = parameters.username

    const options = await SequelizeRepository.getDefaultIRepositoryOptions()
    const seq = SequelizeRepository.getSequelize(options)

    let offset = 0
    let processed = 0
    const BATCH_SIZE = 100

    const totalActivities = await totalActivitiesWithUsername(seq, memberId, platform, username)

    log.info(`Total ${totalActivities} activities found!`)

    // const memberIdentityInfo = await getMemberIdentity(seq, username, platform)

    // let activities = await getActivitiesWithUsername(seq, memberId, platform, username, { offset, limit: BATCH_SIZE })

    // while (activities.length > 0) {
    //   for (const activity of activities) {
    //     if (activity.memberId !== memberIdentityInfo.memberId) {
    //       await updateActivity(seq, activity.id, memberIdentityInfo.memberId, username, platform)
    //       processed++
    //     }

    //     log.info(`Processed ${processed}/${totalActivities} activities!`)
    //   }

    //   offset += BATCH_SIZE
    //   activities = await getActivitiesWithUsername(seq, memberId, platform, username, { offset, limit: BATCH_SIZE })
    // }

    // log.info('Finished processing activities!')

    process.exit(0)
  })
}

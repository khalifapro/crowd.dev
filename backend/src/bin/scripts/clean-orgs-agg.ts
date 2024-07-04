/* eslint-disable @typescript-eslint/dot-notation */
/* eslint-disable no-console */
/* eslint-disable import/no-extraneous-dependencies */

import { QueryExecutor } from '@crowd/data-access-layer/src/queryExecutor'
import { databaseInit } from '@/database/databaseConnection'
import SequelizeRepository from '@/database/repositories/sequelizeRepository'
import { IRepositoryOptions } from '@/database/repositories/IRepositoryOptions'

async function getDistinctOrgIds(qx: QueryExecutor, { countOnly = false, limit = 100, offset = 0 }) {
    if (countOnly) {
        const query = await qx.select(`
        select count(distinct "organizationId") from "organizationSegmentsAgg"
        `)

        return query[0].count
    }

    const query = await qx.select(`
    select distinct "organizationId" from "organizationSegmentsAgg"
    limit $(limit) offset $(offset)
    `, {
        limit,
        offset
    })

    return query    
}

async function checkIfOrgExists(qx: QueryExecutor, orgId: string) {
    return qx.selectOne(
        `select id from organizations where id = $(orgId)`,
        {
            orgId
        }
    )
}

async function deleteOrganizationSegmentsAgg(qx: QueryExecutor, orgId: string) {
    return qx.result(
        `delete from "organizationSegmentsAgg" where "organizationId" = $(orgId)`,
        {
            orgId
        }
    )
}

setImmediate(async () => {
    const dbClient = await databaseInit()
    const qx = SequelizeRepository.getQueryExecutor({
      database: dbClient,
    } as IRepositoryOptions)

    const BATCH_SIZE = 100
    let processedOrgIds = 0

    const totalOrgIds = await getDistinctOrgIds(qx, { countOnly: true })

    console.log('Total distinct org ids found:', totalOrgIds)

    // while (processedOrgIds < totalOrgIds) {
    //     const rows = await getDistinctOrgIds(qx, { limit: BATCH_SIZE, offset: processedOrgIds })

    //     for (const row of rows) {
    //         const orgId = row.organizationId
    //         const orgExists = await checkIfOrgExists(qx, orgId)
    //         if (!orgExists) {
    //             console.log('Org does not exist:', orgId)
    //             await deleteOrganizationSegmentsAgg(qx, orgId)
    //         }

    //         processedOrgIds++
    //     }

    //     console.log(`Processed ${processedOrgIds}/${totalOrgIds}!`)
    // }

    console.log('Done cleaning orgs organizationSegmentsAgg!')

    process.exit(0)
  })
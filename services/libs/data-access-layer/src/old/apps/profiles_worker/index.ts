import { DbConnection, DbStore } from '@crowd/database'
import { IAffiliationsLastCheckedAt, IMemberId } from './types'
import { ITenant } from '@crowd/types'

export async function runMemberAffiliationsUpdate(
  db: DbStore,
  qdb: DbConnection,
  memberId: string,
) {
  // this 000000 magic is to differentiate between nothing to LEFT JOIN with and real individial affiliation
  // we want to keep NULL in 'organizationId' if there is an affiliation configured,
  // but if there is no manual affiliation, we know this by 'msa.id' being NULL, and then using 000000 as a marker,
  // which we remove afterwards
  const queryPostgreSQL = `
    SELECT
      msa."dateStart", msa."dateEnd", msa."memberId", msa."segmentId",
      (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN msa.id IS NULL THEN '00000000-0000-0000-0000-000000000000' ELSE msa."organizationId" END), '00000000-0000-0000-0000-000000000000')
        || ARRAY_REMOVE(ARRAY_AGG(mo."organizationId" ORDER BY mo."dateStart" DESC, mo.id), NULL)
        || ARRAY_REMOVE(ARRAY_AGG(mo1."organizationId" ORDER BY mo1."createdAt" DESC, mo1.id), NULL)
        || ARRAY_REMOVE(ARRAY_AGG(mo2."organizationId" ORDER BY mo2."createdAt", mo2.id), NULL)
      )[1] AS "organizationId"
    FROM "memberSegmentAffiliations" msa
    LEFT JOIN "memberOrganizations" mo
      ON mo."memberId" = msa."memberId"
      AND mo."deletedAt" IS NULL
    LEFT JOIN "memberOrganizations" mo1
      ON mo1."memberId" = msa."memberId"
      AND mo1."dateStart" IS NULL AND mo1."dateEnd" IS NULL
      AND mo1."deletedAt" IS NULL
    LEFT JOIN "memberOrganizations" mo2
      ON mo2."memberId" = msa."memberId"
      AND mo2."dateStart" IS NULL AND mo2."dateEnd" IS NULL
      AND mo2."deletedAt" IS NULL
    WHERE msa."memberId" = $(memberId)
    GROUP BY msa."dateStart", msa."dateEnd", msa."memberId", msa."segmentId";
  `

  const rows = await db.connection().query(queryPostgreSQL, {
    memberId,
  })

  // Update activities in QuestDB
  for (const row of rows) {
    let queryQuestDB = `
      UPDATE activities SET "organizationId" = $(organizationId)
      WHERE "memberId" = $(memberId)
      AND "segmentId" = $(segmentId)
    `

    if (row.dateEnd) {
      queryQuestDB += ` AND "timestamp" BETWEEN $(after) AND $(before);`
    } else {
      queryQuestDB += ` AND "timestamp" > $(after);`
    }

    await qdb.query(queryQuestDB, {
      memberId: row.memberId,
      organizationId: row.organizationId,
      segmentId: row.segmentId,
      after: row.dateStart,
      before: row.dateEnd,
    })
  }
}

export async function getAffiliationsLastCheckedAt(db: DbStore, tenantId: string) {
  try {
    const result: IAffiliationsLastCheckedAt = await db.connection().oneOrNone(
      `
      select "affiliationsLastCheckedAt"
      from tenants
      where "id" = $(tenantId);`,
      {
        tenantId,
      },
    )
    return result?.affiliationsLastCheckedAt
  } catch (err) {
    throw new Error(err)
  }
}

export async function getAllMemberIdsPaginated(
  db: DbStore,
  tenantId: string,
  limit: number,
  offset: number,
) {
  try {
    const results: IMemberId[] = await db.connection().any(
      `
      select id from members
      where "tenantId" = $(tenantId)
      order by id asc
      limit $(limit)
      offset $(offset);`,
      {
        tenantId,
        limit,
        offset,
      },
    )
    return results?.map((r) => r.id) || []
  } catch (err) {
    throw new Error(err)
  }
}

export async function getMemberIdsWithRecentRoleChanges(
  db: DbStore,
  tenantId: string,
  affiliationsLastChecked: string,
  limit: number,
  offset: number,
) {
  try {
    const results: IMemberId[] = await db.connection().any(
      `
      select distinct mo."memberId" as id from "memberOrganizations" mo
      join "members" m on mo."memberId" = m."id"
      where 
            m."tenantId" = $(tenantId)
            and (
            mo."createdAt" > $(affiliationsLastChecked) or 
            mo."updatedAt" > $(affiliationsLastChecked) or 
            mo."deletedAt" > $(affiliationsLastChecked)
            )
      order by mo."memberId" asc
      limit $(limit)
      offset $(offset);`,

      {
        tenantId,
        affiliationsLastChecked,
        limit,
        offset,
      },
    )
    return results?.map((r) => r.id) || []
  } catch (err) {
    throw new Error(err)
  }
}

export async function updateAffiliationsLastCheckedAt(
  db: DbStore,
  tenantId: string,
): Promise<void> {
  try {
    await db.connection().any(
      `
        update tenants set "affiliationsLastCheckedAt" = now()
        where "id" = $(tenantId);
      `,
      {
        tenantId,
      },
    )
  } catch (err) {
    throw new Error(err)
  }
}

export async function getAllTenants(db: DbStore): Promise<ITenant[]> {
  let rows: ITenant[] = []
  try {
    rows = await db.connection().query(`
      select 
        id as "tenantId", 
        plan
      from tenants
      where "deletedAt" is null
        and plan IN ('Scale', 'Growth', 'Essential', 'Enterprise')
        and ("trialEndsAt" > NOW() or "trialEndsAt" is null);
    `)
  } catch (err) {
    this.log.error('Error while getting all tenants', err)

    throw new Error(err)
  }

  return rows
}

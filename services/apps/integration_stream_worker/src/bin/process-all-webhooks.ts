import { DB_CONFIG, REDIS_CONFIG, QUEUE_CONFIG, UNLEASH_CONFIG } from '../conf'
import IntegrationStreamService from '../service/integrationStreamService'
import { timeout } from '@crowd/common'
import { DbStore, getDbConnection } from '@crowd/data-access-layer/src/database'
import { getServiceTracer } from '@crowd/tracing'
import { getServiceLogger } from '@crowd/logging'
import { getRedisClient } from '@crowd/redis'
import { WebhookType } from '@crowd/types'
import {
  DataSinkWorkerEmitter,
  IntegrationRunWorkerEmitter,
  IntegrationStreamWorkerEmitter,
  PriorityLevelContextRepository,
  QueuePriorityContextLoader,
} from '@crowd/common_services'
import { getUnleashClient } from '@crowd/feature-flags'
import { QueueFactory } from '@crowd/queue'

const BATCH_SIZE = 100
const MAX_CONCURRENT = 3

const tracer = getServiceTracer()
const log = getServiceLogger()

async function processWebhook(
  webhookId: string,
  service: IntegrationStreamService,
): Promise<boolean> {
  try {
    return await service.processWebhookStream(webhookId)
  } catch (err) {
    return false
  }
}

setImmediate(async () => {
  const queueClient = QueueFactory.createQueueService(QUEUE_CONFIG())
  const dbConnection = await getDbConnection(DB_CONFIG())
  const store = new DbStore(log, dbConnection)
  const unleash = await getUnleashClient(UNLEASH_CONFIG())
  const priorityLevelRepo = new PriorityLevelContextRepository(new DbStore(log, dbConnection), log)
  const loader: QueuePriorityContextLoader = (tenantId: string) =>
    priorityLevelRepo.loadPriorityLevelContext(tenantId)

  const redisClient = await getRedisClient(REDIS_CONFIG(), true)
  const runWorkerEmiiter = new IntegrationRunWorkerEmitter(
    queueClient,
    redisClient,
    tracer,
    unleash,
    loader,
    log,
  )
  const streamWorkerEmitter = new IntegrationStreamWorkerEmitter(
    queueClient,
    redisClient,
    tracer,
    unleash,
    loader,
    log,
  )
  const dataSinkWorkerEmitter = new DataSinkWorkerEmitter(
    queueClient,
    redisClient,
    tracer,
    unleash,
    loader,
    log,
  )

  await runWorkerEmiiter.init()
  await streamWorkerEmitter.init()
  await dataSinkWorkerEmitter.init()

  const service = new IntegrationStreamService(
    redisClient,
    runWorkerEmiiter,
    streamWorkerEmitter,
    dataSinkWorkerEmitter,
    store,
    log,
  )

  let results = await dbConnection.any(
    `
    select id
    from "incomingWebhooks"
    where state in ('PENDING', 'ERROR') and type not in ('${WebhookType.DISCOURSE}', '${WebhookType.CROWD_GENERATED}')
    order by 
    case when state = 'PENDING' then 1
    else 2
    end,
    id
    limit ${BATCH_SIZE};
    `,
  )

  let current = 0
  let total = 0
  let errors = 0
  while (results.length > 0) {
    for (const result of results) {
      while (current == MAX_CONCURRENT) {
        await timeout(1000)
      }
      const webhookId = result.id

      current++
      processWebhook(webhookId, service).then((res) => {
        current--

        if (res) {
          total++
        } else {
          errors++
        }

        log.info({ res }, `Processed ${total} webhooks successfully so far! ${errors} errors!`)
      })
    }

    results = await dbConnection.any(
      `
      select id
      from "incomingWebhooks"
      where state in ('PENDING', 'ERROR') and type not in ('${WebhookType.DISCOURSE}', '${WebhookType.CROWD_GENERATED}')
      and id > $(lastId)
      order by
      case when state = 'PENDING' then 1
      else 2
      end,
      id
      limit ${BATCH_SIZE};
      `,
      {
        lastId: results[results.length - 1].id,
      },
    )
  }

  while (current > 0) {
    await timeout(1000)
  }

  process.exit(0)
})

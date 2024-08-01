import { CrowdQueue, IQueue } from '@crowd/queue'
import { QueuePriorityContextLoader, QueuePriorityService } from '../priority.service'
import { RedisClient } from '@crowd/redis'
import { UnleashClient } from '@crowd/feature-flags'
import { Logger } from '@crowd/logging'
import { Tracer } from '@crowd/tracing'
import {
  CheckResultsQueueMessage,
  CreateAndProcessActivityResultQueueMessage,
  IActivityData,
  IQueueMessage,
  ProcessIntegrationResultQueueMessage,
  QueuePriorityLevel,
} from '@crowd/types'
import { generateUUIDv1 } from '@crowd/common'

export class DataSinkWorkerEmitter extends QueuePriorityService {
  public constructor(
    queueClient: IQueue,
    redis: RedisClient,
    tracer: Tracer,
    unleash: UnleashClient | undefined,
    priorityLevelCalculationContextLoader: QueuePriorityContextLoader,
    parentLog: Logger,
  ) {
    super(
      CrowdQueue.DATA_SINK_WORKER,
      queueClient.getQueueConfig(CrowdQueue.DATA_SINK_WORKER),
      queueClient,
      redis,
      tracer,
      unleash,
      priorityLevelCalculationContextLoader,
      parentLog,
    )
  }

  public async triggerResultProcessing(
    tenantId: string,
    platform: string,
    resultId: string,
    sourceId: string,
    onboarding: boolean,
    deduplicationId?: string,
  ) {
    await this.sendMessage(
      tenantId,
      sourceId,
      new ProcessIntegrationResultQueueMessage(resultId),
      deduplicationId || resultId,
      {
        onboarding,
      },
    )
  }

  public async createAndProcessActivityResult(
    tenantId: string,
    segmentId: string,
    integrationId: string,
    activity: IActivityData,
  ) {
    await this.sendMessage(
      tenantId,
      generateUUIDv1(),
      new CreateAndProcessActivityResultQueueMessage(tenantId, segmentId, integrationId, activity),
      undefined,
      {
        onboarding: true,
      },
    )
  }

  public async checkResults() {
    await this.sendMessage(
      undefined,
      'global',
      new CheckResultsQueueMessage(),
      'global',
      undefined,
      QueuePriorityLevel.SYSTEM,
    )
  }

  public sendMessagesBatch<T extends IQueueMessage>(
    messages: {
      tenantId: string
      payload: T
      groupId: string
      deduplicationId?: string
      id?: string
    }[],
  ): Promise<void> {
    return super.sendMessages(messages)
  }
}

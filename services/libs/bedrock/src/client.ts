import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { getServiceChildLogger } from '@crowd/logging'
import { IBedrockConfig, ILLMInput, ILLMResult } from './types'
const log = getServiceChildLogger('bedrock.client')

let client: BedrockRuntimeClient | undefined
export const getBedrockClient = (config: IBedrockConfig): BedrockRuntimeClient => {
  if (client) return client

  log.info({ region: config.region }, 'Creating new Bedrock client...')
  client = new BedrockRuntimeClient({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    region: config.region,
  })
  return client
}

export const getLLMResult = async (
  client: BedrockRuntimeClient,
  input: ILLMInput,
): Promise<ILLMResult> => {
  const start = performance.now()

  const end = () => {
    const end = performance.now()
    const duration = end - start
    return Math.ceil(duration / 1000)
  }

  const command = new InvokeModelCommand({
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: input.prompt,
            },
          ],
        },
      ],
      ...input.modelSpecificArgs,
    }),
    modelId: input.modelId,
    accept: 'application/json',
    contentType: 'application/json',
  })

  const res = await client.send(command)

  return {
    body: JSON.parse(res.body.transformToString()),
    prompt: input.prompt,
    modelSpecificArgs: input.modelSpecificArgs,
    responseTimeSeconds: end(),
  }
}

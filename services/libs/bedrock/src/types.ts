import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
export { BedrockRuntimeClient }

export interface IBedrockConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface IAnthrophicModelsArgs {
  anthropic_version: string
  max_tokens: number
  temperature: number
  top_p: number
  top_k: number
}

type IModelSpecificArgs = IAnthrophicModelsArgs

export interface ILLMInput {
  prompt: string
  modelId: string
  modelSpecificArgs: IModelSpecificArgs
}

export interface ILLMResult {
  body: ILLMResultBody
  prompt: string
  responseTimeSeconds: number
  modelSpecificArgs: IModelSpecificArgs
}

export interface ILLMResultBody {
  id: string
  type: string
  role: string
  model: string
  content: {
    type: string
    text: string
  }[]
  stop_reason: string
  stop_sequence: string
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

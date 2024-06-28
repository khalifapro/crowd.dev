import { prepareOrganizationData } from '../../utils'
import { getBedrockClient, getLLMResult } from '@crowd/bedrock'
import { timeout } from '@crowd/common'
import fs from 'fs'
import path from 'path'

let bedrockClient
const organizations = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, './organizations.json'), 'utf8'),
)
const expectedResults = organizations.reduce((acc, org) => {
  acc[org.displayName] = org.identities.reduce((innerAcc, i) => {
    innerAcc[`${i.platform}:${i.value}`] = i.isCorrect
    return innerAcc
  }, {})

  return acc
}, {})

const PRICE_PER_1000_INPUT_TOKENS = 0.003
const PRICE_PER_1000_OUTPUT_TOKENS = 0.015

describe('Flagging bad identities with LLM tests', () => {
  beforeAll(async () => {
    bedrockClient = getBedrockClient({
      accessKeyId: process.env['CROWD_AWS_BEDROCK_ACCESS_KEY_ID'],
      secretAccessKey: process.env['CROWD_AWS_BEDROCK_SECRET_ACCESS_KEY'],
      region: process.env['CROWD_AWS_BEDROCK_REGION'],
    })
  })

  afterAll((done) => {
    // Closing the DB connection allows Jest to exit successfully.
    // SequelizeTestUtils.closeConnection(db)
    done()
  })

  organizations?.forEach((organization) => {
    describe(`Checks organization identities for ${organization.displayName}`, () => {
      let wrongIdentities

      beforeAll(async () => {
        const prompt = `
        Your task is to analyze the following two json documents. <json> ${JSON.stringify(
          prepareOrganizationData(organization),
        )} </json>. Based on this information, identify any incorrect identities that do not belong to the given organization.
        Identities don't have to be the official ones, but they should be related to the organization in some way.
        If identity includes organization name, it's correct. If there's a chance that they could be related, please mark them as correct.
        If you see any unrelated identities, mark them as wrong.
        If you think it's a partnership, sponsorship or collaboration, mark them as wrong.
        Only provide an array of wrong identity ids in the end. Print nothing else, just the array.
       `
        /**
          Prompt artifacts for easy copy-paste:
           For each identity, explain your reasoning
           Provide an array of wrong identity ids in the end. 

           For each identity, explain your reasoning
           Only provide an array of wrong identity ids in the end. Print nothing else, just the array.
        */
        const res = await getLLMResult(bedrockClient, {
          prompt,
          modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
          modelSpecificArgs: {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2000,
            top_k: 1,
            top_p: 1,
            temperature: 0,
          },
        })
        global.totalCost += (res.body.usage.input_tokens * PRICE_PER_1000_INPUT_TOKENS) / 1000
        global.totalCost += (res.body.usage.output_tokens * PRICE_PER_1000_OUTPUT_TOKENS) / 1000

        // console.log(res.body.content[0].text)
        wrongIdentities = JSON.parse(res.body.content[0].text)
        await timeout(5000)
      })

      organization.identities.forEach((identity) => {
        it(`Should flag identity ${identity.platform}:${identity.value} for ${
          organization.displayName
        } as ${
          expectedResults[organization.displayName][`${identity.platform}:${identity.value}`]
            ? 'correct'
            : 'wrong'
        }`, () => {
          expect(!wrongIdentities.includes(`${identity.platform}:${identity.value}`)).toBe(
            expectedResults[organization.displayName][`${identity.platform}:${identity.value}`],
          )
        })
      })
    })
  })
})

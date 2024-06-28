/* eslint-disable @typescript-eslint/no-var-requires */
const NodeEnvironment = require('jest-environment-node').TestEnvironment

class CustomEnvironment extends NodeEnvironment {
  async setup() {
    await super.setup()
    this.global.totalCost = global.totalCost
  }

  async teardown() {
    global.totalCost = this.global.totalCost
    await super.teardown()
  }

  runScript(script) {
    return super.runScript(script)
  }
}

module.exports = CustomEnvironment

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs')
const path = require('path')

class CustomReporter {
  onRunComplete(contexts, results) {
    let countOfexpectedTrueIdentities = 0
    let countOfexpectedFalseIdentities = 0

    const organizations = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, './organizations.json'), 'utf8'),
    )

    for (const organization of organizations) {
      for (const identity of organization.identities) {
        if (identity.isCorrect) {
          countOfexpectedTrueIdentities += 1
        } else {
          countOfexpectedFalseIdentities += 1
        }
      }
    }
    const totalTests = results.numTotalTests
    const passedTests = results.numPassedTests
    const testResults = results.testResults

    let expectedTrueButGotFalse = []
    let expectedFalseButGotTrue = []

    testResults.forEach((testSuite) => {
      testSuite.testResults.forEach((testCase) => {
        if (testCase.status === 'failed') {
          const result = testCase.failureDetails[0].matcherResult

          if (result.expected === true && result.actual === false) {
            expectedTrueButGotFalse.push(testCase.title)
          } else if (result.expected === false && result.actual === true) {
            expectedFalseButGotTrue.push(testCase.title)
          }
        }
      })
    })

    console.log('Total number of test cases:', totalTests)
    console.log('Number of correct test cases:', passedTests)
    console.log('Number of test cases with correct identities:', countOfexpectedTrueIdentities)
    console.log('Number of test cases with wrong identities:', countOfexpectedFalseIdentities)
    console.log(
      `Accuracy rate of marking wrong identities: %${Math.floor(
        ((countOfexpectedFalseIdentities - expectedFalseButGotTrue.length) /
          countOfexpectedFalseIdentities) *
          100,
      )}`,
    )
    console.log(
      `Accuracy rate of marking correct identities: %${Math.floor(
        ((countOfexpectedTrueIdentities - expectedTrueButGotFalse.length) /
          countOfexpectedTrueIdentities) *
          100,
      )}`,
    )
    console.log(`Total cost to run all test cases: $${global.totalCost}`)
    console.log(
      `Average cost to run for one organization: $${global.totalCost / organizations.length}`,
    )

    console.log(`\n\n***************** Details *****************`)
    console.log(
      'Number of wrong test cases where we flagged a correct identity as wrong:',
      expectedTrueButGotFalse.length,
    )
    console.log(
      'List of wrong test cases where we flagged a correct identity as wrong:',
      expectedTrueButGotFalse,
    )
    console.log(
      'Number of wrong test cases where we flagged a wrong identity as correct:',
      expectedFalseButGotTrue.length,
    )
    console.log(
      'List of wrong test cases where we flagged a wrong identity as correct:',
      expectedFalseButGotTrue,
    )
  }

  onTestResult() {
    // hook for test results
  }

  onTestStart() {
    // hook for test start
  }
}

module.exports = CustomReporter

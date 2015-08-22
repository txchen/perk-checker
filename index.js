#!/usr/bin/env node
var toml = require('toml')
var fs = require('fs')
var moment = require('moment')
var program = require('commander')
var superagent = require('superagent')
var cheerio = require('cheerio')
var async = require('async')

var config = {}

function sendMail(subject, text) {
  var mailgun = require('mailgun-js')({apiKey: config.mailgun.apikey, domain: config.mailgun.domain})
  var data = {
    from: config.mailgun.from,
    to: config.mailgun.to,
    subject: subject,
    text: text
  }
  mailgun.messages().send(data, function (err, body) {
    err && console.log('error sending email', err)
    console.log(body)
  })
}

function getConfig(configFile) {
  try {
    var configContent = fs.readFileSync(configFile).toString()
    return toml.parse(configContent)
  } catch (e) {
    console.error("Parsing error on line " + e.line + ", column " + e.column + ": " + e.message)
    process.exit(2)
  }
}

function getBalance(acctName, cookie, ua, acctResult, asyncCallback) {
  superagent.get('http://perk.com/account')
    .set('Cookie', cookie)
    .set('User-Agent', ua)
    .end(function(err, res) {
      if (err) {
        acctResult.err = 'failed to get account info' + err
      } else {
        var $ = cheerio.load(res.text)
        var lifeTimeBalance = $('#tokens-list > ul.lifetime > li:nth-child(2) > span').text()
        var currentBalance = $('#points_list > ul > li:nth-child(1) > span.total_points').text()
        acctResult.balance = parseInt(currentBalance.replace(/,/g, ""))
        acctResult.totalBalance = parseInt(lifeTimeBalance.replace(/,/g, ""))
      }
      asyncCallback()
    })
}

function main() {
  config = getConfig('config.toml')

  program.version('0.0.1')
    .option('-n, --noemail', 'do not send email', false)

  program.parse(process.argv)

  var result = { timestamp: (new Date).getTime(), accounts: {} }

  var acctNames = Object.keys(config.accounts)
  async.eachSeries(acctNames, function(acctName, callback) {
      var acct = config.accounts[acctName]
      result.accounts[acctName] = {}
      getBalance(acctName, acct.cookie, acct.ua, result.accounts[acctName], callback)
    },
    function done() {
      try {
        var lastResult = JSON.parse(fs.readFileSync('logs/last_perk_check.log'))
      } catch (err) {
        console.log('failed to read last result from last_perk_check.log')
      }
      // save result to logs/perk_history.log and logs/last_perk_check.log
      fs.writeFileSync('logs/last_perk_check.log', JSON.stringify(result))
      fs.appendFileSync('logs/perk_history.log', JSON.stringify(result) + '\n')
      allsummary = moment().format('YYYY-MM-DD HH:mm:ss') + '\n\n'
      for (var account in result.accounts) {
        allsummary += account + ': ' + result.accounts[account].balance + ' / ' + result.accounts[account].totalBalance
        if (lastResult && lastResult.accounts[account]) {
          allsummary += ' ('
          var pointsEarned = result.accounts[account].totalBalance - lastResult.accounts[account].totalBalance
          var duration = result.timestamp - lastResult.timestamp
          allsummary += ' got ' + pointsEarned + ' points in last ' + (duration / 3600000.0).toFixed(3) + ' hours. '
          allsummary += 'DailyRate: ' + (24 * 3600000 * pointsEarned / duration).toFixed(2)
          allsummary += ' )'
        }
        allsummary += '\n\n'
      }
      allsummary += '------------- json result -------------\n'
      allsummary += JSON.stringify(result, null, 2)
      if (lastResult) {
        allsummary += '\n\n------------- last check json result -------------\n'
        allsummary += JSON.stringify(lastResult, null, 2)
      }

      console.log(allsummary)
      if (!program.noemail) {
        sendMail('Perk Status: ' + moment().format('YYYYMMDD-HHmmss'), allsummary)
      }
    })
}

main()

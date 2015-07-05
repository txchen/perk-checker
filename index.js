#!/usr/bin/env node
var toml = require('toml')
var fs = require('fs')
var moment = require('moment')
var program = require('commander')
var superagent = require('superagent')
var cheerio = require('cheerio')
var async = require('async')

var allsummary = ''
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

function getBalance(acctName, cookie, ua, asyncCallback) {
  superagent.get('http://perk.com/perk/account')
    .set('Cookie', cookie)
    .set('User-Agent', ua)
    .end(function(err, res) {
      if (err) {
        allsummary += acctName + ': failed to get account info' + err + '\n\n'
      } else {
        var $ = cheerio.load(res.text);
        var lifeTimeBalance = $('#wrapper > section > div > div.account-settings > div > p.lifebal > strong').text()
        var currentBalance = $('#wrapper > section > div > div.account-points > div.balance.points > strong').text()
        allsummary += acctName + ': ' + currentBalance + ' / ' + lifeTimeBalance + '\n\n'
      }
      asyncCallback()
    })
}

function main() {
  config = getConfig('config.toml')

  program.version('0.0.1')
    .option('-n, --noemail', 'do not send email', false)

  program.parse(process.argv)

  var acctNames = Object.keys(config.accounts)
  async.eachSeries(acctNames, function(acctName, callback) {
      var acct = config.accounts[acctName]
      getBalance(acctName, acct.cookie, acct.ua, callback)
    },
    function done() {
      console.log(allsummary)
      if (!program.noemail) {
        sendMail('Perk Status: ' + moment().format('YYYYMMDD-HHmmss'), allsummary)
      }
    })
}

main()

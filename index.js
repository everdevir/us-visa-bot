#!/usr/bin/env node

import 'dotenv/config'
import fetch from 'node-fetch';
import cheerio from 'cheerio';
import fs from 'fs'

const USERNAME = process.env.ais_USERNAME
const PASSWORD = process.env.ais_PASSWORD
//const FACILITY_ID = process.env.ais_FACILITY_ID
//const FACILITY_ID = process.env.ais_FID
//const EMBASSY_COUNTRY = process.env.ais_EMBASSY_COUNTRY
//const EMBASSY_COUNTRY = process.env.EMB

async function main(currentBookedDate) {
  if (!currentBookedDate) {
    log(`Invalid current booked date: ${currentBookedDate}`)
    process.exit(1)
  }

  log(`Initializing ${EMBASSY_COUNTRY} with current date ${currentBookedDate}`)

  var i = 1
  try {
    const sessionHeaders = await login()
    while(true) {
      var fid = FACILITY_IDS[i%2]
      const date = await checkAvailableDate(sessionHeaders, fid)

      if (!date) {
        log(`no dates available in ${fid}`)
      } else if (date > currentBookedDate) {
        log(`nearest date is further than already booked (${currentBookedDate} vs ${date})`)
      } else {
        currentBookedDate = date
        log(`Found!`)
        const time = await checkAvailableTime(sessionHeaders, fid, date)

        book(sessionHeaders, fid, date, time)
          .then(d => log(`booked time at ${date} ${time}`))
      }
      await sleep(sleep_secs) // instead of 3
      i++
    }

  } catch(err) {
    console.error(err)
    log("Trying again")

    main(currentBookedDate)
  }
}

async function login() {
  log(`Logging in`)

  const anonymousHeaders = await fetch(`${BASE_URI}/users/sign_in`)
    .then(response => extractHeaders(response))

  return fetch(`${BASE_URI}/users/sign_in`, {
    "headers": Object.assign({}, anonymousHeaders, {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }),
    "method": "POST",
    "body": new URLSearchParams({
      'utf8': '✓',
      'user[email]': USERNAME,
      'user[password]': PASSWORD,
      'policy_confirmed': '1',
      'commit': 'Acessar'
    }),
  })
    .then(res => (
      Object.assign({}, anonymousHeaders, {
        'Cookie': extractRelevantCookies(res)
      })
    ))
}

function checkAvailableDate(headers, fid) {
  return fetch(`${BASE_URI}/schedule/${SCHEDULE_ID}/appointment/days/${fid}.json?appointments[expedite]=false`, {
    "headers": Object.assign({}, headers, {
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    }),
    "cache": "no-store"
  })
    .then(function (r) {
      log(`${r.status}`)
      const fileStream = fs.createWriteStream('captures/c.txt', {flags:'a'})
      r.body.pipe(fileStream)
      return r.json()
    })
    .then(r => handleErrors(r))
    .then(d => d.length > 0 ? d[0]['date'] : null)

}

function checkAvailableTime(headers, fid, date) {
  return fetch(`${BASE_URI}/schedule/${SCHEDULE_ID}/appointment/times/${fid}.json?date=${date}&appointments[expedite]=false`, {
    "headers": Object.assign({}, headers, {
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    }),
    "cache": "no-store",
  })
    .then(r => r.json())
    .then(r => handleErrors(r))
    .then(d => d['business_times'][0] || d['available_times'][0])
}

function handleErrors(response) {
  const errorMessage = response['error']

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return response
}

async function book(headers, fid, date, time) {
  const url = `${BASE_URI}/schedule/${SCHEDULE_ID}/appointment`

  const newHeaders = await fetch(url, { "headers": headers })
    .then(response => extractHeaders(response))

  return fetch(url, {
    "method": "POST",
    "redirect": "follow",
    "headers": Object.assign({}, newHeaders, {
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    "body": new URLSearchParams({
      'utf8': '✓',
      'authenticity_token': newHeaders['X-CSRF-Token'],
      'confirmed_limit_message': '1',
      'use_consulate_appointment_capacity': 'true',
      'appointments[consulate_appointment][facility_id]': fid,
      'appointments[consulate_appointment][date]': date,
      'appointments[consulate_appointment][time]': time,
      'appointments[asc_appointment][facility_id]': '',
      'appointments[asc_appointment][date]': '',
      'appointments[asc_appointment][time]': ''
    }),
  })
}

async function extractHeaders(res) {
  const cookies = extractRelevantCookies(res)

  const html = await res.text()
  const $ = cheerio.load(html);
  const csrfToken = $('meta[name="csrf-token"]').attr('content')

  return {
    "Cookie": cookies,
    "X-CSRF-Token": csrfToken,
    "Referer": BASE_URI,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive'
  }
}

function extractRelevantCookies(res) {
  const parsedCookies = parseCookies(res.headers.get('set-cookie'))
  return `_yatri_session=${parsedCookies['_yatri_session']}`
}

function parseCookies(cookies) {
  const parsedCookies = {}

  cookies.split(';').map(c => c.trim()).forEach(c => {
    const [name, value] = c.split('=', 2)
    parsedCookies[name] = value
  })

  return parsedCookies
}

function sleep(s) {
  return new Promise((resolve) => {
    setTimeout(resolve, s * 1000);
  });
}

function log(message) {
  console.log(`[${date()}]`, message)
}

function date() {
  var tzoffset = ((new Date()).getTimezoneOffset() + 4.5*60) * 60000
  var localISOTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, -1)
  return localISOTime
}

const args = process.argv.slice(2);
const currentBookedDate = args[0]
const sleep_secs = args[1]
const EMBASSY_COUNTRY = args[2]
const FACILITY_IDS = args[3].split(',')
const SCHEDULE_ID = args[4]

const BASE_URI = `https://ais.usvisa-info.com/${EMBASSY_COUNTRY}/niv`

main(currentBookedDate)

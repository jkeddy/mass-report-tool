import { URL } from 'url';
import fs from 'fs';
import path from 'path';
import {exec} from 'child_process';
import https from 'https';

import inquirer from 'inquirer';
import xml2js from 'xml2js';
import puppeteer from 'puppeteer';
import lighthouse from 'lighthouse'

clearFolder('reports/');
inquirer.prompt([
    {
        type: 'input',
        name: 'sitemapUrl',
        message: 'Enter sitemap url: ',
        validate: function (value) {
            var pass = value.match(
                /^(https):\/\/[^ "]+$/
            );
            if (pass) {
                return true;
            }
            return 'Please enter a valid url';
        }
    },
    {
        type: 'confirm',
        name: 'lighthouseFlag',
        message: 'Do you want to run lighthouse? (y/n): ',
        default: true,
    },
    {
        type: 'confirm',
        name: 'pa11yFlag',
        message: 'Do you want to run pa11y? (y/n): ',
        default: true,
    }
]).then(answers => {
    console.log(answers);
    scanSites(answers);
});
//https://annualreport.theocc.com/sitemap.xml
//https://uat.owens.co.nz/sitemap.xml
function scanSites(answers) { 
    const sitemapUrl = answers.sitemapUrl;
    const lighthouseFlag = answers.lighthouseFlag;
    const pa11yFlag = answers.pa11yFlag;
    let NETWORK_PRESETS = {
        'GPRS': {
          'offline': false,
          'downloadThroughput': 50 * 1024 / 8,
          'uploadThroughput': 20 * 1024 / 8,
          'latency': 500
        },
        'Regular2G': {
          'offline': false,
          'downloadThroughput': 250 * 1024 / 8,
          'uploadThroughput': 50 * 1024 / 8,
          'latency': 300
        },
        'Good2G': {
          'offline': false,
          'downloadThroughput': 450 * 1024 / 8,
          'uploadThroughput': 150 * 1024 / 8,
          'latency': 150
        },
        'Regular3G': {
          'offline': false,
          'downloadThroughput': 750 * 1024 / 8,
          'uploadThroughput': 250 * 1024 / 8,
          'latency': 100
        },
        'Good3G': {
          'offline': false,
          'downloadThroughput': 1.5 * 1024 * 1024 / 8,
          'uploadThroughput': 750 * 1024 / 8,
          'latency': 40
        },
        'Regular4G': {
          'offline': false,
          'downloadThroughput': 4 * 1024 * 1024 / 8,
          'uploadThroughput': 3 * 1024 * 1024 / 8,
          'latency': 20
        },
        'DSL': {
          'offline': false,
          'downloadThroughput': 2 * 1024 * 1024 / 8,
          'uploadThroughput': 1 * 1024 * 1024 / 8,
          'latency': 5
        },
        'WiFi': {
          'offline': false,
          'downloadThroughput': 30 * 1024 * 1024 / 8,
          'uploadThroughput': 15 * 1024 * 1024 / 8,
          'latency': 2
        }
      }
    // cwv example
    let cwv = [{
        "url": null,
        "largest-contentful-paint": null,
        "first-contentful-paint": null,
        "speed-index": null,
        "cumulative-layout-shift": null,
        "total-blocking-time": null
    }]
    let urls = [];
    https.get(sitemapUrl, res => {
        let data = '';
        res.on('data', chunk => {
            data += chunk;
        });
        res.on('end', () => {
            console.log('Sitemap downloaded successfully.');
            new Promise((resolve, reject) => {
                const parser = new xml2js.Parser();
                parser.parseString(data, (err, result) => {
                    if (err) {
                        console.error(err);
                        return;
                    }

                    urls = result.urlset.url.map(url => url.loc[0]);
                    console.log(urls);
                });
                resolve(urls);
            }).then((data) => {
                (async () => {
                    const test = ["https://www.css-tricks.com"]
                    // clearing the core web vitals array
                    cwv = []
                    // convert this to {} later, this is just an example
                    let lhcwv = {
                        "url": null,
                        "largest-contentful-paint": null,
                        "first-contentful-paint": null,
                        "speed-index": null,
                        "cumulative-layout-shift": null,
                        "total-blocking-time": null
                    }
                    const browser = await puppeteer.launch({
                        headless: "new",
                    });
                    const page = await browser.newPage();
                    // Connect to Chrome DevTools
                    const client = await page.target().createCDPSession()
                    // Set throttling property
                    await client.send('Network.emulateNetworkConditions', NETWORK_PRESETS['Regular3G'])
                    let reportFilename
                    // change data to test to run a single test
                    for (const url of data) {
                        await page.goto(url);
                        if(lighthouseFlag) {
                            const lighthouseResult = await lighthouse(page.url(), {
                                port: (new URL(browser.wsEndpoint())).port,
                                // output: 'json',
                                output: 'html',
                                logLevel: 'info',
                                emulatedFormFactor: 'mobile',
                                throttlingMethod: 'provided',
                                maxWaitForFcp: 15000,
                            });
                            // console.log(lighthouseResult)
                            lhcwv['url'] = url
                            lhcwv['largest-contentful-paint'] = lighthouseResult.lhr.audits['largest-contentful-paint']
                            lhcwv['first-contentful-paint'] = lighthouseResult.lhr.audits['first-contentful-paint']
                            lhcwv['speed-index'] = lighthouseResult.lhr.audits['speed-index']
                            lhcwv['cumulative-layout-shift'] = lighthouseResult.lhr.audits['cumulative-layout-shift']
                            lhcwv['total-blocking-time'] = lighthouseResult.lhr.audits['total-blocking-time']

                            cwv.push(lhcwv)
                            // console.log(lhcwv)

                            reportFilename = `${url.replace(/[^a-z0-9]/gi, '_')}-report.html`;
                            fs.writeFileSync(`reports/lighthouse/${reportFilename}`, lighthouseResult.report);
                            console.log(`Lighthouse report for ${url} written to ${reportFilename}`);
                        }
                        if(pa11yFlag) {
                            reportFilename = `${url.replace(/[^a-z0-9]/gi, '_')}-report.html`;
                            exec(`npx pa11y --reporter html ${url} > reports/pa11y/${reportFilename}`, (err, stdout, stderr) => {
                                console.log(`Pa11y report for ${url} written to ${reportFilename}`);
                            });
                            // spawn(`pa11y --reporter html ${url} > reports/pa11y/${reportFilename}`, {shell: true});
                            // fork(`pa11y --reporter html ${url} > reports/pa11y/${reportFilename}`, {shell: true});
                        }
                    }
                    
                    await browser.close();
                    await averageCoreWebVitals(cwv)
                })();
                
            })
        });
    }).on('error', err => {
        console.error(err);
    });
}

function clearFolder(folderPath) {
    console.log(`clearing ${folderPath}`)
    if (fs.existsSync(folderPath)) {
      fs.readdirSync(folderPath).forEach((file) => {
        const filePath = path.join(folderPath, file);
        if (fs.lstatSync(filePath).isDirectory()) {
          clearFolder(filePath);
        } else {
          fs.unlinkSync(filePath);
        }
      });
    }
  }

function averageCoreWebVitals(data) {
    // function to average all core web vitals found in the data array
    // return an object with the average values
    const avg = (data, name) => {
        return data
        .map(item => item[name].numericValue / 1000)
        .reduce((a, b) => a + b, 0) / data.length
    }
    let average = {
        "largest-contentful-paint": `${avg(data, 'largest-contentful-paint').toString().substring(0,3)} seconds`,
        "first-contentful-paint": `${avg(data, 'first-contentful-paint').toString().substring(0,3)} seconds`,
        "speed-index": `${avg(data, 'speed-index').toString().substring(0,3)} seconds`,
        "cumulative-layout-shift": `${avg(data, 'cumulative-layout-shift').toString().substring(0,3)} seconds`,
        "total-blocking-time": `${avg(data, 'total-blocking-time').toString().substring(0,3)} seconds`
    }
    console.log('|=====================Core Web Vitals=====================|')
    console.log(average)
    console.log('|=========================================================|')
}
//https://uat.chemcouriers.com/sitemap.xml
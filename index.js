/* global process */
/*global Buffer */
/**
 * @file Report downloader class which provides a single function to download a salesforce report.
 * @author Divya van Mahajan <dvm@vanmahajan.com>
 */
'use strict';

var stringify = require('csv-stringify');
var jsforce = require('jsforce');
var fs = require('fs');
var moment = require('moment');
require('moment-range');

// External inputs
var reportID;
var datefield;
var indexfieldOffset=0;
var StartDate = moment();
var EndDate = moment();
var lastUpdate = moment();
// Internal global state
var OutputFile = 'ReportOutput.csv';
var WAIT_BETWEEN_REQUESTS = 3000; // 3 seconds
var UserName = process.env.SF_USER;
var SFPassToken = process.env.SF_PASSWD_WITH_TOKEN;
var MAX_CONCURRENT = 20;
var i = 1;
var n = 0;
var async_report_requests=0;
var async_report_success=0;
var global_record_count = 0;
var global_written_count = 0;

var conn = new jsforce.Connection();


/**
 * Download the report. Command line wrapper
 * SF_USER - Environment variable with the user name.
 * SF_PASSWD_WITH_TOKEN - Environment variable with the password and security token.
 *
 * Command line:
 * downloadreport reportid datefield indexfieldoffset startdate enddate
 */
module.exports.downloadCommand = function() {
  if (process.argv.length <7 ) {
      console.error('Usage: '+process.argv[0]+' '+process.argv[1]+' reportid datefield indexfieldOffset 2016-01-01 2016-01-05');
      return;
  } else {
    module.exports.downloadreport(process.argv[2],process.argv[3],process.argv[4],
      process.argv[5],process.argv[6],process.env.SF_USER,process.env.SF_PASSWD_WITH_TOKEN);
  }
}

/**
 * Download the report.
 *
 * @protected
 * @param {String} _reportID - Salesforce report identifier. You can get this from the URL when you are viewing the report.
 * @param {String} _datefield - Internal name of the date field used in the standard date filter. << TODO >>
 * @param {String} _indexfieldOffset - Column that should be displayed while running the report (starts at 0). By default the first column is shown.
 * @param {Date} _startDate - Starting date in the format YYYY-MM-DD.
 * @param {Date} _endDate - Ending date in the format YYYY-MM-DD.
 * @param {String} _user - username.
 * @param {String} _password - password with security token.
 * @param {Object} SFOptions - Initialization options for jsforce (see http://jsforce.github.io/jsforce/doc/Connection.html)
 */
module.exports.downloadreport = function(_reportID,_datefield,_indexfieldOffset,_startDate,_endDate,_username,_password,SFOptions) {
  conn = new jsforce.Connection(SFOptions);

  reportID=_reportID;
  datefield=_datefield;
  indexfieldOffset=_indexfieldOffset;
  StartDate=moment(_startDate);
  EndDate=moment(_endDate);
  lastUpdate=moment();
  UserName = _username;
  SFPassToken = _password;

  async_report_requests=0;
  async_report_success=0;
  global_record_count=0;
  global_written_count=0;
  i = 1;
  n = 0;


  OutputFile = 'ReportOutput_' + StartDate.format("YYYY-MM-DD") + '_to_' + EndDate.format("YYYY-MM-DD") + '.csv';

  conn.login(UserName, SFPassToken).
      then(function () {
          return conn.identity();
      }, function (err) {
          console.error(err);
          console.error('Please check you have set the following environment variables');
          console.error('SF_USER');
          console.error('SF_PASSWD_WITH_TOKEN=password and security token');
      }).then(function (res) {
          console.log('Logged into Salesforce');
          //console.log("organization ID: " + res.organization_id);
          //console.log("user ID: " + res.user_id);
          console.log("username: " + res.username + "(" + res.display_name + ")");

      }).then(function () {
          return getReportForDateRange(StartDate, EndDate, "days");
      }, writeOutErrorFn('login')).then(function () {
          console.log("=============================");
          console.log("Report       :" + reportID);
          console.log("Date range   :" + StartDate.format('YYYY-MM-DD')+" to "+ EndDate.format('YYYY-MM-DD'));
          console.log("Output to    :" + OutputFile);
          console.log('Done         :' + global_written_count + " records written.");
          console.log('Async reports:'+async_report_requests+' - (succeeded:'+async_report_success+',failed:'+(async_report_requests - async_report_success)+').')
      }, writeOutErrorFn('jsforce_report.downloadreport'))
      .catch(function (err) {
          console.error(err);
      });
  console.log("Starting here....");
  console.log("Report:" + reportID);
  console.log("Output to:" + OutputFile);
  console.log("Start:" + StartDate.format('YYYY-DD-MM'));
  console.log("End:" + EndDate.format('YYYY-DD-MM'));
}






function writeOutErrorFn(message) {
    return function (err) {
        console.error(message + ":" + err);
    };
}





function getReportForDateRange(startdate, enddate, interval) {
    var indexfieldOffset = 5; // Index of field to display
    var range1 = moment.range(startdate, enddate);
    var promisegroups = new Array(MAX_CONCURRENT);

    if (interval == undefined) {
        interval = "days";
    }
    var data = '';
    //console.log('GenUtilization');
    var promise = prepareCSV(reportID, data).then(function (stringifier) {
        var getInstancePromises = [];
        var concurrentPromises = new Array(MAX_CONCURRENT);
        var instances = [];
        var i = 0;
        var j = 0;
        range1.by(interval, function (start) {
            var t = j; // Make a local copy of j so it stays frozen
            //t=i;i=i+1;
            var st = start.clone();
            var end = start.clone();
            end.add(1, interval).subtract(1, "ms");
            if (concurrentPromises[j] == undefined) {
                console.log(t + ":Start Range: " + st.format() + " - " + end.format());
                concurrentPromises[j] = startAsyncReport(start, end).then(
                    processAsyncReportInstanceFn(instances, t, st, end, stringifier)
                    , writeOutErrorFn(t +":Error starting report for range: " + start.format() + " - " + end.format() + ":")
                    );
            } else {
                concurrentPromises[j] = concurrentPromises[j].then(function () {
                    console.log(t + ":Chain Range: " + start.format() + " - " + end.format());
                    var promise2 = startAsyncReport(start, end).then(
                        processAsyncReportInstanceFn(instances, t, st, end, stringifier)
                        , writeOutErrorFn(t +":Error starting report for range: " + start.format() + " - " + end.format() + ":"));
                    return promise2;
                });
            }
            j = (j + 1) % MAX_CONCURRENT;
            async_report_requests++;
        });
        return Promise.all(concurrentPromises).then(function () {
            stringifier.end();
        });
    });
    return promise;
}


function prepareCSV(reportID) {
    var data = '';
    var row;
    //console.log('Prepare CSV');
    // Write out the data
    var stringifier = stringify({ delimiter: ',' });

    stringifier.on('readable', function () {
        while (row = stringifier.read()) {
            data += row;
        }
    });
    stringifier.on('error', function (err) {
        console.log(err.message);
    });
    stringifier.on('finish', function () {
        fs.writeFile(OutputFile, data);
    });

    //stringifier.pipe(fs.createWriteStream('data/outputDateRange.csv'));
    var report = conn.analytics.report(reportID);
    return report.describe().then(function (result) {
        var columns = ["lastUpdated"];
        result.reportMetadata.detailColumns.map(function (cname) {
            columns.push(cname + "_label");
            columns.push(cname + "_value");
        });
        stringifier.write(columns);
        return stringifier;
    }, function (err) {
        console.err('prepareCSV: Cannot get report metadata:' + err);
    });
}

function startAsyncReport(startdate, enddate) {
    var metadata = {
        reportMetadata: {
            "standardDateFilter": {
                "column": datefield,
                "durationValue": "CUSTOM",
                "endDate": enddate.format(),
                "startDate": startdate.format()
            }
        }
    };
    var report = conn.analytics.report(reportID);
    var reportoptions = {
        "details": true,
        "metadata": metadata
    };
    var promise = report.executeAsync(reportoptions);
    return promise;
}

//
//
// Create a callbackfunction for processing after an async report is submitted.
//
function processAsyncReportInstanceFn(instances, t, st, end, stringifier) {
    return function (instance) {
        async_report_success++;
        instances.push(instance); // Can be removed for large report data sets
        var report = conn.analytics.report(reportID);
        var reportinstance = report.instance(instance.id);
        var promise0 = delay(WAIT_BETWEEN_REQUESTS).then(function () {
            //var promise1=reportinstance.retrieve().then(function(results) {
            var promise1 = waitForInstance(reportinstance, WAIT_BETWEEN_REQUESTS).then(function (results) {
                console.log(t + ":Returned Range: " + st.format() + " - " + end.format() + ":" + results.attributes.status);
                // fs.writeFile('tmp/output-' + n + '.json', JSON.stringify(results));
                writeResult(stringifier, results);
                n = n + 1;
                console.log(results.factMap["T!T"].aggregates[0].value + " records")

                var firstrow = results.factMap["T!T"].rows[0].dataCells[indexfieldOffset];
                var lastrow = results.factMap["T!T"].rows.pop().dataCells[indexfieldOffset];
                //console.log(JSON.stringify(lastrow));
                var label = lastrow.label;
                var val = lastrow.value;
                console.log("First: " + firstrow.label + " " + firstrow.value)
                console.log("Last : " + label + " " + val);
                console.log("Package size:" + results.factMap["T!T"].rows.length);
                global_record_count = global_record_count + results.factMap["T!T"].rows.length;
                if (results.allData == false) {
                    console.error(t + ":Incomplete results for range:" + st.format() + " - " + end.format());
                }
            }, writeOutErrorFn('Error reading instance ' + instance.id + " (" + st.format() + " - " + end.format() + ")"));
            return promise1;
        });
        return promise0;
    };
}


function waitForInstance(reportinstance) {
    var waitpromise = Promise.resolve();
    function checkStatus() {
        return waitpromise.then(function () {
            return delay(WAIT_BETWEEN_REQUESTS)
                .then(function () {
                    return reportinstance.retrieve()
                })
                .then(function (result) {
                    var status = result.attributes.status;
                    if (status != "Success" && status != "Error") {
                        return checkStatus();
                    }
                    return result;
                }, function (err) {
                    console.error('Cannot retrieve instance status:' + err);
                });
        });
    }
    return checkStatus();
}

function delay(time) {
    return new Promise(function (fulfill) {
        setTimeout(fulfill, time);
    });
}


function writeResult(stringifier, results) {
    //console.log('Writeresult:'+stringifier);
    var rows = results.factMap["T!T"].rows;

    //console.log(rows.length);
    // fs.writeFile('data/rowsA.json', JSON.stringify(rows[0]));
    
    for (var k = 0; k < rows.length; k++) {
        //console.log(JSON.stringify(rowval));
        //console.log('Writeresult:'+k);
        var datacells = rows[k]["dataCells"];
        var rowout = [lastUpdate.format()]; // Update date/time - is the same as the start of the download.
        var k1;
        for (k1 = 0; k1 < datacells.length; k1++) {
            rowout.push(datacells[k1].label);
            rowout.push(datacells[k1].value);
        }
        //console.log(JSON.stringify(rowout));
        stringifier.write(rowout);
        //console.log('Writeresult1:'+k);
    }
    global_written_count = global_written_count + rows.length;

    //	console.log('Writeresult:done');

}

/* global process */
var stringify = require('csv-stringify');
var jsforce = require('jsforce');
var fs = require('fs');
var moment = require('moment');
require('moment-range');
var conn = new jsforce.Connection();

var UtilizationReportID = '00OE0000002wlroMAA';
var StartDate = '2015-02-01';
var EndDate = '2015-02-15';
var async_report_requests=0;
var async_report_success=0;
var OutputFile = 'data/ReportOutput_' + StartDate + '_to_' + EndDate + '.csv';
var WAIT_BETWEEN_REQUESTS = 3000; // 3 seconds
var UserName = process.env.SF_USER;
var SFPassToken = process.env.SF_PASSWD_WITH_TOKEN;
var MAX_CONCURRENT = 20;

if (process.argv.length <4 ) {
    console.error('Usage: '+process.argv[0]+' '+process.argv[1]+' 2014-01-01 2014-12-31');
    return;
} else {
    StartDate = process.argv[2];
    EndDate = process.argv[3];
}



var i = 1;
var n = 0;

var db;
var global_record_count = 0;
var global_written_count = 0;

function prepareCSV(reportID) {
    var data = '';
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

function writeResult(stringifier, results) {
    //console.log('Writeresult:'+stringifier);
    var rows = results.factMap["T!T"].rows;
	
    //console.log(rows.length);
    fs.writeFile('data/rowsA.json', JSON.stringify(rows[0]));
    for (k = 0; k < rows.length; k++) {	
        //console.log(JSON.stringify(rowval));
        //console.log('Writeresult:'+k);
        var datacells = rows[k]["dataCells"];
        var rowout = [moment().format()]; // Updated right now!
        var k1;
        rowout
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

function writeOutErrorFn(message) {
    return function (err) {
        console.error(message + ":" + err);
    };
}

function delay(time) {
    return new Promise(function (fulfill) {
        setTimeout(fulfill, time);
    });
}

function waitForInstance(reportinstance, waitdelay) {
    var waitpromise = Promise.resolve();
    function checkStatus() {
        return waitpromise.then(function () {
            return delay(waitdelay)
                .then(function () {
                    return reportinstance.retrieve()
                })
                .then(function (result) {
                    /*
                    if (result == undefined || result.attributes == undefined || result.attributes.status == undefined)
                    {
                        console.error('Result undefined - retrying');
                        return checkStatus();                    
                    }
                    */
                    status = result.attributes.status;
                    if (status != "Success" && status != "Error") {
                        return checkStatus();
                    }
                    return result;
                }, function (err) {
                    console.error('Cannot retrieve instance status:' + err);
                    //return checkStatus();
                });
        });
    }
    return checkStatus();
}


//
// 

// Create a callbackfunction for processing after an async report is submitted.
// 
function processAsyncReportInstanceFn(instances, reportID, waitdelay, t, st, end, stringifier, indexfieldOffset) {
    return function (instance) {
        async_report_success++;
        instances.push(instance); // Can be removed for large report data sets
        var report = conn.analytics.report(reportID);
        var reportinstance = report.instance(instance.id);
        var promise0 = delay(waitdelay).then(function () {
            //var promise1=reportinstance.retrieve().then(function(results) {
            var promise1 = waitForInstance(reportinstance, waitdelay).then(function (results) {
                console.log(t + ":Returned Range: " + st.format() + " - " + end.format() + ":" + results.attributes.status);
                fs.writeFile('tmp/output-' + n + '.json', JSON.stringify(results));
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
function getUtilizationReportForDateRange(startdate, enddate, interval) {
    var reportID = UtilizationReportID;
    var indexfieldOffset = 5; // Index of field to display
    var waitdelay = WAIT_BETWEEN_REQUESTS; // 60000 ms
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
                concurrentPromises[j] = getUtilizationReportAsync(start, end).then(
                    processAsyncReportInstanceFn(instances, reportID, waitdelay, t, st, end, stringifier, indexfieldOffset)
                    , writeOutErrorFn(t +":Error starting report for range: " + start.format() + " - " + end.format() + ":")
                    );
            } else {
                concurrentPromises[j] = concurrentPromises[j].then(function () {
                    console.log(t + ":Chain Range: " + start.format() + " - " + end.format());
                    var promise2 = getUtilizationReportAsync(start, end).then(
                        processAsyncReportInstanceFn(instances, reportID, waitdelay, t, st, end, stringifier, indexfieldOffset)
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



function getUtilizationReportAsync(startdate, enddate) {
    var reportID = '00OE0000002wlroMAA';

    if (startdate == undefined) {
        throw "No start date";
    }
    if (enddate == undefined) {
        throw "No end date";
    }

    var metadata = {
        reportMetadata: {
/*            
            "reportFilters": [
                {
                    "column": "Labor__c.CreatedBy.Alias",
                    "operator": "contains",
                    "value": "scsf0,scss0,scsh0,scse0,scsi0,scsr0,scss1,scsh1,scse1,scsi1,scss2"
                },
                {
                    "column": "Labor__c.Category__c",
                    "operator": "notContain",
                    "value": "Nemo,Onsite"
                }
            ],

            "sortBy": [
                {
                    "sortColumn": "Labor__c.Name",
                    "sortOrder": "Asc"
                }
            ],
*/
            "standardDateFilter": {
                "column": "Labor__c.CreatedDate",
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
        return getUtilizationReportForDateRange(StartDate, EndDate, "days");
    }, writeOutErrorFn('login')).then(function () {
        console.log("=============================");
        console.log("Output to:" + OutputFile);
        console.log("Start:" + StartDate);
        console.log("End:" + EndDate);
        console.log("Report:" + UtilizationReportID);
        console.log('Done:' + global_record_count + " records, " + global_written_count + " written.");
        console.log('Async reports requested:'+async_report_requests+' of which '+(async_report_requests - async_report_success)+' failed.')
    }, writeOutErrorFn('getUtilizationReportForDateRange'))
    .catch(function (err) {
        console.error(err);
    });
/*MongoClient.connect('mongodb://localhost/defects', function (err, mongodb) {
	assert.equal(null, err);
	db = mongodb;
	console.log("Connected to mongo server");
});
*/
console.log("Starting here....");
console.log("Output to:" + OutputFile);
console.log("Start:" + StartDate);
console.log("End:" + EndDate);
console.log("Report:" + UtilizationReportID);

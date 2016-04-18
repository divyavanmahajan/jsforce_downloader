/* global process */
/* global Buffer */
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
var indexfieldOffset = 0;
var StartDate = moment();
var EndDate = moment();
var lastUpdate = moment().utc();
// Internal global state
var OutputFile = 'ReportOutput.csv';
var i = 1;
var n = 0;
var async_report_requests = 0;
var async_report_success = 0;
var global_record_count = 0;
var global_written_count = 0;

var conn = new jsforce.Connection();
var config = {
    MAX_CONCURRENT: 30, 
    // 30 parallel async report requests
    
    WAIT_BETWEEN_REQUESTS: 1000, 
    // 1000 milliseconds
    
    REPORTSECTION: "T!T", 
    // REPORTSECTION - The section of the report that you want to see. This is explained in the 
    // [Salesforce Analytics REST API guide](https://resources.docs.salesforce.com/sfdc/pdf/salesforce_analytics_rest_api.pdf) 
    // - in the section decode the Fact Map. 
    
    WRITE_TEMP_FILES: !fs.existsSync('./tmp'), 
    // Store output of each async report to the tmp subdirectory.
    
    SFOptions: {
        loginUrl: "https://login.salesforce.com"
    }, 
    // Initialization options for jsforce (see http://jsforce.github.io/jsforce/doc/Connection.html)
    
    SF_USER: process.env.SF_USER,
    SF_PASSWD_WITH_TOKEN: process.env.SF_PASSWD_WITH_TOKEN,
    
    REPORTPREFIX: "ReportOut_",
    // File name generated is REPORTPREFIX + reportid + startdate + enddate + execution timestamp
    
    OUTPUTTO: "file", 
    // This can be 'file' - to write results to a file; or 's3' - to write results to a S3 object.
    
    AWSCONFIG: {
        //accessKeyId: 'AKID', secretAccessKey: 'SECRET', 
        region: 'us-east-1'
    }, 
    // This is required when you are using AWS S3 outside AWS Lambda and have not set the environment variables AWS_ACCESS_KEY and AWS_SECRET_KEY.  
    // See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
        
    S3BUCKET: "", 
    // S3 bucket if OUTPUTTO is set to "s3".
    
    S3KEYPREFIX: "" 
    // S3 key prefix if OUTPUTTO is set to "s3". This is the path where you want to store the output file.
};


module.exports.config = config;
var AWS;
module.exports.initialize = function(_config) {
    if (typeof (_config) != "undefined") {
        for (var key in _config)
            config[key] = _config[key];
    }

    if (config['OUTPUTTO'] == "s3") {
        AWS = require('aws-sdk');
        AWS.config.sslEnabled = true;
        for (var k in config.AWSCONFIG)
            AWS.config[k] = config.AWSCONFIG[k];

    }
    module.exports.config = config;
}

/**
 * Download the report. Command line wrapper
 * SF_USER - Environment variable with the user name.
 * SF_PASSWD_WITH_TOKEN - Environment variable with the password and security token.
 *
 * Command line:
 * downloadreport reportid datefield indexfieldoffset startdate enddate
 */
module.exports.downloadCommand = function() {
    if (process.argv.length < 7) {
        console.error('Usage: ' + process.argv[0] + ' ' + process.argv[1] + ' reportid datefield indexfieldOffset 2016-01-01 2016-01-05 [10, [T!T]]');
        console.error('\t10 - Number of concurrent requests.');
        console.error('\tT!T - The report section that should be downloaded.');
        console.error('\n\tPlease ensure you set the environment variable SF_USER, SF_PASSWD_WITH_TOKEN');
        console.error('\tIf you have a tmp subdirectory, the raw json output from the report will be stored in that directory');
        return;
    } else {
        if (typeof process.argv[7] === "number") {
            config.MAX_CONCURRENT = process.argv[7];
        }
        if (typeof process.argv[8] === "string") {
            config.REPORTSECTION = process.argv[8];
        }
	module.exports.initialize();
        module.exports.downloadreport(process.argv[2], process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
    }
}

/**
 * Download the report to S3 bucket. Command line wrapper
 * SF_USER - Environment variable with the user name.
 * SF_PASSWD_WITH_TOKEN - Environment variable with the password and security token.
 * AWS_ACCESS_KEY - Access Key ID
 * AWS_SECRET_KEY - Secret for Access Key
 * Command line:
 * downloadreport reportid datefield indexfieldoffset startdate enddate s3bucket s3path
 */
module.exports.downloadCommandS3 = function() {
    if (process.argv.length < 9) {
        console.error('Usage: ' + process.argv[0] + ' ' + process.argv[1] + ' reportid datefield indexfieldOffset 2016-01-01 2016-01-05 s3bucket s3path [awsregion]');
        console.error('\n\tPlease ensure you set the environment variable AWS_ACCESS_KEY, AWS_SECRET_KEY, SF_USER, SF_PASSWD_WITH_TOKEN');
        console.error('\tIf you have a tmp subdirectory, the raw json output from the report will be stored in that directory');
        return;
    } else {
        config.OUTPUTTO = "s3";
        config.S3BUCKET = process.argv[7];
        config.S3KEYPREFIX = process.argv[8];
        if (typeof process.argv[9] === "string") {
            config.AWSCONFIG.region = process.argv[9];
            console.log('Switching AWS region to '+config.AWSCONFIG.region);
        }
	module.exports.initialize();
        module.exports.downloadreport(process.argv[2], process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
    }
}

module.exports.downloadreport_file = function(_reportID, _startDate, _endDate) {
    var today = lastUpdate.format('YYYYMMDDHHMMSS');
    return config.REPORTPREFIX + _reportID + '_' + StartDate.format("YYYYMMDD") + '-' + EndDate.format("YYYYMMDD") + '_' + today + '.csv';
}
/**
 * Download the report.
 *
 * @protected
 * @param {String} _reportID - Salesforce report identifier. You can get this from the URL when you are viewing the report.
 * @param {String} _datefield - Internal name of the date field used in the standard date filter. 
 * @param {String} _indexfieldOffset - Column that should be displayed while running the report (starts at 0). By default the first column is shown.
 * @param {Date} _startDate - Starting date in the format YYYY-MM-DD.
 * @param {Date} _endDate - Ending date in the format YYYY-MM-DD.
 * @param {String} _user - username.
 * @param {String} _password - password with security token.
 */

module.exports.downloadreport = function(_reportID, _datefield, _indexfieldOffset, _startDate, _endDate) {
    conn = new jsforce.Connection(config.SFOptions);

    reportID = _reportID;
    datefield = _datefield;
    indexfieldOffset = _indexfieldOffset;
    StartDate = moment(_startDate, "YYYY-MM-DD");
    EndDate = moment(_endDate, "YYYY-MM-DD");
    lastUpdate = moment().utc();

    async_report_requests = 0;
    async_report_success = 0;
    global_record_count = 0;
    global_written_count = 0;
    i = 1;
    n = 0;


    OutputFile = module.exports.downloadreport_file(_reportID, _startDate, _endDate);

    conn.login(config.SF_USER, config.SF_PASSWD_WITH_TOKEN).
        then(function() {
            return conn.identity();
        }, function(err) {
            console.error(err);
            console.error('Please check you have set the following environment variables');
            console.error('SF_USER');
            console.error('SF_PASSWD_WITH_TOKEN=password and security token');
        }).then(function(res) {
            console.log('Logged into Salesforce');
            //console.log("organization ID: " + res.organization_id);
            //console.log("user ID: " + res.user_id);
            console.log("username: " + res.username + "(" + res.display_name + ")");

        }).then(function() {
            return getReportForDateRange(StartDate, EndDate, "days");
        }, writeOutErrorFn('login')).then(function() {
            console.log("=============================");
            console.log("Report       :" + reportID);
            console.log("Date range   :" + StartDate.format('YYYY-MM-DD') + " to " + EndDate.format('YYYY-MM-DD'));
            console.log("Output to    :" + OutputFile);
            console.log('Done         :' + global_written_count + " records written.");
            console.log('Async reports:' + async_report_requests + ' - (succeeded:' + async_report_success + ',failed:' + (async_report_requests - async_report_success) + ').')
        }, writeOutErrorFn('jsforce_report.downloadreport'))
        .catch(function(err) {
            console.error(err);
        });
    console.log("Starting here....");
    console.log("Report:" + reportID);
    console.log("Output to:" + OutputFile);
    console.log("Start:" + StartDate.format('YYYY-MM-DD'));
    console.log("End:" + EndDate.format('YYYY-MM-DD'));
}






function writeOutErrorFn(message) {
    return function(err) {
        console.error(message + ":" + err);
    };
}





function getReportForDateRange(startdate, enddate, interval) {
    var range1 = moment.range(startdate, enddate);
    var promisegroups = new Array(config.MAX_CONCURRENT);

    if (interval == undefined) {
        interval = "days";
    }
    var data = '';
    //console.log('GenUtilization');
    var promise = prepareCSV(reportID, data).then(function(stringifier) {
        var getInstancePromises = [];
        var concurrentPromises = new Array(config.MAX_CONCURRENT);
        var instances = [];
        var i = 0;
        var j = 0;
        range1.by(interval, function(start) {
            var t = j; // Make a local copy of j so it stays frozen
            //t=i;i=i+1;
            var st = start.clone();
            var end = start.clone();
            end.add(1, interval).subtract(1, "ms");
            if (concurrentPromises[j] == undefined) {
                console.log(t + ":Start Range: (" + st.format('YYYY-MM-DD') + " to " + end.format('YYYY-MM-DD') + ")");
                concurrentPromises[j] = startAsyncReport(start, end).then(
                    processAsyncReportInstanceFn(instances, t, st, end, stringifier)
                    , writeOutErrorFn(t + ":Error starting report for range: " + start.format('YYYY-MM-DD') + " - " + end.format('YYYY-MM-DD') + ":")
                );
            } else {
                concurrentPromises[j] = concurrentPromises[j].then(function() {
                    console.log(t + ":Chain Range: " + start.format() + " - " + end.format());
                    var promise2 = startAsyncReport(start, end).then(
                        processAsyncReportInstanceFn(instances, t, st, end, stringifier)
                        , writeOutErrorFn(t + ":Error starting report for range: " + start.format() + " - " + end.format() + ":"));
                    return promise2;
                }, writeOutErrorFn(t + ":Error running report for range: " + start.format() + " - " + end.format() + ":"));
            }
            j = (j + 1) % config.MAX_CONCURRENT;
            async_report_requests++;
        });
        return Promise.all(concurrentPromises).then(function() {
            stringifier.end();
        }, writeOutErrorFn("PromiseAll error"));
    }, writeOutErrorFn("PrepareCSV error"));
    return promise;
}

function onFinishWriteFile(data) {
    if (config.OUTPUTTO == "file") {
        fs.writeFile(OutputFile, data);
    }
    if (config.OUTPUTTO == "s3") {
        s3WriteFile(OutputFile, data);
    }
}

function s3WriteFile(filename, data) {
    if (typeof (AWS) == "undefined") {
        console.error("s3WriteFile:aws-sdk not loaded correctly");
    }
    var key = config.S3KEYPREFIX + "/" + filename;
    s3putobject(config.S3BUCKET, key, data);
}

function s3putobject(bucket, key, data) {
    var s3 = new AWS.S3();
    var params = { Bucket: bucket, Key: key, Body: data };

    s3.putObject(params, function(err, data) {
        if (err)
            console.log(err)
        else
            console.log("Successfully uploaded data to s3://" + bucket + "/" + key);
    });
}

function prepareCSV(reportID) {
    var data = '';
    var row;
    //console.log('Prepare CSV');
    // Write out the data
    var stringifier = stringify({ delimiter: ',' });

    stringifier.on('readable', function() {
        while (row = stringifier.read()) {
            data += row;
        }
    });
    stringifier.on('error', function(err) {
        console.log(err.message);
    });
    stringifier.on('finish', function() {
        onFinishWriteFile(data);
    });

    //stringifier.pipe(fs.createWriteStream('data/outputDateRange.csv'));
    var report = conn.analytics.report(reportID);
    return report.describe().then(function(result) {
        var columns = ["lastUpdated"];
        result.reportMetadata.detailColumns.map(function(cname) {
            cname = cname.replace(/\./g, '_');
            columns.push(cname + "_label");
            columns.push(cname + "_value");
        });
        stringifier.write(columns);
        return stringifier;
    }, function(err) {
        console.err('prepareCSV: Cannot get report metadata:' + err);
    });
}

function startAsyncReport(startdate, enddate) {
    var metadata = {
        reportMetadata: {
            "standardDateFilter": {
                "column": datefield,
                "durationValue": "CUSTOM",
                "endDate": enddate.format('YYYY-MM-DD'),
                "startDate": startdate.format('YYYY-MM-DD')
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
    return function(instance) {
        async_report_success++;
        instances.push(instance); // Can be removed for large report data sets
        var report = conn.analytics.report(reportID);
        var reportinstance = report.instance(instance.id);
        var promise0 = delay(config.WAIT_BETWEEN_REQUESTS).then(function() {
            //var promise1=reportinstance.retrieve().then(function(results) {
            var promise1 = waitForInstance(reportinstance, config.WAIT_BETWEEN_REQUESTS).then(function(results) {
                var message = "";
                var rSection = results.factMap[config.REPORTSECTION];
                if (typeof rSection === "undefined" || rSection.rows.length == 0) {
                    message = "No data in section " + config.REPORTSECTION;
                    if (config.WRITE_TEMP_FILES) {
                        fs.writeFile('tmp/empty-' + n + '.json', JSON.stringify(results));
                    }
                } else {
                    message = rSection.rows.length + " rows in section " + config.REPORTSECTION;
                    if (config.WRITE_TEMP_FILES) {
                        fs.writeFile('tmp/output-' + n + '.json', JSON.stringify(results));
                    }
                }
                console.log(t + ":Returned Range: (" + st.format('YYYY-MM-DD') + " to " + end.format('YYYY-MM-DD') + ") :" + results.attributes.status + ":" + message);
                if (typeof rSection === "undefined") {
                    return;
                }
                if (rSection.rows.length == 0) {
                    return;
                }
                writeResult(stringifier, results);
                n = n + 1;
                console.log(rSection.aggregates[0].value + " records");

                var firstrow = rSection.rows[0].dataCells[indexfieldOffset];
                var lastrow = rSection.rows.pop().dataCells[indexfieldOffset];
                //console.log(JSON.stringify(lastrow));
                var label = lastrow.label;
                var val = lastrow.value;
                console.log("First row: (" + firstrow.label + "," + firstrow.value + ")");
                console.log("Last row : (" + label + " " + val + ")");
                //console.log("Package size:" + rSection.rows.length);
                global_record_count = global_record_count + rSection.rows.length;
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
        return waitpromise.then(function() {
            return delay(config.WAIT_BETWEEN_REQUESTS)
                .then(function() {
                    return reportinstance.retrieve()
                })
                .then(function(result) {
                    var status = result.attributes.status;
                    if (status != "Success" && status != "Error") {
                        return checkStatus();
                    }
                    return result;
                }, function(err) {
                    console.error('Cannot retrieve instance status:' + err);
                });
        });
    }
    return checkStatus();
}

function delay(time) {
    return new Promise(function(fulfill) {
        setTimeout(fulfill, time);
    });
}


function writeResult(stringifier, results) {
    //console.log('Writeresult:'+stringifier);
    var rows = results.factMap[config.REPORTSECTION].rows;
    if (rows.length == 0) return;

    // TODO: to write file out in parts??
    //console.log(rows.length);
    // fs.writeFile('data/rowsA.json', JSON.stringify(rows[0]));
    try {
        for (var k = 0; k < rows.length; k++) {
            //console.log(JSON.stringify(rowval));
            //console.log('Writeresult:'+k);
            var datacells = rows[k]["dataCells"];
            var rowout = [lastUpdate.format('YYYY-MM-DD[T]HH:MM:SS[Z]')]; // Update date/time - is the same as the start of the download.
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

    } catch (error) {
        console.error("Writing CSV:" + error);
    }

    //	console.log('Writeresult:done');

}

/**
 * Display the report definition and its metadata.
 *
 * @protected
 * @param {String} _reportID - Salesforce report identifier. You can get this from the URL when you are viewing the report.
 */
module.exports.showMetadata = function(_reportID) {
    conn = new jsforce.Connection(config.SFOptions);

    reportID = _reportID;

    OutputFile = 'ReportMeta_' + reportID + '.json';

    conn.login(config.SF_USER, config.SF_PASSWD_WITH_TOKEN).
        then(function() {
            return conn.identity();
        }, function(err) {
            console.error(err);
            console.error('Please check you have set the following environment variables');
            console.error('SF_USER');
            console.error('SF_PASSWD_WITH_TOKEN=password and security token');
        }).then(function(res) {
            console.log('Logged into Salesforce');
            console.log("username: " + res.username + "(" + res.display_name + ")");
        }).then(function() {
            var report = conn.analytics.report(reportID);
            return report.describe();
        }).then(function(result) {
            console.log("Columns");
            result.reportMetadata.detailColumns.map(function(cname) {
                var col = result.reportExtendedMetadata.detailColumnInfo[cname];
                if (col) {
                    console.log("  " + cname + "\t" + col.dataType + "\t" + col.label);
                }
            });
            console.log("\nFilters");
            console.log(JSON.stringify(result.reportMetadata.reportFilters, null, 2));
            console.log("\nFor full metadata, see ReportMeta_" + reportID + ".json");
            fs.writeFile(OutputFile, JSON.stringify(result, null, 2));
            generateMySQLTable(_reportID, result.reportMetadata.detailColumns, result.reportExtendedMetadata.detailColumnInfo);
        }, writeOutErrorFn('Report describe: Cannot get report metadata:'))
        .catch(function(err) {
            console.error(err);
        });
    console.log("Requesting metadata for....");
    console.log("Report:" + reportID);
    console.log("Output to:" + OutputFile);
}

function generateMySQLTable(reportID, columns, info) {
    console.log("SQL Syntax for MySQL");
    console.log("CREATE TABLE R" + reportID + ' (');
    console.log("  lastUpdate datetime DEFAULT NULL,");

    columns.map(function(cname) {
        var col = info[cname];
        var sqltype = "varchar(250)";
        // http://www.chiragmehta.info/chirag/2011/05/16/field-datatype-mapping-between-oraclesql-server-and-salesforce/
        if (col.dataType == 'boolean') sqltype = "boolean";
        if (col.dataType == 'date') sqltype = "datetime";
        if (col.dataType == 'time') sqltype = "varchar(4000)";
        if (col.dataType == 'datetime') sqltype = "datetime";
        if (col.dataType == 'currency') sqltype = "double";
        if (col.dataType == 'double') sqltype = "double";
        if (col.dataType == 'int') sqltype = "int";
        if (col.dataType == 'picklist') sqltype = "varchar(255)";
        if (col.dataType == 'multipicklist') sqltype = "varchar(4000)";
        if (col.dataType == 'id') sqltype = "varchar(18)";
        if (col.dataType == 'reference') sqltype = "varchar(18)";
        if (col.dataType == 'textarea') sqltype = "varchar(4000)";
        if (col.dataType == 'email') sqltype = "varchar(255)";
        if (col.dataType == 'phone') sqltype = "varchar(255)";
        if (col.dataType == 'url') sqltype = "varchar(1000)";
        if (col.dataType == 'anyType') sqltype = "varchar(4000)";
        if (col.dataType == 'percent') sqltype = "decimal(5,2)";
        if (col.dataType == 'combobox') sqltype = "varchar(4000)";
        if (col.dataType == 'base64') sqltype = "varchar(4000)";
        if (col.dataType == 'string') sqltype = "varchar(4000)";
        cname = cname.replace(/\./g, '_');
        console.log("  " + cname + "_label varchar(255) DEFAULT NULL,");
        console.log("  " + cname + "_value " + sqltype + " DEFAULT NULL,");
    });
    console.log(") DEFAULT CHARSET=utf8");
}
/**
 * Download the report metadata. Command line wrapper
 * SF_USER - Environment variable with the user name.
 * SF_PASSWD_WITH_TOKEN - Environment variable with the password and security token.
 *
 * Command line:
 * download_meta reportid
 */
module.exports.showMetadataCmd = function() {
    if (process.argv.length < 2) {
        console.error('Usage: ' + process.argv[0] + ' ' + process.argv[1] + ' reportid');
        return;
    } else {
        module.exports.showMetadata(process.argv[2], process.env.SF_USER, process.env.SF_PASSWD_WITH_TOKEN);
    }
}

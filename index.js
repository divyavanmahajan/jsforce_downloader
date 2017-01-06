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

    WRITE_TEMP_FILES: false,
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

    GZIP: false,
    // If set to true, this will use GZIP to compress the output file

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
module.exports.s3outputkey = "";
module.exports.result = ""; // CSV data set is exposed
module.exports.reportName = ""; // Fetched from Metadata
module.exports.reportDescribe = {}; // Result of Report.Describe
module.exports.reportRows = 0; // Number of rows exported. It is non-zero only when all steps were successfully completed.
module.exports.sqlTypes = []; // SQL Types for report columns
module.exports.initialize = function (_config) {
    config.WRITE_TEMP_FILES = fs.existsSync('./tmp');

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
module.exports.downloadCommand = function () {
    if (process.argv.length < 7) {
        console.error('Usage: ' + process.argv[0] + ' ' + process.argv[1] + ' reportid datefield indexfieldOffset 2016-01-01 2016-01-05 [10, [T!T]]');
        console.error('\t10 - Number of concurrent requests.');
        console.error('\tT!T - The report section that should be downloaded.');
        console.error('\n\tPlease ensure you set the environment variable SF_USER, SF_PASSWD_WITH_TOKEN');
        console.error('\tIf you have a tmp subdirectory, the raw json output from the report will be stored in that directory');
        return;
    } else {
        config.OUTPUTTO = "file";
        if (typeof process.argv[7] === "number") {
            config.MAX_CONCURRENT = process.argv[7];
        }
        if (typeof process.argv[8] === "string") {
            config.REPORTSECTION = process.argv[8];
        }
        module.exports.initialize();
        module.exports.downloadreport(process.argv[2], process.argv[3], process.argv[4], process.argv[5], process.argv[6]).then(function () {
            console.log("Finished");
            process.exit(0);
        }, function (err) {
            console.error("Error during processing");
            process.exit(-1);
        });
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
module.exports.downloadCommandS3 = function () {
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
            console.log('Switching AWS region to ' + config.AWSCONFIG.region);
        }
        module.exports.initialize();
        module.exports.downloadreport(process.argv[2], process.argv[3], process.argv[4], process.argv[5], process.argv[6]).then(function () {
            console.log("Finished");
            process.exit(0);
        }, function (err) {
            console.error("Error during processing");
            process.exit(-1);
        });
    }
}

module.exports.downloadreport_file = function (_reportID, _startDate, _endDate) {
    var today = lastUpdate.format('YYYYMMDDHHmmss');
    var filename = config.REPORTPREFIX + _reportID + '_'
        + StartDate.format("YYYYMMDD") + '-'
        + EndDate.format("YYYYMMDD") + '_'
        + today + '.csv';
    if (config.GZIP) {
        filename = filename + ".gz";
    }
    return filename;
}
/**
 * Download the report.
 * Returns a promise
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

module.exports.downloadreport = function (_reportID, _datefield, _indexfieldOffset, _startDate, _endDate) {
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
    console.log("Starting here....");
    console.log("Report:" + reportID);
    if (config.OUTPUTTO == "s3") {
        console.log("Upload to: s3://" + config.S3BUCKET + "/" + config.S3KEYPREFIX + "/" + OutputFile);
    } else {
        console.log("Output to file:" + OutputFile);
    }
    if (config.WRITE_TEMP_FILES) {
        console.log("JSON outputs of each Async report stored in ./tmp");
    }
    console.log("Start:" + StartDate.format('YYYY-MM-DD'));
    console.log("End:" + EndDate.format('YYYY-MM-DD'));

    return conn.login(config.SF_USER, config.SF_PASSWD_WITH_TOKEN).
        then(function () {
            return conn.identity();
        }, function (err) {
            console.error(err);
            console.error('Please check you have set the following environment variables');
            console.error('SF_USER');
            console.error('SF_PASSWD_WITH_TOKEN=password and security token');
        }).then(function (res) {
            console.log('Logged into Salesforce');
            console.log("organization ID: " + res.organization_id);
            //console.log("user ID: " + res.user_id);
            console.log("username: " + res.username + "(" + res.display_name + ")");

        }).then(function () {
            return getReportForDateRange(StartDate, EndDate, "days");
        }, writeOutErrorFn('login')).then(function () {
            module.exports.reportRows = global_written_count;
            console.log("=============================");
            console.log("Report        :" + module.exports.reportName + " (" + reportID + ")");
            console.log("Date range    :" + StartDate.format('YYYY-MM-DD') + " to " + EndDate.format('YYYY-MM-DD'));
            console.log("Output to     :" + OutputFile);
            console.log('Record count  :' + global_written_count);
            console.log('Async requests:' + async_report_requests + ' - (succeeded:' + async_report_success + ',failed:' + (async_report_requests - async_report_success) + ').');
            return module.exports.result;
        }, writeOutErrorFn('jsforce_report.downloadreport'))
        .catch(function (err) {
            console.error(err);
        });
}






function writeOutErrorFn(message) {
    return function (err) {
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
    var promise = prepareCSV(reportID, data).then(function (stringifier) {
        var getInstancePromises = [];
        var concurrentPromises = new Array(config.MAX_CONCURRENT);
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
                console.log(t + ":Start Range: (" + st.format('YYYY-MM-DD') + " to " + end.format('YYYY-MM-DD') + ")");
                concurrentPromises[j] = startAsyncReport(start, end).then(
                    processAsyncReportInstanceFn(instances, t, st, end, stringifier)
                    , writeOutErrorFn(t + ":Error starting report for range: " + start.format('YYYY-MM-DD') + " - " + end.format('YYYY-MM-DD') + ":")
                );
            } else {
                concurrentPromises[j] = concurrentPromises[j].then(function () {
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
        return Promise.all(concurrentPromises).then(function () {
            stringifier.end();
            return onFinishWriteFile();
        }, writeOutErrorFn("PromiseAll error"));
    }, writeOutErrorFn("PrepareCSV error"));
    return promise;
}

function onFinishWriteFile() {
    // Data is in the global module.exports.result
    var data = module.exports.result;
    if (config.GZIP) {
        const zlib = require('zlib');
        var gzdata = zlib.gzipSync(data);
        data = gzdata;
    }

    if (config.OUTPUTTO == "file") {
        return new Promise(function (fulfill, reject) {
            fs.writeFile(OutputFile, data, function (err, res) {
                if (err) {
                    console.error(err);
                    reject(err);
                } else {
                    console.log("Successfully written data to " + OutputFile);
                    fulfill(data);
                }
            });
        });

    }
    if (config.OUTPUTTO == "s3") {
        return s3WriteFile(OutputFile, data);
    }
}

function s3WriteFile(filename, data) {
    if (typeof (AWS) == "undefined") {
        console.error("s3WriteFile:aws-sdk not loaded correctly");
    }
    var key = config.S3KEYPREFIX + "/" + filename;

    return s3putobject(config.S3BUCKET, key, data);
}

function s3putobject(bucket, key, data) {
    var s3 = new AWS.S3();
    var params = { Bucket: bucket, Key: key, Body: data };
    return new Promise(function (fulfill, reject) {
        s3.putObject(params, function (err, data) {
            if (err) {
                console.error(err);
                reject(err);
            }
            else {
                console.log("Successfully uploaded data to s3://" + bucket + "/" + key);
                module.exports.s3outputkey = "s3://" + bucket + "/" + key;
                OutputFile = module.exports.s3outputkey;
                fulfill(data);
            }
        });
    });
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
        // onFinishWriteFile(data);
        module.exports.result = data;
        // TODO _ Compression??
    });

    //stringifier.pipe(fs.createWriteStream('data/outputDateRange.csv'));
    var report = conn.analytics.report(reportID);
    return report.describe().then(function (result) {
        var columns = ["lastUpdated"];
        module.exports.reportDescribe = result;
        module.exports.reportMetadata = result.reportMetadata;
        module.exports.reportName = result.reportMetadata.name;
        module.exports.sqlTypes = ["datetime"];
        console.log("Report name: " + module.exports.reportName);
        result.reportMetadata.detailColumns.map(function (cname) {
            var sqlType = convertSOQLTypeToSQL(result.reportExtendedMetadata.detailColumnInfo[cname].dataType, "varchar(255)");
            module.exports.sqlTypes.push(sqlType);

            cname = cname.replace(/\./g, '_');
            columns.push(cname + "_label");
            columns.push(cname + "_value");
        });
        stringifier.write(columns);
        return stringifier;
    }, function (err) {
        console.error('prepareCSV: Cannot get report metadata:' + err);
    });
}

function startAsyncReport(startdate, enddate) {
    var standarddatefilter = {
                "column": datefield,
                "durationValue": "CUSTOM",
                "endDate": enddate.format('YYYY-MM-DD'),
                "startDate": startdate.format('YYYY-MM-DD')
            };
    // Old version - just sent metadata.
    // However bucket fields require the full report metadata to work or you get a BAD_REQUEST: Invalid value specified Bucket_field_xxxx. 
    var metadata = {
        reportMetadata: {
            "standardDateFilter": standarddatefilter
        }
    };
    metadata.reportMetadata = module.exports.reportMetadata;
    metadata.reportMetadata.standardDateFilter = standarddatefilter;
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
        var promise0 = delay(config.WAIT_BETWEEN_REQUESTS).then(function () {
            //var promise1=reportinstance.retrieve().then(function(results) {
            var promise1 = waitForInstance(reportinstance, config.WAIT_BETWEEN_REQUESTS).then(function (results) {
                var message = "";
                var rSection = results.factMap[config.REPORTSECTION];
                if (typeof rSection === "undefined" || rSection.rows.length == 0) {
                    message = "No data in section " + config.REPORTSECTION;
                    if (config.WRITE_TEMP_FILES) {
                        var tempfile = getTempFilename(n, true); // Empty file
                        console.log("  Writing out :" + tempfile);
                        try {
                            fs.writeFileSync(tempfile, JSON.stringify(results));
                        } catch (ferr) {
                            console.error('Temp file error:' + tempfile + ":" + ferr);
                        }
                    }
                } else {
                    message = rSection.rows.length + " rows in section " + config.REPORTSECTION;
                    if (config.WRITE_TEMP_FILES) {
                        var tempfile = getTempFilename(n, false);
                        console.log("  Writing out :" + tempfile);
                        try {
                            fs.writeFileSync(tempfile, JSON.stringify(results));
                        } catch (ferr) {
                            console.error('Temp file error:' + tempfile + ":" + ferr);
                        }
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
                // console.log(rSection.aggregates[0].value + " records");

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

function getTempFilename(n, empty) {
    var tempfile = "tmp/" + OutputFile;
    if (config.GZIP) {
        tempfile = tempfile.slice(0, -3); // remove .gz
    }
    tempfile = tempfile.slice(0, -4); // remove .csv
    tempfile = tempfile + '-' + n;
    if (empty) {
        tempfile = tempfile + ".empty";
    }
    tempfile = tempfile + ".json";
    return tempfile;
}

function waitForInstance(reportinstance) {
    var waitpromise = Promise.resolve();
    function checkStatus() {
        return waitpromise.then(function () {
            return delay(config.WAIT_BETWEEN_REQUESTS)
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

var regex_newline = new RegExp(/[\r\n]+/g);
var regex_quote = new RegExp(/['"]/g);
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
            var rowout = [lastUpdate.format('YYYY-MM-DD[T]HH:mm:ss[Z]')]; // Update date/time - is the same as the start of the download.
            var k1;
            for (k1 = 0; k1 < datacells.length; k1++) {
                var sqltype = module.exports.sqlTypes[k1 + 1];
                var label = datacells[k1].label;
                var value = datacells[k1].value;
                //label = label.replace(regex_quote,"-");
                //value = value.replace(regex_quote,"-");
                
                if (sqltype.indexOf("varchar") > -1) {
                    // Remove single quotes, newlines and wrap strings with single quotes.
                    // Truncate the string to the max length defined in the data type
                    
                    var len = 255;
                    try {
                        var s = sqltype.substring(sqltype.indexOf("varchar(")+8,sqltype.indexOf(")"));
                        len = parseInt(s);
                    } catch(err) {
                        // Integer parsing error. Can be ignored.
                        console.warn('Cannot get length of field:'+sqltype);
                    }
                    
                    // Add quotes to the string
                    if (value !== null) {
                        label = label.replace(regex_newline,"--").substring(0,len);
                        value = value.replace(regex_newline,"--").substring(0,len);
                        label = "'" + label.replace(regex_quote, "-") + "'";
                        value = "'" + value.replace(regex_quote, "-") + "'";
                    }
                    rowout.push(label);
                    rowout.push(value);
                } else {
                    rowout.push(label);
                    rowout.push(value);
                }
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
module.exports.showMetadata = function (_reportID) {
    conn = new jsforce.Connection(config.SFOptions);

    reportID = _reportID;

    OutputFile = 'ReportMeta_' + reportID + '.json';

    conn.login(config.SF_USER, config.SF_PASSWD_WITH_TOKEN).
        then(function () {
            return conn.identity();
        }, function (err) {
            console.error(err);
            console.error('Please check you have set the following environment variables');
            console.error('SF_USER');
            console.error('SF_PASSWD_WITH_TOKEN=password and security token');
        }).then(function (res) {
            console.log('Logged into Salesforce');
            //console.log("username: " + res.username + "(" + res.display_name + ")");
        }).then(function () {
            var report = conn.analytics.report(reportID);
            return report.describe();
        }).then(function (result) {
            console.log("Columns");
            result.reportMetadata.detailColumns.map(function (cname) {
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
        .catch(function (err) {
            console.error(err);
        });
    console.log("Requesting metadata for....");
    console.log("Report:" + reportID);
    console.log("Output to:" + OutputFile);
}

function convertSOQLTypeToSQL(SOQLDataType, defaultSQLType) {
    var sqltype = defaultSQLType;
    // http://www.chiragmehta.info/chirag/2011/05/16/field-datatype-mapping-between-oraclesql-server-and-salesforce/
    if (SOQLDataType == 'boolean') sqltype = "boolean";
    if (SOQLDataType == 'date') sqltype = "datetime";
    if (SOQLDataType == 'time') sqltype = "datetime";
    if (SOQLDataType == 'datetime') sqltype = "datetime";
    if (SOQLDataType == 'currency') sqltype = "numeric";
    if (SOQLDataType == 'double') sqltype = "numeric";
    if (SOQLDataType == 'int') sqltype = "int";
    if (SOQLDataType == 'picklist') sqltype = "varchar(255)";
    if (SOQLDataType == 'multipicklist') sqltype = "varchar(4000)";
    if (SOQLDataType == 'id') sqltype = "varchar(18)";
    if (SOQLDataType == 'reference') sqltype = "varchar(18)";
    if (SOQLDataType == 'textarea') sqltype = "varchar(4000)";
    if (SOQLDataType == 'email') sqltype = "varchar(255)";
    if (SOQLDataType == 'phone') sqltype = "varchar(255)";
    if (SOQLDataType == 'url') sqltype = "varchar(1000)";
    if (SOQLDataType == 'anyType') sqltype = "varchar(4000)";
    if (SOQLDataType == 'percent') sqltype = "decimal(5,2)";
    if (SOQLDataType == 'combobox') sqltype = "varchar(4000)";
    if (SOQLDataType == 'base64') sqltype = "varchar(4000)";
    if (SOQLDataType == 'html') sqltype = "varchar(4000)";
    if (SOQLDataType == 'string') sqltype = "varchar(4000)";
    return sqltype;
}
function generateMySQLTable(reportID, columns, info) {
    var i = 0;
    var sql_insert;
    var sql_insert_columns;
    var sql_insert_values;
    var sql_create;
    var sql_table = 'T' + reportID;
    sql_create = "CREATE TABLE " + sql_table + ' (';
    sql_create = sql_create + "\n  lastUpdate datetime DEFAULT NULL,";
    sql_insert = "set @@sql_mode='no_engine_substitution';";
    sql_insert = sql_insert + "\nINSERT INTO " + sql_table;
    sql_insert_columns = " (lastUpdate,";
    sql_insert_values = " VALUES (?,";
    columns.map(function (cname) {
        var col = info[cname];
        var sqltype = convertSOQLTypeToSQL(col.dataType, "varchar(255)");

        cname = cname.replace(/\./g, '_');

        sql_create = sql_create + "\n  " + cname + "_label varchar(255) DEFAULT NULL,";
        if (i >= 0) {
            sql_create = sql_create + "\n  " + cname + "_value " + sqltype + " DEFAULT NULL,";
        } else {
            // Setup a field as primary key so Redshift can use OVERWRITE_INSERT mode.
            // This may be more dangerous since the wrong field is selected as the primary key.
            //i = i + 1;
            //sql_create = sql_create + "\n  " + cname + "_value " + sqltype + " PRIMARY KEY,";
        }
        sql_insert_columns = sql_insert_columns + cname + "_label,";
        sql_insert_columns = sql_insert_columns + cname + "_value,";
        sql_insert_values = sql_insert_values + "?,?,";
    });
    sql_create = sql_create.slice(0, -1) + "\n);\n";
    sql_insert_columns = sql_insert_columns.slice(0, -1) + ") ";
    sql_insert_values = sql_insert_values.slice(0, -1) + ") ";
    sql_insert = sql_insert + sql_insert_columns + sql_insert_values + ";\n";
    var sql_mysql_load = "set @@sql_mode='no_engine_substitution';"
        + "\nLOAD DATA LOCAL INFILE 'ReportOut_" + reportID + "_startdate-enddate_timestamp.csv'"
        + "\n INTO TABLE " + sql_table
        + "\n FIELDS TERMINATED BY ','"
        + "\n ENCLOSED BY '" + '"' + "'"
        + "\n LINES TERMINATED BY '\\n'"
        + "\n IGNORE 1 ROWS;"

    var sql_rs_load = "COPY " + sql_table
        + " FROM 's3://s3bucket/s3path/ReportOut_" + reportID + "_startdate-enddate_timestamp.csv'"
        + " credentials 'aws_access_key_id={your access key};aws_secret_access_key={your secret key}'"
        + " DELIMITER ',' DATEFORMAT 'auto' TIMEFORMAT 'auto' "
        + " IGNOREHEADER 1 EMPTYASNULL BLANKSASNULL REMOVEQUOTES IGNOREBLANKLINES"
        + " TRUNCATECOLUMNS  TRIMBLANKS REGION 'us-east-1';"
        + "\n select top 20 * from stl_load_errors order by starttime desc;"
        + "\n select count(*) from " + sql_table + ";";
    var sql_rs_load_gz = "COPY " + sql_table
        + " FROM 's3://s3bucket/s3path/ReportOut_" + reportID + "_startdate-enddate_timestamp.csv.gz'"
        + " credentials 'aws_access_key_id={your access key};aws_secret_access_key={your secret key}'"
        + " GZIP DELIMITER ',' DATEFORMAT 'auto' TIMEFORMAT 'auto' "
        + " IGNOREHEADER 1 EMPTYASNULL BLANKSASNULL REMOVEQUOTES IGNOREBLANKLINES"
        + " TRUNCATECOLUMNS  TRIMBLANKS REGION 'us-east-1';"
        + "\n select top 20 * from stl_load_errors order by starttime desc;"
        + "\n select count(*) from " + sql_table + ";";
    var sqlcmds = {
        "create": sql_create,
        "mysql_insert": sql_insert,
        "mysql_load": sql_mysql_load,
        "redshift_copy": sql_rs_load,
        "redshift_copy_gz": sql_rs_load_gz
    };
    var file1 = 'ReportSQL_' + reportID + '-sql.json';
    fs.writeFile(file1, JSON.stringify(sqlcmds));
    var filename = 'ReportSQL_' + reportID + '.sql'
    fs.open(filename, "w", function (err, fd) {
        if (err) {
            console.error(err);
        } else {
            fs.writeSync(fd, "-- MYSQL/Redshift create statement for " + reportID);
            fs.writeSync(fd, "\n-- Please adjust the PRIMARY KEY as needed. Redshift needs a Primary key");
            fs.writeSync(fd, "\n--\n");
            fs.writeSync(fd, sql_create);
            fs.writeSync(fd, "\n-- ");
            fs.writeSync(fd, "\n-- ");
            fs.writeSync(fd, "\n-- MYSQL insert statement for " + reportID);
            fs.writeSync(fd, "\n--\n");
            fs.writeSync(fd, sql_insert);
            fs.writeSync(fd, "\n-- ");
            fs.writeSync(fd, "\n-- ");
            fs.writeSync(fd, "\n-- MYSQL LOAD statement for " + reportID);
            fs.writeSync(fd, "\n--\n");
            fs.writeSync(fd, sql_mysql_load);
            fs.writeSync(fd, "\n-- ");
            fs.writeSync(fd, "\n-- ");
            fs.writeSync(fd, "\n-- Redshift COPY command to load from S3 :" + reportID);
            fs.writeSync(fd, "\n--\n");
            fs.writeSync(fd, sql_rs_load);
            fs.writeSync(fd, "\n-- ");
            fs.writeSync(fd, "\n-- ");
            fs.writeSync(fd, "\n-- Redshift COPY command to load from S3 with compression/gzip:" + reportID);
            fs.writeSync(fd, "\n--\n");
            fs.writeSync(fd, sql_rs_load_gz);
            fs.closeSync(fd);
            console.log("SQL Syntax for MySQL and Redshift is written to :" + filename);
        }
    });

}
/**
 * Download the report metadata. Command line wrapper
 * SF_USER - Environment variable with the user name.
 * SF_PASSWD_WITH_TOKEN - Environment variable with the password and security token.
 *
 * Command line:
 * download_meta reportid
 */
module.exports.showMetadataCmd = function () {
    if (process.argv.length < 2) {
        console.error('Usage: ' + process.argv[0] + ' ' + process.argv[1] + ' reportid');
        return;
    } else {
        module.exports.showMetadata(process.argv[2], process.env.SF_USER, process.env.SF_PASSWD_WITH_TOKEN);
    }
}

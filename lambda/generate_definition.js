'use strict';
// Generate the Event JSON and Pipeline JSON
//
var fs = require("fs");

if (process.argv.length < 10) {
    console.error('Usage: ' + process.argv[0] + ' ' + process.argv[1] + 'reportid datefield indexfieldOffset 2016-01-01 2016-01-05 event_template pipeline_template bucket awsprofile');

    process.exit(-1);
}

var reportID = process.argv[2];
var bucket = process.argv[9];

create_pipeline_json();
create_event();

function create_pipeline_json() {
    console.log("Generating pipeline definition file");
    var template = process.argv[8];

    console.log("  Template:" + template);
    console.log("  ReportID:" + reportID);
    console.log("  S3 Bucket:" + bucket);

    var sqlcmds = require("./" + reportID + "/ReportSQL_" + reportID + "-sql.json");
    var pipelineconfig = require(template);

    var values = {
        "myInsertMode": "OVERWRITE_EXISTING",
        "myRedshiftTableName": "",
        "myInputS3Loc": "",
        "myRedshiftCreateTableSql": "",
    };

    values.myInputS3Loc = "s3://" + bucket + "/jsforce/staging/" + reportID + "/in/";
    values.myRedshiftTableName = "T" + reportID;
    values.myRedshiftCreateTableSql = sqlcmds.create.replace(/\n/g, " ");

    for (var k in values) {
        pipelineconfig.values[k] = values[k];
    }
    var filename = reportID + "/pipeline-" + reportID + ".json";
    fs.writeFile(filename, JSON.stringify(pipelineconfig, null, '\t'));
    console.log("  Pipeline definition:" + filename);
}

function create_event() {
    console.log("Generating AWS Lambda Event JSON file");
    var template = process.argv[7];
    var datefield = process.argv[3];
    var indexfieldOffset = process.argv[4];
    var startdate = process.argv[5];
    var enddate = process.argv[6];

    console.log("  Template   :" + template);
    console.log("  S3 Bucket  :" + bucket);
    console.log("  ReportID   :" + reportID);
    console.log("  Datefield  :" + datefield);
    console.log(" Indexfield  :" + indexfieldOffset);
    console.log("  Startdate  :" + startdate);
    console.log("    Enddate  :" + enddate);

    var event_template = require(template);
    event_template.config["SF_USER"] = process.env.SF_USER;
    event_template.config["SF_PASSWD_WITH_TOKEN"] = process.env.SF_PASSWD_WITH_TOKEN;
    event_template.config["S3BUCKET"] = bucket;
    event_template.config["S3KEYPREFIX"] = "jsforce/staging/" + reportID + "/in";
    event_template.options["report"] = reportID;
    event_template.options["datefield"] = datefield;
    event_template.options["indexfield"] = indexfieldOffset;
    event_template.options["startdate"] = startdate;
    event_template.options["enddate"] = enddate;

    var filename = reportID + "/event-" + reportID + ".json";
    fs.writeFile(filename, JSON.stringify(event_template, null, '\t'));
    console.log("  Event JSON:" + filename);

}


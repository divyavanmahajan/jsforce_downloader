// Test script for your Amazon Lambda function
//

var index = require('./index.js');
// Create the event that will be passed to the handler.
var event =
{
        "config":{
                "MAX_CONCURRENT": 40,
                "WAIT_BETWEEN_REQUESTS":500,
                "REPORTSECTION": "T!T",
                "WRITE_TEMP_FILES": false,
                "SFOptions" : {
                        "loginUrl": "https://login.salesforce.com"
                },
                "AWSCONFIG": {    
                        "region": 'us-east-1'
                },
                "SF_USER" : "sfuser@sfuser.com",
                "SF_PASSWD_WITH_TOKEN": "passwd_and_token",
                "REPORTPREFIX": "LambdaReportOut_",
                "OUTPUTTO": "s3",
                "S3BUCKET": "monima",
                "S3KEYPREFIX":"jsforce"

        },
        "options":{
                "report": "_salesforce_reportid_like_00OE0000002whwz",
                "datefield": "Case.CreatedDate",
                "indexfield": 0,
                "startdate":"2016-04-13",
                "enddate":"2016-04-15"
        }
};
index.handler(event);

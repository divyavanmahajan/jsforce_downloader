# jsforce_downloader 
## by Divya van Mahajan

Extract report data from Salesforce into a comma separated file. This package includes 4 components that can be used independently.
- nodejs library to download Salesforce reports that have a date filter.
- jsforce_downloader - command line utility to download Salesforce reports. (command line wrapper of the downloader).
- jsforce_s3_downloader - command line utility to download Salesforce reports directly to S3.
- jsforce_downloader_metadata - command line utility to display the metadata of a Salesforce report. Use this to inspect the fields and filters of a report. It also generates the SQL to create a table in MySQL to save this data.

## Features
- Download more than 2000 details rows.
- Only extracts the detail rows (T!T) and ignores all group/summary sections.
- Exported as a CSV with the displayed value and the underlying value.
- Asynchronous reports are used to avoid the Salesforce limit on synchronous reports per hour.
- Parallel downloads to speed up the extract.
- Supports Tabular, Matrix and Summary report types.
- Support for AWS Lambda. Run this downloader in AWS Lambda. A Lambda event handler is provided.
- Support for AWS S3. Upload the downloaded data directly to S3 (no temp files needed on local machine).

Report your issues or ask for feature requests at [Github Issues](https://github.com/divyavanmahajan/jsforce_downloader/issues).

## How to install
Install jsforce_downloader and jsforce_downloader_metadata.
```
    npm install -g jsforce_downloader
```
Optionally - if you are using the AWS S3 feature, install the AWS SDK and set environment variables AWS_ACCESS_KEY, AWS_SECRET_KEY.
```
    npm install -g aws-sdk
```    
## Setup: Environment variables
The library and utilities rely on the environment variables to store the username and password. If you are writing your own nodejs program, you can pass these during initialization.
```
    SF_USER="myuseratsf@xyz.com"
    SF_PASSWD_WITH_TOKEN="password";
```
If you are saving the output to S3 (OUTPUTTO="s3"), you should set the following environment variables.
```
    AWS_ACCESS_KEY="access key id"
    AWS_SECRET_KEY="secret for access key"
```    
The security token is required since the app does not support OAuth sign in. 
To get your security token, logon to Salesforce. 
At the top navigation bar go to `your name > Setup > Personal Setup > My Personal Information > Reset My Security Token`.
To use your token, if your password is mypassword, and your security token is `XXXXXXXXXX`, then set `SF_PASSWD_WITH_TOKEN` to `mypasswordXXXXXXXXXX` to log in. 
If you change your password, the security token is reset and sent to your email.

Mac OS X: Add the following lines to ~/.profile and restart Terminal.
```sh
    export SF_USER="myuser@sfdomain.com"
    export SF_PASSWD_WITH_TOKEN="passwordTOKEN"
```
Windows:Follow the [instructions to set environment variables](http://www.computerhope.com/issues/ch000549.htm). 
Restart your command or Powershell window after you set the environment variables.

## Command line tools: How to run jsforce_downloader_metadata

This will display all the metadata of a report. It includes details of columns and filters etc. 
Ensure you have set the environment variables for Salesforce `SF_USER="myuser@xyz.com"` and `SF_PASSWD_WITH_TOKEN="password";`.

Command: `jsforce_downloader_metadata {reportid}`

    jsforce_downloader_metadata 00OE0000002wlroMAA

This creates the file `ReportMeta_00OE0000002wlroMAA.json`. The file has the JSON format metadata for the report - so you can easily find the index of the column to display, 
{Report Section of the Fact Map} and report filters. 
The tool also creates a helper sql file `ReportSQL_00OE0000002wlroMAA.sql`. It contains the SQL commands for MySQL / Redshift to:
+Create a table for this dataset
+MYSQL insert SQL statement
+MYSQL to load entire CSV into the table through SQL Workbench.
+Redshift to copy S3 file into a table.
+Redshift to copy S3 file into a table if you have compressed with GZIP.



## Command line tools: How to run jsforce_downloader
Command line: To download a report

`jsforce_downloader {reportid} {datefield} {index of field to display} {start date YYYY-MM-DD} {end date YYYY-MM-DD} [{MAX_Concurrent} [{Report section of the Fact Map}]]`


### Preparation to download a report, you need
+ The report ID (get this from the Salesforce URL when you open the report).    
+ The name of the date field - e.g. Case.CreatedDate to slice up the report into daily chunks. This does not have to be in the report.
+ The zero-based index of column that is displayed while extracting (helps you keep track of the progress.) If you aren't sure, use 0.
+ The section of the report that you want to see. For a tabular report use "T!T". For others, see the next section (`Selecting the report section`).
  
  
Example:
```
$ jsforce_downloader 00OE0000002wlroMAA Labor__c.CreatedDate 5 2016-01-01 2016-01-05 4 'T!T'
    Starting here....
    Report:00OE0000002wlroMAA
    Output to:ReportOutput_00OE0000002wlroMAA_20160101_to_20160105_20160413134312
    Start:2016-01-01
    End:2016-05-01
    Logged into Salesforce
    username: sampleuser@sftest.com(Sample User)
    Report name: Case Owner Email
    0:Start Range: 2016-01-01T00:00:00-08:00 - 2016-01-01T23:59:59-08:00
    1:Start Range: 2016-01-02T00:00:00-08:00 - 2016-01-02T23:59:59-08:00
    ....
    1:Returned Range: 2016-01-02T00:00:00-08:00 - 2016-01-02T23:59:59-08:00:Success
    84 records
    First: L-5156083 a0iE000000MiTNLIA3
    Last : L-5156837 a0iE000000MiUMMIA3
    Package size:83
    ....
    =============================
    Report:00OE0000002wlroMAA
    Date range:2016-01-01 to 2016-01-05
    Output to:ReportOutput_00OE0000002wlroMAA_20160101_to_20160105_20160413134312
    Done:1755 records written.
    Async reports requested:5 - (succeeded:5,failed:0).
```

This creates the file `ReportOutput_00OE0000002wlroMAA_20160101_to_20160105_20160413134312.csv`.

### Selecting the report section
 The report section to extract is explained in the [Salesforce Analytics REST API guide](https://resources.docs.salesforce.com/sfdc/pdf/salesforce_analytics_rest_api.pdf) 
 - in the section "`Decode the Fact Map`". The pattern for the fact map keys varies by report format as shown in this table.
   Tabular    T!T: The grand total of a report. Both record data values and the grand total are represented by this key. 
   Summary    <First level row grouping_second level row grouping_third level row grouping>!T: T refers to the row grand total.
   Matrix     <First level row grouping_second level row grouping>!<First level column grouping_second level column grouping>.
   
Each item in a row or column grouping is numbered starting with 0. Here are some examples of fact map keys:

     0!T   | The first item in the first-level grouping.
     1!T   | The second item in the first-level grouping.
     0_0!T | The first item in the first-level grouping and the first item in the second-level grouping. 
     0_1!T | The first item in the first-level grouping and the second item in the second-level grouping. 


## Command line tools: How to run jsforce_s3_downloader
To download a report, you need

`jsforce_s3_downloader {reportid} {datefield} {index of field to display} {start date YYYY-MM-DD} {end date YYYY-MM-DD} {s3 bucket} {s3 path} [{aws region}]`

Example:

```
$ jsforce_s3_downloader 00OE0000002wlroMAA Labor__c.CreatedDate 5 2016-01-01 2016-01-04 monima test us-east-1
    Switching AWS region to us-east-1
    Starting here....
    Report:00OE0000002wlroMAA
    Output to:Upload to: s3://monima/test/ReportOut_00OE0000002wlroMAA_20160101-20160104_20160418030436.csv
    Start:2016-01-01
    ...
    707 records
    First row: (L-5158662,a0iE000000MiWcxIAF)
    Last row : (L-5172382 a0iE000000MihGAIAZ)
    =============================
    Report       :00OE0000002wlroMAA
    Date range   :2016-01-01 to 2016-01-04
    Output to    :ReportOut_00OE0000002wlroMAA_20160101-20160104_20160418030436.csv
    Done         :1087 records written.
    Async reports:4 - (succeeded:4,failed:0).
    Successfully uploaded data to s3://monima/monima/ReportOut_00OE0000002wlroMAA_20160101-20160104_20160418030436.csv
```
This uploads the file `ReportOut_00OE0000002wlroMAA_20160101-20160104_20160418030436.csv` to the S3 bucket `monima`.

## Using the library in your NodeJS program.


#### Configuration of the library
Before you can use the report download function, you must initialize the library by calling jsforce_downloader.initialize.
```javascript
    var jsforce_downloader=require('jsforce_downloader');
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
        

        GZIP: false,
        // If set to true, this will use GZIP to compress the output file

        AWSCONFIG: {    
            accessKeyId: 'AKID', secretAccessKey: 'SECRET', region: 'us-west-2'
        }, 
        // This is required when you are using AWS S3 outside AWS Lambda and have not set the environment variables AWS_ACCESS_KEY and AWS_SECRET_KEY.  
        // See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
            
        S3BUCKET: "", 
        // S3 bucket if OUTPUTTO is set to "s3".
        
        S3KEYPREFIX: "" 
        // S3 key prefix if OUTPUTTO is set to "s3". This is the path where you want to store the output file.
    };
    jsforce_downloader.initialize(config);
    
```
#### Using the library

`jsforce_downloader.downloadreport` : is the main function that downloads the report. The function returns a Javascript promise.

```javascript
/**
 * @param {String} _reportID - Salesforce report identifier. You can get this from the URL when you are viewing the report.
 * @param {String} _datefield - Internal name of the date field used in the standard date filter. 
 * @param {String} _indexfieldOffset - Column that should be displayed while running the report (starts at 0). By default the first column is shown.
 * @param {Date} _startDate - Starting date in the format YYYY-MM-DD.
 * @param {Date} _endDate - Ending date in the format YYYY-MM-DD.
 * @param {String} _user - username.
 * @param {String} _password - password with security token.
 */
 ```
 
 Example:
 
```javascript
    jsforce_downloader.downloadreport(report, "Datefield", options.indexfield, options.startdate, options.enddate).then(
        function(res) {
            console.log(jsforce_downloader.s3outputkey);
            if (typeof callback == "function") {
                callback(null, jsforce_downloader.s3outputkey);
            }
        }, function(err) {
            console.error(err);
            if (typeof callback == "function") {
                callback(err, null);
            }

        });
```
#### Other helpful exports

`config`         | Config for the module.
`s3outputkey`    | S3 URL if output is to S3.
`result`         | CSV data set on success.
`reportName`     | Name of the report from the metadata.
`reportDescribe` | JSON metadata returned by report.describe()


## Using it in AWS Lambda
To run the downloader in AWS Lambda, you need to create a lambda zip package. 
If you have compiled node libraries, prepare this on a Linux machine.

+ Prepare your environment.
    + Create an empty directory.
    + Install aws-sdk and jsforce_downloader.
+ Create your lambda NodeJS script.
+ Test your lambda function locally.
+ Packaging the lambda function (creating a zip file for your AWS Lambda function).
+ Create the Lambda function with the AWS CLI.
+ Invoke the Lambda function with the AWS CLI.

#### Create your lambda NodeJS script.

```
mkdir myfunction
cd myfunction
npm install aws-sdk jsforce_downloader
curl -O https://raw.githubusercontent.com/divyavanmahajan/jsforce_downloader/master/lambda/index.js
curl -O https://raw.githubusercontent.com/divyavanmahajan/jsforce_downloader/master/lambda/test.js
curl -O https://raw.githubusercontent.com/divyavanmahajan/jsforce_downloader/master/lambda/event.json
curl -O https://raw.githubusercontent.com/divyavanmahajan/jsforce_downloader/master/lambda/makelambda.sh
curl -O https://raw.githubusercontent.com/divyavanmahajan/jsforce_downloader/master/lambda/invokelambda.sh

```

+ View [index.js](https://raw.githubusercontent.com/divyavanmahajan/jsforce_downloader/master/lambda/index.js) .
+ View [test.js](https://raw.githubusercontent.com/divyavanmahajan/jsforce_downloader/master/lambda/test.js).

#### Create the event for your lambda function.

+ Edit the event file in the `myfunction` directory. 
+ Set your Salesforce and AWS details. `SF_USER`, `SF_PASSWD_WITH_TOKEN`, `S3BUCKET`, `S3KEYPREFIX`.
+ Set the compression option `GZIP` to `true` or `false`.
+ Set the report options. `report`, `datefield`, `indexfield`, `startdate`, `enddate`.

Alternatively download and edit [event.json](https://raw.githubusercontent.com/divyavanmahajan/jsforce_downloader/master/lambda/event.json).

```javascript
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
                        "region": "us-east-1"
                },
                "SF_USER" : "sfuser@sfuser.com",
                "SF_PASSWD_WITH_TOKEN": "passwd_and_token",
                "REPORTPREFIX": "LambdaReportOut_",
                "OUTPUTTO": "s3",
                "GZIP":false,
                "S3BUCKET": "monima",
                "S3KEYPREFIX":"jsforce"

        },
        "options":{
                "report": "_salesforce_reportid_like_00OE0000002qhwz",
                "datefield": "Case.CreatedDate",
                "indexfield": 0,
                "startdate":"2016-04-13",
                "enddate":"2016-04-15"
        }
}
```

#### Test your lambda function locally.
+ Ensure the environment variables `AWS_ACCESS_KEY` and `AWS_SECRET_KEY` are set to your AWS credentials.
+ Run `node test.js` to test the lambda function locally.
+ Verify the file was successfully uploaded into S3.

```sh
$ node test.js
Starting here....
Report:00OE0000002whwz
Upload to:s3://monima/jsforce/LambdaReportOut_00OE0000002whwz_20160413-20160413_20160417220418.csv
Start:2016-04-13
End:2016-04-15
Logged into Salesforce
username: myuser@sf.com (My user)
0:Start Range: (2016-04-13 to 2016-04-13)
1:Start Range: (2016-04-14 to 2016-04-14)
2:Start Range: (2016-04-15 to 2016-04-15)
1:Returned Range: (2016-04-14 to 2016-04-14) :Success:413 rows in section T!T
413 records
...
=============================
Report       :00OE0000002whwz
Date range   :2016-04-13 to 2016-04-15
Output to    :LambdaReportOut_00OE0000002whwz_20160413-20160415_20160417220418.csv
Done         :1232 records written.
Async reports:3 - (succeeded:3,failed:0).
Successfully uploaded data to s3://monima/jsforce/LambdaReportOut_00OE0000002whwz_20160413-20160415_20160417220418.csv
```

#### Setup AWS CLI
+ Setup your AWS CLI if you want to use the command line to create your lambda function. 
If you want to use the Web console, you don't need the AWS CLI. [Instructions for CLI setup](http://docs.aws.amazon.com/lambda/latest/dg/setup-awscli.html).

#### Packaging and creating the lambda function
Edit the `makelambda.sh` script in the `myfunction` directory. Correct the values for `LAMBDAFN`, `ARN`, `EVENTFILE` and `AWSPROFILE`.
+ `ARN` - Get the ARN for the Lambda role "lambda_basic_execution" or "lambda_basic_execution_with_vpc".
[IAM Home](https://console.aws.amazon.com/iam/home). View the details of the role and copy down its ARN. 
It would look similar to `arn:aws:iam::854421518417:role/lambda_basic_execution`. 
+ `LAMBDAFN` - Choose a valid name for your Lambda function. 
+ `AWSPROFILE` - Set this to the correct "profilename" that you setup during the AWS CLI setup. If you don't remember try checking the file `~/.aws/credentials`.

Script [makelambda.sh](https://raw.githubusercontent.com/divyavanmahajan/jsforce_downloader/master/lambda/makelambda.sh).
```
#!/bin/sh
ARN=arn:aws:iam::852391518417:role/lambda_basic_execution
LAMBDAFN=DownloadSFReport
AWSPROFILE=adminuser

echo -- 1. Make function.zip --
rm function.zip
zip -rq function index.js node_modules -x node_modules/aws-sdk/*\* -x node_modules/jsforce/build/*\* -x node_modules/jsforce/test/*\*

echo -- 2. Delete Function $LAMBDAFN --
aws lambda delete-function \
--region us-east-1 \
--function-name $LAMBDAFN \
--profile $AWSPROFILE

echo -- 3. Create AWS Lambda function $LAMBDAFN with function.zip --
aws lambda create-function \
--region us-east-1 \
--function-name $LAMBDAFN \
--zip-file fileb://./function.zip \
--role $ARN \
--handler index.handler \
--runtime nodejs4.3 \
--profile $AWSPROFILE \
--timeout 300 \
--memory-size 512
```

+ 1 - This will create a ZIP file for your lambda function and exclude the test.js file which has your credentials.
+ 2 - Deletes the old version if it exists.
+ 3 - Create a lambda function running under the role selected above with 300 seconds timeout, 
NodeJS 4.3 runtime, 512 MB memory with function.zip for source code.

Example:
```
$ sh ./makelambda.sh
    -- 1. Make function.zip --
    rm: function.zip: No such file or directory
    -- 2. Delete Function DownloadSFReport --
    -- 3. Create AWS Lambda function DownloadSFReport with function.zip --
    {
        "CodeSha256": "jQZ69IvYfpyX6w7KnMkyFCytdXba+rCLOeTd2P7Qg4c=", 
        "FunctionName": "DownloadSFReport", 
        "CodeSize": 4016351, 
        "MemorySize": 512, 
        "FunctionArn": "arn:aws:lambda:us-east-1:852391518417:function:DownloadSFReport", 
        "Version": "$LATEST", 
        "Role": "arn:aws:iam::852391518417:role/lambda_basic_execution", 
        "Timeout": 300, 
        "LastModified": "2016-04-18T21:48:36.966+0000", 
        "Handler": "index.handler", 
        "Runtime": "nodejs4.3", 
        "Description": ""
    }
```


[Amazon docs on creating a Lambda function](http://docs.aws.amazon.com/lambda/latest/dg/with-userapp-walkthrough-custom-events-upload.html).


#### Invoke the Lambda function
Edit the `invokelambda.sh` script in the `myfunction` directory. Correct the values for `LAMBDAFN`, `ARN`, `EVENTFILE` and `AWSPROFILE`.
+ `LAMBDAFN` - Choose a valid name for your Lambda function. 
+ `EVENTFILE` - We will reuse the event.json that you edited earlier. Check that it is valid JSON (all keys and values are quoted). [JSON Lint](jsonlint.com) is a quick and easy way to check the validity.
+ `AWSPROFILE` - Set this to the correct "profilename" that you setup during the AWS CLI setup. If you don't remember try checking the file `~/.aws/credentials`.

Script [invokelambda.sh](https://raw.githubusercontent.com/divyavanmahajan/jsforce_downloader/master/lambda/invokelambda.sh).
```sh
#!/bin/sh
LAMBDAFN=DownloadSFReport
EVENTFILE=./event.json
AWSPROFILE=adminuser

echo -- 4. Invoke $LAMBDAFN with event.json --
aws lambda invoke \
--invocation-type RequestResponse \
--function-name $LAMBDAFN \
--region us-east-1 \
--log-type Tail \
--payload file://$EVENTFILE \
--profile $AWSPROFILE \
outputfile.txt
```

Run the script to invoke the function.

```
$ sh ./invokelambda.sh
    -- 4. Invoke DownloadSFReport with event.json --
    {
        "LogResult": "base64-encoded-log-data", 
        "StatusCode": 200
    }
```

The logresult data in the response is `base64-encoded`. On Linux and Mac, you can use the base64 command to decode the log. 
```
$ echo base64-encoded-log-data | base64 --decode
    START RequestId: 231b8ce2-051c-11e6-84c3-af7b2d0cd02a Version: $LATEST
    2016-04-18T04:15:10.683Z	231b8ce2-051c-11e6-84c3-af7b2d0cd02a	Report:00OE0000002whwz
    2016-04-18T04:15:10.684Z	231b8ce2-051c-11e6-84c3-af7b2d0cd02a	Output to:LambdaReportOut_00OE0000002whwz_20160413-20160415_20160418040466.csv
    ...
    2016-04-18T04:15:13.718Z	231b8ce2-051c-11e6-84c3-af7b2d0cd02a	Successfully uploaded data to s3://monima/jsforce/LambdaReportOut_00OE0000002whwz_20160413-20160415_20160418040466.csv
    END RequestId: 231b8ce2-051c-11e6-84c3-af7b2d0cd02a
    REPORT RequestId: 231b8ce2-051c-11e6-84c3-af7b2d0cd02a	Duration: 3218.25 ms	Billed Duration: 3300 ms 	Memory Size: 1024 MB	Max Memory Used: 79 MB
```

### AWS errors and the workarounds

+ `[PermanentRedirect: The bucket you are attempting to access must be addressed using the specified endpoint.` 
You must specify a region to access your S3 bucket. Add this to your event.config or config.
```
    "AWSCONFIG": {
        "region": 'us-east-1'
    },
``` 

+ `Function was terminated` or `Function seems to be stuck`.
Lambda has a max timeout of 5 minutes and will terminate the function after that. 
Check the max memory used for your stuck function, and increase it if you are at the limit.


## Library inner working
The library does the following
+ Download the report metadata to setup the headers for the CSV file. I use the excellent node library csv-stringify to create CSV files.
+ Add a date filter to the report metadata.
+ Request execution of an Async report where the date filter is set to each day between the start and end dates. So if there are 365 days between the start and end date, it will generate 365 async reports.
+ The Async reports are requested in sets of 30 each. This can be changed by setting MAX_CONCURRENT in the config.
+ The program starts polling Salesforce to see if the Async reports are finished. The polling is done every 2000 ms. This can be changed by setting WAIT_BETWEEN_REQUESTS in the config. I don't recommend a number less than 500 ms.
+ Download the results of the completed Async reports and store them in memory.
+ When all async reports are completed, output to a file or to a S3 object.

### Design choices
SF Async reports vs Sync reports: Async reports have a higher limit on the number of requests. This is important if you are downloading a lot of days.
<< TODO: What is the limit of ASync reports per hour per user? >>


### Why this library?
I needed to automate the download of a large report to a CSV file. This task was done manually earlier and would take a long time to complete. So I looked into options using Node.

The excellent [jsForce](https://www.npmjs.com/package/jsforce) node module is a great wrapper around the Salesforce REST API. However it does not have a simple way to repeatedly call a report to get more than 2000 results. Unlike SOQL queries, there is no "queryMore" equivalent for reports. So I had to write a lot of non-trivial code to call the same report multiple times, switch to using asynchronous Salesforce reports, run multiple reports in parallel, etc. 

After the first revision went out, I got requests to make this run in AWS Lambda and export the data to AWS S3 directly. This allows it to be a part of a AWS Data Pipeline to automate loading Salesforce report extracts into AWS RedShift.




# jsforce_downloader

Extract report data from Salesforce into a comma separated file.

## Features
- Download more than 2000 details rows.
- Only extracts the detail rows (T!T) and ignores all group/summary sections.
- Exported as a CSV with the displayed value and the underlying value.
- Asynchronous reports are used to avoid the Salesforce limit on synchronous reports per hour.
- Parallel downloads to speed up the extract.


## Requirements
- The report must have a standard date filter.

## How to install
Install jsforce_downloader and jsforce_downloader_metadata.

    npm install -g jsforce_downloader

## How to run jsforce_downloader_metadata

This will display all the columns and filters of a report. The metadata is saved as a JSON file.

    jsforce_downloader_metadata {reportid}
    jsforce_downloader_metadata 00OE0000002wlroMAA

This creates the file *ReportOutput_00OE0000002wlroMAA.json*.
This file has the metadata for the report - so you can easily find the index of the column to display, {Report Section of the Fact Map} and report filters.


## How to run jsforce_downloader

Preparation to download a report, you need
+ The report ID (get this from the Salesforce URL when you open the report).    
+ The name of the date field - e.g. Case.CreatedDate to slice up the report into daily chunks. This does not have to be in the report.
+ The zero-based index of column that is displayed while extracting (helps you keep track of the progress.) If you aren't sure, use 0.
+ The section of the report that you want to see. This is explained in the [Salesforce Analytics REST API guide](https://resources.docs.salesforce.com/sfdc/pdf/salesforce_analytics_rest_api.pdf) - in the section decode the Fact Map. 
  The pattern for the fact map keys varies by report format as shown in this table.
  
Report Fact map key pattern format
   Tabular    T!T: The grand total of a report. Both record data values and the grand total are represented by this key. 
   Summary    <First level row grouping_second level row grouping_third level row grouping>!T: T refers to the row grand total.
   Matrix     <First level row grouping_second level row grouping>!<First level column grouping_second level column grouping>.
   
   Each item in a row or column grouping is numbered starting with 0. Here are some examples of fact map keys:
     + 0!T The first item in the first-level grouping.
     + 1!T The second item in the first-level grouping.
     + 0_0!T The first item in the first-level grouping and the first item in the second-level grouping. 0_1!T The first item in the first-level grouping and the second item in the second-level grouping. 

      
    
To download a report, you need
      jsforce_downloader {reportid} {datefield} {index of field to display} {start date YYYY-MM-DD} {end date YYYY-MM-DD} [{MAX_Concurrent} [{Report section of the Fact Map}]]

Example:

      $ jsforce_downloader 00OE0000002wlroMAA Labor__c.CreatedDate 5 2016-01-01 2016-01-05 4 'T!T'

      Labor__c.CreatedDate 5 2016-01-01 2016-01-05
      Starting here....
      Report:00OE0000002wlroMAA
      Output to:ReportOutput_2016-01-01_to_2016-01-05.csv
      Start:2016-01-01
      End:2016-05-01
      Logged into Salesforce
      username: sampleuser@sftest.com(Sample User)
      0:Start Range: 2016-01-01T00:00:00-08:00 - 2016-01-01T23:59:59-08:00
      1:Start Range: 2016-01-02T00:00:00-08:00 - 2016-01-02T23:59:59-08:00
      2:Start Range: 2016-01-03T00:00:00-08:00 - 2016-01-03T23:59:59-08:00
      3:Start Range: 2016-01-04T00:00:00-08:00 - 2016-01-04T23:59:59-08:00
      4:Start Range: 2016-01-05T00:00:00-08:00 - 2016-01-05T23:59:59-08:00
      1:Returned Range: 2016-01-02T00:00:00-08:00 - 2016-01-02T23:59:59-08:00:Success
      84 records
      First: L-5156083 a0iE000000MiTNLIA3
      Last : L-5156837 a0iE000000MiUMMIA3
      Package size:83
      2:Returned Range: 2016-01-03T00:00:00-08:00 - 2016-01-03T23:59:59-08:00:Success
      158 records
      First: L-5156873 a0iE000000MiUWyIAN
      Last : L-5158480 a0iE000000MiWMsIAN
      Package size:157
      0:Returned Range: 2016-01-01T00:00:00-08:00 - 2016-01-01T23:59:59-08:00:Success
      142 records
      First: L-5155835 a0iE000000MiSVAIA3
      Last : L-5156078 a0iE000000MiTF1IAN
      Package size:141
      3:Returned Range: 2016-01-04T00:00:00-08:00 - 2016-01-04T23:59:59-08:00:Success
      706 records
      First: L-5158662 a0iE000000MiWcxIAF
      Last : L-5172382 a0iE000000MihGAIAZ
      Package size:705
      4:Returned Range: 2016-01-05T00:00:00-08:00 - 2016-01-05T23:59:59-08:00:Success
      665 records
      First: L-5172547 a0iE000000MihJHIAZ
      Last : L-5184790 a0iE000000Mir8jIAB
      Package size:664
      =============================
      Report:00OE0000002wlroMAA
      Date range:2016-01-01 to 2016-01-05
      Output to:ReportOutput_2016-01-01_to_2016-01-05.csv
      Done:1755 records written.
      Async reports requested:5 - (succeeded:5,failed:0).


This creates the file *ReportOutput_2016-01-01_to_2016-01-05.csv*.

##

## How it works
The program will iterate day by day – changing the standard date filter – to download the results. Since Salesforce synchronous report runs have a hourly limit, the reports are run asynchronously. The report is requested for multiple days in parallel to speed up the process.

## Why this library?
I needed to automate the download of a large report to a CSV file. This task was done manually earlier and would take a long time to complete. So I looked into options using Node.

The excellent [jsForce](https://www.npmjs.com/package/jsforce) node module is a great wrapper around the Salesforce REST API. However it does not have a simple way to repeatedly call a report to get more than 2000 results. Unlike SOQL queries, there is no "queryMore" equivalent for reports. So I had to write a lot of non-trivial code to call the same report multiple times, switch to using asynchronous Salesforce reports, run multiple reports in parallel, etc.

This hopefully would help others too, so I'm sharing the module with you.

## Environment variables to login
To run the library relies on the environment variables to store the username and password. This forces (me atleast!) to avoid hard coding it in scripts.

    SF_USER="myuseratsf@xyz.com"
    SF_PASSWD_WITH_TOKEN="password";

The security token is required since the app does not support OAuth sign in at this time. To get your security token, logon to Salesforce. At the top navigation bar go to your name > Setup > Personal Setup > My Personal Information > Reset My Security Token.

This is how you use it. If your password is mypassword, and your security token is XXXXXXXXXX, then you must set SF_PASSWD_WITH_TOKEN to "mypasswordXXXXXXXXXX" to log in.

On the Mac OS X, I add the following lines to ~/.profile and restart Terminal.

    export SF_USER="myuser@sfdomain.com"
    export SF_PASSWD_WITH_TOKEN="passwordTOKEN"

In Windows, you can follow the [instructions to set environment variables](http://www.computerhope.com/issues/ch000549.htm). Restart your command or Powershell window after you set the environment variables.

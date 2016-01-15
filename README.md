# jsforce_downloader

Extract report data from Salesforce. It can download more than 2000 rows. The report must have a standard date filter. The program will iterate day by day – changing the standard date filter – to download the results. Since Sync report runs have a daily limit, Async report runs are used instead. The program runs multiple days in parallel to speed up the process.

Why this library? The excellent [JSFORCE](https://www.npmjs.com/package/jsforce) node module is a great wrapper around the Salesforce REST API. However it does not have a simple way to repeatedly call a report to get more than 2000 results. (In case of SOQL, you can get more than 2000 results by making more calls to the next url that is returned). So I had to write a lot of non-trivial code to call the same report multiple times, switch to using asynchronous Salesforce reports, run multiple reports in parallel.

This is written as a library first. Later I will add a command to run it from the command line.

# Environment variables to login
To run the library relies on the environment variables to store the username and password. This forces (me atleast!) to avoid hard coding it in scripts.

    SF_USER="myuseratsf@xyz.com"
    SF_PASSWD_WITH_TOKEN="password";

The security token is required since the app does not support OAuth sign in at this time. To get your security token, logon to Salesforce. At the top navigation bar go to your name > Setup > Personal Setup > My Personal Information > Reset My Security Token.

This is how you use it. If your password is mypassword, and your security token is XXXXXXXXXX, then you must set SF_PASSWD_WITH_TOKEN to "mypasswordXXXXXXXXXX" to log in.

On the Mac OS X, I add the following lines to ~/.profile and restart Terminal.

    export SF_USER="myuser@sfdomain.com"
    export SF_PASSWD_WITH_TOKEN="passwordTOKEN"

In Windows, you can follow the [instructions to set environment variables](http://www.computerhope.com/issues/ch000549.htm). Restart your command or Powershell window after you set the environment variables.

# jsforce_downloader

Extract report data from Salesforce. It can download more than 2000 rows. The report must have a standard date filter. The program will iterate day by day – changing the standard date filter – to download the results. Since Sync report runs have a daily limit, Async report runs are used instead. The program runs multiple days in parallel to speed up the process.

This is written as a library first.
Later I will add a command to run it from the command line.

# Environment variables to login
To run the library relies on the environment variables to store the username and password. This avoids hard coding it in your scripts.

    SF_USER="myuseratsf@xyz.com"
    SF_PASSWD_WITH_TOKEN="password";

The security token is required since the app does not support OAuth sign in at this time. To get your security token, logon to Salesforce. At the top navigation bar go to your name > Setup > Personal Setup > My Personal Information > Reset My Security Token.

This is how you use it. If your password is mypassword, and your security token is XXXXXXXXXX, then you must set SF_PASSWD_WITH_TOKEN to "mypasswordXXXXXXXXXX" to log in.

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

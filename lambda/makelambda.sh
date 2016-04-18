#!/bin/sh
ARN=arn:aws:iam::852391518417:role/lambda_basic_execution
LAMBDAFN=DownloadSFReport
EVENTFILE=./event.json
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

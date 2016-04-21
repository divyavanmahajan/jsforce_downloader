#!/bin/sh
LAMBDAFN=DownloadSFReport
REPORTID=${1:-00OE0000002wlroMAA}
DATEFIELD=${2:-Case.CreatedDate}
INDEXFIELDOFFSET=${3:-0}
STARTDATE=${4:-2016-01-01}
ENDDATE=${5:-2016-01-05}
EVENTTEMPLATE=${6:-pipeline_template.json}
PIPELINETEMPLATE=${7:-pipeline_template.json}
BUCKET=${8:-testbucket-hissreporting}
AWSPROFILE=${9:-dhruv}
E_BADARGS=85

if [ $# -ne 9 ]
then
  echo "Usage: `basename $0` reportid datefield indexfieldOffset 2016-01-01 2016-01-05 event_template pipeline_template bucket awsprofile"
  exit $E_BADARGS
fi

mkdir ${REPORTID}
(cd ${REPORTID};rm _pipelineid.txt pipeline-${REPORTID}.json event-${REPORTID}.json 2> /dev/null)

echo --- Get report metadata and SQL commands ---
echo jsforce_downloader_metadata ${REPORTID} 
(cd ${REPORTID};jsforce_downloader_metadata ${REPORTID} > /dev/null)
# vi ReportSQL_${REPORTID}-sql.json

echo " "
echo --- Generate the pipeline definition --
pwd
echo node generate_definition.js $REPORTID $DATEFIELD $INDEXFIELDOFFSET $STARTDATE $ENDDATE $EVENTTEMPLATE $PIPELINETEMPLATE $BUCKET $AWSPROFILE
node generate_definition.js $REPORTID $DATEFIELD $INDEXFIELDOFFSET $STARTDATE $ENDDATE $EVENTTEMPLATE $PIPELINETEMPLATE $BUCKET $AWSPROFILE
echo "\n\nEdit the SQL in this file to add the primary key, if the table does not exist. Enter 'Y' to continue."
read DUMMY
vi ${REPORTID}/pipeline-${REPORTID}.json

cd ${REPORTID}
echo " "
echo --- Create the pipeline ---
echo aws datapipeline create-pipeline --name PIPE-$REPORTID --unique-id $REPORTID --profile $AWSPROFILE | tee _pipelineid.txt
aws datapipeline create-pipeline --name PIPE-$REPORTID --unique-id $REPORTID --profile $AWSPROFILE | tee _pipelineid.txt
PIPELINE_ID=`cat _pipelineid.txt |sed -e "3d" -e "1d" -e "s:^.*\(df-[0-9A-Z]*\).*$:\1:g"`
echo $PIPELINE_ID > pipelineid.txt
rm _pipelineid.txt


echo " "
echo --- Uploading definition ---
echo Pipeline ID : $PIPELINE_ID
echo aws datapipeline put-pipeline-definition --pipeline-id $PIPELINE_ID --pipeline-definition file://./pipeline-${REPORTID}.json --profile $AWSPROFILE
aws datapipeline put-pipeline-definition --pipeline-id $PIPELINE_ID --pipeline-definition file://./pipeline-${REPORTID}.json --profile $AWSPROFILE

echo " "
EVENTFILE=event-${REPORTID}.json
echo -- Scripts --
cat >invoke_lambda.sh <<EOF
echo --- Invoking Lambda function ${LAMBDAFN} for ${EVENTFILE} - ${REPORTID} - ${STARTDATE} to ${ENDDATE}
rm outputfile.txt
aws lambda invoke \
--invocation-type RequestResponse \
--function-name $LAMBDAFN \
--region us-east-1 \
--log-type Tail \
--payload file://$EVENTFILE \
--profile $AWSPROFILE \
outputfile.txt
cat outputfile.txt
EOF
chmod a+x invoke_lambda.sh
echo Use invoke_lambda.sh to to invoke AWS Lambda function $LAMBDAFN with ${EVENTFILE}.

cat >invoke_pipe.sh <<EOF2
echo --- Activating AWS Datapipeline for PIPE-${REPORTID} - to load T${REPORTID}
aws datapipeline activate-pipeline --pipeline-id $PIPELINE_ID --profile $AWSPROFILE
EOF2
chmod a+x invoke_pipe.sh
echo Use invoke_pipe.sh to start the pipeline to load data into Redshift.



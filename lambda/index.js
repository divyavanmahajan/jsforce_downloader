/**
 * Event JSON should be
 * event.config = JSForce_Downloader config options that override the defaults.
 * event.options = JSForce_Downloader parameters to download the report.
 */
exports.handler = (event, context, callback) => {
    var config = {
        WRITE_TEMP_FILES: false,
        REPORTPREFIX: "LambdaReportOut_",
        "SF_USER": "ei_heartbeat@philips.com",
        "SF_PASSWD_WITH_TOKEN": "OneEms@2013Suy5PMgqhJELxkOLQjdcNHIeB",
        OUTPUTTO: "s3",
        GZIP: true,
    };

    if (event.config) {
        for (var key in event.config)
            config[key] = event.config[key];
    }
    var options = event.options;
    if (options) {
        jsforce_downloader.initialize(config);
        jsforce_downloader.downloadreport(options.report, options.datefield, options.indexfield, options.startdate, options.enddate).then(
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
    }
};
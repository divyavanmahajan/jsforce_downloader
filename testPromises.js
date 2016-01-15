function waitForInstance(reportinstance, waitdelay) {
    var waitpromise = Promise.resolve();
    function checkStatus() {
        return waitpromise.then(function () {
            return delay(waitdelay)
                .then(function () {
                    return reportinstance.retrieve()
                })
                .then(function (result) {
                    /*
                    if (result == undefined || result.attributes == undefined || result.attributes.status == undefined)
                    {
                        console.error('Result undefined - retrying');
                        return checkStatus();                    
                    }
                    */
                    status = result.attributes.status;
                    if (status != "Success" && status != "Error") {
                        return checkStatus();
                    }
                    return result;
                }, function (err) {
                    console.error('Cannot retrieve instance status:' + err);
                    //return checkStatus();
                });
        });
    }
    return checkStatus();
}
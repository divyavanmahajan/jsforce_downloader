// Test script for your Amazon Lambda function
//

var index = require('./index.js');
var event = require('./event.json');
index.handler(event);
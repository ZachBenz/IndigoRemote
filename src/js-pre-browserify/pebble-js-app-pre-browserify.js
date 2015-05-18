/*
  Indigo Remote
 
  Copyright (c) 2014, Zachary Benz
  Copyright (c) 2015, Seth Goldman
  All rights reserved.
 
  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:
 
  1. Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.
  2. Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
 
  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
  ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
  ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
  SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

// Some things we need to define to get node.js modules to work
if (typeof window.location === "undefined") {
    window.location = [];
}
if (typeof window.location.protocol === "undefined") {
    window.location.protocol = "http:";
}

var MAX_DEVICE_NAME_LENGTH = 95; // 1 less than max on Pebble side to allow for strncpy to insert terminating null
var MAX_ACTION_NAME_LENGTH = 95; // 1 less than max on Pebble side to allow for strncpy to insert terminating null
var DEFAULT_TIMEOUT_BACKOFF = 100;

var deviceCount = localStorage.getItem("deviceCount");
if (!deviceCount) deviceCount = 0;

var devices = JSON.parse(localStorage.getItem("devices"));
if (!devices) devices = [];

var actionCount = localStorage.getItem("actionCount");
if (!actionCount) actionCount = 0;

var actions = JSON.parse(localStorage.getItem("actions"));
if (!actions) actions = [];

// Config approach using data URI adopted from: https://github.com/bertfreudenberg/PebbleONE/blob/c0b9ef6143a9f3655c5faa810baa88208eb6c1d8/src/js/pebble-js-app.js
var config_html; // see bottom of file

var config = {
    useReflector: false,
    reflectorAddress: "",
    serverAddress: "",
    serverPort: "8176",
    userName: "",
    userPass: ""
};

function init_config() {
    var localVal;
    localVal = localStorage.getItem("useReflector");
    if (localVal !== "undefined") config.useReflector = localVal;

    localVal = localStorage.getItem("reflectorAddress");
    if (localVal) config.reflectorAddress = localVal;

    localVal = localStorage.getItem("serverAddress");
    if (localVal) config.serverAddress = localVal;

    localVal = localStorage.getItem("serverPort");
    if (localVal) config.serverPort = localVal;

    localVal = localStorage.getItem("userName");
    if (localVal) config.userName = localVal;

    localVal = localStorage.getItem("userPass");
    if (localVal) config.userPass = localVal;
}

init_config();

function buildURL(route) {
    var url = "";
    if (config.useReflector && config.reflectorAddress !== null && config.reflectorAddress.length) {
	url += "http://" + config.reflectorAddress;
    } else {
	url += "http://" + config.serverAddress;
	if (config.serverPort !== null && config.serverPort.length) 
	    url += ":" + config.serverPort;
    }
    url += route;
    return url;
}

var authDigest = require('auth-digest');

function myHttpCall(route, callback) {
    return authDigest.makeHttpCall(buildURL(route), route, callback, config.userName, config.userPass);
}

// Set callback for the app ready event
Pebble.addEventListener("ready", function(e) {
	console.log("Ready to go: " + JSON.stringify(e));
    });

Pebble.addEventListener("showConfiguration", function() {
	console.log("showing configuration");
	var html = config_html.replace('__CONFIG__', JSON.stringify(config), 'g');
	Pebble.openURL('data:text/html,' + encodeURI(html + '<!--.html'));
    });

Pebble.addEventListener("webviewclosed", function(e) {
	console.log("configuration closed");
	// webview closed
	if (e.response === null || e.response.length === 0) {
	    console.log("Changes aborted");
	    return;
	}
	var options = JSON.parse(decodeURIComponent(e.response));
	console.log("Options = " + JSON.stringify(options));
	localStorage.setItem("useReflector", options.useReflector);
	config.useReflector = options.useReflector;
	localStorage.setItem("reflectorAddress", options.reflectorAddress);
	config.reflectorAddress = options.reflectorAddress;
	localStorage.setItem("serverAddress", options.serverAddress);
	config.serverAddress = options.serverAddress;
	localStorage.setItem("serverPort", options.serverPort);
	config.serverPort = options.serverPort;
	localStorage.setItem("userName", options.userName);
	config.userName = options.userName;
	localStorage.setItem("userPass", options.userPass);
	config.userPass = options.userPass;
	send({"loading": 1});
    });

var messageQueue = [], queueInProgress = false, timeoutBackOff = DEFAULT_TIMEOUT_BACKOFF;

function sendNextInQueue() {
    if (messageQueue.length === 0) {
        queueInProgress = false;
        return;
    }
    queueInProgress = true;
    var message = messageQueue[0];
    Pebble.sendAppMessage(message,
			  function (e) {
			      console.log("Succesfully sent message: " + JSON.stringify(messageQueue[0]));
			      // remove the current message from the queue then handle the next one
			      timeoutBackOff = DEFAULT_TIMEOUT_BACKOFF;
			      messageQueue.shift();
			      return sendNextInQueue();
			  },
			  function (e) {
			      console.log("Failed to send message (will retry): " + JSON.stringify(messageQueue[0]));
			      // repeat without removing the current message from the queue
			      // using setTimeout with incremental backoff
			      timeoutBackOff *= 2;
			      setTimeout(sendNextInQueue, timeoutBackOff);
			  }
                          );
}

function send(message) {
    messageQueue.push(message);
    if (!queueInProgress) {
        sendNextInQueue();
    }
}

function sendDeviceCount(deviceCount) {
    send({"device_count_complete": 1,
		"device_count": deviceCount});
}

function sendDeviceInfo(deviceNumber, deviceInfo) {
    send({"device": 1,
		"device_number": deviceNumber,
		"device_name": deviceInfo.device_name,
		"device_on": deviceInfo.device_on});
}

function buildDevice(data, isOn, isValid) {
    var name = data.name.substring(0, MAX_DEVICE_NAME_LENGTH);
    if (! isValid) name = "x" + name;
    return {"device_name": name,
	    "device_rest_url": data.restURL,
	    "device_on": isOn,
	    "verified": isValid
	    };
}

function processDeviceDetail(item, data) {
    if (data === null || data === undefined) {
	// For some reason we're getting errors on these calls instead of having them authenticated.
	// The server reports back the correct information (401) but it's not received by Pebble.
	// It has to do with when the calls are synchronous as opposed to asynchronous. Synchronous
	// calls aren't working.
	console.log("Failed to get details for device: " + item.name);
	devices[deviceCount++] = buildDevice(item, false, false);
	return;
    }
    var info = JSON.parse(data);
    devices[deviceCount++] = buildDevice(item, info.isOn, true);
}

function registerDeviceInfo() {
    // We're done...
    localStorage.setItem("deviceCount", deviceCount);
    localStorage.setItem("devices", JSON.stringify(devices));

    // We've got the total count of controllable devices, so send it out
    sendDeviceCount(deviceCount);
	    
    for (var i=0; i<deviceCount; i++) sendDeviceInfo(i, devices[i]);
}

function getDeviceDetails(response) {
    devices = [];
    deviceCount = 0;
    var numDevices = response.length;
    var count = 0;

    var handler = function(error, data) {
	var item = response[count++];
	if (error !== null) {
	    console.log("Failed to get info for: " + item.name);
	} else {
	    var info = JSON.parse(data);
	    if (info.typeSupportsOnOff && info.displayInUI)
		// We only handle on-off devices
		devices[deviceCount++] = buildDevice(item, info.isOn, true);
	}
	if (count >= numDevices) {
	    registerDeviceInfo();
	} else {
	    item = response[count];
	    myHttpCall(item.restURL, handler);
	}
    };
    
    myHttpCall(response[0].restURL, handler);
}

function getDevices() {
    var uri = "/devices.json";
    var handler = function(error, data) {
	if (error !== null) {
	    console.log("Error getting devices: " + JSON.stringify(error) + data);
	    sendDeviceCount(0);
	} else {
	    var response = JSON.parse(data);
	    if (response.length > 0)
		getDeviceDetails(response);
	    else
		sendDeviceCount(0);
	}
    };
    myHttpCall(uri, handler);
}

function toggleDeviceOnOff(deviceNumber) {
    var path = devices[deviceNumber].device_rest_url + "?toggle=1&_method=put";

    var handler = function(error, data) {
	if (error !== null) {
	    console.log("toggleDeviceOnOff error: " + JSON.stringify(error) + JSON.stringify(data));
	} else {
	    var deviceInfo = JSON.parse(data);
	    devices[deviceNumber].device_on = deviceInfo.isOn;
	    sendDeviceInfo(deviceNumber, devices[deviceNumber]);
	    localStorage.setItem("devices", JSON.stringify(devices));
	}
    };
    myHttpCall(path, handler);
}

function sendActionCount(actionCount) {
    send({"action_count_complete": 1,
		"action_count": actionCount});
}

function sendActionInfo(actionNumber, actionInfo) {
    send({"action": 1,
		"action_number": actionNumber,
		"action_name": actionInfo.action_name});
}

function getActions() {
    var uri = "/actions.json";
    var handler = function(error, data) {
	if (error !== null) {
	    console.log("getActions error: " + JSON.stringify(error));
	    sendActionCount(0);
	} else {
	    var response = JSON.parse(data);
	    if (response.length > 0) {
		actionCount = 0;
		actions = [];
                
		for (var i=0; i<response.length; i++) {
		    // Track action information
		    actions[actionCount++] =
			{
			    "action_name": response[i].name.substring(0, MAX_ACTION_NAME_LENGTH),
			    "action_rest_url": response[i].restURL
			};
		}
		localStorage.setItem("actionCount", actionCount);
		localStorage.setItem("actions", JSON.stringify(actions));
                
		// We've got the total count of actions, so send it out
		sendActionCount(actionCount);
                
		// Now send out the information for each action
		for (i=0; i<actions.length; i++)
		    sendActionInfo(i, actions[i]);
	    }
	}
    };
    myHttpCall(uri, handler);
}

function executeAction(actionNumber) {
    var path = actions[actionNumber].action_rest_url + "?_method=execute";

    var handler = function(error, data) {
	if (error !== null) {
	    console.log("executeAction error: " + JSON.stringify(error));
	} else {
	    sendActionInfo(actionNumber, actions[actionNumber]);
	}
    };
    myHttpCall(path, handler);
}

function dimDevice(deviceNumber, dimLevel) {
    var path = devices[deviceNumber].device_rest_url + "?brightness=" + dimLevel + "&_method=put";
    var handler = function(error, data) {
	if (error !== null) {
	    console.log("dimDevice error: " + JSON.stringify(error));
	} else {
	    var deviceInfo = JSON.parse(data);
	    devices[deviceNumber].device_on = deviceInfo.isOn;
	    sendDeviceInfo(deviceNumber, devices[deviceNumber]);
	    localStorage.setItem("devices", JSON.stringify(devices));
	}
    };
    myHttpCall(path, handler);
}

// Set callback for appmessage events
Pebble.addEventListener("appmessage", function(e) {
	console.log("appmessage received!!!!" + JSON.stringify(e));
	if (e.payload.get_devices_and_actions) {
	    console.log("get_devices_and_actions flag in payload");
	    getDevices();
	    getActions();
	}
	if (e.payload.device_toggle_on_off) {
	    console.log("device_toggle_on_off flag in payload");
	    toggleDeviceOnOff(e.payload.device_number);
	}
	if (e.payload.action_execute) {
	    console.log("action_execute flag in payload");
	    executeAction(e.payload.action_number);
	}
	if (e.payload.device_dim) {
	    console.log("device_dim flag in payload");
	    dimDevice(e.payload.device_number, e.payload.device_dim_level);
	}
    });

/*jshint multistr: true */
config_html = '<!DOCTYPE html>\
<html>\
<head>\
<meta name="viewport" content="width=device-width">\
<style>\
body {\
background-color: rgb(100,100,100);\
font-family: sans-serif;\
}\
div,form {\
text-shadow: 0px 1px 1px white;\
padding: 10px;\
margin: 10px 0;\
border: 1px solid rgb(50,50,50);\
border-radius: 10px;\
background: linear-gradient(rgb(230,230,230), rgb(150,150,150));\
font-size: 20px;\
}\
div.center {text-align: center}\
h1 {color: rgb(100,100,100); margin-top: 0, padding-top: 0;}\
}\
input {\
float: right;\
-webkit-transform-origin: 100% 100%;\
}\
p,a {color: rgb(200,200,200)}\
.textBox { font-size: 20px; }\
.large-btn { font-size: 20px; }\
</style>\
</head>\
<body>\
<div class="center">\
<h1>Indigo Remote</h1>\
</div>\
<div class="center" style="border-style: none;">\
<form onsubmit="return onSubmit(this)">\
<input type="checkbox" name="useReflector" id="useReflector"></input>\
<label for="reflector-address">Prism Reflector:</label>\
<br>\
<input type="text" class="textBox" size="20" name="reflector-address" id="reflector-address" optional></input>\
<br>\
<label for="server-address">Server IP Address:</label>\
<br>\
<input type="text" class="textBox" size="20" name="server-address" id="server-address" required></input>\
<br>\
<label for="server-port">Server Port Number:</label>\
<br>\
<input type="text" class="textBox" size="20" name="server-port" id="server-port" required></input>\
<br>\
<label for="user-name">User Name:</label>\
<br>\
<input type="text" class="textBox" size="20" name="user-name" id="user-name" optional></input>\
<br>\
<label for="user-pass">User Password:</label>\
<br>\
<input type="password" class="textBox" size="20" name="user-pass" id="user-pass" optional></input>\
<br><br>\
<input class="large-btn" type="submit" value="Save">\
<br>\
</form>\
</div>\
<script>\
var config = JSON.parse(\'__CONFIG__\');\
document.getElementById("reflector-address").value = config.reflectorAddress;\
document.getElementById("server-address").value = config.serverAddress;\
document.getElementById("server-port").value = config.serverPort;\
document.getElementById("user-name").value = config.userName;\
document.getElementById("user-pass").value = config.userPass;\
document.getElementById("useReflector").checked = config.useReflector;\
function onSubmit(e) {\
var result = {\
useReflector: document.getElementById("useReflector").checked,\
reflectorAddress: document.getElementById("reflector-address").value,\
serverAddress: document.getElementById("server-address").value,\
serverPort: document.getElementById("server-port").value,\
userName: document.getElementById("user-name").value,\
userPass: document.getElementById("user-pass").value,\
};\
window.location.href = "pebblejs://close#" + JSON.stringify(result);\
return false;\
}\
</script>\
</body>\
</html>';

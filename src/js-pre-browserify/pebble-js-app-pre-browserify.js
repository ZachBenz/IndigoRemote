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

var MAX_DEVICE_NAME_LENGTH = 95; // 1 less than max on Pebble side to allow for strncpy to insert terminating null in strncpy
var MAX_ACTION_NAME_LENGTH = 95; // 1 less than max on Pebble side to allow for strncpy to insert terminating null in strncpy
var DEFAULT_TIMEOUT_BACKOFF = 100;

var deviceCount = localStorage.getItem("deviceCount");
if (!deviceCount) {
    deviceCount = 0;
}

var devices = JSON.parse(localStorage.getItem("devices"));
if (!devices) {
    devices = [];
}

var actionCount = localStorage.getItem("actionCount");
if (!actionCount) {
    actionCount = 0;
}

var actions = JSON.parse(localStorage.getItem("actions"));
if (!actions) {
    actions = [];
}

// Config approach using data URI adopted from: https://github.com/bertfreudenberg/PebbleONE/blob/c0b9ef6143a9f3655c5faa810baa88208eb6c1d8/src/js/pebble-js-app.js
var config_html; // see bottom of file

var config = {
    reflectorAddress: "",
    serverAddress: "",
    serverPort: "8176",
    userName: "",
    userPass: ""
};

    

function init_config() {
    var localVal;
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

function buildURL(route) {
    var url = "";
    if (config.reflectorAddress !== null && config.reflectorAddress.length) {
	url += "https://" + config.reflectorAddress;
    } else {
	url += "http://" + config.serverAddress;
	if (config.serverPort !== null && config.serverPort.length) 
	    url += ":" + config.serverPort;
    }
    url += route;
    return url;
}

function getHttpRequest(route, async, req) {
    var url = buildURL(route);
    console.log("getHttpRequest: " + url);

    var authHdr = buildAuthResponse(req, route);
    req = new XMLHttpRequest();
    req.open('GET', url, authHdr.length === 0 && async); // Second call is synchronous
    req.setRequestHeader('Content-Type', 'application/json');

    if (authHdr.length) {
	//console.log("Setting Authorization: " + authHdr);
	req.setRequestHeader("Authorization", authHdr);
    }
    return req;
}

function makeHttpCall(route, async, handler)
{
    return makeHttpCallInternal(route, async, handler, null);
}

function makeHttpCallInternal(route, async, handler, origReq) 
{
    var req = getHttpRequest(route, async, origReq);
    if (handler !== null) 
	req.onload = function(e) {
	    if (origReq === null && responseUnauthorized(req)) {
		console.log("Making second call (asynchronous)");
		return makeHttpCallInternal(route, async, handler, req);
	    }
	    handler(req, e);
	};
    req.send();
    if (! async && handler === null && origReq === null && responseUnauthorized(req)) {
	console.log("Making second call (synchronous)");
	return makeHttpCallInternal(route, async, handler, req);
    }
    if (! responseOK(req)) {
	console.log("Error: " + JSON.stringify(req));
    }
    return req;
}

init_config();

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

function unquotes(val) 
{
    return val.replace(/^\"+|\"+$/gm, '');
}

var nc = 1;

function pad(num, size) 
{
    var s = num+"";
    while (s.length < size) s = "0" + s;
    return s;
}

function genNonce(len) {
    var text = "";
    var possible = "ABCDEF0123456789";
    for(var i=0; i<len; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function buildAuthResponse(req, uri) 
{
    if (req === null) return "";
    var challenge = req.getResponseHeader('WWW-Authenticate');
    if (challenge === null || challenge === undefined) return "";
    var pos = challenge.indexOf(" ");
    var tokens = {cnonce: genNonce(16)};
    var pairs = challenge.substr(pos).trim().split(',');
    tokens.nc = pad(nc++, 8);

    for (var token in pairs) {
	//console.log(pairs[token].trim());
	var pair = pairs[token].trim().split('=');
	tokens[pair[0]] = pair[1];
    }

    var md5 = require('crypto-js/md5');
    var HA1 = md5(config.userName + ":" + unquotes(tokens.realm) + ":" + config.userPass);
    var HA2 = md5("GET:" + uri);
    var authResponse = md5(HA1 + ':' + 
			   unquotes(tokens.nonce) + ':' +
			   tokens.nc + ':' +
			   tokens.cnonce + ':' +
			   unquotes(tokens.qop) + ':' +
			   HA2);
    var responseContentHeader = "Digest " +
	'username="' + config.userName + '"' +
	', realm=' + tokens.realm +
	', nonce=' + tokens.nonce +
	', uri="' + uri + '"' +
	//	', algorithm=' + tokens.algorithm +
	', response="' + authResponse + '"' +
	', qop=' + unquotes(tokens.qop) +
	', nc=' + tokens.nc +
	', cnonce="' + tokens.cnonce + '"';
    
    return responseContentHeader;
}

function responseOK(req) {
    return req.readyState == 4 && req.status == 200;
}

function responseUnauthorized(req) {
    return req.readyState == 4 && req.status == 401;
}

/*
192.168.10.28 - - [05/May/2015:19:44:43] "GET /devices.json HTTP/1.1" 401 330 "" "PebbleApp/20150219013617 CFNetwork/711.3.18 Darwin/14.0.0"
192.168.10.28 - - [05/May/2015:19:44:43] "GET /devices.json HTTP/1.1" 401 330 "" "PebbleApp/20150219013617 CFNetwork/711.3.18 Darwin/14.0.0"
192.168.10.28 - seth [05/May/2015:19:44:43] "GET /devices/index.json HTTP/1.1" 200 5833 "" "PebbleApp/20150219013617 CFNetwork/711.3.18 Darwin/14.0.0"

192.168.10.102 - - [05/May/2015:20:08:30] "GET /devices.json HTTP/1.1" 401 330 "" "python-requests/2.5.0 CPython/2.7.6 Darwin/14.3.0"
192.168.10.102 - seth [05/May/2015:20:08:30] "GET /devices/index.json HTTP/1.1" 200 5833 "" "python-requests/2.5.0 CPython/2.7.6 Darwin/14.3.0"

192.168.10.102 - - [05/May/2015:20:04:46] "GET /devices/Seth Office.json HTTP/1.1" 401 330 "" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.45 Safari/537.36"
192.168.10.102 - seth [05/May/2015:20:04:53] "GET /devices/Seth Office.json HTTP/1.1" 200 822 "" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.45 Safari/537.36"
 */

function buildDevice(data, isOn, isValid) {
    return {"device_name": data.name.substring(0, MAX_DEVICE_NAME_LENGTH),
	    "device_rest_url": data.restURL,
	    "device_on": isOn,
	    "verified": isValid
	    };
}

function getDeviceDetails(response) {
    devices = [];
    deviceCount = 0;
    
    for (i=0; i<response.length; i++) {
	var req = makeHttpCall(response[i].restURL, false, null);
	if (responseOK(req)) {
	    var deviceInfo = JSON.parse(req.responseText);
	    devices[deviceCount++] = buildDevice(response[i], deviceInfo.isOn, true);
	} else {
	    // For some reason we're getting errors on these calls instead of having them authenticated.
	    // The server reports back the correct information (401) but it's not received by Pebble.
	    // It has to do with when the calls are synchronous as opposed to asynchronous. Synchronous
	    // calls aren't working.
	    console.log("Device Request: " + response[i].name + " returned error code " + req.statusText);
	    devices[deviceCount++] = buildDevice(response[i], false, false);
	}
    }
    
    localStorage.setItem("deviceCount", deviceCount);
    localStorage.setItem("devices", JSON.stringify(devices));

    // We've got the total count of controllable devices, so send it out
    sendDeviceCount(deviceCount);
                
    for (i=0; i<deviceCount; i++)
	sendDeviceInfo(i, devices[i]);
}

function getDevices() {
    var uri = "/devices.json";
    var handler = function(req, e) {
        if (responseOK(req)) {
            var response = JSON.parse(req.responseText);
            if (response.length > 0)
		getDeviceDetails(response);
            else
                sendDeviceCount(0);
	} else {
	    console.log("Request returned error code " + req.status.toString());
	    sendDeviceCount(0);
	}
    };
    makeHttpCall(uri, true, handler);
}

function toggleDeviceOnOff(deviceNumber) {
    var path = devices[deviceNumber].device_rest_url + "?toggle=1&_method=put";

    var handler = function(req, e) {
            if (responseOK(req)) {
                var deviceInfo = JSON.parse(req.responseText);
                devices[deviceNumber].device_on = deviceInfo.isOn;
                sendDeviceInfo(deviceNumber, devices[deviceNumber]);
                localStorage.setItem("devices", JSON.stringify(devices));
            } else {
                // TODO: inform pebble that toggle failed
                console.log("Request returned error code " + req.status.toString());
		console.log(JSON.stringify(e));
		console.log(JSON.stringify(req));
            }
    };
    makeHttpCall(path, true, handler);
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
    var handler = function(req, e) {
        if (responseOK(req)) {
            var response = JSON.parse(req.responseText);
            if (response.length > 0) {
                actionCount = 0;
                actions = [];
                
                var i;
                for (i=0; i<response.length; i++) {
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
            else {
                sendActionCount(0);
            }
        } else {
            console.log("Request returned error code " + req.status.toString());
            sendActionCount(0);
        }
    };
    makeHttpCall(uri, true, handler);
}

function executeAction(actionNumber) {
    var path = actions[actionNumber].action_rest_url + "?_method=execute";

    var handler = function(req, e) {
        if (responseOK(req)) {
                sendActionInfo(actionNumber, actions[actionNumber]);
            } else {
                // TODO: inform pebble that action failed
                console.log("Request returned error code " + req.status.toString());
            }
    };
    makeHttpCall(path, true, handler);
}

function dimDevice(deviceNumber, dimLevel) {
    var path = devices[deviceNumber].device_rest_url + "?brightness=" + dimLevel + "&_method=put";
    var handler = function(req, e) {
	if (responseOK(req)) {
	    var deviceInfo = JSON.parse(req.responseText);
	    devices[deviceNumber].device_on = deviceInfo.isOn;
	    sendDeviceInfo(deviceNumber, devices[deviceNumber]);
	    localStorage.setItem("devices", JSON.stringify(devices));
	} else {
	    // TODO: inform pebble that dim failed
	    console.log("Request returned error code " + req.status.toString());
	}
    };
    makeHttpCall(path, true, handler);
}

// Set callback for appmessage events
Pebble.addEventListener("appmessage", function(e) {
	console.log("appmessage received!!!!");
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
}\
div.center {text-align: center}\
h1 {color: rgb(100,100,100); margin-top: 0, padding-top: 0;}\
}\
input {\
float: right;\
-webkit-transform-origin: 100% 100%;\
}\
p,a {color: rgb(200,200,200)}\
</style>\
</head>\
<body>\
<div class="center">\
<h1>Indigo Remote</h1>\
</div>\
<form onsubmit="return onSubmit(this)">\
<label for="reflector-address">Prism Reflector:</label>\
<br>\
<input type="text" size="20" name="reflector-address" id="reflector-address" optional></input>\
<br>\
<label for="server-address">Server IP Address:</label>\
<br>\
<input type="text" size="20" name="server-address" id="server-address" required></input>\
<br>\
<label for="server-port">Server Port Number:</label>\
<br>\
<input type="text" size="20" name="server-port" id="server-port" required></input>\
<br>\
<label for="user-name">User Name:</label>\
<br>\
<input type="text" size="20" name="user-name" id="user-name" optional></input>\
<br>\
<label for="user-pass">User Password:</label>\
<br>\
<input type="password" size="20" name="user-pass" id="user-pass" optional></input>\
<br><br>\
<input type="submit" value="Save">\
<br>\
</form>\
<script>\
var config = JSON.parse(\'__CONFIG__\');\
document.getElementById("reflector-address").value = config.reflectorAddress;\
document.getElementById("server-address").value = config.serverAddress;\
document.getElementById("server-port").value = config.serverPort;\
document.getElementById("user-name").value = config.userName;\
document.getElementById("user-pass").value = config.userPass;\
function onSubmit(e) {\
var result = {\
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

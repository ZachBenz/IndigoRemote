/*
 Indigo Remote
 
 Copyright (c) 2014, Zachary Benz
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
    serverAddress: "",
    serverPort:    "8000"
};

config.serverAddress = localStorage.getItem("serverAddress");
if (!config.serverAddress) {
    config.serverAddress = "";
}

config.serverPort = localStorage.getItem("serverPort");
if (config.serverPort) {
    config.serverPort = "8000";
}

var prefixForGet = "http://" + config.serverAddress + ":" + config.serverPort;
console.log("prefixForGet is: " + prefixForGet);

// Set callback for the app ready event
Pebble.addEventListener("ready", function(e) {
    console.log("connect!" + e.ready);
    console.log(e.type);
});

Pebble.addEventListener("showConfiguration", function() {
    console.log("showing configuration");
//    Pebble.openURL('https://s3.amazonaws.com/IndigoRemote/settings.html?serverAddress=' + serverAddress + '&serverPort=' + serverPort);
    var html = config_html.replace('__CONFIG__', JSON.stringify(config), 'g');
    Pebble.openURL('data:text/html,' + encodeURI(html + '<!--.html'));
});

Pebble.addEventListener("webviewclosed", function(e) {
    send({"loading": 1});
    console.log("configuration closed");
    // webview closed
    var options = JSON.parse(decodeURIComponent(e.response));
    console.log("Options = " + JSON.stringify(options));
    localStorage.setItem("serverAddress", options.serverAddress);
    config.serverAddress = options.serverAddress;
    localStorage.setItem("serverPort", options.serverPort);
    config.serverPort = options.serverPort;
    prefixForGet = "http://" + config.serverAddress + ":" + config.serverPort;
    getDevices();
    getActions();
});

var messageQueue = [], queueInProgress = false, timeoutBackOff = DEFAULT_TIMEOUT_BACKOFF;
function sendNextInQueue() {
    if (messageQueue.length === 0) {
        queueInProgress = false;
        return;
    } else {
        queueInProgress = true;
    }
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

function getDevices() {
    var req = new XMLHttpRequest();
    // Get the list of all devices known to the Indigo Server
    req.open('GET', prefixForGet + "/devices.json", true);  // `true` makes the request asynchronous
    // Indigo uses Digest authentication, so this won't work:
    //    req.setRequestHeader("Authorization", "Basic " + btoa(username + ":" + password))
    // Instead, see http://stackoverflow.com/questions/10937890/javascript-digest-manually-authentication?rq=1
    // TODO: Support Digest Authentication
    req.onload = function(e) {
        if(req.status == 200) {
            var response = JSON.parse(req.responseText);
            if (response.length > 0) {
                // Pare down to just devices that have typeSupportsOnOff: true
                deviceCount = 0;
                devices = [];
                
                var i, j;
                for (i = 0, j = response.length; i < j; i += 1) {
                    var deviceRequest = new XMLHttpRequest();
                    deviceRequest.open('GET', prefixForGet + response[i].restURL, false);  // `false` makes the request synchronous
                    deviceRequest.send(null);
                    if( deviceRequest.status == 200) {
                        // Track device information
                        var deviceInfo = JSON.parse(deviceRequest.responseText);
                        if (deviceInfo.typeSupportsOnOff) {
                            devices[deviceCount] =
                            {
                                "device_name": deviceInfo.name.substring(0, MAX_DEVICE_NAME_LENGTH),
                                "device_rest_url": response[i].restURL,
                                "device_on": deviceInfo.isOn
                            };
                            deviceCount++;
                        }
                    }
                    else {
                        console.log("Request for device " + response[i].restURL + " returned error code " + deviceRequest.status.toString());
                    }
                }
                localStorage.setItem("deviceCount", deviceCount);
                localStorage.setItem("devices", JSON.stringify(devices));
                
                // We've got the total count of controllable devices, so send it out
                sendDeviceCount(deviceCount);
                
                // Now send out the information for each device
                for (i = 0, j = devices.length; i < j; i += 1) {
                    sendDeviceInfo(i, devices[i]);
                }
            }
            else {
                sendDeviceCount(0);
            }
        } else {
            console.log("Request returned error code " + req.status.toString());
            sendDeviceCount(0);
        }
    };
    req.send(null);
}

function toggleDeviceOnOff(deviceNumber) {
    var req = new XMLHttpRequest();
    // TODO: Support Digest Authentication
    req.open('GET', prefixForGet + devices[deviceNumber].device_rest_url + "?toggle=1&_method=put", true);  // `true` makes the request asynchronous
    req.onload = function(e) {
        if (req.readyState == 4) {
            // 200 - HTTP OK
            if(req.status == 200) {
                var deviceInfo = JSON.parse(req.responseText);
                devices[deviceNumber].device_on = deviceInfo.isOn;
                sendDeviceInfo(deviceNumber, devices[deviceNumber]);
                localStorage.setItem("devices", JSON.stringify(devices));
            } else {
                // TODO: inform pebble that toggle failed
                console.log("Request returned error code " + req.status.toString());
            }
        }
    };
    req.send(null);
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
    var req = new XMLHttpRequest();
    // Get the list of all actions known to the Indigo Server
    req.open('GET', prefixForGet + "/actions.json", true);  // `true` makes the request asynchronous
    // Indigo uses Digest authentication, so this won't work:
    //    req.setRequestHeader("Authorization", "Basic " + btoa(username + ":" + password))
    // Instead, see http://stackoverflow.com/questions/10937890/javascript-digest-manually-authentication?rq=1
    // TODO: Support Digest Authentication
    req.onload = function(e) {
        if(req.status == 200) {
            var response = JSON.parse(req.responseText);
            if (response.length > 0) {
                actionCount = 0;
                actions = [];
                
                var i,j;
                for (i = 0, j = response.length; i < j; i += 1) {
                    // Track action information
                    actions[actionCount] =
                    {
                        "action_name": response[i].name.substring(0, MAX_ACTION_NAME_LENGTH),
                        "action_rest_url": response[i].restURL
                    };
                    actionCount++;
                }
                localStorage.setItem("actionCount", actionCount);
                localStorage.setItem("actions", JSON.stringify(actions));
                
                // We've got the total count of actions, so send it out
                sendActionCount(actionCount);
                
                // Now send out the information for each action
                for (i = 0, j = actions.length; i < j; i += 1) {
                    sendActionInfo(i, actions[i]);
                }
            }
            else {
                sendActionCount(0);
            }
        } else {
            console.log("Request returned error code " + req.status.toString());
            sendActionCount(0);
        }
    };
    req.send(null);
}

function executeAction(actionNumber) {
    var req = new XMLHttpRequest();
    // TODO: Support Digest Authentication
    req.open('GET', prefixForGet + actions[actionNumber].action_rest_url + "?_method=execute", true);  // `true` makes the request asynchronous
    req.onload = function(e) {
        if (req.readyState == 4) {
            // 200 - HTTP OK
            if (req.status == 200) {
                sendActionInfo(actionNumber, actions[actionNumber]);
            } else {
                // TODO: inform pebble that action failed
                console.log("Request returned error code " + req.status.toString());
            }
        }
    };
    req.send(null);
}

function dimDevice(deviceNumber, dimLevel) {
    var req = new XMLHttpRequest();
    // TODO: Support Digest Authentication
    req.open('GET', prefixForGet + devices[deviceNumber].device_rest_url + "?brightness=" + dimLevel + "&_method=put", true);  // `true` makes the request asynchronous
    req.onload = function(e) {
        if (req.readyState == 4) {
            // 200 - HTTP OK
            if(req.status == 200) {
                var deviceInfo = JSON.parse(req.responseText);
                devices[deviceNumber].device_on = deviceInfo.isOn;
                sendDeviceInfo(deviceNumber, devices[deviceNumber]);
                localStorage.setItem("devices", JSON.stringify(devices));
            } else {
                // TODO: inform pebble that dim failed
                console.log("Request returned error code " + req.status.toString());
            }
        }
    };
    req.send(null);
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
<label for="server-address">Server IP Address:</label>\
<br>\
<input type="text" size="15" name="server-address" id="server-address" required></input>\
<br>\
<label for="server-port">Server Port Number:</label>\
<br>\
<input type="text" size="15" name="server-port" id="server-port" required></input>\
<br><br>\
<input type="submit" value="Save">\
<br>\
</form>\
<p>\
Authenticated connections and Prism Reflector are not yet supported.<br>\
</p>\
<script>\
var config = JSON.parse(\'__CONFIG__\');\
document.getElementById("server-address").value = config.serverAddress;\
document.getElementById("server-port").value = config.serverPort;\
function onSubmit(e) {\
var result = {\
serverAddress: document.getElementById("server-address").value,\
serverPort: document.getElementById("server-port").value,\
};\
window.location.href = "pebblejs://close#" + JSON.stringify(result);\
return false;\
}\
</script>\
</body>\
</html>';
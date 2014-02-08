var MAX_DEVICE_NAME_LENGTH = 95; // 1 less than max on Pebble side to allow for strncpy to insert terminating null in strncpy
var MAX_ACTION_NAME_LENGTH = 95; // 1 less than max on Pebble side to allow for strncpy to insert terminating null in strncpy
var DEFAULT_TIMEOUT = 400;
var TIMEOUT_SPACING = 200;

var deviceCount = localStorage.getItem("deviceCount");
if (!deviceCount) {
    deviceCount = 0;
}

var devices = JSON.parse(localStorage.getItem("devices"));
if (!devices) {
    devices = new Array();
}

var actionCount = localStorage.getItem("actionCount");
if (!actionCount) {
    actionCount = 0;
}

var actions = JSON.parse(localStorage.getItem("actions"));
if (!actions) {
    actions = new Array();
}

var serverAddress = localStorage.getItem("serverAddress");
if (!serverAddress) {
    serverAddress = "";
}

var serverPort = localStorage.getItem("serverPort");
if (!serverPort) {
    serverPort = "8000";
}

var prefixForGet = "http://" + serverAddress + ":" + serverPort;
console.log("prefixForGet is: " + prefixForGet);

// Set callback for the app ready event
Pebble.addEventListener("ready", function(e) {
    console.log("connect!" + e.ready);
    console.log(e.type);
});

Pebble.addEventListener("showConfiguration", function() {
    console.log("showing configuration");
    Pebble.openURL('https://s3.amazonaws.com/IndigoRemote/settings.html?serverAddress=' + serverAddress + '&serverPort=' + serverPort);
});

Pebble.addEventListener("webviewclosed", function(e) {
    console.log("configuration closed");
    // webview closed
    var options = JSON.parse(decodeURIComponent(e.response));
    console.log("Options = " + JSON.stringify(options));
    localStorage.setItem("serverAddress", options.serverAddress);
    serverAddress = options.serverAddress;
    localStorage.setItem("serverPort", options.serverPort);
    serverPort = options.serverPort;
});

function sendDeviceCount(deviceCount) {
    Pebble.sendAppMessage({"device_count": deviceCount},
        function(e){
            console.log("Sent device_count message. transactionId=" + e.data.transactionId);
        },
        function(e){
            console.log("Unable to send device_count message. transactionId=" + e.data.transactionId);
            setTimeout(sendDeviceCount(deviceCount), DEFAULT_TIMEOUT);
        }
    );
}

function sendDeviceInfo(deviceNumber, deviceInfo) {
    Pebble.sendAppMessage({"device": 1,
                          "device_number": deviceNumber,
                          "device_name": deviceInfo.device_name,
                          "device_on": deviceInfo.device_on
                          },
        function(e){
            console.log("Sent device message. device=" + deviceInfo.device_name + " transactionId=" + e.data.transactionId);
        },
        function(e){
            console.log("Unable to send device message. device=" + deviceInfo.device_name + " transactionId=" + e.data.transactionId);
            setTimeout(sendDeviceInfo(deviceNumber, deviceInfo), DEFAULT_TIMEOUT);
        }
    );
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
                deviceCount = 0
                devices = new Array();
                
                for (var i = 0, j = response.length; i < j; i += 1) {
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
                
                // Need to pace ourselves so we don't overwhelm Pebble
                var timeout = DEFAULT_TIMEOUT;
                
                // Now send out the information for each device
                for (var i = 0, j = devices.length; i < j; i += 1) {
                    setTimeout(sendDeviceInfo(i, devices[i]), timeout);
                    // Space out the messages in time
                    timeout += TIMEOUT_SPACING;
                }
            }
            else {
                sendDeviceCount(0);
            }
        } else {
            console.log("Request returned error code " + req.status.toString());
            sendDeviceCount(0);
        }
    }
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
    }
    req.send(null);
}

function sendActionCount(actionCount) {
    Pebble.sendAppMessage({"action_count": actionCount},
        function(e){
            console.log("Sent action_count message. transactionId=" + e.data.transactionId);
        },
        function(e){
            console.log("Unable to send action_count message. transactionId=" + e.data.transactionId);
            setTimeout(sendActionCount(actionCount), DEFAULT_TIMEOUT);
        }
    );
}

function sendActionInfo(actionNumber, actionInfo) {
    Pebble.sendAppMessage({"action": 1,
                          "action_number": actionNumber,
                          "action_name": actionInfo.action_name
                          },
        function(e){
            console.log("Sent action message. action=" + actionInfo.action_name + " transactionId=" + e.data.transactionId);
        },
        function(e){
            console.log("Unable to send action message. action=" + actionInfo.action_name + " transactionId=" + e.data.transactionId);
            setTimeout(sendActionInfo(actionNumber, actionInfo), DEFAULT_TIMEOUT);
        }
    );
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
                actions = new Array();
                
                for (var i = 0, j = response.length; i < j; i += 1) {
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
                
                // Need to pace ourselves so we don't overwhelm Pebble
                var timeout = DEFAULT_TIMEOUT;
                
                // Now send out the information for each action
                for (var i = 0, j = actions.length; i < j; i += 1) {
                    setTimeout(sendActionInfo(i, actions[i]), timeout);
                    // Space out the messages in time
                    timeout += TIMEOUT_SPACING;
                }
            }
            else {
                sendActionCount(0);
            }
        } else {
            console.log("Request returned error code " + req.status.toString());
            sendActionCount(0);
        }
    }
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
    }
    req.send(null);
}

function dimDevice(dimRequest) {
    var req = new XMLHttpRequest();
    // TODO: Support Digest Authentication
    req.open('GET', prefixForGet + devices[dimRequest.device_dim].device_rest_url + "?brightness=" + dimRequest.device_dim_level + "&_method=put", true);  // `true` makes the request asynchronous
    req.onload = function(e) {
        if (req.readyState == 4) {
            // 200 - HTTP OK
            if(req.status == 200) {
                var deviceInfo = JSON.parse(req.responseText);
                devices[dimRequest.device_dim].device_on = deviceInfo.isOn;
                sendDeviceInfo(dimRequest.device_dim, devices[dimRequest.device_dim]);
                localStorage.setItem("devices", JSON.stringify(devices));
            } else {
                // TODO: inform pebble that dim failed
                console.log("Request returned error code " + req.status.toString());
            }
        }
    }
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
        toggleDeviceOnOff(e.payload.device_toggle_on_off);
    }
    if (e.payload.action_execute) {
        console.log("action_execute flag in payload");
        executeAction(e.payload.action_execute);
    }
    if (e.payload.device_dim) {
        console.log("device_dim flag in payload");
        dimDevice(e.payload);
    }
});
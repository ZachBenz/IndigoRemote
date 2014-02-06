var MAX_DEVICE_NAME_LENGTH = 16;

var deviceCount = localStorage.getItem("deviceCount");
if (!deviceCount) {
    deviceCount = 0;
}

var devices = JSON.parse(localStorage.getItem("devices"));
if (!devices) {
    devices = new Array();
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

//var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
//
//function btoa (input) {
//    for (
//         // initialize result and counter
//         var block, charCode, idx = 0, map = chars, output = '';
//         // if the next input index does not exist:
//         //   change the mapping table to "="
//         //   check if d has no fractional digits
//         input.charAt(idx | 0) || (map = '=', idx % 1);
//         // "8 - idx % 1 * 8" generates the sequence 2, 4, 6, 8
//         output += map.charAt(63 & block >> 8 - idx % 1 * 8)
//         ) {
//        charCode = input.charCodeAt(idx += 3/4);
//        if (charCode > 0xFF) {
//            console.log("'btoa' failed: The string to be encoded contains characters outside of the Latin1 range.");
//        }
//        block = block << 8 | charCode;
//    }
//    return output;
//}

// Basic sleep function based on ms.
// BUSY WAITS!!!
// We need this because otherwise we overwhelm Pebble with AppMessages and
// it drops them all.  Using setTimeout just makes everything async and out
// of order, without really solving the problem.
function busyWaitSleep(ms) {
    var unixtime_ms = new Date().getTime();
    while(new Date().getTime() < unixtime_ms + ms) {}
}

function sendDeviceCount(deviceCount) {
    Pebble.sendAppMessage({"device_count": deviceCount},
        function(e){
            console.log("Sent device_count message. transactionId=" + e.data.transactionId);
        },
        function(e){
            console.log("Unable to send device_count message. transactionId=" + e.data.transactionId);
            setTimeout(sendDeviceCount(deviceCount), 400);
//            busyWaitSleep(400);
//            sendDeviceCount(deviceCount)
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
            console.log("Sent device message. device=" + deviceInfo.name + " transactionId=" + e.data.transactionId);
        },
        function(e){
            console.log("Unable to send device message. device=" + deviceInfo.name + " transactionId=" + e.data.transactionId);
            setTimeout(sendDeviceInfo(deviceNumber, deviceInfo), 400);
//            busyWaitSleep(400);
//            sendDeviceInfo(deviceNumber, deviceInfo);
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
            var price;
            if (response.length > 0) {
                // Pare down to just devices that have typeSupportsOnOff: true
                deviceCount = 0
                devices = new Array();
                
                for (var i = 0, j = response.length; i < j; i += 1) {
                    var deviceRequest = new XMLHttpRequest();
                    deviceRequest.open('GET', prefixForGet + "/devices/" + response[i].nameURLEncoded + ".json", false);  // `false` makes the request synchronous
                    deviceRequest.send(null);
                    if( deviceRequest.status == 200) {
                        // Track device information
                        var deviceInfo = JSON.parse(deviceRequest.responseText);
                        if (deviceInfo.typeSupportsOnOff) {
                            devices[deviceCount] =
                            {
                                "device_name": deviceInfo.name.substring(0, MAX_DEVICE_NAME_LENGTH),
                                "device_url_name": response[i].nameURLEncoded,
                                "device_on": deviceInfo.isOn
                            };
                            deviceCount++;
                        }
                    }
                    else {
                        console.log("Request for device " + response[i].nameURLEncoded + " returned error code " + deviceRequest.status.toString());
                    }
                }
                localStorage.setItem("deviceCount", deviceCount);
                localStorage.setItem("devices", JSON.stringify(devices));
                
                // Need to pace ourselves so we don't overwhelm Pebble
                var timeout = 400;
                
                // We've got the total count of controllable devices, so send it out
                sendDeviceCount(deviceCount);
//                busyWaitSleep(timeout);
                
                // Now send out the information for each device
                for (var i = 0, j = devices.length; i < j; i += 1) {
                    setTimeout(sendDeviceInfo(i, devices[i], timeout));
//                    sendDeviceInfo(i, devices[i]);
//                    busyWaitSleep(timeout);
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
    req.open('GET', prefixForGet + "/devices/" + devices[deviceNumber].device_url_name + ".json?toggle=1&_method=put", true);  // `true` makes the request asynchronous
    req.onload = function(e) {
        if (req.readyState == 4) {
            // 200 - HTTP OK
            if(req.status == 200) {
                var deviceInfo = JSON.parse(req.responseText);
                devices[deviceNumber].device_on = deviceInfo.isOn;
                sendDeviceInfo(deviceNumber, devices[deviceNumber]);
                localStorage.setItem("devices", JSON.stringify(devices));
            } else {
                console.log("Request returned error code " + req.status.toString());
            }
        }
    }
    req.send(null);
}


// Set callback for appmessage events
Pebble.addEventListener("appmessage", function(e) {
    if (e.payload.get_devices) {
        console.log("get_devices flag in payload");
        getDevices();
    }
    if (e.payload.device_toggle_on_off) {
        console.log("device_toggle_on_off flag in payload");
        toggleDeviceOnOff(e.payload.device_toggle_on_off);
    }
});
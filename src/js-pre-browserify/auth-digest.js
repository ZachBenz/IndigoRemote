/*
 auth-digest.js

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

/*
 This is the only entry point.

 makeHttpCall will catch 401 (unauthorized) errors and retry the request with
 the proper authentication header for digest authentication.

 url:       This is the fully qualified path to the resource
 callback:  A standard Node.js callback function (error, xhr)
 username:  The username to use for authentication
 password:  The password to user for authentication

 Returns: nothing;

 */

//var XMLHttpRequest = module_exist('xmlhttprequest') ? require('xmlhttprequest').XMLHttpRequest : null;
var http = require('http');
var https = require('https');
var url = require('url');
var authHdr = "";

exports.makeHttpCall = function (url, callback, username, password) {
    if (XMLHttpRequest !== null)
        return makeHttpCallInternal(url, callback, username, password, null, 0);
    return doHttpGet(url, callback, username, password, null);
};

exports.makeHttpCallPebble = function(url, callback, username, password) {
    return makeHttpCallInternal(url, callback, username, password, null, 0);
}

function module_exist(name) {
    /**
     * This is UGLY but since we're not allowed to require 'native_module'
     * this is the only way to test if a native module (or non-native module) exist.
     */
    try {
        require(name);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            return false;
        }
    }
    return true;
};

function doHttpGet(uri, callback, username, password, challenge) {
    var options = url.parse(uri);
    authHdr = buildAuthResponse(challenge, options['pathname'], username, password);

    if (authHdr !== null && authHdr != "") {
        options.headers = {'Authorization': authHdr};
        //console.log("AuthHdr = " + authHdr);
    }

    var onResponse = function (response) {
        if (response.statusCode == 401) {
            // Unauthorized
            if (challenge === null) {
                challenge = getAuthenticateHdr(response);
                return doHttpGet(uri, callback, username, password, challenge);
            }
            console.log("Too many authorization failures.");
        } else if (response.statusCode == 200) {
            // Success
            //console.log("Succeeded");
            response.setEncoding('utf8');
            response.on('data', function (data) {
                if (callback !== null) callback(null, data);
            });
        } else if (response.statusCode >= 300 && response.statusCode < 400) {
            // Redirect
            response.setEncoding('utf8');
            response.on('data', function (data) {
                // Handle redirect
                var href = extractHref(data);
                if (href != "") {
                    console.log("Redirecting to: " + href);
                    return doHttpGet(href, callback, username, password, challenge);
                }
            })
        } else {
            // Unknown error
            if (callback !== null)
                callback(new Error(response.statusText), response);
            else
                console.log("Unknown error: " + response.statusCode);
        }
    };
    if (options.protocol == "https")
        https.get(options, onResponse);
    else
        http.get(options, onResponse);
}

function getAuthenticateHdr(response) {
    var challenge = response.headers['www-authenticate'];
    if (challenge == null) challenge = response.headers['WWW-Authenticate'];
    //console.log("Challenge is: " + challenge);
    return challenge;
}

function getHttpRequest(url, route, challenge, username, password) {
    console.log("getHttpRequest: " + url);

    authHdr = buildAuthResponse(challenge, route, username, password);
    var req = new XMLHttpRequest();
    req.open('GET', url, true);

    if (authHdr.length) {
        //console.log("Setting Authorization: " + authHdr);
        req.setRequestHeader("Authorization", authHdr);
    }
    return req;
}

function makeHttpCallInternal(url, callback, username, password, challenge, numRetries) {
    var maxRetries = 1;
    var xhr = getHttpRequest(url, getRoute(url), challenge, username, password);
    var processResults = function (e) {
        if (xhr.readyState != 4) return null;
        if (xhr.status == 401) {
            if (challenge === null || numRetries < maxRetries) {
                // This is the first failure, retry with proper header
                challenge = xhr.getResponseHeader('WWW-Authenticate');
                if (challenge === null) challenge = xhr.getResponseHeader('www-authenticate');
                if (url.indexOf("_method=put") > 0 || url.indexOf("_method=execute") > 0) {
                    // PUT requests end up redirecting (status 303) which we don't receive.
                    // On iOS, the authentication header gets lost so we end up here with a 401
                    // error and reexecute the PUT which is the wrong behavior.
                    // Strip down the request and retry.
                    url = url.split("?")[0];
                }
                return makeHttpCallInternal(url, callback, username, password, challenge, numRetries + 1);
            } else {
                console.log("We have repeated failures to authenticate. Please check your credentials.");
                if (callback !== null) callback(new Error(JSON.stringify(e)), xhr);
            }
        } else if (xhr.status == 200) {
            if (callback !== null) callback(null, xhr.responseText);
        } else if (xhr.status >= 300 && xhr.status < 400) {
            // Redirect
            var href = extractHref(xhr.responseText);
            if (href != "") {
                console.log("Redirecting to: " + href);
                return makeHttpCallInternal(href, callback, username, password, challenge);
            }
        } else {
            // Unknown error
            if (callback !== null) callback(new Error(e), xhr);
            else console.log("There was an error: " + JSON.stringify(xhr));
        }
    };
    xhr.onreadystatechange = processResults;
    xhr.send();
}

function extractHref(htmlStr) {
    var pattern = "<a href=";
    var delim = "'";
    var start = htmlStr.indexOf(pattern + delim);
    if (start < 0) {
        delim = '"';
        start = htmlStr.indexOf(pattern + delim);
    }
    if (start < 0) return "";
    start += pattern.length + 1;
    var end = htmlStr.indexOf(delim, start);
    return htmlStr.substr(start, end - start);
}

function getRoute(uri) {
    components = url.parse(uri);
    return components['pathname'];
}

var md5 = require('crypto-js/md5');

function unquotes(val) {
    return val.replace(/^\"+|\"+$/gm, '');
}

function pad(num, size) {
    var s = num + "";
    while (s.length < size) s = "0" + s;
    return s;
}

function genNonce(len) {
    var text = "";
    var possible = "ABCDEF0123456789";
    for (var i = 0; i < len; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

var nc = 1;

function buildAuthResponse(challenge, uri, username, password) {
    if (challenge === null || challenge === undefined) return authHdr;
    var pos = challenge.indexOf(" ");
    var tokens = {cnonce: genNonce(16)};
    var pairs = challenge.substr(pos).trim().split(',');
    tokens.nc = pad(nc++, 8);

    for (var token in pairs) {
        //console.log(pairs[token].trim());
        var pair = pairs[token].trim().split('=');
        tokens[pair[0]] = pair[1];
    }

    var HA1 = md5(username + ":" + unquotes(tokens.realm) + ":" + password);
    var HA2 = md5("GET:" + uri);
    var response = md5(HA1 + ':' +
        unquotes(tokens.nonce) + ':' +
        tokens.nc + ':' +
        tokens.cnonce + ':' +
        unquotes(tokens.qop) + ':' +
        HA2);
    return buildAuthResponseHeader(username, uri, tokens, response);
}

function buildAuthResponseHeader(username, uri, tokens, response) {
    var header = "Digest " +
        'username="' + username + '"' +
        ', realm=' + tokens.realm +
        ', nonce=' + tokens.nonce +
        ', uri="' + uri + '"' +
        ', algorithm=' + tokens.algorithm +
        ', opaque="' + tokens.opaque + '"' +
        ', response="' + response + '"' +
        ', qop=' + unquotes(tokens.qop) +
        ', nc=' + tokens.nc +
        ', cnonce="' + tokens.cnonce + '"';
    return header;
}

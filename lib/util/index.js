/*jshint sub:true*/

/*
 * nodeSide Utilities object, which contains many useful but unrelated tools.
 */
var util = {};

util.cookieTracker = require('./cookie');

/*
 * Convert "/xxx/", "xxx", "xxx/" form url string to "/xxx" form(leading with slash, but has no ending slash)
 */
util.slash_url = function (url) {
    if (url.length > 0 && url[0] !== '/') {
        url = '/' + url;
    }
    return url[url.length - 1] === '/' ? url.slice(0, url.length - 1) : url;
};

/*
 * Used in nodejs requestListener, relay client-side http request to target site and get response, action like a "reverse-proxy".
 * options:
 *   {
 *      "allowcors":    true/false 
 *                      Allow cross domain ajax request. 
 *                      Default to true.
 *      "target":       string 
 *                      Target proxy site url(may contain some prefix), as base url of all relaying request.
 *                      No default, must specify a value.
 *      "urlcut":       string 
 *                      when set, cut this url fragment from all the incoming request url, and use the result
 *                      url to request target site.
 *                      Default to "".
 *      "cookiepath":   string
 *                      re-write the root of cookie path from target site. 
 *                      Set to a object will deny cookie in outgoing response and save cookies in this object with util.cookieTracker. 
 *                      Set to empty string when you want leave origin cookie path untouched.
 *                      Default to "".
 *      "extra-headers-in": {headername: headvalue}
 *                      extra headers set to relaying request, besides the origin header from incoming request.
 *                      Default to {}
 *      "rewrite-headers-in": {headername: headvalue}
 *                      rewrite headers appear in the incoming request.
 *                      Default to {}
 *      "extra-headers-out": {headername: headvalue}
 *                      extra headers set to outgoing response, besides the origin header from target site response.
 *                      Default to []
 *      "rewrite-headers-out": {headername: headvalue}
 *                      rewrite headers appear in the target response.
 *                      Default to {} 
 *   }
 */
util.relay = function (req, res, options) {
    var default_options = {
            "allowcors": true,
            "target": null,
            "urlcut": "",
            "cookiepath": "",
            "extra-headers-in": {},
            "rewrite-headers-in": {},
            "extra-headers-out": {},
            "rewrite-headers-out": {}
        },
        http = require('http'),
        url_util = require('url'),
        k = null,
        uct = null,
        COOKIE_TRACKER_KEY = 'cookie_tracker',
        url, proxy_request, in_headers, out_headers;
    
    options = options || {};
    for (k in options) {
        if (options.hasOwnProperty(k)) {
            default_options[k] = options[k];
        }
    }
    
    if (default_options.target.length === 0) {
        res.writeHead(500);
        res.end();
        console.error("Empty target in util.relay!\n");
        return console.trace();
    }
    
    url = req.url.indexOf(default_options.urlcut) === -1 ? req.url : req.url.slice(default_options.urlcut.length); 
    url = default_options.target + url;
    url = url_util.parse(url);
    in_headers = req.headers;
    for (k in default_options["extra-headers-in"]) {
        if (default_options["extra-headers-in"].hasOwnProperty(k)) {
            in_headers[k] = default_options["extra-headers-in"][k];
        }
    }
    for (k in default_options["rewrite-headers-in"]) {
        if (default_options["rewrite-headers-in"].hasOwnProperty(k) && in_headers.hasOwnProperty(k)) {
            in_headers[k] = default_options["rewrite-headers-in"][k];
        }
    }
    in_headers.host = url.hostname;
    
    if (typeof default_options.cookiepath === 'object') {
        default_options.cookiepath[COOKIE_TRACKER_KEY] = default_options.cookiepath[COOKIE_TRACKER_KEY] || {};
        uct = util.cookieTracker(default_options.cookiepath[COOKIE_TRACKER_KEY]);
        in_headers.cookie = uct.toHeader(url.path);
    }
    
    proxy_request = http.request({
        hostname: url.hostname,
        port: url.port,
        method: req.method,
        path: url.path,
        headers: in_headers
    });
    proxy_request.on('response', function (proxy_response) {
        var k = null;
        proxy_response.on('readable', function() {
            res.write(proxy_response.read(), 'binary');
        });
        proxy_response.on('end', function() {
            res.end();
        });
        out_headers = proxy_response.headers;
        for (k in default_options["extra-headers-out"]) {
            if (default_options["extra-headers-out"].hasOwnProperty(k)) {
                out_headers[k] = default_options["extra-headers-out"][k];
            }
        }
        for (k in default_options["rewrite-headers-out"]) {
            if (default_options["rewrite-headers-out"].hasOwnProperty(k) && out_headers.hasOwnProperty(k)) {
                out_headers[k] = default_options["rewrite-headers-out"][k];
            }
        }
        if (default_options.allowcors) {
            out_headers['Access-Control-Allow-Credentials'] = 'true';
            out_headers['Access-Control-Allow-Headers'] = req.headers['Access-Control-Request-Headers'] || 'origin, content-type';
            out_headers['Access-Control-Allow-Origin'] = req.headers['origin'] || '*';
            out_headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS';
            out_headers['Access-Control-Max-Age'] = '3628800';
        }
        if (uct) {
            uct.fromResHeader(proxy_response, url.path);
            default_options.cookiepath[COOKIE_TRACKER_KEY] = uct.data;
            delete out_headers['set-cookie'];
        } else {
            if (default_options.cookiepath.length > 0) {
                out_headers['set-cookie'] = util.cookieTracker.pathPrefix(default_options.cookiepath, url.path, out_headers['set-cookie']);
            }
        }
        res.writeHead(proxy_response.statusCode, out_headers);
    });
    req.on('readable', function() {
        var data = req.read();
        if (data !== null) {
            proxy_request.write(data, 'binary');
        }
    });
    req.on('end', function() {
        proxy_request.end();
    });
};

module.exports = util;
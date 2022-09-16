# MpRdev &middot; [![npm](https://img.shields.io/npm/v/mprdev.svg?style=flat-square)](https://www.npmjs.com/package/mprdev) [![github-actions](https://img.shields.io/github/workflow/status/wechatjs/mprdev/Build.svg?style=flat-square)](https://github.com/wechatjs/mprdev/actions/workflows/build.yml)

**English | [简体中文](./README_CN.md)**

A Web Remote Debug Toolkit.

## Getting Started

Toolkit has two parts which are an SDK and a DevTools service. Firstly, deploy the DevTools service:

```bash
$ npx mprdev -h 0.0.0.0 -p 8090
# terminal will output a log as "DevTools: http://0.0.0.0:8090/remote_dev" which is the DevTools service backend entry
# asume that the WAN IP of the server is 123.123.123.123, then the DevTools service is served at 123.123.123.123:8090
```

After deployment, in order to debug remotely, your web pages have to import SDK and connect to the DevTools service.

We highly recommend you to import the SDK from CDN at the very beginning of your web pages, which ensures the SDK logging all information of the pages. And the SDK will mount at global like `window.RemoteDevSdk` by default to export all APIs. After importing the SDK, if the DevTools service is deployed to 123.123.123.123:8090, the SDK is required to connect by passing the service info to a `init` method:

```html
<script src="https://unpkg.com/mprdev"></script>
<script>RemoteSdkDev.init({ host: '123.123.123.123', port: 8090 })</script>
```

Finally, open your web pages and the DevTools serve to enjoy your debugging journey.

Besides, if your web pages can't directly connect to the DevTools service, for example, the server is located at LAN, you need to proxy a WebSocket whose path is "/target" to ensure the SDK connecting to the DevTools service.

## Breakpoint

Currently, we implement a breakpoint feature based on [`vDebugger`](https://github.com/wechatjs/vdebugger). So, besides the steps of "Getting Started" above, you have to doing more for breakpoint debug. The SDK has to take over the execution of JavaScript, so two APIs are offered for inputing the JavaScript source code of your web pages:

```ts
function debug(script: string, url: string): void // input source code for remote breakpoint debug
function debugSrc(scriptSrc: string): void // input source url for remote breakpoint debug
```

1. The `debug` method accepts two arguments, which are the source code `script` and the corresponding `url`. The `url` argument is used to identify the `script`, in order to match the breakpoint mapping in the DevTools service.

2. The `debugSrc` method accepts only one argument, which is the source url `scriptSrc`. It has the same meaning of the `url` of the `debug` method, but this method will use it to request the source code for breakpoing debug.

For example, asume that a web page request the link below to import a script normally:

```html
<script src="/test.js"></script>
```

In order to take over execution of the script by the SDK, you can modify the page HTML and replace the `<script>` by the `debugSrc` method:

```html
<script>RemoteDevSdk.debugSrc('/test.js')</script>
```

Beware that, after taking over by the `debugSrc` method, loading scripts won't block the page render, which means adding defer to the original `<script>` like:

```html
<script defer src="/test.js"></script>
```

If script defer can't be accepted, or modifing the page HTML isn't allowed, you can use the `debug` method to wrap source codes before server responses. However, keep in mind to escape codes to ensure the codes are valid JavaScript string. Take [Express](https://expressjs.com/) as an example:

```js
app.use('/test.js', (req, res) => {
  res.send(`RemoteDevSdk.debug(\`${script.replace(/(`|\$|\\)/g, '\\$1')}\`, '${req.url}');`);
});
```

Be attention to keep the format as below when wrapping codes by the `debug` method, because the DevTools service will match and filter the wrapper strictly to make sure the source codes can be highlighted as expected:

```js
// keep the wrapper format strictly as below ("%code%" is script string and "%url%" is script url)
RemoteDevSdk.debug(`%code%`, '%url%');

// DevTools service will replace the wrapper as below to ensure scripts can be highlighted
script.replace(/RemoteDevSdk\.debug\(`([\s\S]+)`,?.*\);?/, (_, code) => code.replace(/\\`/g, '`').replace(/\\\$/g, '$'));
```

## SDK API Types

```ts
declare interface InitOptions {
  host?: string // DevTools service deploy Host/IP
  port?: number // DevTools service deploy port
  uin?: number // user id for display and search in Devtools service
  title?: string // page title for display and search in Devtools service
}

export declare const version: string
export declare function init(opts: InitOptions): void
export function debug(script: string, url: string): void // input source code for remote breakpoint debug
export function debugSrc(scriptSrc: string): void // input source url for remote breakpoint debug
export declare function debugCache(check: boolean | ((url: string) => boolean)): void // control whether cache debug codes by url, which can reduce loading time 
export declare function getId(): string // get device id

declare const RemoteDevSdk: {
  version: typeof version
  init: typeof init
  debug: typeof debug
  debugSrc: typeof debugSrc
  debugCache: typeof debugCache
  getId: typeof getId
}

export default RemoteDevSdk

declare global {
  interface Window {
    RemoteDevSdk: typeof RemoteDevSdk
  }
}
```

## Development

```bash
git clone https://github.com/wechatjs/mprdev
cd mprdev

npm install
npm run dev & npm start

# Test Page：http://localhost:8090/remote_dev/test
# DevTools Entry：http://localhost:8090/remote_dev
```

## References

- [Chrome Devtools Protocol](https://chromedevtools.github.io/devtools-protocol)

## License

[MIT](./LICENSE)

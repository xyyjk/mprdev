# MpRdev &middot; [![npm](https://img.shields.io/npm/v/mprdev.svg?style=flat-square)](https://www.npmjs.com/package/mprdev) [![github-actions](https://img.shields.io/github/workflow/status/wechatjs/mprdev/Build.svg?style=flat-square)](https://github.com/wechatjs/mprdev/actions/workflows/build.yml)

**English | [简体中文](./README_CN.md)**

A Web Remote Debug Toolkit.

## Getting Started

Toolkit has two parts which are an SDK and a DevTools service. Firstly, deploy the DevTools service:

```bash
$ npx mprdev -h 0.0.0.0 -p 8090
# terminal will output a log as "DevTools: http://0.0.0.0:8090/remote_dev" which is the DevTools service backend entry.
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
function debug(script: string, url?: string): void // input source code for remote breakpoint debug
function debugSrc(scriptSrc: string): void // input source url for remote breakpoint debug
```

其中：

1. `debug`接口接受两个参数，分别是断点调试的源码`script`和源码对应的链接`url`，源码对应的链接`url`参数用于唯一标识脚本以匹配DevTools服务中源码显示和断点映射。若缺失，将会作为临时脚本分配临时标识，比如`VM18248`。为了使得DevTools服务正常显示源码以及断点，强烈建议传入；
2. `debugSrc`接口仅接受一个参数，源码对应的链接`scriptSrc`，含义和`debug`的`url`相同。不同的地方在于，但该接口会实际通过该链接请求脚本源码来进行断点调试。

举个例子，通常情况下，假设页面HTML中会请求以下链接获取一段JS脚本：

```html
<script src="/test.js"></script>
```

为了能让远程调试SDK接管脚本执行并进行断点，可以改写页面HTML，通过使用`debugSrc`接口进行接管即可：

```html
<!-- RemoteDevSdk为上述通过CDN引入后挂载的全局变量 -->
<script>RemoteDevSdk.debugSrc('/test.js')</script>
```

特别注意，使用`debugSrc`接管后，脚本加载将不会阻塞页面渲染，相当于给原来的\<script\>标签加上了defer属性，行为等同于：

```html
<script defer src="/test.js"></script>
```

如果无法接受\<script\>以defer的行为加载，或者无法通过上述改动页面HTML的方式让远程调试SDK接管脚本执行并进行断点，则可以在服务端返回JS脚本时，通过使用`debug`接口进行包裹（记得进行相应转义保证返回合法的JS脚本），以Express为例：

```js
// RemoteDevSdk为上述通过CDN引入后挂载的全局变量
app.use('/test.js', (req, res) => {
  res.send(`RemoteDevSdk.debug(\`${script.replace(/(`|\$|\\)/g, '\\$1')}\`, '${req.url}');`);
});
```

注意，使用`debug`接口包裹源码的时候，务必保证是如下格式，因为DevTools服务会进行严格匹配和过滤，保证调试面板上能对源码进行高亮显示：

```js
// RemoteDevSdk为上述通过CDN引入后挂载的全局变量，严格保证包裹的格式如下：
RemoteDevSdk.debug(`%code%`, '%url%');
// 其中%code%为源码脚本内容，%url%为脚本对应链接，DevTools服务会对包裹后的脚本进行如下替换，保证调试面板能正常高亮显示源码
// script.replace(/RemoteDevSdk\.debug\(`([\s\S]+)`,?.*\);?/, (_, code) => code.replace(/\\`/g, '`').replace(/\\\$/g, '$'));
```

## SDK API Types

```ts
declare interface InitOptions {
  host?: string // DevTools服务部署的Host/IP
  port?: number // DevTools服务部署的端口
  uin?: number // 用户ID，用于DevTools服务显示和搜索入口
  title?: string // 页面标题，用于DevTools服务显示搜索入口
}

export declare const version: string // 远程调试SDK版本
export declare function init(opts: InitOptions): void // 远程调试初始化
export declare function debug(script: string, url?: string): void // 远程调试断点源码传入
export declare function debugSrc(scriptSrc: string): void // 远程调试断点源码链接传入
export declare function debugCache(check: boolean | ((url: string) => boolean)): void // 控制是否强缓存远程调试断点源码，可减少页面加载耗时
export declare function getId(): string // 获取远程调试设备ID

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

# 调试页面：http://localhost:8090/remote_dev/test
# DevTools：http://localhost:8090/remote_dev
```

## References

- [Chrome Devtools Protocol](https://chromedevtools.github.io/devtools-protocol)

## License

[MIT](./LICENSE)

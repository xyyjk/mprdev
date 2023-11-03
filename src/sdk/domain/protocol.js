// 已实现的协议
export default {
  CSS: [
    'addRule',
    'createStyleSheet',
    'enable',
    'getStyleSheetText',
    'getInlineStylesForNode',
    'getMatchedStylesForNode',
    'getComputedStyleForNode',
    'setStyleTexts',
  ],
  Debugger: [
    'enable',
    'disable',
    'getScriptSource',
    'evaluateOnCallFrame',
    'setPauseOnExceptions',
    'getPossibleBreakpoints',
    'setBreakpointsActive',
    'setBreakpointByUrl',
    'removeBreakpoint',
    'pause',
    'resume',
    'stepOver',
    'stepInto',
    'stepOut',
  ],
  DOMStorage: [
    'getDOMStorageItems',
    'removeDOMStorageItem',
    'setDOMStorageItem',
    'clear',
  ],
  DOM: [
    'enable',
    'copyTo',
    'moveTo',
    'getNodeId',
    'getDocument',
    'getNodeForLocation',
    'removeNode',
    'requestChildNodes',
    'requestNode',
    'setNodeValue',
    'getOuterHTML',
    'setOuterHTML',
    'setAttributeValue',
    'setAttributesAsText',
    'setInspectedNode',
    'pushNodesByBackendIdsToFrontend',
    'performSearch',
    'getSearchResults',
    'discardSearchResults',
  ],
  Network: [
    'enable',
    'getCookies',
    'setCookie',
    'deleteCookies',
    'getResponseBody',
    'setCacheDisabled',
    'setUserAgentOverride',
  ],
  Overlay: [
    'enable',
    'highlightNode',
    'hideHighlight',
    'setInspectMode',
    'setPausedInDebuggerMessage',
  ],
  Page: [
    'enable',
    'reload',
    'navigate',
    'startScreencast',
    'stopScreencast',
    'getResourceTree',
    'getResourceContent',
    'getNavigationHistory',
  ],
  Runtime: [
    'enable',
    'evaluate',
    'callFunctionOn',
    'getProperties',
    'releaseObject',
    'releaseObjectGroup',
    'globalLexicalScopeNames',
  ],
  Emulation: [
    'setTouchEmulationEnabled',
  ],
  Input: [
    'emulateTouchFromMouseEvent',
  ],
};

export const Event = {
  styleSheetAdded: 'CSS.styleSheetAdded',
  styleSheetChanged: 'CSS.styleSheetChanged',

  breakpointResolved: 'Debugger.breakpointResolved',
  scriptParsed: 'Debugger.scriptParsed',
  resumed: 'Debugger.resumed',
  paused: 'Debugger.paused',

  domStorageItemRemoved: 'DOMStorage.domStorageItemRemoved',
  domStorageItemsCleared: 'DOMStorage.domStorageItemsCleared',

  setChildNodes: 'DOM.setChildNodes',
  documentUpdated: 'DOM.documentUpdated',
  childNodeCountUpdated: 'DOM.childNodeCountUpdated',
  childNodeInserted: 'DOM.childNodeInserted',
  childNodeRemoved: 'DOM.childNodeRemoved',
  attributeModified: 'DOM.attributeModified',
  attributeRemoved: 'DOM.attributeRemoved',
  characterDataModified: 'DOM.characterDataModified',
  shadowRootPushed: 'DOM.shadowRootPushed',

  requestWillBeSent: 'Network.requestWillBeSent',
  responseReceivedExtraInfo: 'Network.responseReceivedExtraInfo',
  responseReceived: 'Network.responseReceived',
  loadingFinished: 'Network.loadingFinished',
  loadingFailed: 'Network.loadingFailed',

  screencastFrame: 'Page.screencastFrame',
  screencastVisibilityChanged: 'Page.screencastVisibilityChanged',

  executionContextCreated: 'Runtime.executionContextCreated',
  consoleAPICalled: 'Runtime.consoleAPICalled',
  exceptionThrown: 'Runtime.exceptionThrown',

  nodeHighlightRequested: 'Overlay.nodeHighlightRequested',
  inspectNodeRequested: 'Overlay.inspectNodeRequested',
};

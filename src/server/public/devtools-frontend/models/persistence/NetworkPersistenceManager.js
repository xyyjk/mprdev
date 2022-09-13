// Copyright (c) 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
import * as Common from '../../core/common/common.js';
import * as Platform from '../../core/platform/platform.js';
import * as Root from '../../core/root/root.js';
import * as SDK from '../../core/sdk/sdk.js';
import * as Workspace from '../workspace/workspace.js';
import { FileSystemWorkspaceBinding } from './FileSystemWorkspaceBinding.js';
import { PersistenceBinding, PersistenceImpl } from './PersistenceImpl.js';
let networkPersistenceManagerInstance;
export class NetworkPersistenceManager extends Common.ObjectWrapper.ObjectWrapper {
    bindings;
    originalResponseContentPromises;
    savingForOverrides;
    savingSymbol;
    enabledSetting;
    workspace;
    networkUISourceCodeForEncodedPath;
    interceptionHandlerBound;
    updateInterceptionThrottler;
    projectInternal;
    activeProject;
    activeInternal;
    enabled;
    eventDescriptors;
    #headerOverridesMap = new Map();
    constructor(workspace) {
        super();
        this.bindings = new WeakMap();
        this.originalResponseContentPromises = new WeakMap();
        this.savingForOverrides = new WeakSet();
        this.savingSymbol = Symbol('SavingForOverrides');
        this.enabledSetting = Common.Settings.Settings.instance().moduleSetting('persistenceNetworkOverridesEnabled');
        this.enabledSetting.addChangeListener(this.enabledChanged, this);
        this.workspace = workspace;
        this.networkUISourceCodeForEncodedPath = new Map();
        this.interceptionHandlerBound = this.interceptionHandler.bind(this);
        this.updateInterceptionThrottler = new Common.Throttler.Throttler(50);
        this.projectInternal = null;
        this.activeProject = null;
        this.activeInternal = false;
        this.enabled = false;
        this.workspace.addEventListener(Workspace.Workspace.Events.ProjectAdded, event => {
            void this.onProjectAdded(event.data);
        });
        this.workspace.addEventListener(Workspace.Workspace.Events.ProjectRemoved, event => {
            void this.onProjectRemoved(event.data);
        });
        PersistenceImpl.instance().addNetworkInterceptor(this.canHandleNetworkUISourceCode.bind(this));
        this.eventDescriptors = [];
        void this.enabledChanged();
        SDK.TargetManager.TargetManager.instance().observeTargets(this);
    }
    targetAdded() {
        void this.updateActiveProject();
    }
    targetRemoved() {
        void this.updateActiveProject();
    }
    static instance(opts = { forceNew: null, workspace: null }) {
        const { forceNew, workspace } = opts;
        if (!networkPersistenceManagerInstance || forceNew) {
            if (!workspace) {
                throw new Error('Missing workspace for NetworkPersistenceManager');
            }
            networkPersistenceManagerInstance = new NetworkPersistenceManager(workspace);
        }
        return networkPersistenceManagerInstance;
    }
    active() {
        return this.activeInternal;
    }
    project() {
        return this.projectInternal;
    }
    originalContentForUISourceCode(uiSourceCode) {
        const binding = this.bindings.get(uiSourceCode);
        if (!binding) {
            return null;
        }
        const fileSystemUISourceCode = binding.fileSystem;
        return this.originalResponseContentPromises.get(fileSystemUISourceCode) || null;
    }
    async enabledChanged() {
        if (this.enabled === this.enabledSetting.get()) {
            return;
        }
        this.enabled = this.enabledSetting.get();
        if (this.enabled) {
            this.eventDescriptors = [
                Workspace.Workspace.WorkspaceImpl.instance().addEventListener(Workspace.Workspace.Events.UISourceCodeRenamed, event => {
                    void this.uiSourceCodeRenamedListener(event);
                }),
                Workspace.Workspace.WorkspaceImpl.instance().addEventListener(Workspace.Workspace.Events.UISourceCodeAdded, event => {
                    void this.uiSourceCodeAdded(event);
                }),
                Workspace.Workspace.WorkspaceImpl.instance().addEventListener(Workspace.Workspace.Events.UISourceCodeRemoved, event => {
                    void this.uiSourceCodeRemovedListener(event);
                }),
                Workspace.Workspace.WorkspaceImpl.instance().addEventListener(Workspace.Workspace.Events.WorkingCopyCommitted, event => this.onUISourceCodeWorkingCopyCommitted(event.data.uiSourceCode)),
            ];
            await this.updateActiveProject();
        }
        else {
            Common.EventTarget.removeEventListeners(this.eventDescriptors);
            await this.updateActiveProject();
        }
    }
    async uiSourceCodeRenamedListener(event) {
        const uiSourceCode = event.data.uiSourceCode;
        await this.onUISourceCodeRemoved(uiSourceCode);
        await this.onUISourceCodeAdded(uiSourceCode);
    }
    async uiSourceCodeRemovedListener(event) {
        await this.onUISourceCodeRemoved(event.data);
    }
    async uiSourceCodeAdded(event) {
        await this.onUISourceCodeAdded(event.data);
    }
    async updateActiveProject() {
        const wasActive = this.activeInternal;
        this.activeInternal = Boolean(this.enabledSetting.get() && SDK.TargetManager.TargetManager.instance().mainTarget() && this.projectInternal);
        if (this.activeInternal === wasActive) {
            return;
        }
        if (this.activeInternal && this.projectInternal) {
            await Promise.all(this.projectInternal.uiSourceCodes().map(uiSourceCode => this.filesystemUISourceCodeAdded(uiSourceCode)));
            const networkProjects = this.workspace.projectsForType(Workspace.Workspace.projectTypes.Network);
            for (const networkProject of networkProjects) {
                await Promise.all(networkProject.uiSourceCodes().map(uiSourceCode => this.networkUISourceCodeAdded(uiSourceCode)));
            }
        }
        else if (this.projectInternal) {
            await Promise.all(this.projectInternal.uiSourceCodes().map(uiSourceCode => this.filesystemUISourceCodeRemoved(uiSourceCode)));
            this.networkUISourceCodeForEncodedPath.clear();
        }
        PersistenceImpl.instance().refreshAutomapping();
    }
    encodedPathFromUrl(url) {
        if (!this.activeInternal || !this.projectInternal) {
            return '';
        }
        let urlPath = Common.ParsedURL.ParsedURL.urlWithoutHash(url.replace(/^https?:\/\//, ''));
        if (urlPath.endsWith('/') && urlPath.indexOf('?') === -1) {
            urlPath = urlPath + 'index.html';
        }
        let encodedPathParts = encodeUrlPathToLocalPathParts(urlPath);
        const projectPath = FileSystemWorkspaceBinding.fileSystemPath(this.projectInternal.id());
        const encodedPath = encodedPathParts.join('/');
        if (projectPath.length + encodedPath.length > 200) {
            const domain = encodedPathParts[0];
            const encodedFileName = encodedPathParts[encodedPathParts.length - 1];
            const shortFileName = encodedFileName ? encodedFileName.substr(0, 10) + '-' : '';
            const extension = Common.ParsedURL.ParsedURL.extractExtension(urlPath);
            const extensionPart = extension ? '.' + extension.substr(0, 10) : '';
            encodedPathParts = [
                domain,
                'longurls',
                shortFileName + Platform.StringUtilities.hashCode(encodedPath).toString(16) + extensionPart,
            ];
        }
        return encodedPathParts.join('/');
        function encodeUrlPathToLocalPathParts(urlPath) {
            const encodedParts = [];
            for (const pathPart of fileNamePartsFromUrlPath(urlPath)) {
                if (!pathPart) {
                    continue;
                }
                // encodeURI() escapes all the unsafe filename characters except /:?*
                let encodedName = encodeURI(pathPart).replace(/[\/:\?\*]/g, match => '%' + match[0].charCodeAt(0).toString(16));
                // Windows does not allow a small set of filenames.
                if (RESERVED_FILENAMES.has(encodedName.toLowerCase())) {
                    encodedName = encodedName.split('').map(char => '%' + char.charCodeAt(0).toString(16)).join('');
                }
                // Windows does not allow the file to end in a space or dot (space should already be encoded).
                const lastChar = encodedName.charAt(encodedName.length - 1);
                if (lastChar === '.') {
                    encodedName = encodedName.substr(0, encodedName.length - 1) + '%2e';
                }
                encodedParts.push(encodedName);
            }
            return encodedParts;
        }
        function fileNamePartsFromUrlPath(urlPath) {
            urlPath = Common.ParsedURL.ParsedURL.urlWithoutHash(urlPath);
            const queryIndex = urlPath.indexOf('?');
            if (queryIndex === -1) {
                return urlPath.split('/');
            }
            if (queryIndex === 0) {
                return [urlPath];
            }
            const endSection = urlPath.substr(queryIndex);
            const parts = urlPath.substr(0, urlPath.length - endSection.length).split('/');
            parts[parts.length - 1] += endSection;
            return parts;
        }
    }
    fileUrlFromNetworkUrl(url) {
        return this.projectInternal.fileSystemPath() + '/' + this.encodedPathFromUrl(url);
    }
    decodeLocalPathToUrlPath(path) {
        try {
            return unescape(path);
        }
        catch (e) {
            console.error(e);
        }
        return path;
    }
    async unbind(uiSourceCode) {
        const binding = this.bindings.get(uiSourceCode);
        if (binding) {
            this.bindings.delete(binding.network);
            this.bindings.delete(binding.fileSystem);
            await PersistenceImpl.instance().removeBinding(binding);
        }
    }
    async bind(networkUISourceCode, fileSystemUISourceCode) {
        if (this.bindings.has(networkUISourceCode)) {
            await this.unbind(networkUISourceCode);
        }
        if (this.bindings.has(fileSystemUISourceCode)) {
            await this.unbind(fileSystemUISourceCode);
        }
        const binding = new PersistenceBinding(networkUISourceCode, fileSystemUISourceCode);
        this.bindings.set(networkUISourceCode, binding);
        this.bindings.set(fileSystemUISourceCode, binding);
        await PersistenceImpl.instance().addBinding(binding);
        const uiSourceCodeOfTruth = this.savingForOverrides.has(networkUISourceCode) ? networkUISourceCode : fileSystemUISourceCode;
        const [{ content }, encoded] = await Promise.all([uiSourceCodeOfTruth.requestContent(), uiSourceCodeOfTruth.contentEncoded()]);
        PersistenceImpl.instance().syncContent(uiSourceCodeOfTruth, content || '', encoded);
    }
    onUISourceCodeWorkingCopyCommitted(uiSourceCode) {
        void this.saveUISourceCodeForOverrides(uiSourceCode);
    }
    canSaveUISourceCodeForOverrides(uiSourceCode) {
        return this.activeInternal && uiSourceCode.project().type() === Workspace.Workspace.projectTypes.Network &&
            !this.bindings.has(uiSourceCode) && !this.savingForOverrides.has(uiSourceCode);
    }
    async saveUISourceCodeForOverrides(uiSourceCode) {
        if (!this.canSaveUISourceCodeForOverrides(uiSourceCode)) {
            return;
        }
        this.savingForOverrides.add(uiSourceCode);
        let encodedPath = this.encodedPathFromUrl(uiSourceCode.url());
        const content = (await uiSourceCode.requestContent()).content || '';
        const encoded = await uiSourceCode.contentEncoded();
        const lastIndexOfSlash = encodedPath.lastIndexOf('/');
        const encodedFileName = encodedPath.substr(lastIndexOfSlash + 1);
        encodedPath = encodedPath.substr(0, lastIndexOfSlash);
        if (this.projectInternal) {
            await this.projectInternal.createFile(encodedPath, encodedFileName, content, encoded);
        }
        this.fileCreatedForTest(encodedPath, encodedFileName);
        this.savingForOverrides.delete(uiSourceCode);
    }
    fileCreatedForTest(_path, _fileName) {
    }
    patternForFileSystemUISourceCode(uiSourceCode) {
        const relativePathParts = FileSystemWorkspaceBinding.relativePath(uiSourceCode);
        if (relativePathParts.length < 2) {
            return '';
        }
        if (relativePathParts[1] === 'longurls' && relativePathParts.length !== 2) {
            return 'http?://' + relativePathParts[0] + '/*';
        }
        return 'http?://' + this.decodeLocalPathToUrlPath(relativePathParts.join('/'));
    }
    async onUISourceCodeAdded(uiSourceCode) {
        await this.networkUISourceCodeAdded(uiSourceCode);
        await this.filesystemUISourceCodeAdded(uiSourceCode);
    }
    canHandleNetworkUISourceCode(uiSourceCode) {
        return this.activeInternal && !uiSourceCode.url().startsWith('snippet://');
    }
    async networkUISourceCodeAdded(uiSourceCode) {
        if (uiSourceCode.project().type() !== Workspace.Workspace.projectTypes.Network ||
            !this.canHandleNetworkUISourceCode(uiSourceCode)) {
            return;
        }
        const url = Common.ParsedURL.ParsedURL.urlWithoutHash(uiSourceCode.url());
        this.networkUISourceCodeForEncodedPath.set(this.encodedPathFromUrl(url), uiSourceCode);
        const project = this.projectInternal;
        const fileSystemUISourceCode = project.uiSourceCodeForURL(this.fileUrlFromNetworkUrl(url));
        if (fileSystemUISourceCode) {
            await this.bind(uiSourceCode, fileSystemUISourceCode);
        }
    }
    async filesystemUISourceCodeAdded(uiSourceCode) {
        if (!this.activeInternal || uiSourceCode.project() !== this.projectInternal) {
            return;
        }
        this.updateInterceptionPatterns();
        const relativePath = FileSystemWorkspaceBinding.relativePath(uiSourceCode);
        const networkUISourceCode = this.networkUISourceCodeForEncodedPath.get(relativePath.join('/'));
        if (networkUISourceCode) {
            await this.bind(networkUISourceCode, uiSourceCode);
        }
    }
    async generateHeaderPatterns(uiSourceCode) {
        const headerPatterns = new Set();
        const content = (await uiSourceCode.requestContent()).content || '';
        let headerOverrides = [];
        try {
            headerOverrides = JSON.parse(content);
            if (!headerOverrides.every(isHeaderOverride)) {
                throw 'Type mismatch after parsing';
            }
        }
        catch (e) {
            console.error('Failed to parse', uiSourceCode.url(), 'for locally overriding headers.');
            return { headerPatterns, path: '', overridesWithRegex: [] };
        }
        const relativePath = FileSystemWorkspaceBinding.relativePath(uiSourceCode).join('/');
        const decodedPath = this.decodeLocalPathToUrlPath(relativePath).slice(0, -HEADERS_FILENAME.length);
        const overridesWithRegex = [];
        for (const headerOverride of headerOverrides) {
            headerPatterns.add('http?://' + decodedPath + headerOverride.applyTo);
            // Most servers have the concept of a "directory index", which is a
            // default resource name for a request targeting a "directory", e. g.
            // requesting "example.com/path/" would result in the same response as
            // requesting "example.com/path/index.html". To match this behavior we
            // generate an additional pattern without "index.html" as the longer
            // pattern would not match against a shorter request.
            const { head, tail } = extractDirectoryIndex(headerOverride.applyTo);
            if (tail) {
                headerPatterns.add('http?://' + decodedPath + head);
                const pattern = escapeRegex(decodedPath + head) + '(' + escapeRegex(tail) + ')?';
                const regex = new RegExp('^https?:\/\/' + pattern + '$');
                overridesWithRegex.push({
                    applyToRegex: regex,
                    headers: headerOverride.headers,
                });
            }
            else {
                const regex = new RegExp('^https?:\/\/' + escapeRegex(decodedPath + headerOverride.applyTo) + '$');
                overridesWithRegex.push({
                    applyToRegex: regex,
                    headers: headerOverride.headers,
                });
            }
        }
        return { headerPatterns, path: decodedPath, overridesWithRegex };
    }
    async updateInterceptionPatternsForTests() {
        await this.#innerUpdateInterceptionPatterns();
    }
    updateInterceptionPatterns() {
        void this.updateInterceptionThrottler.schedule(this.#innerUpdateInterceptionPatterns.bind(this));
    }
    async #innerUpdateInterceptionPatterns() {
        this.#headerOverridesMap.clear();
        if (!this.activeInternal || !this.projectInternal) {
            return SDK.NetworkManager.MultitargetNetworkManager.instance().setInterceptionHandlerForPatterns([], this.interceptionHandlerBound);
        }
        let patterns = new Set();
        for (const uiSourceCode of this.projectInternal.uiSourceCodes()) {
            const pattern = this.patternForFileSystemUISourceCode(uiSourceCode);
            if (Root.Runtime.experiments.isEnabled(Root.Runtime.ExperimentName.HEADER_OVERRIDES) &&
                uiSourceCode.name() === HEADERS_FILENAME) {
                const { headerPatterns, path, overridesWithRegex } = await this.generateHeaderPatterns(uiSourceCode);
                if (headerPatterns.size > 0) {
                    patterns = new Set([...patterns, ...headerPatterns]);
                    this.#headerOverridesMap.set(path, overridesWithRegex);
                }
            }
            else {
                patterns.add(pattern);
            }
            // Most servers have the concept of a "directory index", which is a
            // default resource name for a request targeting a "directory", e. g.
            // requesting "example.com/path/" would result in the same response as
            // requesting "example.com/path/index.html". To match this behavior we
            // generate an additional pattern without "index.html" as the longer
            // pattern would not match against a shorter request.
            const { head, tail } = extractDirectoryIndex(pattern);
            if (tail) {
                patterns.add(head);
            }
        }
        return SDK.NetworkManager.MultitargetNetworkManager.instance().setInterceptionHandlerForPatterns(Array.from(patterns).map(pattern => ({ urlPattern: pattern, requestStage: "Response" /* Response */ })), this.interceptionHandlerBound);
    }
    async onUISourceCodeRemoved(uiSourceCode) {
        await this.networkUISourceCodeRemoved(uiSourceCode);
        await this.filesystemUISourceCodeRemoved(uiSourceCode);
    }
    async networkUISourceCodeRemoved(uiSourceCode) {
        if (uiSourceCode.project().type() === Workspace.Workspace.projectTypes.Network) {
            await this.unbind(uiSourceCode);
            this.networkUISourceCodeForEncodedPath.delete(this.encodedPathFromUrl(uiSourceCode.url()));
        }
    }
    async filesystemUISourceCodeRemoved(uiSourceCode) {
        if (uiSourceCode.project() !== this.projectInternal) {
            return;
        }
        this.updateInterceptionPatterns();
        this.originalResponseContentPromises.delete(uiSourceCode);
        await this.unbind(uiSourceCode);
    }
    async setProject(project) {
        if (project === this.projectInternal) {
            return;
        }
        if (this.projectInternal) {
            await Promise.all(this.projectInternal.uiSourceCodes().map(uiSourceCode => this.filesystemUISourceCodeRemoved(uiSourceCode)));
        }
        this.projectInternal = project;
        if (this.projectInternal) {
            await Promise.all(this.projectInternal.uiSourceCodes().map(uiSourceCode => this.filesystemUISourceCodeAdded(uiSourceCode)));
        }
        await this.updateActiveProject();
        this.dispatchEventToListeners(Events.ProjectChanged, this.projectInternal);
    }
    async onProjectAdded(project) {
        if (project.type() !== Workspace.Workspace.projectTypes.FileSystem ||
            FileSystemWorkspaceBinding.fileSystemType(project) !== 'overrides') {
            return;
        }
        const fileSystemPath = FileSystemWorkspaceBinding.fileSystemPath(project.id());
        if (!fileSystemPath) {
            return;
        }
        if (this.projectInternal) {
            this.projectInternal.remove();
        }
        await this.setProject(project);
    }
    async onProjectRemoved(project) {
        if (project === this.projectInternal) {
            await this.setProject(null);
        }
    }
    mergeHeaders(baseHeaders, overrideHeaders) {
        const result = [];
        const headerMap = new Map();
        for (const header of baseHeaders) {
            headerMap.set(header.name, header.value);
        }
        for (const [headerName, headerValue] of Object.entries(overrideHeaders)) {
            headerMap.set(headerName, headerValue);
        }
        headerMap.forEach((headerValue, headerName) => {
            result.push({ name: headerName, value: headerValue });
        });
        return result;
    }
    #maybeMergeHeadersForPathSegment(path, requestUrl, headers) {
        const headerOverrides = this.#headerOverridesMap.get(path) || [];
        for (const headerOverride of headerOverrides) {
            if (headerOverride.applyToRegex.test(requestUrl)) {
                headers = this.mergeHeaders(headers, headerOverride.headers);
            }
        }
        return headers;
    }
    handleHeaderInterception(interceptedRequest) {
        let result = interceptedRequest.responseHeaders || [];
        const urlSegments = this.encodedPathFromUrl(interceptedRequest.request.url).split('/');
        // Traverse the hierarchy of overrides from the most general to the most
        // specific. Check with empty string first to match overrides applying to
        // all domains.
        // e.g. '', 'www.example.com/', 'www.example.com/path/', ...
        let path = '';
        result = this.#maybeMergeHeadersForPathSegment(path, interceptedRequest.request.url, result);
        for (const segment of urlSegments) {
            path += segment + '/';
            result = this.#maybeMergeHeadersForPathSegment(path, interceptedRequest.request.url, result);
        }
        return result;
    }
    async interceptionHandler(interceptedRequest) {
        const method = interceptedRequest.request.method;
        if (!this.activeInternal || (method !== 'GET' && method !== 'POST')) {
            return;
        }
        const proj = this.projectInternal;
        const path = this.fileUrlFromNetworkUrl(interceptedRequest.request.url);
        const fileSystemUISourceCode = proj.uiSourceCodeForURL(path);
        let responseHeaders = [];
        if (Root.Runtime.experiments.isEnabled(Root.Runtime.ExperimentName.HEADER_OVERRIDES)) {
            responseHeaders = this.handleHeaderInterception(interceptedRequest);
        }
        if (!fileSystemUISourceCode && !responseHeaders.length) {
            return;
        }
        if (!responseHeaders.length) {
            responseHeaders = interceptedRequest.responseHeaders || [];
        }
        let mimeType = '';
        if (interceptedRequest.responseHeaders) {
            for (const header of interceptedRequest.responseHeaders) {
                if (header.name.toLowerCase() === 'content-type') {
                    mimeType = header.value;
                    break;
                }
            }
        }
        if (!mimeType) {
            const expectedResourceType = Common.ResourceType.resourceTypes[interceptedRequest.resourceType] || Common.ResourceType.resourceTypes.Other;
            mimeType = fileSystemUISourceCode?.mimeType() || '';
            if (Common.ResourceType.ResourceType.fromMimeType(mimeType) !== expectedResourceType) {
                mimeType = expectedResourceType.canonicalMimeType();
            }
        }
        if (fileSystemUISourceCode) {
            this.originalResponseContentPromises.set(fileSystemUISourceCode, interceptedRequest.responseBody().then(response => {
                if (response.error || response.content === null) {
                    return null;
                }
                if (response.encoded) {
                    const text = atob(response.content);
                    const data = new Uint8Array(text.length);
                    for (let i = 0; i < text.length; ++i) {
                        data[i] = text.charCodeAt(i);
                    }
                    return new TextDecoder('utf-8').decode(data);
                }
                return response.content;
            }));
            const project = fileSystemUISourceCode.project();
            const blob = await project.requestFileBlob(fileSystemUISourceCode);
            if (blob) {
                void interceptedRequest.continueRequestWithContent(new Blob([blob], { type: mimeType }), /* encoded */ false, responseHeaders);
            }
        }
        else {
            const responseBody = await interceptedRequest.responseBody();
            if (!responseBody.error && responseBody.content) {
                void interceptedRequest.continueRequestWithContent(new Blob([responseBody.content], { type: mimeType }), /* encoded */ true, responseHeaders);
            }
        }
    }
}
const RESERVED_FILENAMES = new Set([
    'con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7',
    'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);
const HEADERS_FILENAME = '.headers';
// TODO(crbug.com/1167717): Make this a const enum again
// eslint-disable-next-line rulesdir/const_enum
export var Events;
(function (Events) {
    Events["ProjectChanged"] = "ProjectChanged";
})(Events || (Events = {}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isHeaderOverride(arg) {
    if (!(arg && arg.applyTo && typeof (arg.applyTo === 'string') && arg.headers && Object.keys(arg.headers).length)) {
        return false;
    }
    return Object.values(arg.headers).every(value => typeof value === 'string');
}
export function escapeRegex(pattern) {
    return Platform.StringUtilities.escapeCharacters(pattern, '[]{}()\\.^$+|-,?').replaceAll('*', '.*');
}
export function extractDirectoryIndex(pattern) {
    const lastSlash = pattern.lastIndexOf('/');
    const tail = lastSlash >= 0 ? pattern.slice(lastSlash + 1) : pattern;
    const head = lastSlash >= 0 ? pattern.slice(0, lastSlash + 1) : '';
    const regex = new RegExp('^' + escapeRegex(tail) + '$');
    if (regex.test('index.html') || regex.test('index.htm') || regex.test('index.php')) {
        return { head, tail };
    }
    return { head: pattern };
}
//# sourceMappingURL=NetworkPersistenceManager.js.map
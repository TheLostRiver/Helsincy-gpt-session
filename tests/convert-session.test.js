#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createFakeElement(selector, options = {}) {
  const classes = new Set();

  return {
    selector,
    attributes: {},
    dataset: options.dataset || {},
    disabled: false,
    files: [],
    innerHTML: "",
    listeners: {},
    style: {},
    textContent: "",
    value: "",
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      toggle(name, force) {
        if (force) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    append() {},
    click() {
      this.listeners.click?.({ target: this });
    },
    remove() {},
    select() {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

function loadPageScript(options = {}) {
  const htmlPath = path.join(__dirname, "..", "docs", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);

  assert.ok(match, "expected docs/index.html to contain one inline script");

  const elements = new Map();
  const formatButtons = ["sub2api", "cpa", "cockpit", "9router", "axonhub", "codexmanager"].map((format) =>
    createFakeElement(`[data-format="${format}"]`, { dataset: { format } })
  );
  const modeButtons = ["session", "format"].map((mode) =>
    createFakeElement(`[data-mode="${mode}"]`, { dataset: { mode } })
  );
  const downloads = [];
  const objectUrls = new Map();
  let objectUrlIndex = 0;

  class FakeBlob {
    constructor(parts, blobOptions = {}) {
      this.parts = parts;
      this.type = blobOptions.type || "";
      this.text = parts.map((part) => String(part)).join("");
    }
  }

  const document = {
    body: createFakeElement("body"),
    createElement(selector) {
      const element = createFakeElement(selector);
      if (selector === "a") {
        element.click = function clickAnchor() {
          const blob = objectUrls.get(this.href);
          downloads.push({
            download: this.download,
            href: this.href,
            text: blob?.text,
          });
        };
      }
      return element;
    },
    execCommand() {
      return true;
    },
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, createFakeElement(selector));
      }
      return elements.get(selector);
    },
    querySelectorAll(selector) {
      if (selector === "[data-format]") {
        return formatButtons;
      }
      if (selector === "[data-mode]") {
        return modeButtons;
      }
      return [];
    },
  };

  const context = {
    Blob: FakeBlob,
    TextDecoder,
    TextEncoder,
    URL: {
      createObjectURL(blob) {
        const url = `blob:test-${objectUrlIndex}`;
        objectUrlIndex += 1;
        objectUrls.set(url, blob);
        return url;
      },
      revokeObjectURL(url) {
        objectUrls.delete(url);
      },
    },
    atob,
    btoa,
    clearTimeout,
    console,
    document,
    navigator: {
      clipboard: {
        async writeText() {},
      },
    },
    setTimeout,
    ...options.globals,
  };
  context.window = context;

  vm.runInNewContext(match[1], context, { filename: "docs/index.html" });

  return { elements, formatButtons, modeButtons, downloads };
}

function createAdvancingDate(startIso = "2026-05-22T00:00:00.000Z") {
  const RealDate = Date;
  let tick = 0;

  return class AdvancingDate extends RealDate {
    constructor(...args) {
      if (args.length) {
        super(...args);
        return;
      }
      super(RealDate.parse(startIso) + tick * 1000);
      tick += 1;
    }

    static now() {
      return new AdvancingDate().getTime();
    }

    static parse(value) {
      return RealDate.parse(value);
    }

    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  };
}

function dispatch(element, type, event = { target: element }) {
  assert.equal(typeof element.listeners[type], "function", `missing ${type} listener on ${element.selector}`);
  return element.listeners[type](event);
}

function jwtWithPayload(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "sig",
  ].join(".");
}

function createSession(email, accountId, exp = 1780473960) {
  return {
    user: {
      id: `user-${accountId}`,
      email,
    },
    expires: new Date(exp * 1000).toISOString(),
    account: {
      id: accountId,
      planType: "plus",
    },
    accessToken: jwtWithPayload({
      exp,
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
        chatgpt_plan_type: "plus",
        chatgpt_user_id: `user-${accountId}`,
      },
      "https://api.openai.com/profile": {
        email,
      },
    }),
    sessionToken: `session-${accountId}`,
  };
}

function createCpa(email, accountId, accessToken = "cpa-access-token") {
  return {
    type: "codex",
    account_id: accountId,
    chatgpt_account_id: accountId,
    email,
    name: email,
    access_token: accessToken,
    refresh_token: "",
    session_token: `session-${accountId}`,
    last_refresh: "2026-05-22T12:00:00.000Z",
    expired: "2026-08-06T14:29:36.155Z",
  };
}

function testSub2apiAccountUsesAccessTokenExpiry() {
  const { elements } = loadPageScript();
  const input = elements.get("#session-input");
  const output = elements.get("#output");

  input.value = JSON.stringify({
    user: {
      email: "mark@example.com",
    },
    accessToken: jwtWithPayload({
      exp: 1780473960,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "chatgpt-account-1",
      },
    }),
  });
  dispatch(input, "input");

  const document = JSON.parse(output.value);
  const account = document.accounts[0];

  assert.equal(document.expires_at, undefined);
  assert.equal(document.auto_pause_on_expired, undefined);
  assert.equal(document.accounts.length, 1);
  assert.equal(account.expires_at, 1780473960);
  assert.equal(account.auto_pause_on_expired, true);
}

function testSub2apiAccountsUseTheirOwnAccessTokenExpiry() {
  const { elements } = loadPageScript();
  const input = elements.get("#session-input");
  const output = elements.get("#output");

  input.value = JSON.stringify([
    {
      email: "late@example.com",
      accessToken: jwtWithPayload({
        exp: 1780473960,
        "https://api.openai.com/auth": {
          chatgpt_account_id: "chatgpt-account-late",
        },
      }),
    },
    {
      email: "early@example.com",
      accessToken: jwtWithPayload({
        exp: 1780000000,
        "https://api.openai.com/auth": {
          chatgpt_account_id: "chatgpt-account-early",
        },
      }),
    },
  ]);
  dispatch(input, "input");

  const document = JSON.parse(output.value);

  assert.equal(document.expires_at, undefined);
  assert.equal(document.auto_pause_on_expired, undefined);
  assert.equal(document.accounts.length, 2);
  assert.equal(document.accounts[0].expires_at, 1780473960);
  assert.equal(document.accounts[0].auto_pause_on_expired, true);
  assert.equal(document.accounts[1].expires_at, 1780000000);
  assert.equal(document.accounts[1].auto_pause_on_expired, true);
}

function testMinimalCpaDoesNotConvertInDefaultSessionMode() {
  const { elements } = loadPageScript();
  const input = elements.get("#session-input");
  const output = elements.get("#output");

  input.value = JSON.stringify({
    type: "codex",
    account_id: "acct-1",
    access_token: "tok-1",
  });
  dispatch(input, "input");

  assert.equal(output.value, "");
}

function testPastedSequentialJsonDocumentsConvertMultipleAccounts() {
  const { elements } = loadPageScript();
  const input = elements.get("#session-input");
  const output = elements.get("#output");

  input.value = [
    JSON.stringify(createSession("one@example.com", "account-one", 1780473960)),
    JSON.stringify(createSession("two@example.com", "account-two", 1780000000)),
  ].join("\n");
  dispatch(input, "input");

  const document = JSON.parse(output.value);

  assert.equal(document.accounts.length, 2);
  assert.equal(document.accounts[0].credentials.email, "one@example.com");
  assert.equal(document.accounts[1].credentials.email, "two@example.com");
}

function testPastedJsonDocumentsSeparatedByBlankLinesConvertMultipleAccounts() {
  const { elements } = loadPageScript();
  const input = elements.get("#session-input");
  const output = elements.get("#output");

  input.value = [
    JSON.stringify(createSession("alpha@example.com", "account-alpha", 1780473960)),
    "",
    "",
    JSON.stringify(createSession("beta@example.com", "account-beta", 1780000000)),
  ].join("\n");
  dispatch(input, "input");

  const document = JSON.parse(output.value);

  assert.equal(document.accounts.length, 2);
  assert.equal(document.accounts[0].credentials.email, "alpha@example.com");
  assert.equal(document.accounts[1].credentials.email, "beta@example.com");
}

async function testTxtFileImportParsesMultipleJsonDocuments() {
  const { elements } = loadPageScript();
  const fileInput = elements.get("#file-input");
  const output = elements.get("#output");

  const text = [
    JSON.stringify(createSession("txt-one@example.com", "txt-account-one", 1780473960)),
    JSON.stringify(createSession("txt-two@example.com", "txt-account-two", 1780000000)),
  ].join("\n");

  await dispatch(fileInput, "change", {
    target: {
      files: [{
        name: "accounts.txt",
        type: "text/plain",
        webkitRelativePath: "",
        async text() {
          return text;
        },
      }],
      value: "accounts.txt",
    },
  });

  const document = JSON.parse(output.value);

  assert.equal(document.accounts.length, 2);
  assert.equal(document.accounts[0].credentials.email, "txt-one@example.com");
  assert.equal(document.accounts[1].credentials.email, "txt-two@example.com");
}

function testMultiFormatPreviewListsEveryOutputFormat() {
  const { elements } = loadPageScript();
  const input = elements.get("#session-input");
  const preview = elements.get("#format-preview");

  input.value = JSON.stringify(createSession("preview@example.com", "preview-account", 1780473960));
  dispatch(input, "input");

  for (const label of ["sub2api", "CPA", "Cockpit", "9router", "AxonHub", "Codex-Manager"]) {
    assert.match(preview.innerHTML, new RegExp(label.replace("-", "\\-")));
  }
}

async function testExportAllWritesEveryFormatToChosenDirectory() {
  const writtenFiles = [];
  const directoryHandle = {
    async getFileHandle(fileName, options) {
      assert.equal(options.create, true);
      return {
        async createWritable() {
          return {
            async write(text) {
              writtenFiles.push({ fileName, text });
            },
            async close() {},
          };
        },
      };
    },
  };
  const { elements } = loadPageScript({
    globals: {
      async showDirectoryPicker(options) {
        assert.equal(options.mode, "readwrite");
        return directoryHandle;
      },
    },
  });
  const input = elements.get("#session-input");
  const exportAll = elements.get("#export-all-output");

  input.value = JSON.stringify(createSession("export@example.com", "export-account", 1780473960));
  dispatch(input, "input");
  await dispatch(exportAll, "click");

  assert.equal(writtenFiles.length, 6);
  for (const format of ["sub2api", "cpa", "cockpit", "9router", "axonhub", "codexmanager"]) {
    const file = writtenFiles.find((item) => item.fileName.includes(`.${format}.`));
    assert.ok(file, `expected exported ${format} file`);
    assert.doesNotThrow(() => JSON.parse(file.text));
  }
}

async function testExportAllFallsBackToDownloadsWithoutDirectoryPicker() {
  const { elements, downloads } = loadPageScript();
  const input = elements.get("#session-input");
  const exportAll = elements.get("#export-all-output");

  input.value = JSON.stringify(createSession("fallback@example.com", "fallback-account", 1780473960));
  dispatch(input, "input");
  await dispatch(exportAll, "click");

  assert.equal(downloads.length, 6);
  for (const format of ["sub2api", "cpa", "cockpit", "9router", "axonhub", "codexmanager"]) {
    assert.ok(downloads.some((item) => item.download.includes(`.${format}.`)), `expected downloaded ${format} file`);
  }
}

async function testDownloadOutputUsesDisplayedOutputText() {
  const { elements, downloads } = loadPageScript({
    globals: {
      Date: createAdvancingDate(),
    },
  });
  const input = elements.get("#session-input");
  const output = elements.get("#output");
  const downloadOutput = elements.get("#download-output");

  input.value = JSON.stringify(createSession("download@example.com", "download-account", 1780473960));
  dispatch(input, "input");
  const displayedOutput = output.value;

  await dispatch(downloadOutput, "click");

  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].text, displayedOutput);
}

async function testExportAllFallsBackToDownloadsWhenDirectoryPickerThrows() {
  const { elements, downloads } = loadPageScript({
    globals: {
      async showDirectoryPicker(options) {
        assert.equal(options.mode, "readwrite");
        throw new Error("directory unavailable");
      },
    },
  });
  const input = elements.get("#session-input");
  const exportAll = elements.get("#export-all-output");

  input.value = JSON.stringify(createSession("picker-error@example.com", "picker-error-account", 1780473960));
  dispatch(input, "input");
  await dispatch(exportAll, "click");

  assert.equal(downloads.length, 6);
  for (const format of ["sub2api", "cpa", "cockpit", "9router", "axonhub", "codexmanager"]) {
    assert.ok(downloads.some((item) => item.download.includes(`.${format}.`)), `expected fallback ${format} download`);
  }
}

function testPreviewOptionClickSwitchesOutputFormat() {
  const { elements } = loadPageScript();
  const input = elements.get("#session-input");
  const output = elements.get("#output");
  const preview = elements.get("#format-preview");

  input.value = JSON.stringify(createSession("preview-click@example.com", "preview-click-account", 1780473960));
  dispatch(input, "input");

  const sub2api = JSON.parse(output.value);
  assert.equal(sub2api.accounts.length, 1);

  dispatch(preview, "click", {
    target: {
      closest(selector) {
        assert.equal(selector, "[data-preview-format]");
        return { dataset: { previewFormat: "cpa" } };
      },
    },
  });

  const cpa = JSON.parse(output.value);
  assert.equal(cpa.type, "codex");
  assert.equal("accounts" in cpa, false);
}

function testFormatModeKeepsDownloadActionVisibleAndFixesSub2api() {
  const { elements, modeButtons } = loadPageScript();
  const formatButton = modeButtons.find((button) => button.dataset.mode === "format");
  const toolbar = elements.get("#format-toolbar");
  const formatOptions = elements.get("#format-options");
  const preview = elements.get("#format-preview");
  const copyOutput = elements.get("#copy-output");
  const downloadOutput = elements.get("#download-output");
  const exportAll = elements.get("#export-all-output");
  const inputTitle = elements.get("#input-title");
  const outputTitle = elements.get("#output-title");
  const statFormat = elements.get("#stat-format");

  dispatch(formatButton, "click");

  assert.equal(toolbar.classList.contains("hidden"), false);
  assert.ok(formatOptions, "expected format options to be tracked separately from output actions");
  assert.equal(formatOptions.classList.contains("hidden"), true);
  assert.equal(preview.classList.contains("hidden"), true);
  assert.equal(copyOutput.classList.contains("hidden"), false);
  assert.equal(downloadOutput.classList.contains("hidden"), false);
  assert.equal(exportAll.classList.contains("hidden"), true);
  assert.equal(inputTitle.textContent, "CPA JSON");
  assert.equal(outputTitle.textContent, "sub2api JSON");
  assert.equal(statFormat.textContent, "目标格式 sub2api");
}

async function testDownloadOutputWorksInFormatMode() {
  const { elements, modeButtons, downloads } = loadPageScript({
    globals: {
      Date: createAdvancingDate(),
    },
  });
  const input = switchToFormatMode(elements, modeButtons);
  const output = elements.get("#output");
  const downloadOutput = elements.get("#download-output");

  input.value = JSON.stringify(createCpa("format-download@example.com", "format-download-account"));
  dispatch(input, "input");
  const displayedOutput = output.value;

  await dispatch(downloadOutput, "click");

  assert.equal(downloads.length, 1);
  assert.match(downloads[0].download, /\.sub2api\./);
  assert.equal(downloads[0].text, displayedOutput);
  assert.equal(JSON.parse(downloads[0].text).accounts.length, 1);
}

function switchToFormatMode(elements, modeButtons) {
  const formatButton = modeButtons.find((button) => button.dataset.mode === "format");
  dispatch(formatButton, "click");
  return elements.get("#session-input");
}

function testSingleCpaConvertsToSub2apiInFormatMode() {
  const { elements, modeButtons } = loadPageScript();
  const input = switchToFormatMode(elements, modeButtons);
  const output = elements.get("#output");

  input.value = JSON.stringify(createCpa("cpa-one@example.com", "cpa-account-one"));
  dispatch(input, "input");

  const document = JSON.parse(output.value);
  assert.equal(document.accounts.length, 1);
  assert.equal(document.accounts[0].credentials.email, "cpa-one@example.com");
  assert.equal(document.accounts[0].credentials.access_token, "cpa-access-token");
}

function testMinimalCpaWithAccountIdConvertsInFormatMode() {
  const { elements, modeButtons } = loadPageScript();
  const input = switchToFormatMode(elements, modeButtons);
  const output = elements.get("#output");

  input.value = JSON.stringify({
    type: "codex",
    account_id: "acct-1",
    access_token: "tok-1",
  });
  dispatch(input, "input");

  assert.notEqual(output.value, "");
  const document = JSON.parse(output.value);
  assert.equal(document.accounts.length, 1);
  assert.equal(document.accounts[0].credentials.access_token, "tok-1");
  assert.equal(document.accounts[0].credentials.chatgpt_account_id, "acct-1");
}

function testMultiplePastedCpaDocumentsConvertToSub2apiInFormatMode() {
  const { elements, modeButtons } = loadPageScript();
  const input = switchToFormatMode(elements, modeButtons);
  const output = elements.get("#output");

  input.value = [
    JSON.stringify(createCpa("cpa-a@example.com", "cpa-account-a", "cpa-access-a")),
    JSON.stringify(createCpa("cpa-b@example.com", "cpa-account-b", "cpa-access-b")),
  ].join("\n");
  dispatch(input, "input");

  const document = JSON.parse(output.value);
  assert.equal(document.accounts.length, 2);
  assert.equal(document.accounts[0].credentials.email, "cpa-a@example.com");
  assert.equal(document.accounts[1].credentials.email, "cpa-b@example.com");
}

function testNonCpaSessionIsSkippedInFormatMode() {
  const { elements, modeButtons } = loadPageScript();
  const input = switchToFormatMode(elements, modeButtons);
  const output = elements.get("#output");
  const inputStatus = elements.get("#input-status");
  const statErrors = elements.get("#stat-errors");

  input.value = JSON.stringify(createSession("session@example.com", "session-account"));
  dispatch(input, "input");

  assert.equal(output.value, "");
  assert.equal(statErrors.textContent, "1");
  assert.match(inputStatus.textContent, /当前模式只支持 CPA JSON/);
  assert.match(inputStatus.textContent, /可切回 Session 转换模式/);
}

function testSnakeCaseSessionTokenInputIsSkippedInFormatMode() {
  const { elements, modeButtons } = loadPageScript();
  const input = switchToFormatMode(elements, modeButtons);
  const output = elements.get("#output");
  const inputStatus = elements.get("#input-status");

  input.value = JSON.stringify({
    email: "snake-session@example.com",
    access_token: "session-access-token",
    session_token: "session-token",
  });
  dispatch(input, "input");

  assert.equal(output.value, "");
  assert.match(inputStatus.textContent, /当前模式只支持 CPA JSON/);
  assert.match(inputStatus.textContent, /可切回 Session 转换模式/);
}

function testSnakeCaseSessionLikeInputShowsFormatModeHintInIssues() {
  const { elements, modeButtons } = loadPageScript();
  const input = switchToFormatMode(elements, modeButtons);
  const issues = elements.get("#issues");

  input.value = JSON.stringify([
    createCpa("hint-cpa@example.com", "hint-cpa-account"),
    {
      user: {
        email: "snake-session@example.com",
      },
      access_token: "session-access-token",
    },
  ]);
  dispatch(input, "input");

  assert.match(issues.innerHTML, /CPA JSON/);
  assert.match(issues.innerHTML, /Session/);
}

function testMixedCpaAndSessionInputConvertsCpaAndReportsSkipped() {
  const { elements, modeButtons } = loadPageScript();
  const input = switchToFormatMode(elements, modeButtons);
  const output = elements.get("#output");
  const statErrors = elements.get("#stat-errors");

  input.value = JSON.stringify([
    createCpa("mixed-cpa@example.com", "mixed-cpa-account"),
    createSession("mixed-session@example.com", "mixed-session-account"),
  ]);
  dispatch(input, "input");

  const document = JSON.parse(output.value);
  assert.equal(document.accounts.length, 1);
  assert.equal(document.accounts[0].credentials.email, "mixed-cpa@example.com");
  assert.equal(statErrors.textContent, "1");
}

async function testTxtCpaFileImportUsesFormatModeFilter() {
  const { elements, modeButtons } = loadPageScript();
  switchToFormatMode(elements, modeButtons);
  const fileInput = elements.get("#file-input");
  const output = elements.get("#output");

  const text = [
    JSON.stringify(createCpa("file-cpa-a@example.com", "file-cpa-a")),
    JSON.stringify(createSession("file-session@example.com", "file-session")),
  ].join("\n");

  await dispatch(fileInput, "change", {
    target: {
      files: [{
        name: "cpa-accounts.txt",
        type: "text/plain",
        webkitRelativePath: "",
        async text() {
          return text;
        },
      }],
      value: "cpa-accounts.txt",
    },
  });

  const document = JSON.parse(output.value);
  assert.equal(document.accounts.length, 1);
  assert.equal(document.accounts[0].credentials.email, "file-cpa-a@example.com");
  assert.equal(elements.get("#stat-errors").textContent, "1");
}

async function testTxtMinimalCpaFileImportUsesFormatModeFilter() {
  const { elements, modeButtons } = loadPageScript();
  switchToFormatMode(elements, modeButtons);
  const fileInput = elements.get("#file-input");
  const output = elements.get("#output");
  const inputStatus = elements.get("#input-status");

  const text = JSON.stringify({
    type: "codex",
    account_id: "file-minimal-cpa",
    access_token: "file-access-token",
  });

  await dispatch(fileInput, "change", {
    target: {
      files: [{
        name: "minimal-cpa.txt",
        type: "text/plain",
        webkitRelativePath: "",
        async text() {
          return text;
        },
      }],
      value: "minimal-cpa.txt",
    },
  });

  const document = JSON.parse(output.value);
  assert.equal(document.accounts.length, 1);
  assert.equal(document.accounts[0].credentials.chatgpt_account_id, "file-minimal-cpa");
  assert.equal(document.accounts[0].credentials.access_token, "file-access-token");
  assert.match(inputStatus.textContent, /读取 1 个文件/);
}

function testSwitchingBackToSessionModeRestoresMultiFormatUi() {
  const { elements, modeButtons } = loadPageScript();
  const formatButton = modeButtons.find((button) => button.dataset.mode === "format");
  const sessionButton = modeButtons.find((button) => button.dataset.mode === "session");
  const toolbar = elements.get("#format-toolbar");
  const preview = elements.get("#format-preview");
  const exportAll = elements.get("#export-all-output");
  const inputTitle = elements.get("#input-title");
  const outputTitle = elements.get("#output-title");

  dispatch(formatButton, "click");
  dispatch(sessionButton, "click");

  assert.equal(toolbar.classList.contains("hidden"), false);
  assert.equal(preview.classList.contains("hidden"), false);
  assert.equal(exportAll.classList.contains("hidden"), false);
  assert.equal(inputTitle.textContent, "Session JSON");
  assert.equal(outputTitle.textContent, "转换结果");
}

function testSyntheticIdTokenHasCodexParseableJwtFormat() {
  const { elements, formatButtons } = loadPageScript();
  const cpaButton = formatButtons.find((button) => button.dataset.format === "cpa");
  const input = elements.get("#session-input");
  const output = elements.get("#output");

  dispatch(cpaButton, "click");
  input.value = JSON.stringify({
    user: {
      id: "user-test",
      email: "mark@example.com",
    },
    expires: "2026-08-06T14:29:36.155Z",
    account: {
      id: "00000000-0000-4000-9000-000000000000",
      planType: "plus",
    },
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  dispatch(input, "input");

  const cpa = JSON.parse(output.value);
  const parts = cpa.id_token.split(".");

  assert.equal(cpa.id_token_synthetic, true);
  assert.equal(parts.length, 3);
  assert.ok(
    parts.every((part) => part.length > 0),
    "synthetic id_token must use non-empty header, payload, and signature segments"
  );

  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  assert.equal(payload.email, "mark@example.com");
  assert.equal(payload["https://api.openai.com/auth"].chatgpt_account_id, "00000000-0000-4000-9000-000000000000");
}

function testAxonHubAuthJsonUsesPlaceholderRefreshTokenWhenMissing() {
  const { elements, formatButtons } = loadPageScript();
  const axonHubButton = formatButtons.find((button) => button.dataset.format === "axonhub");
  const input = elements.get("#session-input");
  const output = elements.get("#output");

  dispatch(axonHubButton, "click");
  input.value = JSON.stringify({
    user: {
      id: "user-test",
      email: "mark@example.com",
    },
    expires: "2026-08-06T14:29:36.155Z",
    account: {
      id: "00000000-0000-4000-9000-000000000000",
      planType: "plus",
    },
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  dispatch(input, "input");

  const authJson = JSON.parse(output.value);

  assert.equal(authJson.auth_mode, "chatgpt");
  assert.equal(authJson.tokens.access_token, "access-token");
  assert.equal(authJson.tokens.refresh_token, "__missing_refresh_token__");
  assert.equal(authJson.tokens.id_token.split(".").length, 3);
  assert.equal(authJson.last_refresh, "2026-08-06T13:29:36.155Z");
  assert.equal(authJson.axonhub_refresh_token_placeholder, true);
  assert.equal(authJson.axonhub_note, "refresh_token is a placeholder; access_token works only until it expires.");
}

function testAxonHubAuthJsonPreservesRealRefreshToken() {
  const { elements, formatButtons } = loadPageScript();
  const axonHubButton = formatButtons.find((button) => button.dataset.format === "axonhub");
  const input = elements.get("#session-input");
  const output = elements.get("#output");

  dispatch(axonHubButton, "click");
  input.value = JSON.stringify({
    user: {
      email: "mark@example.com",
    },
    expires: "2026-08-06T14:29:36.155Z",
    account: {
      id: "00000000-0000-4000-9000-000000000000",
      planType: "plus",
    },
    accessToken: "access-token",
    refreshToken: "real-refresh-token",
    idToken: "real.header.signature",
  });
  dispatch(input, "input");

  const authJson = JSON.parse(output.value);

  assert.equal(authJson.tokens.refresh_token, "real-refresh-token");
  assert.equal(authJson.tokens.id_token, "real.header.signature");
  assert.equal(authJson.axonhub_refresh_token_placeholder, undefined);
  assert.equal(authJson.axonhub_note, undefined);
}

function testCodexManagerAuthJsonUsesEmptyRefreshTokenWhenMissing() {
  const { elements, formatButtons } = loadPageScript();
  const codexManagerButton = formatButtons.find((button) => button.dataset.format === "codexmanager");
  const input = elements.get("#session-input");
  const output = elements.get("#output");

  dispatch(codexManagerButton, "click");
  input.value = JSON.stringify({
    user: {
      id: "user-test",
      email: "mark@example.com",
    },
    expires: "2026-08-06T14:29:36.155Z",
    account: {
      id: "00000000-0000-4000-9000-000000000000",
      planType: "plus",
    },
    accessToken: "access-token",
    sessionToken: "session-token",
  });
  dispatch(input, "input");

  const authJson = JSON.parse(output.value);

  assert.equal(authJson.tokens.access_token, "access-token");
  assert.equal(authJson.tokens.refresh_token, "");
  assert.equal(authJson.tokens.id_token, "");
  assert.equal(authJson.tokens.account_id, "00000000-0000-4000-9000-000000000000");
  assert.equal(authJson.meta.label, "mark@example.com");
  assert.equal(authJson.meta.note, "Imported from ChatGPT session");
}

function testCodexManagerAuthJsonPreservesRealRefreshAndMetadata() {
  const { elements, formatButtons } = loadPageScript();
  const codexManagerButton = formatButtons.find((button) => button.dataset.format === "codexmanager");
  const input = elements.get("#session-input");
  const output = elements.get("#output");

  dispatch(codexManagerButton, "click");
  input.value = JSON.stringify({
    user: {
      email: "mark@example.com",
    },
    accessToken: "access-token",
    refreshToken: "real-refresh-token",
    idToken: "real.header.signature",
    workspaceId: "workspace-1",
    chatgptAccountId: "chatgpt-account-1",
  });
  dispatch(input, "input");

  const authJson = JSON.parse(output.value);

  assert.equal(authJson.tokens.refresh_token, "real-refresh-token");
  assert.equal(authJson.tokens.id_token, "real.header.signature");
  assert.equal(authJson.tokens.chatgpt_account_id, "chatgpt-account-1");
  assert.equal(authJson.meta.workspace_id, "workspace-1");
  assert.equal(authJson.meta.chatgpt_account_id, "chatgpt-account-1");
}

async function run() {
  testSub2apiAccountUsesAccessTokenExpiry();
  testSub2apiAccountsUseTheirOwnAccessTokenExpiry();
  testMinimalCpaDoesNotConvertInDefaultSessionMode();
  testPastedSequentialJsonDocumentsConvertMultipleAccounts();
  testPastedJsonDocumentsSeparatedByBlankLinesConvertMultipleAccounts();
  await testTxtFileImportParsesMultipleJsonDocuments();
  testMultiFormatPreviewListsEveryOutputFormat();
  await testExportAllWritesEveryFormatToChosenDirectory();
  await testExportAllFallsBackToDownloadsWithoutDirectoryPicker();
  await testDownloadOutputUsesDisplayedOutputText();
  await testExportAllFallsBackToDownloadsWhenDirectoryPickerThrows();
  testPreviewOptionClickSwitchesOutputFormat();
  testFormatModeKeepsDownloadActionVisibleAndFixesSub2api();
  await testDownloadOutputWorksInFormatMode();
  testSingleCpaConvertsToSub2apiInFormatMode();
  testMinimalCpaWithAccountIdConvertsInFormatMode();
  testMultiplePastedCpaDocumentsConvertToSub2apiInFormatMode();
  testNonCpaSessionIsSkippedInFormatMode();
  testSnakeCaseSessionTokenInputIsSkippedInFormatMode();
  testSnakeCaseSessionLikeInputShowsFormatModeHintInIssues();
  testMixedCpaAndSessionInputConvertsCpaAndReportsSkipped();
  await testTxtCpaFileImportUsesFormatModeFilter();
  await testTxtMinimalCpaFileImportUsesFormatModeFilter();
  testSwitchingBackToSessionModeRestoresMultiFormatUi();
  testSyntheticIdTokenHasCodexParseableJwtFormat();
  testAxonHubAuthJsonUsesPlaceholderRefreshTokenWhenMissing();
  testAxonHubAuthJsonPreservesRealRefreshToken();
  testCodexManagerAuthJsonUsesEmptyRefreshTokenWhenMissing();
  testCodexManagerAuthJsonPreservesRealRefreshAndMetadata();
  console.log("convert-session tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

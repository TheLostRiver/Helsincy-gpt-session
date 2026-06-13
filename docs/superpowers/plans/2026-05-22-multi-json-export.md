# Multi JSON Import And Export All Formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support pasted and uploaded multi-document account JSON, add multi-format previews, and export every supported format to a user-selected local directory.

**Architecture:** Keep the app as one static HTML file. Add a shared multi-document JSON parser, reuse the existing account conversion pipeline, extract output generation by format, and make preview/download/export all call that same format-aware helper.

**Tech Stack:** Static HTML/CSS/vanilla JavaScript in `docs/index.html`, Node.js `node:vm` regression tests in `tests/convert-session.test.js`.

---

## File Structure

- Modify `docs/index.html`
  - HTML: add `.txt` to the file input accept list, add a `导出全部格式` action button, and add a compact multi-format preview container.
  - CSS: add styles for preview buttons and responsive preview layout.
  - JavaScript: add an `OUTPUT_FORMATS` list, multi-document parser helpers, format-specific output builders, export-all helpers, and update file import to share the parser.
- Modify `tests/convert-session.test.js`
  - Expand the fake DOM/runtime to support async file import and export tests.
  - Add regression tests for pasted multi-document JSON, `.txt` multi-document file import, preview rendering, export-all directory writes, and export-all download fallback.

## Task 1: Multi-Document Parser For Pasted Input

**Files:**
- Modify: `tests/convert-session.test.js`
- Modify: `docs/index.html`

- [ ] **Step 1: Write the failing pasted multi-document tests**

In `tests/convert-session.test.js`, add this helper after `jwtWithPayload`:

```js
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
```

Add these tests after `testSub2apiAccountsUseTheirOwnAccessTokenExpiry`:

```js
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
```

Add calls before the existing synthetic-id-token test call:

```js
testPastedSequentialJsonDocumentsConvertMultipleAccounts();
testPastedJsonDocumentsSeparatedByBlankLinesConvertMultipleAccounts();
```

- [ ] **Step 2: Run the parser tests to verify RED**

Run:

```bash
node tests/convert-session.test.js
```

Expected: FAIL with a `JSON 解析失败` message or an empty output parse error caused by pasted sequential JSON not being supported.

- [ ] **Step 3: Add multi-document parsing helpers**

In `docs/index.html`, replace the existing `parseInputDocuments(text)` with these helpers and function:

```js
function parseJsonDocumentSlices(text) {
  const slices = [];
  let index = 0;

  function skipWhitespace() {
    while (index < text.length && /\s/.test(text[index])) {
      index += 1;
    }
  }

  skipWhitespace();
  while (index < text.length) {
    const start = index;
    const opening = text[index];
    const expectedClosing = opening === "{" ? "}" : opening === "[" ? "]" : "";
    if (!expectedClosing) {
      throw new Error(`JSON 解析失败：位置 ${index + 1} 附近不是 JSON 对象或数组`);
    }

    const stack = [expectedClosing];
    let inString = false;
    let escaped = false;
    index += 1;

    while (index < text.length && stack.length) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        index += 1;
        continue;
      }

      if (char === "\"") {
        inString = true;
        index += 1;
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(char === "{" ? "}" : "]");
      } else if (char === "}" || char === "]") {
        const expected = stack.pop();
        if (char !== expected) {
          throw new Error(`JSON 解析失败：位置 ${index + 1} 附近括号不匹配`);
        }
      }

      index += 1;
    }

    if (stack.length) {
      throw new Error(`JSON 解析失败：从位置 ${start + 1} 开始的 JSON 未闭合`);
    }

    const source = text.slice(start, index);
    try {
      slices.push({
        value: JSON.parse(source),
        start,
        end: index,
      });
    } catch (error) {
      throw new Error(`JSON 解析失败：位置 ${start + 1} 附近 ${error.message}`);
    }

    skipWhitespace();
  }

  return slices;
}

function parseJsonDocuments(text) {
  try {
    return [{
      value: JSON.parse(text),
      start: 0,
      end: text.length,
    }];
  } catch {
    return parseJsonDocumentSlices(text);
  }
}

function parseInputDocuments(text, sourceName = "pasted-json") {
  if (typeof text !== "string" || text.trim() === "") {
    return [];
  }

  const parsedDocuments = parseJsonDocuments(text);
  return parsedDocuments.flatMap((document, documentIndex) => {
    const found = collectSessionLikeObjects(document.value, sourceName);
    if (parsedDocuments.length === 1) {
      return found;
    }

    return found.map((item) => ({
      ...item,
      path: `$documents[${documentIndex}]${item.path === "$" ? "" : item.path.slice(1)}`,
    }));
  });
}
```

- [ ] **Step 4: Run the parser tests to verify GREEN**

Run:

```bash
node tests/convert-session.test.js
```

Expected: PASS with `convert-session tests passed`.

- [ ] **Step 5: Commit parser support**

Run:

```bash
git add docs/index.html tests/convert-session.test.js
git commit -m "feat: parse pasted multi json documents"
```

## Task 2: `.txt` File Import With Shared Parser

**Files:**
- Modify: `tests/convert-session.test.js`
- Modify: `docs/index.html`

- [ ] **Step 1: Write the failing `.txt` import test**

In `tests/convert-session.test.js`, change `dispatch` so it returns async handler results:

```js
function dispatch(element, type, event = { target: element }) {
  assert.equal(typeof element.listeners[type], "function", `missing ${type} listener on ${element.selector}`);
  return element.listeners[type](event);
}
```

Add this async test after the pasted multi-document tests:

```js
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
```

Convert the bottom of the file to an async runner:

```js
async function run() {
  testSub2apiAccountUsesAccessTokenExpiry();
  testSub2apiAccountsUseTheirOwnAccessTokenExpiry();
  testPastedSequentialJsonDocumentsConvertMultipleAccounts();
  testPastedJsonDocumentsSeparatedByBlankLinesConvertMultipleAccounts();
  await testTxtFileImportParsesMultipleJsonDocuments();
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
```

- [ ] **Step 2: Run the file import test to verify RED**

Run:

```bash
node tests/convert-session.test.js
```

Expected: FAIL because `accounts.txt` is filtered out by the current `.json` only file import.

- [ ] **Step 3: Update file input and `readFiles`**

In `docs/index.html`, change the file input:

```html
<input class="hidden" id="file-input" type="file" accept=".json,.txt,application/json,text/plain" multiple />
```

Replace the start of `readFiles(files)` through `documents.push(...found);` with:

```js
const supportedFiles = Array.from(files).filter((file) => {
  const name = file.name.toLowerCase();
  return name.endsWith(".json") || name.endsWith(".txt") || file.type === "application/json" || file.type === "text/plain";
});
if (!supportedFiles.length) {
  setStatus(elements.inputStatus, "没有选择 JSON 或 TXT 文件。", "error");
  return;
}

const documents = [];
const skipped = [];

for (const file of supportedFiles) {
  const sourceName = file.webkitRelativePath || file.name;
  try {
    const text = await file.text();
    const found = parseInputDocuments(text, sourceName);
    if (!found.length) {
      skipped.push({
        sourceName,
        path: "$",
        reason: "未找到包含 accessToken 和 user/email 的 session 对象",
      });
    }
    documents.push(...found);
  } catch (error) {
    skipped.push({
      sourceName,
      path: "$",
      reason: error instanceof Error ? error.message : "无法读取文件",
    });
  }
}
```

At the end of `readFiles`, update the status string to use `supportedFiles.length`:

```js
setStatus(elements.inputStatus, `读取 ${supportedFiles.length} 个文件，生成 ${converted.length} 个账号，跳过 ${convertSkipped.length} 项。`, converted.length ? "ok" : "error");
```

- [ ] **Step 4: Run the file import test to verify GREEN**

Run:

```bash
node tests/convert-session.test.js
```

Expected: PASS with `convert-session tests passed`.

- [ ] **Step 5: Commit file import support**

Run:

```bash
git add docs/index.html tests/convert-session.test.js
git commit -m "feat: support txt multi json imports"
```

## Task 3: Format-Aware Output Builder And Preview

**Files:**
- Modify: `tests/convert-session.test.js`
- Modify: `docs/index.html`

- [ ] **Step 1: Write the failing preview test**

In `tests/convert-session.test.js`, add this test after `testTxtFileImportParsesMultipleJsonDocuments`:

```js
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
```

Call it in `run()` after the `.txt` import test:

```js
testMultiFormatPreviewListsEveryOutputFormat();
```

- [ ] **Step 2: Run the preview test to verify RED**

Run:

```bash
node tests/convert-session.test.js
```

Expected: FAIL because `#format-preview` is empty and no preview renderer exists.

- [ ] **Step 3: Add preview HTML and CSS**

In `docs/index.html`, add this after the summary block and before the accounts table:

```html
<div class="format-preview" id="format-preview" aria-label="多格式预览">
  <div class="empty">输入账号后可预览全部格式。</div>
</div>
```

Add this CSS near `.summary` and `.accounts`:

```css
.format-preview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.preview-option {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.preview-option:hover {
  border-color: var(--line-strong);
  background: var(--surface-soft);
}

.preview-option[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.preview-name {
  display: block;
  font-weight: 800;
}

.preview-meta {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}
```

In the `@media (max-width: 620px)` block, add:

```css
.format-preview {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 4: Add format-aware output helpers and preview rendering**

In `docs/index.html`, add `OUTPUT_FORMATS` before `OUTPUT_LABELS`:

```js
const OUTPUT_FORMATS = ["sub2api", "cpa", "cockpit", "9router", "axonhub", "codexmanager"];
```

Add `formatPreview` to `elements`:

```js
formatPreview: document.querySelector("#format-preview"),
```

Replace `buildOutputDocument()` with:

```js
function buildOutputDocumentForFormat(format, converted = state.converted, now = new Date()) {
  if (format === "sub2api") {
    return buildSub2apiDocument(converted, now);
  }

  const isSingle = converted.length === 1;
  const byFormat = {
    cpa: (item) => item.cpa,
    cockpit: (item) => item.cockpit,
    "9router": (item) => item.nineRouter,
    axonhub: (item) => item.axonHub,
    codexmanager: (item) => item.codexManager,
  };
  const pick = byFormat[format] || byFormat.sub2api;

  if (!pick) {
    return buildSub2apiDocument(converted, now);
  }

  return isSingle ? pick(converted[0]) : converted.map((item) => pick(item));
}

function buildOutputTextForFormat(format, converted = state.converted, now = new Date()) {
  return JSON.stringify(buildOutputDocumentForFormat(format, converted, now), null, 2);
}

function buildOutputDocument() {
  return buildOutputDocumentForFormat(state.format, state.converted, new Date());
}
```

Add:

```js
function formatBytes(size) {
  if (size < 1024) {
    return `${size} B`;
  }
  return `${(size / 1024).toFixed(1)} KB`;
}

function setFormat(format) {
  state.format = OUTPUT_FORMATS.includes(format) ? format : "sub2api";
  elements.formatButtons.forEach((item) => {
    item.setAttribute("aria-pressed", String(item.dataset.format === state.format));
  });
  updateOutput();
}

function renderFormatPreview() {
  if (!state.converted.length) {
    elements.formatPreview.innerHTML = '<div class="empty">输入账号后可预览全部格式。</div>';
    return;
  }

  const now = new Date();
  elements.formatPreview.innerHTML = OUTPUT_FORMATS.map((format) => {
    const text = buildOutputTextForFormat(format, state.converted, now);
    return `
      <button class="preview-option" type="button" data-preview-format="${format}" aria-pressed="${format === state.format}">
        <span class="preview-name">${escapeHtml(OUTPUT_LABELS[format])}</span>
        <span class="preview-meta">${state.converted.length} accounts · ${formatBytes(text.length)}</span>
      </button>
    `;
  }).join("");
}
```

Call `renderFormatPreview();` inside `updateOutput()` after `renderIssues();`.

Replace the existing format button click handler body with:

```js
button.addEventListener("click", () => {
  setFormat(button.dataset.format);
});
```

Add a preview click handler before `updateOutput();`:

```js
elements.formatPreview.addEventListener("click", (event) => {
  const target = event.target.closest?.("[data-preview-format]");
  if (target?.dataset.previewFormat) {
    setFormat(target.dataset.previewFormat);
  }
});
```

- [ ] **Step 5: Run the preview test to verify GREEN**

Run:

```bash
node tests/convert-session.test.js
```

Expected: PASS with `convert-session tests passed`.

- [ ] **Step 6: Commit preview support**

Run:

```bash
git add docs/index.html tests/convert-session.test.js
git commit -m "feat: preview all output formats"
```

## Task 4: Export All Formats To Directory Or Downloads

**Files:**
- Modify: `tests/convert-session.test.js`
- Modify: `docs/index.html`

- [ ] **Step 1: Expand the fake runtime for export tests**

In `tests/convert-session.test.js`, change `loadPageScript()` to accept options and track downloads:

```js
function loadPageScript(options = {}) {
```

Inside `loadPageScript`, after `formatButtons`, add:

```js
const downloads = [];
```

Replace `document.createElement(selector)` with:

```js
createElement(selector) {
  const element = createFakeElement(selector);
  if (selector === "a") {
    element.click = function clickAnchor() {
      downloads.push({
        download: this.download,
        href: this.href,
      });
    };
  }
  return element;
},
```

Add `Blob` and option globals to `context`:

```js
Blob,
...options.globals,
```

After the `context` object is created, add:

```js
context.window = context;
```

Return downloads:

```js
return { elements, formatButtons, downloads };
```

- [ ] **Step 2: Write failing export-all tests**

Add these tests after `testMultiFormatPreviewListsEveryOutputFormat`:

```js
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
```

Call them in `run()` after the preview test:

```js
await testExportAllWritesEveryFormatToChosenDirectory();
await testExportAllFallsBackToDownloadsWithoutDirectoryPicker();
```

- [ ] **Step 3: Run export-all tests to verify RED**

Run:

```bash
node tests/convert-session.test.js
```

Expected: FAIL because `#export-all-output` has no click handler and export helpers do not exist.

- [ ] **Step 4: Add export-all HTML**

In `docs/index.html`, add the button between copy and single download:

```html
<button class="button button-secondary" id="export-all-output" type="button" disabled>导出全部格式</button>
```

Add `exportAllOutput` to `elements`:

```js
exportAllOutput: document.querySelector("#export-all-output"),
```

In `updateOutput()`, add:

```js
elements.exportAllOutput.disabled = !hasConverted;
```

- [ ] **Step 5: Add shared download/export helpers**

In `docs/index.html`, change `getTimestampToken()` to accept a date:

```js
function getTimestampToken(date = new Date()) {
```

Add these helpers before `downloadOutput()`:

```js
function getOutputFileBase() {
  const first = state.converted[0];
  return sanitizeFileToken(first?.email || first?.name || "accounts");
}

function buildOutputFile(format, now = new Date()) {
  const base = getOutputFileBase();
  const text = buildOutputTextForFormat(format, state.converted, now);
  return {
    format,
    fileName: `${base}.${format}.${getTimestampToken(now)}.json`,
    text,
  };
}

function buildAllOutputFiles(now = new Date()) {
  return OUTPUT_FORMATS.map((format) => buildOutputFile(format, now));
}

function downloadJsonFile(fileName, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

Replace `downloadOutput()` with:

```js
function downloadOutput() {
  if (!state.outputText) {
    return;
  }

  const file = buildOutputFile(state.format);
  downloadJsonFile(file.fileName, file.text);
}
```

Add:

```js
async function writeFilesToDirectory(files, directoryHandle) {
  for (const file of files) {
    const fileHandle = await directoryHandle.getFileHandle(file.fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file.text);
    await writable.close();
  }
}

async function exportAllOutput() {
  if (!state.converted.length) {
    return;
  }

  const files = buildAllOutputFiles(new Date());
  try {
    if (window.showDirectoryPicker) {
      const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      await writeFilesToDirectory(files, directoryHandle);
      setStatus(elements.outputStatus, `已导出 ${files.length} 个 JSON 文件到所选目录。`, "ok");
      return;
    }

    files.forEach((file) => downloadJsonFile(file.fileName, file.text));
    setStatus(elements.outputStatus, `当前浏览器不支持目录写入，已改为下载 ${files.length} 个 JSON 文件。`, "ok");
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus(elements.outputStatus, "已取消导出。");
      return;
    }
    setStatus(elements.outputStatus, error instanceof Error ? error.message : "导出失败", "error");
  }
}
```

Add the event listener:

```js
elements.exportAllOutput.addEventListener("click", exportAllOutput);
```

- [ ] **Step 6: Run export-all tests to verify GREEN**

Run:

```bash
node tests/convert-session.test.js
```

Expected: PASS with `convert-session tests passed`.

- [ ] **Step 7: Commit export-all support**

Run:

```bash
git add docs/index.html tests/convert-session.test.js
git commit -m "feat: export all output formats"
```

## Task 5: Final Verification And Browser Check

**Files:**
- Verify: `docs/index.html`
- Verify: `tests/convert-session.test.js`

- [ ] **Step 1: Run the full automated test suite**

Run:

```bash
node tests/convert-session.test.js
```

Expected: PASS with `convert-session tests passed`.

- [ ] **Step 2: Verify the real sample multi-document file**

Run:

```bash
node tests/convert-session.test.js
```

Expected: PASS. The automated pasted/file tests cover the same multi-document structure as `gpt-free-account.txt`; do not commit `gpt-free-account.txt` because it is user-provided sample data and currently untracked.

- [ ] **Step 3: Open the static page in a browser**

Open:

```text
D:\Tools\GPTSession2CPAandSub2API\docs\index.html
```

Manual checks:

- Paste the contents of `gpt-free-account.txt`; the account count should match the number of valid session objects.
- Click each format preview row; the output textarea should switch formats.
- Click `导出全部格式`; choose a directory; six JSON files should appear directly in that selected directory.
- Use the file picker with `gpt-free-account.txt`; it should import the same accounts.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: only intentionally untracked user sample files remain, such as `gpt-free-account.txt`, unless the user asks to include them.


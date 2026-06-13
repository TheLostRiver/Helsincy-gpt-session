# Mode Switch CPA To sub2api Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level `Session 转换 / 格式互转` mode switch and implement a focused CPA JSON to sub2api workflow.

**Architecture:** Keep the app as one static page. Add `state.mode`, mode-specific UI rendering, and a CPA-only filter before conversion in `格式互转` mode while reusing the existing multi-document parser, `convertSession`, and `buildSub2apiDocument`.

**Tech Stack:** Static HTML/CSS/vanilla JavaScript in `docs/index.html`, Node.js `node:vm` regression tests in `tests/convert-session.test.js`.

---

## File Structure

- Modify `docs/index.html`
  - HTML: add a top-level mode switch with `data-mode` buttons.
  - CSS: add mode switch styling and mode-specific visibility helpers.
  - JavaScript: add `state.mode`, mode button wiring, CPA detection/filtering, format-mode output behavior, and mode-specific status/copy.
- Modify `tests/convert-session.test.js`
  - Add fake mode buttons to the test DOM.
  - Add helpers for CPA fixtures.
  - Add mode-switch, CPA conversion, non-CPA skip, file import, and mode restore tests.

## Task 1: Add Mode Switch UI State

**Files:**
- Modify: `tests/convert-session.test.js`
- Modify: `docs/index.html`

- [ ] **Step 1: Write failing tests for switching UI mode**

In `tests/convert-session.test.js`, update `loadPageScript()` so it creates fake mode buttons next to `formatButtons`:

```js
const modeButtons = ["session", "format"].map((mode) =>
  createFakeElement(`[data-mode="${mode}"]`, { dataset: { mode } })
);
```

Update `querySelectorAll(selector)`:

```js
querySelectorAll(selector) {
  if (selector === "[data-format]") {
    return formatButtons;
  }
  if (selector === "[data-mode]") {
    return modeButtons;
  }
  return [];
},
```

Update the return value:

```js
return { elements, formatButtons, modeButtons, downloads };
```

Add this test after `testMultiFormatPreviewClickSwitchesOutputFormat`:

```js
function testFormatModeHidesMultiFormatControlsAndFixesSub2api() {
  const { elements, modeButtons } = loadPageScript();
  const formatButton = modeButtons.find((button) => button.dataset.mode === "format");
  const toolbar = elements.get("#format-toolbar");
  const preview = elements.get("#format-preview");
  const exportAll = elements.get("#export-all-output");
  const inputTitle = elements.get("#input-title");
  const outputTitle = elements.get("#output-title");
  const statFormat = elements.get("#stat-format");

  dispatch(formatButton, "click");

  assert.equal(toolbar.classList.contains("hidden"), true);
  assert.equal(preview.classList.contains("hidden"), true);
  assert.equal(exportAll.classList.contains("hidden"), true);
  assert.equal(inputTitle.textContent, "CPA JSON");
  assert.equal(outputTitle.textContent, "sub2api JSON");
  assert.equal(statFormat.textContent, "目标格式 sub2api");
}
```

Add this test call in `run()` after `testMultiFormatPreviewClickSwitchesOutputFormat();`:

```js
testFormatModeHidesMultiFormatControlsAndFixesSub2api();
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node tests/convert-session.test.js
```

Expected: FAIL because `[data-mode]`, `#format-toolbar`, and mode-specific UI behavior do not exist yet.

- [ ] **Step 3: Add mode switch markup and element IDs**

In `docs/index.html`, add this block after the header and before `<section class="toolbar" aria-label="输出控制">`:

```html
<section class="mode-switch" aria-label="任务模式">
  <button type="button" data-mode="session" aria-pressed="true">Session 转换</button>
  <button type="button" data-mode="format" aria-pressed="false">格式互转</button>
</section>
```

Change the existing toolbar opening tag:

```html
<section class="toolbar" id="format-toolbar" aria-label="输出控制">
```

Add an id to the input-panel subtitle paragraph:

```html
<p id="input-subtitle">粘贴 ChatGPT Web session，或拖入一个或多个 JSON/TXT 文件。</p>
```

- [ ] **Step 4: Add mode switch CSS**

In `docs/index.html`, add this CSS near `.toolbar`:

```css
.mode-switch {
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  width: min(420px, 100%);
  gap: 4px;
  padding: 4px;
  margin-bottom: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.mode-switch button {
  min-height: 38px;
  min-width: 0;
  padding: 0 12px;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-weight: 800;
}

.mode-switch button[aria-pressed="true"] {
  background: var(--accent);
  color: #fff;
}
```

- [ ] **Step 5: Add mode state, elements, and UI rendering**

In `docs/index.html`, update `state`:

```js
const state = {
  mode: "session",
  format: "sub2api",
  sessions: [],
  converted: [],
  skipped: [],
  outputText: "",
};
```

Add these entries to `elements`:

```js
formatToolbar: document.querySelector("#format-toolbar"),
inputSubtitle: document.querySelector("#input-subtitle"),
modeButtons: Array.from(document.querySelectorAll("[data-mode]")),
```

Add these helpers before `updateOutput()`:

```js
function isFormatMode() {
  return state.mode === "format";
}

function setMode(mode) {
  state.mode = mode === "format" ? "format" : "session";
  if (isFormatMode()) {
    state.format = "sub2api";
  }
  elements.modeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
  });
  elements.formatButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.format === state.format));
  });
  scheduleConvert();
}

function updateModeUi() {
  elements.formatToolbar.classList.toggle("hidden", isFormatMode());
  elements.formatPreview.classList.toggle("hidden", isFormatMode());
  elements.exportAllOutput.classList.toggle("hidden", isFormatMode());
  elements.inputTitle.textContent = isFormatMode() ? "CPA JSON" : "Session JSON";
  elements.inputSubtitle.textContent = isFormatMode()
    ? "粘贴 CPA JSON，或拖入一个或多个 CPA JSON/TXT 文件。"
    : "粘贴 ChatGPT Web session，或拖入一个或多个 JSON/TXT 文件。";
  elements.outputTitle.textContent = isFormatMode() ? "sub2api JSON" : "转换结果";
}
```

Add `inputTitle` and `outputTitle` to `elements`:

```js
inputTitle: document.querySelector("#input-title"),
outputTitle: document.querySelector("#output-title"),
```

In `updateOutput()`, call `updateModeUi();` before setting subtitles/stats, and change the stat format assignment:

```js
elements.statFormat.textContent = isFormatMode() ? "目标格式 sub2api" : OUTPUT_LABELS[state.format];
```

Change output subtitle assignment:

```js
elements.outputSubtitle.textContent = isFormatMode()
  ? "当前输出固定为 sub2api 导入 JSON。"
  : `当前输出为 ${OUTPUT_LABELS[state.format]} 导入 JSON。`;
```

Change CPA notice visibility:

```js
elements.cpaNotice.style.display = !isFormatMode() && ["cpa", "cockpit", "axonhub", "codexmanager"].includes(state.format) ? "block" : "none";
```

Change export-all disabled state:

```js
elements.exportAllOutput.disabled = isFormatMode() || !hasConverted;
```

Register mode button listeners before `updateOutput();`:

```js
elements.modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
  });
});
```

- [ ] **Step 6: Run the test to verify GREEN**

Run:

```bash
node tests/convert-session.test.js
```

Expected: PASS with `convert-session tests passed`.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add docs/index.html tests/convert-session.test.js
git -c user.name="Codex" -c user.email="codex@local" commit -m "feat: add converter mode switch"
```

## Task 2: CPA-Only Pasted Conversion Mode

**Files:**
- Modify: `tests/convert-session.test.js`
- Modify: `docs/index.html`

- [ ] **Step 1: Add CPA fixture helper and failing pasted tests**

In `tests/convert-session.test.js`, add this helper after `createSession`:

```js
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
```

Add these tests after `testFormatModeHidesMultiFormatControlsAndFixesSub2api`:

```js
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

  input.value = JSON.stringify(createSession("session@example.com", "session-account"));
  dispatch(input, "input");

  assert.equal(output.value, "");
  assert.match(inputStatus.textContent, /当前模式只支持 CPA JSON/);
  assert.match(inputStatus.textContent, /可切回 Session 转换模式/);
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
```

Call these tests in `run()` after `testFormatModeHidesMultiFormatControlsAndFixesSub2api();`:

```js
testSingleCpaConvertsToSub2apiInFormatMode();
testMultiplePastedCpaDocumentsConvertToSub2apiInFormatMode();
testNonCpaSessionIsSkippedInFormatMode();
testMixedCpaAndSessionInputConvertsCpaAndReportsSkipped();
```

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
node tests/convert-session.test.js
```

Expected: FAIL because format mode does not yet apply CPA-only filtering or friendly non-CPA status.

- [ ] **Step 3: Add CPA detection and mode-specific source preparation**

In `docs/index.html`, add these helpers after `parseInputDocuments`:

```js
function isCpaLikeRecord(record) {
  if (!isPlainObject(record)) {
    return false;
  }

  const accessToken = firstNonEmpty(
    record.access_token,
    record.accessToken,
    record.tokens?.access_token,
    record.tokens?.accessToken,
    record.credentials?.access_token,
  );
  const cpaMarker = record.type === "codex" || Boolean(firstNonEmpty(
    record.account_id,
    record.chatgpt_account_id,
    record.id_token,
    record.refresh_token,
    record.session_token,
    record.plan_type,
    record.chatgpt_plan_type,
  ));
  const identity = firstNonEmpty(
    record.account_id,
    record.accountId,
    record.chatgpt_account_id,
    record.chatgptAccountId,
    record.credentials?.chatgpt_account_id,
    record.email,
    record.name,
    record.credentials?.email,
  );

  return Boolean(cpaMarker && accessToken && identity);
}

function getFormatModeSkipReason(record) {
  if (isPlainObject(record) && firstNonEmpty(record.accessToken, record.tokens?.access_token, record.providerSpecificData?.chatgptAccountId)) {
    return "当前模式只支持 CPA JSON，可切回 Session 转换模式处理其他输入。";
  }
  return "当前模式只支持 CPA JSON";
}

function prepareSourcesForMode(sources) {
  if (!isFormatMode()) {
    return { convertible: sources, skipped: [] };
  }

  const convertible = [];
  const skipped = [];

  sources.forEach((item) => {
    if (isCpaLikeRecord(item.value)) {
      convertible.push(item);
      return;
    }

    skipped.push({
      sourceName: item.sourceName,
      path: item.path,
      reason: getFormatModeSkipReason(item.value),
    });
  });

  return { convertible, skipped };
}
```

- [ ] **Step 4: Update output building for format mode**

In `buildOutputDocument()`, replace the function body with:

```js
function buildOutputDocument() {
  return isFormatMode()
    ? buildSub2apiDocument(state.converted, new Date())
    : buildOutputDocumentForFormat(state.format, state.converted, new Date());
}
```

In `renderFormatPreview()`, keep format preview hidden in format mode:

```js
if (isFormatMode() || !state.converted.length) {
  elements.formatPreview.innerHTML = '<div class="empty">输入账号后可预览全部格式。</div>';
  return;
}
```

- [ ] **Step 5: Update `convertFromText` for CPA-only mode**

Replace the start of `convertFromText(text)` down through `sources.forEach` with:

```js
function convertFromText(text) {
  const sources = parseInputDocuments(text);
  const prepared = prepareSourcesForMode(sources);
  const converted = [];
  const skipped = [...prepared.skipped];
  const now = new Date();

  prepared.convertible.forEach((item, index) => {
    try {
      converted.push(convertSession(item.value, {
        now,
        sourceName: item.sourceName,
        sourcePath: item.path || `$[${index}]`,
      }));
    } catch (error) {
      skipped.push({
        sourceName: item.sourceName,
        path: item.path,
        reason: error instanceof Error ? error.message : "无法转换",
      });
    }
  });
```

Replace the existing empty-source block with this complete block:

```js
if (!sources.length) {
  skipped.push({
    sourceName: "pasted-json",
    path: "$",
    reason: isFormatMode()
      ? "当前模式只支持 CPA JSON，未找到可互转的 CPA 账号。"
      : "未找到包含 accessToken 和 user/email 的 session 对象",
  });
}
```

After that block, add:

```js
if (isFormatMode() && sources.length && !converted.length && !skipped.some((item) => item.reason.includes("未找到可互转"))) {
  skipped.push({
    sourceName: "pasted-json",
    path: "$",
    reason: "当前模式只支持 CPA JSON，未找到可互转的 CPA 账号。可切回 Session 转换模式处理其他输入。",
  });
}
```

- [ ] **Step 6: Update `scheduleConvert` status copy**

In `scheduleConvert()`, replace the `else` branch that sets `"没有可转换账号。"` with:

```js
setStatus(
  elements.inputStatus,
  isFormatMode()
    ? "当前模式只支持 CPA JSON，未找到可互转的 CPA 账号。可切回 Session 转换模式处理其他输入。"
    : "没有可转换账号。",
  "error"
);
```

- [ ] **Step 7: Run the tests to verify GREEN**

Run:

```bash
node tests/convert-session.test.js
```

Expected: PASS with `convert-session tests passed`.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add docs/index.html tests/convert-session.test.js
git -c user.name="Codex" -c user.email="codex@local" commit -m "feat: convert cpa to sub2api in format mode"
```

## Task 3: CPA File Import And Mode Restore

**Files:**
- Modify: `tests/convert-session.test.js`
- Modify: `docs/index.html`

- [ ] **Step 1: Write failing file import and restore tests**

Add these tests after `testMixedCpaAndSessionInputConvertsCpaAndReportsSkipped`:

```js
async function testTxtCpaFileImportUsesFormatModeFilter() {
  const { elements, modeButtons } = loadPageScript();
  switchToFormatMode(elements, modeButtons);
  const fileInput = elements.get("#file-input");
  const output = elements.get("#output");

  const text = [
    JSON.stringify(createCpa("file-cpa-a@example.com", "file-cpa-a")),
    JSON.stringify(createCpa("file-cpa-b@example.com", "file-cpa-b")),
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
  assert.equal(document.accounts.length, 2);
  assert.equal(document.accounts[0].credentials.email, "file-cpa-a@example.com");
  assert.equal(document.accounts[1].credentials.email, "file-cpa-b@example.com");
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
```

Call these in `run()` after the mixed CPA test:

```js
await testTxtCpaFileImportUsesFormatModeFilter();
testSwitchingBackToSessionModeRestoresMultiFormatUi();
```

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
node tests/convert-session.test.js
```

Expected: FAIL if file import still converts non-mode-filtered sources or if mode restore does not update hidden controls.

- [ ] **Step 3: Update `readFiles` to use mode-specific source preparation**

In `readFiles(files)`, replace:

```js
const now = new Date();
const converted = [];
const convertSkipped = [...skipped];
documents.forEach((item) => {
```

with:

```js
const prepared = prepareSourcesForMode(documents);
const now = new Date();
const converted = [];
const convertSkipped = [...skipped, ...prepared.skipped];
prepared.convertible.forEach((item) => {
```

In the status after file read, replace the message with:

```js
const statusText = converted.length
  ? `读取 ${supportedFiles.length} 个文件，生成 ${converted.length} 个账号，跳过 ${convertSkipped.length} 项。`
  : isFormatMode()
    ? `读取 ${supportedFiles.length} 个文件，当前模式只支持 CPA JSON，未找到可互转的 CPA 账号。`
    : `读取 ${supportedFiles.length} 个文件，生成 ${converted.length} 个账号，跳过 ${convertSkipped.length} 项。`;
setStatus(elements.inputStatus, statusText, converted.length ? "ok" : "error");
```

- [ ] **Step 4: Ensure mode restore reruns conversion safely**

In `setMode(mode)`, update the end of the function so UI visibility changes immediately before conversion reruns:

```js
updateModeUi();
scheduleConvert();
```

- [ ] **Step 5: Run the tests to verify GREEN**

Run:

```bash
node tests/convert-session.test.js
```

Expected: PASS with `convert-session tests passed`.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add docs/index.html tests/convert-session.test.js
git -c user.name="Codex" -c user.email="codex@local" commit -m "feat: filter cpa file imports by mode"
```

## Task 4: Final Verification

**Files:**
- Verify: `docs/index.html`
- Verify: `tests/convert-session.test.js`

- [ ] **Step 1: Run automated tests**

Run:

```bash
node tests/convert-session.test.js
```

Expected: PASS with `convert-session tests passed`.

- [ ] **Step 2: Run patch hygiene check**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 3: Verify existing sample behavior still works**

Run the existing VM sample check pattern against `gpt-free-account.txt`:

```bash
node tests/convert-session.test.js
```

Expected: PASS. Do not commit `gpt-free-account.txt`; it remains user-provided sample data.

- [ ] **Step 4: Browser check**

Start a local service for the browser check:

```bash
python -m http.server 8765 --bind 127.0.0.1 --directory docs
```

Manual checks in the browser:

- `Session 转换` is selected by default.
- Existing multi-format preview and `导出全部格式` still appear in `Session 转换`.
- Switch to `格式互转`; six-format controls disappear.
- Paste a CPA object; output is sub2api with one account.
- Paste a non-CPA session object; output is empty and the friendly CPA-only status appears.
- Switch back to `Session 转换`; multi-format controls return.

- [ ] **Step 5: Check final git status**

Run:

```bash
git status --short --branch
```

Expected: only intentionally untracked user sample files remain, such as `gpt-free-account.txt`.

# Mode Switch CPA To sub2api Design

## Goal

Add a task-level mode switch to keep the existing Session conversion workflow clean while introducing a focused CPA-to-sub2api conversion workflow.

## Background

The current page now supports multi-account pasted input, `.json` and `.txt` imports, previews for all existing output formats, and export-all. Adding CPA-to-sub2api directly into the same visible workflow would make the page harder to understand because it mixes two different jobs:

- Converting ChatGPT session or OAuth-style auth data into multiple target formats.
- Converting one existing target format into another target format.

The new feature should make that distinction explicit without duplicating the whole app in another HTML page.

## Recommended UX

Add a top-level mode switch below the title area:

- `Session 转换`
- `格式互转`

`Session 转换` remains the default mode and preserves the current experience:

- Paste or import ChatGPT session/OAuth-style JSON.
- Convert to CPA, sub2api, Cockpit, 9router, AxonHub, and Codex-Manager.
- Preview all formats.
- Copy, download current format, and export all formats.

`格式互转` is a focused CPA-to-sub2api workspace:

- Input panel title: `CPA JSON`
- Output panel title: `sub2api JSON`
- Target format is fixed to `sub2api`.
- No six-format segmented control.
- No all-format preview cards.
- No `导出全部格式` button.
- Keep `选择文件`, `复制输出`, `下载 JSON`, and `清空`.

## Input Rules

The `格式互转` mode supports:

- One CPA JSON object.
- A CPA JSON array.
- Multiple complete CPA JSON objects pasted sequentially.
- `.json` and `.txt` files containing any of the above.

The first version only accepts CPA-like records as valid input for this mode. A CPA-like record must have enough of the CPA shape to be unambiguous:

- `type: "codex"` when present.
- An access token from `access_token` or `accessToken`.
- A usable account identity from `account_id`, `chatgpt_account_id`, `email`, `name`, or token claims.

Records that are not CPA-like are skipped in this mode.

## Non-CPA Handling

If mixed input contains valid CPA records and other JSON records:

- Convert the CPA records.
- Add non-CPA records to the skipped list.
- Show the number of converted accounts and skipped items.

If no CPA records are found:

- Produce no output.
- Show a friendly error status: `当前模式只支持 CPA JSON，未找到可互转的 CPA 账号。`
- If the skipped input looks like a ChatGPT session, 9router, AxonHub, or Codex-Manager record, include a hint: `可切回 Session 转换模式处理其他输入。`

The page should not silently treat non-CPA data as CPA in `格式互转` mode.

## Data Flow

Reuse the existing document parser for both modes:

1. Parse the text or file contents into one or more JSON documents.
2. Traverse those documents for candidate account-like objects.
3. Apply a mode-specific filter:
   - `Session 转换`: use the existing broad session/account converter behavior.
   - `格式互转`: keep only CPA-like records.
4. Convert valid records through the existing `convertSession(record, options)` normalizer.
5. Build output:
   - `Session 转换`: selected output format as today.
   - `格式互转`: always `buildSub2apiDocument(converted, now)`.

This keeps CPA-to-sub2api small while preserving future extensibility. Later versions can add a source/target registry without replacing the UI structure.

## State Model

Add one new state field:

```js
mode: "session" | "format"
```

When the mode changes:

- Keep the input text.
- Re-run conversion with the new mode filter.
- Reset the selected format to `sub2api` when entering `格式互转`.
- Hide controls that do not apply in the active mode.

## UI Details

The mode switch should be visually separate from the existing output-format segmented control. The existing output-format control remains visible only in `Session 转换` mode.

In `格式互转` mode:

- The status/stat label should make clear the output is fixed: `目标格式 sub2api`.
- The account preview table can remain because it helps confirm which CPA accounts were found.
- The issues panel remains and lists skipped non-CPA records.
- The output textarea remains the detailed JSON preview.

## Testing

Add tests for:

- Switching to `格式互转` hides all-format controls and keeps the output fixed to sub2api.
- A single CPA JSON object converts to a sub2api document.
- A CPA array converts to multiple sub2api accounts.
- Multiple pasted CPA JSON objects convert to multiple sub2api accounts.
- `.txt` file import in `格式互转` uses the same CPA-only parser.
- Non-CPA session JSON is skipped in `格式互转` with no output and a friendly status.
- Mixed CPA and non-CPA input converts CPA records and reports skipped records.
- Switching back to `Session 转换` restores existing multi-format previews and export-all controls.


# Multi JSON Import And Export All Formats Design

## Goal

Allow the static web tool to handle pasted or uploaded multi-account input, preview every supported output format, and export every output format to a user-selected local directory.

## Current Behavior

The page already converts a single ChatGPT session JSON object and can traverse arrays or nested JSON documents after a successful `JSON.parse`. The weak point is the first parsing step: text like `gpt-free-account.txt`, where multiple complete JSON objects are pasted one after another, fails because the entire text is not one valid JSON document.

The file picker currently accepts only `.json` files and reads each selected file as one JSON document. That means `.txt` files and multi-document text files are not handled consistently with pasted input.

The output area previews only the currently selected format. Existing format buttons rebuild output from the converted account state, so the implementation can extend this pattern without re-parsing input.

## Requirements

- Pasted text must support:
  - One JSON object.
  - One JSON array.
  - Nested JSON structures containing session-like objects.
  - Multiple complete JSON objects pasted sequentially, separated by whitespace or newlines.
- File import must support `.json` and `.txt` files.
- File import must parse each file with the same multi-document parser used by pasted input.
- Users must be able to preview every supported output format after entering input.
- The existing selected-format output textarea remains available for detailed copy/download workflows.
- A new button exports all supported formats in one action.
- Export-all must ask the user to choose a directory, then write JSON files directly into that chosen directory.
- The web page should not create an `ExportData` folder automatically.
- If the browser does not support direct directory writing, export-all should fall back to downloading each JSON file.

## UX Design

Add an action button near the existing output actions:

- `导出全部格式`

When clicked:

1. If no accounts have been converted, keep the button disabled.
2. If `window.showDirectoryPicker` is available, show the browser directory chooser.
3. After the user selects a directory, write one file per format directly into that directory.
4. If the browser blocks or lacks directory writing support, trigger one download per format instead.
5. Show a status message with the number of exported files.

Add a multi-format preview block under the account summary or above the output textarea:

- One compact row per format.
- Each row shows the format label and a short summary such as account count and output size.
- Clicking a preview row switches the selected format and updates the existing output textarea.

This keeps the page compact and avoids duplicating six large JSON textareas.

## Data Flow

Use one parser for both pasted text and file contents:

1. Try parsing the entire text as one JSON document.
2. If that fails, scan the text with `JSON.parse` plus offset tracking to extract multiple consecutive JSON documents.
3. Run each parsed document through the existing `collectSessionLikeObjects` traversal.
4. Convert each found account with the existing `convertSession` function.

Build output documents through one new helper:

```js
function buildOutputDocumentForFormat(format, converted, now) {
  // Mirrors current buildOutputDocument behavior without depending on state.format.
}
```

The current `buildOutputDocument()` becomes a thin wrapper around this helper.

Export-all uses the helper for every format, ensuring preview, single-format download, and bulk export share identical JSON content.

## Error Handling

- Invalid single JSON input should still show a useful parse error.
- Multi-document parsing should report the character offset of malformed trailing text.
- Files without any session-like object should be skipped with the current issues list.
- If one uploaded file fails, other valid files should still convert.
- If directory export fails after the user chooses a directory, show the browser error message and do not clear current output.

## Testing

Add regression tests in `tests/convert-session.test.js` for:

- Pasted text containing two sequential JSON objects converts two accounts.
- Pasted text containing JSON objects separated by blank lines converts all accounts.
- File import accepts `.txt` and uses the same multi-document parser.
- Export-all builds one JSON payload for each supported format.
- Current single JSON and JSON array behavior remains unchanged.


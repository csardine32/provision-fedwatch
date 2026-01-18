# Active Task: Improve Attachment Content Analysis

The immediate focus is to resolve the issue where the AI does not appear to be "seeing" the content of downloaded attachments, even when attachment links are present. The AI's analysis in the Slack alerts suggests it's working with empty attachment text, leading it to incorrectly report that documents are missing.

## Next Steps

1.  **Verify Attachment Content**: Add detailed logging in `bot/runner.js` to print the `attachmentText` variable immediately before it is passed to the `scoreWithAi` function. This will confirm whether text is being successfully extracted from PDF and TXT files.
2.  **Analyze Fixture Data**: Manually inspect the `sam.json` fixture file to confirm the file types of the attachments being linked. This will verify if they are of a supported type (PDF, TXT) or an unsupported type that the bot is correctly skipping.
3.  **Refine AI Prompt**: If text *is* being extracted, the AI prompt may need to be refined to more strongly encourage the AI to summarize the provided attachment text in the `attachment_summary` field.
4.  **Expand File Type Support**: Investigate adding support for more file types (e.g., `.doc`, `.docx`) by checking for and potentially installing other command-line text extraction tools.

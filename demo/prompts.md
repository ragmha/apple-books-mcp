# Demo prompts

These prompts are client-agnostic. The IDs and content are sanitized sample
values from `demo/script.ts`; replace them with real IDs from your own library
when trying the server locally.

## Read flow

```text
Use the apple-books MCP server to list the first 5 books in my library. Show
title, author, assetId, and annotation count.
```

```text
Search my highlighted text for "resilient defaults". Group matches by book and
include the highlight color.
```

```text
Export annotations as Markdown for asset-designing-calm-systems. Include the
book title and group highlights by color.
```

## Write flow

```text
Create a collection named "Demo Reading Queue". Before you call the tool,
explain the safety steps the server runs for writes.
```

```text
Add asset-sqlite-field-guide to collection-demo-reading-queue, then remove it
again after confirming the result. Show the backup path returned by each write.
```

```text
Update annotation ann-durable-001 with this note: "Use this quote in the
architecture README." Then list the changed annotation.
```

```text
Delete annotation ann-durable-003. Treat it as a soft delete and show the
operation result.
```

## Recovery flow

```text
List available Apple Books Library backups, newest first, and explain how I
would restore one if I chose the wrong collection edit.
```

```text
Restore the Library from backup handle
/Users/demo/Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary/BKLibrary.sqlite.backup-20260513T091500Z.
Summarize the pre-restore safety snapshot result.
```

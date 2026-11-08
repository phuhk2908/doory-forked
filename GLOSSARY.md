# Doory glossary

These terms describe the whiteboard room access model. They are intentionally independent of the
implementation names used by Django or the MCP adapter.

| Term | Meaning |
| --- | --- |
| Whiteboard | A drawable document and its editing state. It can be an account-owned `Drawing` or a shareable room. |
| Guest room | A shareable whiteboard room that can be opened without a Doory account. Its browser access comes from a capability link. |
| Account-owned room | A guest-capable room that also has an authenticated Doory account responsible for its lifecycle. |
| Account owner | The authenticated Doory user whose identity authorizes account-owned room management. |
| Guest capability | A high-entropy browser credential that grants one room permission, such as edit, view, or browser owner actions. |
| MCP credential | A personal access token that identifies an account and carries explicit tool scopes. It is never a guest capability. |
| Owner capability | The browser-only guest capability used by the existing room UI for rename, close, and link rotation. It is not the account owner. |

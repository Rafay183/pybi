# Security Policy

## Supported versions

Only the latest release on PyPI (`pybi-ray`) receives security fixes.

## How PyBI protects you

* The studio listens on your network so others can open the **read-only** `/view` link. All editing and data APIs are restricted to the local computer. Start with `pybi run --private` to disable network access entirely.
* Connector passwords and tokens are stored only in `~/.pybi/credentials.json` on your computer — never inside `.pybi` project files or exported HTML.
* The *Python script* connector and the query editor's *custom column* step run code. Only open `.pybi` files from people you trust.
* Exported HTML files contain the report's data. Share them like you would share the underlying spreadsheet.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's **Security → Report a vulnerability** (private advisory) on https://github.com/rafay183/pybi. You'll get a response as soon as possible, and credit in the release notes if you wish.

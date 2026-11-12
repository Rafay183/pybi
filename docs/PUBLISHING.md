# Publishing PyBI to GitHub and PyPI — step by step

This guide takes you from the zip file to `pip install pybi-ray` working for everyone, with the repository open for contributors. Follow the parts in order. Commands are for **Windows (Command Prompt / PowerShell)**; they work the same on macOS/Linux.

| Name | Value |
|---|---|
| GitHub repo | `rafay183/pybi` |
| PyPI package (install name) | `pybi-ray` |
| Command users type | `pybi` |
| Python import | `import pybi` |
| First version | `0.1.0` (tag `v0.1.0`) |

---

## Part 0 — Clean up the old attempt (only if you are starting over)

1. **GitHub:** open the old repo → **Settings** → scroll to **Danger Zone** → **Delete this repository** → type the name to confirm.
2. **PyPI:** open https://pypi.org/manage/projects/
   * If **pybi-ray is NOT listed** there (it was never uploaded): go to **Your account → Publishing** and **remove** any old *pending publisher* for `pybi-ray`. You will add a fresh one in Part 3.
   * If **pybi-ray IS listed** (something was uploaded): **do not delete it** — deleting can lock version numbers forever. Keep it; in Part 3 you'll add the publisher on the project itself. If a `0.1.0` file already exists there, change the version to `0.1.1` in Part 1 step 4.
3. **Your computer:** delete the old `pybi` folder (e.g. `C:\Users\M Rafay Shaikh\OneDrive\Desktop\pybi`).

> Tip: keep code **outside OneDrive** (e.g. `C:\dev\pybi`). OneDrive syncing can lock files that Git is writing.

---

## Part 1 — Prepare the project on your computer

1. **Unzip** `pybi-ray-0.1.0-source.zip` to `C:\dev\` → you get `C:\dev\pybi`.
2. In File Explorer turn on **View → Show → Hidden items** and check that `C:\dev\pybi\.github\workflows\` contains **`ci.yml`** and **`publish.yml`**. (These hidden files are what make GitHub publish for you.)
3. Open a terminal in the folder:

   ```bash
   cd C:\dev\pybi
   python -m venv .venv
   .venv\Scripts\activate
   pip install -e ".[dev]"
   pytest -q
   pybi demo
   ```

   You should see `31 passed` and the demo dashboard in your browser. Press **Ctrl+C** in the terminal to stop it.
4. **Check the version** in two files — they must match:
   * `pyproject.toml` → `version = "0.1.0"` and `name = "pybi-ray"`
   * `src/pybi/__init__.py` → `__version__ = "0.1.0"`

---

## Part 2 — Create the GitHub repository and push

1. Go to https://github.com/new
   * Owner: **rafay183** · Repository name: **pybi**
   * Description: `Open-source Power BI alternative in Python — dashboards, DAX-style measures, 214 connectors`
   * **Public**
   * Leave **all** "Add README / .gitignore / license" boxes **unticked**
   * **Create repository**
2. Push the code (first time only — set your Git identity if you haven't):

   ```bash
   git config --global user.name "Muhammad Rafay Shaikh"
   git config --global user.email "<the email on your GitHub account>"

   git init
   git add .
   git commit -m "PyBI 0.1.0 - initial release"
   git branch -M main
   git remote add origin https://github.com/rafay183/pybi.git
   git push -u origin main
   ```

   If Git asks you to sign in, a browser window opens — sign in to GitHub there.
3. Open **https://github.com/rafay183/pybi/actions**. A **CI** run starts (tests on Python 3.9–3.13). Wait for the green ✓ — about 3 minutes.
   * If you see a banner asking to enable workflows, click **I understand my workflows, go ahead and enable them**.
   * Windows/macOS jobs are marked as non-blocking; Linux jobs must be green.

---

## Part 3 — Connect PyPI to GitHub (trusted publishing — no passwords)

1. Log in at https://pypi.org (turn on 2FA if asked).
2. Choose **one** of these:
   * **New project (pybi-ray not on PyPI yet):** **Your account → Publishing → Add a new pending publisher → GitHub**
   * **Project already exists:** **Your projects → pybi-ray → Manage → Publishing → Add a new publisher → GitHub**
3. Fill in **exactly**:

   | Field | Value |
   |---|---|
   | PyPI Project Name (pending only) | `pybi-ray` |
   | Owner | `rafay183` |
   | Repository name | `pybi` |
   | Workflow name | `publish.yml` |
   | Environment name | `pypi` |

4. Click **Add**.
5. *(Recommended)* On GitHub: **Settings → Environments → New environment** → name `pypi` → **Configure environment** → tick **Required reviewers** → add yourself → **Save protection rules**. Now every release waits for your approval click, so nobody can publish by accident.

---

## Part 4 — Publish version 0.1.0

Publishing happens **only when you push a version tag**. Pushing to `main` runs tests but never publishes.

```bash
git tag v0.1.0
git push origin v0.1.0
```

You should see `* [new tag] v0.1.0 -> v0.1.0`.

Then open **https://github.com/rafay183/pybi/actions** → click the run named **v0.1.0**. It runs four jobs:

```
test  →  build  →  publish  →  github-release
```

* If you set up required reviewers: the run pauses with a yellow banner — click **Review deployments → tick pypi → Approve and deploy**.
* `build` also checks that the tag (`v0.1.0`) matches the version in `pyproject.toml`; if not, it stops with a clear error.
* `github-release` automatically creates a **GitHub Release** with the wheel attached and notes generated from your commits.

---

## Part 5 — Check it worked

1. Open https://pypi.org/project/pybi-ray/ — you should see **0.1.0** and the README.
2. In a **new** terminal (not the dev venv):

   ```bash
   pip install pybi-ray
   pybi version
   pybi demo
   ```

   `pybi version` prints `PyBI 0.1.0` and the dashboard opens. 🎉

---

## Part 6 — Open the project for contributors (10 minutes, once)

1. **About box** (⚙ next to *About* on the repo page): website `https://pypi.org/project/pybi-ray/`; topics:
   `power-bi` `business-intelligence` `dashboard` `data-visualization` `dax` `analytics` `python` `pandas` `open-source`
2. **Settings → General → Features:** tick **Issues** and **Discussions** (Discussions is where people ask questions).
3. **Issues → Labels → New label**: create `good first issue` and `help wanted` (if missing) and `connector`.
4. **Create 3–5 starter issues** so newcomers know where to begin, e.g.
   * "Test the PostgreSQL connector with a real database" — `connector`, `good first issue`
   * "Add a map visual" — `enhancement`, `help wanted`
   * "Add Urdu translation of the UI" — `good first issue`
5. **Protect `main`:** **Settings → Branches → Add branch ruleset** (or *Add rule*) → target `main` → tick **Require a pull request before merging** and **Require status checks to pass** → choose the **CI** checks → **Create**. Contributors then work through pull requests that are tested automatically.
6. **Pin** the repo on your GitHub profile and share the link.

Contributors read `CONTRIBUTING.md` (setup, structure, how to add connectors/visuals/DAX functions); issue and PR forms are already in `.github/`.

---

## Part 7 — Every future release

1. Merge the changes you want into `main`.
2. Update the version in **both** files, e.g. `0.1.1`:
   * `pyproject.toml` → `version = "0.1.1"`
   * `src/pybi/__init__.py` → `__version__ = "0.1.1"`
3. In `CHANGELOG.md`, rename **Unreleased** items into a new `## [0.1.1] - YYYY-MM-DD` section.
4. Commit, push, tag:

   ```bash
   git add .
   git commit -m "Release 0.1.1"
   git push
   git tag v0.1.1
   git push origin v0.1.1
   ```

Version rules (semantic versioning): `0.1.1` = bug fixes · `0.2.0` = new features · `1.0.0` = stable, big promise.

---

## Part 8 — Plan B: publish from your computer (if Actions is stuck or broken)

1. PyPI → **Account settings → API tokens → Add API token**
   * New project: scope **Entire account** · existing project: scope **Project: pybi-ray**
   * Copy the token (starts with `pypi-`) — it is shown only once.
2. In the project folder:

   ```bash
   pip install build twine
   rmdir /s /q dist        # Windows: remove old builds (macOS/Linux: rm -rf dist)
   python -m build
   twine check dist/*
   twine upload dist/*
   ```
3. Username: `__token__` · Password: paste the token (nothing shows while pasting — that's normal).
4. Afterwards, delete an *Entire account* token and keep using tags.

---

## Troubleshooting

| Symptom | Cause → Fix |
|---|---|
| `pip install pybi-ray` → `from versions: none` | Nothing published yet → push the tag (Part 4) or use Plan B. Wait 1–2 min after publishing. |
| `git push origin v0.1.0` → `Everything up-to-date`, no run appears | The tag is already on GitHub but the workflow file isn't → check `.github/workflows/publish.yml` exists on GitHub, then re-create the tag:<br>`git tag -d v0.1.0`<br>`git push origin :refs/tags/v0.1.0`<br>`git tag v0.1.0`<br>`git push origin v0.1.0` |
| `error: src refspec v0.1.0 does not match any` | Tag not created yet → `git tag v0.1.0` first. |
| Run stuck on **Queued** for 10+ minutes | GitHub runner problem → check https://www.githubstatus.com, cancel and **Re-run all jobs**, or use Plan B. |
| `publish` job: `invalid-publisher` | Part 3 values don't match exactly (owner, repo, `publish.yml`, `pypi`). |
| `publish` job: `File already exists` | That version was uploaded before — PyPI never allows reuse → bump the version and tag again. |
| `build` job: `Tag vX does not match pyproject version` | Update `pyproject.toml` version (and `__init__.py`), commit, re-create the tag. |
| `test` job fails | Click the red job, read the error, fix, push, re-create the tag. |
| `git push` asks for a password | GitHub doesn't accept passwords → sign in via the browser window, or use a Personal Access Token as the password. |
| `remote origin already exists` | `git remote set-url origin https://github.com/rafay183/pybi.git` |

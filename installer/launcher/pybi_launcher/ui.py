"""The small PyBI control window: status, open in browser, updates."""
from __future__ import annotations

import logging
import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
import webbrowser
from tkinter import font as tkfont
from tkinter import messagebox, ttk

from . import config as C
from . import updater
from .server import Server, ServerError

log = logging.getLogger("pybi.ui")

TEAL, TEAL_DARK, INK, MUTED, LINE = "#0a6c6c", "#085a5a", "#13202a", "#5b6876", "#dbe1e6"
BG, SURFACE, AMBER_SOFT, AMBER = "#f5f7f8", "#ffffff", "#fbf1d6", "#9a6a00"
GOOD, BAD, WAIT = "#1f8a4c", "#c0392b", "#d99a00"


def _open_path(path) -> None:
    try:
        if C.IS_WINDOWS:
            os.startfile(str(path))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except OSError:
        log.exception("Could not open %s", path)


class LauncherApp:
    def __init__(self, cfg: C.Config, state: C.State, open_browser: bool = True):
        self.cfg, self.state = cfg, state
        self.server = Server(cfg)
        self.q: queue.Queue = queue.Queue()
        self.open_browser_on_ready = open_browser and cfg.open_browser_on_start
        self.stopping = False
        self.release: updater.Release | None = None
        self.update_checked = False

        self.root = tk.Tk()
        self.root.title(cfg.app_name)
        self.root.configure(bg=BG)
        self.root.resizable(False, False)
        self._icons()
        self._fonts()
        self._style()
        self._build()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.root.after(100, self._poll)
        self.root.after(1000, self._watch)

    # ---------- setup ----------
    def _icons(self):
        ico, png = C.asset("pybi.ico"), C.asset("pybi.png")
        self.logo = None
        try:
            if ico and C.IS_WINDOWS:
                self.root.iconbitmap(default=str(ico))
            if png:
                img = tk.PhotoImage(file=str(png))
                self.root.iconphoto(True, img)
                f = max(1, img.width() // 52)
                self.logo = img.subsample(f, f)
        except tk.TclError:
            log.exception("Icon load failed")

    def _fonts(self):
        family = "Segoe UI" if C.IS_WINDOWS else tkfont.nametofont("TkDefaultFont").actual("family")
        tkfont.nametofont("TkDefaultFont").configure(family=family, size=10)
        self.f_title = tkfont.Font(family=family, size=17, weight="bold")
        self.f_sub = tkfont.Font(family=family, size=9)
        self.f_status = tkfont.Font(family=family, size=11, weight="bold")
        self.f_body = tkfont.Font(family=family, size=10)
        self.f_link = tkfont.Font(family=family, size=9, underline=True)

    def _style(self):
        s = ttk.Style(self.root)
        s.theme_use("clam")
        s.configure("TFrame", background=SURFACE)
        s.configure("Primary.TButton", background=TEAL, foreground="white", borderwidth=0,
                    focusthickness=2, focuscolor=TEAL_DARK, padding=(16, 8), font=("", 10, "bold"))
        s.map("Primary.TButton", background=[("disabled", LINE), ("active", TEAL_DARK)],
              foreground=[("disabled", MUTED)])
        s.configure("TButton", background=SURFACE, foreground=INK, bordercolor=LINE, lightcolor=SURFACE,
                    darkcolor=SURFACE, padding=(12, 7))
        s.map("TButton", background=[("active", BG)])
        s.configure("Update.TButton", background=AMBER_SOFT, foreground=INK, bordercolor=AMBER, padding=(10, 5))
        s.configure("TCheckbutton", background=SURFACE, foreground=MUTED)
        s.map("TCheckbutton", background=[("active", SURFACE)])
        s.configure("Horizontal.TProgressbar", background=TEAL, troughcolor=LINE, bordercolor=LINE,
                    lightcolor=TEAL, darkcolor=TEAL)

    def _build(self):
        r = self.root
        head = tk.Frame(r, bg=TEAL, padx=20, pady=16)
        head.pack(fill="x")
        if self.logo:
            tk.Label(head, image=self.logo, bg=TEAL).pack(side="left", padx=(0, 14))
        t = tk.Frame(head, bg=TEAL)
        t.pack(side="left")
        tk.Label(t, text=self.cfg.app_name, font=self.f_title, fg="white", bg=TEAL).pack(anchor="w")
        tk.Label(t, text=f"Business intelligence in Python  ·  version {self.cfg.version}",
                 font=self.f_sub, fg="#cfe9e6", bg=TEAL).pack(anchor="w")

        body = tk.Frame(r, bg=SURFACE, padx=20, pady=16)
        body.pack(fill="both")
        row = tk.Frame(body, bg=SURFACE)
        row.pack(fill="x")
        self.dot = tk.Canvas(row, width=14, height=14, bg=SURFACE, highlightthickness=0)
        self.dot_id = self.dot.create_oval(2, 2, 12, 12, fill=WAIT, outline="")
        self.dot.pack(side="left", padx=(0, 8))
        self.status = tk.Label(row, text="Starting PyBI…", font=self.f_status, fg=INK, bg=SURFACE)
        self.status.pack(side="left")
        self.detail = tk.Label(body, text="Preparing your local server. This takes a few seconds.",
                               font=self.f_body, fg=MUTED, bg=SURFACE, justify="left", wraplength=420,
                               cursor="arrow")
        self.detail.pack(anchor="w", pady=(4, 12))
        self.detail.bind("<Button-1>", lambda e: self.open_browser() if self.server.url else None)

        btns = tk.Frame(body, bg=SURFACE)
        btns.pack(fill="x")
        self.b_open = ttk.Button(btns, text="Open PyBI", style="Primary.TButton", command=self.open_browser,
                                 state="disabled")
        self.b_open.pack(side="left")
        self.b_restart = ttk.Button(btns, text="Restart", command=self.restart, state="disabled")
        self.b_restart.pack(side="left", padx=8)
        self.b_toggle = ttk.Button(btns, text="Stop", command=self.toggle, state="disabled")
        self.b_toggle.pack(side="left")

        # update banner (hidden until needed)
        self.banner = tk.Frame(r, bg=AMBER_SOFT, padx=20, pady=12)
        self.banner_text = tk.Label(self.banner, text="", font=self.f_body, fg=INK, bg=AMBER_SOFT,
                                    justify="left", wraplength=420)
        self.banner_text.pack(anchor="w")
        self.banner_btns = tk.Frame(self.banner, bg=AMBER_SOFT)
        self.banner_btns.pack(anchor="w", pady=(8, 0))
        self.b_update = ttk.Button(self.banner_btns, text="Update now", style="Primary.TButton",
                                   command=self.do_update)
        self.b_update.pack(side="left")
        ttk.Button(self.banner_btns, text="What's new", style="Update.TButton",
                   command=lambda: self.release and webbrowser.open(self.release.html_url)).pack(side="left", padx=8)
        self.b_skip = ttk.Button(self.banner_btns, text="Skip this version", style="Update.TButton",
                                 command=self.skip_version)
        self.b_skip.pack(side="left")
        self.progress = ttk.Progressbar(self.banner, length=420, mode="determinate")

        foot = tk.Frame(r, bg=BG, padx=20, pady=10)
        foot.pack(fill="x", side="bottom")
        self.auto_var = tk.BooleanVar(value=self.cfg.auto_check if self.state.auto_check is None
                                      else self.state.auto_check)
        cb = tk.Checkbutton(foot, text="Check for updates automatically", variable=self.auto_var,
                            command=self._save_auto, bg=BG, fg=MUTED, activebackground=BG,
                            selectcolor=SURFACE, font=self.f_sub, bd=0, highlightthickness=0)
        cb.pack(side="left")
        for text, cmd in (("Logs", lambda: _open_path(C.logs_dir())),
                          ("Workspace", lambda: _open_path(C.workspace_dir())),
                          ("Check for updates", lambda: self.check_updates(force=True))):
            lb = tk.Label(foot, text=text, font=self.f_link, fg=TEAL, bg=BG, cursor="hand2")
            lb.pack(side="right", padx=(10, 0))
            lb.bind("<Button-1>", lambda e, c=cmd: c())
        self.foot = foot

    # ---------- helpers ----------
    def _set(self, status: str, detail: str, color: str, link: bool = False):
        self.status.config(text=status)
        self.detail.config(text=detail, fg=TEAL if link else MUTED, cursor="hand2" if link else "arrow",
                           font=self.f_link if link else self.f_body)
        self.dot.itemconfig(self.dot_id, fill=color)

    def _buttons(self, running: bool, busy: bool = False):
        self.b_open.config(state="normal" if running and not busy else "disabled")
        self.b_restart.config(state="normal" if running and not busy else "disabled")
        self.b_toggle.config(text="Stop" if running or busy else "Start", state="disabled" if busy else "normal")

    def show(self):
        self.root.deiconify()
        self.root.lift()
        self.root.attributes("-topmost", True)
        self.root.after(300, lambda: self.root.attributes("-topmost", False))
        self.root.focus_force()

    def _save_auto(self):
        self.state.auto_check = bool(self.auto_var.get())
        try:
            self.state.save()
        except OSError:
            pass

    # ---------- server ----------
    def start_server(self):
        self.stopping = False
        self._set("Starting PyBI…", "Preparing your local server. This takes a few seconds.", WAIT)
        self._buttons(False, busy=True)

        def work():
            try:
                self.server.start()
                self.q.put(("ready", self.server.wait_ready()))
            except ServerError as e:
                self.q.put(("server_error", str(e)))
            except Exception as e:  # noqa: BLE001
                log.exception("Server start failed")
                self.q.put(("server_error", f"Unexpected error: {e}"))
        threading.Thread(target=work, daemon=True).start()

    def stop_server(self, then=None):
        self.stopping = True
        self._buttons(False, busy=True)
        self._set("Stopping PyBI…", "", WAIT)

        def work():
            self.server.stop()
            self.q.put(("stopped", then))
        threading.Thread(target=work, daemon=True).start()

    def restart(self):
        self.stop_server(then=self.start_server)

    def toggle(self):
        if self.server.running:
            self.stop_server()
        else:
            self.start_server()

    def open_browser(self):
        if self.server.url:
            webbrowser.open(self.server.url)

    def _watch(self):
        if (not self.stopping and self.server.proc is not None and not self.server.running
                and self.status.cget("text") == "PyBI is running"):
            log.warning("Server exited unexpectedly")
            self.server.stop()
            self._set("PyBI stopped unexpectedly", "Click Start to run it again, or open Logs to see why.", BAD)
            self._buttons(False)
        self.root.after(1000, self._watch)

    # ---------- updates ----------
    def check_updates(self, force: bool = False):
        if force:
            self.state.skipped_version = ""
        def work():
            self.q.put(("update", updater.check(self.cfg, self.state, force=force), force))
        threading.Thread(target=work, daemon=True).start()

    def _show_banner(self, rel: updater.Release):
        self.release = rel
        tag = " (pre-release)" if rel.prerelease else ""
        size = f" · {rel.asset_size / 1048576:.0f} MB" if rel.asset_size else ""
        self.banner_text.config(text=f"PyBI {rel.version}{tag} is available. You have {self.cfg.version}.{size}\n"
                                     "Updating takes about a minute and keeps your dashboards and settings.")
        self.progress.pack_forget()
        self.banner_btns.pack(anchor="w", pady=(8, 0))
        self.banner.pack(fill="x", before=self.foot)

    def skip_version(self):
        if self.release:
            self.state.skipped_version = self.release.version
            try:
                self.state.save()
            except OSError:
                pass
        self.banner.pack_forget()

    def do_update(self):
        rel = self.release
        if not rel:
            return
        self.banner_btns.pack_forget()
        self.progress.pack(anchor="w", pady=(8, 0))
        self.banner_text.config(text=f"Downloading PyBI {rel.version}…")
        dest = C.data_dir() / "updates"

        def prog(done, total):
            self.q.put(("progress", done, total))

        def work():
            try:
                path = updater.download(rel, dest, prog)
                self.q.put(("downloaded", path))
            except (updater.UpdateError, OSError) as e:
                self.q.put(("update_error", str(e)))
            except Exception as e:  # noqa: BLE001
                log.exception("Update download failed")
                self.q.put(("update_error", f"Download failed: {e}"))
        threading.Thread(target=work, daemon=True).start()

    # ---------- event loop ----------
    def _poll(self):
        try:
            while True:
                self._handle(*self.q.get_nowait())
        except queue.Empty:
            pass
        except tk.TclError:  # window already closed
            return
        try:
            self.root.after(100, self._poll)
        except tk.TclError:
            pass

    def _handle(self, kind, *a):
        if kind == "ready":
            url = a[0]
            self._set("PyBI is running", url, GOOD, link=True)
            self._buttons(True)
            if self.open_browser_on_ready:
                self.open_browser_on_ready = False
                webbrowser.open(url)
            if not self.update_checked:
                self.update_checked = True
                self.root.after(2500, self.check_updates)
        elif kind == "server_error":
            self.server.stop()
            self._set("Couldn't start PyBI", a[0] + "\nOpen Logs for details, then click Start to try again.", BAD)
            self._buttons(False)
            self.show()
        elif kind == "stopped":
            self._set("PyBI is stopped", "Click Start to run it again.", MUTED)
            self._buttons(False)
            if a[0]:
                a[0]()
        elif kind == "show":
            self.show()
            if self.server.url:
                self.open_browser()
        elif kind == "update":
            res, force = a
            if res.status == "available":
                self._show_banner(res.release)
                self.show()
            elif force and res.status == "current":
                messagebox.showinfo("PyBI", f"You have the latest version ({self.cfg.version}).", parent=self.root)
            elif force and res.status in ("error", "disabled"):
                messagebox.showwarning("PyBI", res.error or "Update checks are turned off.", parent=self.root)
        elif kind == "progress":
            done, total = a
            if total:
                self.progress.config(mode="determinate", maximum=total, value=done)
                self.banner_text.config(text=f"Downloading PyBI {self.release.version}…  "
                                             f"{done / 1048576:.1f} of {total / 1048576:.1f} MB")
            else:
                self.progress.config(mode="indeterminate")
        elif kind == "downloaded":
            path = a[0]
            self.banner_text.config(text="Installing the update. PyBI will close and reopen by itself.")
            self.progress.config(mode="indeterminate")
            self.progress.start(12)

            def go():
                self.server.stop()
                try:
                    updater.launch_installer(path, C.logs_dir())
                except OSError as e:
                    self.q.put(("update_error", f"Could not start the installer: {e}"))
                    return
                self.q.put(("quit",))
            threading.Thread(target=go, daemon=True).start()
        elif kind == "update_error":
            self.progress.stop()
            self.progress.pack_forget()
            self.banner_text.config(text=f"The update didn't finish: {a[0]}")
            self.banner_btns.pack(anchor="w", pady=(8, 0))
            self.b_update.config(text="Try again")
            if not self.server.running:
                self.start_server()
        elif kind == "quit":
            self.root.destroy()

    def on_close(self):
        if not self.server.running:
            self.root.destroy()
            return
        ans = messagebox.askyesnocancel(
            "Close PyBI",
            "Stop PyBI and close it?\n\nYes: stop the server and close.\n"
            "No: keep PyBI running and minimise this window.",
            parent=self.root)
        if ans is None:
            return
        if ans:
            self.stop_server(then=self.root.destroy)
        else:
            self.root.iconify()

    def run(self):
        self.root.update_idletasks()
        w, h = max(self.root.winfo_reqwidth(), 480), self.root.winfo_reqheight()
        x = (self.root.winfo_screenwidth() - w) // 2
        y = (self.root.winfo_screenheight() - h) // 3
        self.root.geometry(f"{w}x{h}+{x}+{y}")
        self.start_server()
        self.root.mainloop()
        self.server.stop()

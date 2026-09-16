import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow?
    var webView: WKWebView!
    var retryTimer: Timer?
    let targetURL = URL(string: "http://127.0.0.1:51873/")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()
        setupWindow()
        loadApp()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false // Keep app running in Dock or allow closing window
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard let window else { return true }
        if window.isMiniaturized {
            window.deminiaturize(nil)
        }
        window.makeKeyAndOrderFront(nil)
        return false // The retained main window handles reopening.
    }

    // MARK: - Setup Window & WebView
    private func setupWindow() {
        let screenRect = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let initialWidth: CGFloat = min(1360, screenRect.width * 0.88)
        let initialHeight: CGFloat = min(880, screenRect.height * 0.88)
        let initialRect = NSRect(
            x: screenRect.origin.x + (screenRect.width - initialWidth) / 2,
            y: screenRect.origin.y + (screenRect.height - initialHeight) / 2,
            width: initialWidth,
            height: initialHeight
        )

        let window = NSWindow(
            contentRect: initialRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        // Keep the window and its web view alive after closing so reopening can reuse them.
        window.isReleasedWhenClosed = false
        self.window = window
        window.title = "Azu Creator"
        window.minSize = NSSize(width: 960, height: 640)
        window.titlebarAppearsTransparent = false
        window.titleVisibility = .visible
        window.setFrameAutosaveName("AzuCreatorMainWindow")

        // Configure WKWebView
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.allowsBackForwardNavigationGestures = true

        let contentView = window.contentView!
        contentView.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: contentView.topAnchor),
            webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
        ])

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func loadApp() {
        retryTimer?.invalidate()
        retryTimer = nil
        let request = URLRequest(url: targetURL, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 10.0)
        webView.load(request)
    }

    // MARK: - Navigation Delegate
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showRetryScreen(error: error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showRetryScreen(error: error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        retryTimer?.invalidate()
        retryTimer = nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        // Open external websites (documentation, external links) in default browser
        if navigationAction.navigationType == .linkActivated {
            if let host = url.host, host != "127.0.0.1" && host != "localhost" {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }
        }

        decisionHandler(.allow)
    }

    // Handle window.open / target="_blank"
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if let host = url.host, host == "127.0.0.1" || host == "localhost" {
                webView.load(navigationAction.request)
            } else {
                NSWorkspace.shared.open(url)
            }
        }
        return nil
    }

    // MARK: - Retry Screen
    private func showRetryScreen(error: String) {
        let retryHtml = """
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: #0f1117;
              color: #e2e8f0;
              user-select: none;
            }
            .spinner {
              width: 36px;
              height: 36px;
              border: 3px solid rgba(255,255,255,0.1);
              border-top-color: #3b82f6;
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin-bottom: 20px;
            }
            @keyframes spin { to { transform: rotate(360deg); } }
            h2 { font-size: 18px; margin: 0 0 8px 0; font-weight: 500; }
            p { font-size: 13px; color: #94a3b8; margin: 0 0 20px 0; }
            button {
              background: #2563eb;
              color: white;
              border: none;
              padding: 8px 20px;
              border-radius: 6px;
              font-size: 13px;
              font-weight: 500;
              cursor: pointer;
            }
            button:hover { background: #1d4ed8; }
          </style>
        </head>
        <body>
          <div class="spinner"></div>
          <h2>正在连接 Azu Creator 后台服务...</h2>
          <p>服务端口: 51873 (自动重试中)</p>
          <button onclick="location.reload()">立即重试</button>
        </body>
        </html>
        """
        webView.loadHTMLString(retryHtml, baseURL: nil)

        // Schedule automatic reconnect attempt
        if retryTimer == nil {
            retryTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
                self?.loadApp()
            }
        }
    }

    // MARK: - Native Main Menu
    private func setupMainMenu() {
        let mainMenu = NSMenu()

        // 1. App Menu
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 Azu Creator", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        let hideItem = NSMenuItem(title: "隐藏 Azu Creator", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthersItem = NSMenuItem(title: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthersItem.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideItem)
        appMenu.addItem(hideOthersItem)
        appMenu.addItem(withTitle: "显示全部", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "退出 Azu Creator", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // 2. Edit Menu (Crucial for Web inputs: copy, paste, select all, undo)
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: #selector(UndoManager.undo), keyEquivalent: "z")
        let redoItem = NSMenuItem(title: "重做", action: #selector(UndoManager.redo), keyEquivalent: "Z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redoItem)
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // 3. View Menu
        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "视图")
        let reloadItem = NSMenuItem(title: "刷新页面", action: #selector(reloadPage), keyEquivalent: "r")
        viewMenu.addItem(reloadItem)
        viewMenu.addItem(NSMenuItem.separator())
        let actualSizeItem = NSMenuItem(title: "实际大小", action: #selector(zoomActualSize), keyEquivalent: "0")
        let zoomInItem = NSMenuItem(title: "放大", action: #selector(zoomIn), keyEquivalent: "+")
        let zoomOutItem = NSMenuItem(title: "缩小", action: #selector(zoomOut), keyEquivalent: "-")
        viewMenu.addItem(actualSizeItem)
        viewMenu.addItem(zoomInItem)
        viewMenu.addItem(zoomOutItem)
        viewMenu.addItem(NSMenuItem.separator())
        let fullScreenItem = NSMenuItem(title: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreenItem.keyEquivalentModifierMask = [.command, .control]
        viewMenu.addItem(fullScreenItem)
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        // 4. Window Menu
        let windowMenuItem = NSMenuItem()
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenuItem.submenu = windowMenu
        mainMenu.addItem(windowMenuItem)

        NSApp.mainMenu = mainMenu
    }

    @objc private func reloadPage() {
        loadApp()
    }

    @objc private func zoomIn() {
        webView.pageZoom += 0.1
    }

    @objc private func zoomOut() {
        if webView.pageZoom > 0.4 {
            webView.pageZoom -= 0.1
        }
    }

    @objc private func zoomActualSize() {
        webView.pageZoom = 1.0
    }
}

// Entry Point
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

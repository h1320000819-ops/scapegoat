(function () {
  const isStandalone = () =>
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true;
  const isFullscreen = () =>
    Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const isPseudoFullscreen = () =>
    document.documentElement.dataset.fullscreenFallback === "on";
  const viewportSize = () => ({
    width: Math.round(window.visualViewport?.width ?? document.documentElement.clientWidth ?? 0),
    height: Math.round(window.visualViewport?.height ?? document.documentElement.clientHeight ?? 0),
  });
  const isLandscape = () => {
    const viewport = viewportSize();
    return window.matchMedia?.("(orientation: landscape)")?.matches ||
      viewport.width > viewport.height;
  };
  const isGameScreen = () =>
    document.documentElement.dataset.gameScreen === "on" ||
    document.body.dataset.gameScreen === "on" ||
    Boolean(document.querySelector(".mahjong-table"));
  const fullscreenTarget = () =>
    document.documentElement ||
    document.body ||
    document.querySelector(".app-shell");
  const canFullscreen = () => {
    const element = fullscreenTarget();
    return Boolean(element.requestFullscreen || element.webkitRequestFullscreen);
  };

  const updateMode = () => {
    document.documentElement.dataset.pwa = isStandalone() ? "standalone" : "browser";
    document.body.dataset.pwa = isStandalone() ? "standalone" : "browser";
    const fullscreenMode = isFullscreen() || isPseudoFullscreen();
    document.documentElement.dataset.fullscreen = fullscreenMode ? "on" : "off";
    document.body.dataset.fullscreen = fullscreenMode ? "on" : "off";
  };
  let stableViewport = null;
  const updateViewportSize = ({ force = false } = {}) => {
    const viewport = viewportSize();
    let height = viewport.height;
    let width = viewport.width;
    const gameLandscape = isGameScreen() && isMobile() && (width > height || isLandscape());
    if (gameLandscape && stableViewport && stableViewport.orientation === "landscape" && !force) {
      const widthDelta = Math.abs(width - stableViewport.width);
      const heightDelta = Math.abs(height - stableViewport.height);
      if (widthDelta <= 2 && heightDelta <= 14) {
        width = stableViewport.width;
        height = stableViewport.height;
      }
    }
    const next = { width, height, orientation: width >= height ? "landscape" : "portrait" };
    const changed = !stableViewport || stableViewport.width !== next.width || stableViewport.height !== next.height || stableViewport.orientation !== next.orientation;
    stableViewport = next;
    document.documentElement.style.setProperty("--anmika-viewport-height", `${height}px`);
    document.documentElement.style.setProperty("--anmika-viewport-width", `${width}px`);
    if (changed || force) window.dispatchEvent(new CustomEvent("anmika-layout-viewport-changed"));
  };

  const registerServiceWorker = () => {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.warn("[PWA] service worker registration failed", error);
    });
  };

  const isiOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isMobile = () => matchMedia("(max-width: 920px), (pointer: coarse)").matches;
  let deferredPrompt = null;

  const dismissKey = "anmikaPwaInstallDismissedAt";
  const recentlyDismissed = () => Date.now() - Number(localStorage.getItem(dismissKey) || 0) < 3 * 24 * 60 * 60 * 1000;
  const ensureHintStyles = () => {
    if (document.getElementById("anmika-pwa-style")) return;
    const style = document.createElement("style");
    style.id = "anmika-pwa-style";
    style.textContent = `
      .pwa-install-hint{background:rgba(10,28,24,.96);border:1px solid rgba(255,209,92,.72);border-radius:8px;bottom:max(12px,env(safe-area-inset-bottom));box-shadow:0 16px 40px rgba(0,0,0,.38);color:#f7fff9;display:grid;gap:8px;left:50%;max-width:min(92vw,560px);padding:10px 12px;position:fixed;transform:translateX(-50%);z-index:10000}
      .pwa-install-hint p{font-size:13px;font-weight:800;margin:0}
      .pwa-install-hint div{align-items:center;display:flex;flex-wrap:wrap;gap:8px}
      .pwa-install-hint button{background:#ffd15c;border:1px solid #9f6b00;border-radius:8px;color:#1f1704;font:inherit;font-weight:900;min-height:34px;padding:6px 10px}
      .pwa-install-hint .secondary{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.24);color:#f7fff9}
      .pwa-fullscreen-button{align-items:center;background:rgba(255,209,92,.95);border:1px solid rgba(55,38,0,.48);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.35);color:#1f1704;display:none;font:inherit;font-size:12px;font-weight:900;gap:6px;min-height:34px;padding:6px 10px;position:fixed;right:max(8px,env(safe-area-inset-right));top:max(8px,env(safe-area-inset-top));touch-action:manipulation;z-index:10001}
      body[data-pwa="browser"][data-fullscreen="off"] .pwa-fullscreen-button{display:flex}
      .pwa-fullscreen-toast{background:rgba(10,28,24,.96);border:1px solid rgba(255,209,92,.72);border-radius:8px;color:#f7fff9;font-size:12px;font-weight:800;left:50%;max-width:min(86vw,460px);padding:8px 10px;position:fixed;text-align:center;top:max(50px,calc(env(safe-area-inset-top) + 42px));transform:translateX(-50%);z-index:10002}
      @media (min-width: 921px), (orientation: portrait){.pwa-fullscreen-button{display:none!important}}
    `;
    document.head.append(style);
  };
  const shouldOfferFullscreen = () =>
    isMobile() &&
    (isLandscape() || isGameScreen()) &&
    !isStandalone() &&
    !isFullscreen() &&
    !isPseudoFullscreen();

  const hideBrowserChrome = () => {
    if (!isMobile()) return;
    updateViewportSize();
  };

  const showFullscreenToast = (message) => {
    ensureHintStyles();
    document.querySelector(".pwa-fullscreen-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "pwa-fullscreen-toast";
    toast.textContent = message;
    document.body.append(toast);
    setTimeout(() => toast.remove(), 3200);
  };

  const enablePseudoFullscreen = () => {
    if (!isMobile() || !isLandscape()) return false;
    document.documentElement.dataset.fullscreenFallback = "on";
    document.body.dataset.fullscreenFallback = "on";
    updateMode();
    updateViewportSize();
    hideBrowserChrome();
    return true;
  };

  const requestFullscreen = async ({ fromButton = false } = {}) => {
    if (!shouldOfferFullscreen()) return false;
    const element = fullscreenTarget();
    try {
      if (element.requestFullscreen) await element.requestFullscreen({ navigationUI: "hide" });
      else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
      else {
        const fallbackOk = enablePseudoFullscreen();
        if (fromButton && isiOS()) {
          showFullscreenToast("iPhoneではホーム画面に追加すると完全な全画面で遊べます。");
          showInstallHint();
        }
        return fallbackOk;
      }
      await screen.orientation?.lock?.("landscape").catch(() => null);
      updateMode();
      updateViewportSize();
      return true;
    } catch (error) {
      console.warn("[PWA] fullscreen request failed", error);
      const fallbackOk = enablePseudoFullscreen();
      if (fromButton) {
        showFullscreenToast(fallbackOk
          ? "ブラウザの全画面化は制限されました。表示領域だけ拡大しました。"
          : "ホーム画面に追加すると全画面で遊べます。");
        if (isiOS() || !canFullscreen()) showInstallHint();
      }
      return fallbackOk;
    }
  };

  const requestFullscreenSoon = () => {
    hideBrowserChrome();
    requestFullscreen().catch(() => false);
  };

  const lockLandscapeForGame = async () => {
    if (!isMobile() || !isGameScreen()) return false;
    updateViewportSize();
    hideBrowserChrome();
    await screen.orientation?.lock?.("landscape").catch(() => null);
    return requestFullscreen().catch(() => false);
  };

  const ensureFullscreenButton = () => {
    ensureHintStyles();
    let button = document.querySelector(".pwa-fullscreen-button");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "pwa-fullscreen-button";
      button.textContent = "\u5168\u753b\u9762";
      button.dataset.pwaFullscreen = "";
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      }, { passive: false });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        requestFullscreen({ fromButton: true }).then(() => ensureFullscreenButton());
      });
      document.body.append(button);
    }
    button.hidden = !shouldOfferFullscreen();
  };

  const bindAutoFullscreenGesture = () => {
    const onFirstInteraction = (event) => {
      if (!shouldOfferFullscreen()) return;
      if (event.target?.closest?.("input,select,textarea,[data-pwa-dismiss],[data-pwa-install],[data-pwa-fullscreen]")) return;
      if (isGameScreen()) lockLandscapeForGame();
      else requestFullscreenSoon();
    };
    document.addEventListener("pointerdown", onFirstInteraction, { capture: true });
    document.addEventListener("touchend", onFirstInteraction, { capture: true, passive: true });
    document.addEventListener("click", onFirstInteraction, { capture: true });
  };

  const preventGameScroll = (event) => {
    if (!isGameScreen() || !isMobile()) return;
    if (event.target?.closest?.("select,input,textarea,.replay-toolbar,.settings-panel,.bottom-actions")) return;
    event.preventDefault();
  };

  const showInstallHint = () => {
    if (!isMobile() || isStandalone() || recentlyDismissed() || document.querySelector(".pwa-install-hint")) return;
    ensureHintStyles();
    const hint = document.createElement("section");
    hint.className = "pwa-install-hint";

    const message = document.createElement("p");
    message.textContent = "\u3053\u306e\u30b2\u30fc\u30e0\u3092\u30db\u30fc\u30e0\u753b\u9762\u306b\u8ffd\u52a0\u3059\u308b\u3068\u3001\u30a2\u30d7\u30ea\u306e\u3088\u3046\u306b\u5168\u753b\u9762\u3067\u904a\u3079\u307e\u3059\u3002";

    const actions = document.createElement("div");
    if (deferredPrompt) {
      const install = document.createElement("button");
      install.type = "button";
      install.dataset.pwaInstall = "";
      install.textContent = "\u30db\u30fc\u30e0\u753b\u9762\u306b\u8ffd\u52a0";
      actions.append(install);
    }
    if (isiOS()) {
      const iosText = document.createElement("span");
      iosText.textContent = "\u5171\u6709\u30dc\u30bf\u30f3\u304b\u3089\u300c\u30db\u30fc\u30e0\u753b\u9762\u306b\u8ffd\u52a0\u300d\u3092\u9078\u3093\u3067\u304f\u3060\u3055\u3044\u3002";
      actions.append(iosText);
    }
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "secondary";
    dismiss.dataset.pwaDismiss = "";
    dismiss.textContent = "\u9589\u3058\u308b";
    actions.append(dismiss);
    hint.append(message, actions);

    document.body.append(hint);
    hint.querySelector("[data-pwa-dismiss]")?.addEventListener("click", () => {
      localStorage.setItem(dismissKey, String(Date.now()));
      hint.remove();
    });
    hint.querySelector("[data-pwa-install]")?.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      hint.remove();
    });
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallHint();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    document.querySelector(".pwa-install-hint")?.remove();
    updateMode();
    ensureFullscreenButton();
  });
  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", updateMode);
  window.addEventListener("resize", () => {
    updateViewportSize();
    updateMode();
    ensureFullscreenButton();
    if (isGameScreen()) lockLandscapeForGame();
    else requestFullscreenSoon();
  });
  window.visualViewport?.addEventListener?.("resize", () => {
    updateViewportSize();
    hideBrowserChrome();
  });
  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      if (!isLandscape()) {
        delete document.documentElement.dataset.fullscreenFallback;
        delete document.body.dataset.fullscreenFallback;
      }
      updateViewportSize();
      updateMode();
      ensureFullscreenButton();
      if (isGameScreen()) lockLandscapeForGame();
      else requestFullscreenSoon();
    }, 250);
  });
  window.addEventListener("pageshow", () => {
    updateMode();
    updateViewportSize();
    ensureFullscreenButton();
    if (isGameScreen()) lockLandscapeForGame();
    else requestFullscreenSoon();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    updateMode();
    updateViewportSize();
    ensureFullscreenButton();
    if (isGameScreen()) lockLandscapeForGame();
    else requestFullscreenSoon();
  });
  window.addEventListener("anmika-game-screen-active", () => {
    updateMode();
    updateViewportSize();
    ensureFullscreenButton();
    lockLandscapeForGame();
    setTimeout(lockLandscapeForGame, 350);
  });
  document.addEventListener("touchmove", preventGameScroll, { passive: false, capture: true });
  document.addEventListener("wheel", preventGameScroll, { passive: false, capture: true });
  document.addEventListener("fullscreenchange", () => {
    updateMode();
    updateViewportSize();
    ensureFullscreenButton();
  });
  document.addEventListener("webkitfullscreenchange", () => {
    updateMode();
    updateViewportSize();
    ensureFullscreenButton();
  });
  document.addEventListener("DOMContentLoaded", () => {
    updateMode();
    updateViewportSize();
    registerServiceWorker();
    bindAutoFullscreenGesture();
    ensureFullscreenButton();
    if (isGameScreen()) lockLandscapeForGame();
    else requestFullscreenSoon();
    setTimeout(() => {
      if (isGameScreen()) lockLandscapeForGame();
      else requestFullscreenSoon();
    }, 450);
    setTimeout(showInstallHint, 900);
  });
})();

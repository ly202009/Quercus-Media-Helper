(() => {
  const DEFAULT_SETTINGS = {
    skipSeconds: 5,
    holdSpaceSpeed: 2.0,
    holdDelayMs: 200,
    speedSteps: [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 3.0],
    keybinds: {
      playPause: { code: "Space", shift: false, label: "Space" },
      skipBack: { code: "ArrowLeft", shift: false, label: "ArrowLeft" },
      skipForward: { code: "ArrowRight", shift: false, label: "ArrowRight" },
      speedUp: { code: "Period", shift: true, label: "Shift + >" },
      speedDown: { code: "Comma", shift: true, label: "Shift + <" },
      swapVideos: { code: "KeyS", shift: false, label: "S" },
      resetSpeed: { code: "KeyR", shift: false, label: "R" },
      mute: { code: "KeyM", shift: false, label: "M" },
      fullscreen: { code: "KeyF", shift: false, label: "F" }
    }
  };

  let settings = structuredClone(DEFAULT_SETTINGS);
  let hasRemotePlayer = false;

  // Hold-space state
  let spaceDown = false;
  let spaceHoldActive = false;
  let spaceHoldTimer = null;
  let preHoldSpeed = 1.0;
  let currentPreferredSpeed = 1.0;

  // Load settings and listen for live updates from popup
  const storageApi = typeof browser !== "undefined" ? browser.storage : chrome.storage;
  storageApi.local.get("qmgSettings", (res) => {
    if (res && res.qmgSettings) {
      settings = mergeSettings(DEFAULT_SETTINGS, res.qmgSettings);
    }
  });

  storageApi.onChanged.addListener((changes) => {
    if (changes.qmgSettings && changes.qmgSettings.newValue) {
      settings = mergeSettings(DEFAULT_SETTINGS, changes.qmgSettings.newValue);
    }
  });

  function mergeSettings(defaults, saved) {
    return {
      ...defaults,
      ...saved,
      keybinds: { ...defaults.keybinds, ...(saved.keybinds || {}) }
    };
  }

  // Find all valid video elements in the current frame
  function getVideos() {
    return Array.from(document.querySelectorAll("video")).filter(
      (v) => v.readyState > 0 || v.src || v.querySelector("source")
    );
  }

  // Notify parent frames when this frame contains active video element(s)
  function announcePlayerPresence() {
    if (getVideos().length > 0 && window !== window.top) {
      let target = window.parent;
      while (target) {
        target.postMessage({ type: "QMG_PLAYER_PRESENT" }, "*");
        if (target === window.top) break;
        target = target.parent;
      }
    }
  }

  setInterval(announcePlayerPresence, 1500);
  announcePlayerPresence();

  // Forward a command to all child iframes recursively
  function broadcastToChildFrames(payload) {
    for (let i = 0; i < window.frames.length; i++) {
      try {
        window.frames[i].postMessage(payload, "*");
      } catch (_) {}
    }
  }

  // Listen for cross-frame messages
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "QMG_PLAYER_PRESENT") {
      hasRemotePlayer = true;
    } else if (data.type === "QMG_COMMAND") {
      const videos = getVideos();
      if (videos.length > 0) {
        executeCommand(data.command, data.value);
      } else {
        broadcastToChildFrames(data);
      }
    }
  });

  // Check if user is typing in a text box, search bar, or comment field
  function isTypingInInput(e) {
    const el = e.target || document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      // Allow shortcuts even if a range slider (like volume/scrubber) is focused
      return !["range", "button", "checkbox", "radio"].includes(type);
    }
    return tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  // Match keyboard event against a saved keybind object
  function matchesKeybind(e, bind) {
    if (!bind || !bind.code) return false;
    return e.code === bind.code && Boolean(e.shiftKey) === Boolean(bind.shift) && !e.ctrlKey && !e.altKey && !e.metaKey;
  }

  // Match any configured shortcut
  function getMatchedAction(e) {
    const kb = settings.keybinds;
    if (matchesKeybind(e, kb.playPause)) return "playPause";
    if (matchesKeybind(e, kb.skipBack)) return "skipBack";
    if (matchesKeybind(e, kb.skipForward)) return "skipForward";
    if (matchesKeybind(e, kb.speedUp)) return "speedUp";
    if (matchesKeybind(e, kb.speedDown)) return "speedDown";
    if (matchesKeybind(e, kb.swapVideos)) return "swapVideos";
    if (matchesKeybind(e, kb.resetSpeed)) return "resetSpeed";
    if (matchesKeybind(e, kb.mute)) return "mute";
    if (matchesKeybind(e, kb.fullscreen)) return "fullscreen";
    return null;
  }

  // Dispatch command locally if this frame has videos, otherwise forward to child frames
  function dispatchCommand(command, value = null) {
    const videos = getVideos();
    if (videos.length > 0) {
      executeCommand(command, value);
    } else {
      broadcastToChildFrames({ type: "QMG_COMMAND", command, value });
    }
  }

  // Capture-phase keydown listener to override native Quercus 1s skip & spacebar scroll
  window.addEventListener(
    "keydown",
    (e) => {
      if (isTypingInInput(e)) return;

      const localVideos = getVideos();
      if (localVideos.length === 0 && !hasRemotePlayer) return;

      const action = getMatchedAction(e);
      if (!action) return;

      // Stop browser scroll and stop Quercus player's native 1-second arrow handler
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (action === "playPause") {
        if (!spaceDown && !e.repeat) {
          spaceDown = true;
          spaceHoldActive = false;
          spaceHoldTimer = setTimeout(() => {
            spaceHoldActive = true;
            dispatchCommand("startHoldSpeed");
          }, settings.holdDelayMs || 200);
        }
        return;
      }

      if (e.repeat && ["swapVideos", "mute", "fullscreen", "resetSpeed"].includes(action)) {
        return;
      }

      dispatchCommand(action);
    },
    true
  );

  // Capture-phase keyup listener for completing Space tap vs. hold-Space 2x speed
  window.addEventListener(
    "keyup",
    (e) => {
      if (isTypingInInput(e)) return;

      const localVideos = getVideos();
      if (localVideos.length === 0 && !hasRemotePlayer) return;

      if (e.code === settings.keybinds.playPause.code && spaceDown) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        clearTimeout(spaceHoldTimer);
        spaceDown = false;

        if (spaceHoldActive) {
          spaceHoldActive = false;
          dispatchCommand("stopHoldSpeed");
        } else {
          dispatchCommand("togglePlay");
        }
      }
    },
    true
  );

  // Execute video player actions across all active <video> elements in sync
  function executeCommand(command, value) {
    const videos = getVideos();
    if (videos.length === 0) return;

    const primary = videos[0];

    switch (command) {
      case "togglePlay": {
        const shouldPlay = primary.paused;
        videos.forEach((v) => {
          if (shouldPlay) {
            v.play().catch(() => {});
          } else {
            v.pause();
          }
        });
        showHud(shouldPlay ? "▶ Play" : "⏸ Pause");
        break;
      }

      case "startHoldSpeed": {
        preHoldSpeed = primary.playbackRate || currentPreferredSpeed || 1.0;
        const holdRate = Number(settings.holdSpaceSpeed) || 2.0;
        videos.forEach((v) => {
          if (v.paused) v.play().catch(() => {});
          v.playbackRate = holdRate;
        });
        showHud(`${holdRate}x ⏩ (Hold)`, true);
        break;
      }

      case "stopHoldSpeed": {
        const restoreRate = preHoldSpeed || currentPreferredSpeed || 1.0;
        videos.forEach((v) => {
          v.playbackRate = restoreRate;
        });
        showHud(`${restoreRate}x`);
        break;
      }

      case "skipForward": {
        const delta = Number(settings.skipSeconds) || 5;
        const targetTime = Math.min(
          primary.duration || Infinity,
          primary.currentTime + delta
        );
        videos.forEach((v) => {
          v.currentTime = targetTime;
        });
        showHud(`+${delta}s ⏭`);
        break;
      }

      case "skipBack": {
        const delta = Number(settings.skipSeconds) || 5;
        const targetTime = Math.max(0, primary.currentTime - delta);
        videos.forEach((v) => {
          v.currentTime = targetTime;
        });
        showHud(`-${delta}s ⏮`);
        break;
      }

      case "speedUp": {
        const steps = getSortedSteps();
        const current = primary.playbackRate;
        const nextSpeed =
          steps.find((s) => s > current + 0.001) ?? steps[steps.length - 1];
        currentPreferredSpeed = nextSpeed;
        videos.forEach((v) => {
          v.playbackRate = nextSpeed;
        });
        showHud(`Speed: ${nextSpeed}x`);
        break;
      }

      case "speedDown": {
        const steps = getSortedSteps();
        const current = primary.playbackRate;
        const prevSpeed =
          [...steps].reverse().find((s) => s < current - 0.001) ?? steps[0];
        currentPreferredSpeed = prevSpeed;
        videos.forEach((v) => {
          v.playbackRate = prevSpeed;
        });
        showHud(`Speed: ${prevSpeed}x`);
        break;
      }

      case "resetSpeed": {
        currentPreferredSpeed = 1.0;
        videos.forEach((v) => {
          v.playbackRate = 1.0;
        });
        showHud("Speed: 1x");
        break;
      }

      case "mute": {
        // Only toggle mute on the stream that handles audio (or primary if none unmuted)
        const anyUnmuted = videos.some((v) => !v.muted && v.volume > 0);
        videos.forEach((v, idx) => {
          if (anyUnmuted) {
            v.dataset.qmgWasUnmuted = (!v.muted && v.volume > 0) ? "1" : "0";
            v.muted = true;
          } else {
            if (v.dataset.qmgWasUnmuted === "1" || idx === 0) {
              v.muted = false;
            }
          }
        });
        showHud(anyUnmuted ? "🔇 Muted" : "🔊 Unmuted");
        break;
      }

      case "fullscreen": {
        const nativeFsBtn = document.querySelector(
          '[aria-label*="Full screen" i], [aria-label*="Fullscreen" i], [title*="Full screen" i], [title*="Fullscreen" i], .playkit-icon-maximize, .playkit-icon-minimize, .vjs-fullscreen-control'
        );
        if (nativeFsBtn) {
          nativeFsBtn.click();
        } else if (!document.fullscreenElement) {
          (document.documentElement || primary).requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
        showHud("⛶ Fullscreen");
        break;
      }

      case "swapVideos": {
        swapDualVideos(videos);
        break;
      }
    }
  }

  function getSortedSteps() {
    const arr = Array.isArray(settings.speedSteps) && settings.speedSteps.length > 0
      ? settings.speedSteps.map(Number).filter((n) => !isNaN(n) && n > 0)
      : [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
    return arr.sort((a, b) => a - b);
  }

  // Swap Lecture Video and Computer Screen Video
  function swapDualVideos(videos) {
    if (videos.length < 2) {
      showHud("Single Video Stream");
      return;
    }

    // 1. Try native Kaltura Playkit / Opencast Paella / MyMedia switch buttons first
    const switchSelectors = [
      ".playkit-switch-button",
      ".playkit-icon-switch",
      '[data-testid*="switch" i]',
      'button[aria-label*="switch" i]',
      'button[aria-label*="swap" i]',
      'button[title*="switch" i]',
      'button[title*="swap" i]',
      '[role="button"][aria-label*="switch" i]',
      '[class*="switch-stream" i]',
      '[class*="swap-video" i]'
    ];

    for (const sel of switchSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        const clickable = btn.closest("button, [role='button']") || btn;
        clickable.click();
        showHud("🔄 Swapped Videos");
        return;
      }
    }

    // 2. Fallback: Swap the two video containers' classes and inline styles directly
    const [v1, v2] = videos;
    let c1 = v1;
    let c2 = v2;
    while (c1.parentElement && c2.parentElement && c1.parentElement !== c2.parentElement) {
      c1 = c1.parentElement;
      c2 = c2.parentElement;
    }

    if (c1 && c2 && c1 !== c2) {
      const tempClass = c1.className;
      c1.className = c2.className;
      c2.className = tempClass;

      const tempStyle = c1.getAttribute("style");
      const style2 = c2.getAttribute("style");
      if (style2 !== null) c1.setAttribute("style", style2);
      else c1.removeAttribute("style");

      if (tempStyle !== null) c2.setAttribute("style", tempStyle);
      else c2.removeAttribute("style");

      showHud("🔄 Swapped Videos");
    }
  }

  // On-screen HUD indicator
  let hudTimeout = null;
  function showHud(text, persist = false) {
    let hud = document.getElementById("qmg-hud-indicator");
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "qmg-hud-indicator";
      Object.assign(hud.style, {
        position: "fixed",
        top: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "rgba(15, 23, 42, 0.85)",
        color: "#f8fafc",
        padding: "8px 18px",
        borderRadius: "8px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "15px",
        fontWeight: "600",
        zIndex: "2147483647",
        pointerEvents: "none",
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        border: "1px solid rgba(255,255,255,0.15)",
        transition: "opacity 0.18s ease"
      });
      document.body.appendChild(hud);
    }

    hud.textContent = text;
    hud.style.opacity = "1";

    clearTimeout(hudTimeout);
    if (!persist) {
      hudTimeout = setTimeout(() => {
        hud.style.opacity = "0";
      }, 950);
    }
  }
})();
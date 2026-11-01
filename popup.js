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

const ACTION_LABELS = {
  playPause: "Play / Pause (Hold = 2x)",
  skipBack: "Skip Backward",
  skipForward: "Skip Forward",
  speedUp: "Speed Up a Notch",
  speedDown: "Slow Down a Notch",
  swapVideos: "Swap Lecture / Screen Video",
  resetSpeed: "Reset Speed (1x)",
  mute: "Mute / Unmute",
  fullscreen: "Fullscreen"
};

const storageApi = typeof browser !== "undefined" ? browser.storage : chrome.storage;
let currentSettings = structuredClone(DEFAULT_SETTINGS);
let activeRecordingKey = null;

const skipInput = document.getElementById("skipSeconds");
const holdSpeedInput = document.getElementById("holdSpaceSpeed");
const speedStepsInput = document.getElementById("speedSteps");
const keybindsList = document.getElementById("keybindsList");
const resetBtn = document.getElementById("resetBtn");
const statusMsg = document.getElementById("statusMsg");

function formatKeyLabel(e) {
  let keyName = e.key;
  if (e.code === "Space") keyName = "Space";
  else if (e.code.startsWith("Key")) keyName = e.code.replace("Key", "");
  else if (e.code.startsWith("Digit")) keyName = e.code.replace("Digit", "");
  else if (e.code === "Period" && e.shiftKey) keyName = ">";
  else if (e.code === "Comma" && e.shiftKey) keyName = "<";

  return e.shiftKey ? `Shift + ${keyName}` : keyName;
}

function renderUI() {
  skipInput.value = currentSettings.skipSeconds;
  holdSpeedInput.value = currentSettings.holdSpaceSpeed;
  speedStepsInput.value = currentSettings.speedSteps.join(", ");

  keybindsList.innerHTML = "";
  for (const [actionKey, labelText] of Object.entries(ACTION_LABELS)) {
    const bind = currentSettings.keybinds[actionKey] || DEFAULT_SETTINGS.keybinds[actionKey];
    const row = document.createElement("div");
    row.className = "keybind-row";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = labelText;

    const btn = document.createElement("button");
    btn.className = "keybind-btn";
    btn.textContent = bind.label;
    btn.dataset.action = actionKey;

    btn.addEventListener("click", () => {
      document.querySelectorAll(".keybind-btn").forEach((b) => {
        b.classList.remove("listening");
        b.textContent = currentSettings.keybinds[b.dataset.action].label;
      });
      activeRecordingKey = actionKey;
      btn.classList.add("listening");
      btn.textContent = "Press a key...";
    });

    row.appendChild(nameSpan);
    row.appendChild(btn);
    keybindsList.appendChild(row);
  }
}

function saveSettings() {
  const parsedSkip = parseFloat(skipInput.value);
  if (!isNaN(parsedSkip) && parsedSkip > 0) {
    currentSettings.skipSeconds = parsedSkip;
  }

  const parsedHold = parseFloat(holdSpeedInput.value);
  if (!isNaN(parsedHold) && parsedHold > 0) {
    currentSettings.holdSpaceSpeed = parsedHold;
  }

  const steps = speedStepsInput.value
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n) && n > 0 && n <= 16)
    .sort((a, b) => a - b);

  if (steps.length > 0) {
    currentSettings.speedSteps = [...new Set(steps)];
  }

  storageApi.local.set({ qmgSettings: currentSettings }, () => {
    statusMsg.classList.add("visible");
    setTimeout(() => statusMsg.classList.remove("visible"), 1200);
  });
}

// Listen for key presses when rebinding a shortcut
window.addEventListener("keydown", (e) => {
  if (!activeRecordingKey) return;
  if (["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(e.code)) {
    return; // Wait for actual non-modifier key
  }

  e.preventDefault();
  e.stopPropagation();

  if (e.code === "Escape") {
    activeRecordingKey = null;
    renderUI();
    return;
  }

  currentSettings.keybinds[activeRecordingKey] = {
    code: e.code,
    shift: Boolean(e.shiftKey),
    label: formatKeyLabel(e)
  };

  activeRecordingKey = null;
  renderUI();
  saveSettings();
});

skipInput.addEventListener("change", saveSettings);
holdSpeedInput.addEventListener("change", saveSettings);
speedStepsInput.addEventListener("change", saveSettings);

resetBtn.addEventListener("click", () => {
  currentSettings = structuredClone(DEFAULT_SETTINGS);
  renderUI();
  saveSettings();
});

storageApi.local.get("qmgSettings", (res) => {
  if (res && res.qmgSettings) {
    currentSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...res.qmgSettings,
      keybinds: { ...structuredClone(DEFAULT_SETTINGS.keybinds), ...(res.qmgSettings.keybinds || {}) }
    };
  }
  renderUI();
});
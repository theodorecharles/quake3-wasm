"use strict";

const form = document.querySelector("#launcher-form");
const playerName = document.querySelector("#player-name");
const profile = document.querySelector("#graphics-profile");
const directoryButton = document.querySelector("#choose-directory");
const fileInput = document.querySelector("#pak-files");
const playButton = document.querySelector("#play");
const status = document.querySelector("#status");
const canvas = document.querySelector("#game-canvas");
let selectedFiles = null;
let validatedAssets = null;
const manifestPromise = Quake3Assets.loadManifest();

const profiles = {
  low: ["+set","r_picmip","2","+set","r_vertexLight","1","+set","r_dynamiclight","0","+set","r_subdivisions","12"],
  medium: ["+set","r_picmip","1","+set","r_vertexLight","0","+set","r_dynamiclight","1","+set","r_subdivisions","8"],
  high: ["+set","r_picmip","0","+set","r_vertexLight","0","+set","r_dynamiclight","1","+set","r_subdivisions","4"],
  ultra: ["+set","r_picmip","0","+set","r_vertexLight","0","+set","r_dynamiclight","1","+set","r_subdivisions","2","+set","r_texturebits","32","+set","r_colorbits","24","+set","r_depthbits","24"]
};

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

async function prepareFiles(files, label) {
  selectedFiles = files;
  validatedAssets = null;
  playButton.disabled = true;
  const manifest = await manifestPromise;
  validatedAssets = await Quake3Assets.validate(files, manifest, (name, done, total) => {
    setStatus(`Validating ${name}: ${Math.round(done * 100 / total)}%`);
  });
  setStatus(`${label} is validated and ready. Press Play.`);
  playButton.disabled = false;
}

async function useDirectory(directory) {
  const files = await Quake3Assets.filesFromDirectory(directory);
  await prepareFiles(files, `${directory.name} (${files.length} PAKs)`);
}

async function useLoopbackData() {
  const manifest = await manifestPromise;
  const files = [];
  for (const expected of manifest.files) {
    setStatus(`Loading local ${expected.name}…`);
    const response = await fetch(`/local-data/${encodeURIComponent(expected.name)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Local ${expected.name} is unavailable (HTTP ${response.status})`);
    files.push(new File([await response.blob()], expected.name, { lastModified: 0 }));
  }
  await prepareFiles(files, "Local baseq3 data");
}

directoryButton.addEventListener("click", async () => {
  try {
    const directory = await Quake3Assets.chooseDirectory();
    if (directory) await useDirectory(directory);
  } catch (error) {
    if (error.name !== "AbortError") setStatus(error.message, true);
  }
});

fileInput.addEventListener("change", () => {
  prepareFiles(Array.from(fileInput.files), `${fileInput.files.length} selected PAKs`).catch(error => {
    setStatus(error.message, true);
  });
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  playButton.disabled = true;
  try {
    localStorage.setItem("quake3-player-name", playerName.value);
    localStorage.setItem("quake3-graphics-profile", profile.value);
    if (!validatedAssets) throw new Error("Wait for your selected game data to finish validation.");

    setStatus("Loading the WebAssembly engine…");
    const script = document.createElement("script");
    script.src = "quake3.js";
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load quake3.js"));
      document.head.appendChild(script);
    });

    const width = Math.max(640, Math.min(1920, Math.floor(canvas.clientWidth * devicePixelRatio)));
    const height = Math.max(480, Math.min(1080, Math.floor(canvas.clientHeight * devicePixelRatio)));
    canvas.width = width;
    canvas.height = height;
    const args = [
      "+set","fs_basepath","/data", "+set","fs_homepath","/persist",
      "+set","name", playerName.value, "+set","sv_maxclients","8",
      "+set","vm_cgame","0", "+set","vm_ui","0", "+set","vm_game","0",
      "+set","com_introplayed","1", "+set","r_fullscreen","0",
      "+set","r_mode","-1", "+set","r_customwidth",String(width),
      "+set","r_customheight",String(height), "+set","r_customaspect",String(width / height),
      ...profiles[profile.value], "+echo", "quake3-wasm ready"
    ];
    form.hidden = true;
    canvas.hidden = false;
    setStatus("Starting Quake III Arena…");
    await createQuake3Module({
      canvas,
      arguments: args,
      assetFiles: validatedAssets,
      print: line => console.log(line),
      printErr: line => console.error(line),
      setStatus
    });
  } catch (error) {
    console.error(error);
    setStatus(error.message, true);
    playButton.disabled = false;
  }
});

playerName.value = localStorage.getItem("quake3-player-name") || "Ranger";
profile.value = localStorage.getItem("quake3-graphics-profile") || "high";
if (new URLSearchParams(location.search).get("localdata") === "1") {
  useLoopbackData().catch(error => setStatus(error.message, true));
} else {
  Quake3Assets.restoreDirectory().then(directory => {
    if (directory) useDirectory(directory);
  }).catch(() => {});
}
manifestPromise.catch(error => setStatus(`Could not load the local PAK manifest: ${error.message}`, true));

Module.preRun = Module.preRun || [];
Module.preRun.push(function quake3MountFilesystems() {
  const dependency = "quake3-filesystems";
  addRunDependency(dependency);

  (async () => {
    const files = Module.assetFiles;
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("No validated Quake III PAK files were supplied");
    }

    for (const directory of ["/data", "/data/baseq3", "/persist"]) {
      try { Module.FS.mkdir(directory); } catch (error) {
        if (!String(error).includes("File exists")) throw error;
      }
    }

    Module.FS.mount(Module.IDBFS, {}, "/persist");
    await new Promise((resolve, reject) => {
      Module.FS.syncfs(true, error => error ? reject(error) : resolve());
    });

    // A main-thread browser engine needs synchronous POSIX reads, while File
    // objects are asynchronous. Copy each validated file once, in bounded
    // chunks, to MEMFS. This avoids a second whole-file ArrayBuffer and never
    // duplicates retail data into IndexedDB, CacheStorage, or public HTTP.
    const chunkBytes = 4 * 1024 * 1024;
    for (const file of files) {
      const path = `/data/baseq3/${file.name.toLowerCase()}`;
      const stream = Module.FS.open(path, "w");
      try {
        Module.FS.allocate(stream, 0, file.size);
        for (let offset = 0; offset < file.size; offset += chunkBytes) {
          const bytes = new Uint8Array(await file.slice(offset, offset + chunkBytes).arrayBuffer());
          Module.FS.write(stream, bytes, 0, bytes.length, offset);
          if (Module.setStatus) {
            Module.setStatus(`Preparing ${file.name}: ${Math.round(Math.min(offset + chunkBytes, file.size) * 100 / file.size)}%`);
          }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } finally {
        Module.FS.close(stream);
      }
      Module.FS.chmod(path, 0o444);
    }
    Module.FS.chmod("/data/baseq3", 0o555);
    Module.FS.chmod("/data", 0o555);
    Module.print(`[quake3-wasm] prepared ${files.length} validated owner PAKs read-only`);
  })().then(() => removeRunDependency(dependency)).catch(error => {
    Module.printErr(`[quake3-wasm] filesystem setup failed: ${error.message}`);
    removeRunDependency(dependency);
    throw error;
  });
});

Module.postRun = Module.postRun || [];
Module.postRun.push(function quake3PersistConfiguration() {
  if (!Module.FS || !Module.IDBFS) return;
  window.addEventListener("pagehide", () => Module.FS.syncfs(false, () => {}));
});

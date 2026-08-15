"use strict";

globalThis.Quake3Assets = (() => {
  const CHUNK_BYTES = 4 * 1024 * 1024;
  const SHA_CONSTANTS = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);

  class Sha256 {
    constructor() {
      this.state = new Uint32Array([
        0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
        0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
      ]);
      this.buffer = new Uint8Array(64);
      this.bufferLength = 0;
      this.bytes = 0;
      this.words = new Uint32Array(64);
    }

    rotate(value, bits) {
      return (value >>> bits) | (value << (32 - bits));
    }

    block(bytes, offset) {
      const words = this.words;
      for (let index = 0; index < 16; index += 1) {
        const byte = offset + index * 4;
        words[index] = ((bytes[byte] << 24) | (bytes[byte + 1] << 16) |
          (bytes[byte + 2] << 8) | bytes[byte + 3]) >>> 0;
      }
      for (let index = 16; index < 64; index += 1) {
        const x = words[index - 15];
        const y = words[index - 2];
        const s0 = this.rotate(x, 7) ^ this.rotate(x, 18) ^ (x >>> 3);
        const s1 = this.rotate(y, 17) ^ this.rotate(y, 19) ^ (y >>> 10);
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,h] = this.state;
      for (let index = 0; index < 64; index += 1) {
        const s1 = this.rotate(e, 6) ^ this.rotate(e, 11) ^ this.rotate(e, 25);
        const choice = (e & f) ^ (~e & g);
        const t1 = (h + s1 + choice + SHA_CONSTANTS[index] + words[index]) >>> 0;
        const s0 = this.rotate(a, 2) ^ this.rotate(a, 13) ^ this.rotate(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (s0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      const values = [a,b,c,d,e,f,g,h];
      for (let index = 0; index < 8; index += 1) {
        this.state[index] = (this.state[index] + values[index]) >>> 0;
      }
    }

    update(bytes) {
      this.bytes += bytes.length;
      let offset = 0;
      if (this.bufferLength) {
        const take = Math.min(64 - this.bufferLength, bytes.length);
        this.buffer.set(bytes.subarray(0, take), this.bufferLength);
        this.bufferLength += take;
        offset += take;
        if (this.bufferLength === 64) {
          this.block(this.buffer, 0);
          this.bufferLength = 0;
        }
      }
      while (offset + 64 <= bytes.length) {
        this.block(bytes, offset);
        offset += 64;
      }
      if (offset < bytes.length) {
        this.buffer.set(bytes.subarray(offset), 0);
        this.bufferLength = bytes.length - offset;
      }
    }

    digest() {
      const length = this.bytes;
      this.buffer[this.bufferLength++] = 0x80;
      if (this.bufferLength > 56) {
        this.buffer.fill(0, this.bufferLength);
        this.block(this.buffer, 0);
        this.bufferLength = 0;
      }
      this.buffer.fill(0, this.bufferLength, 56);
      new DataView(this.buffer.buffer).setUint32(56, Math.floor(length / 0x20000000), false);
      new DataView(this.buffer.buffer).setUint32(60, (length << 3) >>> 0, false);
      this.block(this.buffer, 0);
      return Array.from(this.state, value => value.toString(16).padStart(8, "0")).join("");
    }
  }

  async function loadManifest() {
    const response = await fetch("/pak-manifest.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`PAK policy failed with HTTP ${response.status}.`);
    const manifest = await response.json();
    if (manifest.schema !== 1 || !Array.isArray(manifest.files)) {
      throw new Error("Unsupported Quake III PAK policy.");
    }
    return manifest;
  }

  async function sha256(file, progress = () => {}) {
    const hash = new Sha256();
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      hash.update(new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer()));
      progress(Math.min(offset + CHUNK_BYTES, file.size), file.size);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return hash.digest();
  }

  function hashBytesForTest(bytes) {
    const hash = new Sha256();
    hash.update(new Uint8Array(bytes));
    return hash.digest();
  }

  return Object.freeze({ loadManifest, sha256, hashBytesForTest });
})();

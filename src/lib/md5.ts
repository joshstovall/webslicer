// RFC 1321 MD5: the Bambu print container requires this checksum, not a security hash.
export function md5(bytes: Uint8Array): string {
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(length);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const data = new DataView(buffer.buffer);
  data.setUint32(length - 8, (bytes.length * 8) >>> 0, true);
  data.setUint32(length - 4, Math.floor(bytes.length / 0x20000000), true);
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  for (let offset = 0; offset < length; offset += 64) {
    let a = a0,
      b = b0,
      c = c0,
      d = d0;
    for (let i = 0; i < 64; i++) {
      const group = i >> 4;
      const f =
        group === 0
          ? (b & c) | (~b & d)
          : group === 1
            ? (d & b) | (~d & c)
            : group === 2
              ? b ^ c ^ d
              : c ^ (b | ~d);
      const word =
        group === 0
          ? i
          : group === 1
            ? (5 * i + 1) % 16
            : group === 2
              ? (3 * i + 5) % 16
              : (7 * i) % 16;
      const n =
        (a +
          f +
          Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) +
          data.getUint32(offset + word * 4, true)) |
        0;
      const shift = shifts[group * 4 + (i % 4)];
      a = d;
      d = c;
      c = b;
      b = (b + ((n << shift) | (n >>> (32 - shift)))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0]
    .flatMap((n) =>
      [0, 8, 16, 24].map((s) =>
        ((n >>> s) & 255).toString(16).padStart(2, "0"),
      ),
    )
    .join("");
}

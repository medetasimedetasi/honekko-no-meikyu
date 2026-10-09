// 共有32色パレット v2（コンセプト_20261007/共有パレット）と、いちばん近い色を探す道具
(() => {
  const PAL = ["#0b1120", "#221b17", "#3f2d21", "#5c422c", "#8a5a38", "#ae6f47", "#cca673", "#e1bc88", "#f2dcb4", "#fbf3e2", "#4a4640", "#6e655a", "#897d69", "#a19077", "#18222d", "#2c3a48", "#506573", "#7a8e9c", "#b8c4cc", "#0e1c3f", "#2b3e6d", "#425c8d", "#647091", "#7582a9", "#4aa3e8", "#34402a", "#5c7236", "#8eaa48", "#8f2f2b", "#d24a3c", "#e7a08a", "#f0b84a"];
  const lab = hex => {
    const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    let X = (v[0] * 0.4124 + v[1] * 0.3576 + v[2] * 0.1805) / 0.95047, Y = v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722, Z = (v[0] * 0.0193 + v[1] * 0.1192 + v[2] * 0.9505) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    X = f(X); Y = f(Y); Z = f(Z);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  };
  const LABS = PAL.map(lab), memo = new Map();
  function nearest(hex) {
    hex = hex.slice(0, 7).toLowerCase();
    if (memo.has(hex)) return memo.get(hex);
    const a = lab(hex); let best = 0, bd = Infinity;
    LABS.forEach((b, i) => { const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < bd) { bd = d; best = i; } });
    memo.set(hex, PAL[best]); return PAL[best];
  }
  globalThis.PAL32 = { colors: PAL, nearest };
})();

// keytool.cs — 鲸鱼娘素材处理：棋盘格白底抠图（边界泛洪）→ 统一基准对齐 → 缩放导出透明 PNG
// 依赖 System.Drawing（Windows/.NET Framework 或 .NET 的 System.Drawing.Common）。
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;

public static class KeyTool
{
    // ---------- 基础 ----------

    static byte[] ReadBgra(Bitmap bmp)
    {
        int W = bmp.Width, H = bmp.Height;
        var data = bmp.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var buf = new byte[W * H * 4];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, buf, 0, buf.Length);
        bmp.UnlockBits(data);
        return buf;
    }

    static bool IsBg(byte[] px, int p, int minCh, int maxDiff)
    {
        int i = p * 4;
        int b = px[i], g = px[i + 1], r = px[i + 2];
        int mn = Math.Min(r, Math.Min(g, b));
        int mx = Math.Max(r, Math.Max(g, b));
        return mn >= minCh && (mx - mn) <= maxDiff;
    }

    /// <summary>从图像四边泛洪出背景掩码；返回 bool[]（true=背景）。</summary>
    static bool[] FloodBackground(byte[] px, int W, int H, int minCh, int maxDiff)
    {
        var isBg = new bool[W * H];
        var stack = new int[W * H];
        int sp = 0;

        for (int x = 0; x < W; x++) { Seed(px, isBg, stack, ref sp, x, 0, W, minCh, maxDiff); Seed(px, isBg, stack, ref sp, x, H - 1, W, minCh, maxDiff); }
        for (int y = 0; y < H; y++) { Seed(px, isBg, stack, ref sp, 0, y, W, minCh, maxDiff); Seed(px, isBg, stack, ref sp, W - 1, y, W, minCh, maxDiff); }

        while (sp > 0)
        {
            int p = stack[--sp];
            int x = p % W, y = p / W;
            if (x > 0) Seed(px, isBg, stack, ref sp, x - 1, y, W, minCh, maxDiff);
            if (x < W - 1) Seed(px, isBg, stack, ref sp, x + 1, y, W, minCh, maxDiff);
            if (y > 0) Seed(px, isBg, stack, ref sp, x, y - 1, W, minCh, maxDiff);
            if (y < H - 1) Seed(px, isBg, stack, ref sp, x, y + 1, W, minCh, maxDiff);
        }
        return isBg;
    }

    static void Seed(byte[] px, bool[] isBg, int[] stack, ref int sp, int x, int y, int W, int minCh, int maxDiff)
    {
        int p = y * W + x;
        if (isBg[p]) return;
        if (!IsBg(px, p, minCh, maxDiff)) return;
        isBg[p] = true;
        stack[sp++] = p;
    }

    /// <summary>前景包围盒（不含被前景围住的封闭背景块，除非 includeHoles=true 已被泛洪）。</summary>
    static int[] Bounds(bool[] isBg, int W, int H)
    {
        int minX = W, minY = H, maxX = -1, maxY = -1;
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++)
                if (!isBg[y * W + x])
                {
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
        return new[] { minX, minY, maxX, maxY };
    }

    // ---------- 诊断 ----------

    public static void Info(string path, int minCh, int maxDiff)
    {
        using (var src = new Bitmap(path))
        {
            int W = src.Width, H = src.Height;
            byte[] px = ReadBgra(src);
            var isBg = FloodBackground(px, W, H, minCh, maxDiff);
            var bd = Bounds(isBg, W, H);

            // 未被泛洪到的“背景色”像素 = 被前景围住的封闭空洞
            int holes = 0; var comps = new List<int[]>();
            var seen = new bool[W * H];
            for (int p = 0; p < W * H; p++)
            {
                if (isBg[p] || seen[p] || !IsBg(px, p, minCh, maxDiff)) continue;
                // BFS 该连通块
                var q = new Queue<int>(); q.Enqueue(p); seen[p] = true;
                int cnt = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
                while (q.Count > 0)
                {
                    int c = q.Dequeue(); cnt++;
                    int cx = c % W, cy = c / W;
                    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
                    int[] nb = { cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, cy > 0 ? c - W : -1, cy < H - 1 ? c + W : -1 };
                    foreach (int n in nb) { if (n >= 0 && !seen[n] && !isBg[n] && IsBg(px, n, minCh, maxDiff)) { seen[n] = true; q.Enqueue(n); } }
                }
                holes += cnt; comps.Add(new[] { cnt, x0, y0, x1, y1 });
            }
            comps.Sort((a, b) => b[0].CompareTo(a[0]));
            Console.WriteLine(string.Format("{0}\t{1}x{2}\tfgBBox=({3},{4})-({5},{6}) [{7}x{8}]\tbgPx={9}\tenclosedBgPx={10}\tenclosedComps={11}",
                System.IO.Path.GetFileName(path), W, H, bd[0], bd[1], bd[2], bd[3], bd[2] - bd[0] + 1, bd[3] - bd[1] + 1,
                Count(isBg), holes, comps.Count));
            for (int i = 0; i < Math.Min(5, comps.Count); i++)
                Console.WriteLine(string.Format("    hole#{0} px={1} bbox=({2},{3})-({4},{5})", i, comps[i][0], comps[i][1], comps[i][2], comps[i][3], comps[i][4]));
        }
    }

    static int Count(bool[] a) { int c = 0; foreach (var v in a) if (v) c++; return c; }

    /// <summary>前景包围盒 [minX,minY,maxX,maxY]（供脚本计算对齐基准）。</summary>
    public static int[] BoundsOf(string path, int minCh, int maxDiff)
    {
        using (var src = new Bitmap(path))
        {
            int W = src.Width, H = src.Height;
            var isBg = FloodBackground(ReadBgra(src), W, H, minCh, maxDiff);
            return Bounds(isBg, W, H);
        }
    }

    /// <summary>
    /// 由一张透明 PNG 生成"角色剪影"多边形（CSS clip-path 用），用于让透明留白不拦截鼠标。
    /// 以 alpha 质心为原点，向 dirs 个方向射线扫描，取该方向上最后一个不透明像素的半径（可跨过 bridgePx 的小缝隙）。
    /// </summary>
    public static string Silhouette(string path, int dirs, int bridgePx, double scalePct)
    {
        using (var bmp = new Bitmap(path))
        {
            int W = bmp.Width, H = bmp.Height;
            byte[] px = ReadBgra(bmp);
            long sx = 0, sy = 0, n = 0;
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                    if (px[(y * W + x) * 4 + 3] > 8) { sx += x; sy += y; n++; }
            if (n == 0) return string.Empty;
            double cx = (double)sx / n, cy = (double)sy / n;
            // 质心用"角色主体"中心更稳：用 bbox 底部中点与质心的折中（头部占 alpha 比例大）
            double maxR = Math.Sqrt((double)W * W + (double)H * H);
            var sb = new System.Text.StringBuilder();
            for (int i = 0; i < dirs; i++)
            {
                double ang = -Math.PI / 2 + 2 * Math.PI * i / dirs; // 从正上方开始顺时针
                double dx = Math.Cos(ang), dy = Math.Sin(ang);
                int lastSolid = 0, gap = 0;
                for (int r = 1; r < maxR; r++)
                {
                    int x = (int)Math.Round(cx + dx * r), y = (int)Math.Round(cy + dy * r);
                    if (x < 0 || y < 0 || x >= W || y >= H) break;
                    if (px[(y * W + x) * 4 + 3] > 8) { lastSolid = r; gap = 0; }
                    else if (++gap > bridgePx) break;
                }
                double rr = lastSolid * scalePct;
                double px1 = cx + dx * rr, py1 = cy + dy * rr;
                double xp = 100.0 * px1 / W, yp = 100.0 * py1 / H;
                if (sb.Length > 0) sb.Append(',');
                sb.Append(xp.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture)).Append("% ")
                  .Append(yp.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture)).Append('%');
            }
            return sb.ToString();
        }
    }

    /// <summary>已导出透明 PNG 的 alpha 包围盒 [minX,minY,maxX,maxY]（校验对齐用）。</summary>
    public static int[] AlphaBoundsOf(string path)
    {
        using (var src = new Bitmap(path))
        {
            int W = src.Width, H = src.Height;
            byte[] px = ReadBgra(src);
            int minX = W, minY = H, maxX = -1, maxY = -1;
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                    if (px[(y * W + x) * 4 + 3] > 8)
                    {
                        if (x < minX) minX = x; if (x > maxX) maxX = x;
                        if (y < minY) minY = y; if (y > maxY) maxY = y;
                    }
            return new[] { minX, minY, maxX, maxY };
        }
    }

    // ---------- 导出 ----------

    /// <summary>
    /// 抠图 + 按基准点对齐 + 缩放，导出透明 PNG。
    /// 映射：dest(x,y) = src(bx + (x-ox)/scale, by + (y-oy)/scale)
    /// </summary>
    public static void Render(string srcPath, string dstPath, double scale, double bx, double by,
                              int outW, int outH, double ox, double oy, int minCh, int maxDiff, int rampLo, int rampHi)
    {
        using (var src = new Bitmap(srcPath))
        {
            int W = src.Width, H = src.Height;
            byte[] px = ReadBgra(src);
            var isBg = FloodBackground(px, W, H, minCh, maxDiff);

            // 1) 生成预乘 alpha 的键控位图（边缘像素按亮度做柔和过渡，避免白边/锯齿）
            var keyed = new Bitmap(W, H, PixelFormat.Format32bppPArgb);
            var kd = keyed.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
            var outBuf = new byte[W * H * 4];
            for (int y = 0; y < H; y++)
            {
                for (int x = 0; x < W; x++)
                {
                    int p = y * W + x, i = p * 4;
                    byte b = px[i], g = px[i + 1], r = px[i + 2];
                    if (isBg[p]) { outBuf[i] = 0; outBuf[i + 1] = 0; outBuf[i + 2] = 0; outBuf[i + 3] = 0; continue; }
                    int a = 255;
                    bool nearBg = (x > 0 && isBg[p - 1]) || (x < W - 1 && isBg[p + 1]) || (y > 0 && isBg[p - W]) || (y < H - 1 && isBg[p + W]);
                    if (nearBg)
                    {
                        int mn = Math.Min(r, Math.Min(g, b));
                        double t = (double)(rampHi - mn) / (double)(rampHi - rampLo); // mn 越亮 → 越透明
                        if (t < 0) t = 0; if (t > 1) t = 1;
                        a = (int)Math.Round(255.0 * t);
                    }
                    outBuf[i] = (byte)(b * a / 255);
                    outBuf[i + 1] = (byte)(g * a / 255);
                    outBuf[i + 2] = (byte)(r * a / 255);
                    outBuf[i + 3] = (byte)a;
                }
            }
            System.Runtime.InteropServices.Marshal.Copy(outBuf, 0, kd.Scan0, outBuf.Length);
            keyed.UnlockBits(kd);

            // 2) 缩放绘制到目标画布
            using (var dst = new Bitmap(outW, outH, PixelFormat.Format32bppPArgb))
            {
                using (var g = Graphics.FromImage(dst))
                {
                    g.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
                    g.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighQuality;
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;

                    double sx0 = bx - ox / scale, sy0 = by - oy / scale;
                    double sx1 = sx0 + outW / scale, sy1 = sy0 + outH / scale;
                    double cx0 = Math.Max(sx0, 0), cy0 = Math.Max(sy0, 0);
                    double cx1 = Math.Min(sx1, W), cy1 = Math.Min(sy1, H);
                    if (cx1 > cx0 && cy1 > cy0)
                    {
                        var srcRect = new RectangleF((float)cx0, (float)cy0, (float)(cx1 - cx0), (float)(cy1 - cy0));
                        int dx0 = (int)Math.Round((cx0 - sx0) * scale), dy0 = (int)Math.Round((cy0 - sy0) * scale);
                        int dx1 = (int)Math.Round((cx1 - sx0) * scale), dy1 = (int)Math.Round((cy1 - sy0) * scale);
                        if (dx1 > dx0 && dy1 > dy0)
                            g.DrawImage(keyed, new Rectangle(dx0, dy0, dx1 - dx0, dy1 - dy0), srcRect, GraphicsUnit.Pixel);
                    }
                }
                dst.Save(dstPath, ImageFormat.Png);
            }
            keyed.Dispose();
        }
    }

    /// <summary>把一张已导出的透明 PNG 合成到棋盘灰底上，用于肉眼检查（调试用）。</summary>
    public static void Checker(string srcPath, string dstPath, int cell)
    {
        using (var src = new Bitmap(srcPath))
        {
            int W = src.Width, H = src.Height;
            using (var dst = new Bitmap(W, H, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(dst))
                {
                    using (var a = new SolidBrush(Color.FromArgb(255, 90, 90, 90)))
                    using (var b = new SolidBrush(Color.FromArgb(255, 140, 140, 140)))
                    {
                        for (int y = 0; y < H; y += cell)
                            for (int x = 0; x < W; x += cell)
                                g.FillRectangle((((x / cell) + (y / cell)) % 2 == 0) ? a : b, x, y, cell, cell);
                    }
                    g.DrawImage(src, 0, 0, W, H);
                }
                dst.Save(dstPath, ImageFormat.Png);
            }
        }
    }
}
